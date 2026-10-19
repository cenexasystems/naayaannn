-- Migration: 20261019_0032_services_staff_attendance.sql
-- Services (catalogue items without stock), HSN/SAC codes, extra shop profile fields,
-- and staff attendance. Additive and non-destructive.

BEGIN;

-- Products vs services
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'product',
  ADD COLUMN IF NOT EXISTS hsn_code  TEXT NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_item_type_check') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_item_type_check CHECK (item_type IN ('product', 'service'));
  END IF;
END;
$$;

-- Shop profile
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS city               TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS business_hours     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS catalogue_headline TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS gstin              TEXT NOT NULL DEFAULT '';

UPDATE public.store_settings
   SET city = 'Aruppukottai, Tamil Nadu'
 WHERE id = 1 AND city = '';

-- Staff
CREATE TABLE IF NOT EXISTS public.staff (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL CHECK (btrim(name) <> ''),
  role        TEXT NOT NULL DEFAULT 'staff',
  phone       TEXT NOT NULL DEFAULT '',
  base_salary NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (base_salary >= 0),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One attendance row per staff member per day
CREATE TABLE IF NOT EXISTS public.attendance (
  id              BIGSERIAL PRIMARY KEY,
  staff_id        BIGINT NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('present', 'absent', 'half_day', 'leave')),
  clock_in        TIMESTAMPTZ,
  clock_out       TIMESTAMPTZ,
  note            TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (staff_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS attendance_date_idx ON public.attendance (attendance_date);

NOTIFY pgrst, 'reload schema';

COMMIT;
