-- Migration: 20261020_0033_remove_services_attendance.sql
-- Attendance & staff tracking and catalogue "services" were removed from the app.
-- Both tables and products.item_type were empty when this ran. hsn_code stays (GST invoices).

BEGIN;

DROP TABLE IF EXISTS public.attendance;
DROP TABLE IF EXISTS public.staff;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_item_type_check;
ALTER TABLE public.products DROP COLUMN IF EXISTS item_type;

NOTIFY pgrst, 'reload schema';

COMMIT;
