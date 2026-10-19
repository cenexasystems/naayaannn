-- Migration: 20260918_0019_robust_public_invoice_lookup.sql
-- Enables get_public_invoice_by_number to seamlessly match invoices regardless of:
-- 1. "INV" prefix (e.g. "INV00000030" or "00000030")
-- 2. "UL-" legacy prefix (e.g. "UL-20260918-000001")
-- 3. Unpadded or stripped leading zeros (e.g. "30" matching "00000030")
-- 4. UUID order ID (e.g. from admin dashboard link)
-- 5. Case insensitivity and whitespace trimming

CREATE OR REPLACE FUNCTION public.get_public_invoice_by_number(p_invoice_no TEXT)
RETURNS SETOF public.orders
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT * FROM public.orders 
  WHERE invoice_no = NULLIF(BTRIM(p_invoice_no), '')
     OR LOWER(invoice_no) = LOWER(NULLIF(BTRIM(p_invoice_no), ''))
     OR invoice_no = REGEXP_REPLACE(BTRIM(p_invoice_no), '^(INV|UL)[-_ ]*', '', 'i')
     OR (
       REGEXP_REPLACE(BTRIM(p_invoice_no), '\D', '', 'g') <> ''
       AND invoice_no = LPAD(REGEXP_REPLACE(BTRIM(p_invoice_no), '\D', '', 'g'), 8, '0')
     )
     OR (
       REGEXP_REPLACE(BTRIM(p_invoice_no), '\D', '', 'g') <> ''
       AND invoice_no = REGEXP_REPLACE(REGEXP_REPLACE(BTRIM(p_invoice_no), '\D', '', 'g'), '^0+', '')
     )
     OR (
       p_invoice_no ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       AND id = p_invoice_no::UUID
     )
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_invoice_by_number(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_invoice_by_number(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
