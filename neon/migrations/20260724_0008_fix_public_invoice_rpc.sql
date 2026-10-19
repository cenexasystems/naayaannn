-- Migration: Fix missing get_public_invoice_by_number RPC
-- Re-creates the function and forces a schema cache reload to resolve 404 errors on the /invoice page

CREATE OR REPLACE FUNCTION public.get_public_invoice_by_number(p_invoice_no TEXT)
RETURNS SETOF public.orders
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT * FROM public.orders WHERE invoice_no = NULLIF(BTRIM(p_invoice_no), '') LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_invoice_by_number(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_invoice_by_number(TEXT) TO anon, authenticated;

-- Force PostgREST to reload the schema cache
NOTIFY pgrst, 'reload schema';
