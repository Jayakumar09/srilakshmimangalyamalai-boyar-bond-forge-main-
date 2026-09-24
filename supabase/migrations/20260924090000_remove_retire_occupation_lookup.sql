-- Remove ONLY the duplicate occupation option "retire".
-- The canonical "Retired" option is preserved. Existing profile rows that
-- already stored a father/mother occupation value keep their value untouched
-- (no profile data is modified). Idempotent and safe to re-run.
DELETE FROM public.lookup_options
WHERE category = 'occupation'
  AND value_en = 'retire';