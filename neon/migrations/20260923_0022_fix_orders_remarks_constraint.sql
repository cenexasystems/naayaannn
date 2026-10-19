-- ==========================================================================
-- Migration 0022: Fix orders table remarks and reference_number NOT NULL constraint
-- Date: 2026-09-23
-- Purpose:
--   1. Drop NOT NULL constraint on public.orders.remarks and reference_number,
--      ensuring safe DEFAULT '' so NULL inputs never break checkout transactions.
--   2. Update complete_pos_sale_with_inventory to safely COALESCE remarks and
--      reference_number to '' when inserting into orders.
-- ==========================================================================

BEGIN;

-- Relax NOT NULL constraint and set safe defaults
ALTER TABLE public.orders ALTER COLUMN remarks DROP NOT NULL;
ALTER TABLE public.orders ALTER COLUMN remarks SET DEFAULT '';

ALTER TABLE public.orders ALTER COLUMN reference_number DROP NOT NULL;
ALTER TABLE public.orders ALTER COLUMN reference_number SET DEFAULT '';

-- Update complete_pos_sale_with_inventory RPC
CREATE OR REPLACE FUNCTION public.complete_pos_sale_with_inventory(
  p_customer_name TEXT,
  p_phone TEXT,
  p_address TEXT,
  p_items JSONB,
  p_shipping NUMERIC DEFAULT 0,
  p_status TEXT DEFAULT 'completed',
  p_order_mode TEXT DEFAULT 'offline',
  p_order_type TEXT DEFAULT 'pos_sale',
  p_delivery_charge NUMERIC DEFAULT 0,
  p_discount_amount NUMERIC DEFAULT 0,
  p_manual_discount_amount NUMERIC DEFAULT 0,
  p_manual_discount_type TEXT DEFAULT 'flat',
  p_manual_discount_value NUMERIC DEFAULT 0,
  p_coupon_code TEXT DEFAULT NULL,
  p_coupon_percentage NUMERIC DEFAULT 0,
  p_payment_method TEXT DEFAULT 'cash',
  p_split_details JSONB DEFAULT '{}'::JSONB,
  p_total_gst NUMERIC DEFAULT 0,
  p_gst_enabled BOOLEAN DEFAULT FALSE,
  p_remarks TEXT DEFAULT '',
  p_reference_number TEXT DEFAULT '',
  p_billing_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_invoice_no TEXT;
  v_order_id UUID;
  v_subtotal NUMERIC := 0;
  v_total NUMERIC := 0;
  v_item JSONB;
  v_product_id BIGINT;
  v_variant_id UUID;
  v_quantity NUMERIC;
  v_unit_price NUMERIC;
  v_line_total NUMERIC;
  v_product_name TEXT;
  v_name_ta TEXT;
  v_unit TEXT;
  v_unit_type TEXT;
  v_base_quantity NUMERIC;
  v_is_manual BOOLEAN;
  v_discount NUMERIC;
  v_gst_amount NUMERIC;
  v_gst_rate NUMERIC;
  v_image_url TEXT;
  v_variant_name TEXT;
  v_source TEXT;
  v_note TEXT;
  v_category TEXT;
  v_current_stock NUMERIC;
  v_barcode_id UUID;
  v_created_at TIMESTAMPTZ := COALESCE(p_billing_date, NOW());
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order items cannot be empty';
  END IF;

  -- 1. Atomic Pre-Validation of Available Stock for All Items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := NULLIF(v_item ->> 'product_id', '')::BIGINT;
    v_variant_id := NULLIF(v_item ->> 'variant_id', '')::UUID;
    v_quantity := COALESCE((v_item ->> 'quantity')::NUMERIC, 0);
    v_is_manual := COALESCE((v_item ->> 'is_manual')::BOOLEAN, FALSE);
    v_product_name := COALESCE(v_item ->> 'product_name', v_item ->> 'name', 'Product');

    IF NOT v_is_manual AND v_quantity > 0 THEN
      IF v_variant_id IS NOT NULL THEN
        SELECT stock INTO v_current_stock FROM public.product_variants WHERE id = v_variant_id FOR UPDATE;
        IF v_current_stock IS NULL OR v_current_stock < v_quantity THEN
          RAISE EXCEPTION 'Insufficient stock for % (Available: %, Requested: %)', v_product_name, COALESCE(v_current_stock, 0), v_quantity;
        END IF;
      ELSIF v_product_id IS NOT NULL THEN
        SELECT stock_quantity INTO v_current_stock FROM public.products WHERE id = v_product_id FOR UPDATE;
        IF v_current_stock IS NULL OR v_current_stock < v_quantity THEN
          RAISE EXCEPTION 'Insufficient stock for % (Available: %, Requested: %)', v_product_name, COALESCE(v_current_stock, 0), v_quantity;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- 2. Calculate Subtotal & Generate Invoice Number
  v_invoice_no := public.get_next_invoice_no();

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_quantity := COALESCE((v_item ->> 'quantity')::NUMERIC, 0);
    v_unit_price := COALESCE(
      (v_item ->> 'unit_price')::NUMERIC,
      (v_item ->> 'base_price')::NUMERIC,
      (v_item ->> 'price')::NUMERIC,
      0
    );
    v_line_total := COALESCE((v_item ->> 'line_total')::NUMERIC, ROUND(v_quantity * v_unit_price, 2));
    v_subtotal := v_subtotal + v_line_total;
  END LOOP;

  v_total := GREATEST(0, ROUND(v_subtotal + COALESCE(p_shipping, 0) + COALESCE(p_delivery_charge, 0) - COALESCE(p_discount_amount, 0), 2));

  -- 3. Insert Order Record (safely COALESCE remarks and reference_number)
  INSERT INTO public.orders (
    invoice_no, user_id, customer_name, phone, address, items,
    subtotal, shipping, total, status, order_mode, order_type,
    delivery_charge, discount_amount, manual_discount_amount,
    manual_discount_type, manual_discount_value, coupon_code,
    coupon_percentage, total_gst, gst_amount, gst_enabled,
    payment_method, payment_mode, split_details, remarks,
    reference_number, billing_date, created_at, updated_at
  )
  VALUES (
    v_invoice_no, v_user_id, COALESCE(NULLIF(BTRIM(p_customer_name), ''), 'Customer'),
    COALESCE(p_phone, ''), COALESCE(p_address, ''), p_items,
    v_subtotal, COALESCE(p_shipping, 0), v_total, COALESCE(p_status, 'completed'),
    COALESCE(p_order_mode, 'offline'), COALESCE(p_order_type, 'pos_sale'),
    COALESCE(p_delivery_charge, 0), COALESCE(p_discount_amount, 0),
    COALESCE(p_manual_discount_amount, 0), COALESCE(p_manual_discount_type, 'flat'),
    COALESCE(p_manual_discount_value, 0), p_coupon_code,
    COALESCE(p_coupon_percentage, 0), COALESCE(p_total_gst, 0),
    COALESCE(p_total_gst, 0), COALESCE(p_gst_enabled, FALSE),
    COALESCE(p_payment_method, 'cash'), COALESCE(p_payment_method, 'cash'),
    COALESCE(p_split_details, '{}'::JSONB), COALESCE(p_remarks, ''),
    COALESCE(p_reference_number, ''), p_billing_date, v_created_at, NOW()
  )
  RETURNING id INTO v_order_id;

  -- 4. Insert Order Items, Deduct Stock & Record SALE Movements
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := NULLIF(v_item ->> 'product_id', '')::BIGINT;
    v_variant_id := NULLIF(v_item ->> 'variant_id', '')::UUID;
    v_quantity := COALESCE((v_item ->> 'quantity')::NUMERIC, 0);
    v_unit_price := COALESCE((v_item ->> 'unit_price')::NUMERIC, (v_item ->> 'base_price')::NUMERIC, 0);
    v_line_total := COALESCE((v_item ->> 'line_total')::NUMERIC, ROUND(v_quantity * v_unit_price, 2));
    v_product_name := COALESCE(v_item ->> 'product_name', v_item ->> 'name', 'Product');
    v_name_ta := COALESCE(v_item ->> 'product_tamil_name', v_item ->> 'tamil_name', '');
    v_unit := COALESCE(v_item ->> 'unit', 'piece');
    v_unit_type := COALESCE(v_item ->> 'unit_type', 'unit');
    v_base_quantity := COALESCE((v_item ->> 'base_quantity')::NUMERIC, 1);
    v_is_manual := COALESCE((v_item ->> 'is_manual')::BOOLEAN, FALSE);
    v_discount := COALESCE((v_item ->> 'discount')::NUMERIC, 0);
    v_gst_amount := COALESCE((v_item ->> 'gst_amount')::NUMERIC, 0);
    v_gst_rate := COALESCE((v_item ->> 'gst_rate')::NUMERIC, 0);
    v_image_url := v_item ->> 'image_url';
    v_variant_name := v_item ->> 'variant_name';
    v_source := COALESCE(v_item ->> 'source', 'catalogue');
    v_note := v_item ->> 'note';
    v_category := v_item ->> 'category';

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, product_name, name,
      product_tamil_name, tamil_name, quantity, unit, unit_type,
      base_quantity, base_price, unit_price, line_total, image_url,
      is_manual, discount, gst_amount, gst_rate, variant_name,
      source, note, category, created_at
    )
    VALUES (
      v_order_id, v_product_id, v_variant_id, v_product_name, v_product_name,
      v_name_ta, v_name_ta, v_quantity, v_unit, v_unit_type,
      v_base_quantity, v_unit_price, v_unit_price, v_line_total, v_image_url,
      v_is_manual, v_discount, v_gst_amount, v_gst_rate, v_variant_name,
      v_source, v_note, v_category, v_created_at
    );

    -- Deduct Stock and Insert SALE Movement
    IF NOT v_is_manual AND v_quantity > 0 THEN
      IF v_variant_id IS NOT NULL THEN
        SELECT stock INTO v_current_stock FROM public.product_variants WHERE id = v_variant_id;
        SELECT id INTO v_barcode_id FROM public.barcode_registry WHERE variant_id = v_variant_id AND is_active = TRUE LIMIT 1;

        UPDATE public.product_variants
        SET stock = GREATEST(0, stock - v_quantity), updated_at = NOW()
        WHERE id = v_variant_id;

        -- Parent aggregate update
        UPDATE public.products
        SET stock_quantity = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = v_product_id AND is_active = TRUE),
            stock = FLOOR((SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = v_product_id AND is_active = TRUE))::INTEGER,
            updated_at = NOW()
        WHERE id = v_product_id;

        INSERT INTO public.inventory_movements (
          product_id, variant_id, barcode_id, movement_type,
          quantity_delta, quantity_before, quantity_after,
          reference_type, reference_id, note
        )
        VALUES (
          v_product_id, v_variant_id, v_barcode_id, 'SALE',
          -v_quantity, v_current_stock, GREATEST(0, v_current_stock - v_quantity),
          'order', v_invoice_no, 'POS Sale checkout'
        );

      ELSIF v_product_id IS NOT NULL THEN
        SELECT stock_quantity INTO v_current_stock FROM public.products WHERE id = v_product_id;
        SELECT id INTO v_barcode_id FROM public.barcode_registry WHERE product_id = v_product_id AND variant_id IS NULL AND is_active = TRUE LIMIT 1;

        UPDATE public.products
        SET stock_quantity = GREATEST(0, stock_quantity - v_quantity),
            stock = GREATEST(0, stock - FLOOR(v_quantity)::INTEGER),
            updated_at = NOW()
        WHERE id = v_product_id;

        INSERT INTO public.inventory_movements (
          product_id, variant_id, barcode_id, movement_type,
          quantity_delta, quantity_before, quantity_after,
          reference_type, reference_id, note
        )
        VALUES (
          v_product_id, NULL, v_barcode_id, 'SALE',
          -v_quantity, v_current_stock, GREATEST(0, v_current_stock - v_quantity),
          'order', v_invoice_no, 'POS Sale checkout'
        );
      END IF;
    END IF;
  END LOOP;

  -- 5. Increment Coupon Usage Count
  IF p_coupon_code IS NOT NULL AND BTRIM(p_coupon_code) <> '' THEN
    UPDATE public.coupons
    SET usage_count = usage_count + 1, updated_at = NOW()
    WHERE UPPER(BTRIM(code)) = UPPER(BTRIM(p_coupon_code));
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'invoice_no', v_invoice_no,
    'total', v_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_pos_sale_with_inventory(
  TEXT, TEXT, TEXT, JSONB, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, JSONB, NUMERIC, BOOLEAN, TEXT, TEXT, TIMESTAMPTZ
) TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
