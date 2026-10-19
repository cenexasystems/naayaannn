-- ============================================================
-- Migration 0010: Final audit fixes
-- Date: 2026-07-28
-- Purpose: Fix all remaining production issues found in audit
-- ============================================================

-- 1. Create store_reviews table (used by Home.tsx but never created in any migration)
CREATE TABLE IF NOT EXISTS public.store_reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    text,
  reviewer    text,
  rating      integer CHECK (rating BETWEEN 1 AND 5),
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
DROP FUNCTION IF EXISTS update_advance_order_status(uuid, text, text);
ALTER TABLE public.store_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert reviews" ON public.store_reviews FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can read reviews"  ON public.store_reviews FOR SELECT USING (true);

-- 2. Make completed_order_id FK in advance_orders ON DELETE SET NULL
--    so that deleting an order from the orders table does not require
--    manually clearing advance_orders.completed_order_id first.
--    (Our frontend now also clears it first, but this is the proper DB-level safety net)
ALTER TABLE public.advance_orders
  DROP CONSTRAINT IF EXISTS advance_orders_completed_order_id_fkey;

ALTER TABLE public.advance_orders
  ADD CONSTRAINT advance_orders_completed_order_id_fkey
  FOREIGN KEY (completed_order_id)
  REFERENCES public.orders(id)
  ON DELETE SET NULL;

-- 3. Ensure invoice_no column in advance_orders stores the INV-prefixed number
--    (already works via complete_advance_order_v2, but add index for faster lookup)
CREATE INDEX IF NOT EXISTS idx_advance_orders_invoice_number ON public.advance_orders(invoice_number);
CREATE INDEX IF NOT EXISTS idx_advance_orders_status ON public.advance_orders(status);
CREATE INDEX IF NOT EXISTS idx_advance_orders_created_at ON public.advance_orders(created_at DESC);

-- 4. Ensure orders table has index on invoice_no for fast public invoice lookups
CREATE INDEX IF NOT EXISTS idx_orders_invoice_no ON public.orders(invoice_no);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC);

-- 5. Ensure update_advance_order_status RPC is up to date and handles all statuses
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
      WHEN 'pending_deposit'      THEN 'Status: Pending Deposit'
      WHEN 'waiting_final_payment' THEN 'Status: Waiting for Final Payment'
      WHEN 'ready_for_delivery'   THEN 'Status: Ready to Collect'
      WHEN 'completed'            THEN 'Order Completed'
      WHEN 'cancelled'            THEN 'Order Cancelled'
      ELSE p_status
    END,
    coalesce(p_remarks, ''),
    auth.uid(),
    now()
  );

  RETURN QUERY SELECT * FROM public.advance_orders WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_advance_order_status(uuid, text, text) TO authenticated, anon, public;

-- 6. Ensure add_advance_order_event RPC is robust
CREATE OR REPLACE FUNCTION public.add_advance_order_event(
  p_order_id   uuid,
  p_event_type text,
  p_label      text,
  p_remarks    text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.advance_order_timeline (advance_order_id, event_type, label, remarks, created_by, created_at)
  VALUES (p_order_id, p_event_type, p_label, coalesce(p_remarks,''), auth.uid(), now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_advance_order_event(uuid, text, text, text) TO authenticated, anon, public;

-- 7. Ensure profiles RLS allows staff to update their own profile (avatar etc)
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- 8. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
