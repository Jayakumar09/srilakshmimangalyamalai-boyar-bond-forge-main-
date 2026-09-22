-- "Other" is a UI-only action in dynamic dropdowns (LookupSelect includeOther);
-- it is never a legitimate lookup_option row. Remove any stale persisted
-- "Other" rows from the dynamic lookup categories. Legitimate lookup values and
-- profile data are untouched. Idempotent and safe to re-run.
DELETE FROM public.lookup_options
WHERE lower(btrim(value_en)) = 'other'
  AND category IN ('sub_caste','gothram','mother_tongue','native_district','profession','occupation','job_details');