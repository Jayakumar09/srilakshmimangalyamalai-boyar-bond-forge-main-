BEGIN ISOLATION LEVEL REPEATABLE READ;
-- T5 live-database harness for the storage-deletion lifecycle (Finding 4) and the
-- per-key deletion fence (Finding 5). ROLLBACK ONLY.
--
--   * TEST ONLY (project nqadtfqyurkpmxcodswc). PRODUCTION IS FORBIDDEN.
--   * Execute the COMPLETE file on ONE dedicated postgres session; never
--     statement-by-statement. Stop on any SQL error.
--   * The operator MUST independently verify the connection targets TEST and then
--     set the custom session parameter before running:
--         SET slmm.t5.target_project = 'nqadtfqyurkpmxcodswc';
--     A custom parameter is an operator acknowledgement, NOT server identity; the
--     in-file installed-function fingerprint is the real pre-execution guard.
--   * No external storage calls. `confirmed_absent` is a SYNTHETIC state-machine
--     fixture only. R2 absence/deletion is NOT tested and NOT claimed.
--   * No DDL against shared objects, no fault injection into shared tables.
--     D7 (existence-check abort) is therefore recorded BLOCKED, not simulated.
--   * Every change is rolled back. A separate READ ONLY residue script verifies
--     the rollback left nothing behind.
--
-- Group A creation/cooldown | B claims | C block/fail/confirm | D finalization
-- E fence interactions       | F quota/listing/cancel/recreation
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '90s';
SET LOCAL idle_in_transaction_session_timeout = '120s';
SET LOCAL search_path = pg_catalog, pg_temp;

CREATE TEMP TABLE t5_meta (
  owner_id uuid PRIMARY KEY,
  other_id uuid NOT NULL,
  admin_id uuid NOT NULL,
  wrong_token uuid NOT NULL,
  missing_request_id uuid NOT NULL,
  missing_document_id uuid NOT NULL,
  guard_checks integer NOT NULL DEFAULT 0
) ON COMMIT DROP;

-- A key may legitimately carry more than one request row (a terminal failed row
-- plus a freshly recreated live row), so storage_key is deliberately NOT unique.
CREATE TEMP TABLE t5_requests (
  label text PRIMARY KEY,
  id uuid UNIQUE NOT NULL,
  storage_key text NOT NULL,
  expected jsonb NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE t5_documents (
  label text PRIMARY KEY,
  id uuid UNIQUE NOT NULL,
  expected jsonb NOT NULL,
  present boolean NOT NULL DEFAULT true
) ON COMMIT DROP;

-- Non-document reference rows (profiles/payments/jathagam/support*/payment_events).
CREATE TEMP TABLE t5_refs (
  label text PRIMARY KEY,
  relation text NOT NULL,
  id uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE t5_fences_created (
  storage_key text PRIMARY KEY,
  expected jsonb NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE t5_claims (
  id uuid PRIMARY KEY,
  lease_token uuid
) ON COMMIT DROP;

CREATE TEMP TABLE t5_plan (
  case_no integer PRIMARY KEY CHECK (case_no BETWEEN 1 AND 49),
  code text UNIQUE NOT NULL,
  grp text NOT NULL,
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('EXECUTABLE','BLOCKED'))
) ON COMMIT DROP;

CREATE TEMP TABLE t5_results (
  case_no integer PRIMARY KEY,
  code text NOT NULL,
  status text NOT NULL,
  passed boolean,
  detail text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE t5_fences_before ON COMMIT DROP AS
SELECT storage_key, to_jsonb(f) AS row_state FROM public.storage_deletion_fences f;

-- ---------------------------------------------------------------------------
-- Installed-function fingerprint. These pins were derived OFFLINE from the
-- committed migration bodies (CRLF-normalized prosrc md5) and were re-confirmed
-- byte-for-byte against a faithful local application of those migrations.
-- A mismatch means the database does not hold the reviewed code: abort.
-- ---------------------------------------------------------------------------
DO $contract$
DECLARE
  v_owner constant uuid := 'f3b42871-9f60-4d7a-bd70-7c62f13ab3f0';
  v_other constant uuid := 'a1c9e6d2-7b34-4f8a-9c01-2d5e7f9a1b34';
  v_admin constant uuid := 'b2d0f7e3-8c45-4a9b-8d12-3e6f8a0b2c45';
  v_pins jsonb;
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres'
     OR current_setting('transaction_isolation') <> 'repeatable read'
     OR current_setting('slmm.t5.target_project', true) IS DISTINCT FROM 'nqadtfqyurkpmxcodswc' THEN
    RAISE EXCEPTION 'T5 requires independently verified TEST postgres session, acknowledgement and REPEATABLE READ';
  END IF;

  SELECT jsonb_build_object(
    'request_storage_deletion(text)',                (SELECT md5(replace(prosrc,chr(13)||chr(10),chr(10))) FROM pg_proc WHERE oid='public.request_storage_deletion(text)'::regprocedure),
    'cancel_storage_deletion(uuid)',                 (SELECT md5(replace(prosrc,chr(13)||chr(10),chr(10))) FROM pg_proc WHERE oid='public.cancel_storage_deletion(uuid)'::regprocedure),
    'record_storage_deletion_failure(uuid,uuid,text,integer)', (SELECT md5(replace(prosrc,chr(13)||chr(10),chr(10))) FROM pg_proc WHERE oid='public.record_storage_deletion_failure(uuid,uuid,text,integer)'::regprocedure),
    'set_r2_confirmed_absent(uuid,uuid)', (SELECT md5(replace(prosrc,chr(13)||chr(10),chr(10))) FROM pg_proc WHERE oid='public.set_r2_confirmed_absent(uuid,uuid)'::regprocedure),
    'finalize_storage_deletion(uuid,uuid)', (SELECT md5(replace(prosrc,chr(13)||chr(10),chr(10))) FROM pg_proc WHERE oid='public.finalize_storage_deletion(uuid,uuid)'::regprocedure),
    'mark_storage_deletion_quota_resynced(uuid)', (SELECT md5(replace(prosrc,chr(13)||chr(10),chr(10))) FROM pg_proc WHERE oid='public.mark_storage_deletion_quota_resynced(uuid)'::regprocedure),
    'list_storage_deletion_quota_resyncs(integer)', (SELECT md5(replace(prosrc,chr(13)||chr(10),chr(10))) FROM pg_proc WHERE oid='public.list_storage_deletion_quota_resyncs(integer)'::regprocedure),
    'block_storage_deletion(uuid,uuid,text)', (SELECT md5(replace(prosrc,chr(13)||chr(10),chr(10))) FROM pg_proc WHERE oid='public.block_storage_deletion(uuid,uuid,text)'::regprocedure),
    'check_storage_deletion_references(text)', (SELECT md5(replace(prosrc,chr(13)||chr(10),chr(10))) FROM pg_proc WHERE oid='public.check_storage_deletion_references(text)'::regprocedure),
    'claim_storage_deletion_request(uuid)', (SELECT md5(replace(prosrc,chr(13)||chr(10),chr(10))) FROM pg_proc WHERE oid='public.claim_storage_deletion_request(uuid)'::regprocedure),
    'claim_storage_deletion_requests(integer)', (SELECT md5(replace(prosrc,chr(13)||chr(10),chr(10))) FROM pg_proc WHERE oid='public.claim_storage_deletion_requests(integer)'::regprocedure),
    'fence_storage_key_for_deletion(uuid,uuid)', (SELECT md5(replace(prosrc,chr(13)||chr(10),chr(10))) FROM pg_proc WHERE oid='public.fence_storage_key_for_deletion(uuid,uuid)'::regprocedure),
    'enforce_storage_key_fence()', (SELECT md5(replace(prosrc,chr(13)||chr(10),chr(10))) FROM pg_proc WHERE oid='public.enforce_storage_key_fence()'::regprocedure),
    'is_storage_key_fenced(text)', (SELECT md5(replace(prosrc,chr(13)||chr(10),chr(10))) FROM pg_proc WHERE oid='public.is_storage_key_fenced(text)'::regprocedure)
  ) INTO v_pins;
  IF v_pins IS DISTINCT FROM $pins${
    "request_storage_deletion(text)":"901ca9300b271f352a7b363f37e51dcb",
    "cancel_storage_deletion(uuid)":"c2e48b0f107ac242e191c9bdd2386133",
    "record_storage_deletion_failure(uuid,uuid,text,integer)":"12a965130212b9698995b4b9f81036f0",
    "set_r2_confirmed_absent(uuid,uuid)":"5a63fbd22c45a30be3873192ea7ba623",
    "finalize_storage_deletion(uuid,uuid)":"b94615e59b820ca251eecd676da95c82",
    "mark_storage_deletion_quota_resynced(uuid)":"65b6302eb1e8034d2ae78c504525af75",
    "list_storage_deletion_quota_resyncs(integer)":"693ebf9c15509a5c6c859b69b22724a2",
    "block_storage_deletion(uuid,uuid,text)":"c2f7bddfdcaf151b77def518a00f9fb7",
    "check_storage_deletion_references(text)":"cf3285a4bfc7ba3bbf39125f4a3ef923",
    "claim_storage_deletion_request(uuid)":"ca2d313afeab415ee946dbe6937b7d8b",
    "claim_storage_deletion_requests(integer)":"367b363648b8fd457fc37adbfad7ac35",
    "fence_storage_key_for_deletion(uuid,uuid)":"1d0b4fcec0a921b97b0bd85722800564",
    "enforce_storage_key_fence()":"49f49ea6fc593dc3ddb602385d765ee2",
    "is_storage_key_fenced(text)":"210a8e5b4444968bb62b1d4abdde3a38"
  }$pins$::jsonb THEN
    RAISE EXCEPTION 'T5 installed function-body drift; re-review required';
  END IF;

  -- Definer/owner/search_path hardening on every verified function.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('request_storage_deletion','cancel_storage_deletion','check_storage_deletion_references',
                         'claim_storage_deletion_request','claim_storage_deletion_requests','block_storage_deletion',
                         'record_storage_deletion_failure','set_r2_confirmed_absent','finalize_storage_deletion',
                         'mark_storage_deletion_quota_resynced','list_storage_deletion_quota_resyncs',
                         'fence_storage_key_for_deletion','enforce_storage_key_fence','is_storage_key_fenced')
       AND (pg_get_userbyid(p.proowner) <> 'postgres' OR p.prosecdef IS NOT TRUE
            OR NOT (p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp','row_security=off']))
  ) THEN
    RAISE EXCEPTION 'T5 owner/definer/search_path drift; re-review required';
  END IF;

  -- Authorization ACLs: request/cancel authenticated-only; worker RPCs service_role-only.
  IF has_function_privilege('anon','public.request_storage_deletion(text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.request_storage_deletion(text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.cancel_storage_deletion(uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.claim_storage_deletion_request(uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.finalize_storage_deletion(uuid,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.fence_storage_key_for_deletion(uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.claim_storage_deletion_request(uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.claim_storage_deletion_requests(integer)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.block_storage_deletion(uuid,uuid,text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.record_storage_deletion_failure(uuid,uuid,text,integer)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.set_r2_confirmed_absent(uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.finalize_storage_deletion(uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.mark_storage_deletion_quota_resynced(uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.list_storage_deletion_quota_resyncs(integer)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.fence_storage_key_for_deletion(uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.fence_storage_key_for_deletion(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'T5 authorization ACL drift; re-review required';
  END IF;

  -- All six fence triggers present; no document DELETE trigger.
  IF (SELECT count(*) FROM pg_trigger t
       WHERE NOT t.tgisinternal AND t.tgname IN (
         'documents_50_storage_key_fence','payments_50_proof_key_fence','jathagam_requests_50_report_key_fence',
         'support_messages_50_attachment_key_fence','profiles_50_photo_url_fence','payment_events_50_receipt_key_fence')) <> 6
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.documents'::regclass AND (tgtype & 8) <> 0) THEN
    RAISE EXCEPTION 'T5 fence trigger set or document DELETE trigger drift';
  END IF;

  -- Foreign eligible work must be absent before any fixture is created.
  IF EXISTS (
    SELECT 1 FROM public.storage_deletion_requests r
     WHERE r.status IN ('pending','deleting','blocked','finalizing')
       AND (r.lease_expires_at IS NULL OR r.lease_expires_at < now())
       AND (r.status <> 'blocked' OR r.updated_at < now() - interval '1 hour')
  ) THEN
    RAISE EXCEPTION 'T5 pre-fixture global eligible-ID set is not empty';
  END IF;

  -- Synthetic namespace collision check across every touched relation.
  IF EXISTS (SELECT 1 FROM public.storage_deletion_requests r
               WHERE r.owner_id IN (v_owner,v_other,v_admin) OR r.requested_by IN (v_owner,v_other,v_admin)
                  OR split_part(r.storage_key,'/',1) = v_owner::text)
     OR EXISTS (SELECT 1 FROM public.storage_deletion_fences f WHERE split_part(f.storage_key,'/',1) = v_owner::text)
     OR EXISTS (SELECT 1 FROM public.documents d WHERE d.user_id IN (v_owner,v_other,v_admin) OR split_part(d.storage_key,'/',1) = v_owner::text)
     OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id IN (v_owner,v_other,v_admin) OR split_part(coalesce(p.photo_url,''),'/',1) = v_owner::text)
     OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id IN (v_owner,v_other,v_admin))
     OR EXISTS (SELECT 1 FROM public.payments p WHERE split_part(coalesce(p.proof_key,''),'/',1) = v_owner::text)
     OR EXISTS (SELECT 1 FROM public.jathagam_requests j WHERE split_part(coalesce(j.report_key,''),'/',1) = v_owner::text)
     OR EXISTS (SELECT 1 FROM public.support_threads st WHERE st.user_id IN (v_owner,v_other,v_admin))
     OR EXISTS (SELECT 1 FROM public.support_messages m WHERE split_part(coalesce(m.attachment_key,''),'/',1) = v_owner::text)
     OR EXISTS (SELECT 1 FROM public.payment_events e WHERE split_part(coalesce(e.receipt_key,''),'/',1) = v_owner::text) THEN
    RAISE EXCEPTION 'T5 synthetic namespace collision';
  END IF;

  INSERT INTO pg_temp.t5_meta(owner_id, other_id, admin_id, wrong_token, missing_request_id, missing_document_id)
  VALUES (v_owner, v_other, v_admin, gen_random_uuid(), gen_random_uuid(), gen_random_uuid());

  INSERT INTO pg_temp.t5_plan(case_no, code, grp, title, status) VALUES
   ( 1,'A1','A','create request; idempotent live reuse','EXECUTABLE'),
   ( 2,'A2','A','reuse existing live request','EXECUTABLE'),
   ( 3,'A3','A','failed<15m cooldown blocks creation','EXECUTABLE'),
   ( 4,'A4','A','failed>15m allows new request','EXECUTABLE'),
   ( 5,'A5','A','protected reference blocks creation','EXECUTABLE'),
   ( 6,'A6','A','document references not owned by actor block creation','EXECUTABLE'),
   ( 7,'A7','A','creation captures exact document_row_ids snapshot','EXECUTABLE'),
   ( 8,'B1','B','claim pending -> deleting, attempt+1, lease set','EXECUTABLE'),
   ( 9,'B2','B','claim confirmed -> finalizing, attempt unchanged','EXECUTABLE'),
   (10,'B3','B','claim with active lease returns 0, row unchanged','EXECUTABLE'),
   (11,'B4','B','batch limit <= 0 returns 0 rows','EXECUTABLE'),
   (12,'B5','B','batch claims oldest N eligible with shared token','EXECUTABLE'),
   (13,'B6','B','blocked<1h not claimable','EXECUTABLE'),
   (14,'B7','B','blocked>=1h reclaimable','EXECUTABLE'),
   (15,'B8','B','expired lease reclaimable, new token, attempt+1','EXECUTABLE'),
   (16,'C1','C','block clears lease, clips reason, preserves attempts','EXECUTABLE'),
   (17,'C2','C','block replay returns false','EXECUTABLE'),
   (18,'C3','C','block refuses confirmed absence','EXECUTABLE'),
   (19,'C4','C','failure below max -> pending, uncertain, clipped error','EXECUTABLE'),
   (20,'C5','C','failure at/above/zero/negative/NULL max -> failed (clamp)','EXECUTABLE'),
   (21,'C6','C','failure replay returns SQL NULL','EXECUTABLE'),
   (22,'C7','C','failure refuses confirmed absence -> NULL','EXECUTABLE'),
   (23,'C8','C','confirm sets confirmed_absent/finalizing, preserves lease','EXECUTABLE'),
   (24,'C9','C','confirm replay returns true under live lease','EXECUTABLE'),
   (25,'C10','C','expired/stale lease CAS rejects all transitions','EXECUTABLE'),
   (26,'C11','C','NULL token rejects all transitions','EXECUTABLE'),
   (27,'C12','C','wrong token rejects all transitions','EXECUTABLE'),
   (28,'D1','D','finalize before confirmation returns false','EXECUTABLE'),
   (29,'D2','D','confirm+finalize; captured doc deleted; done/deleted','EXECUTABLE'),
   (30,'D3','D','finalize replay returns false','EXECUTABLE'),
   (31,'D4','D','selective: captured deleted; moved/uncaptured/missing handled','EXECUTABLE'),
   (32,'D5','D','stale/wrong token finalize blocked','EXECUTABLE'),
   (33,'D6','D','done row protected from block/fail/confirm/finalize','EXECUTABLE'),
   (34,'D7','D','existence-check abort requires DDL fault injection','BLOCKED'),
   (35,'D8','D','finalize on done returns false','EXECUTABLE'),
   (36,'D9','D','missing captured ids allow finalization','EXECUTABLE'),
   (37,'D10','D','finalize mutates only documents','EXECUTABLE'),
   (38,'E1','E','fence first -> fenced','EXECUTABLE'),
   (39,'E2','E','fence idempotent -> fenced','EXECUTABLE'),
   (40,'E3','E','protected reference blocks fence','EXECUTABLE'),
   (41,'E4','E','uncaptured document blocks fence','EXECUTABLE'),
   (42,'E5','E','expired lease -> not_claimed','EXECUTABLE'),
   (43,'E6','E','BEFORE triggers reject fenced key on all six tables','EXECUTABLE'),
   (44,'F1','F','cancel by requester and by admin','EXECUTABLE'),
   (45,'F2','F','cancel rejects wrong actor / attempts / non-pending','EXECUTABLE'),
   (46,'F3','F','quota resync mark only when deleted and NULL','EXECUTABLE'),
   (47,'F4','F','quota resync list ordered/limited','EXECUTABLE'),
   (48,'F5','F','recreation blocked<15m / allowed>15m; budget reset','EXECUTABLE'),
   (49,'F6','F','complete global eligible-ID guard is exact','EXECUTABLE');
END;
$contract$;

-- ---------------------------------------------------------------------------
-- Helpers.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.t5_jwt(p_role text, p_sub uuid) RETURNS void LANGUAGE plpgsql AS $body$
BEGIN
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_sub::text,''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_sub IS NULL THEN jsonb_build_object('role',p_role)::text
         ELSE jsonb_build_object('role',p_role,'sub',p_sub)::text END, true);
END;
$body$;

CREATE FUNCTION pg_temp.t5_key(p_suffix text) RETURNS text LANGUAGE sql AS $body$
  SELECT (SELECT owner_id::text FROM pg_temp.t5_meta) || '/t5/' || p_suffix;
$body$;

CREATE FUNCTION pg_temp.t5_expect(p_label text, p_patch jsonb) RETURNS void LANGUAGE plpgsql AS $body$
BEGIN
  UPDATE pg_temp.t5_requests SET expected = expected || p_patch WHERE label = p_label;
END;
$body$;

CREATE FUNCTION pg_temp.t5_case(p_case integer, p_code text, p_status text, p_passed boolean, p_detail text)
RETURNS void LANGUAGE plpgsql AS $body$
BEGIN
  INSERT INTO pg_temp.t5_results(case_no, code, status, passed, detail)
  VALUES (p_case, p_code, p_status, p_passed, p_detail)
  ON CONFLICT (case_no) DO UPDATE
    SET code = EXCLUDED.code, status = EXCLUDED.status,
        passed = EXCLUDED.passed, detail = EXCLUDED.detail;
END;
$body$;

CREATE FUNCTION pg_temp.t5_mkreq(
  p_label text, p_status text, p_r2 text, p_fin text, p_attempt integer,
  p_lease text, p_created_age interval, p_updated_age interval,
  p_requested_by uuid, p_finalized_age interval DEFAULT NULL, p_quota boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql AS $body$
DECLARE
  v_owner uuid; v_id uuid; v_key text; v_tok uuid; v_exp timestamptz; v_rec record;
BEGIN
  SELECT owner_id INTO STRICT v_owner FROM pg_temp.t5_meta;
  v_key := v_owner::text || '/t5/' || p_label;
  CASE p_lease
    WHEN 'none'   THEN v_tok := NULL;            v_exp := NULL;
    WHEN 'live'   THEN v_tok := gen_random_uuid(); v_exp := now() + interval '5 minutes';
    WHEN 'expired' THEN v_tok := gen_random_uuid(); v_exp := now() - interval '1 second';
    WHEN 'boundary' THEN v_tok := gen_random_uuid(); v_exp := now();
    ELSE RAISE EXCEPTION 't5_mkreq bad lease %', p_lease;
  END CASE;
  INSERT INTO public.storage_deletion_requests
    (storage_key, owner_id, requested_by, requested_as_admin, status, r2_state, finalize_state,
     attempt_count, document_row_ids, lease_token, lease_expires_at, block_reason, last_error,
     created_at, updated_at, finalized_at, quota_resynced_at)
  VALUES
    (v_key, v_owner, coalesce(p_requested_by, v_owner), false, p_status, p_r2, p_fin,
     p_attempt, '{}', v_tok, v_exp,
     CASE WHEN p_status = 'blocked' THEN 'T5 synthetic block marker' END,
     CASE WHEN p_r2 = 'uncertain' OR p_status = 'failed' THEN 'T5 synthetic error marker' END,
     now() - p_created_age, now() - p_updated_age,
     CASE WHEN p_status = 'deleted' THEN now() - coalesce(p_finalized_age, interval '2 hours') END,
     CASE WHEN p_status = 'deleted' AND p_quota THEN now() - coalesce(p_finalized_age, interval '2 hours') END)
  RETURNING * INTO v_rec;
  INSERT INTO pg_temp.t5_requests(label, id, storage_key, expected)
  VALUES (p_label, v_rec.id, v_rec.storage_key, to_jsonb(v_rec));
  RETURN v_rec.id;
END;
$body$;

CREATE FUNCTION pg_temp.t5_expect_label(p_label text, p_patch jsonb) RETURNS void LANGUAGE sql AS $body$
  UPDATE pg_temp.t5_requests SET expected = expected || p_patch WHERE label = p_label;
$body$;

CREATE FUNCTION pg_temp.t5_mkdoc(p_label text, p_suffix text, p_user uuid) RETURNS uuid LANGUAGE plpgsql AS $body$
DECLARE v_rec record;
BEGIN
  INSERT INTO public.documents (user_id, doc_type, file_name, mime_type, size_bytes, verified, storage_key, created_at)
  VALUES (p_user, 'govt_id', 'T5-'||p_label||'.txt', 'application/octet-stream', 0, false,
          (SELECT owner_id::text FROM pg_temp.t5_meta) || '/t5/' || p_suffix, now())
  RETURNING * INTO v_rec;
  INSERT INTO pg_temp.t5_documents(label, id, expected, present) VALUES (p_label, v_rec.id, to_jsonb(v_rec), true);
  RETURN v_rec.id;
END;
$body$;

CREATE FUNCTION pg_temp.t5_ref(p_label text, p_relation text, p_id uuid) RETURNS uuid LANGUAGE plpgsql AS $body$
BEGIN
  INSERT INTO pg_temp.t5_refs(label, relation, id) VALUES (p_label, p_relation, p_id);
  RETURN p_id;
END;
$body$;

CREATE FUNCTION pg_temp.t5_must_fail(p_sql text, p_code text) RETURNS text LANGUAGE plpgsql AS $body$
DECLARE v_state text; v_msg text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    v_state := '00000';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    IF v_state IN ('40001','40P01','55P03','57014') THEN RAISE; END IF;
  END;
  IF v_state IS DISTINCT FROM p_code THEN
    RAISE EXCEPTION 'T5 expected SQLSTATE % but got %: %', p_code, v_state, v_msg;
  END IF;
  RETURN v_state;
END;
$body$;

-- Like t5_must_fail, but only a storage-fence rejection satisfies it: the
-- SQLSTATE must be 23514 AND the message must be the fence trigger's own
-- rejection text. An unrelated 23514 (for example a table CHECK constraint)
-- must fail closed instead of satisfying the assertion.
CREATE FUNCTION pg_temp.t5_must_fail_fenced(p_sql text) RETURNS text LANGUAGE plpgsql AS $body$
DECLARE v_state text; v_msg text;
  v_expect CONSTANT text := 'Storage key is fenced for deletion.';
BEGIN
  BEGIN
    EXECUTE p_sql;
    v_state := '00000';
    v_msg := NULL;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    IF v_state IN ('40001','40P01','55P03','57014') THEN RAISE; END IF;
  END;
  IF v_state IS DISTINCT FROM '23514' OR v_msg IS DISTINCT FROM v_expect THEN
    RAISE EXCEPTION 'T5 fence assertion rejected: expected SQLSTATE 23514 fence rejection, got SQLSTATE % (%)',
      v_state, coalesce(v_msg, '<no message>');
  END IF;
  RETURN v_state;
END;
$body$;

CREATE FUNCTION pg_temp.t5_assert_state() RETURNS void LANGUAGE plpgsql AS $body$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_temp.t5_requests f LEFT JOIN public.storage_deletion_requests r ON r.id=f.id
             WHERE f.expected IS DISTINCT FROM to_jsonb(r)) THEN
    RAISE EXCEPTION 'T5 complete request-row state mismatch: %',
      (SELECT jsonb_build_object('label',f.label,'expected',f.expected,'actual',to_jsonb(r))
         FROM pg_temp.t5_requests f LEFT JOIN public.storage_deletion_requests r ON r.id=f.id
        WHERE f.expected IS DISTINCT FROM to_jsonb(r) LIMIT 1)::text;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.t5_documents f LEFT JOIN public.documents d ON d.id=f.id
             WHERE (f.present AND f.expected IS DISTINCT FROM to_jsonb(d)) OR (NOT f.present AND d.id IS NOT NULL)) THEN
    RAISE EXCEPTION 'T5 complete document-row state/presence mismatch: %',
      (SELECT jsonb_build_object('label',f.label,'expected',f.expected,'actual',to_jsonb(d))
         FROM pg_temp.t5_documents f LEFT JOIN public.documents d ON d.id=f.id
        WHERE (f.present AND f.expected IS DISTINCT FROM to_jsonb(d)) OR (NOT f.present AND d.id IS NOT NULL) LIMIT 1)::text;
  END IF;
  -- Namespace: no untracked synthetic request/document/reference rows; no missing tracked rows.
  IF EXISTS (SELECT 1 FROM public.storage_deletion_requests r, pg_temp.t5_meta m
              WHERE (r.owner_id IN (m.owner_id,m.other_id,m.admin_id) OR r.requested_by IN (m.owner_id,m.other_id,m.admin_id)
                     OR split_part(r.storage_key,'/',1)=m.owner_id::text)
                AND NOT EXISTS (SELECT 1 FROM pg_temp.t5_requests f WHERE f.id=r.id))
     OR EXISTS (SELECT 1 FROM pg_temp.t5_requests f LEFT JOIN public.storage_deletion_requests r ON r.id=f.id
                WHERE r.id IS NULL)
     OR EXISTS (SELECT 1 FROM public.documents d, pg_temp.t5_meta m
                WHERE (d.user_id IN (m.owner_id,m.other_id,m.admin_id) OR split_part(d.storage_key,'/',1)=m.owner_id::text)
                  AND NOT EXISTS (SELECT 1 FROM pg_temp.t5_documents f WHERE f.id=d.id))
     OR EXISTS (SELECT 1 FROM pg_temp.t5_refs f
                WHERE (f.relation='profiles'         AND NOT EXISTS (SELECT 1 FROM public.profiles x WHERE x.id=f.id))
                   OR (f.relation='payments'         AND NOT EXISTS (SELECT 1 FROM public.payments x WHERE x.id=f.id))
                   OR (f.relation='jathagam_requests' AND NOT EXISTS (SELECT 1 FROM public.jathagam_requests x WHERE x.id=f.id))
                   OR (f.relation='support_threads'  AND NOT EXISTS (SELECT 1 FROM public.support_threads x WHERE x.id=f.id))
                   OR (f.relation='support_messages' AND NOT EXISTS (SELECT 1 FROM public.support_messages x WHERE x.id=f.id))
                   OR (f.relation='payment_events'   AND NOT EXISTS (SELECT 1 FROM public.payment_events x WHERE x.id=f.id))
                   OR (f.relation='user_roles'       AND NOT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.id=f.id)))
     OR EXISTS (SELECT 1 FROM public.profiles x, pg_temp.t5_meta m
                WHERE split_part(coalesce(x.photo_url,''),'/',1)=m.owner_id::text
                  AND NOT EXISTS (SELECT 1 FROM pg_temp.t5_refs f WHERE f.relation='profiles' AND f.id=x.id))
     OR EXISTS (SELECT 1 FROM public.payments x, pg_temp.t5_meta m
                WHERE split_part(coalesce(x.proof_key,''),'/',1)=m.owner_id::text
                  AND NOT EXISTS (SELECT 1 FROM pg_temp.t5_refs f WHERE f.relation='payments' AND f.id=x.id))
     OR EXISTS (SELECT 1 FROM public.jathagam_requests x, pg_temp.t5_meta m
                WHERE split_part(coalesce(x.report_key,''),'/',1)=m.owner_id::text
                  AND NOT EXISTS (SELECT 1 FROM pg_temp.t5_refs f WHERE f.relation='jathagam_requests' AND f.id=x.id))
     OR EXISTS (SELECT 1 FROM public.support_messages x, pg_temp.t5_meta m
                WHERE split_part(coalesce(x.attachment_key,''),'/',1)=m.owner_id::text
                  AND NOT EXISTS (SELECT 1 FROM pg_temp.t5_refs f WHERE f.relation='support_messages' AND f.id=x.id))
     OR EXISTS (SELECT 1 FROM public.payment_events x, pg_temp.t5_meta m
                WHERE split_part(coalesce(x.receipt_key,''),'/',1)=m.owner_id::text
                  AND NOT EXISTS (SELECT 1 FROM pg_temp.t5_refs f WHERE f.relation='payment_events' AND f.id=x.id))
     OR EXISTS (SELECT 1 FROM public.support_threads x, pg_temp.t5_meta m
                WHERE x.user_id IN (m.owner_id,m.other_id,m.admin_id)
                  AND NOT EXISTS (SELECT 1 FROM pg_temp.t5_refs f WHERE f.relation='support_threads' AND f.id=x.id))
     OR EXISTS (SELECT 1 FROM public.user_roles x, pg_temp.t5_meta m
                WHERE x.user_id IN (m.owner_id,m.other_id,m.admin_id)
                  AND NOT EXISTS (SELECT 1 FROM pg_temp.t5_refs f WHERE f.relation='user_roles' AND f.id=x.id))
     OR EXISTS (SELECT 1 FROM public.storage_deletion_requests r, pg_temp.t5_meta m WHERE r.id=m.missing_request_id)
     OR EXISTS (SELECT 1 FROM public.documents d, pg_temp.t5_meta m WHERE d.id=m.missing_document_id) THEN
    RAISE EXCEPTION 'T5 namespace / untracked-ID collision';
  END IF;
  -- Fence set must equal the pre-existing snapshot plus exactly the fences we created.
  IF EXISTS (SELECT 1 FROM public.storage_deletion_fences f
              WHERE NOT EXISTS (SELECT 1 FROM pg_temp.t5_fences_before b WHERE b.storage_key=f.storage_key)
                AND NOT EXISTS (SELECT 1 FROM pg_temp.t5_fences_created c
                                WHERE c.storage_key=f.storage_key AND c.expected=to_jsonb(f)))
     OR EXISTS (SELECT 1 FROM pg_temp.t5_fences_created c
                WHERE NOT EXISTS (SELECT 1 FROM public.storage_deletion_fences f
                                   WHERE f.storage_key=c.storage_key AND to_jsonb(f)=c.expected))
     OR EXISTS (SELECT 1 FROM pg_temp.t5_fences_before b
                WHERE NOT EXISTS (SELECT 1 FROM public.storage_deletion_fences f
                                  WHERE f.storage_key=b.storage_key AND to_jsonb(f)=b.row_state)) THEN
    RAISE EXCEPTION 'T5 unexpected visible fence difference';
  END IF;
END;
$body$;

CREATE FUNCTION pg_temp.t5_guard() RETURNS void LANGUAGE plpgsql AS $body$
DECLARE v_actual uuid[]; v_expected uuid[];
BEGIN
  IF current_user <> 'postgres' OR current_setting('transaction_isolation') <> 'repeatable read' THEN
    RAISE EXCEPTION 'T5 isolation/caller guard failed';
  END IF;
  PERFORM pg_temp.t5_assert_state();
  SELECT coalesce(array_agg(f.id ORDER BY f.id),'{}'::uuid[]) INTO v_expected
    FROM pg_temp.t5_requests f
   WHERE (f.expected->>'status') IN ('pending','deleting','blocked','finalizing')
     AND ((f.expected->>'lease_expires_at') IS NULL OR (f.expected->>'lease_expires_at')::timestamptz < now())
     AND ((f.expected->>'status') <> 'blocked' OR (f.expected->>'updated_at')::timestamptz < now() - interval '1 hour');
  -- COMPLETE GLOBAL installed eligibility predicate: no owner filter, no limit.
  SELECT coalesce(array_agg(r.id ORDER BY r.id),'{}'::uuid[]) INTO v_actual
    FROM public.storage_deletion_requests r
   WHERE r.status IN ('pending','deleting','blocked','finalizing')
     AND (r.lease_expires_at IS NULL OR r.lease_expires_at < now())
     AND (r.status <> 'blocked' OR r.updated_at < now() - interval '1 hour');
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'T5 exact global eligible-ID mismatch; foreign or unexpected request';
  END IF;
  UPDATE pg_temp.t5_meta SET guard_checks = guard_checks + 1;
END;
$body$;

-- ===========================================================================
-- Group A: creation + cooldown (cases 1-7)
-- ===========================================================================
DO $group_a$
DECLARE
  m record; v_id uuid; v_new uuid; v_key text; v_rec record; v_state text;
  v_p uuid; v_d1 uuid; v_d2 uuid; v_expect uuid[];
BEGIN
  SELECT * INTO STRICT m FROM pg_temp.t5_meta;

  -- A1 create_ok
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_jwt('authenticated', m.owner_id);
  v_key := m.owner_id::text || '/t5/a1';
  v_id := public.request_storage_deletion(v_key);
  SELECT * INTO STRICT v_rec FROM public.storage_deletion_requests WHERE id = v_id;
  IF v_rec.status<>'pending' OR v_rec.attempt_count<>0 OR v_rec.r2_state<>'not_attempted'
     OR v_rec.finalize_state<>'pending' OR v_rec.document_row_ids<>'{}'
     OR v_rec.owner_id<>m.owner_id OR v_rec.requested_by<>m.owner_id THEN
    RAISE EXCEPTION 'T5 A1 unexpected created request state';
  END IF;
  IF (SELECT count(*) FROM public.storage_deletion_requests WHERE storage_key=v_key) <> 1 THEN
    RAISE EXCEPTION 'T5 A1 live-key uniqueness violated';
  END IF;
  INSERT INTO pg_temp.t5_requests(label,id,storage_key,expected) VALUES ('a1',v_rec.id,v_rec.storage_key,to_jsonb(v_rec));
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(1,'A1','EXECUTABLE',true,'created pending request; empty document_row_ids');

  -- A2 reuse_live
  PERFORM pg_temp.t5_guard();
  v_new := pg_temp.t5_mkreq('a2live','pending','not_attempted','pending',0,'none',
                            interval '2 minutes', interval '2 minutes', NULL);
  PERFORM pg_temp.t5_jwt('authenticated', m.owner_id);
  v_id := public.request_storage_deletion(m.owner_id::text || '/t5/a2live');
  IF v_id <> v_new THEN RAISE EXCEPTION 'T5 A2 did not reuse the live request'; END IF;
  IF (SELECT count(*) FROM public.storage_deletion_requests
        WHERE storage_key = m.owner_id::text||'/t5/a2live') <> 1 THEN
    RAISE EXCEPTION 'T5 A2 duplicate live request';
  END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(2,'A2','EXECUTABLE',true,'returned existing live id; row unchanged');

  -- A3 cooldown_block
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('a3','failed','uncertain','pending',3,'none', interval '2 hours', interval '5 minutes', NULL);
  PERFORM pg_temp.t5_jwt('authenticated', m.owner_id);
  v_state := pg_temp.t5_must_fail(format('SELECT public.request_storage_deletion(%L)', m.owner_id::text||'/t5/a3'), '22023');
  IF (SELECT count(*) FROM public.storage_deletion_requests WHERE storage_key=m.owner_id::text||'/t5/a3') <> 1 THEN
    RAISE EXCEPTION 'T5 A3 unexpected new request row during cooldown';
  END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(3,'A3','EXECUTABLE',true,'recent failure cooldown raised 22023; no new row');

  -- A4 cooldown_expired
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('a4old','failed','uncertain','pending',3,'none', interval '2 hours', interval '16 minutes', NULL);
  PERFORM pg_temp.t5_jwt('authenticated', m.owner_id);
  v_new := public.request_storage_deletion(m.owner_id::text||'/t5/a4old');
  SELECT * INTO STRICT v_rec FROM public.storage_deletion_requests WHERE id=v_new;
  IF v_new = v_id OR v_rec.status<>'pending' OR v_rec.attempt_count<>0 THEN
    RAISE EXCEPTION 'T5 A4 expired cooldown did not allow a fresh request';
  END IF;
  INSERT INTO pg_temp.t5_requests(label,id,storage_key,expected) VALUES ('a4new', v_rec.id, v_rec.storage_key, to_jsonb(v_rec));
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(4,'A4','EXECUTABLE',true,'expired failure allowed new request with attempt_count 0');

  -- A5 blocked_protected
  PERFORM pg_temp.t5_guard();
  INSERT INTO public.profiles (id, photo_url)
  VALUES (gen_random_uuid(), m.owner_id::text || '/t5/a5') RETURNING id INTO v_p;
  PERFORM pg_temp.t5_ref('a5','profiles', v_p);
  PERFORM pg_temp.t5_jwt('authenticated', m.owner_id);
  v_state := pg_temp.t5_must_fail(format('SELECT public.request_storage_deletion(%L)', m.owner_id::text||'/t5/a5'), '22023');
  IF (SELECT count(*) FROM public.storage_deletion_requests WHERE storage_key=m.owner_id::text||'/t5/a5') <> 0 THEN
    RAISE EXCEPTION 'T5 A5 unexpected request row for protected key';
  END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(5,'A5','EXECUTABLE',true,'protected reference raised 22023; no request');

  -- A6 blocked_maydelete
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkdoc('a6doc','a6', m.other_id);
  PERFORM pg_temp.t5_jwt('authenticated', m.owner_id);
  v_state := pg_temp.t5_must_fail(format('SELECT public.request_storage_deletion(%L)', m.owner_id::text||'/t5/a6'), '42501');
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(6,'A6','EXECUTABLE',true,'other-owned document reference raised 42501');

  -- A7 snapshot_docids
  PERFORM pg_temp.t5_guard();
  v_d1 := pg_temp.t5_mkdoc('a7doc1','a7', m.owner_id);
  v_d2 := pg_temp.t5_mkdoc('a7doc2','a7', m.owner_id);
  v_expect := ARRAY(SELECT x FROM unnest(ARRAY[v_d1,v_d2]) AS u(x) ORDER BY x);
  PERFORM pg_temp.t5_jwt('authenticated', m.owner_id);
  v_id := public.request_storage_deletion(m.owner_id::text||'/t5/a7');
  SELECT * INTO STRICT v_rec FROM public.storage_deletion_requests WHERE id = v_id;
  IF v_rec.document_row_ids IS DISTINCT FROM v_expect THEN
    RAISE EXCEPTION 'T5 A7 captured document_row_ids are not the exact ordered snapshot';
  END IF;
  INSERT INTO pg_temp.t5_requests(label,id,storage_key,expected) VALUES ('a7', v_rec.id, v_rec.storage_key, to_jsonb(v_rec));
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(7,'A7','EXECUTABLE',true,'creation captured exact ordered captured-id snapshot');
END;
$group_a$;

-- ===========================================================================
-- Group B: claim / lease lifecycle (cases 8-15)
-- ===========================================================================
DO $group_b$
DECLARE
  m record; v_id uuid; v_tok uuid; v_n integer; v_nd integer; v_ids uuid[]; v_exp uuid[]; v_new uuid;
  v_row record; v_old_tok uuid;
BEGIN
  SELECT * INTO STRICT m FROM pg_temp.t5_meta;
  PERFORM pg_temp.t5_jwt('service_role', NULL);

  -- B1 claim pending -> deleting
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('b1','pending','not_attempted','pending',0,'none', interval '1 hour', interval '1 hour', NULL);
  WITH got AS (SELECT * FROM public.claim_storage_deletion_request(v_id))
  INSERT INTO pg_temp.t5_claims(id, lease_token) SELECT id, lease_token FROM got;
  SELECT * INTO STRICT v_row FROM public.storage_deletion_requests WHERE id=v_id;
  IF (SELECT count(*) FROM pg_temp.t5_claims WHERE id=v_id) <> 1
     OR v_row.status<>'deleting' OR v_row.attempt_count<>1 OR v_row.lease_token IS NULL
     OR v_row.lease_expires_at <> now()+interval '5 minutes' OR v_row.block_reason IS NOT NULL THEN
    RAISE EXCEPTION 'T5 B1 claim did not set expected deleting state';
  END IF;
  PERFORM pg_temp.t5_expect('b1', jsonb_build_object('status','deleting','attempt_count',1,
    'lease_token',v_row.lease_token,'lease_expires_at',now()+interval '5 minutes','block_reason',NULL,'updated_at',now()));
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(8,'B1','EXECUTABLE',true,'pending -> deleting; attempt 0 -> 1; 5m lease');

  -- B2 claim confirmed -> finalizing
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('b2','pending','confirmed_absent','pending',4,'none', interval '1 hour', interval '1 hour', NULL);
  WITH got AS (SELECT * FROM public.claim_storage_deletion_request(v_id))
  INSERT INTO pg_temp.t5_claims(id, lease_token) SELECT id, lease_token FROM got;
  SELECT * INTO STRICT v_row FROM public.storage_deletion_requests WHERE id=v_id;
  IF v_row.status<>'finalizing' OR v_row.attempt_count<>4 OR v_row.lease_token IS NULL THEN
    RAISE EXCEPTION 'T5 B2 claim of confirmed row misbehaved';
  END IF;
  PERFORM pg_temp.t5_expect('b2', jsonb_build_object('status','finalizing','attempt_count',4,
    'lease_token',v_row.lease_token,'lease_expires_at',now()+interval '5 minutes','updated_at',now()));
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(9,'B2','EXECUTABLE',true,'confirmed -> finalizing; attempt unchanged at 4');

  -- B3 claim active lease
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('b3','pending','not_attempted','pending',0,'live', interval '1 hour', interval '1 hour', NULL);
  SELECT count(*) INTO v_n FROM public.claim_storage_deletion_request(v_id);
  IF v_n <> 0 THEN RAISE EXCEPTION 'T5 B3 claimed a row that already held a live lease'; END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(10,'B3','EXECUTABLE',true,'active-lease claim returned 0; row unchanged');

  -- B4 batch limit <= 0
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_mkreq('b4a','pending','not_attempted','pending',0,'none', interval '10 hours', interval '10 hours', NULL);
  PERFORM pg_temp.t5_mkreq('b4b','pending','not_attempted','pending',1,'none', interval '9 hours', interval '9 hours', NULL);
  IF (SELECT count(*) FROM public.claim_storage_deletion_requests(0)) <> 0
     OR (SELECT count(*) FROM public.claim_storage_deletion_requests(-2)) <> 0 THEN
    RAISE EXCEPTION 'T5 B4 non-positive batch limit returned rows';
  END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(11,'B4','EXECUTABLE',true,'batch limit 0 and -2 returned no rows');

  -- B5 batch oldest N
  PERFORM pg_temp.t5_guard();
  SELECT coalesce(array_agg(q.id ORDER BY q.id),'{}'::uuid[]) INTO v_exp FROM (
    SELECT f.id, (f.expected->>'created_at')::timestamptz AS c FROM pg_temp.t5_requests f
     WHERE (f.expected->>'status') IN ('pending','deleting','blocked','finalizing')
       AND ((f.expected->>'lease_expires_at') IS NULL OR (f.expected->>'lease_expires_at')::timestamptz < now())
       AND ((f.expected->>'status') <> 'blocked' OR (f.expected->>'updated_at')::timestamptz < now()-interval '1 hour')
     ORDER BY c LIMIT 2) q;
  IF v_exp IS DISTINCT FROM (SELECT array_agg(u.x ORDER BY u.x) FROM unnest(ARRAY[
        (SELECT id FROM pg_temp.t5_requests WHERE label='b4a'),
        (SELECT id FROM pg_temp.t5_requests WHERE label='b4b')]) AS u(x)) THEN
    RAISE EXCEPTION 'T5 B5 oracle-derived two oldest eligible rows are not b4a/b4b';
  END IF;
  SELECT array_agg(id ORDER BY id), (array_agg(DISTINCT lease_token))[1], count(*), count(DISTINCT lease_token)
    INTO v_ids, v_tok, v_n, v_nd
    FROM public.claim_storage_deletion_requests(2);
  IF v_ids IS DISTINCT FROM v_exp OR v_n <> 2 OR v_nd <> 1 THEN
    RAISE EXCEPTION 'T5 B5 batch claim returned % rows / % tokens (expected the two oldest with a shared token)', v_n, v_nd;
  END IF;
  PERFORM pg_temp.t5_expect('b4a', jsonb_build_object('status','deleting','attempt_count',1,
    'lease_token',v_tok,'lease_expires_at',now()+interval '5 minutes','updated_at',now()));
  PERFORM pg_temp.t5_expect('b4b', jsonb_build_object('status','deleting','attempt_count',2,
    'lease_token',v_tok,'lease_expires_at',now()+interval '5 minutes','updated_at',now()));
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(12,'B5','EXECUTABLE',true,'batch(2) claimed the two oldest eligible rows with one shared token');

  -- B6 blocked < 1h
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('b6','blocked','not_attempted','pending',1,'none', interval '2 hours', interval '30 minutes', NULL);
  SELECT count(*) INTO v_n FROM public.claim_storage_deletion_request(v_id);
  IF v_n <> 0 THEN RAISE EXCEPTION 'T5 B6 claimed a blocked row inside the 1h backoff'; END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(13,'B6','EXECUTABLE',true,'blocked 30m ago not claimable');

  -- B7 blocked >= 1h
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('b7','blocked','not_attempted','pending',1,'none', interval '2 hours', interval '61 minutes', NULL);
  WITH got AS (SELECT * FROM public.claim_storage_deletion_request(v_id))
  INSERT INTO pg_temp.t5_claims(id, lease_token) SELECT id, lease_token FROM got;
  SELECT * INTO STRICT v_row FROM public.storage_deletion_requests WHERE id=v_id;
  IF v_row.status<>'deleting' OR v_row.attempt_count<>2 OR v_row.block_reason IS NOT NULL OR v_row.lease_token IS NULL THEN
    RAISE EXCEPTION 'T5 B7 blocked-old row was not reclaimed cleanly';
  END IF;
  PERFORM pg_temp.t5_expect('b7', jsonb_build_object('status','deleting','attempt_count',2,'block_reason',NULL,
    'lease_token',v_row.lease_token,'lease_expires_at',now()+interval '5 minutes','updated_at',now()));
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(14,'B7','EXECUTABLE',true,'blocked>=1h reclaimed; attempt+1; block_reason cleared');

  -- B8 expired lease reclaim
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('b8','deleting','uncertain','pending',2,'expired', interval '1 hour', interval '1 hour', NULL);
  v_new := (SELECT id FROM pg_temp.t5_requests WHERE label='b8');
  SELECT lease_token INTO v_old_tok FROM public.storage_deletion_requests WHERE id=v_id;
  WITH got AS (SELECT * FROM public.claim_storage_deletion_request(v_id))
  INSERT INTO pg_temp.t5_claims(id, lease_token) SELECT id, lease_token FROM got;
  SELECT * INTO STRICT v_row FROM public.storage_deletion_requests WHERE id=v_id;
  IF v_row.status<>'deleting' OR v_row.attempt_count<>3 OR v_row.lease_token IS NULL
     OR v_row.lease_token = v_old_tok THEN
    RAISE EXCEPTION 'T5 B8 expired lease was not reclaimed with a fresh token';
  END IF;
  PERFORM pg_temp.t5_expect('b8', jsonb_build_object('status','deleting','attempt_count',3,
    'lease_token',v_row.lease_token,'lease_expires_at',now()+interval '5 minutes','updated_at',now()));
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(15,'B8','EXECUTABLE',true,'expired lease reclaimed; new token; attempt 2 -> 3');
END;
$group_b$;

-- ===========================================================================
-- Group C: block / failure / confirmation transitions (cases 16-27)
-- ===========================================================================
DO $group_c$
DECLARE
  m record; v_id uuid; v_tok uuid; v_row record; v_res text; v_ok boolean;
BEGIN
  SELECT * INTO STRICT m FROM pg_temp.t5_meta;
  PERFORM pg_temp.t5_jwt('service_role', NULL);

  -- C1 block_ok
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('c1','deleting','uncertain','pending',2,'live', interval '1 hour', interval '1 hour', NULL);
  SELECT lease_token INTO v_tok FROM public.storage_deletion_requests WHERE id=v_id;
  v_ok := public.block_storage_deletion(v_id, v_tok, repeat('B',240));
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'T5 C1 block returned %', v_ok; END IF;
  PERFORM pg_temp.t5_expect('c1', jsonb_build_object('status','blocked','block_reason',repeat('B',200),
    'lease_token',NULL,'lease_expires_at',NULL,'updated_at',now()));
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(16,'C1','EXECUTABLE',true,'blocked; reason clipped to 200; lease cleared; attempt_count preserved');

  -- C2 block_replay
  v_ok := public.block_storage_deletion(v_id, v_tok, 'R');
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'T5 C2 replay block returned %', v_ok; END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(17,'C2','EXECUTABLE',true,'second block with original token returned false');

  -- C3 block_confirmed
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('c3','finalizing','confirmed_absent','pending',3,'live', interval '1 hour', interval '1 hour', NULL);
  SELECT lease_token INTO v_tok FROM public.storage_deletion_requests WHERE id=v_id;
  v_ok := public.block_storage_deletion(v_id, v_tok, 'R');
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'T5 C3 block on confirmed row returned %', v_ok; END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(18,'C3','EXECUTABLE',true,'block refused a confirmed-absent row');

  -- C4 failure below max -> pending
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('c4','deleting','uncertain','pending',1,'live', interval '1 hour', interval '1 hour', NULL);
  SELECT lease_token INTO v_tok FROM public.storage_deletion_requests WHERE id=v_id;
  v_res := public.record_storage_deletion_failure(v_id, v_tok, repeat('E',650), 3);
  IF v_res IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'T5 C4 failure returned %', v_res; END IF;
  PERFORM pg_temp.t5_expect('c4', jsonb_build_object('status','pending','r2_state','uncertain',
    'last_error',repeat('E',500),'lease_token',NULL,'lease_expires_at',NULL,'updated_at',now()));
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(19,'C4','EXECUTABLE',true,'below max -> pending; error clipped to 500; lease cleared');

  -- C5 failure clamp -> failed
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('c5a','deleting','uncertain','pending',3,'live', interval '1 hour', interval '1 hour', NULL);
  SELECT lease_token INTO v_tok FROM public.storage_deletion_requests WHERE id=v_id;
  v_res := public.record_storage_deletion_failure(v_id, v_tok, 'T5 c5a', 3);
  IF v_res IS DISTINCT FROM 'failed' THEN RAISE EXCEPTION 'T5 C5a returned %', v_res; END IF;
  PERFORM pg_temp.t5_expect('c5a', jsonb_build_object('status','failed','last_error','T5 c5a','lease_token',NULL,'lease_expires_at',NULL,'updated_at',now()));

  v_id := pg_temp.t5_mkreq('c5b','deleting','uncertain','pending',5,'live', interval '1 hour', interval '1 hour', NULL);
  SELECT lease_token INTO v_tok FROM public.storage_deletion_requests WHERE id=v_id;
  v_res := public.record_storage_deletion_failure(v_id, v_tok, 'T5 c5b', 3);
  IF v_res IS DISTINCT FROM 'failed' THEN RAISE EXCEPTION 'T5 C5b failure returned %', v_res; END IF;
  PERFORM pg_temp.t5_expect('c5b', jsonb_build_object('status','failed','last_error','T5 c5b','lease_token',NULL,'lease_expires_at',NULL,'updated_at',now()));

  v_id := pg_temp.t5_mkreq('c5c','deleting','uncertain','pending',1,'live', interval '1 hour', interval '1 hour', NULL);
  SELECT lease_token INTO v_tok FROM public.storage_deletion_requests WHERE id=v_id;
  v_res := public.record_storage_deletion_failure(v_id, v_tok, 'T5 c5c', 0);
  IF v_res IS DISTINCT FROM 'failed' THEN RAISE EXCEPTION 'T5 C5c failure(max 0) returned %', v_res; END IF;
  PERFORM pg_temp.t5_expect('c5c', jsonb_build_object('status','failed','last_error','T5 c5c',
    'lease_token',NULL,'lease_expires_at',NULL,'updated_at',now()));

  v_id := pg_temp.t5_mkreq('c5d','deleting','uncertain','pending',1,'live', interval '1 hour', interval '1 hour', NULL);
  SELECT lease_token INTO v_tok FROM public.storage_deletion_requests WHERE id=v_id;
  v_res := public.record_storage_deletion_failure(v_id, v_tok, 'T5 c5d', -2);
  IF v_res IS DISTINCT FROM 'failed' THEN RAISE EXCEPTION 'T5 C5d failure(max -2) returned %', v_res; END IF;
  PERFORM pg_temp.t5_expect('c5d', jsonb_build_object('status','failed','last_error','T5 c5d',
    'lease_token',NULL,'lease_expires_at',NULL,'updated_at',now()));

  v_id := pg_temp.t5_mkreq('c5e','deleting','uncertain','pending',1,'live', interval '1 hour', interval '1 hour', NULL);
  SELECT lease_token INTO v_tok FROM public.storage_deletion_requests WHERE id=v_id;
  v_res := public.record_storage_deletion_failure(v_id, v_tok, 'T5 c5e', NULL::integer);
  IF v_res IS DISTINCT FROM 'failed' THEN RAISE EXCEPTION 'T5 C5e failure(max NULL) returned %', v_res; END IF;
  PERFORM pg_temp.t5_expect('c5e', jsonb_build_object('status','failed','last_error','T5 c5e',
    'lease_token',NULL,'lease_expires_at',NULL,'updated_at',now()));
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(20,'C5','EXECUTABLE',true,'attempt>=max (incl 0, negative, NULL) -> failed');

  -- C6 failure replay -> NULL
  v_res := public.record_storage_deletion_failure((SELECT id FROM pg_temp.t5_requests WHERE label='c4'), m.wrong_token, 'x', 3);
  IF v_res IS NOT NULL THEN RAISE EXCEPTION 'T5 C6 replay failure returned %', v_res; END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(21,'C6','EXECUTABLE',true,'replayed failure returned SQL NULL; row unchanged');

  -- C7 failure on confirmed -> NULL
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('c7','finalizing','confirmed_absent','pending',2,'live', interval '1 hour', interval '1 hour', NULL);
  SELECT lease_token INTO v_tok FROM public.storage_deletion_requests WHERE id=v_id;
  v_res := public.record_storage_deletion_failure(v_id, v_tok, 'x', 3);
  IF v_res IS NOT NULL THEN RAISE EXCEPTION 'T5 C7 failure on confirmed returned %', v_res; END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(22,'C7','EXECUTABLE',true,'failure refused a confirmed-absent row (returns NULL)');

  -- C8 confirm_ok
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('c8','deleting','uncertain','pending',2,'live', interval '1 hour', interval '1 hour', NULL);
  SELECT lease_token INTO v_tok FROM public.storage_deletion_requests WHERE id=v_id;
  v_ok := public.set_r2_confirmed_absent(v_id, v_tok);
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'T5 C8 confirm returned %', v_ok; END IF;
  PERFORM pg_temp.t5_expect('c8', jsonb_build_object('r2_state','confirmed_absent','status','finalizing',
    'last_error',NULL,'updated_at',now()));
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(23,'C8','EXECUTABLE',true,'confirmed_absent/finalizing; last_error cleared; lease preserved');

  -- C9 confirm_replay
  v_ok := public.set_r2_confirmed_absent(v_id, v_tok);
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'T5 C9 confirm replay returned %', v_ok; END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(24,'C9','EXECUTABLE',true,'confirm replay under live lease returned true; row unchanged');

  -- C10 expired/stale lease rejects every transition
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('c10','deleting','uncertain','pending',1,'expired', interval '1 hour', interval '1 hour', NULL);
  SELECT lease_token INTO v_tok FROM public.storage_deletion_requests WHERE id=v_id;
  v_ok := public.block_storage_deletion(v_id, v_tok, 'R');          IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'T5 C10 block'; END IF;
  v_res := public.record_storage_deletion_failure(v_id, v_tok, 'x', 3);
  IF v_res IS NOT NULL THEN RAISE EXCEPTION 'T5 C10 failure returned %', v_res; END IF;
  v_ok := public.set_r2_confirmed_absent(v_id, v_tok);
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'T5 C10 confirm returned %', v_ok; END IF;
  v_ok := public.finalize_storage_deletion(v_id, v_tok);
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'T5 C10 finalize returned %', v_ok; END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(25,'C10','EXECUTABLE',true,'expired lease rejected block/fail/confirm/finalize');

  -- C11 NULL token rejects every transition
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('c11','finalizing','confirmed_absent','pending',2,'live', interval '1 hour', interval '1 hour', NULL);
  v_ok := public.block_storage_deletion(v_id, NULL::uuid, 'R');
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'T5 C11 block returned %', v_ok; END IF;
  v_res := public.record_storage_deletion_failure(v_id, NULL::uuid, 'x', 3);
  IF v_res IS NOT NULL THEN RAISE EXCEPTION 'T5 C11 failure returned %', v_res; END IF;
  v_ok := public.set_r2_confirmed_absent(v_id, NULL::uuid);
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'T5 C11 confirm returned %', v_ok; END IF;
  v_ok := public.finalize_storage_deletion(v_id, NULL::uuid);
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'T5 C11 finalize returned %', v_ok; END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(25+1,'C11','EXECUTABLE',true,'NULL token rejected block/fail/confirm/finalize');

  -- C12 wrong token
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('c12','finalizing','confirmed_absent','pending',2,'live', interval '1 hour', interval '1 hour', NULL);
  v_ok := public.block_storage_deletion(v_id, m.wrong_token, 'R');
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'T5 C12 block returned %', v_ok; END IF;
  v_res := public.record_storage_deletion_failure(v_id, m.wrong_token, 'x', 3);
  IF v_res IS NOT NULL THEN RAISE EXCEPTION 'T5 C12 failure returned %', v_res; END IF;
  v_ok := public.set_r2_confirmed_absent(v_id, m.wrong_token);
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'T5 C12 confirm returned %', v_ok; END IF;
  v_ok := public.finalize_storage_deletion(v_id, m.wrong_token);
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'T5 C12 finalize returned %', v_ok; END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(27,'C12','EXECUTABLE',true,'wrong token rejected block/fail/confirm/finalize');
END;
$group_c$;

-- ===========================================================================
-- Group D: finalization (cases 28-37)
-- ===========================================================================
DO $group_d$
DECLARE
  m record; v_id uuid; v_tok uuid; v_res text; v_ok boolean;
  v_cap uuid; v_unc uuid; v_mov uuid; v_doc uuid; v_prof uuid; v_ids uuid[];
BEGIN
  SELECT * INTO STRICT m FROM pg_temp.t5_meta;
  PERFORM pg_temp.t5_jwt('service_role', NULL);

  -- D1 finalize before confirmation
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('d1','deleting','uncertain','pending',1,'live', interval '1 hour', interval '1 hour', NULL);
  SELECT lease_token INTO v_tok FROM public.storage_deletion_requests WHERE id=v_id;
  v_ok := public.finalize_storage_deletion(v_id, v_tok);
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'T5 D1 pre-confirmation finalize returned %', v_ok; END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(28,'D1','EXECUTABLE',true,'finalize before confirmation returned false; row unchanged');

  -- D2 confirm + finalize + captured document deleted
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('d2','deleting','uncertain','pending',2,'live', interval '1 hour', interval '1 hour', NULL);
  SELECT lease_token INTO v_tok FROM public.storage_deletion_requests WHERE id=v_id;
  v_doc := pg_temp.t5_mkdoc('d2doc','d2', m.owner_id);
  UPDATE public.storage_deletion_requests SET document_row_ids = ARRAY[v_doc] WHERE id = v_id;
  PERFORM pg_temp.t5_expect('d2', jsonb_build_object('document_row_ids', ARRAY[v_doc]));
  v_ok := public.set_r2_confirmed_absent(v_id, v_tok);
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'T5 D2 confirm returned %', v_ok; END IF;
  PERFORM pg_temp.t5_expect('d2', jsonb_build_object('r2_state','confirmed_absent','status','finalizing',
    'last_error',NULL,'updated_at',now()));
  v_ok := public.finalize_storage_deletion(v_id, v_tok);
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'T5 D2 finalize returned %', v_ok; END IF;
  PERFORM pg_temp.t5_expect('d2', jsonb_build_object('finalize_state','done','status','deleted',
    'finalized_at',now(),'lease_token',NULL,'lease_expires_at',NULL,'updated_at',now()));
  UPDATE pg_temp.t5_documents SET present = false WHERE label = 'd2doc';
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(29,'D2','EXECUTABLE',true,'confirmed+finalized; captured document row deleted; done/deleted');

  -- D3 finalize replay
  v_ok := public.finalize_storage_deletion(v_id, v_tok);
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'T5 D3 finalize replay returned %', v_ok; END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(30,'D3','EXECUTABLE',true,'finalize replay on a done row returned false');

  -- D4 selective deletion
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('d4','deleting','uncertain','pending',2,'live', interval '1 hour', interval '1 hour', NULL);
  SELECT lease_token INTO v_tok FROM public.storage_deletion_requests WHERE id=v_id;
  v_cap := pg_temp.t5_mkdoc('d4cap','d4', m.owner_id);
  v_unc := pg_temp.t5_mkdoc('d4unc','d4', m.owner_id);
  v_mov := pg_temp.t5_mkdoc('d4mov','d4-moved', m.owner_id);
  UPDATE public.storage_deletion_requests
     SET document_row_ids = ARRAY[v_cap, v_mov, m.missing_document_id] WHERE id = v_id;
  PERFORM pg_temp.t5_expect('d4', jsonb_build_object('document_row_ids', ARRAY[v_cap, v_mov, m.missing_document_id]));
  v_ok := public.set_r2_confirmed_absent(v_id, v_tok);
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'T5 D4 confirm returned %', v_ok; END IF;
  PERFORM pg_temp.t5_expect('d4', jsonb_build_object('r2_state','confirmed_absent','status','finalizing',
    'last_error',NULL,'updated_at',now()));
  v_ok := public.finalize_storage_deletion(v_id, v_tok);
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'T5 D4 finalize returned %', v_ok; END IF;
  PERFORM pg_temp.t5_expect('d4', jsonb_build_object('finalize_state','done','status','deleted',
    'finalized_at',now(),'lease_token',NULL,'lease_expires_at',NULL,'updated_at',now()));
  UPDATE pg_temp.t5_documents SET present = false WHERE label = 'd4cap';
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(31,'D4','EXECUTABLE',true,'captured same-key deleted; uncaptured/moved-key/missing handled');

  -- D5 stale / wrong token finalize
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('d5','finalizing','confirmed_absent','pending',2,'live', interval '1 hour', interval '1 hour', NULL);
  v_ok := public.finalize_storage_deletion(v_id, m.wrong_token);
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'T5 D5 wrong-token finalize returned %', v_ok; END IF;
  v_id := pg_temp.t5_mkreq('d5exp','finalizing','confirmed_absent','pending',2,'expired', interval '1 hour', interval '1 hour', NULL);
  SELECT lease_token INTO v_tok FROM public.storage_deletion_requests WHERE id=v_id;
  v_ok := public.finalize_storage_deletion(v_id, v_tok);
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'T5 D5 expired-lease finalize returned %', v_ok; END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(32,'D5','EXECUTABLE',true,'wrong token and expired lease both blocked finalization');

  -- D6 done row protected
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('d6','deleted','confirmed_absent','done',2,'none', interval '3 hours', interval '2 hours', NULL);
  v_ok := public.block_storage_deletion(v_id, m.wrong_token, 'R');
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'T5 D6 block on done returned %', v_ok; END IF;
  v_res := public.record_storage_deletion_failure(v_id, m.wrong_token, 'x', 3);
  IF v_res IS NOT NULL THEN RAISE EXCEPTION 'T5 D6 failure on done returned %', v_res; END IF;
  v_ok := public.set_r2_confirmed_absent(v_id, m.wrong_token);
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'T5 D6 confirm on done returned %', v_ok; END IF;
  v_ok := public.finalize_storage_deletion(v_id, m.wrong_token);
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'T5 D6 finalize on done returned %', v_ok; END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(33,'D6','EXECUTABLE',true,'a done row rejects block/fail/confirm/finalize; no state change');

  -- D7 BLOCKED: existence-check abort needs shared-table fault injection.
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(34,'D7','BLOCKED',NULL,
    'Fault injection (BEFORE DELETE returning NULL, or a DO INSTEAD rule) on shared public.documents is required, and that is DDL on a shared table. Not performable in a rollback-only harness; not simulated.');

  -- D8 finalize on a done row
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('d8','deleted','confirmed_absent','done',2,'none', interval '3 hours', interval '2 hours', NULL);
  v_ok := public.finalize_storage_deletion(v_id, m.wrong_token);
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'T5 D8 finalize on done returned %', v_ok; END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(35,'D8','EXECUTABLE',true,'finalize on an already-done row returned false');

  -- D9 missing captured ids allow finalization
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('d9','finalizing','confirmed_absent','pending',2,'live', interval '1 hour', interval '1 hour', NULL);
  SELECT lease_token INTO v_tok FROM public.storage_deletion_requests WHERE id=v_id;
  UPDATE public.storage_deletion_requests SET document_row_ids = ARRAY[m.missing_document_id] WHERE id = v_id;
  PERFORM pg_temp.t5_expect('d9', jsonb_build_object('document_row_ids', ARRAY[m.missing_document_id]));
  v_ok := public.finalize_storage_deletion(v_id, v_tok);
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'T5 D9 finalize with missing captured ids returned %', v_ok; END IF;
  PERFORM pg_temp.t5_expect('d9', jsonb_build_object('finalize_state','done','status','deleted',
    'finalized_at',now(),'lease_token',NULL,'lease_expires_at',NULL,'updated_at',now()));
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(36,'D9','EXECUTABLE',true,'absent captured ids do not block finalization');

  -- D10 finalize touches only documents
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('d10','deleting','uncertain','pending',2,'live', interval '1 hour', interval '1 hour', NULL);
  SELECT lease_token INTO v_tok FROM public.storage_deletion_requests WHERE id=v_id;
  v_doc := pg_temp.t5_mkdoc('d10doc','d10', m.owner_id);
  INSERT INTO public.profiles(id, photo_url)
  VALUES (gen_random_uuid(), m.owner_id::text || '/t5/d10') RETURNING id INTO v_prof;
  PERFORM pg_temp.t5_ref('d10prof','profiles', v_prof);
  UPDATE public.storage_deletion_requests SET document_row_ids = ARRAY[v_doc] WHERE id = v_id;
  PERFORM pg_temp.t5_expect('d10', jsonb_build_object('document_row_ids', ARRAY[v_doc]));
  v_ok := public.set_r2_confirmed_absent(v_id, v_tok);
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'T5 D10 confirm returned %', v_ok; END IF;
  PERFORM pg_temp.t5_expect('d10', jsonb_build_object('r2_state','confirmed_absent','status','finalizing',
    'last_error',NULL,'updated_at',now()));
  v_ok := public.finalize_storage_deletion(v_id, v_tok);
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'T5 D10 finalize returned %', v_ok; END IF;
  PERFORM pg_temp.t5_expect('d10', jsonb_build_object('finalize_state','done','status','deleted',
    'finalized_at',now(),'lease_token',NULL,'lease_expires_at',NULL,'updated_at',now()));
  UPDATE pg_temp.t5_documents SET present = false WHERE label = 'd10doc';
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_prof) THEN
    RAISE EXCEPTION 'T5 D10 finalize deleted a non-document reference row';
  END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(37,'D10','EXECUTABLE',true,'finalization mutates documents only; protected reference row survives');
END;
$group_d$;

-- ===========================================================================
-- Group E: fence interactions (cases 38-43)
-- ===========================================================================
DO $group_e$
DECLARE
  m record; v_id uuid; v_tok uuid; v_res text; v_ok boolean; v_key text;
  v_unc uuid; v_p6 uuid; v_thread uuid; v_pay uuid;
BEGIN
  SELECT * INTO STRICT m FROM pg_temp.t5_meta;
  PERFORM pg_temp.t5_jwt('service_role', NULL);

  -- E1 fence first
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('e1','deleting','uncertain','pending',1,'live', interval '1 hour', interval '1 hour', NULL);
  SELECT lease_token INTO v_tok FROM public.storage_deletion_requests WHERE id=v_id;
  v_res := public.fence_storage_key_for_deletion(v_id, v_tok);
  IF v_res IS DISTINCT FROM 'fenced' THEN RAISE EXCEPTION 'T5 E1 fence returned %', v_res; END IF;
  v_key := m.owner_id::text || '/t5/e1';
  INSERT INTO pg_temp.t5_fences_created(storage_key, expected)
  SELECT f.storage_key, to_jsonb(f) FROM public.storage_deletion_fences f WHERE f.storage_key = v_key;
  IF NOT EXISTS (SELECT 1 FROM pg_temp.t5_fences_created WHERE storage_key = v_key) THEN
    RAISE EXCEPTION 'T5 E1 fence row not created';
  END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(38,'E1','EXECUTABLE',true,'first fence call returned fenced and created the fence row');

  -- E2 fence idempotent
  v_res := public.fence_storage_key_for_deletion(v_id, v_tok);
  IF v_res IS DISTINCT FROM 'fenced' THEN RAISE EXCEPTION 'T5 E2 fence replay returned %', v_res; END IF;
  IF (SELECT count(*) FROM public.storage_deletion_fences WHERE storage_key = v_key) <> 1 THEN
    RAISE EXCEPTION 'T5 E2 duplicate fence row';
  END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(39,'E2','EXECUTABLE',true,'fence replay returned fenced; still exactly one row');

  -- E3 fence blocked by protected reference
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('e3','deleting','uncertain','pending',1,'live', interval '1 hour', interval '1 hour', NULL);
  SELECT lease_token INTO v_tok FROM public.storage_deletion_requests WHERE id=v_id;
  INSERT INTO public.profiles(id, photo_url)
  VALUES (gen_random_uuid(), m.owner_id::text || '/t5/e3') RETURNING id INTO v_p6;
  PERFORM pg_temp.t5_ref('e3prof','profiles', v_p6);
  v_res := public.fence_storage_key_for_deletion(v_id, v_tok);
  IF v_res IS DISTINCT FROM 'blocked_protected_reference' THEN RAISE EXCEPTION 'T5 E3 fence returned %', v_res; END IF;
  IF EXISTS (SELECT 1 FROM public.storage_deletion_fences WHERE storage_key = m.owner_id::text || '/t5/e3') THEN
    RAISE EXCEPTION 'T5 E3 fence written despite protected reference';
  END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(40,'E3','EXECUTABLE',true,'protected reference returned blocked_protected_reference; no fence');

  -- E4 fence blocked by uncaptured document
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('e4','deleting','uncertain','pending',1,'live', interval '1 hour', interval '1 hour', NULL);
  SELECT lease_token INTO v_tok FROM public.storage_deletion_requests WHERE id=v_id;
  v_unc := pg_temp.t5_mkdoc('e4doc','e4', m.owner_id);
  v_res := public.fence_storage_key_for_deletion(v_id, v_tok);
  IF v_res IS DISTINCT FROM 'blocked_document_set_changed' THEN RAISE EXCEPTION 'T5 E4 fence returned %', v_res; END IF;
  IF EXISTS (SELECT 1 FROM public.storage_deletion_fences WHERE storage_key = m.owner_id::text || '/t5/e4') THEN
    RAISE EXCEPTION 'T5 E4 fence written despite uncaptured document';
  END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(41,'E4','EXECUTABLE',true,'uncaptured document returned blocked_document_set_changed; no fence');

  -- E5 fence with expired lease
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('e5','deleting','uncertain','pending',1,'expired', interval '1 hour', interval '1 hour', NULL);
  SELECT lease_token INTO v_tok FROM public.storage_deletion_requests WHERE id=v_id;
  v_res := public.fence_storage_key_for_deletion(v_id, v_tok);
  IF v_res IS DISTINCT FROM 'not_claimed' THEN RAISE EXCEPTION 'T5 E5 fence returned %', v_res; END IF;
  IF EXISTS (SELECT 1 FROM public.storage_deletion_fences WHERE storage_key = m.owner_id::text || '/t5/e5') THEN
    RAISE EXCEPTION 'T5 E5 fence written for an unclaimed request';
  END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(42,'E5','EXECUTABLE',true,'expired lease returned not_claimed; no fence');

  -- E6 BEFORE triggers reject the fenced key on all six tables (+ UPDATE paths)
  v_key := m.owner_id::text || '/t5/e1';
  INSERT INTO public.support_threads(user_id) VALUES (m.owner_id) RETURNING id INTO v_thread;
  PERFORM pg_temp.t5_ref('e6thread','support_threads', v_thread);
  INSERT INTO public.payments(user_id,item,amount_inr,method)
  VALUES (m.owner_id,'standard',1,'online') RETURNING id INTO v_pay;
  PERFORM pg_temp.t5_ref('e6pay','payments', v_pay);
  INSERT INTO public.profiles(id) VALUES (gen_random_uuid()) RETURNING id INTO v_p6;
  PERFORM pg_temp.t5_ref('e6prof','profiles', v_p6);

  PERFORM pg_temp.t5_must_fail_fenced(format(
    'INSERT INTO public.documents(user_id,doc_type,storage_key) VALUES (%L::uuid,%L,%L)',
    m.owner_id,'govt_id',v_key));
  PERFORM pg_temp.t5_must_fail_fenced(format(
    'INSERT INTO public.profiles(id,photo_url) VALUES (gen_random_uuid(),%L)', v_key));
  PERFORM pg_temp.t5_must_fail_fenced(format(
    'INSERT INTO public.payments(user_id,item,amount_inr,method,proof_key) VALUES (%L::uuid,%L::public.payment_item,%s,%L,%L)',
    m.owner_id,'standard',1,'online',v_key));
  PERFORM pg_temp.t5_must_fail_fenced(format(
    'INSERT INTO public.jathagam_requests(user_id,birth_date,birth_time,birth_place,report_key) VALUES (%L::uuid,%L::date,%L,%L,%L)',
    m.owner_id,'2000-01-01','00:00','T5',v_key));
  PERFORM pg_temp.t5_must_fail_fenced(format(
    'INSERT INTO public.support_messages(thread_id,sender_id,body,attachment_key) VALUES (%L::uuid,%L::uuid,%L,%L)',
    v_thread, m.owner_id, 'T5', v_key));
  PERFORM pg_temp.t5_must_fail_fenced(format(
    'INSERT INTO public.payment_events(payment_id,user_id,item,amount_inr,verified_at,receipt_key) VALUES (%L::uuid,%L::uuid,%L::public.payment_item,%s,now(),%L)',
    v_pay, m.owner_id,'standard',1,v_key));
  PERFORM pg_temp.t5_must_fail_fenced(format(
    'UPDATE public.documents SET storage_key=%L WHERE id=%L::uuid', v_key, v_unc));
  PERFORM pg_temp.t5_must_fail_fenced(format(
    'UPDATE public.profiles SET photo_url=%L WHERE id=%L::uuid', v_key, v_p6));
  -- Negative self-test: an unrelated SQLSTATE 23514 (the UTR-length CHECK) must
  -- NOT satisfy the fence assertion. Fail-closed if the helper accepts it, or if
  -- the helper rejects with anything other than SQLSTATE 23514 (schema drift).
  BEGIN
    PERFORM pg_temp.t5_must_fail_fenced(format(
      'INSERT INTO public.payments(user_id,item,amount_inr,method,utr_reference) VALUES (%L::uuid,%L,%s,%L,%L)',
      m.owner_id,'standard',1,'online', repeat('x',121)));
    RAISE EXCEPTION 'T5 fence assertion accepted an unrelated 23514';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'T5 fence assertion rejected%'
       OR SQLERRM NOT LIKE '%got SQLSTATE 23514%' THEN
      RAISE;
    END IF;
  END;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(43,'E6','EXECUTABLE',true,
    'all six tables rejected the fenced key on INSERT; documents and profiles rejected it on UPDATE');
END;
$group_e$;

-- ===========================================================================
-- Group F: cancel / quota resync / recreation / global guard (cases 44-49)
-- ===========================================================================
DO $group_f$
DECLARE
  m record; v_id uuid; v_new uuid; v_state text; v_ok boolean; v_ids uuid[]; v_n integer;
BEGIN
  SELECT * INTO STRICT m FROM pg_temp.t5_meta;

  -- F1 cancel by requester and by admin
  PERFORM pg_temp.t5_guard();
  INSERT INTO public.user_roles(user_id, role) VALUES (m.admin_id, 'admin');
  PERFORM pg_temp.t5_ref('admin_role','user_roles', (SELECT id FROM public.user_roles WHERE user_id=m.admin_id AND role='admin'));
  v_id := pg_temp.t5_mkreq('f1','pending','not_attempted','pending',0,'none', interval '1 hour', interval '1 hour', m.owner_id);
  PERFORM pg_temp.t5_jwt('authenticated', m.owner_id);
  v_ok := public.cancel_storage_deletion(v_id);
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'T5 F1 requester cancel returned %', v_ok; END IF;
  PERFORM pg_temp.t5_expect('f1', jsonb_build_object('status','cancelled','updated_at',now()));
  v_id := pg_temp.t5_mkreq('f1b','pending','not_attempted','pending',0,'none', interval '1 hour', interval '1 hour', m.other_id);
  PERFORM pg_temp.t5_jwt('authenticated', m.admin_id);
  v_ok := public.cancel_storage_deletion(v_id);
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'T5 F1 admin cancel returned %', v_ok; END IF;
  PERFORM pg_temp.t5_expect('f1b', jsonb_build_object('status','cancelled','updated_at',now()));
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(44,'F1','EXECUTABLE',true,'requester and admin both cancelled a clean pending request');

  -- F2 cancel rejected
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('f2a','pending','not_attempted','pending',0,'none', interval '1 hour', interval '1 hour', m.owner_id);
  PERFORM pg_temp.t5_jwt('authenticated', m.other_id);
  v_ok := public.cancel_storage_deletion(v_id);
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'T5 F2a non-requester non-admin cancel returned %', v_ok; END IF;
  v_id := pg_temp.t5_mkreq('f2b','pending','not_attempted','pending',1,'none', interval '1 hour', interval '1 hour', m.owner_id);
  PERFORM pg_temp.t5_jwt('authenticated', m.owner_id);
  v_ok := public.cancel_storage_deletion(v_id);
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'T5 F2b attempted cancel returned %', v_ok; END IF;
  v_id := pg_temp.t5_mkreq('f2c','deleting','uncertain','pending',0,'none', interval '1 hour', interval '1 hour', m.owner_id);
  v_ok := public.cancel_storage_deletion(v_id);
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'T5 F2c deleting cancel returned %', v_ok; END IF;
  v_id := pg_temp.t5_mkreq('f2d','finalizing','confirmed_absent','pending',0,'none', interval '1 hour', interval '1 hour', m.owner_id);
  v_ok := public.cancel_storage_deletion(v_id);
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'T5 F2d finalizing cancel returned %', v_ok; END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(45,'F2','EXECUTABLE',true,'cancel rejected wrong actor, attempt_count<>0, deleting and finalizing');

  -- F3 quota resync mark
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('f3','deleted','confirmed_absent','done',2,'none', interval '3 hours', interval '2 hours', NULL, interval '2 hours');
  PERFORM pg_temp.t5_jwt('service_role', NULL);
  PERFORM public.mark_storage_deletion_quota_resynced(v_id);
  PERFORM pg_temp.t5_expect('f3', jsonb_build_object('quota_resynced_at',now(),'updated_at',now()));
  v_id := pg_temp.t5_mkreq('f3b','pending','not_attempted','pending',0,'none', interval '1 hour', interval '1 hour', NULL);
  PERFORM public.mark_storage_deletion_quota_resynced(v_id);
  IF (SELECT quota_resynced_at FROM public.storage_deletion_requests WHERE id=v_id) IS NOT NULL THEN
    RAISE EXCEPTION 'T5 F3 mark mutated a non-deleted row';
  END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(46,'F3','EXECUTABLE',true,'mark set quota_resynced_at on a deleted row; no-op elsewhere');

  -- F4 quota resync list
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('f4a','deleted','confirmed_absent','done',2,'none', interval '5 hours', interval '4 hours', NULL, interval '4 hours');
  PERFORM pg_temp.t5_mkreq('f4b','deleted','confirmed_absent','done',2,'none', interval '4 hours', interval '3 hours', NULL, interval '3 hours');
  PERFORM pg_temp.t5_mkreq('f4c','deleted','confirmed_absent','done',2,'none', interval '3 hours', interval '2 hours', NULL, interval '2 hours');
  PERFORM pg_temp.t5_mkreq('f4d','deleted','confirmed_absent','done',2,'none', interval '2 hours', interval '1 hour', NULL, interval '1 hour', true);
  PERFORM pg_temp.t5_mkreq('f4e','pending','not_attempted','pending',0,'none', interval '1 hour', interval '1 hour', NULL);
  SELECT array_agg(x.id) INTO v_ids FROM public.list_storage_deletion_quota_resyncs(2) AS x;
  IF v_ids IS DISTINCT FROM ARRAY[
       (SELECT id FROM pg_temp.t5_requests WHERE label='f4a'),
       (SELECT id FROM pg_temp.t5_requests WHERE label='f4b')]::uuid[] THEN
    RAISE EXCEPTION 'T5 F4 list(2) did not return the two oldest unpublished resyncs';
  END IF;
  IF (SELECT count(*) FROM public.list_storage_deletion_quota_resyncs(0)) <> 0 THEN
    RAISE EXCEPTION 'T5 F4 list(0) returned rows';
  END IF;
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(47,'F4','EXECUTABLE',true,'list returned the two oldest pending resyncs; limit 0 empty');

  -- F5 recreation after failure
  PERFORM pg_temp.t5_guard();
  v_id := pg_temp.t5_mkreq('f5old','failed','uncertain','pending',3,'none', interval '2 hours', interval '16 minutes', NULL);
  PERFORM pg_temp.t5_jwt('authenticated', m.owner_id);
  v_new := public.request_storage_deletion(m.owner_id::text || '/t5/f5old');
  IF v_new = v_id THEN RAISE EXCEPTION 'T5 F5 did not create a fresh request after cooldown'; END IF;
  INSERT INTO pg_temp.t5_requests(label,id,storage_key,expected)
  SELECT 'f5new', r.id, r.storage_key, to_jsonb(r) FROM public.storage_deletion_requests r WHERE r.id = v_new;
  IF (SELECT (expected->>'attempt_count')::int FROM pg_temp.t5_requests WHERE label='f5new') <> 0 THEN
    RAISE EXCEPTION 'T5 F5 recreated request did not reset attempt_count';
  END IF;
  PERFORM pg_temp.t5_mkreq('f5r','failed','uncertain','pending',3,'none', interval '2 hours', interval '5 minutes', NULL);
  v_state := pg_temp.t5_must_fail(format('SELECT public.request_storage_deletion(%L)', m.owner_id::text||'/t5/f5r'), '22023');
  PERFORM pg_temp.t5_guard();
  PERFORM pg_temp.t5_case(48,'F5','EXECUTABLE',true,'>15m failure allowed recreation with attempt 0; <15m blocked 22023');

  -- F6 complete global eligibility guard is exact and non-vacuous
  PERFORM pg_temp.t5_guard();
  SELECT count(*) INTO v_n FROM public.storage_deletion_requests r
   WHERE r.status IN ('pending','deleting','blocked','finalizing')
     AND (r.lease_expires_at IS NULL OR r.lease_expires_at < now())
     AND (r.status <> 'blocked' OR r.updated_at < now() - interval '1 hour');
  IF v_n < 1 THEN RAISE EXCEPTION 'T5 F6 global eligibility guard was vacuous'; END IF;
  PERFORM pg_temp.t5_case(49,'F6','EXECUTABLE',true,
    format('complete global eligible-ID predicate matched the tracked set exactly (%s eligible rows)', v_n));
END;
$group_f$;

-- ===========================================================================
-- Final rollback-guarantee verification + machine-readable report.
-- ===========================================================================
DO $final_guard$
BEGIN
  PERFORM pg_temp.t5_guard();
END;
$final_guard$;

CREATE TEMP TABLE t5_verdict ON COMMIT DROP AS
SELECT (
  (SELECT count(*) = 49 FROM pg_temp.t5_results)
  AND (SELECT count(*) = 49 FROM pg_temp.t5_plan)
  AND (SELECT coalesce(bool_and(passed), false) FROM pg_temp.t5_results WHERE status = 'EXECUTABLE')
  AND (SELECT count(*) = 1 FROM pg_temp.t5_results WHERE status = 'BLOCKED' AND passed IS NULL)
  AND (SELECT guard_checks >= 49 FROM pg_temp.t5_meta)
  AND NOT EXISTS (SELECT 1 FROM pg_temp.t5_requests f LEFT JOIN public.storage_deletion_requests r ON r.id = f.id
                   WHERE f.expected IS DISTINCT FROM to_jsonb(r))
  AND NOT EXISTS (SELECT 1 FROM pg_temp.t5_documents f LEFT JOIN public.documents d ON d.id = f.id
                   WHERE (f.present AND f.expected IS DISTINCT FROM to_jsonb(d)) OR (NOT f.present AND d.id IS NOT NULL))
) AS passed;

SELECT jsonb_build_object(
  'test', 'T5',
  'scope', 'storage deletion lifecycle (Findings 4-5); TEST-only, rollback-only synthetic state-machine and fence semantics',
  'project_ref', current_setting('slmm.t5.target_project', true),
  'isolation', current_setting('transaction_isolation'),
  'rollback_only', true,
  'historical_t5_result', '89/89 reported in prior documents; original artifacts lost; NOT rerun or reproduced here',
  'case_count', 49,
  'executable_case_count', (SELECT count(*) FROM pg_temp.t5_plan WHERE status = 'EXECUTABLE'),
  'executable_cases_passed', (SELECT count(*) FROM pg_temp.t5_results WHERE status = 'EXECUTABLE' AND passed),
  'blocked_case_count', (SELECT count(*) FROM pg_temp.t5_plan WHERE status = 'BLOCKED'),
  'blocked_cases', (SELECT jsonb_agg(jsonb_build_object('case_no', p.case_no, 'code', p.code, 'reason', r.detail))
                      FROM pg_temp.t5_plan p JOIN pg_temp.t5_results r USING (case_no)
                     WHERE p.status = 'BLOCKED'),
  'overall_verdict', CASE WHEN (SELECT passed FROM pg_temp.t5_verdict) THEN 'PASS' ELSE 'FAIL' END,
  'case_results', (SELECT jsonb_agg(jsonb_build_object('case_no', r.case_no, 'code', r.code, 'status', r.status,
                                                       'passed', r.passed, 'detail', r.detail) ORDER BY r.case_no)
                     FROM pg_temp.t5_results r),
  'request_states', (SELECT jsonb_agg(jsonb_build_object('label', label, 'status', expected->>'status') ORDER BY label)
                       FROM pg_temp.t5_requests),
  'document_states', (SELECT jsonb_agg(jsonb_build_object('label', label, 'present', present) ORDER BY label)
                        FROM pg_temp.t5_documents),
  'reference_states', (SELECT jsonb_agg(jsonb_build_object('label', label, 'relation', relation) ORDER BY label)
                         FROM pg_temp.t5_refs),
  'fence_count', (SELECT count(*) FROM public.storage_deletion_fences),
  'guard_checks', (SELECT guard_checks FROM pg_temp.t5_meta)
) AS t5_report;

DO $assert_pass$
BEGIN
  IF NOT (SELECT passed FROM pg_temp.t5_verdict) THEN
    RAISE EXCEPTION 'T5 overall verdict FAIL; see report above';
  END IF;
END;
$assert_pass$;

ROLLBACK;
