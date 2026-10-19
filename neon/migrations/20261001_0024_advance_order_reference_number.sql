BEGIN;

ALTER TABLE public.advance_orders
  ADD COLUMN IF NOT EXISTS reference_number text NOT NULL DEFAULT '';

NOTIFY pgrst, 'reload schema';

COMMIT;



