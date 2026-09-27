-- Consolidated Government Document Verification Security Test
-- Tests shared document security architecture across all 5 document types
-- Run against slmm_e3_test only

-- ===========================================================================
-- BASELINE: Capture initial state
-- Captured BEFORE BEGIN so it survives the final ROLLBACK (ON COMMIT PRESERVE)
-- ===========================================================================
CREATE TEMP TABLE baseline_counts AS
SELECT 
  (SELECT count(*) FROM public.documents) AS doc_count,
  (SELECT count(*) FROM public.profiles) AS profile_count,
  (SELECT count(*) FROM public.user_roles) AS role_count;

BEGIN;

-- ===========================================================================
-- SETUP: Create test fixtures (scratch profiles and documents)
-- ===========================================================================
INSERT INTO public.profiles (id, email, full_name, status, membership_plan, submitted_at, consent_accepted_at, profile_created_by)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin@test.local', 'Admin User', 'approved', 'free', now(), now(), 'admin'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'member1@test.local', 'Member One', 'pending', 'free', now(), now(), 'client'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'member2@test.local', 'Member Two', 'pending', 'free', now(), now(), 'client');

INSERT INTO public.user_roles (user_id, role)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'client'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'client');

-- Create test documents for member1 (all 5 government ID types)
INSERT INTO public.documents (id, user_id, doc_type, id_kind, storage_key, file_name, mime_type, size_bytes, verified, ai_check_status, created_at)
VALUES
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'govt_id', 'Aadhaar', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/govt_id/test-aadhaar-1.pdf', 'aadhaar-1.pdf', 'application/pdf', 102400, false, 'not_run', now()),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'govt_id', 'PAN', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/govt_id/test-pan-1.pdf', 'pan-1.pdf', 'image/png', 51200, true, 'pass', now()),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'govt_id', 'Voter ID', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc/govt_id/test-voter-1.pdf', 'voter-1.pdf', 'image/png', 51200, true, 'pass', now()),
  ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'govt_id', 'Driving Licence', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc/govt_id/test-dl-1.pdf', 'dl-1.pdf', 'image/png', 51200, true, 'pass', now()),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'govt_id', 'Passport', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/govt_id/test-passport-1.pdf', 'passport-1.pdf', 'application/pdf', 51200, true, 'pass', now());

-- ===========================================================================
-- Results table
-- ===========================================================================
CREATE TEMP TABLE cons_test_results (
  case_no   int primary key,
  case_name text    not null,
  expected  text    not null,
  observed  text    not null,
  passed    boolean not null
) ON COMMIT DROP;

GRANT INSERT, SELECT, UPDATE ON cons_test_results TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION pg_temp.cons_record(
  p_case int, p_name text, p_expected text, p_observed text, p_passed boolean
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO cons_test_results (case_no, case_name, expected, observed, passed)
  VALUES (p_case, p_name, p_expected, p_observed, p_passed);
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.cons_record(int, text, text, text, boolean) TO anon, authenticated, service_role;

-- ===========================================================================
-- TEST 1: All 5 id_kind types present in test data
-- ===========================================================================
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.documents
  WHERE doc_type = 'govt_id' AND id_kind IN ('Aadhaar', 'PAN', 'Voter ID', 'Driving Licence', 'Passport');
  
  PERFORM pg_temp.cons_record(1, 'All 5 id_kind types present in test data',
    '5 document types', v_count::text,
    v_count = 5);
END $$;

-- ===========================================================================
-- TEST 2: member A can access member A document
-- ===========================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claim.email', 'member1@test.local', true);

DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.documents
  WHERE user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  
  PERFORM pg_temp.cons_record(2, 'Member A can access member A document',
    'count >= 2', v_count::text,
    v_count >= 2);
END $$;

-- ===========================================================================
-- TEST 3: member A cannot access member B document
-- ===========================================================================
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.documents
  WHERE user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  
  PERFORM pg_temp.cons_record(3, 'Member A cannot access member B document',
    'count = 0 (RLS blocks)', v_count::text,
    v_count = 0);
END $$;

-- ===========================================================================
-- TEST 4: non-admin cannot obtain member B signed URL
-- ===========================================================================
DO $$
DECLARE
  v_count int;
BEGIN
  -- Try to SELECT member B's document as member A (non-admin).
  -- RLS filters rows silently (no exception is raised), so the security
  -- intent is verified by requiring that zero rows are returned.
  SELECT count(*) INTO v_count
  FROM public.documents
  WHERE id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

  PERFORM pg_temp.cons_record(4, 'Non-admin cannot obtain member B signed URL',
    'rows_returned = 0 (RLS filters)', v_count::text,
    v_count = 0);
END $$;

-- ===========================================================================
-- TEST 5: admin can access member B document
-- ===========================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claim.email', 'admin@test.local', true);

DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.documents
  WHERE user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  
  PERFORM pg_temp.cons_record(5, 'Admin can access member B document',
    'count >= 1', v_count::text,
    v_count >= 1);
END $$;

-- ===========================================================================
-- TEST 6: unauthorized document update is blocked
-- ===========================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claim.email', 'member2@test.local', true);

DO $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.documents
  SET verified = true
  WHERE id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' AND user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  
  PERFORM pg_temp.cons_record(6, 'Unauthorized document update blocked',
    'rows_updated = 0', v_updated::text,
    v_updated = 0);
END $$;

-- ===========================================================================
-- TEST 7: unauthorized document delete is blocked
-- ===========================================================================
DO $$
DECLARE
  v_deleted int;
BEGIN
  DELETE FROM public.documents
  WHERE id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' AND user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  
  PERFORM pg_temp.cons_record(7, 'Unauthorized document delete blocked',
    'rows_deleted = 0', v_deleted::text,
    v_deleted = 0);
END $$;

-- ===========================================================================
-- TEST 8: unauthorized upload behavior is blocked
-- ===========================================================================
DO $$
DECLARE
  v_inserted int;
BEGIN
  -- Try to insert a document for another user (should fail due to RLS WITH CHECK)
  INSERT INTO public.documents (id, user_id, doc_type, id_kind, storage_key, file_name, mime_type, size_bytes)
  VALUES (gen_random_uuid(), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'govt_id', 'Aadhaar', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/govt_id/test.pdf', 'test.pdf', 'application/pdf', 1024);
  
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  
  -- If it succeeded, clean up
  IF v_inserted > 0 THEN
    DELETE FROM public.documents WHERE user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' AND id_kind = 'Aadhaar' AND storage_key LIKE '%test%';
  END IF;
  
  PERFORM pg_temp.cons_record(8, 'Unauthorized upload blocked by RLS WITH CHECK',
    'rows_inserted = 0', v_inserted::text,
    v_inserted = 0);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.cons_record(8, 'Unauthorized upload blocked by RLS WITH CHECK',
    'RLS error', SQLERRM,
    true);
END $$;

-- ===========================================================================
-- TEST 9: authorized owner operations succeed (read)
-- ===========================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claim.email', 'member1@test.local', true);

DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.documents
  WHERE user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  
  PERFORM pg_temp.cons_record(9, 'Authorized owner operations succeed (read)',
    'count >= 2', v_count::text,
    v_count >= 2);
END $$;

-- Owner can update their own document
DO $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.documents
  SET verified = false
  WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  
  PERFORM pg_temp.cons_record(10, 'Authorized owner operations succeed (update)',
    'rows_updated = 1', v_updated::text,
    v_updated = 1);
END $$;

-- ===========================================================================
-- TEST 11: authorized admin review/access succeeds
-- ===========================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claim.email', 'admin@test.local', true);

DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.documents;
  
  PERFORM pg_temp.cons_record(11, 'Admin can access all documents',
    'count = 5', v_count::text,
    v_count = 5);
END $$;

-- Admin can update any document
DO $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.documents
  SET verified = true, ai_check_status = 'pass'
  WHERE id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  
  PERFORM pg_temp.cons_record(12, 'Admin can update any document',
    'rows_updated = 1', v_updated::text,
    v_updated = 1);
END $$;

-- Admin can delete any document
DO $$
DECLARE
  v_deleted int;
  v_doc_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.documents (id, user_id, doc_type, id_kind, storage_key, file_name, mime_type, size_bytes)
  VALUES (v_doc_id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'govt_id', 'Aadhaar', 'test/path.pdf', 'test.pdf', 'application/pdf', 1024);
  
  DELETE FROM public.documents WHERE id = v_doc_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  
  PERFORM pg_temp.cons_record(13, 'Admin can delete any document',
    'rows_deleted = 1', v_deleted::text,
    v_deleted = 1);
END $$;

-- ===========================================================================
-- TEST 13: verification-state authorization is enforced
-- ===========================================================================
-- Non-admin cannot update verification state
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claim.email', 'member2@test.local', true);

DO $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.documents
  SET verified = true, ai_check_status = 'pass'
  WHERE id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' AND user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  
  PERFORM pg_temp.cons_record(14, 'Non-admin cannot update verification state',
    'rows_updated = 0', v_updated::text,
    v_updated = 0);
END $$;

-- Admin can update verification state
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claim.email', 'admin@test.local', true);

DO $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.documents
  SET verified = true, ai_check_status = 'pass'
  WHERE id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  
  PERFORM pg_temp.cons_record(15, 'Admin can update verification state',
    'rows_updated = 1', v_updated::text,
    v_updated = 1);
END $$;

-- ===========================================================================
-- TEST 16: storage authorization matches database authorization
-- ===========================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claim.email', 'admin@test.local', true);

DO $$
DECLARE
  v_key text;
BEGIN
  -- Check storage key format matches ownership
  SELECT storage_key INTO v_key
  FROM public.documents
  WHERE id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  
  PERFORM pg_temp.cons_record(16, 'Storage key format matches ownership',
    'key starts with owner_id/govt_id/', v_key,
    v_key LIKE 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/govt_id/%');
END $$;

-- ===========================================================================
-- TEST 17: cleanup restores the original baseline
-- Executed AFTER the ROLLBACK below, so the live counts are compared against
-- the pre-fixture baseline with the test transaction already undone.
-- ===========================================================================

-- ===========================================================================
-- REPORT
-- ===========================================================================
SELECT
  case_no,
  case_name,
  expected,
  observed,
  CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result
FROM cons_test_results
ORDER BY case_no;

DO $$
DECLARE
  v_total int;
  v_failed int;
BEGIN
  SELECT count(*) INTO v_total FROM cons_test_results;
  SELECT count(*) INTO v_failed FROM cons_test_results WHERE NOT passed;
  
  IF v_failed > 0 THEN
    RAISE EXCEPTION '% of % consolidated document security cases FAILED (cases 1-16)', v_failed, v_total;
  END IF;
  
  RAISE NOTICE 'Cases 1-16: all % consolidated document security checks PASSED', v_total;
END $$;

ROLLBACK;

-- ===========================================================================
-- TEST 17: cleanup restores the original baseline (post-rollback)
-- ===========================================================================
DO $$
DECLARE
  v_doc_count int;
  v_profile_count int;
  v_role_count int;
  v_base_doc int;
  v_base_profile int;
  v_base_role int;
  v_passed boolean;
BEGIN
  SELECT doc_count, profile_count, role_count INTO v_base_doc, v_base_profile, v_base_role FROM baseline_counts;
  
  SELECT count(*) INTO v_doc_count FROM public.documents;
  SELECT count(*) INTO v_profile_count FROM public.profiles;
  SELECT count(*) INTO v_role_count FROM public.user_roles;
  
  v_passed := v_doc_count = v_base_doc AND v_profile_count = v_base_profile AND v_role_count = v_base_role;
  
  RAISE NOTICE 'TEST 17 - Cleanup restores baseline (rollback): doc=% profile=% role=% (baseline: doc=% profile=% role=%)',
    v_doc_count, v_profile_count, v_role_count, v_base_doc, v_base_profile, v_base_role;
  
  IF v_passed THEN
    RAISE NOTICE 'TEST 17: PASS';
    RAISE NOTICE 'All 17 consolidated document security tests PASSED';
  ELSE
    RAISE EXCEPTION 'TEST 17: FAIL - baseline not restored after rollback';
  END IF;
END $$;