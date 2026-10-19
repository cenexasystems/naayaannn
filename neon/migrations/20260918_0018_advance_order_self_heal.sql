-- ============================================================
-- Migration 0018: Advance order self-healing & status integrity
-- Date: 2026-09-18
-- Purpose:
-- 1. Make complete_advance_order_v2 self-heal if invoice already generated
-- 2. Prevent update_advance_order_status from changing completed invoice orders
-- ============================================================

CREATE OR REPLACE FUNCTION public.complete_advance_order_v2(
  p_order_id uuid,
  p_payment_method text,
  p_final_amount numeric,
  p_coupon_code text DEFAULT NULL,
  p_coupon_percentage numeric DEFAULT 0,
  p_manual_discount numeric DEFAULT 0,
  p_remarks text DEFAULT ''
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
BEGIN
  -- Validate payment method
  IF lower(coalesce(p_payment_method, '')) NOT IN ('cash', 'upi', 'card') THEN
    RAISE EXCEPTION 'Select a valid payment method';
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

  -- Create final sale order
  INSERT INTO public.orders (
    id, invoice_no, customer_name, phone, address, user_id,
    items, subtotal, total, status, order_mode, order_type,
    shipping, delivery_charge, discount_amount, manual_discount_amount,
    coupon_code, coupon_percentage, manual_discount_type, manual_discount_value,
    payment_mode, payment_method, created_at, updated_at
  ) VALUES (
    v_order_id, v_invoice,
    v_advance.customer_name, v_advance.phone, v_advance.address, auth.uid(),
    v_items, v_advance.total_amount, greatest(0, v_advance.total_amount - v_total_discount),
    'completed', 'offline', 'advance_order',
    0, 0, v_total_discount, p_manual_discount,
    p_coupon_code, p_coupon_percentage, 'flat', p_manual_discount,
    lower(p_payment_method), lower(p_payment_method),
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
    advance_order_id, payment_type, amount, payment_method, remarks, received_by, received_at
  ) VALUES (
    p_order_id, 'remaining', p_final_amount,
    lower(p_payment_method), coalesce(p_remarks, ''), auth.uid(), v_now
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

-- Prevent changing status of advance orders that already have an invoice
CREATE OR REPLACE FUNCTION public.update_advance_order_status(
  p_order_id uuid,
  p_status   text,
  p_remarks  text DEFAULT ''
)
RETURNS SETOF public.advance_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.advance_orders;
BEGIN
  SELECT * INTO v_order FROM public.advance_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advance order % not found', p_order_id;
  END IF;

  IF (v_order.invoice_number IS NOT NULL OR v_order.completed_order_id IS NOT NULL) AND p_status != 'completed' THEN
    RAISE EXCEPTION 'Cannot change status of an order that already has an invoice generated';
  END IF;

  UPDATE public.advance_orders SET
    status     = p_status,
    remarks    = CASE WHEN trim(coalesce(p_remarks,'')) = '' THEN remarks ELSE p_remarks END,
    updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.advance_order_timeline (advance_order_id, event_type, label, remarks, created_by, created_at)
  VALUES (
    p_order_id,
    p_status,
    CASE p_status
      WHEN 'pending_deposit'       THEN 'Status: Pending Deposit'
      WHEN 'waiting_final_payment' THEN 'Status: Waiting for Final Payment'
      WHEN 'ready_for_delivery'    THEN 'Status: Ready to Collect'
      WHEN 'completed'             THEN 'Order Completed'
      WHEN 'cancelled'             THEN 'Order Cancelled'
      ELSE p_status
    END,
    coalesce(p_remarks, ''),
    auth.uid(),
    now()
  );

  RETURN QUERY SELECT * FROM public.advance_orders WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_advance_order_v2(uuid, text, numeric, text, numeric, numeric, text) TO public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_advance_order_status(uuid, text, text) TO authenticated, anon, public;

NOTIFY pgrst, 'reload schema';
