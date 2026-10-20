-- =============================================================================
-- T6 LOCAL LAB BOOTSTRAP  --  runs ONLY on the disposable cluster.
-- NOT executed in this phase. Invoked by t6-runner.ps1 as:
--   psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 15432 -U postgres -d t6lab \
--        -v repo="<repo root>" -v lab="<lab root>" -f t6-lab-setup.sql
--
-- Loads, verbatim and in order:
--   test-harness/t5-checkpoint/lab/lab-schema.sql   (throwaway lab schema)
--   supabase/migrations/20261017120000_document_storage_reference_state.sql
--   supabase/migrations/20261017130000_storage_reference_state.sql
--   supabase/migrations/20261017140000_storage_deletion_lifecycle.sql
--   supabase/migrations/20261017150000_storage_deletion_fence.sql
-- The repository files are only read; nothing is created or modified in the repo.
-- =============================================================================
SET search_path = pg_catalog, pg_temp;

-- Hard guard: refuse to bootstrap anything that is not the disposable lab.
DO $guard$
DECLARE
  v_dd text := current_setting('data_directory');
BEGIN
  IF current_setting('port') <> '15432' THEN
    RAISE EXCEPTION 'T6 bootstrap refused: server port % is not 15432', current_setting('port');
  END IF;
  IF position('opencode/t6lab' IN replace(v_dd, '\', '/')) = 0 THEN
    RAISE EXCEPTION 'T6 bootstrap refused: data_directory % is not under opencode/t6lab', v_dd;
  END IF;
  IF current_database() <> 't6lab' THEN
    RAISE EXCEPTION 'T6 bootstrap refused: database % is not t6lab', current_database();
  END IF;
  IF to_regclass('public.storage_deletion_requests') IS NOT NULL THEN
    RAISE EXCEPTION 'T6 bootstrap refused: lab schema already present (cluster was not freshly initdb-ed)';
  END IF;
END
$guard$;

\echo 'T6 bootstrap: loading lab-schema.sql'
\i :repo/test-harness/t5-checkpoint/lab/lab-schema.sql
\echo 'T6 bootstrap: applying 20261017120000_document_storage_reference_state.sql'
\i :repo/supabase/migrations/20261017120000_document_storage_reference_state.sql
\echo 'T6 bootstrap: applying 20261017130000_storage_reference_state.sql'
\i :repo/supabase/migrations/20261017130000_storage_reference_state.sql
\echo 'T6 bootstrap: applying 20261017140000_storage_deletion_lifecycle.sql'
\i :repo/supabase/migrations/20261017140000_storage_deletion_lifecycle.sql
\echo 'T6 bootstrap: applying 20261017150000_storage_deletion_fence.sql'
\i :repo/supabase/migrations/20261017150000_storage_deletion_fence.sql

-- Post-conditions: the objects the T6 cases depend on must exist exactly once.
DO $post$
DECLARE
  v_fns text[] := ARRAY[
    'public.request_storage_deletion(text)',
    'public.get_storage_reference_state(text)',
    'public.get_document_storage_reference_state(text)',
    'public.claim_storage_deletion_request(uuid)',
    'public.claim_storage_deletion_requests(integer)',
    'public.block_storage_deletion(uuid,uuid,text)',
    'public.record_storage_deletion_failure(uuid,uuid,text,integer)',
    'public.set_r2_confirmed_absent(uuid,uuid)',
    'public.finalize_storage_deletion(uuid,uuid)',
    'public.mark_storage_deletion_quota_resynced(uuid)',
    'public.list_storage_deletion_quota_resyncs(integer)',
    'public.cancel_storage_deletion(uuid)'
  ];
  v_fn text;
  v_missing text[] := '{}';
  v_triggers int;
BEGIN
  FOREACH v_fn IN ARRAY v_fns LOOP
    IF to_regprocedure(v_fn) IS NULL THEN v_missing := v_missing || v_fn; END IF;
  END LOOP;
  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'T6 bootstrap incomplete: missing function(s) %', array_to_string(v_missing, ', ');
  END IF;
  IF to_regclass('public.storage_deletion_fences') IS NULL THEN
    RAISE EXCEPTION 'T6 bootstrap incomplete: public.storage_deletion_fences is missing';
  END IF;
  SELECT count(*) INTO v_triggers
    FROM pg_catalog.pg_trigger
   WHERE tgname IN ('documents_50_storage_key_fence','payments_50_proof_key_fence',
                    'jathagam_requests_50_report_key_fence','support_messages_50_attachment_key_fence',
                    'profiles_50_photo_url_fence','payment_events_50_receipt_key_fence');
  IF v_triggers <> 6 THEN
    RAISE EXCEPTION 'T6 bootstrap incomplete: expected 6 fence triggers, found %', v_triggers;
  END IF;
  RAISE NOTICE 'T6 bootstrap complete: 12 functions, 6 fence triggers, fence table present';
END
$post$;
