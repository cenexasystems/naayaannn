-- Migration: 20261019_0030_shop_settings.sql
-- Shop details editable from Dashboard → Settings, and rebrand to NAAYAN

BEGIN;

ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS name_ta     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tagline     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS owner_phone TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS whatsapp    TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS instagram   TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS logo_data   TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS accent_color TEXT NOT NULL DEFAULT '#3F3F46';

ALTER TABLE public.store_settings
  ALTER COLUMN name    SET DEFAULT 'NAAYAN',
  ALTER COLUMN phone   SET DEFAULT '',
  ALTER COLUMN email   SET DEFAULT '',
  ALTER COLUMN address SET DEFAULT '14/1 West Car Street, Nehru Maidhanam, Chokkalingapuram, Aruppukottai - 626101';

INSERT INTO public.store_settings (id, name, name_ta, owner_name, phone, email, address, updated_at)
VALUES (
  1,
  'NAAYAN',
  'நாயன்',
  'Balaji K',
  '',
  '',
  '14/1 West Car Street, Nehru Maidhanam, Chokkalingapuram, Aruppukottai - 626101',
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  name        = 'NAAYAN',
  name_ta     = 'நாயன்',
  tagline     = '',
  owner_name  = 'Balaji K',
  owner_phone = '',
  phone       = '',
  whatsapp    = '',
  email       = '',
  address     = '14/1 West Car Street, Nehru Maidhanam, Chokkalingapuram, Aruppukottai - 626101',
  instagram   = '',
  logo_data   = '',
  accent_color = '#3F3F46',
  updated_at  = NOW();

NOTIFY pgrst, 'reload schema';

COMMIT;
