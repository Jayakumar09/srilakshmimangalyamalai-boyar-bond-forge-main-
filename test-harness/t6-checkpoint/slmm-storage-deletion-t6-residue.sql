BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY;
-- T6 residue check (DRAFT - offline preparation only; NOT executed).
-- READ ONLY. No writes, no DDL. Safe to run at any time.
--
-- Run AFTER both T6 sessions have disconnected. It independently confirms:
--   (1) no committed synthetic T6 rows exist in any of the ten touched
--       relations (for R-cases this must hold by construction; for a future
--       C-group it proves cleanup), and
--   (2) no T6-tagged backend remains, and therefore no T6-advisory lock
--       remains (advisory locks cannot be namespaced, so they are excluded
--       by proving no T6 backend survives).
--
-- Exit is fail-closed: any nonzero condition raises an exception.
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '30s';

DO $residue$
DECLARE
  v_owner  constant uuid := '5d8f1c62-9a37-4e0b-b1f4-7c0e2a6d9f41';
  v_other  constant uuid := '9a4b7e20-6c15-4d38-82fa-1e5b9c07d3aa';
  v_admin  constant uuid := 'c3f7b518-2e64-4a90-b7d5-84f2e6a10c79';
  v_prefix constant text := '5d8f1c62-9a37-4e0b-b1f4-7c0e2a6d9f41/t6/';
  v_hits   jsonb;
  v_backends int;
BEGIN
  SELECT jsonb_build_object(
    'storage_deletion_requests', (SELECT count(*) FROM public.storage_deletion_requests r
       WHERE r.owner_id IN (v_owner,v_other,v_admin) OR r.requested_by IN (v_owner,v_other,v_admin)
          OR r.storage_key LIKE v_prefix || '%'),
    'storage_deletion_fences', (SELECT count(*) FROM public.storage_deletion_fences f WHERE f.storage_key LIKE v_prefix || '%'),
    'documents', (SELECT count(*) FROM public.documents d
       WHERE d.user_id IN (v_owner,v_other,v_admin) OR d.storage_key LIKE v_prefix || '%'),
    'profiles', (SELECT count(*) FROM public.profiles p
       WHERE p.id IN (v_owner,v_other,v_admin) OR p.photo_url LIKE v_prefix || '%'),
    'user_roles', (SELECT count(*) FROM public.user_roles ur WHERE ur.user_id IN (v_owner,v_other,v_admin)),
    'payments', (SELECT count(*) FROM public.payments p
       WHERE p.user_id IN (v_owner,v_other,v_admin) OR p.proof_key LIKE v_prefix || '%'),
    'jathagam_requests', (SELECT count(*) FROM public.jathagam_requests j WHERE j.report_key LIKE v_prefix || '%'),
    'support_threads', (SELECT count(*) FROM public.support_threads st WHERE st.user_id IN (v_owner,v_other,v_admin)),
    'support_messages', (SELECT count(*) FROM public.support_messages m WHERE m.attachment_key LIKE v_prefix || '%'),
    'payment_events', (SELECT count(*) FROM public.payment_events e WHERE e.receipt_key LIKE v_prefix || '%')
  ) INTO v_hits;

  -- Session hygiene: no T6-tagged backend may survive (a surviving backend
  -- could hold row or advisory locks). application_name is set by the runner.
  SELECT count(*) INTO v_backends
    FROM pg_catalog.pg_stat_activity
   WHERE application_name LIKE 'slmm-t6-%'
     AND pid <> pg_backend_pid();

  IF EXISTS (
    SELECT 1 FROM jsonb_each_text(v_hits) AS h(relation, n) WHERE h.n::int > 0
  ) THEN
    RAISE EXCEPTION 'T6 residue detected; synthetic rows remain: %', v_hits::text;
  END IF;

  IF v_backends > 0 THEN
    RAISE EXCEPTION 'T6 session residue detected: % surviving T6 backend(s)', v_backends;
  END IF;

  RAISE NOTICE 'T6 residue check clean (ten relations zero, no T6 backends): %', v_hits::text;
END;
$residue$;

ROLLBACK;
