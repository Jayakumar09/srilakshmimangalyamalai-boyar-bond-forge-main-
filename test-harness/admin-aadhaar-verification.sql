-- Aadhaar Admin Verification Test
-- Tests Aadhaar document verification flow against local database
-- Run against slmm_e3_test only

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

-- Create test documents for member1
INSERT INTO public.documents (id, user_id, doc_type, id_kind, storage_key, file_name, mime_type, size_bytes, verified, ai_check_status, created_at)
VALUES
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'govt_id', 'Aadhaar', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/govt_id/test-aadhaar-1.pdf', 'aadhaar-1.pdf', 'application/pdf', 102400, false, 'not_run', now()),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'govt_id', 'PAN', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/govt_id/test-pan-1.pdf', 'pan-1.pdf', 'image/png', 51200, true, 'pass', now()),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'govt_id', 'Aadhaar', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc/govt_id/test-aadhaar-2.pdf', 'aadhaar-2.pdf', 'application/pdf', 102400, false, 'review', now());

-- ===========================================================================
-- TEST 1: Admin can see Aadhaar documents for any member
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
  WHERE doc_type = 'govt_id' AND id_kind = 'Aadhaar';
  
  RAISE NOTICE 'TEST 1 - Admin can see Aadhaar docs: % (expected >= 2)', v_count;
  IF v_count >= 2 THEN
    RAISE NOTICE 'TEST 1: PASS';
  ELSE
    RAISE EXCEPTION 'TEST 1: FAIL - Expected at least 2 Aadhaar docs';
  END IF;
END $$;

-- ===========================================================================
-- TEST 2: Admin can filter by id_kind = 'Aadhaar'
-- ===========================================================================
DO $$
DECLARE
  v_count int;
  v_id_kind text;
BEGIN
  SELECT count(*), MAX(id_kind) INTO v_count, v_id_kind
  FROM public.documents
  WHERE doc_type = 'govt_id' AND id_kind = 'Aadhaar';
  
  RAISE NOTICE 'TEST 2 - Aadhaar filter: count=%, id_kind=%', v_count, v_id_kind;
  IF v_count = 2 AND v_id_kind = 'Aadhaar' THEN
    RAISE NOTICE 'TEST 2: PASS';
  ELSE
    RAISE EXCEPTION 'TEST 2: FAIL';
  END IF;
END $$;

-- ===========================================================================
-- TEST 3: Admin can view document details including verification state
-- ===========================================================================
DO $$
DECLARE
  v_verified boolean;
  v_ai_status text;
  v_face_score numeric;
BEGIN
  SELECT verified, ai_check_status, ai_face_match_score INTO v_verified, v_ai_status, v_face_score
  FROM public.documents
  WHERE id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  
  RAISE NOTICE 'TEST 3 - Document details: verified=%, ai_status=%, face_score=%', v_verified, v_ai_status, v_face_score;
  IF v_verified = true AND v_ai_status = 'pass' THEN
    RAISE NOTICE 'TEST 3: PASS';
  ELSE
    RAISE EXCEPTION 'TEST 3: FAIL';
  END IF;
END $$;

-- ===========================================================================
-- TEST 4: Non-admin cannot access another member's documents
-- ===========================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claim.email', 'member2@test.local', true);

DO $$
DECLARE
  v_count int;
BEGIN
  -- Client can only see their own documents due to RLS
  SELECT count(*) INTO v_count
  FROM public.documents
  WHERE user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  
  RAISE NOTICE 'TEST 4 - Non-admin accessing other member docs: count=%', v_count;
  IF v_count = 0 THEN
    RAISE NOTICE 'TEST 4: PASS (RLS blocks access)';
  ELSE
    RAISE EXCEPTION 'TEST 4: FAIL - Should be blocked by RLS';
  END IF;
END $$;

-- ===========================================================================
-- TEST 5: Client can access their own Aadhaar document
-- ===========================================================================
DO $$
DECLARE
  v_count int;
  v_id_kind text;
BEGIN
  SELECT count(*), MAX(id_kind) INTO v_count, v_id_kind
  FROM public.documents
  WHERE user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' AND doc_type = 'govt_id';
  
  RAISE NOTICE 'TEST 5 - Client own docs: count=%, id_kind=%', v_count, v_id_kind;
  IF v_count = 1 AND v_id_kind = 'Aadhaar' THEN
    RAISE NOTICE 'TEST 5: PASS';
  ELSE
    RAISE EXCEPTION 'TEST 5: FAIL';
  END IF;
END $$;

-- ===========================================================================
-- TEST 6: R2 storage path follows correct format
-- ===========================================================================
-- Reset to admin role (TEST 5 ran as member2)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claim.email', 'admin@test.local', true);

DO $$
DECLARE
  v_storage_key text;
BEGIN
  SELECT storage_key INTO v_storage_key
  FROM public.documents
  WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  
  RAISE NOTICE 'TEST 6 - Storage key format: %', v_storage_key;
  IF v_storage_key LIKE 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/govt_id/%' THEN
    RAISE NOTICE 'TEST 6: PASS (correct R2 path format)';
  ELSE
    RAISE EXCEPTION 'TEST 6: FAIL - Unexpected storage path format';
  END IF;
END $$;

-- ===========================================================================
-- TEST 7: Aadhaar verification state updates correctly
-- ===========================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claim.email', 'admin@test.local', true);

DO $$
DECLARE
  v_verified boolean;
BEGIN
  -- Simulate admin marking document as verified
  UPDATE public.documents
  SET verified = true, ai_check_status = 'pass'
  WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  
  SELECT verified INTO v_verified
  FROM public.documents
  WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  
  RAISE NOTICE 'TEST 7 - Verification state update: verified=%', v_verified;
  IF v_verified = true THEN
    RAISE NOTICE 'TEST 7: PASS';
  ELSE
    RAISE EXCEPTION 'TEST 7: FAIL';
  END IF;
END $$;

-- ===========================================================================
-- TEST 8: R2 view URL generation (simulated - just check key format)
-- ===========================================================================
DO $$
DECLARE
  v_key text;
  v_signed_url text;
BEGIN
  -- Verify the storage key format that would be used for R2 URL generation
  SELECT storage_key INTO v_key
  FROM public.documents
  WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  
  -- The createViewUrl function generates a signed R2 URL
  -- We can't test actual R2 signing without credentials, but verify key format
  IF v_key LIKE 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/govt_id/%' THEN
    RAISE NOTICE 'TEST 8: PASS (key format valid for R2 URL generation)';
  ELSE
    RAISE EXCEPTION 'TEST 8: FAIL';
  END IF;
END $$;

-- ===========================================================================
-- TEST 9: Document deletion removes both R2 reference and DB row
-- ===========================================================================
DO $$
DECLARE
  v_count int;
  v_doc_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.documents (id, user_id, doc_type, id_kind, storage_key, file_name, mime_type, size_bytes)
  VALUES (v_doc_id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'govt_id', 'Aadhaar', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/govt_id/test-delete.pdf', 'delete-test.pdf', 'application/pdf', 1024);
  
  SELECT count(*) INTO v_count FROM public.documents WHERE id = v_doc_id;
  IF v_count = 1 THEN
    RAISE NOTICE 'TEST 9a - Document created: PASS';
  ELSE
    RAISE EXCEPTION 'TEST 9a: FAIL';
  END IF;
  
  DELETE FROM public.documents WHERE id = v_doc_id;
  SELECT count(*) INTO v_count FROM public.documents WHERE id = v_doc_id;
  IF v_count = 0 THEN
    RAISE NOTICE 'TEST 9b - Document deleted: PASS';
  ELSE
    RAISE EXCEPTION 'TEST 9b: FAIL';
  END IF;
END $$;

-- ===========================================================================
-- TEST 10: Reload persistence - document state survives "reload"
-- ===========================================================================
DO $$
DECLARE
  v_verified boolean;
  v_ai_status text;
BEGIN
  -- Query again after "reload" simulation
  SELECT verified, ai_check_status INTO v_verified, v_ai_status
  FROM public.documents
  WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  
  RAISE NOTICE 'TEST 10 - Persistence after reload: verified=%, ai_status=%', v_verified, v_ai_status;
  IF v_verified = true AND v_ai_status = 'pass' THEN
    RAISE NOTICE 'TEST 10: PASS';
  ELSE
    RAISE EXCEPTION 'TEST 10: FAIL';
  END IF;
END $$;

-- ===========================================================================
-- TEST 11: Document metadata integrity - original values preserved
-- ===========================================================================
DO $$
DECLARE
  v_file_name text;
  v_mime_type text;
  v_size_bytes bigint;
  v_id_kind text;
BEGIN
  SELECT file_name, mime_type, size_bytes, id_kind
  INTO v_file_name, v_mime_type, v_size_bytes, v_id_kind
  FROM public.documents
  WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  
  RAISE NOTICE 'TEST 11 - Metadata: file=%, mime=%, size=%, kind=%', v_file_name, v_mime_type, v_size_bytes, v_id_kind;
  IF v_file_name = 'aadhaar-1.pdf' AND v_mime_type = 'application/pdf' AND v_size_bytes = 102400 AND v_id_kind = 'Aadhaar' THEN
    RAISE NOTICE 'TEST 11: PASS';
  ELSE
    RAISE EXCEPTION 'TEST 11: FAIL';
  END IF;
END $$;

-- ===========================================================================
-- CLEANUP: Remove all test fixtures
-- ===========================================================================
DELETE FROM public.documents WHERE user_id IN ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
DELETE FROM public.user_roles WHERE user_id IN ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
DELETE FROM public.profiles WHERE id IN ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');

RAISE NOTICE 'All tests completed. Cleanup performed.';

ROLLBACK;