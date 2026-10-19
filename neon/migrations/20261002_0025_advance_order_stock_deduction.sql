-- ============================================================
-- Migration 0025: Deduct stock + log SALE movements when an advance order is completed
-- Date: 2026-10-02
-- complete_advance_order_v2 created the invoice but never touched inventory.
-- Items with a product_id now deduct stock and write inventory_movements,
-- exactly like complete_pos_sale_with_inventory. Stock is clamped at 0 (never blocks collection).
-- ============================================================

BEGIN;

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
  v_product_id     bigint;
  v_variant_id     uuid;
  v_qty            numeric;
  v_stock_before   numeric;
  v_barcode_id     uuid;
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

  -- Insert order items, deduct stock and record SALE movements (same as POS billing)
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::bigint;
    v_variant_id := NULLIF(v_item->>'variant_id', '')::uuid;
    v_qty        := greatest(coalesce((v_item->>'quantity')::numeric, 1), 0);

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, variant_name, product_name, name, quantity, unit, unit_type,
      base_price, line_total, is_manual
    ) VALUES (
      v_order_id, v_product_id, v_variant_id, v_item->>'variant_name',
      coalesce(nullif(trim(v_item->>'name'), ''), 'Product'),
      coalesce(nullif(trim(v_item->>'name'), ''), 'Product'),
      v_qty,
      coalesce(nullif(v_item->>'unit', ''), 'piece'),
      coalesce(nullif(v_item->>'unit_type', ''), 'unit'),
      greatest(coalesce((v_item->>'base_price')::numeric, 0), 0),
      greatest(coalesce((v_item->>'line_total')::numeric, 0), 0),
      false
    );

    IF v_product_id IS NOT NULL AND v_qty > 0 THEN
      IF v_variant_id IS NOT NULL THEN
        SELECT stock INTO v_stock_before FROM public.product_variants WHERE id = v_variant_id FOR UPDATE;
        SELECT id INTO v_barcode_id FROM public.barcode_registry WHERE variant_id = v_variant_id AND is_active = TRUE LIMIT 1;

        UPDATE public.product_variants
        SET stock = greatest(0, stock - v_qty), updated_at = now()
        WHERE id = v_variant_id;

        UPDATE public.products
        SET stock_quantity = (SELECT coalesce(sum(stock), 0) FROM public.product_variants WHERE product_id = v_product_id AND is_active = TRUE),
            stock = floor((SELECT coalesce(sum(stock), 0) FROM public.product_variants WHERE product_id = v_product_id AND is_active = TRUE))::integer,
            updated_at = now()
        WHERE id = v_product_id;
      ELSE
        SELECT stock_quantity INTO v_stock_before FROM public.products WHERE id = v_product_id FOR UPDATE;
        SELECT id INTO v_barcode_id FROM public.barcode_registry WHERE product_id = v_product_id AND variant_id IS NULL AND is_active = TRUE LIMIT 1;

        UPDATE public.products
        SET stock_quantity = greatest(0, stock_quantity - v_qty),
            stock = greatest(0, stock - floor(v_qty)::integer),
            updated_at = now()
        WHERE id = v_product_id;
      END IF;

      IF v_stock_before IS NOT NULL THEN
        INSERT INTO public.inventory_movements (
          product_id, variant_id, barcode_id, movement_type,
          quantity_delta, quantity_before, quantity_after,
          reference_type, reference_id, note
        ) VALUES (
          v_product_id, v_variant_id, v_barcode_id, 'SALE',
          -v_qty, v_stock_before, greatest(0, v_stock_before - v_qty),
          'order', v_invoice, 'Advance order balance collected'
        );
      END IF;
    END IF;
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
