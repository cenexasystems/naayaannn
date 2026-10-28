-- ============================================================
-- Migration 0035: remove product offer prices
-- Date: 2026-10-28
-- Product special offers were removed from the app. Clear any saved offer so nothing
-- lingers in the database or in exports.
-- ============================================================
UPDATE public.products SET offer_price = NULL WHERE offer_price IS NOT NULL;
