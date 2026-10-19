-- Migration: 20260912_0017_update_store_address.sql
-- Update store address for Universal Look

BEGIN;

UPDATE public.store_settings
SET address = '1/46 GNT Road, Sholavaram, Chennai - 600067',
    updated_at = NOW()
WHERE id = 1;

COMMIT;
