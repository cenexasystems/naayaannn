-- Neon runtime objects used by the server API (server/*). Runs after supabase/migrations.
-- Idempotent and non-destructive.

BEGIN;

-- File storage (replaces Supabase Storage buckets: product-images, invoices, avatars, branding)
CREATE TABLE IF NOT EXISTS public.storage_files (
  bucket TEXT NOT NULL,
  path TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bucket, path)
);

-- Change counters polled by the app (replaces Supabase Realtime postgres_changes)
CREATE TABLE IF NOT EXISTS public.table_versions (
  table_name TEXT PRIMARY KEY,
  version BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.bump_table_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.table_versions (table_name, version, updated_at)
  VALUES (TG_TABLE_NAME, 1, NOW())
  ON CONFLICT (table_name) DO UPDATE
    SET version = public.table_versions.version + 1, updated_at = NOW();
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['products', 'product_variants', 'orders', 'order_items', 'expenses', 'coupons'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS bump_table_version ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER bump_table_version AFTER INSERT OR UPDATE OR DELETE ON public.%I '
        'FOR EACH STATEMENT EXECUTE FUNCTION public.bump_table_version()', t);
      INSERT INTO public.table_versions (table_name) VALUES (t) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

COMMIT;
