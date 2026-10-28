-- ============================================================
-- Migration 0034: invoice numbering restarts at 1 after the data is cleared
-- Date: 2026-10-28
-- get_next_invoice_no() hands out 00000001, 00000002, ... from public.invoice_sequence. The
-- sequence lives outside the orders table, so deleting every order left it counting on from the
-- old number. Now, when no invoice exists any more (no orders and no completed advance order),
-- the sequence is set back to 1 before the next number is issued. As soon as one invoice exists
-- the numbering continues normally, and a number that is already used is still skipped.
-- Safe to re-run.
-- ============================================================

BEGIN;

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
  -- one invoice number is issued at a time, so two bills can never both see "no invoices yet"
  PERFORM pg_advisory_xact_lock(hashtext('naayan_invoice_no'));

  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE invoice_no IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM public.advance_orders WHERE invoice_number IS NOT NULL) THEN
    PERFORM setval('public.invoice_sequence', 1, false);
  END IF;

  LOOP
    v_no := LPAD(nextval('public.invoice_sequence')::TEXT, 8, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.orders WHERE invoice_no = v_no)
          AND NOT EXISTS (SELECT 1 FROM public.advance_orders WHERE invoice_number = v_no);
  END LOOP;
  RETURN v_no;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
