-- Caste column for profiles.
-- Prefixed to the Create Profile for Client form; kept separate from
-- sub_caste (finer division) and gothram (lineage). The Boyar community is
-- the only expected value today, but the column is free text so future
-- options do not require a schema change. Existing RLS policies already
-- cover the table, so no policy/grants changes are required.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS caste text;

COMMENT ON COLUMN public.profiles.caste IS
  'Community/caste (e.g. Boyar). Separate from sub_caste and gothram.';