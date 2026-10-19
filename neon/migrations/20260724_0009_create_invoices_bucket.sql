-- Migration: Create invoices storage bucket
-- Creates the 'invoices' bucket and sets up public read access and upload policies

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('invoices', 'invoices', TRUE, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = TRUE, file_size_limit = 10485760, allowed_mime_types = ARRAY['application/pdf'];

DROP POLICY IF EXISTS invoices_public_read ON storage.objects;
CREATE POLICY invoices_public_read ON storage.objects FOR SELECT TO public USING (bucket_id = 'invoices');

DROP POLICY IF EXISTS invoices_portal_upload ON storage.objects;
CREATE POLICY invoices_portal_upload ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'invoices');

DROP POLICY IF EXISTS invoices_portal_update ON storage.objects;
CREATE POLICY invoices_portal_update ON storage.objects FOR UPDATE TO anon, authenticated USING (bucket_id = 'invoices') WITH CHECK (bucket_id = 'invoices');
