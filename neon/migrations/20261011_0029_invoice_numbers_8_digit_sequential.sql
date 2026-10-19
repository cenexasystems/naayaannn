-- ============================================================
-- Migration 0029: Sequential invoice numbers starting from 1, in the 8-digit zero-padded format
-- Date: 2026-10-11
-- Replaces the 3-digit format of migration 0028 (001, 002) with the original look:
--   00000001, 00000002, ... (displayed as INV00000001).
-- The counter starts at 1. A number that is already used by an older invoice is skipped, so a
-- unique-invoice conflict can never happen (on a database with no clashing invoices you get
-- exactly 00000001, 00000002, 00000003 ...).
-- Invoices created with the 3-digit format are renumbered. Safe to re-run.
-- ============================================================

BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.invoice_sequence START WITH 1 MINVALUE 1;
GRANT USAGE, SELECT ON SEQUENCE public.invoice_sequence TO public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_next_invoice_no()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
VOLATILE
AS $$
DECLARE
  v_no text;
BEGIN
  LOOP
    v_no := LPAD(nextval('public.invoice_sequence')::TEXT, 8, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.orders WHERE invoice_no = v_no)
          AND NOT EXISTS (SELECT 1 FROM public.advance_orders WHERE invoice_number = v_no);
  END LOOP;
  RETURN v_no;
END;
$$;

DO $$
DECLARE
  r     record;
  v_new text;
BEGIN
  -- Start counting from 1
  PERFORM setval('public.invoice_sequence', 1, false);

  -- Renumber invoices created in the 3-digit format of migration 0028 (001, 002, ...)
  FOR r IN
    SELECT id, invoice_no FROM public.orders
    WHERE invoice_no ~ '^\d{1,7}$'
    ORDER BY created_at, id
  LOOP
    v_new := public.get_next_invoice_no();
    UPDATE public.orders SET invoice_no = v_new WHERE id = r.id;
    UPDATE public.advance_orders SET invoice_number = v_new WHERE invoice_number = r.invoice_no;
    UPDATE public.inventory_movements SET reference_id = v_new WHERE reference_type = 'order' AND reference_id = r.invoice_no;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
