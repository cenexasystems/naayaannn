-- Fix for products unique constraint
DROP INDEX IF EXISTS public.products_category_name_unique;
CREATE UNIQUE INDEX products_category_name_unique
  ON public.products (category_id, LOWER(BTRIM(name)))
  WHERE is_active = true;

-- Fix for variants unique constraint  
DROP INDEX IF EXISTS public.product_variants_product_name_unique;
CREATE UNIQUE INDEX product_variants_product_name_unique
  ON public.product_variants (product_id, LOWER(BTRIM(variant_name)))
  WHERE is_active = true;
