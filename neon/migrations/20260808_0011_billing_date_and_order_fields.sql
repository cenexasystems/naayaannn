-- ============================================================
-- Migration 0011: Add billing_date and ensure order metadata columns exist
-- Date: 2026-08-08
-- Purpose:
--   1. Add optional billing_date column to orders table so admins
--      can backdate or set a custom billing date/time per sale.
--   2. Ensure remarks and reference_number columns exist (they were
--      added via the dashboard and used in existing client code).
-- ============================================================

BEGIN;

-- Ensure remarks column exists (used by Pos.tsx update call)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS remarks TEXT NOT NULL DEFAULT '';

-- Ensure reference_number column exists (used by Pos.tsx update call)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS reference_number TEXT NOT NULL DEFAULT '';

-- Add optional billing_date column.
-- When NULL the UI falls back to created_at for display.
-- When set, it represents the admin-chosen billing date/time.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS billing_date TIMESTAMPTZ;

-- Index for fast lookup by billing_date in analytics
CREATE INDEX IF NOT EXISTS idx_orders_billing_date ON public.orders(billing_date);

-- Reload PostgREST schema cache so the new column is immediately accessible
NOTIFY pgrst, 'reload schema';

COMMIT;
