BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- T5 PRE-EXECUTION PREFLIGHT. READ ONLY. No writes, no DDL, no external calls.
--
-- Run this FIRST, on a connection you have INDEPENDENTLY confirmed targets TEST
-- (project nqadtfqyurkpmxcodswc). It inspects the live catalog only: identity,
-- the installed storage-deletion/fence function bodies, their ownership and ACLs,
-- the fence trigger set, an empty foreign eligible-deletion set and a clean
-- synthetic namespace. A clean pass means the reviewed code is installed and the
-- database is safe to run the T5 harness against; it does NOT prove the project
-- identity (a GUC acknowledgement is not server identity; verify the endpoint
-- yourself).
--
-- This script never writes. It raises on any failed precondition.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog, pg_temp;

DO $preflight$
DECLARE
  v_owner constant uuid := 'f3b42871-9f60-4d7a-bd70-7c62f13ab3f0';
  v_other constant uuid := 'a1c9e6d2-7b34-4f8a-9c01-2d5e7f9a1b34';
  v_admin constant uuid := 'b2d0f7e3-8c45-4a9b-8d12-3e6f8a0b2c45';
  v_pins jsonb;
  v_summary jsonb;
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres'
     OR current_setting('transaction_isolation') <> 'repeatable read'
     OR current_setting('slmm.t5.target_project', true) IS DISTINCT FROM 'nqadtfqyurkpmxcodswc' THEN
    RAISE EXCEPTION 'T5 preflight: requires verified TEST postgres session, slmm.t5.target_project acknowledgement and a read-only REPEATABLE READ transaction';
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
    RAISE EXCEPTION 'T5 preflight: installed function-body fingerprint mismatch; the database does not hold the reviewed code. Actual: %', v_pins::text;
  END IF;

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
    RAISE EXCEPTION 'T5 preflight: owner/definer/search_path drift on a verified function';
  END IF;

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
    RAISE EXCEPTION 'T5 preflight: authorization ACL drift';
  END IF;

  IF (SELECT count(*) FROM pg_trigger t
       WHERE NOT t.tgisinternal AND t.tgname IN (
         'documents_50_storage_key_fence','payments_50_proof_key_fence','jathagam_requests_50_report_key_fence',
         'support_messages_50_attachment_key_fence','profiles_50_photo_url_fence','payment_events_50_receipt_key_fence')) <> 6
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.documents'::regclass AND (tgtype & 8) <> 0) THEN
    RAISE EXCEPTION 'T5 preflight: fence trigger set or document DELETE trigger drift';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.storage_deletion_requests r
     WHERE r.status IN ('pending','deleting','blocked','finalizing')
       AND (r.lease_expires_at IS NULL OR r.lease_expires_at < now())
       AND (r.status <> 'blocked' OR r.updated_at < now() - interval '1 hour')
  ) THEN
    RAISE EXCEPTION 'T5 preflight: foreign eligible deletion work already exists; the exact global eligible-ID guard could not distinguish it from T5 fixtures';
  END IF;

  IF EXISTS (SELECT 1 FROM public.storage_deletion_requests r
               WHERE r.owner_id IN ('f3b42871-9f60-4d7a-bd70-7c62f13ab3f0','a1c9e6d2-7b34-4f8a-9c01-2d5e7f9a1b34','b2d0f7e3-8c45-4a9b-8d12-3e6f8a0b2c45')
                  OR r.requested_by IN ('f3b42871-9f60-4d7a-bd70-7c62f13ab3f0','a1c9e6d2-7b34-4f8a-9c01-2d5e7f9a1b34','b2d0f7e3-8c45-4a9b-8d12-3e6f8a0b2c45')
                  OR split_part(r.storage_key,'/',1) = 'f3b42871-9f60-4d7a-bd70-7c62f13ab3f0')
     OR EXISTS (SELECT 1 FROM public.storage_deletion_fences f WHERE split_part(f.storage_key,'/',1) = 'f3b42871-9f60-4d7a-bd70-7c62f13ab3f0')
     OR EXISTS (SELECT 1 FROM public.documents d WHERE d.user_id IN ('f3b42871-9f60-4d7a-bd70-7c62f13ab3f0','a1c9e6d2-7b34-4f8a-9c01-2d5e7f9a1b34','b2d0f7e3-8c45-4a9b-8d12-3e6f8a0b2c45') OR split_part(d.storage_key,'/',1) = 'f3b42871-9f60-4d7a-bd70-7c62f13ab3f0')
     OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id IN ('f3b42871-9f60-4d7a-bd70-7c62f13ab3f0','a1c9e6d2-7b34-4f8a-9c01-2d5e7f9a1b34','b2d0f7e3-8c45-4a9b-8d12-3e6f8a0b2c45') OR split_part(coalesce(p.photo_url,''),'/',1) = 'f3b42871-9f60-4d7a-bd70-7c62f13ab3f0')
     OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id IN ('f3b42871-9f60-4d7a-bd70-7c62f13ab3f0','a1c9e6d2-7b34-4f8a-9c01-2d5e7f9a1b34','b2d0f7e3-8c45-4a9b-8d12-3e6f8a0b2c45'))
     OR EXISTS (SELECT 1 FROM public.payments p WHERE split_part(coalesce(p.proof_key,''),'/',1) = 'f3b42871-9f60-4d7a-bd70-7c62f13ab3f0')
     OR EXISTS (SELECT 1 FROM public.jathagam_requests j WHERE split_part(coalesce(j.report_key,''),'/',1) = 'f3b42871-9f60-4d7a-bd70-7c62f13ab3f0')
     OR EXISTS (SELECT 1 FROM public.support_threads st WHERE st.user_id IN ('f3b42871-9f60-4d7a-bd70-7c62f13ab3f0','a1c9e6d2-7b34-4f8a-9c01-2d5e7f9a1b34','b2d0f7e3-8c45-4a9b-8d12-3e6f8a0b2c45'))
     OR EXISTS (SELECT 1 FROM public.support_messages m WHERE split_part(coalesce(m.attachment_key,''),'/',1) = 'f3b42871-9f60-4d7a-bd70-7c62f13ab3f0')
     OR EXISTS (SELECT 1 FROM public.payment_events e WHERE split_part(coalesce(e.receipt_key,''),'/',1) = 'f3b42871-9f60-4d7a-bd70-7c62f13ab3f0') THEN
    RAISE EXCEPTION 'T5 preflight: synthetic namespace collision; run the residue check';
  END IF;

  RAISE NOTICE 'T5 preflight OK: %', jsonb_build_object(
    'project_ref', current_setting('slmm.t5.target_project', true),
    'isolation', current_setting('transaction_isolation'),
    'pins_verified', (SELECT count(*) FROM jsonb_object_keys(v_pins)),
    'fence_triggers', (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname LIKE '%_50_%_fence')
  )::text;
END;
$preflight$;

ROLLBACK;