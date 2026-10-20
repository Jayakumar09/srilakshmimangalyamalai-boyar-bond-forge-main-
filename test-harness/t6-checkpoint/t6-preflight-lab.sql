-- =============================================================================
-- T6 LOCAL PREFLIGHT  --  READ ONLY, fail-closed. NOT executed in this phase.
-- Run against the disposable cluster only (the runner enforces the port/host);
-- this file independently re-proves the target is the lab and the fixture
-- namespace is empty.
--   psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 15432 -U postgres -d t6lab \
--        -f t6-preflight-lab.sql
-- =============================================================================
BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
  v_owner  constant uuid := '5d8f1c62-9a37-4e0b-b1f4-7c0e2a6d9f41';
  v_other  constant uuid := '9a4b7e20-6c15-4d38-82fa-1e5b9c07d3aa';
  v_admin  constant uuid := 'c3f7b518-2e64-4a90-b7d5-84f2e6a10c79';
  v_prefix constant text := '5d8f1c62-9a37-4e0b-b1f4-7c0e2a6d9f41/t6/';
  v_dd     text := current_setting('data_directory');
  v_rows   int;
  v_t6     int;
  v_trig   int;
BEGIN
  -- 1. Target identity: disposable cluster, isolated port, loopback only.
  IF current_setting('port') <> '15432' THEN
    RAISE EXCEPTION 'preflight: port % is not 15432', current_setting('port');
  END IF;
  IF position('opencode/t6lab' IN replace(v_dd, '\', '/')) = 0 THEN
    RAISE EXCEPTION 'preflight: data_directory % is not the disposable lab', v_dd;
  END IF;
  IF current_database() <> 't6lab' THEN
    RAISE EXCEPTION 'preflight: database % is not t6lab', current_database();
  END IF;
  IF current_setting('listen_addresses') <> '127.0.0.1' THEN
    RAISE EXCEPTION 'preflight: listen_addresses % is not loopback-only', current_setting('listen_addresses');
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'preflight: default isolation is % (T6 requires read committed)', current_setting('transaction_isolation');
  END IF;

  -- 2. Migration fidelity: the 11 lifecycle functions + 6 fence triggers.
  IF to_regprocedure('public.claim_storage_deletion_request(uuid)') IS NULL
     OR to_regprocedure('public.claim_storage_deletion_requests(integer)') IS NULL
     OR to_regprocedure('public.finalize_storage_deletion(uuid,uuid)') IS NULL
     OR to_regprocedure('public.set_r2_confirmed_absent(uuid,uuid)') IS NULL
     OR to_regprocedure('public.block_storage_deletion(uuid,uuid,text)') IS NULL
     OR to_regprocedure('public.request_storage_deletion(text)') IS NULL THEN
    RAISE EXCEPTION 'preflight: lifecycle RPCs are missing (migrations not applied?)';
  END IF;
  SELECT count(*) INTO v_trig FROM pg_catalog.pg_trigger
   WHERE tgname IN ('documents_50_storage_key_fence','payments_50_proof_key_fence',
                    'jathagam_requests_50_report_key_fence','support_messages_50_attachment_key_fence',
                    'profiles_50_photo_url_fence','payment_events_50_receipt_key_fence');
  IF v_trig <> 6 THEN
    RAISE EXCEPTION 'preflight: expected 6 fence triggers, found %', v_trig;
  END IF;

  -- 3. Synthetic namespace purity (no T6 fixture row may pre-exist).
  SELECT count(*) INTO v_rows FROM public.storage_deletion_requests r
   WHERE r.storage_key LIKE v_prefix || '%'
      OR r.owner_id IN (v_owner, v_other, v_admin)
      OR r.requested_by IN (v_owner, v_other, v_admin);
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'preflight: % synthetic T6 row(s) already present', v_rows;
  END IF;

  -- 4. No stray T6 backends from a previous aborted run.
  SELECT count(*) INTO v_t6 FROM pg_catalog.pg_stat_activity
   WHERE application_name LIKE 'slmm-t6-%' AND pid <> pg_backend_pid();
  IF v_t6 > 3 THEN
    RAISE EXCEPTION 'preflight: % T6 backend(s) already connected', v_t6;
  END IF;

  RAISE NOTICE 'T6 preflight clean: port 15432, lab cluster, RC, namespace empty';
END
$preflight$;

ROLLBACK;
