-- Remove ONLY the exact selectable Sub-caste option "Manu boyar".
-- "Mannu boyar" and every other lookup value are preserved. Existing saved
-- profiles that already stored "Mannu boyar" keep their value untouched (no
-- profile data is modified). Idempotent and safe to re-run.
DELETE FROM public.lookup_options
WHERE category = 'sub_caste'
  AND lower(btrim(value_en)) = 'manu boyar';