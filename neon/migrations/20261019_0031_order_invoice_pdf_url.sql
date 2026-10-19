-- Migration: 20261019_0031_order_invoice_pdf_url.sql
-- The POS saves the uploaded invoice PDF link on the order (src/pages/Pos.tsx) and the
-- dashboard reads it back, but no earlier migration created the column, so the write
-- was rejected. Additive and non-destructive.

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS invoice_pdf_url TEXT NOT NULL DEFAULT '';

NOTIFY pgrst, 'reload schema';

COMMIT;
