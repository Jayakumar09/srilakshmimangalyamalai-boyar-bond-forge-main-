BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- Run separately AFTER the T3 connection has rolled back/disconnected. TEST ONLY.
-- Snapshot limitations: rows created after this query's snapshot are not visible.
WITH requests AS (
  SELECT id,storage_key FROM public.storage_deletion_requests
  WHERE owner_id='e17a398c-41c8-4cce-8b8e-6e830f5ac913'::uuid
     OR requested_by='e17a398c-41c8-4cce-8b8e-6e830f5ac913'::uuid
     OR split_part(storage_key,'/',1)='e17a398c-41c8-4cce-8b8e-6e830f5ac913'
), fences AS (
  SELECT storage_key FROM public.storage_deletion_fences
  WHERE split_part(storage_key,'/',1)='e17a398c-41c8-4cce-8b8e-6e830f5ac913'
)
SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM requests) AND NOT EXISTS(SELECT 1 FROM fences)
  THEN 'PASS' ELSE 'FAIL' END AS residue_verdict,
  (SELECT count(*) FROM requests) AS synthetic_requests,
  (SELECT count(*) FROM fences) AS synthetic_fences,
  (SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM requests AS r) AS request_residue,
  (SELECT coalesce(jsonb_agg(to_jsonb(f)),'[]'::jsonb) FROM fences AS f) AS fence_residue;
ROLLBACK;
