-- ====================================================================
-- Migration 0026: Customer birthdays (birthday offer sender)
-- ====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.customer_birthdays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL,
  birth_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_customer_birthdays_phone UNIQUE (phone)
);

CREATE INDEX IF NOT EXISTS idx_customer_birthdays_birth_date ON public.customer_birthdays(birth_date);

ALTER TABLE public.customer_birthdays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_birthdays_all ON public.customer_birthdays;
CREATE POLICY customer_birthdays_all ON public.customer_birthdays FOR ALL USING (TRUE) WITH CHECK (TRUE);

COMMIT;
