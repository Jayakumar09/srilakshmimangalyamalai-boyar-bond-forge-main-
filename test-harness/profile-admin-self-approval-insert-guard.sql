-- =============================================================================
-- profile-admin-self-approval-insert-guard.sql
--
-- LOCAL / TEST DATABASE ONLY. Never run this against production.
-- It creates synthetic fixtures and ends in ROLLBACK, so it commits nothing.
--
-- Purpose: prove the INSERT-side admin self-approval fix in
--   supabase/migrations/20260926130000_profile_admin_self_approval_insert_guard.sql
-- closes the hole where an authenticated admin could insert their OWN profile
-- row with status = 'approved' or 'rejected'.
--
-- Why the hole existed (both layers failed for admins):
--   * "admins full profiles" is FOR ALL with WITH CHECK has_role(auth.uid(),'admin').
--     Permissive policies are OR'd, so it alone satisfies the INSERT and the
--     status='pending' requirement of "own profile insert" never applies.
--   * profiles_client_field_guard() returned NEW early for admins (v_trusted),
--     skipping its own "Clients may only create pending profiles" check.
--
-- Cases covered:
--   1. normal member INSERT                          -> allowed
--   2. admin inserting ANOTHER user's profile         -> allowed (unchanged)
--   3. admin inserting their OWN approved profile    -> rejected
--   4. admin inserting their OWN rejected profile    -> rejected
--   5. admin inserting their OWN pending profile     -> allowed (not an approval)
--   6. service-role INSERT                           -> unchanged
--   7. after 3/4/5 the admin's own row is not left approved (no partial write)
--
-- Each case resets its target row first, because the real attack requires the
-- row to be absent: profiles.id is the primary key, and a leftover row from an
-- earlier case would otherwise mask the result with 23505.
--
-- Exits 0 when every case matches expectations, non-zero otherwise.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE guard_result (
  case_no   int,
  case_name text,
  expected  text,
  observed  text,
  passed    boolean
) ON COMMIT DROP;

GRANT INSERT, SELECT ON guard_result TO authenticated, service_role;

-- Helper: attempt one INSERT as the CURRENT role and record the outcome.
-- Deliberately SECURITY INVOKER (the default) so the INSERT, and therefore the
-- BEFORE INSERT trigger, sees the real caller identity. A SECURITY DEFINER
-- helper here would make current_user privileged and invalidate the test.
--
-- p_expect is either 'allowed' (the row must exist with p_status afterwards) or
-- 'rejected' (the INSERT must fail with p_status used as the required message
-- fragment). SQLSTATE is asserted separately so a coincidental error message
-- cannot make a case pass.
CREATE OR REPLACE FUNCTION pg_temp.record_insert(
  p_case_no   int,
  p_case_name text,
  p_expect    text,
  p_id        uuid,
  p_status    public.approval_status
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_observed   text;
  v_actual     public.approval_status;
  v_expected   text;
  v_sqlstate   text;
  v_message    text;
  v_blocked    boolean := false;
BEGIN
  IF p_expect NOT IN ('allowed', 'rejected') THEN
    RAISE EXCEPTION 'bad p_expect: %', p_expect;
  END IF;

  IF p_expect = 'allowed' THEN
    v_expected := 'allowed, status=' || p_status::text;
  ELSE
    v_expected := 'rejected: 42501 ' || p_status::text;
  END IF;

  -- One exception handler for the whole body: a bare BEGIN ... END block nested
  -- inside an IF cannot carry its own EXCEPTION clause in PL/pgSQL.
  BEGIN
    INSERT INTO public.profiles (id, email, full_name, status)
    VALUES (p_id, 'x@invalid.test', 'Fixture', p_status);
  EXCEPTION WHEN others THEN
    v_blocked   := true;
    v_sqlstate  := SQLSTATE;
    v_message   := SQLERRM;
  END;

  IF v_blocked THEN
    v_observed := v_sqlstate || ': ' || v_message;

    -- Passes only when the guard itself refused the write, identified by both
    -- the SQLSTATE and the message text, so an unrelated failure cannot pass.
    INSERT INTO guard_result
    VALUES (p_case_no, p_case_name, v_expected, v_observed,
            p_expect = 'rejected'
            AND v_sqlstate = '42501'
            AND v_message LIKE '%Admins cannot approve or reject their own profile%');
  ELSE
    SELECT status INTO v_actual FROM public.profiles WHERE id = p_id;
    v_observed := 'allowed, status=' || COALESCE(v_actual::text, 'NULL');

    INSERT INTO guard_result
    VALUES (p_case_no, p_case_name, v_expected, v_observed,
            p_expect = 'allowed' AND v_actual = p_status);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION pg_temp.record_insert(int, text, text, uuid, public.approval_status)
  TO authenticated, service_role;

-- Synthetic fixtures. Deliberately NOT inserted into auth.users: profiles has no
-- FK to auth.users, and the guard reads caller identity from the JWT claim GUCs
-- exactly as it does for a real PostgREST request.
INSERT INTO public.user_roles (user_id, role) VALUES
  ('11111111-1111-4111-8111-111111111111', 'admin'),
  ('22222222-2222-4222-8222-222222222222', 'client'),
  ('33333333-3333-4333-8333-333333333333', 'client');

GRANT INSERT ON public.profiles TO authenticated;

-- ---------------------------------------------------------------------------
-- CASE 1: normal member registration, own row, status = pending -> allowed.
-- This is the ordinary signup path and must never be affected.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',  '33333333-3333-4333-8333-333333333333', true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claim.email','member@invalid.test', true);

SELECT pg_temp.record_insert(
  1, 'normal member INSERT pending',
  'allowed',
  '33333333-3333-4333-8333-333333333333', 'pending');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- CASE 2: admin creates ANOTHER member's profile as approved -> allowed.
-- This is the CreateClientProfileDialog / admin-profiles edge-function flow and
-- must keep working: only the admin's OWN row is protected.
-- ---------------------------------------------------------------------------
DELETE FROM public.profiles WHERE id = '22222222-2222-4222-8222-222222222222';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',  '11111111-1111-4111-8111-111111111111', true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claim.email','admin@invalid.test', true);

SELECT pg_temp.record_insert(
  2, 'admin inserts ANOTHER user approved',
  'allowed',
  '22222222-2222-4222-8222-222222222222', 'approved');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- CASE 3: admin inserts their OWN profile as approved -> rejected
-- ---------------------------------------------------------------------------
DELETE FROM public.profiles WHERE id = '11111111-1111-4111-8111-111111111111';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',  '11111111-1111-4111-8111-111111111111', true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claim.email','admin@invalid.test', true);

SELECT pg_temp.record_insert(
  3, 'admin inserts OWN profile approved',
  'rejected',
  '11111111-1111-4111-8111-111111111111', 'approved');

-- ---------------------------------------------------------------------------
-- CASE 4: admin inserts their OWN profile as rejected -> rejected
-- ---------------------------------------------------------------------------
DELETE FROM public.profiles WHERE id = '11111111-1111-4111-8111-111111111111';

SELECT pg_temp.record_insert(
  4, 'admin inserts OWN profile rejected',
  'rejected',
  '11111111-1111-4111-8111-111111111111', 'rejected');

-- ---------------------------------------------------------------------------
-- CASE 7: after the blocked self-approval attempts, the admin's own row must not
-- be approved or rejected. A blocked INSERT must leave nothing behind, so the
-- row is either absent (correct) or still pending. This also proves no partial
-- write leaked through.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_status public.approval_status;
BEGIN
  SELECT status INTO v_status FROM public.profiles
   WHERE id = '11111111-1111-4111-8111-111111111111';

  IF v_status IN ('approved'::public.approval_status,
                  'rejected'::public.approval_status) THEN
    INSERT INTO guard_result
    VALUES (7, 'no self-approved row after blocked attempts',
            'absent or pending', 'status=' || v_status::text, false);
  ELSE
    INSERT INTO guard_result
    VALUES (7, 'no self-approved row after blocked attempts',
            'absent or pending',
            COALESCE('status=' || v_status::text, 'absent'), true);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- CASE 5: admin inserts their OWN profile as pending -> allowed.
-- Matches the existing intended registration rules: a row that starts pending is
-- not an approval, and handle_new_user() itself inserts pending rows. Run after
-- case 7 so the assertion above sees the state left by cases 3 and 4.
-- ---------------------------------------------------------------------------
DELETE FROM public.profiles WHERE id = '11111111-1111-4111-8111-111111111111';

SELECT pg_temp.record_insert(
  5, 'admin inserts OWN profile pending',
  'allowed',
  '11111111-1111-4111-8111-111111111111', 'pending');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- CASE 6: service-role INSERT of an approved row -> allowed.
-- Service role runs privileged and must be completely unaffected.
-- ---------------------------------------------------------------------------
DELETE FROM public.profiles WHERE id = '11111111-1111-4111-8111-111111111111';
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub',  '11111111-1111-4111-8111-111111111111', true),
       set_config('request.jwt.claim.role', 'service_role', true);

SELECT pg_temp.record_insert(
  6, 'service role inserts approved',
  'allowed',
  '11111111-1111-4111-8111-111111111111', 'approved');
RESET ROLE;

\echo ''
\echo '--- admin self-approval INSERT guard results ---'
SELECT case_no, case_name, expected, observed, passed
FROM guard_result
ORDER BY case_no;

DO $$
DECLARE
  v_failed int;
  v_total  int;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*)
    INTO v_failed, v_total
    FROM guard_result;

  IF v_failed > 0 THEN
    RAISE EXCEPTION '% of % admin self-approval INSERT guard test case(s) FAILED',
      v_failed, v_total;
  END IF;

  RAISE NOTICE 'All % admin self-approval INSERT guard test cases passed', v_total;
END;
$$;

ROLLBACK;
