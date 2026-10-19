-- Migration: 20260921_0020_rebrand_to_universal_look.sql
-- Rebrand store details to Universal Look, ensure categories and storage buckets

BEGIN;

-- 1. Update or Insert Store Settings (id = 1)
INSERT INTO public.store_settings (id, name, owner_name, phone, email, address, updated_at)
VALUES (
  1,
  'Universal Look',
  '',
  '9159600067',
  'universallook600067@gmail.com',
  '1/46 GNT Road, Sholavaram, Chennai - 600067',
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  name = 'Universal Look',
  owner_name = '',
  phone = '9159600067',
  email = 'universallook600067@gmail.com',
  address = '1/46 GNT Road, Sholavaram, Chennai - 600067',
  updated_at = NOW();

-- 2. Create public 'branding' storage bucket if not exists
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'branding',
  'branding',
  TRUE,
  10485760,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public = TRUE,
  file_size_limit = 10485760;

-- 3. Storage Policies for branding bucket
DROP POLICY IF EXISTS branding_public_read ON storage.objects;
CREATE POLICY branding_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'branding');

DROP POLICY IF EXISTS branding_portal_upload ON storage.objects;
CREATE POLICY branding_portal_upload ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'branding');

DROP POLICY IF EXISTS branding_portal_update ON storage.objects;
CREATE POLICY branding_portal_update ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'branding')
  WITH CHECK (bucket_id = 'branding');

COMMIT;
