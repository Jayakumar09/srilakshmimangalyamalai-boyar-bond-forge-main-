-- =============================================================================
-- T6 LOCAL RESIDUE CHECK  --  READ ONLY, fail-closed. NOT executed in this phase.
-- Run AFTER the concurrent test sessions have disconnected, while the runner's
-- observer/setup helper connections may still be open.
--   psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 15432 -U postgres -d t6lab \
--        -f t6-lab-residue.sql
-- Nonzero condition => RAISE => psql exit 3 => the runner treats the run as failed.
-- =============================================================================
BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '30s';

DO $residue$
DECLARE
  v_owner  constant uuid := '5d8f1c62-9a37-4e0b-b1f4-7c0e2a6d9f41';
  v_other  constant uuid := '9a4b7e20-6c15-4d38-82fa-1e5b9c07d3aa';
  v_admin  constant uuid := 'c3f7b518-2e64-4a90-b7d5-84f2e6a10c79';
  v_prefix constant text := '5d8f1c62-9a37-4e0b-b1f4-7c0e2a6d9f41/t6/';
  v_hits   jsonb;
  v_sessions int;
  v_locks  int;
BEGIN
  -- (1) No committed synthetic row may remain in any of the ten touched relations.
  SELECT jsonb_build_object(
    'storage_deletion_requests', (SELECT count(*) FROM public.storage_deletion_requests r
       WHERE r.owner_id IN (v_owner,v_other,v_admin) OR r.requested_by IN (v_owner,v_other,v_admin)
          OR r.storage_key LIKE v_prefix || '%'),
    'storage_deletion_fences', (SELECT count(*) FROM public.storage_deletion_fences f
       WHERE f.storage_key LIKE v_prefix || '%'),
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

  IF EXISTS (SELECT 1 FROM jsonb_each_text(v_hits) AS h(relation, n) WHERE h.n::int > 0) THEN
    RAISE EXCEPTION 'T6 residue detected; synthetic rows remain: %', v_hits::text;
  END IF;

  -- (2) No concurrent test session may survive (a/b are the only concurrency
  --     sessions; the observer/setup helpers are expected to still be open).
  SELECT count(*) INTO v_sessions FROM pg_catalog.pg_stat_activity
   WHERE application_name IN ('slmm-t6-a','slmm-t6-b') AND pid <> pg_backend_pid();
  IF v_sessions > 0 THEN
    RAISE EXCEPTION 'T6 session residue detected: % surviving concurrent session(s)', v_sessions;
  END IF;

  -- (3) No advisory lock may remain attributable to a T6 backend. Advisory locks
  --     cannot be namespaced, so this is excluded by proving none is held.
  SELECT count(*) INTO v_locks
    FROM pg_catalog.pg_locks l
    JOIN pg_catalog.pg_stat_activity s ON s.pid = l.pid
   WHERE l.locktype = 'advisory' AND l.granted
     AND s.application_name LIKE 'slmm-t6-%' AND s.pid <> pg_backend_pid();
  IF v_locks > 0 THEN
    RAISE EXCEPTION 'T6 advisory-lock residue detected: % lock(s) still held', v_locks;
  END IF;

  RAISE NOTICE 'T6 residue clean (ten relations zero, no a/b sessions, no T6 advisory locks): %', v_hits::text;
END
$residue$;

ROLLBACK;
