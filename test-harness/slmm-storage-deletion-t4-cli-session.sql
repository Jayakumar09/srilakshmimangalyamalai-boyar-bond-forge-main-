SET slmm.t4.target_project = 'nqadtfqyurkpmxcodswc';
BEGIN ISOLATION LEVEL REPEATABLE READ;
-- PREPARATION ONLY. TEST nqadtfqyurkpmxcodswc; separate execution approval required.
-- Submit COMPLETE file on ONE verified postgres connection. Stop on every error.
-- Supply slmm.t4.target_project only AFTER independently verifying the TEST endpoint.
-- State-machine fixtures only: no R2 object absence/deletion is asserted or performed.
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '90s';

CREATE TEMP TABLE t4_meta (
  owner_id uuid PRIMARY KEY, wrong_token uuid NOT NULL,
  missing_request_id uuid NOT NULL, missing_document_id uuid NOT NULL,
  guard_checks integer NOT NULL DEFAULT 0
) ON COMMIT DROP;
CREATE TEMP TABLE t4_requests (
  label text PRIMARY KEY, id uuid UNIQUE NOT NULL, storage_key text UNIQUE NOT NULL,
  stale_token uuid, issued_token uuid, expected jsonb NOT NULL
) ON COMMIT DROP;
CREATE TEMP TABLE t4_documents (
  label text PRIMARY KEY, id uuid UNIQUE NOT NULL,
  expected jsonb NOT NULL, present boolean NOT NULL DEFAULT true
) ON COMMIT DROP;
CREATE TEMP TABLE t4_plan (
  case_no integer PRIMARY KEY CHECK (case_no BETWEEN 1 AND 61),
  title text NOT NULL, mode text NOT NULL, op text NOT NULL, label text NOT NULL,
  token_mode text NOT NULL DEFAULT 'current', reason text DEFAULT 'T4 synthetic argument',
  max_attempts integer DEFAULT 3, expected_sqlstate text NOT NULL DEFAULT '00000',
  expected_return jsonb NOT NULL, expected_patch jsonb NOT NULL DEFAULT '{}',
  delete_labels text[] NOT NULL DEFAULT '{}'
) ON COMMIT DROP;
CREATE TEMP TABLE t4_results (
  case_no integer PRIMARY KEY, title text NOT NULL, passed boolean NOT NULL,
  expected_sqlstate text NOT NULL, actual_sqlstate text NOT NULL,
  expected_return jsonb NOT NULL, actual_return jsonb NOT NULL,
  message text NOT NULL
) ON COMMIT DROP;
CREATE TEMP TABLE t4_fences_before ON COMMIT DROP AS
SELECT storage_key,to_jsonb(f) AS row_state FROM public.storage_deletion_fences f;

DO $contract$
DECLARE v_fingerprint text;
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres'
     OR current_setting('transaction_isolation') <> 'repeatable read'
     OR current_setting('slmm.t4.target_project',true) IS DISTINCT FROM 'nqadtfqyurkpmxcodswc' THEN
    RAISE EXCEPTION 'T4 requires independently verified TEST postgres session, acknowledgement and REPEATABLE READ';
  END IF;
  -- Complete function/ACL/column/default/constraint/trigger/rule/index/owner drift pin.
  -- MD5 is a local metadata drift check, NOT a cryptographic identity assertion.
  SELECT md5(jsonb_build_object(
   'functions',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,
     'definition',pg_get_functiondef(p.oid),'source',p.prosrc,'owner',pg_get_userbyid(p.proowner),
     'acl',p.proacl::text,'configuration',p.proconfig,'definer',p.prosecdef,'volatility',p.provolatile)
     ORDER BY n.nspname,p.proname,p.oid)
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE (n.nspname='public' AND p.proname IN ('block_storage_deletion','record_storage_deletion_failure',
         'set_r2_confirmed_absent','finalize_storage_deletion','documents_client_field_guard','enforce_storage_key_fence','has_role'))
        OR (n.nspname='auth' AND p.proname IN ('role','uid'))),
   'columns',(SELECT jsonb_agg(to_jsonb(c) ORDER BY table_name,ordinal_position)
     FROM information_schema.columns c WHERE table_schema='public'
       AND table_name IN ('documents','storage_deletion_requests','storage_deletion_fences')),
   'relations',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,
     'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
     'partition',c.relispartition,'acl',c.relacl::text,
     'select',has_table_privilege('postgres',c.oid,'SELECT'),'insert',has_table_privilege('postgres',c.oid,'INSERT'),
     'update',has_table_privilege('postgres',c.oid,'UPDATE'),'delete',has_table_privilege('postgres',c.oid,'DELETE')) ORDER BY c.relname)
     FROM pg_class c WHERE c.oid IN ('public.documents'::regclass,'public.storage_deletion_requests'::regclass,'public.storage_deletion_fences'::regclass)),
   'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'type',contype,
     'table',conrelid::regclass::text,'reference',confrelid::text,'definition',pg_get_constraintdef(oid)) ORDER BY conrelid,conname)
     FROM pg_constraint WHERE conrelid IN ('public.documents'::regclass,'public.storage_deletion_requests'::regclass,'public.storage_deletion_fences'::regclass)
        OR confrelid IN ('public.documents'::regclass,'public.storage_deletion_requests'::regclass,'public.storage_deletion_fences'::regclass)),
   'triggers',(SELECT jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(t.oid),
     'enabled',t.tgenabled,'internal',t.tgisinternal,'bits',t.tgtype) ORDER BY t.tgrelid,t.tgname)
     FROM pg_trigger t WHERE t.tgrelid IN ('public.documents'::regclass,'public.storage_deletion_requests'::regclass,'public.storage_deletion_fences'::regclass)),
   'rules',(SELECT jsonb_agg(pg_get_ruledef(oid) ORDER BY oid) FROM pg_rewrite
     WHERE ev_class IN ('public.documents'::regclass,'public.storage_deletion_requests'::regclass,'public.storage_deletion_fences'::regclass)),
   'indexes',(SELECT jsonb_agg(indexdef ORDER BY tablename,indexname) FROM pg_indexes WHERE schemaname='public'
     AND tablename IN ('documents','storage_deletion_requests','storage_deletion_fences')),
   'owner_role',(SELECT jsonb_build_object('superuser',rolsuper,'bypass_rls',rolbypassrls) FROM pg_roles WHERE rolname='postgres')
  )::text) INTO v_fingerprint;
  IF v_fingerprint IS DISTINCT FROM '185aefe8d4b6fce78f3b280c5abdacba' THEN
    RAISE EXCEPTION 'T4 installed dependency contract drift; re-audit required';
  END IF;
  -- No foreign eligible request may be present, even if locked. NO SKIP LOCKED.
  IF EXISTS (SELECT 1 FROM public.storage_deletion_requests r
       WHERE r.status IN ('pending','deleting','blocked','finalizing')
         AND (r.lease_expires_at IS NULL OR r.lease_expires_at < now())
         AND (r.status <> 'blocked' OR r.updated_at < now()-interval '1 hour')) THEN
    RAISE EXCEPTION 'T4 pre-fixture global eligible-ID set is not empty';
  END IF;
  -- A new FK/cascade/delete hook would require a separate deletion-safety review.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE contype='f' AND
       (conrelid IN ('public.documents'::regclass,'public.storage_deletion_requests'::regclass,'public.storage_deletion_fences'::regclass)
        OR confrelid IN ('public.documents'::regclass,'public.storage_deletion_requests'::regclass,'public.storage_deletion_fences'::regclass)))
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.documents'::regclass AND (tgtype & 8) <> 0) THEN
    RAISE EXCEPTION 'T4 refuses FK dependencies or document DELETE triggers';
  END IF;
END;
$contract$;

CREATE FUNCTION pg_temp.t4_assert_state() RETURNS void LANGUAGE plpgsql AS $body$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_temp.t4_requests f LEFT JOIN public.storage_deletion_requests r ON r.id=f.id
             WHERE f.expected IS DISTINCT FROM to_jsonb(r)) THEN
    RAISE EXCEPTION 'T4 complete request-row state mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.t4_documents f LEFT JOIN public.documents d ON d.id=f.id
             WHERE (f.present AND f.expected IS DISTINCT FROM to_jsonb(d)) OR (NOT f.present AND d.id IS NOT NULL)) THEN
    RAISE EXCEPTION 'T4 complete document-row state/presence mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM public.storage_deletion_requests r, pg_temp.t4_meta m
       WHERE (r.owner_id=m.owner_id OR r.requested_by=m.owner_id OR split_part(r.storage_key,'/',1)=m.owner_id::text)
         AND NOT EXISTS (SELECT 1 FROM pg_temp.t4_requests f WHERE f.id=r.id))
     OR EXISTS (SELECT 1 FROM public.documents d, pg_temp.t4_meta m
       WHERE (d.user_id=m.owner_id OR split_part(d.storage_key,'/',1)=m.owner_id::text)
         AND NOT EXISTS (SELECT 1 FROM pg_temp.t4_documents f WHERE f.id=d.id))
     OR EXISTS (SELECT 1 FROM public.storage_deletion_requests r,pg_temp.t4_meta m WHERE r.id=m.missing_request_id)
     OR EXISTS (SELECT 1 FROM public.documents d,pg_temp.t4_meta m WHERE d.id=m.missing_document_id) THEN
    RAISE EXCEPTION 'T4 namespace/unowned ID collision';
  END IF;
  IF EXISTS (SELECT 1 FROM (
    (SELECT storage_key,row_state FROM pg_temp.t4_fences_before EXCEPT
     SELECT storage_key,to_jsonb(f) FROM public.storage_deletion_fences f)
    UNION ALL
    (SELECT storage_key,to_jsonb(f) FROM public.storage_deletion_fences f EXCEPT
     SELECT storage_key,row_state FROM pg_temp.t4_fences_before)
  ) AS differences) THEN RAISE EXCEPTION 'T4 unexpected visible fence difference'; END IF;
END;
$body$;

CREATE FUNCTION pg_temp.t4_guard() RETURNS void LANGUAGE plpgsql AS $body$
DECLARE v_actual uuid[]; v_expected uuid[];
BEGIN
  IF current_user <> 'postgres' OR current_setting('transaction_isolation') <> 'repeatable read' THEN
    RAISE EXCEPTION 'T4 isolation/caller guard failed';
  END IF;
  PERFORM pg_temp.t4_assert_state();
  SELECT coalesce(array_agg(f.id ORDER BY f.id),'{}'::uuid[]) INTO v_expected
    FROM pg_temp.t4_requests f
   WHERE f.expected->>'status' IN ('pending','deleting','blocked','finalizing')
     AND ((f.expected->>'lease_expires_at')::timestamptz IS NULL OR (f.expected->>'lease_expires_at')::timestamptz < now())
     AND (f.expected->>'status' <> 'blocked' OR (f.expected->>'updated_at')::timestamptz < now()-interval '1 hour');
  -- COMPLETE GLOBAL installed eligibility predicate: no owner filter or limit.
  SELECT coalesce(array_agg(r.id ORDER BY r.id),'{}'::uuid[]) INTO v_actual
    FROM public.storage_deletion_requests r
   WHERE r.status IN ('pending','deleting','blocked','finalizing')
     AND (r.lease_expires_at IS NULL OR r.lease_expires_at < now())
     AND (r.status <> 'blocked' OR r.updated_at < now()-interval '1 hour');
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'T4 exact global eligible-ID mismatch; foreign or unexpected request; STOP';
  END IF;
  UPDATE pg_temp.t4_meta SET guard_checks=guard_checks+1;
END;
$body$;

CREATE FUNCTION pg_temp.t4_delete_guard(p_request_id uuid) RETURNS void LANGUAGE plpgsql AS $body$
DECLARE v_ids uuid[]; v_owner uuid; v_missing_doc uuid; v_missing_request uuid;
BEGIN
  SELECT owner_id,missing_document_id,missing_request_id INTO STRICT v_owner,v_missing_doc,v_missing_request
    FROM pg_temp.t4_meta;
  SELECT r.document_row_ids INTO v_ids FROM public.storage_deletion_requests r
    JOIN pg_temp.t4_requests f ON f.id=r.id WHERE r.id=p_request_id AND r.owner_id=v_owner;
  IF NOT FOUND THEN
    IF p_request_id=v_missing_request THEN RETURN; END IF;
    RAISE EXCEPTION 'T4 finalization request is not an INSERT-returned synthetic request';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_ids) AS x(id) WHERE x.id<>v_missing_doc
        AND NOT EXISTS (SELECT 1 FROM pg_temp.t4_documents f WHERE f.id=x.id))
     OR EXISTS (SELECT 1 FROM public.documents d WHERE d.id=ANY(v_ids)
        AND (d.user_id<>v_owner OR NOT EXISTS (SELECT 1 FROM pg_temp.t4_documents f WHERE f.id=d.id)))
     OR EXISTS (SELECT 1 FROM public.documents WHERE id=v_missing_doc) THEN
    RAISE EXCEPTION 'T4 finalizer document-ID allowlist/ownership/absence guard failed';
  END IF;
END;
$body$;

DO $setup$
DECLARE v_owner constant uuid := 'b426ac5e-2d91-4c83-99c4-1ddfe9876e32';
BEGIN
  IF EXISTS (SELECT 1 FROM public.storage_deletion_requests WHERE owner_id=v_owner OR requested_by=v_owner OR split_part(storage_key,'/',1)=v_owner::text)
     OR EXISTS (SELECT 1 FROM public.storage_deletion_fences WHERE split_part(storage_key,'/',1)=v_owner::text)
     OR EXISTS (SELECT 1 FROM public.documents WHERE user_id=v_owner OR split_part(storage_key,'/',1)=v_owner::text)
     OR EXISTS (SELECT 1 FROM public.profiles WHERE id=v_owner OR split_part(photo_url,'/',1)=v_owner::text)
     OR EXISTS (SELECT 1 FROM auth.users WHERE id=v_owner)
     OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=v_owner)
     OR EXISTS (SELECT 1 FROM public.payments WHERE split_part(proof_key,'/',1)=v_owner::text)
     OR EXISTS (SELECT 1 FROM public.jathagam_requests WHERE split_part(report_key,'/',1)=v_owner::text)
     OR EXISTS (SELECT 1 FROM public.support_messages WHERE split_part(attachment_key,'/',1)=v_owner::text)
     OR EXISTS (SELECT 1 FROM public.payment_events WHERE split_part(receipt_key,'/',1)=v_owner::text) THEN
    RAISE EXCEPTION 'T4 synthetic owner/key namespace collision';
  END IF;
  INSERT INTO pg_temp.t4_meta(owner_id,wrong_token,missing_request_id,missing_document_id)
    VALUES (v_owner,gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
  IF EXISTS (SELECT 1 FROM public.storage_deletion_requests r,pg_temp.t4_meta m WHERE r.id=m.missing_request_id)
     OR EXISTS (SELECT 1 FROM public.documents d,pg_temp.t4_meta m WHERE d.id=m.missing_document_id) THEN
    RAISE EXCEPTION 'T4 generated absent-ID collision';
  END IF;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','service_role','sub',v_owner)::text,true);
  WITH spec(label,r2,attempts,expiry,fin) AS (VALUES
    ('block','uncertain',1,'live','pending'),('retry','uncertain',1,'live','pending'),
    ('max','uncertain',3,'live','pending'),('above','uncertain',5,'live','pending'),
    ('clamp_zero','uncertain',1,'live','pending'),('clamp_negative','uncertain',1,'live','pending'),
    ('clamp_null','uncertain',1,'live','pending'),('confirmed','confirmed_absent',2,'live','pending'),
    ('flow','uncertain',2,'live','pending'),('selective','confirmed_absent',2,'live','pending'),
    ('missing_docs','confirmed_absent',2,'live','pending'),('done','confirmed_absent',2,'live','done'),
    ('expired','uncertain',1,'expired','pending'),('expired_final','confirmed_absent',2,'expired','pending'),
    ('boundary','uncertain',1,'boundary','pending'),('boundary_final','confirmed_absent',2,'boundary','pending'),
    ('unleased','uncertain',1,'none','pending'),('unleased_final','confirmed_absent',2,'none','pending'),
    ('null_live','uncertain',1,'live','pending'),('null_final','confirmed_absent',2,'live','pending')
  ), inserted AS (
    INSERT INTO public.storage_deletion_requests
      (id,storage_key,owner_id,requested_by,status,r2_state,finalize_state,attempt_count,
       lease_token,lease_expires_at,block_reason,last_error,created_at,updated_at,finalized_at,quota_resynced_at)
    SELECT gen_random_uuid(),v_owner::text||'/t4-lifecycle/'||s.label,v_owner,v_owner,
      CASE WHEN s.fin='done' THEN 'deleted' WHEN s.r2='confirmed_absent' THEN 'finalizing' ELSE 'deleting' END,
      s.r2,s.fin,s.attempts,CASE WHEN s.expiry='none' THEN NULL ELSE gen_random_uuid() END,
      CASE s.expiry WHEN 'live' THEN now()+interval '5 minutes' WHEN 'expired' THEN now()-interval '1 second' WHEN 'boundary' THEN now() ELSE NULL END,
      'T4 synthetic block marker','T4 synthetic error marker',now()-interval '3 hours',now()-interval '2 hours',
      CASE WHEN s.fin='done' THEN now()-interval '2 hours' END,
      CASE WHEN s.fin='done' THEN now()-interval '2 hours' END FROM spec s
    RETURNING *
  )
  INSERT INTO pg_temp.t4_requests(label,id,storage_key,stale_token,issued_token,expected)
    SELECT split_part(i.storage_key,'/',3),i.id,i.storage_key,i.lease_token,i.lease_token,to_jsonb(i) FROM inserted i;
  IF (SELECT count(*) FROM pg_temp.t4_requests)<>20 THEN RAISE EXCEPTION 'T4 expected twenty request fixtures'; END IF;
  -- Synthetic lease rollover only: stale_token really was installed, then replaced.
  -- This is NOT a test of claim/reclaim RPCs or of simultaneous workers.
  WITH rolled AS (
    UPDATE public.storage_deletion_requests r SET lease_token=gen_random_uuid()
     WHERE r.id IN (SELECT id FROM pg_temp.t4_requests) AND r.owner_id=v_owner AND r.lease_token IS NOT NULL
    RETURNING r.*
  ) UPDATE pg_temp.t4_requests f SET expected=to_jsonb(r),issued_token=r.lease_token FROM rolled r WHERE r.id=f.id;
  IF EXISTS (SELECT 1 FROM pg_temp.t4_requests f,pg_temp.t4_meta m
       WHERE f.issued_token IS NOT NULL AND (f.issued_token=f.stale_token OR f.issued_token=m.wrong_token OR f.stale_token=m.wrong_token)) THEN
    RAISE EXCEPTION 'T4 generated token collision';
  END IF;
  WITH spec(label,request_label) AS (VALUES
       ('flow_doc','flow'),('selective_captured','selective'),('selective_uncaptured','selective'),
       ('selective_moved','selective-other-key'),('unrelated','unrelated-doc')),
  inserted AS (
    INSERT INTO public.documents(id,user_id,doc_type,storage_key,file_name,mime_type,size_bytes,verified,created_at)
    SELECT gen_random_uuid(),v_owner,'govt_id',v_owner::text||'/t4-lifecycle/'||s.request_label,
      'T4-synthetic-'||s.label||'.txt','application/octet-stream',0,false,now() FROM spec s
    RETURNING *
  ) INSERT INTO pg_temp.t4_documents(label,id,expected)
      SELECT substring(i.file_name FROM 14 FOR length(i.file_name)-17),i.id,to_jsonb(i) FROM inserted i;
  IF (SELECT count(*) FROM pg_temp.t4_documents)<>5 THEN RAISE EXCEPTION 'T4 expected five document fixtures'; END IF;
  IF (SELECT array_agg(label ORDER BY label) FROM pg_temp.t4_documents)
     IS DISTINCT FROM ARRAY['flow_doc','selective_captured','selective_moved','selective_uncaptured','unrelated']::text[] THEN
    RAISE EXCEPTION 'T4 document-label extraction mismatch';
  END IF;
  -- Exact capture IDs: same-key uncaptured row survives; captured moved-key row survives.
  WITH snapshots AS (
    SELECT 'flow'::text AS label,ARRAY[(SELECT id FROM pg_temp.t4_documents WHERE label='flow_doc')]::uuid[] AS ids
    UNION ALL SELECT 'selective',ARRAY[(SELECT id FROM pg_temp.t4_documents WHERE label='selective_captured'),
      (SELECT id FROM pg_temp.t4_documents WHERE label='selective_moved'),(SELECT missing_document_id FROM pg_temp.t4_meta)]::uuid[]
    UNION ALL SELECT 'missing_docs',ARRAY[(SELECT missing_document_id FROM pg_temp.t4_meta)]::uuid[]
  ), changed AS (
    UPDATE public.storage_deletion_requests r SET document_row_ids=s.ids
      FROM snapshots s JOIN pg_temp.t4_requests f ON f.label=s.label
     WHERE r.id=f.id AND r.owner_id=v_owner RETURNING r.*
  ) UPDATE pg_temp.t4_requests f SET expected=to_jsonb(r) FROM changed r WHERE r.id=f.id;
  PERFORM r.id FROM public.storage_deletion_requests r JOIN pg_temp.t4_requests f ON f.id=r.id FOR UPDATE OF r NOWAIT;
  PERFORM d.id FROM public.documents d JOIN pg_temp.t4_documents f ON f.id=d.id FOR UPDATE OF d NOWAIT;
  PERFORM pg_temp.t4_guard();
END;
$setup$;

-- 1-8: actual authenticated SQL role ACLs, then privileged-caller internal gates.
WITH ops(op,label,n) AS (VALUES ('block','block',1),('failure','retry',2),('confirm','flow',3),('finalize','selective',4)),
     modes(mode,offset_n) AS (VALUES ('acl',0),('internal',4))
INSERT INTO pg_temp.t4_plan(case_no,title,mode,op,label,expected_sqlstate,expected_return)
SELECT m.offset_n+o.n,m.mode||' authorization: '||o.op,m.mode,o.op,o.label,'42501','null'::jsonb FROM ops o CROSS JOIN modes m;
-- 9-32: all four RPCs, wrong/stale token, expired/equal-time lease, no lease and missing ID.
WITH ops(op,label,n) AS (VALUES ('block','block',1),('failure','retry',2),('confirm','flow',3),('finalize','selective',4)),
     modes(kind,offset_n) AS (VALUES ('wrong',8),('stale',12),('expired',16),('boundary',20),('unleased',24),('missing',28))
INSERT INTO pg_temp.t4_plan(case_no,title,mode,op,label,token_mode,expected_return)
SELECT m.offset_n+o.n,m.kind||': '||o.op,'state',o.op,
  CASE WHEN m.kind IN ('expired','boundary','unleased') THEN m.kind||CASE WHEN o.op='finalize' THEN '_final' ELSE '' END
       WHEN m.kind='missing' THEN '_missing' ELSE o.label END,
  CASE WHEN m.kind IN ('wrong','stale') THEN m.kind ELSE 'current' END,
  CASE WHEN o.op='failure' THEN 'null'::jsonb ELSE 'false'::jsonb END FROM ops o CROSS JOIN modes m;

-- 33-61: transitions, clipping, threshold/clamp boundaries, replay and selective deletion.
INSERT INTO pg_temp.t4_plan(case_no,title,mode,op,label,token_mode,reason,max_attempts,expected_return,expected_patch,delete_labels) VALUES
(33,'Correct block; clip reason; preserve attempts','state','block','block','current',repeat('B',240),3,'true',
 jsonb_build_object('status','blocked','block_reason',repeat('B',200),'lease_token',NULL,'lease_expires_at',NULL,'updated_at',now()),'{}'),
(34,'Block replay returns false','state','block','block','current','again',3,'false','{}','{}'),
(35,'Block refuses confirmed absence','state','block','confirmed','current','blocked',3,'false','{}','{}'),
(36,'Retry below threshold; clip error; no attempt increment','state','failure','retry','current',repeat('E',650),3,'"pending"',
 jsonb_build_object('r2_state','uncertain','status','pending','last_error',repeat('E',500),'lease_token',NULL,'lease_expires_at',NULL,'updated_at',now()),'{}'),
(37,'Failure replay returns SQL NULL','state','failure','retry','current','again',3,'null','{}','{}'),
(38,'At max attempts becomes failed','state','failure','max','current','threshold',3,'"failed"',
 jsonb_build_object('r2_state','uncertain','status','failed','last_error','threshold','lease_token',NULL,'lease_expires_at',NULL,'updated_at',now()),'{}'),
(39,'Above max attempts becomes failed','state','failure','above','current','above',3,'"failed"',
 jsonb_build_object('r2_state','uncertain','status','failed','last_error','above','lease_token',NULL,'lease_expires_at',NULL,'updated_at',now()),'{}'),
(40,'Zero maximum clamps to one','state','failure','clamp_zero','current','zero',0,'"failed"',
 jsonb_build_object('r2_state','uncertain','status','failed','last_error','zero','lease_token',NULL,'lease_expires_at',NULL,'updated_at',now()),'{}'),
(41,'Negative maximum clamps to one','state','failure','clamp_negative','current','negative',-2,'"failed"',
 jsonb_build_object('r2_state','uncertain','status','failed','last_error','negative','lease_token',NULL,'lease_expires_at',NULL,'updated_at',now()),'{}'),
(42,'NULL maximum resolves to one via GREATEST','state','failure','clamp_null','current','null maximum',NULL,'"failed"',
 jsonb_build_object('r2_state','uncertain','status','failed','last_error','null maximum','lease_token',NULL,'lease_expires_at',NULL,'updated_at',now()),'{}'),
(43,'Failure refuses confirmed absence','state','failure','confirmed','current','refused',3,'null','{}','{}'),
(44,'Finalization before confirmation refuses and preserves document','state','finalize','flow','current','unused',3,'false','{}','{}'),
(45,'SIMULATED confirmation preserves live lease and attempts','state','confirm','flow','current','unused',3,'true',
 jsonb_build_object('r2_state','confirmed_absent','status','finalizing','last_error',NULL,'updated_at',now()),'{}'),
(46,'Confirmation replay returns true under same live lease','state','confirm','flow','current','unused',3,'true','{}','{}'),
(47,'Finalize flow; delete only captured synthetic document','state','finalize','flow','current','unused',3,'true',
 jsonb_build_object('status','deleted','finalize_state','done','finalized_at',now(),'lease_token',NULL,'lease_expires_at',NULL,'updated_at',now()),ARRAY['flow_doc']),
(48,'Finalization replay returns false; complete state unchanged','state','finalize','flow','current','unused',3,'false','{}','{}'),
(49,'Old worker cannot fail finalized request','state','failure','flow','current','stale',3,'null','{}','{}'),
(50,'Old worker cannot block finalized request','state','block','flow','current','stale',3,'false','{}','{}'),
(51,'Old worker cannot reconfirm finalized request','state','confirm','flow','current','unused',3,'false','{}','{}'),
(52,'Confirm refuses done state even with live lease','state','confirm','done','current','unused',3,'false','{}','{}'),
(53,'Finalize refuses done state even with live lease','state','finalize','done','current','unused',3,'false','{}','{}'),
(54,'Selective finalize; moved, missing and uncaptured exclusions','state','finalize','selective','current','unused',3,'true',
 jsonb_build_object('status','deleted','finalize_state','done','finalized_at',now(),'lease_token',NULL,'lease_expires_at',NULL,'updated_at',now()),ARRAY['selective_captured']),
(55,'Selective finalization replay returns false','state','finalize','selective','current','unused',3,'false','{}','{}'),
(56,'Already-missing captured document allows finalization','state','finalize','missing_docs','current','unused',3,'true',
 jsonb_build_object('status','deleted','finalize_state','done','finalized_at',now(),'lease_token',NULL,'lease_expires_at',NULL,'updated_at',now()),'{}'),
(57,'Missing-document finalization replay returns false','state','finalize','missing_docs','current','unused',3,'false','{}','{}'),
(58,'NULL supplied token cannot block live lease','state','block','null_live','null','unused',3,'false','{}','{}'),
(59,'NULL supplied token cannot fail live lease','state','failure','null_live','null','unused',3,'null','{}','{}'),
(60,'NULL supplied token cannot confirm live lease','state','confirm','null_live','null','unused',3,'false','{}','{}'),
(61,'NULL supplied token cannot finalize live lease','state','finalize','null_final','null','unused',3,'false','{}','{}');

DO $cases$
DECLARE
  c record; v_id uuid; v_token uuid; v_meta record;
  v_return jsonb; v_bool boolean; v_text text; v_state text; v_message text;
BEGIN
  SELECT * INTO STRICT v_meta FROM pg_temp.t4_meta;
  IF (SELECT count(*) FROM pg_temp.t4_plan)<>61 THEN RAISE EXCEPTION 'T4 incomplete case plan'; END IF;
  FOR c IN SELECT * FROM pg_temp.t4_plan ORDER BY case_no LOOP
    -- Every guard is OUTSIDE the RPC exception block; never swallow a guard error.
    PERFORM pg_temp.t4_guard();
    IF c.label='_missing' THEN v_id:=v_meta.missing_request_id; v_token:=v_meta.wrong_token;
    ELSE
      SELECT id,CASE c.token_mode WHEN 'wrong' THEN v_meta.wrong_token WHEN 'stale' THEN stale_token
             WHEN 'null' THEN NULL ELSE issued_token END
        INTO STRICT v_id,v_token FROM pg_temp.t4_requests WHERE label=c.label;
    END IF;
    IF c.op='finalize' THEN PERFORM pg_temp.t4_delete_guard(v_id); END IF;
    IF c.mode='acl' THEN
      PERFORM set_config('request.jwt.claim.role','authenticated',true);
      PERFORM set_config('request.jwt.claim.sub',v_meta.owner_id::text,true);
      PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',v_meta.owner_id)::text,true);
      SET LOCAL ROLE authenticated;
    ELSIF c.mode='internal' THEN
      PERFORM set_config('request.jwt.claim.role','',true);
      PERFORM set_config('request.jwt.claim.sub','',true);
      PERFORM set_config('request.jwt.claims','{}',true);
      IF auth.role() IS NOT NULL THEN RAISE EXCEPTION 'T4 empty role simulation failed'; END IF;
    ELSE
      PERFORM set_config('request.jwt.claim.role','service_role',true);
      PERFORM set_config('request.jwt.claim.sub',v_meta.owner_id::text,true);
      PERFORM set_config('request.jwt.claims',jsonb_build_object('role','service_role','sub',v_meta.owner_id)::text,true);
      IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'T4 service-role simulation failed'; END IF;
    END IF;
    v_return:='null'::jsonb; v_state:='00000'; v_message:='';
    BEGIN
      CASE c.op
        WHEN 'block' THEN v_bool:=public.block_storage_deletion(v_id,v_token,c.reason); v_return:=coalesce(to_jsonb(v_bool),'null'::jsonb);
        WHEN 'failure' THEN v_text:=public.record_storage_deletion_failure(v_id,v_token,c.reason,c.max_attempts); v_return:=coalesce(to_jsonb(v_text),'null'::jsonb);
        WHEN 'confirm' THEN v_bool:=public.set_r2_confirmed_absent(v_id,v_token); v_return:=coalesce(to_jsonb(v_bool),'null'::jsonb);
        WHEN 'finalize' THEN v_bool:=public.finalize_storage_deletion(v_id,v_token); v_return:=coalesce(to_jsonb(v_bool),'null'::jsonb);
        ELSE RAISE EXCEPTION 'T4 unsupported operation';
      END CASE;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_message=MESSAGE_TEXT;
      IF v_state IN ('40001','40P01','55P03','57014') OR v_state<>c.expected_sqlstate THEN RAISE; END IF;
    END;
    RESET ROLE;
    IF v_state<>c.expected_sqlstate OR v_return IS DISTINCT FROM c.expected_return
       OR (c.mode='internal' AND v_message IS DISTINCT FROM 'Not allowed') THEN
      RAISE EXCEPTION 'T4 case % (%) unexpected SQLSTATE/return/internal gate result: %',c.case_no,c.title,v_state;
    END IF;
    -- Independent oracle updates; expected rows are NEVER recopied from actual rows after a case.
    UPDATE pg_temp.t4_requests SET expected=expected||c.expected_patch WHERE label=c.label;
    UPDATE pg_temp.t4_documents SET present=false WHERE label=ANY(c.delete_labels);
    PERFORM pg_temp.t4_guard();
    INSERT INTO pg_temp.t4_results VALUES(c.case_no,c.title,true,c.expected_sqlstate,v_state,c.expected_return,v_return,v_message);
  END LOOP;
  IF (SELECT count(*) FROM pg_temp.t4_results)<>61
     OR (SELECT count(*) FROM pg_temp.t4_requests)<>20
     OR (SELECT count(*) FROM pg_temp.t4_documents)<>5
     OR (SELECT count(*) FROM pg_temp.t4_documents WHERE present)<>3
     OR (SELECT guard_checks FROM pg_temp.t4_meta)<>123 THEN
    RAISE EXCEPTION 'T4 case/state/guard cardinality mismatch';
  END IF;
END;
$cases$;

-- One final result set: the established CLI returns this JSON before ROLLBACK.
SELECT jsonb_build_object(
  'test','T4','scope','TEST synthetic metadata/state-machine only; no R2 or parallel-worker proof',
  'overall_verdict',CASE WHEN (SELECT count(*)=61 AND bool_and(passed) FROM pg_temp.t4_results)
       AND (SELECT count(*)=20 FROM pg_temp.t4_requests)
       AND (SELECT count(*)=5 FROM pg_temp.t4_documents)
       AND (SELECT count(*)=3 FROM pg_temp.t4_documents WHERE present)
       AND (SELECT guard_checks=123 FROM pg_temp.t4_meta)
       AND NOT EXISTS (SELECT 1 FROM pg_temp.t4_requests f LEFT JOIN public.storage_deletion_requests r ON r.id=f.id
                       WHERE f.expected IS DISTINCT FROM to_jsonb(r))
       AND NOT EXISTS (SELECT 1 FROM pg_temp.t4_documents f LEFT JOIN public.documents d ON d.id=f.id
                       WHERE (f.present AND f.expected IS DISTINCT FROM to_jsonb(d)) OR (NOT f.present AND d.id IS NOT NULL))
       AND NOT EXISTS (SELECT 1 FROM (
         (SELECT storage_key,row_state FROM pg_temp.t4_fences_before EXCEPT SELECT storage_key,to_jsonb(f) FROM public.storage_deletion_fences f)
         UNION ALL
         (SELECT storage_key,to_jsonb(f) FROM public.storage_deletion_fences f EXCEPT SELECT storage_key,row_state FROM pg_temp.t4_fences_before)) delta)
       THEN 'PASS' ELSE 'FAIL' END,
  'case_count',(SELECT count(*) FROM pg_temp.t4_results),
  'case_results',(SELECT jsonb_agg(jsonb_build_object('case_no',n,'title',coalesce(r.title,'MISSING CASE'),
      'passed',coalesce(r.passed,false),'expected_sqlstate',r.expected_sqlstate,'actual_sqlstate',r.actual_sqlstate,
      'expected_return',r.expected_return,'actual_return',r.actual_return,'message',r.message) ORDER BY n)
      FROM generate_series(1,61) n LEFT JOIN pg_temp.t4_results r ON r.case_no=n),
  'request_states',(SELECT jsonb_agg(jsonb_build_object('label',f.label,'passed',f.expected=to_jsonb(r),
      'expected_row',f.expected,'actual_row',to_jsonb(r)) ORDER BY f.label)
      FROM pg_temp.t4_requests f LEFT JOIN public.storage_deletion_requests r ON r.id=f.id),
  'document_states',(SELECT jsonb_agg(jsonb_build_object('label',f.label,'expected_present',f.present,
      'passed',CASE WHEN f.present THEN f.expected=to_jsonb(d) ELSE d.id IS NULL END,
      'expected_row',CASE WHEN f.present THEN f.expected ELSE NULL END,'actual_row',to_jsonb(d)) ORDER BY f.label)
      FROM pg_temp.t4_documents f LEFT JOIN public.documents d ON d.id=f.id),
  'guard_checks',(SELECT guard_checks FROM pg_temp.t4_meta),
  'documents_expected_deleted',2,'documents_expected_surviving',3,
  'fence_difference_count',(SELECT count(*) FROM (
       (SELECT storage_key,row_state FROM pg_temp.t4_fences_before EXCEPT SELECT storage_key,to_jsonb(f) FROM public.storage_deletion_fences f)
       UNION ALL
       (SELECT storage_key,to_jsonb(f) FROM public.storage_deletion_fences f EXCEPT SELECT storage_key,row_state FROM pg_temp.t4_fences_before)) d),
  'limitations',jsonb_build_array('R2 absence only simulated','No claim/batch/fence RPC invoked',
       'No parallel-worker contention test','No injected DELETE-suppression trigger or exception rollback fault',
       'No end-to-end Worker or quota resync test')
) AS t4_report;
ROLLBACK;
