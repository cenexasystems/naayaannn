-- Migration: 20260921_0021_reassign_deleted_category_to_general.sql
-- Description: Automatically reassign products to 'General' category when any category is deleted.

BEGIN;

-- 1. Ensure 'General' category exists
INSERT INTO public.categories (name_en, name_ta, is_active, sort_order)
VALUES ('General', 'பொதுவானது', TRUE, 0)
ON CONFLICT (name_en) DO NOTHING;

-- 2. Trigger function to reassign products to 'General' upon category deletion
CREATE OR REPLACE FUNCTION public.reassign_deleted_category_products()
RETURNS TRIGGER AS $$
DECLARE
  v_general_id BIGINT;
BEGIN
  -- Find or fallback General category ID
  SELECT id INTO v_general_id 
  FROM public.categories 
  WHERE LOWER(name_en) = 'general' 
  LIMIT 1;

  -- Update all products referencing the deleted category by ID or name
  UPDATE public.products
  SET category = 'General',
      category_id = v_general_id
  WHERE category_id = OLD.id 
     OR LOWER(category) = LOWER(OLD.name_en);

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- 3. Attach BEFORE DELETE trigger to categories table
DROP TRIGGER IF EXISTS trg_reassign_deleted_category_products ON public.categories;
CREATE TRIGGER trg_reassign_deleted_category_products
BEFORE DELETE ON public.categories
FOR EACH ROW
EXECUTE FUNCTION public.reassign_deleted_category_products();

-- 4. Immediate cleanup: Fix any currently orphaned products whose category was already deleted (e.g. 'Tailoring')
UPDATE public.products
SET category = 'General',
    category_id = (SELECT id FROM public.categories WHERE LOWER(name_en) = 'general' LIMIT 1)
WHERE category_id IS NULL 
   OR category NOT IN (SELECT name_en FROM public.categories);

COMMIT;
