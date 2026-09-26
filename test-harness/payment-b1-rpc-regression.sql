-- payment-b1-rpc-regression.sql
--
-- Dedicated regression test for the Payment B1 atomic verification RPC:
--   public.verify_payment(text, uuid, text)
--
-- Migration under test:
--   supabase/migrations/20260925130000_payment_b1_atomic.sql
--
-- Test cases:
--   A  successful verification (standard/premium)
--   B  replay/idempotency returns already_processed
--   C  invalid/missing payment returns no-match
--   D  already-verified payment returns already_processed (not exception)
--   E  anon/authenticated cannot execute; service_role can
--   F  cleanup restores baseline
--
-- Run against LOCAL/TEST database ONLY:
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f test-harness/payment-b1-rpc-regression.sql

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Results table
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE b1_test_results (
  case_no   int PRIMARY KEY,
  case_name text NOT NULL,
  expected  text NOT NULL,
  observed  text NOT NULL,
  passed    boolean NOT NULL
) ON COMMIT DROP;

GRANT INSERT, SELECT ON b1_test_results TO anon, authenticated, service_role;

-- Helper to record a test result
CREATE OR REPLACE FUNCTION pg_temp.record_result(
  p_case_no   int,
  p_case_name text,
  p_expected  text,
  p_observed  text,
  p_passed    boolean
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO b1_test_results (case_no, case_name, expected, observed, passed)
  VALUES (p_case_no, p_case_name, p_expected, p_observed, p_passed);
END;
$$;

GRANT EXECUTE ON FUNCTION pg_temp.record_result(int, text, text, text, boolean)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures: scratch users
-- ---------------------------------------------------------------------------
INSERT INTO public.profiles (id, email, full_name, status, membership_plan, submitted_at, consent_accepted_at)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'b1-admin@invalid.test', 'B1 Admin', 'pending', 'free', now(), now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b1-member@invalid.test', 'B1 Member', 'pending', 'free', now(), now());

INSERT INTO public.user_roles (user_id, role)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'client');

-- ---------------------------------------------------------------------------
-- CASE A: Successful verification of a standard payment
-- ---------------------------------------------------------------------------
INSERT INTO public.payments (id, user_id, item, amount_inr, method, status, gateway_order_id)
VALUES
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'standard', 5000, 'razorpay', 'submitted', 'b1_order_A1');

DO $$
DECLARE
  v_result RECORD;
  v_plan public.membership_plan;
  v_until date;
  v_notif_count int;
  v_event_count int;
BEGIN
  PERFORM set_config('role', 'service_role', false);

  SELECT * INTO v_result
  FROM public.verify_payment('b1_order_A1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b1_payid_A1');

  IF v_result.payment_id IS NULL OR v_result.verified IS NOT TRUE OR v_result.already_processed IS NOT FALSE THEN
    PERFORM pg_temp.record_result(1, 'successful verification', 'verified=true, already_processed=false, payment_id=set',
      'payment_id=' || COALESCE(v_result.payment_id::text, 'NULL') || ', verified=' || COALESCE(v_result.verified::text, 'NULL') || ', already_processed=' || COALESCE(v_result.already_processed::text, 'NULL'), false);
  ELSE
    SELECT membership_plan, plan_valid_until INTO v_plan, v_until
    FROM public.profiles WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    -- The verify_payment RPC casts payment_item to membership_plan internally
    -- via: SET membership_plan = v_payment.item (assignment cast works for matching enum labels)

    SELECT count(*) INTO v_notif_count
    FROM public.notifications
    WHERE related_user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' AND kind = 'payment_online';

    SELECT count(*) INTO v_event_count
    FROM public.payment_events
    WHERE payment_id = v_result.payment_id AND kind = 'PAYMENT_VERIFIED';

    IF v_plan = 'standard' AND v_until IS NOT NULL
       AND v_notif_count = 1 AND v_event_count = 1 THEN
      PERFORM pg_temp.record_result(1, 'successful verification', 'verified=true, plan=standard, notif=1, event=1',
        'plan=' || v_plan::text || ', until=' || COALESCE(v_until::text, 'NULL') || ', notif=' || v_notif_count || ', event=' || v_event_count, true);
    ELSE
      PERFORM pg_temp.record_result(1, 'successful verification', 'verified=true, plan=standard, notif=1, event=1',
        'plan=' || COALESCE(v_plan::text, 'NULL') || ', until=' || COALESCE(v_until::text, 'NULL') || ', notif=' || v_notif_count || ', event=' || v_event_count, false);
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.record_result(1, 'successful verification', 'verified=true, plan=standard, notif=1, event=1',
    'EXCEPTION: ' || SQLERRM, false);
END $$;

-- ---------------------------------------------------------------------------
-- CASE B: Replay/idempotency - calling again returns already_processed=true
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_result RECORD;
  v_event_count int;
BEGIN
  PERFORM set_config('role', 'service_role', false);

  SELECT * INTO v_result
  FROM public.verify_payment('b1_order_A1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b1_payid_A1');

  SELECT count(*) INTO v_event_count
  FROM public.payment_events
  WHERE payment_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' AND kind = 'PAYMENT_VERIFIED';

  IF v_result.verified IS NOT FALSE OR v_result.already_processed IS NOT TRUE OR v_event_count <> 1 THEN
    PERFORM pg_temp.record_result(2, 'replay returns already_processed', 'verified=false, already_processed=true, event_count=1',
      'verified=' || COALESCE(v_result.verified::text, 'NULL') || ', already_processed=' || COALESCE(v_result.already_processed::text, 'NULL') || ', event_count=' || v_event_count, false);
  ELSE
    PERFORM pg_temp.record_result(2, 'replay returns already_processed', 'verified=false, already_processed=true, event_count=1',
      'verified=false, already_processed=true, event_count=1', true);
  END IF;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.record_result(2, 'replay returns already_processed', 'verified=false, already_processed=true, event_count=1',
    'EXCEPTION: ' || SQLERRM, false);
END $$;

-- ---------------------------------------------------------------------------
-- CASE C: Invalid/missing payment (wrong gateway_order_id)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_result RECORD;
BEGIN
  PERFORM set_config('role', 'service_role', false);

  SELECT * INTO v_result
  FROM public.verify_payment('nonexistent_order', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'fake_payid');

  IF v_result.payment_id IS NOT NULL OR v_result.verified IS NOT FALSE OR v_result.already_processed IS NOT FALSE THEN
    PERFORM pg_temp.record_result(3, 'nonexistent payment returns no-match', 'payment_id=NULL, verified=false, already_processed=false',
      'payment_id=' || COALESCE(v_result.payment_id::text, 'NULL') || ', verified=' || COALESCE(v_result.verified::text, 'NULL') || ', already_processed=' || COALESCE(v_result.already_processed::text, 'NULL'), false);
  ELSE
    PERFORM pg_temp.record_result(3, 'nonexistent payment returns no-match', 'payment_id=NULL, verified=false, already_processed=false',
      'payment_id=NULL, verified=false, already_processed=false', true);
  END IF;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.record_result(3, 'nonexistent payment returns no-match', 'payment_id=NULL, verified=false, already_processed=false',
    'EXCEPTION: ' || SQLERRM, false);
END $$;

-- ---------------------------------------------------------------------------
-- CASE D: Already-verified payment returns already_processed (per implementation)
-- ---------------------------------------------------------------------------
INSERT INTO public.payments (id, user_id, item, amount_inr, method, status, gateway_order_id, gateway_payment_id, verified_at)
VALUES
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'premium', 10000, 'razorpay', 'verified', 'b1_order_D1', 'b1_payid_D1', now());

DO $$
DECLARE
  v_result RECORD;
BEGIN
  PERFORM set_config('role', 'service_role', false);

  SELECT * INTO v_result
  FROM public.verify_payment('b1_order_D1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b1_payid_D1');

  IF v_result.verified IS NOT FALSE OR v_result.already_processed IS NOT TRUE THEN
    PERFORM pg_temp.record_result(4, 'verified payment returns already_processed', 'verified=false, already_processed=true',
      'verified=' || COALESCE(v_result.verified::text, 'NULL') || ', already_processed=' || COALESCE(v_result.already_processed::text, 'NULL'), false);
  ELSE
    PERFORM pg_temp.record_result(4, 'verified payment returns already_processed', 'verified=false, already_processed=true',
      'verified=false, already_processed=true', true);
  END IF;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.record_result(4, 'verified payment returns already_processed', 'verified=false, already_processed=true',
    'EXCEPTION: ' || SQLERRM, false);
END $$;

-- ---------------------------------------------------------------------------
-- CASE E: Privilege enforcement - anon/authenticated blocked, service_role allowed
-- ---------------------------------------------------------------------------

-- E1: anon should be blocked
SET LOCAL ROLE anon;
DO $$
DECLARE
  v_result RECORD;
  v_sqlstate text;
  v_msg text;
BEGIN
  BEGIN
    SELECT * INTO v_result
    FROM public.verify_payment('b1_order_A1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b1_payid_A1');
    PERFORM pg_temp.record_result(5, 'anon EXECUTE blocked', '42501 permission denied',
      'unexpectedly succeeded: verified=' || COALESCE(v_result.verified::text, 'NULL'), false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    IF v_sqlstate = '42501' THEN
      PERFORM pg_temp.record_result(5, 'anon EXECUTE blocked', '42501 permission denied',
        v_sqlstate || ': ' || v_msg, true);
    ELSE
      PERFORM pg_temp.record_result(5, 'anon EXECUTE blocked', '42501 permission denied',
        v_sqlstate || ': ' || v_msg, false);
    END IF;
  END;
END $$;
RESET ROLE;

-- E2: authenticated should be blocked
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
DO $$
DECLARE
  v_result RECORD;
  v_sqlstate text;
  v_msg text;
BEGIN
  BEGIN
    SELECT * INTO v_result
    FROM public.verify_payment('b1_order_A1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b1_payid_A1');
    PERFORM pg_temp.record_result(6, 'authenticated EXECUTE blocked', '42501 permission denied',
      'unexpectedly succeeded: verified=' || COALESCE(v_result.verified::text, 'NULL'), false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    IF v_sqlstate = '42501' THEN
      PERFORM pg_temp.record_result(6, 'authenticated EXECUTE blocked', '42501 permission denied',
        v_sqlstate || ': ' || v_msg, true);
    ELSE
      PERFORM pg_temp.record_result(6, 'authenticated EXECUTE blocked', '42501 permission denied',
        v_sqlstate || ': ' || v_msg, false);
    END IF;
  END;
END $$;
RESET ROLE;

-- E3: service_role should succeed
SET LOCAL ROLE service_role;
DO $$
DECLARE
  v_result RECORD;
BEGIN
  INSERT INTO public.payments (id, user_id, item, amount_inr, method, status, gateway_order_id)
  VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'premium', 10000, 'razorpay', 'submitted', 'b1_order_E3');

  SELECT * INTO v_result
  FROM public.verify_payment('b1_order_E3', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'b1_payid_E3');

  IF v_result.verified IS TRUE AND v_result.already_processed IS FALSE THEN
    PERFORM pg_temp.record_result(7, 'service_role EXECUTE allowed', 'verified=true, already_processed=false',
      'verified=true, already_processed=false', true);
  ELSE
    PERFORM pg_temp.record_result(7, 'service_role EXECUTE allowed', 'verified=true, already_processed=false',
      'verified=' || COALESCE(v_result.verified::text, 'NULL') || ', already_processed=' || COALESCE(v_result.already_processed::text, 'NULL'), false);
  END IF;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.record_result(7, 'service_role EXECUTE allowed', 'verified=true, already_processed=false',
    'EXCEPTION: ' || SQLERRM, false);
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- CASE F: Cleanup - verify only scratch records were touched
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_payment_count int;
  v_event_count int;
BEGIN
  DELETE FROM public.payment_events WHERE payment_id IN (
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  );
  DELETE FROM public.notifications WHERE related_user_id IN (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ) AND kind = 'payment_online';
  DELETE FROM public.payments WHERE id IN (
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  );
  DELETE FROM public.user_roles WHERE user_id IN (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  );
  DELETE FROM public.profiles WHERE id IN (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  );

  SELECT count(*) INTO v_payment_count FROM public.payments WHERE id IN (
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  );
  SELECT count(*) INTO v_event_count FROM public.payment_events WHERE payment_id IN (
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  );

  PERFORM pg_temp.record_result(8, 'cleanup restores baseline', 'all scratch records removed',
    'payments_remaining=' || v_payment_count || ', events_remaining=' || v_event_count,
    v_payment_count = 0 AND v_event_count = 0);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.record_result(8, 'cleanup restores baseline', 'all scratch records removed',
    'EXCEPTION: ' || SQLERRM, false);
END $$;

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
SELECT
  case_no,
  case_name,
  expected,
  observed,
  CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result
FROM b1_test_results
ORDER BY case_no;

DO $$
DECLARE
  v_total int;
  v_passed int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE passed) INTO v_total, v_passed FROM b1_test_results;
  IF v_passed = v_total THEN
    RAISE NOTICE 'B1 RPC REGRESSION: %/% PASS', v_passed, v_total;
  ELSE
    RAISE EXCEPTION 'B1 RPC REGRESSION: %/% FAILED', v_passed, v_total;
  END IF;
END $$;

ROLLBACK;