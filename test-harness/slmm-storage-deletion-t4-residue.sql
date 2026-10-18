BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- Run ONLY after an approved T4 execution has rolled back/disconnected. TEST ONLY.
-- No cleanup writes: verify the entire isolated namespace, not a previously saved ID count.
WITH request_residue AS (
  SELECT id FROM public.storage_deletion_requests
  WHERE owner_id='b426ac5e-2d91-4c83-99c4-1ddfe9876e32'::uuid
     OR requested_by='b426ac5e-2d91-4c83-99c4-1ddfe9876e32'::uuid
     OR split_part(storage_key,'/',1)='b426ac5e-2d91-4c83-99c4-1ddfe9876e32'
), document_residue AS (
  SELECT id FROM public.documents
  WHERE user_id='b426ac5e-2d91-4c83-99c4-1ddfe9876e32'::uuid
     OR split_part(storage_key,'/',1)='b426ac5e-2d91-4c83-99c4-1ddfe9876e32'
), fence_residue AS (
  SELECT storage_key FROM public.storage_deletion_fences
  WHERE split_part(storage_key,'/',1)='b426ac5e-2d91-4c83-99c4-1ddfe9876e32'
)
SELECT jsonb_build_object(
  'test','T4 residue','read_only',current_setting('transaction_read_only'),
  'synthetic_requests',(SELECT count(*) FROM request_residue),
  'synthetic_documents',(SELECT count(*) FROM document_residue),
  'synthetic_fences',(SELECT count(*) FROM fence_residue),
  'residue_verdict',CASE WHEN NOT EXISTS(SELECT 1 FROM request_residue)
       AND NOT EXISTS(SELECT 1 FROM document_residue) AND NOT EXISTS(SELECT 1 FROM fence_residue)
       THEN 'PASS' ELSE 'FAIL' END
) AS t4_residue;
ROLLBACK;
