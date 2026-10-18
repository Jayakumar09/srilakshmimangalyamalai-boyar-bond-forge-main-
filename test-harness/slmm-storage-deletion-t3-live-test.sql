BEGIN ISOLATION LEVEL REPEATABLE READ;
-- NEW reconstruction, not a recovered copy. TEST nqadtfqyurkpmxcodswc ONLY.
-- DO NOT RUN without separate execution approval and independently verified connection.
-- Execute the COMPLETE file on ONE dedicated postgres connection; never statement-by-statement.
-- Stop on SQL errors and disconnect/ROLLBACK on failure; never continue an aborted run.
-- No external storage calls. confirmed_absent below is ONLY a synthetic state-machine fixture.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SET LOCAL search_path = pg_catalog, pg_temp;

CREATE TEMP TABLE t3_cases (
  case_no integer PRIMARY KEY CHECK (case_no BETWEEN 1 AND 14),
  passed boolean NOT NULL,
  expected_sqlstate text NOT NULL,
  actual_sqlstate text NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;
CREATE TEMP TABLE t3_fixture (
  label text PRIMARY KEY,
  id uuid UNIQUE NOT NULL,
  storage_key text UNIQUE NOT NULL,
  initial_row jsonb NOT NULL
) ON COMMIT DROP;
CREATE TEMP TABLE t3_claims (
  id uuid PRIMARY KEY,
  lease_token uuid NOT NULL,
  rpc_row jsonb NOT NULL
) ON COMMIT DROP;
-- A batch invocation deliberately shares one token: do NOT impose token uniqueness there.
CREATE TEMP TABLE t3_fences_before ON COMMIT DROP AS
SELECT storage_key, to_jsonb(f) AS row_state FROM public.storage_deletion_fences AS f;

CREATE FUNCTION pg_temp.t3_record(
  p_case integer, p_pass boolean, p_expected text, p_actual text, p_detail text
) RETURNS void LANGUAGE plpgsql AS $body$
BEGIN
  INSERT INTO pg_temp.t3_cases VALUES
    (p_case, coalesce(p_pass, false), p_expected, p_actual, p_detail);
END;
$body$;

CREATE FUNCTION pg_temp.t3_guard(p_labels text[])
RETURNS void LANGUAGE plpgsql AS $body$
DECLARE
  v_actual uuid[];
  v_expected uuid[];
BEGIN
  IF current_setting('transaction_isolation') <> 'repeatable read' THEN
    RAISE EXCEPTION 'Isolation guard failed';
  END IF;
  IF cardinality(p_labels) <> (SELECT count(DISTINCT x) FROM unnest(p_labels) AS x)
     OR cardinality(p_labels) <> (SELECT count(*) FROM pg_temp.t3_fixture WHERE label = ANY(p_labels)) THEN
    RAISE EXCEPTION 'Invalid expected-label set';
  END IF;
  SELECT coalesce(array_agg(id ORDER BY id), '{}'::uuid[]) INTO v_expected
    FROM pg_temp.t3_fixture WHERE label = ANY(p_labels);
  -- COMPLETE GLOBAL predicate: deliberately NO owner/key/synthetic filter, limit or SKIP LOCKED.
  SELECT coalesce(array_agg(r.id ORDER BY r.id), '{}'::uuid[]) INTO v_actual
    FROM public.storage_deletion_requests AS r
   WHERE r.status IN ('pending', 'deleting', 'blocked', 'finalizing')
     AND (r.lease_expires_at IS NULL OR r.lease_expires_at < now())
     AND (r.status <> 'blocked' OR r.updated_at < now() - interval '1 hour');
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'Global eligible-ID guard failed: expected %, actual %', v_expected, v_actual;
  END IF;
END;
$body$;

DO $setup$
DECLARE
  v_owner constant uuid := 'e17a398c-41c8-4cce-8b8e-6e830f5ac913';
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres'
     OR current_setting('transaction_isolation') <> 'repeatable read' THEN
    RAISE EXCEPTION 'Requires dedicated postgres connection and repeatable read';
  END IF;
  -- Operator acknowledgement is NOT authoritative server identity. Independently verify
  -- the connection points to TEST before setting this custom session parameter.
  IF current_setting('slmm.t3.target_project',true) IS DISTINCT FROM 'nqadtfqyurkpmxcodswc' THEN
    RAISE EXCEPTION 'Missing explicit TEST connection acknowledgement';
  END IF;
  -- Pin the previously read-only verified COMPLETE bodies (CRLF normalized only).
  IF (SELECT md5(replace(prosrc,chr(13)||chr(10),chr(10))) FROM pg_proc
       WHERE oid='public.claim_storage_deletion_request(uuid)'::regprocedure)
       IS DISTINCT FROM 'ca2d313afeab415ee946dbe6937b7d8b'
     OR (SELECT md5(replace(prosrc,chr(13)||chr(10),chr(10))) FROM pg_proc
       WHERE oid='public.claim_storage_deletion_requests(integer)'::regprocedure)
       IS DISTINCT FROM '367b363648b8fd457fc37adbfad7ac35' THEN
    RAISE EXCEPTION 'Installed claim body drift; re-review required';
  END IF;
  IF has_function_privilege('authenticated','public.claim_storage_deletion_request(uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.claim_storage_deletion_requests(integer)','EXECUTE')
     OR has_function_privilege('anon','public.claim_storage_deletion_request(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.claim_storage_deletion_requests(integer)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.claim_storage_deletion_request(uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.claim_storage_deletion_requests(integer)','EXECUTE') THEN
    RAISE EXCEPTION 'Claim authorization ACL drift; re-review required';
  END IF;
  -- Abort before fixtures if write hooks could introduce indirect/table-global effects.
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid IN
       ('public.storage_deletion_requests'::regclass, 'public.storage_deletion_fences'::regclass)
       AND NOT tgisinternal)
     OR EXISTS (SELECT 1 FROM pg_rewrite WHERE ev_class IN
       ('public.storage_deletion_requests'::regclass, 'public.storage_deletion_fences'::regclass)) THEN
    RAISE EXCEPTION 'Unexpected lifecycle triggers/rules; re-review required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.storage_deletion_requests WHERE owner_id = v_owner OR requested_by = v_owner)
     OR EXISTS (SELECT 1 FROM public.storage_deletion_fences WHERE split_part(storage_key, '/', 1) = v_owner::text)
     OR EXISTS (SELECT 1 FROM public.profiles WHERE id = v_owner OR split_part(photo_url, '/', 1) = v_owner::text)
     OR EXISTS (SELECT 1 FROM public.documents WHERE split_part(storage_key, '/', 1) = v_owner::text)
     OR EXISTS (SELECT 1 FROM public.payments WHERE split_part(proof_key, '/', 1) = v_owner::text)
     OR EXISTS (SELECT 1 FROM public.jathagam_requests WHERE split_part(report_key, '/', 1) = v_owner::text)
     OR EXISTS (SELECT 1 FROM public.support_messages WHERE split_part(attachment_key, '/', 1) = v_owner::text)
     OR EXISTS (SELECT 1 FROM public.payment_events WHERE split_part(receipt_key, '/', 1) = v_owner::text) THEN
    RAISE EXCEPTION 'Synthetic namespace collision; abort without touching existing rows';
  END IF;
  -- Table PK/unique constraints also fail closed on any generated request-ID/key collision.
  WITH spec(label, ordinal, state, r2, fin, attempts) AS (VALUES
    ('single',1,'pending','not_attempted','pending',0),
    ('duplicate',2,'pending','not_attempted','pending',2),
    ('batch1',3,'pending','not_attempted','pending',0),
    ('batch2',4,'pending','not_attempted','pending',1),
    ('batch3',5,'pending','not_attempted','pending',2),
    ('limit',6,'pending','not_attempted','pending',0),
    ('confirmed',7,'pending','confirmed_absent','pending',4),
    ('deleted',8,'deleted','confirmed_absent','done',3),
    ('failed',9,'failed','uncertain','pending',5),
    ('cancelled',10,'cancelled','not_attempted','pending',0),
    ('blocked',11,'blocked','not_attempted','pending',1)
  ), inserted AS (
    INSERT INTO public.storage_deletion_requests
      (id,storage_key,owner_id,requested_by,status,r2_state,finalize_state,attempt_count,
       block_reason,last_error,created_at,updated_at,finalized_at,quota_resynced_at)
    SELECT gen_random_uuid(), v_owner::text || '/t3-reconstructed/' || s.label,
       v_owner,v_owner,s.state,s.r2,s.fin,s.attempts,'synthetic fixture','synthetic fixture',
       now() - interval '3 hours' + s.ordinal * interval '1 minute',
       now() - interval '30 minutes',
       CASE WHEN s.state = 'deleted' THEN now() - interval '2 hours' END,
       CASE WHEN s.state = 'deleted' THEN now() - interval '2 hours' END
      FROM spec AS s
    RETURNING *
  )
  INSERT INTO pg_temp.t3_fixture(label,id,storage_key,initial_row)
    SELECT split_part(i.storage_key,'/',3),i.id,i.storage_key,to_jsonb(i) FROM inserted AS i;
  IF (SELECT count(*) FROM pg_temp.t3_fixture) <> 11 THEN
    RAISE EXCEPTION 'Expected eleven INSERT-returned fixture IDs';
  END IF;
  -- Only our inserted rows are locked. A conflicting lock/error must abort, never be ignored.
  PERFORM r.id FROM public.storage_deletion_requests AS r
    JOIN pg_temp.t3_fixture AS f ON f.id = r.id FOR UPDATE OF r NOWAIT;
  -- Independent setup derivation: seven eligible labels from the explicit states above.
  PERFORM pg_temp.t3_guard(ARRAY['single','duplicate','batch1','batch2','batch3','limit','confirmed']);
END;
$setup$;

-- Each test exception subtransaction rolls its partial work back; errors are recorded.
-- Fatal snapshot/locking failures are rethrown, never treated as an expected authorization result.
DO $auth_tests$
DECLARE
  v_id uuid;
  v_state text;
  v_msg text;
  v_first text;
  v_second text;
BEGIN
  SELECT id INTO STRICT v_id FROM pg_temp.t3_fixture WHERE label = 'single';
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub','e17a398c-41c8-4cce-8b8e-6e830f5ac913',true);
  PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"e17a398c-41c8-4cce-8b8e-6e830f5ac913"}',true);
  PERFORM pg_temp.t3_guard(ARRAY['single','duplicate','batch1','batch2','batch3','limit','confirmed']);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM * FROM public.claim_storage_deletion_request(v_id);
    v_first := '00000';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_first = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    IF v_first IN ('40001','40P01','55P03','57014') THEN RAISE; END IF;
  END;
  RESET ROLE;
  PERFORM pg_temp.t3_guard(ARRAY['single','duplicate','batch1','batch2','batch3','limit','confirmed']);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM * FROM public.claim_storage_deletion_requests(0);
    v_second := '00000';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_second = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    IF v_second IN ('40001','40P01','55P03','57014') THEN RAISE; END IF;
  END;
  RESET ROLE;
  PERFORM pg_temp.t3_record(1, v_first = '42501' AND v_second = '42501',
    '42501 / 42501',v_first || ' / ' || v_second,'Both authenticated EXECUTE ACL denials');

  -- postgres has EXECUTE: rejection here must be the internal gate, not an ACL failure.
  PERFORM set_config('request.jwt.claim.role','',true);
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
  PERFORM pg_temp.t3_guard(ARRAY['single','duplicate','batch1','batch2','batch3','limit','confirmed']);
  BEGIN
    PERFORM * FROM public.claim_storage_deletion_request(v_id);
    v_first := '00000'; v_msg := 'no error';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_first = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    IF v_first IN ('40001','40P01','55P03','57014') THEN RAISE; END IF;
  END;
  v_state := v_msg;
  PERFORM pg_temp.t3_guard(ARRAY['single','duplicate','batch1','batch2','batch3','limit','confirmed']);
  BEGIN
    PERFORM * FROM public.claim_storage_deletion_requests(0);
    v_second := '00000'; v_msg := 'no error';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_second = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    IF v_second IN ('40001','40P01','55P03','57014') THEN RAISE; END IF;
  END;
  PERFORM pg_temp.t3_record(2,v_first = '42501' AND v_second = '42501'
    AND v_state = 'Not allowed' AND v_msg = 'Not allowed' AND auth.role() IS NULL,
    '42501 / 42501',v_first || ' / ' || v_second,'Both internal gates; ' || v_state || ' / ' || v_msg);
  -- A failed authorization case makes all later claims unsafe to reason about. Abort.
  IF EXISTS (SELECT 1 FROM pg_temp.t3_cases WHERE NOT passed) THEN
    RAISE EXCEPTION 'Authorization case failed; stop before positive claims';
  END IF;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'JWT simulation failed'; END IF;
END;
$auth_tests$;

DO $positive_tests$
DECLARE
  v_id uuid;
  v_count integer;
  v_row record;
  v_before jsonb;
  v_state text;
  v_msg text;
  v_ids uuid[];
  v_expected uuid[];
  v_case integer;
  v_label text;
BEGIN
  -- Recheck exact global IDs after authorization probes, before positive claims.
  PERFORM pg_temp.t3_guard(ARRAY['single','duplicate','batch1','batch2','batch3','limit','confirmed']);
  SELECT id INTO STRICT v_id FROM pg_temp.t3_fixture WHERE label='single';
  BEGIN
    WITH got AS (SELECT * FROM public.claim_storage_deletion_request(v_id))
    INSERT INTO pg_temp.t3_claims SELECT id,lease_token,to_jsonb(g) FROM got AS g;
    GET DIAGNOSTICS v_count=ROW_COUNT;
    SELECT * INTO STRICT v_row FROM public.storage_deletion_requests WHERE id=v_id;
    PERFORM pg_temp.t3_record(3,v_count=1 AND v_row.status='deleting' AND v_row.attempt_count=1
      AND v_row.lease_token IS NOT NULL AND substring(v_row.lease_token::text,15,1)='4',
      '00000','00000','Single pending claim; UUID v4; one attempt');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
    IF v_state IN ('40001','40P01','55P03','57014') THEN RAISE; END IF;
    PERFORM pg_temp.t3_record(3,false,'00000',v_state,v_msg);
  END;
  -- lease_expires_at is read ONLY from the table, never an RPC return record.
  BEGIN
    PERFORM pg_temp.t3_record(4,(SELECT lease_expires_at=transaction_timestamp()+interval '5 minutes'
      FROM public.storage_deletion_requests WHERE id=v_id),'00000','00000','Exact transaction-time lease expiry');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
    IF v_state IN ('40001','40P01','55P03','57014') THEN RAISE; END IF;
    PERFORM pg_temp.t3_record(4,false,'00000',v_state,v_msg);
  END;

  PERFORM pg_temp.t3_guard(ARRAY['duplicate','batch1','batch2','batch3','limit','confirmed']);
  SELECT id INTO STRICT v_id FROM pg_temp.t3_fixture WHERE label='duplicate';
  BEGIN
    WITH got AS (SELECT * FROM public.claim_storage_deletion_request(v_id))
    INSERT INTO pg_temp.t3_claims SELECT id,lease_token,to_jsonb(g) FROM got AS g;
    GET DIAGNOSTICS v_count=ROW_COUNT;
    PERFORM pg_temp.t3_record(5,v_count=1 AND (SELECT status='deleting' AND attempt_count=3
      AND lease_token IS NOT NULL FROM public.storage_deletion_requests WHERE id=v_id),
      '00000','00000','First duplicate request claim');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
    IF v_state IN ('40001','40P01','55P03','57014') THEN RAISE; END IF;
    PERFORM pg_temp.t3_record(5,false,'00000',v_state,v_msg);
  END;
  PERFORM pg_temp.t3_guard(ARRAY['batch1','batch2','batch3','limit','confirmed']);
  SELECT to_jsonb(r) INTO STRICT v_before FROM public.storage_deletion_requests AS r WHERE id=v_id;
  BEGIN
    SELECT count(*) INTO v_count FROM public.claim_storage_deletion_request(v_id);
    PERFORM pg_temp.t3_record(6,v_count=0 AND v_before=(SELECT to_jsonb(r)
      FROM public.storage_deletion_requests AS r WHERE id=v_id),'00000','00000','Active-lease retry is a complete row no-op');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
    IF v_state IN ('40001','40P01','55P03','57014') THEN RAISE; END IF;
    PERFORM pg_temp.t3_record(6,false,'00000',v_state,v_msg);
  END;
  -- Derivation: only single/duplicate acquired active leases; the remaining five are exact IDs.
  -- Guard errors are deliberately OUTSIDE case exception handlers: abort entire transaction.
  PERFORM pg_temp.t3_guard(ARRAY['batch1','batch2','batch3','limit','confirmed']);
  FOR v_case IN 7..8 LOOP
    PERFORM pg_temp.t3_guard(ARRAY['batch1','batch2','batch3','limit','confirmed']);
    BEGIN
      SELECT count(*) INTO v_count FROM public.claim_storage_deletion_requests(CASE WHEN v_case=7 THEN 0 ELSE -2 END);
      PERFORM pg_temp.t3_record(v_case,v_count=0,'00000','00000','Non-positive batch limit returns no rows');
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
      IF v_state IN ('40001','40P01','55P03','57014') THEN RAISE; END IF;
      PERFORM pg_temp.t3_record(v_case,false,'00000',v_state,v_msg);
    END;
  END LOOP;
  PERFORM pg_temp.t3_guard(ARRAY['batch1','batch2','batch3','limit','confirmed']);
  -- Independent ordered selection; no unsupported min(uuid). Fixture created_at values are unique.
  SELECT array_agg(q.id ORDER BY q.id) INTO v_expected FROM (
    SELECT r.id FROM public.storage_deletion_requests AS r
    JOIN pg_temp.t3_fixture AS f ON f.id=r.id
    WHERE f.label IN ('batch1','batch2','batch3','limit','confirmed')
    ORDER BY r.created_at LIMIT 2
  ) AS q;
  IF v_expected IS DISTINCT FROM (SELECT array_agg(id ORDER BY id) FROM pg_temp.t3_fixture
      WHERE label IN ('batch1','batch2')) THEN RAISE EXCEPTION 'Batch ordering setup mismatch'; END IF;
  BEGIN
    WITH got AS (SELECT * FROM public.claim_storage_deletion_requests(2)), saved AS (
      INSERT INTO pg_temp.t3_claims SELECT id,lease_token,to_jsonb(g) FROM got AS g RETURNING id
    ) SELECT array_agg(id ORDER BY id) INTO v_ids FROM saved;
    PERFORM pg_temp.t3_record(9,v_ids IS NOT DISTINCT FROM v_expected
      AND (SELECT count(DISTINCT lease_token)=1 FROM pg_temp.t3_claims WHERE id=ANY(v_expected)),
      '00000','00000','Exact two oldest eligible IDs; shared batch token; return order irrelevant');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
    IF v_state IN ('40001','40P01','55P03','57014') THEN RAISE; END IF;
    PERFORM pg_temp.t3_record(9,false,'00000',v_state,v_msg);
  END;
  PERFORM pg_temp.t3_guard(ARRAY['batch3','limit','confirmed']);

  FOR v_case,v_label IN SELECT * FROM (VALUES (10,'deleted'),(11,'failed'),(12,'cancelled'),(13,'blocked')) AS x(n,label) LOOP
    PERFORM pg_temp.t3_guard(ARRAY['batch3','limit','confirmed']);
    SELECT id INTO STRICT v_id FROM pg_temp.t3_fixture WHERE label=v_label;
    SELECT to_jsonb(r) INTO STRICT v_before FROM public.storage_deletion_requests AS r WHERE id=v_id;
    BEGIN
      SELECT count(*) INTO v_count FROM public.claim_storage_deletion_request(v_id);
      PERFORM pg_temp.t3_record(v_case,v_count=0 AND v_before=(SELECT to_jsonb(r)
        FROM public.storage_deletion_requests AS r WHERE id=v_id),'00000','00000',v_label || ' excluded; complete row unchanged');
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
      IF v_state IN ('40001','40P01','55P03','57014') THEN RAISE; END IF;
      PERFORM pg_temp.t3_record(v_case,false,'00000',v_state,v_msg);
    END;
  END LOOP;
  PERFORM pg_temp.t3_guard(ARRAY['batch3','limit','confirmed']);
  SELECT id INTO STRICT v_id FROM pg_temp.t3_fixture WHERE label='confirmed';
  BEGIN
    WITH got AS (SELECT * FROM public.claim_storage_deletion_request(v_id))
    INSERT INTO pg_temp.t3_claims SELECT id,lease_token,to_jsonb(g) FROM got AS g;
    GET DIAGNOSTICS v_count=ROW_COUNT;
    PERFORM pg_temp.t3_record(14,v_count=1 AND (SELECT status='finalizing' AND attempt_count=4
      AND r2_state='confirmed_absent' AND finalize_state='pending' AND lease_token IS NOT NULL
      FROM public.storage_deletion_requests WHERE id=v_id),'00000','00000',
      'SYNTHETIC confirmed_absent fixture only; no evidence of R2 deletion/absence');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
    IF v_state IN ('40001','40P01','55P03','57014') THEN RAISE; END IF;
    PERFORM pg_temp.t3_record(14,false,'00000',v_state,v_msg);
  END;
  PERFORM pg_temp.t3_guard(ARRAY['batch3','limit']);
END;
$positive_tests$;

-- Complete-row comparison catches unintended changes to EVERY installed request column.
CREATE TEMP TABLE t3_final_check ON COMMIT DROP AS
WITH expected AS (
  SELECT f.label,f.id,
    f.initial_row || CASE WHEN f.label IN ('single','duplicate','batch1','batch2','confirmed') THEN
      jsonb_build_object('lease_token',c.lease_token,'lease_expires_at',now()+interval '5 minutes',
        'status',CASE WHEN f.label='confirmed' THEN 'finalizing' ELSE 'deleting' END,
        'attempt_count',(f.initial_row->>'attempt_count')::integer + CASE WHEN f.label='confirmed' THEN 0 ELSE 1 END,
        'block_reason',NULL,'updated_at',now())
      ELSE '{}'::jsonb END AS expected_row
  FROM pg_temp.t3_fixture AS f LEFT JOIN pg_temp.t3_claims AS c ON c.id=f.id
)
SELECT e.label,e.id,e.expected_row,to_jsonb(r) AS actual_row,
  coalesce(e.expected_row=to_jsonb(r),false) AS passed
FROM expected AS e LEFT JOIN public.storage_deletion_requests AS r ON r.id=e.id;

-- One explicit result per case, even if a future edit accidentally omits a case.
CREATE TEMP TABLE t3_verdict ON COMMIT DROP AS
SELECT (SELECT count(*)=14 AND bool_and(passed) FROM pg_temp.t3_cases)
   AND (SELECT count(*)=11 AND bool_and(passed) FROM pg_temp.t3_final_check)
   AND (SELECT count(*)=5 FROM pg_temp.t3_claims)
   AND (SELECT count(DISTINCT lease_token)=4
          AND bool_and(substring(lease_token::text,15,1)='4') FROM pg_temp.t3_claims)
   AND NOT EXISTS (
     SELECT 1 FROM pg_temp.t3_claims AS c
     LEFT JOIN public.storage_deletion_requests AS r ON r.id=c.id
     WHERE c.rpc_row IS DISTINCT FROM jsonb_build_object(
       'id',r.id,'storage_key',r.storage_key,'owner_id',r.owner_id,'lease_token',r.lease_token,
       'status',r.status,'r2_state',r.r2_state,'finalize_state',r.finalize_state,
       'document_row_ids',r.document_row_ids,'attempt_count',r.attempt_count)
   )
   AND NOT EXISTS (SELECT 1 FROM (
     (SELECT storage_key,row_state FROM pg_temp.t3_fences_before EXCEPT
      SELECT storage_key,to_jsonb(f) FROM public.storage_deletion_fences AS f)
     UNION ALL
     (SELECT storage_key,to_jsonb(f) FROM public.storage_deletion_fences AS f EXCEPT
      SELECT storage_key,row_state FROM pg_temp.t3_fences_before)
   ) AS fence_difference)
   AND NOT EXISTS (SELECT 1 FROM public.storage_deletion_requests AS r
     WHERE r.owner_id='e17a398c-41c8-4cce-8b8e-6e830f5ac913'::uuid
     AND NOT EXISTS (SELECT 1 FROM pg_temp.t3_fixture AS f WHERE f.id=r.id)) AS passed;
-- Consolidated evidence: one final result set before ROLLBACK.
SELECT jsonb_build_object(
  'test', 'T3',
  'case_results', (
    SELECT jsonb_agg(
      jsonb_build_object(
        'case_no', n,
        'passed', coalesce(c.passed, false),
        'expected_sqlstate', coalesce(c.expected_sqlstate, 'MISSING'),
        'actual_sqlstate', coalesce(c.actual_sqlstate, 'MISSING'),
        'detail', coalesce(c.detail, 'MISSING CASE: FAIL')
      ) ORDER BY n
    )
    FROM generate_series(1,14) AS n
    LEFT JOIN pg_temp.t3_cases AS c ON c.case_no=n
  ),
  'final_states', (
    SELECT jsonb_agg(
      jsonb_build_object(
        'label', label,
        'passed', passed,
        'expected_row', expected_row,
        'actual_row', actual_row
      ) ORDER BY label
    )
    FROM pg_temp.t3_final_check
  ),
  'case_count', (SELECT count(*) FROM pg_temp.t3_cases),
  'final_state_count', (SELECT count(*) FROM pg_temp.t3_final_check),
  'claim_count', (SELECT count(*) FROM pg_temp.t3_claims),
  'fence_difference_count', (
    SELECT count(*) FROM (
      (SELECT storage_key,row_state FROM pg_temp.t3_fences_before
       EXCEPT
       SELECT storage_key,to_jsonb(f) FROM public.storage_deletion_fences AS f)
      UNION ALL
      (SELECT storage_key,to_jsonb(f) FROM public.storage_deletion_fences AS f
       EXCEPT
       SELECT storage_key,row_state FROM pg_temp.t3_fences_before)
    ) AS differences
  ),
  'safety_guards', 'Completed without uncaught exception',
  'overall_verdict', CASE
    WHEN coalesce((SELECT passed FROM pg_temp.t3_verdict),false)
    THEN 'PASS' ELSE 'FAIL' END,
  'scope', 'TEST rollback-only; actual R2 behavior not tested'
) AS t3_report;
ROLLBACK;
