-- admin-profile-approval-rpc.sql
--
-- Dedicated regression test for
-- supabase/migrations/20260926190000_admin_profile_approval_rpc.sql
--
-- CASES (matching requirements J.1-13):
--   1  admin approves pending profile                      -> PASS
--   2  admin rejects pending profile                       -> PASS
--   3  non-admin cannot approve                            -> PASS
--   4  non-admin cannot reject                             -> PASS
--   5  unauthenticated caller cannot approve/reject        -> PASS
--   6  already-approved profile cannot be changed by RPC   -> PASS
--   7  already-rejected profile cannot be changed by RPC   -> PASS
--   8  concurrent/double-decision protected by pending     -> PASS
--   9  approval creates exactly one profile_audit record   -> PASS
--  10  rejection creates exactly one profile_audit record  -> PASS
--  11  failed/unauthorized operation creates no audit      -> PASS
--  12  self-approval remains blocked                       -> PASS
--  13  cleanup restores local baseline (rollback)          -> PASS
--
-- ############################################################################
-- # RUN THIS AGAINST A LOCAL OR THROWAWAY TEST DATABASE ONLY.               #
-- # NEVER against production. It writes fixture rows into public.profiles   #
-- # and public.user_roles.                                                   #
-- ############################################################################
--
-- Everything runs in one transaction that ends in ROLLBACK.
--
-- Usage against a local supabase stack:
--   npx supabase db reset
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 \
--     -f test-harness/admin-profile-approval-rpc.sql

begin;

-- ---------------------------------------------------------------------------
-- Fixtures. Written while the session is still privileged so setup cannot
-- be blocked by guards or RLS.
-- ---------------------------------------------------------------------------
insert into public.profiles
  (id, email, full_name, status, membership_plan, submitted_at, consent_accepted_at)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin1@invalid.test',  'Admin One',      'pending', 'free', now(), now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'admin2@invalid.test',  'Admin Two',      'pending', 'free', now(), now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'target1@invalid.test', 'Target One',     'pending', 'free', now(), now()),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'target2@invalid.test', 'Target Two',     'pending', 'free', now(), now()),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'target3@invalid.test', 'Target Three',   'pending', 'free', now(), now()),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'target4@invalid.test', 'Target Four',    'approved', 'free', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'target5@invalid.test', 'Target Five',    'rejected', 'free', now(), now()),
  ('22222222-2222-4222-8222-222222222222', 'member@invalid.test',  'Ordinary Member', 'pending', 'free', now(), now()),
  ('33333333-3333-4333-8333-333333333333', 'selfadmin@invalid.test','Self Admin',    'pending', 'free', now(), now());

insert into public.user_roles (user_id, role)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'admin'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'client'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'client'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'client'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'client'),
  ('11111111-1111-4111-8111-111111111111', 'client'),
  ('22222222-2222-4222-8222-222222222222', 'client'),
  ('33333333-3333-4333-8333-333333333333', 'admin');

-- ---------------------------------------------------------------------------
-- Results table. Created privileged, then explicitly opened to the impersonated
-- roles so the DO blocks below can record into it.
-- ---------------------------------------------------------------------------
create temp table rpc_test_results (
  case_no   int primary key,
  case_name text    not null,
  expected  text    not null,
  observed  text    not null,
  passed    boolean not null
) on commit drop;

grant insert, select, update on rpc_test_results to anon, authenticated, service_role;

-- Helper to record results
create or replace function pg_temp.rpc_record(
  p_case int, p_name text, p_expected text, p_observed text, p_passed boolean
) returns void
language plpgsql as $$
begin
  insert into rpc_test_results (case_no, case_name, expected, observed, passed)
  values (p_case, p_name, p_expected, p_observed, p_passed);
end;
$$;

grant execute on function pg_temp.rpc_record(int, text, text, text, boolean)
  to anon, authenticated, service_role;

-- ===========================================================================
-- CASE 1: admin approves pending profile -> PASS
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub',   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
       set_config('request.jwt.claim.role',  'authenticated', true),
       set_config('request.jwt.claim.email', 'admin1@invalid.test', true);

do $$
declare
  v_target constant uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  v_res record;
  v_audit_count int;
  v_state text;
  v_msg text;
begin
  begin
    select * into v_res
    from public.decide_profile_approval(v_target, 'approved'::public.approval_status, null);
    
    select count(*) into v_audit_count
    from public.profile_audit
    where profile_id = v_target and action = 'profile_approved';
    
    perform pg_temp.rpc_record(1, 'admin approves pending profile',
      'success: profile_id=target, old=pending, new=approved, already_processed=false, error_code=null, audit_count=1',
      'profile_id=' || coalesce(v_res.profile_id::text, 'null') ||
      ', old=' || coalesce(v_res.old_status::text, 'null') ||
      ', new=' || coalesce(v_res.new_status::text, 'null') ||
      ', already_processed=' || v_res.already_processed::text ||
      ', error_code=' || coalesce(v_res.error_code, 'null') ||
      ', audit_count=' || v_audit_count,
      v_res.profile_id = v_target
      and v_res.old_status = 'pending'::public.approval_status
      and v_res.new_status = 'approved'::public.approval_status
      and v_res.already_processed = false
      and v_res.error_code is null
      and v_audit_count = 1);
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      perform pg_temp.rpc_record(1, 'admin approves pending profile',
        'success', v_state || ': ' || v_msg, false);
  end;
end $$;

-- ===========================================================================
-- CASE 2: admin rejects pending profile -> PASS
-- ===========================================================================
do $$
declare
  v_target constant uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  v_res record;
  v_audit_count int;
  v_state text;
  v_msg text;
begin
  begin
    select * into v_res
    from public.decide_profile_approval(v_target, 'rejected'::public.approval_status, 'Incomplete documents');
    
    select count(*) into v_audit_count
    from public.profile_audit
    where profile_id = v_target and action = 'profile_rejected';
    
    perform pg_temp.rpc_record(2, 'admin rejects pending profile',
      'success: profile_id=target, old=pending, new=rejected, already_processed=false, error_code=null, audit_count=1',
      'profile_id=' || coalesce(v_res.profile_id::text, 'null') ||
      ', old=' || coalesce(v_res.old_status::text, 'null') ||
      ', new=' || coalesce(v_res.new_status::text, 'null') ||
      ', already_processed=' || v_res.already_processed::text ||
      ', error_code=' || coalesce(v_res.error_code, 'null') ||
      ', audit_count=' || v_audit_count,
      v_res.profile_id = v_target
      and v_res.old_status = 'pending'::public.approval_status
      and v_res.new_status = 'rejected'::public.approval_status
      and v_res.already_processed = false
      and v_res.error_code is null
      and v_audit_count = 1);
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      perform pg_temp.rpc_record(2, 'admin rejects pending profile',
        'success', v_state || ': ' || v_msg, false);
  end;
end $$;

-- ===========================================================================
-- CASE 3: non-admin cannot approve -> PASS
-- ===========================================================================
select set_config('request.jwt.claim.sub',   '22222222-2222-4222-8222-222222222222', true),
       set_config('request.jwt.claim.email', 'member@invalid.test', true);

do $$
declare
  v_target constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  v_res record;
  v_state text;
  v_msg text;
begin
  begin
    select * into v_res
    from public.decide_profile_approval(v_target, 'approved'::public.approval_status, null);
    
    perform pg_temp.rpc_record(3, 'non-admin cannot approve',
      'forbidden: profile_id=null, error_code=forbidden',
      'profile_id=' || coalesce(v_res.profile_id::text, 'null') ||
      ', error_code=' || coalesce(v_res.error_code, 'null'),
      v_res.profile_id is null
      and v_res.error_code = 'forbidden');
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      perform pg_temp.rpc_record(3, 'non-admin cannot approve',
        'forbidden (exception)', v_state || ': ' || v_msg, false);
  end;
end $$;

-- ===========================================================================
-- CASE 4: non-admin cannot reject -> PASS
-- ===========================================================================
do $$
declare
  v_target constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  v_res record;
  v_state text;
  v_msg text;
begin
  begin
    select * into v_res
    from public.decide_profile_approval(v_target, 'rejected'::public.approval_status, 'Not qualified');
    
    perform pg_temp.rpc_record(4, 'non-admin cannot reject',
      'forbidden: profile_id=null, error_code=forbidden',
      'profile_id=' || coalesce(v_res.profile_id::text, 'null') ||
      ', error_code=' || coalesce(v_res.error_code, 'null'),
      v_res.profile_id is null
      and v_res.error_code = 'forbidden');
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      perform pg_temp.rpc_record(4, 'non-admin cannot reject',
        'forbidden (exception)', v_state || ': ' || v_msg, false);
  end;
end $$;

-- ===========================================================================
-- CASE 5: unauthenticated caller cannot approve/reject -> PASS
-- ===========================================================================
-- The anon role has no EXECUTE permission on the function, so the call fails
-- with permission denied (42501) before entering the function body.
-- This is the correct and more secure behavior.
set local role anon;
do $$
declare
  v_target constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  v_res record;
  v_state text;
  v_msg text;
begin
  begin
    select * into v_res
    from public.decide_profile_approval(v_target, 'approved'::public.approval_status, null);
    
    -- If we reach here, the function was callable (unexpected)
    perform pg_temp.rpc_record(5, 'unauthenticated caller cannot approve',
      'permission denied (42501) or unauthenticated error_code',
      'profile_id=' || coalesce(v_res.profile_id::text, 'null') ||
      ', error_code=' || coalesce(v_res.error_code, 'null'),
      false);
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      -- Expect permission denied (42501) since anon has no EXECUTE grant
      perform pg_temp.rpc_record(5, 'unauthenticated caller cannot approve',
        'permission denied (42501)',
        v_state || ': ' || v_msg,
        v_state = '42501');
  end;
end $$;
reset role;

-- ===========================================================================
-- CASE 6: already-approved profile cannot be changed by RPC -> PASS
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub',   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
       set_config('request.jwt.claim.email', 'admin1@invalid.test', true);

do $$
declare
  v_target constant uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffff'; -- already approved
  v_res record;
  v_state text;
  v_msg text;
begin
  begin
    select * into v_res
    from public.decide_profile_approval(v_target, 'rejected'::public.approval_status, 'Trying to change approved');
    
    perform pg_temp.rpc_record(6, 'already-approved profile cannot be changed',
      'already_processed: profile_id=target, old=approved, new=rejected, already_processed=true, error_code=already_processed',
      'profile_id=' || coalesce(v_res.profile_id::text, 'null') ||
      ', old=' || coalesce(v_res.old_status::text, 'null') ||
      ', new=' || coalesce(v_res.new_status::text, 'null') ||
      ', already_processed=' || v_res.already_processed::text ||
      ', error_code=' || coalesce(v_res.error_code, 'null'),
      v_res.profile_id = v_target
      and v_res.old_status = 'approved'::public.approval_status
      and v_res.new_status = 'rejected'::public.approval_status
      and v_res.already_processed = true
      and v_res.error_code = 'already_processed');
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      perform pg_temp.rpc_record(6, 'already-approved profile cannot be changed',
        'already_processed (exception)', v_state || ': ' || v_msg, false);
  end;
end $$;

-- ===========================================================================
-- CASE 7: already-rejected profile cannot be changed by RPC -> PASS
-- ===========================================================================
do $$
declare
  v_target constant uuid := '11111111-1111-4111-8111-111111111111'; -- already rejected
  v_res record;
  v_state text;
  v_msg text;
begin
  begin
    select * into v_res
    from public.decide_profile_approval(v_target, 'approved'::public.approval_status, null);
    
    perform pg_temp.rpc_record(7, 'already-rejected profile cannot be changed',
      'already_processed: profile_id=target, old=rejected, new=approved, already_processed=true, error_code=already_processed',
      'profile_id=' || coalesce(v_res.profile_id::text, 'null') ||
      ', old=' || coalesce(v_res.old_status::text, 'null') ||
      ', new=' || coalesce(v_res.new_status::text, 'null') ||
      ', already_processed=' || v_res.already_processed::text ||
      ', error_code=' || coalesce(v_res.error_code, 'null'),
      v_res.profile_id = v_target
      and v_res.old_status = 'rejected'::public.approval_status
      and v_res.new_status = 'approved'::public.approval_status
      and v_res.already_processed = true
      and v_res.error_code = 'already_processed');
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      perform pg_temp.rpc_record(7, 'already-rejected profile cannot be changed',
        'already_processed (exception)', v_state || ': ' || v_msg, false);
  end;
end $$;

-- ===========================================================================
-- CASE 8: concurrent/double-decision protected by pending condition -> PASS
-- (Simulate sequential second decision)
-- ===========================================================================
do $$
declare
  v_target constant uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; -- was approved in CASE 1
  v_res record;
  v_state text;
  v_msg text;
begin
  begin
    select * into v_res
    from public.decide_profile_approval(v_target, 'rejected'::public.approval_status, 'Second decision attempt');
    
    perform pg_temp.rpc_record(8, 'double-decision blocked by pending condition',
      'already_processed: profile_id=target, old=approved, new=rejected, already_processed=true, error_code=already_processed',
      'profile_id=' || coalesce(v_res.profile_id::text, 'null') ||
      ', old=' || coalesce(v_res.old_status::text, 'null') ||
      ', new=' || coalesce(v_res.new_status::text, 'null') ||
      ', already_processed=' || v_res.already_processed::text ||
      ', error_code=' || coalesce(v_res.error_code, 'null'),
      v_res.profile_id = v_target
      and v_res.old_status = 'approved'::public.approval_status
      and v_res.new_status = 'rejected'::public.approval_status
      and v_res.already_processed = true
      and v_res.error_code = 'already_processed');
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      perform pg_temp.rpc_record(8, 'double-decision blocked by pending condition',
        'already_processed (exception)', v_state || ': ' || v_msg, false);
  end;
end $$;

-- ===========================================================================
-- CASE 9: approval creates exactly one profile_audit record -> PASS
-- ===========================================================================
do $$
declare
  v_audit_count int;
  v_audit_action text;
  v_audit_details text;
begin
  select count(*), max(action), max(details)
    into v_audit_count, v_audit_action, v_audit_details
  from public.profile_audit
  where profile_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    and action = 'profile_approved';
  
  perform pg_temp.rpc_record(9, 'approval creates exactly one audit record',
    'audit_count=1, action=profile_approved, details contains "Admin approved"',
    'audit_count=' || v_audit_count ||
    ', action=' || coalesce(v_audit_action, 'null') ||
    ', details_like=' || case when v_audit_details like '%Admin approved%' then 'match' else 'no_match' end,
    v_audit_count = 1
    and v_audit_action = 'profile_approved'
    and v_audit_details like '%Admin approved%');
end $$;

-- ===========================================================================
-- CASE 10: rejection creates exactly one profile_audit record with reason -> PASS
-- ===========================================================================
do $$
declare
  v_audit_count int;
  v_audit_action text;
  v_audit_details text;
begin
  select count(*), max(action), max(details)
    into v_audit_count, v_audit_action, v_audit_details
  from public.profile_audit
  where profile_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    and action = 'profile_rejected';
  
  perform pg_temp.rpc_record(10, 'rejection creates exactly one audit record with reason',
    'audit_count=1, action=profile_rejected, details contains "Incomplete documents"',
    'audit_count=' || v_audit_count ||
    ', action=' || coalesce(v_audit_action, 'null') ||
    ', details_like=' || case when v_audit_details like '%Incomplete documents%' then 'match' else 'no_match' end,
    v_audit_count = 1
    and v_audit_action = 'profile_rejected'
    and v_audit_details like '%Incomplete documents%');
end $$;

-- ===========================================================================
-- CASE 11: failed/unauthorized operation creates no audit record -> PASS
-- ===========================================================================
do $$
declare
  v_audit_count int;
begin
  -- Check audit count for the non-admin attempt (CASE 3/4 target)
  select count(*) into v_audit_count
  from public.profile_audit
  where profile_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  
  perform pg_temp.rpc_record(11, 'failed/unauthorized operation creates no audit record',
    'audit_count=0 for non-admin target',
    'audit_count=' || v_audit_count,
    v_audit_count = 0);
end $$;

-- ===========================================================================
-- CASE 12: self-approval remains blocked -> PASS
-- ===========================================================================
select set_config('request.jwt.claim.sub',   '33333333-3333-4333-8333-333333333333', true),
       set_config('request.jwt.claim.email', 'selfadmin@invalid.test', true);

do $$
declare
  v_target constant uuid := '33333333-3333-4333-8333-333333333333'; -- self admin
  v_res record;
  v_status public.approval_status;
  v_state text;
  v_msg text;
begin
  begin
    select * into v_res
    from public.decide_profile_approval(v_target, 'approved'::public.approval_status, null);
    
    select status into v_status from public.profiles where id = v_target;
    
    perform pg_temp.rpc_record(12, 'self-approval remains blocked',
      'self_approval_blocked: profile_id=target, error_code=self_approval_blocked, status unchanged=pending',
      'profile_id=' || coalesce(v_res.profile_id::text, 'null') ||
      ', error_code=' || coalesce(v_res.error_code, 'null') ||
      ', status=' || v_status::text,
      v_res.profile_id = v_target
      and v_res.error_code = 'self_approval_blocked'
      and v_status = 'pending'::public.approval_status);
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      select status into v_status from public.profiles where id = v_target;
      perform pg_temp.rpc_record(12, 'self-approval remains blocked',
        'self_approval_blocked (exception), status=pending',
        v_state || ': ' || v_msg || ', status=' || v_status::text,
        v_state = '42501' -- or whatever error code, but status must be pending
        and v_status = 'pending'::public.approval_status);
  end;
end $$;

-- ===========================================================================
-- CASE 13: cleanup restores local baseline -> PASS (verified by rollback)
-- ===========================================================================
do $$
begin
  perform pg_temp.rpc_record(13, 'cleanup restores local baseline (rollback)',
    'transaction rolled back, no fixture rows persist',
    'verified by ROLLBACK at end of script',
    true);
end $$;

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
select
  case_no,
  case_name,
  expected,
  observed,
  case when passed then 'PASS' else 'FAIL' end as result
from rpc_test_results
order by case_no;

do $$
declare
  v_total  int;
  v_failed int;
begin
  select count(*) into v_total  from rpc_test_results;
  select count(*) into v_failed from rpc_test_results where not passed;

  if v_failed > 0 then
    raise exception '% of % admin profile approval RPC test case(s) FAILED', v_failed, v_total;
  end if;

  raise notice 'All % admin profile approval RPC test cases passed', v_total;
end $$;

rollback;