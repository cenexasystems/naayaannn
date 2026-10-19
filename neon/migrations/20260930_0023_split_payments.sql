-- ============================================================
-- Migration 0023: Split payments (cash / QR / card)
-- Date: 2026-09-30
-- Purpose:
-- 1. Allow advance order deposits / final payments to be split across cash, QR and card
-- 2. Store the per-channel amounts (split_details) on advance_order_payments
-- 3. Write the full collection breakdown (deposit + final) into orders.split_details
-- POS bills already use orders.split_details (no schema change needed there).
-- ============================================================

BEGIN;

ALTER TABLE public.advance_order_payments
  ADD COLUMN IF NOT EXISTS split_details jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.advance_order_payments'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%payment_method%'
  LOOP
    EXECUTE format('ALTER TABLE public.advance_order_payments DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.advance_order_payments
  ADD CONSTRAINT advance_order_payments_payment_method_check
  CHECK (payment_method IN ('cash', 'upi', 'card', 'split'));

-- Amount collected per channel for one payment: {"cash": n, "qr": n, "card": n}
CREATE OR REPLACE FUNCTION public.payment_breakdown(p_method text, p_split jsonb, p_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_cash numeric := coalesce((p_split->>'cash')::numeric, 0);
  v_qr   numeric := coalesce((p_split->>'qr')::numeric, (p_split->>'upi')::numeric, 0);
  v_card numeric := coalesce((p_split->>'card')::numeric, 0);
BEGIN
  IF v_cash + v_qr + v_card > 0 THEN
    RETURN jsonb_build_object('cash', v_cash, 'qr', v_qr, 'card', v_card);
  END IF;
  RETURN jsonb_build_object(
    'cash', CASE WHEN lower(coalesce(p_method, '')) = 'cash' THEN coalesce(p_amount, 0) ELSE 0 END,
    'qr',   CASE WHEN lower(coalesce(p_method, '')) IN ('upi', 'qr') THEN coalesce(p_amount, 0) ELSE 0 END,
    'card', CASE WHEN lower(coalesce(p_method, '')) = 'card' THEN coalesce(p_amount, 0) ELSE 0 END
  );
END;
$$;

DROP FUNCTION IF EXISTS public.create_advance_order(text,text,text,text,text,text,numeric,numeric,date,text,text,text,jsonb);
create or replace function public.create_advance_order(
  p_customer_name text, p_phone text, p_address text, p_product_name text,
  p_category text, p_description text, p_total_amount numeric, p_deposit_amount numeric,
  p_expected_delivery_date date, p_remarks text, p_payment_method text, p_created_by_name text,
  p_products jsonb default '[]'::jsonb,
  p_split_details jsonb default '{}'::jsonb
)
returns public.advance_orders
language plpgsql security definer set search_path = public
as $$
declare v_order public.advance_orders; v_now timestamptz := now(); v_deposit_id text;
begin
  if trim(coalesce(p_customer_name,'')) = '' then raise exception 'Customer name is required'; end if;
  if trim(coalesce(p_phone,'')) = '' then raise exception 'Phone number is required'; end if;
  if trim(coalesce(p_product_name,'')) = '' then raise exception 'Product name is required'; end if;
  if coalesce(p_total_amount,0) <= 0 then raise exception 'Total amount must be greater than zero'; end if;
  if coalesce(p_deposit_amount,0) <= 0 or p_deposit_amount >= p_total_amount then raise exception 'Deposit must be greater than zero and less than the total amount'; end if;
  if lower(coalesce(p_payment_method,'')) not in ('cash','upi','card','split') then raise exception 'Select a valid deposit payment method'; end if;
  if lower(p_payment_method) = 'split' and abs(coalesce((p_split_details->>'cash')::numeric,0) + coalesce((p_split_details->>'qr')::numeric,(p_split_details->>'upi')::numeric,0) + coalesce((p_split_details->>'card')::numeric,0) - p_deposit_amount) >= 0.01 then raise exception 'Split payment amounts must add up to the deposit amount'; end if;
  v_deposit_id := 'DEP-' || to_char(v_now at time zone 'Asia/Kolkata','YYYYMMDD') || '-' || lpad(nextval('public.deposit_number_seq')::text,4,'0');
  insert into public.advance_orders(deposit_id,customer_name,phone,address,product_name,products,category,description,total_amount,deposit_amount,expected_delivery_date,remarks,created_by,created_by_name,created_at,updated_at)
  values(v_deposit_id,trim(p_customer_name),trim(p_phone),trim(coalesce(p_address,'')),trim(p_product_name),case when jsonb_typeof(coalesce(p_products,'[]'::jsonb))='array' then coalesce(p_products,'[]'::jsonb) else '[]'::jsonb end,trim(coalesce(p_category,'')),trim(coalesce(p_description,'')),round(p_total_amount,2),round(p_deposit_amount,2),p_expected_delivery_date,trim(coalesce(p_remarks,'')),auth.uid(),trim(coalesce(p_created_by_name,'')),v_now,v_now)
  returning * into v_order;
  insert into public.advance_order_payments(advance_order_id,payment_type,amount,payment_method,split_details,remarks,received_by,received_at)
  values(v_order.id,'deposit',v_order.deposit_amount,lower(p_payment_method),case when lower(p_payment_method)='split' then coalesce(p_split_details,'{}'::jsonb) else '{}'::jsonb end,coalesce(p_remarks,''),auth.uid(),v_now);
  insert into public.advance_order_timeline(advance_order_id,event_type,label,created_by,created_at) values
    (v_order.id,'created','Created',auth.uid(),v_now),
    (v_order.id,'deposit_received','Deposit Received',auth.uid(),v_now);
  return v_order;
end;
$$;

DROP FUNCTION IF EXISTS public.complete_advance_order_v2(uuid,text,numeric,text,numeric,numeric,text);
CREATE OR REPLACE FUNCTION public.complete_advance_order_v2(
  p_order_id uuid,
  p_payment_method text,
  p_final_amount numeric,
  p_coupon_code text DEFAULT NULL,
  p_coupon_percentage numeric DEFAULT 0,
  p_manual_discount numeric DEFAULT 0,
  p_remarks text DEFAULT '',
  p_split_details jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(order_id uuid, invoice_no text, completed_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_advance        public.advance_orders;
  v_order_id       uuid := gen_random_uuid();
  v_invoice        text;
  v_now            timestamptz := now();
  v_items          jsonb;
  v_item           jsonb;
  v_total_discount numeric := 0;
  v_dep            record;
  v_dep_bd         jsonb := '{}'::jsonb;
  v_fin_bd         jsonb;
  v_split          jsonb;
BEGIN
  -- Validate payment method
  IF lower(coalesce(p_payment_method, '')) NOT IN ('cash', 'upi', 'card', 'split') THEN
    RAISE EXCEPTION 'Select a valid payment method';
  END IF;
  IF lower(p_payment_method) = 'split' AND abs(
       coalesce((p_split_details->>'cash')::numeric, 0)
     + coalesce((p_split_details->>'qr')::numeric, (p_split_details->>'upi')::numeric, 0)
     + coalesce((p_split_details->>'card')::numeric, 0) - p_final_amount) >= 0.01 THEN
    RAISE EXCEPTION 'Split payment amounts must add up to the final amount';
  END IF;

  -- Lock and fetch the advance order
  SELECT * INTO v_advance FROM public.advance_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advance order not found';
  END IF;

  IF v_advance.status = 'cancelled' THEN
    RAISE EXCEPTION 'A cancelled order cannot be completed';
  END IF;

  -- Self-healing check: If invoice or completed order already exists, ensure completed status and return cleanly
  IF v_advance.completed_order_id IS NOT NULL OR v_advance.invoice_number IS NOT NULL THEN
    IF v_advance.status != 'completed' THEN
      UPDATE public.advance_orders
      SET status = 'completed',
          updated_at = v_now
      WHERE id = p_order_id;
    END IF;

    RETURN QUERY SELECT 
      coalesce(v_advance.completed_order_id, gen_random_uuid()),
      coalesce(v_advance.invoice_number, 'INV00000000'),
      coalesce(v_advance.completed_at, v_now);
    RETURN;
  END IF;

  -- Calculate total discount from manual discount and coupon
  v_total_discount := p_manual_discount + (v_advance.remaining_balance - p_manual_discount - p_final_amount);
  IF v_total_discount < 0 THEN
    v_total_discount := 0;
  END IF;

  -- Generate invoice number using the existing 8-digit sequence
  v_invoice := LPAD(nextval('public.invoice_number_seq')::TEXT, 8, '0');

  -- Build items JSONB - prefer products array, fall back to single product
  v_items := CASE
    WHEN jsonb_typeof(v_advance.products) = 'array' AND jsonb_array_length(v_advance.products) > 0
      THEN v_advance.products
    ELSE jsonb_build_array(
      jsonb_build_object(
        'name',        v_advance.product_name,
        'category',    v_advance.category,
        'description', v_advance.description,
        'quantity',    1,
        'base_price',  v_advance.total_amount,
        'line_total',  v_advance.total_amount,
        'unit',        'piece',
        'unit_type',   'unit',
        'source',      'advance_order'
      )
    )
  END;

  -- Full collection breakdown for this order (deposit + final payment) by cash / qr / card
  SELECT payment_method, split_details, amount INTO v_dep
  FROM public.advance_order_payments
  WHERE advance_order_id = p_order_id AND payment_type = 'deposit'
  LIMIT 1;
  IF FOUND THEN
    v_dep_bd := public.payment_breakdown(v_dep.payment_method, v_dep.split_details, v_dep.amount);
  END IF;
  v_fin_bd := public.payment_breakdown(p_payment_method, p_split_details, p_final_amount);
  v_split := jsonb_build_object(
    'cash', coalesce((v_dep_bd->>'cash')::numeric, 0) + coalesce((v_fin_bd->>'cash')::numeric, 0),
    'qr',   coalesce((v_dep_bd->>'qr')::numeric, 0)   + coalesce((v_fin_bd->>'qr')::numeric, 0),
    'card', coalesce((v_dep_bd->>'card')::numeric, 0) + coalesce((v_fin_bd->>'card')::numeric, 0)
  );

  -- Create final sale order
  INSERT INTO public.orders (
    id, invoice_no, customer_name, phone, address, user_id,
    items, subtotal, total, status, order_mode, order_type,
    shipping, delivery_charge, discount_amount, manual_discount_amount,
    coupon_code, coupon_percentage, manual_discount_type, manual_discount_value,
    payment_mode, payment_method, split_details, created_at, updated_at
  ) VALUES (
    v_order_id, v_invoice,
    v_advance.customer_name, v_advance.phone, v_advance.address, auth.uid(),
    v_items, v_advance.total_amount, greatest(0, v_advance.total_amount - v_total_discount),
    'completed', 'offline', 'advance_order',
    0, 0, v_total_discount, p_manual_discount,
    p_coupon_code, p_coupon_percentage, 'flat', p_manual_discount,
    lower(p_payment_method), lower(p_payment_method), v_split,
    v_now, v_now
  );

  -- Insert order items
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    INSERT INTO public.order_items (
      order_id, product_name, name, quantity, unit, unit_type,
      base_price, line_total, is_manual
    ) VALUES (
      v_order_id,
      coalesce(nullif(trim(v_item->>'name'), ''), 'Product'),
      coalesce(nullif(trim(v_item->>'name'), ''), 'Product'),
      greatest(coalesce((v_item->>'quantity')::numeric, 1), 0),
      coalesce(nullif(v_item->>'unit', ''), 'piece'),
      coalesce(nullif(v_item->>'unit_type', ''), 'unit'),
      greatest(coalesce((v_item->>'base_price')::numeric, 0), 0),
      greatest(coalesce((v_item->>'line_total')::numeric, 0), 0),
      false
    );
  END LOOP;

  -- Record final payment
  INSERT INTO public.advance_order_payments (
    advance_order_id, payment_type, amount, payment_method, split_details, remarks, received_by, received_at
  ) VALUES (
    p_order_id, 'remaining', p_final_amount,
    lower(p_payment_method),
    CASE WHEN lower(p_payment_method) = 'split' THEN coalesce(p_split_details, '{}'::jsonb) ELSE '{}'::jsonb END,
    coalesce(p_remarks, ''), auth.uid(), v_now
  );

  -- Mark advance order as completed
  UPDATE public.advance_orders SET
    status               = 'completed',
    completed_at         = v_now,
    completed_order_id   = v_order_id,
    invoice_number       = v_invoice,
    final_payment_method = lower(p_payment_method),
    remarks              = CASE WHEN trim(coalesce(p_remarks, '')) = '' THEN remarks ELSE p_remarks END,
    updated_at           = v_now
  WHERE id = p_order_id;

  -- Timeline events
  INSERT INTO public.advance_order_timeline (
    advance_order_id, event_type, label, remarks, created_by, created_at
  ) VALUES
    (p_order_id, 'remaining_payment_received', 'Remaining Payment Received', coalesce(p_remarks, ''), auth.uid(), v_now),
    (p_order_id, 'invoice_generated',          'Invoice Generated',          v_invoice,               auth.uid(), v_now);

  RETURN QUERY SELECT v_order_id, v_invoice, v_now;
END;
$$;
NOTIFY pgrst, 'reload schema';

COMMIT;
