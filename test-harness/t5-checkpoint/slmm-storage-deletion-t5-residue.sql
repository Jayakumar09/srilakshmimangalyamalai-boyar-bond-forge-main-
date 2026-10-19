BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- T5 residue check. READ ONLY. No writes, no DDL.
--
-- Run AFTER the live-test script has ROLLBACK-ed. It independently confirms the
-- rollback left no synthetic T5 rows behind in any of the ten touched relations.
-- It is safe to run at any time: it only counts rows that match the synthetic
-- owner/other/admin namespace and never inserts, updates or deletes.
--
-- Exit is fail-closed: any non-zero count raises an exception.
SET LOCAL search_path = pg_catalog, pg_temp;

DO $residue$
DECLARE
  v_owner  constant uuid := 'f3b42871-9f60-4d7a-bd70-7c62f13ab3f0';
  v_other  constant uuid := 'a1c9e6d2-7b34-4f8a-9c01-2d5e7f9a1b34';
  v_admin  constant uuid := 'b2d0f7e3-8c45-4a9b-8d12-3e6f8a0b2c45';
  v_prefix constant text := 'f3b42871-9f60-4d7a-bd70-7c62f13ab3f0/t5/';
  v_hits jsonb;
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
    'payments', (SELECT count(*) FROM public.payments p WHERE p.proof_key LIKE v_prefix || '%'),
    'jathagam_requests', (SELECT count(*) FROM public.jathagam_requests j WHERE j.report_key LIKE v_prefix || '%'),
    'support_threads', (SELECT count(*) FROM public.support_threads st WHERE st.user_id IN (v_owner,v_other,v_admin)),
    'support_messages', (SELECT count(*) FROM public.support_messages m WHERE m.attachment_key LIKE v_prefix || '%'),
    'payment_events', (SELECT count(*) FROM public.payment_events e WHERE e.receipt_key LIKE v_prefix || '%')
  ) INTO v_hits;

  IF EXISTS (
    SELECT 1 FROM jsonb_each_text(v_hits) AS h(relation, n) WHERE h.n::int > 0
  ) THEN
    RAISE EXCEPTION 'T5 residue detected; the rollback left synthetic rows behind: %', v_hits::text;
  END IF;

  RAISE NOTICE 'T5 residue check clean (all ten relations zero): %', v_hits::text;
END;
$residue$;

ROLLBACK;
