-- profile-admin-identity-plan-guard.sql
--
-- Regression test for supabase/migrations/20260926140000_profile_admin_identity_and_plan_guard.sql
--
--   CASE 1  admin renames own row id (id-swap step 1)          EXPECTED REJECTED
--   CASE 2  full id-swap self-approval dance ends approved      EXPECTED REJECTED
--   CASE 3  admin renames another member's id                    EXPECTED REJECTED
--   CASE 4  admin upgrades own membership_plan via UPDATE        EXPECTED REJECTED
--   CASE 5  admin sets own plan_valid_until via UPDATE           EXPECTED REJECTED
--   CASE 6  admin inserts own row pending + premium plan         EXPECTED REJECTED
--   CASE 7  admin inserts own row pending + plan_valid_until     EXPECTED REJECTED
--   CASE 8  admin manages ANOTHER member's plan                  EXPECTED allowed
--   CASE 9  admin creates another member with premium plan       EXPECTED allowed
--   CASE 10 admin status self-approval still blocked             EXPECTED REJECTED
--   CASE 11 service_role may still rename and set a plan         EXPECTED allowed
--   CASE 12 member own-profile edit still allowed                EXPECTED allowed
--
-- CASES 1-3 are the review finding: the approval guards added by
-- 20260926120000 and 20260926130000 decide "own row" by comparing
-- profiles.id with auth.uid(), which is only sound while id is immutable.
-- It was not, because "admins full profiles" is FOR ALL and the guard's own
-- NEW.id := v_uid pinning sits after the v_trusted return. CASES 1-3 fail
-- without 20260926140000.
--
-- CASES 4-7 are the second review finding: v_trusted returns NEW for an
-- admin, so the client branch that pins membership_plan/plan_valid_until
-- never ran for admins, and the OR'd "admins full profiles" policy let an
-- admin insert their own row with a premium plan. CASES 4-7 fail without
-- 20260926140000.
--
-- CASES 8-12 are controls. They fail if this migration is over-broad, and in
-- particular CASE 11 pins the payment path: payments.functions.ts buys a plan
-- through supabaseAdmin.rpc('verify_payment', {p_user_id: context.userId}),
-- i.e. service role, so self-purchase must keep working. CASE 11 also carries
-- an admin sub in the service_role JWT, which is the edge case that made the
-- privileged carve-out in the existing INSERT branch necessary.
--
-- ############################################################################
-- # RUN THIS AGAINST A LOCAL OR THROWAWAY TEST DATABASE ONLY.               #
-- # NEVER against production. It writes fixture rows into public.profiles   #
-- # and public.user_roles.                                                   #
-- ############################################################################
--
-- Everything runs in one transaction that ends in ROLLBACK, so on a disposable
-- database it leaves nothing behind.
--
-- Each case impersonates a caller using the same session GUCs PostgREST sets
-- for a real browser request, so auth.uid() and auth.role() resolve exactly as
-- they do in production:
--
--   set local role authenticated;
--   select set_config('request.jwt.claim.sub', '<uuid>', true);
--
-- The guard decides "is this an admin" with the project's own
-- public.has_role(), so the admin fixture needs a real public.user_roles row.
-- Neither public.profiles nor public.user_roles has a foreign key to
-- auth.users, so synthetic UUIDs are enough and no auth user is created.
--
-- Usage against a local supabase stack:
--   npx supabase db reset
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 \
--     -f test-harness/profile-admin-identity-plan-guard.sql

begin;

-- ---------------------------------------------------------------------------
-- Fixtures. Written while the session is still privileged so the guard's own
-- rules cannot interfere with setup.
-- ---------------------------------------------------------------------------
insert into public.profiles
  (id, email, full_name, status, membership_plan, submitted_at, consent_accepted_at)
values
  ('11111111-1111-4111-8111-111111111111', 'admin@invalid.test',  'Admin Fixture',  'pending', 'free', now(), now()),
  ('22222222-2222-4222-8222-222222222222', 'target@invalid.test', 'Target Fixture', 'pending', 'free', now(), now()),
  ('33333333-3333-4333-8333-333333333333', 'member@invalid.test', 'Member Fixture', 'pending', 'free', now(), now()),
  ('55555555-5555-4555-8555-555555555555', 'plan-target@invalid.test', 'Plan Target Fixture', 'pending', 'free', now(), now());

insert into public.user_roles (user_id, role)
values
  ('11111111-1111-4111-8111-111111111111', 'admin'),
  ('22222222-2222-4222-8222-222222222222', 'client'),
  ('33333333-3333-4333-8333-333333333333', 'client'),
  ('55555555-5555-4555-8555-555555555555', 'client');

-- ---------------------------------------------------------------------------
-- Results table. Created privileged, then explicitly opened to the impersonated
-- role so the DO blocks below can record into it.
-- ---------------------------------------------------------------------------
create temp table guard_test_results (
  case_no   int primary key,
  case_name text    not null,
  expected  text    not null,
  observed  text    not null,
  passed    boolean not null
) on commit drop;

grant insert, select, update on guard_test_results to authenticated;
grant insert, select, update on guard_test_results to service_role;

-- ===========================================================================
-- CASE 1: an admin must not be able to rename their own row. This is the
-- opening move of the id-swap bypass.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub',   '11111111-1111-4111-8111-111111111111', true),
       set_config('request.jwt.claim.role',  'authenticated', true),
       set_config('request.jwt.claim.email', 'admin@invalid.test', true);

do $$
declare
  v_admin constant uuid := '11111111-1111-4111-8111-111111111111';
  v_alt  constant uuid := '99999999-9999-4999-8999-999999999999';
  v_id   uuid;
  v_state text; v_msg text;
begin
  begin
    update public.profiles set id = v_alt where id = v_admin;
    select p.id into v_id from public.profiles p where p.id = v_admin;
    insert into guard_test_results values (
      1, 'admin cannot rename own row', 'rejected by admin identity guard',
      'ALLOWED - VULNERABLE, id is now ' || coalesce(v_id::text, '(null)'), false);
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      select p.id into v_id from public.profiles p where p.id = v_admin;
      insert into guard_test_results values (
        1, 'admin cannot rename own row', 'rejected by admin identity guard',
        v_state || ': ' || v_msg,
        v_state = '42501'
        and v_msg like 'Admins cannot change a profile id%'
        and v_id = v_admin);
  end;
end $$;

-- ===========================================================================
-- CASE 2: the full id-swap self-approval dance. Each step is caught
-- separately so the block can continue, then the end state is asserted: the
-- admin must not finish with an approved profile on their own id.
-- ===========================================================================
do $$
declare
  v_admin constant uuid := '11111111-1111-4111-8111-111111111111';
  v_alt  constant uuid := '99999999-9999-4999-8999-999999999999';
  v_status public.approval_status;
  v_blocked int := 0;
begin
  -- step 1: move the row off the admin's own id
  begin
    update public.profiles set id = v_alt where id = v_admin;
  exception when others then v_blocked := v_blocked + 1;
  end;
  -- step 2: approve it while OLD.id no longer equals auth.uid()
  begin
    update public.profiles set status = 'approved' where id = v_alt;
  exception when others then v_blocked := v_blocked + 1;
  end;
  -- step 3: move it back onto the admin's own id
  begin
    update public.profiles set id = v_admin where id = v_alt;
  exception when others then v_blocked := v_blocked + 1;
  end;

  select p.status into v_status from public.profiles p where p.id = v_admin;
  insert into guard_test_results values (
    2, 'id-swap self-approval dance', 'no approved profile on own id',
    'steps blocked=' || v_blocked || ', own status=' || coalesce(v_status::text, '(null)'),
    v_blocked >= 1 and coalesce(v_status, 'pending'::public.approval_status) = 'pending');
end $$;

-- ===========================================================================
-- CASE 3: renaming somebody else's row is blocked too. Own-row detection is
-- what was unsound, so the rule cannot be scoped to the own row.
-- ===========================================================================
do $$
declare
  v_target constant uuid := '22222222-2222-4222-8222-222222222222';
  v_alt    constant uuid := '88888888-8888-4888-8888-888888888888';
  v_id     uuid;
  v_state text; v_msg text;
begin
  begin
    update public.profiles set id = v_alt where id = v_target;
    insert into guard_test_results values (
      3, 'admin cannot rename another row', 'rejected by admin identity guard',
      'ALLOWED - VULNERABLE', false);
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      select p.id into v_id from public.profiles p where p.id = v_target;
      insert into guard_test_results values (
        3, 'admin cannot rename another row', 'rejected by admin identity guard',
        v_state || ': ' || v_msg,
        v_state = '42501'
        and v_msg like 'Admins cannot change a profile id%'
        and v_id = v_target);
  end;
end $$;

-- ===========================================================================
-- CASE 4: admin self-grant of membership_plan via UPDATE.
-- ===========================================================================
do $$
declare
  v_admin constant uuid := '11111111-1111-4111-8111-111111111111';
  v_plan  public.membership_plan;
  v_state text; v_msg text;
begin
  begin
    update public.profiles set membership_plan = 'premium' where id = v_admin;
    select p.membership_plan into v_plan from public.profiles p where p.id = v_admin;
    insert into guard_test_results values (
      4, 'admin cannot upgrade own plan', 'rejected by admin plan guard',
      'ALLOWED - VULNERABLE, plan=' || coalesce(v_plan::text, '(null)'), false);
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      select p.membership_plan into v_plan from public.profiles p where p.id = v_admin;
      insert into guard_test_results values (
        4, 'admin cannot upgrade own plan', 'rejected by admin plan guard',
        v_state || ': ' || v_msg,
        v_state = '42501'
        and v_msg like 'Admins cannot change their own membership plan%'
        and v_plan = 'free');
  end;
end $$;

-- ===========================================================================
-- CASE 5: admin self-grant of plan_valid_until, the other half of the pair.
-- A null-to-value write on its own must still be refused.
-- ===========================================================================
do $$
declare
  v_admin constant uuid := '11111111-1111-4111-8111-111111111111';
  v_until timestamptz;
  v_state text; v_msg text;
begin
  begin
    update public.profiles set plan_valid_until = now() + interval '10 years'
     where id = v_admin;
    select p.plan_valid_until into v_until from public.profiles p where p.id = v_admin;
    insert into guard_test_results values (
      5, 'admin cannot set own plan expiry', 'rejected by admin plan guard',
      'ALLOWED - VULNERABLE, plan_valid_until=' || coalesce(v_until::text, '(null)'), false);
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      select p.plan_valid_until into v_until from public.profiles p where p.id = v_admin;
      insert into guard_test_results values (
        5, 'admin cannot set own plan expiry', 'rejected by admin plan guard',
        v_state || ': ' || v_msg,
        v_state = '42501'
        and v_msg like 'Admins cannot change their own membership plan%'
        and v_until is null);
  end;
end $$;

-- ===========================================================================
-- CASE 6: admin inserts their own row as 'pending' but with a premium plan.
-- The self-approval INSERT branch blocks approved/rejected, not the plan, and
-- "own profile insert" is OR'd away by "admins full profiles".
-- ===========================================================================
do $$
declare
  v_admin constant uuid := '11111111-1111-4111-8111-111111111111';
  v_state text; v_msg text;
begin
  delete from public.profiles where id = v_admin;
  begin
    insert into public.profiles (id, email, full_name, status, membership_plan)
    values (v_admin, 'admin@invalid.test', 'Admin Fixture', 'pending', 'premium');
    insert into guard_test_results values (
      6, 'admin cannot insert own row with premium', 'rejected by admin plan guard',
      'ALLOWED - VULNERABLE', false);
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      insert into guard_test_results values (
        6, 'admin cannot insert own row with premium', 'rejected by admin plan guard',
        v_state || ': ' || v_msg,
        v_state = '42501'
        and v_msg like 'Admins cannot set their own membership plan%');
  end;
  -- restore the fixture for the remaining cases
  delete from public.profiles where id = v_admin;
  insert into public.profiles
    (id, email, full_name, status, membership_plan, submitted_at, consent_accepted_at)
  values (v_admin, 'admin@invalid.test', 'Admin Fixture', 'pending', 'free', now(), now());
end $$;

-- ===========================================================================
-- CASE 7: same, using plan_valid_until instead of the plan enum.
-- ===========================================================================
do $$
declare
  v_admin constant uuid := '11111111-1111-4111-8111-111111111111';
  v_state text; v_msg text;
begin
  delete from public.profiles where id = v_admin;
  begin
    insert into public.profiles (id, email, full_name, status, plan_valid_until)
    values (v_admin, 'admin@invalid.test', 'Admin Fixture', 'pending', now() + interval '10 years');
    insert into guard_test_results values (
      7, 'admin cannot insert own row with plan expiry', 'rejected by admin plan guard',
      'ALLOWED - VULNERABLE', false);
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      insert into guard_test_results values (
        7, 'admin cannot insert own row with plan expiry', 'rejected by admin plan guard',
        v_state || ': ' || v_msg,
        v_state = '42501'
        and v_msg like 'Admins cannot set their own membership plan%');
  end;
  delete from public.profiles where id = v_admin;
  insert into public.profiles
    (id, email, full_name, status, membership_plan, submitted_at, consent_accepted_at)
  values (v_admin, 'admin@invalid.test', 'Admin Fixture', 'pending', 'free', now(), now());
end $$;

-- ===========================================================================
-- CASE 8: CONTROL. Managing another member's plan is a legitimate admin job
-- and must still work.
-- ===========================================================================
do $$
declare
  v_target constant uuid := '55555555-5555-4555-8555-555555555555';
  v_plan   public.membership_plan;
begin
  begin
    update public.profiles
       set membership_plan = 'premium', plan_valid_until = now() + interval '1 year'
     where id = v_target;
    select p.membership_plan into v_plan from public.profiles p where p.id = v_target;
    insert into guard_test_results values (
      8, 'admin still manages another member plan', 'allowed, plan=premium',
      'plan=' || coalesce(v_plan::text, '(null)'), coalesce(v_plan = 'premium', false));
  exception
    when others then
      insert into guard_test_results values (
        8, 'admin still manages another member plan', 'allowed, plan=premium',
        'BLOCKED: ' || sqlerrm, false);
  end;
end $$;

-- ===========================================================================
-- CASE 9: CONTROL. Creating another member, including with a plan, is
-- unchanged behaviour.
-- ===========================================================================
do $$
declare
  v_new  constant uuid := '44444444-4444-4444-8444-444444444444';
  v_plan public.membership_plan;
begin
  begin
    insert into public.profiles (id, email, full_name, status, membership_plan)
    values (v_new, 'new@invalid.test', 'New Fixture', 'pending', 'premium');
    select p.membership_plan into v_plan from public.profiles p where p.id = v_new;
    insert into guard_test_results values (
      9, 'admin still creates another member', 'allowed, plan=premium',
      'plan=' || coalesce(v_plan::text, '(null)'), v_plan = 'premium');
  exception
    when others then
      insert into guard_test_results values (
        9, 'admin still creates another member', 'allowed, plan=premium',
        'BLOCKED: ' || sqlerrm, false);
  end;
end $$;

-- ===========================================================================
-- CASE 10: REGRESSION PIN. The status self-approval guard from
-- 20260926120000 must still be in force.
-- ===========================================================================
do $$
declare
  v_admin  constant uuid := '11111111-1111-4111-8111-111111111111';
  v_status public.approval_status;
  v_state text; v_msg text;
begin
  begin
    update public.profiles set status = 'approved' where id = v_admin;
    select p.status into v_status from public.profiles p where p.id = v_admin;
    insert into guard_test_results values (
      10, 'admin status self-approval still blocked', 'rejected by self-approval guard',
      'ALLOWED - VULNERABLE, status=' || coalesce(v_status::text, '(null)'), false);
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      select p.status into v_status from public.profiles p where p.id = v_admin;
      insert into guard_test_results values (
        10, 'admin status self-approval still blocked', 'rejected by self-approval guard',
        v_state || ': ' || v_msg,
        v_state = '42501'
        and v_msg like 'Admins cannot approve or reject their own profile%'
        and v_status = 'pending');
  end;
end $$;

-- ===========================================================================
-- CASE 11: CONTROL, and the most important one for regressions. Service role
-- must keep full access, because that is the only legitimate writer of plan
-- fields: payments.functions.ts self-purchase goes through
-- supabaseAdmin.rpc('verify_payment', {p_user_id: context.userId}).
-- The JWT here deliberately carries the admin's own sub, which is the edge
-- case that made the privileged carve-out in the INSERT branch necessary.
-- ===========================================================================
reset role;
set local role service_role;
select set_config('request.jwt.claim.sub',   '11111111-1111-4111-8111-111111111111', true),
       set_config('request.jwt.claim.role',  'service_role', true),
       set_config('request.jwt.claim.email', 'admin@invalid.test', true);

do $$
declare
  v_admin constant uuid := '11111111-1111-4111-8111-111111111111';
  v_alt   constant uuid := '77777777-7777-4777-8777-777777777777';
  v_plan  public.membership_plan;
  v_id    uuid;
begin
  begin
    update public.profiles
       set membership_plan = 'premium', plan_valid_until = now() + interval '1 year'
     where id = v_admin;
    update public.profiles set id = v_alt where id = v_admin;
    select p.membership_plan, p.id into v_plan, v_id
      from public.profiles p where p.id = v_alt;
    insert into guard_test_results values (
      11, 'service_role keeps plan and rename access', 'allowed, plan=premium',
      'plan=' || coalesce(v_plan::text, '(null)') || ', id=' || coalesce(v_id::text, '(null)'),
      v_plan = 'premium' and v_id = v_alt);
  exception
    when others then
      insert into guard_test_results values (
        11, 'service_role keeps plan and rename access', 'allowed, plan=premium',
        'BLOCKED: ' || sqlerrm, false);
  end;
end $$;

-- ===========================================================================
-- CASE 12: CONTROL. An ordinary member editing their own permitted field is
-- unaffected.
-- ===========================================================================
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub',   '33333333-3333-4333-8333-333333333333', true),
       set_config('request.jwt.claim.role',  'authenticated', true),
       set_config('request.jwt.claim.email', 'member@invalid.test', true);

do $$
declare
  v_member constant uuid := '33333333-3333-4333-8333-333333333333';
  v_name   text;
begin
  begin
    update public.profiles
       set full_name = 'Member Fixture Renamed'
     where id = v_member;
    select p.full_name into v_name from public.profiles p where p.id = v_member;
    insert into guard_test_results values (
      12, 'member edits own permitted field', 'allowed, full_name updated',
      'full_name=' || coalesce(v_name, '(null)'), v_name = 'Member Fixture Renamed');
  exception
    when others then
      insert into guard_test_results values (
        12, 'member edits own permitted field', 'allowed, full_name updated',
        'BLOCKED: ' || sqlerrm, false);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Report, then fail loudly if anything regressed, then undo everything.
-- ---------------------------------------------------------------------------
reset role;

select
  case_no,
  case_name,
  expected,
  observed,
  passed
from guard_test_results
order by case_no;

do $$
declare
  v_total  int;
  v_failed int;
begin
  select count(*) into v_total  from guard_test_results;
  select count(*) into v_failed from guard_test_results where not passed;

  if v_failed > 0 then
    raise exception '% of % admin identity/plan guard test case(s) FAILED', v_failed, v_total;
  end if;

  raise notice 'All % admin identity/plan guard test cases passed', v_total;
end $$;

rollback;
