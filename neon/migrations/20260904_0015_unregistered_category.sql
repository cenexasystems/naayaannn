-- ============================================================================
-- Migration: 20260904_0015_unregistered_category.sql
-- Description: Seed system category 'Unregistered' for ad-hoc POS non-inventory billing
-- ============================================================================

DO $$
BEGIN
  -- Insert into categories if not present
  IF NOT EXISTS (
    SELECT 1 FROM public.categories 
    WHERE LOWER(name_en) = 'unregistered'
  ) THEN
    INSERT INTO public.categories (name_en, name_ta, is_active, sort_order)
    VALUES ('Unregistered', 'பதிவுசெய்யப்படாதது', TRUE, 999);
  END IF;
END $$;
