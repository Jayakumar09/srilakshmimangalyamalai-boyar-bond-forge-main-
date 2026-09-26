-- profile-admin-self-approval-guard.sql
--
-- Narrowly scoped regression test for the admin self-approval guard added by
-- supabase/migrations/20260926120000_profile_admin_self_approval_guard.sql
--
--   CASE 1  admin updates another member  pending -> approved   EXPECTED allowed
--   CASE 2  admin updates another member  pending -> rejected   EXPECTED allowed
--   CASE 3  admin updates own profile     pending -> approved   EXPECTED REJECTED
--   CASE 4  admin updates own profile     pending -> rejected   EXPECTED REJECTED
--   CASE 5  ordinary member edits own permitted field           EXPECTED allowed
--   CASE 6  ordinary member self-approval still blocked         EXPECTED REJECTED
--
-- CASE 6 is not a new requirement. It pins the pre-existing client rule from
-- 20260925150000 so this migration cannot be blamed for weakening it.
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
--     -f test-harness/profile-admin-self-approval-guard.sql

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
  ('33333333-3333-4333-8333-333333333333', 'member@invalid.test', 'Member Fixture', 'pending', 'free', now(), now());

insert into public.user_roles (user_id, role)
values
  ('11111111-1111-4111-8111-111111111111', 'admin'),
  ('22222222-2222-4222-8222-222222222222', 'client'),
  ('33333333-3333-4333-8333-333333333333', 'client');

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

-- ===========================================================================
-- CASE 1 and CASE 2: an admin deciding on somebody else must still work.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub',   '11111111-1111-4111-8111-111111111111', true),
       set_config('request.jwt.claim.role',  'authenticated', true),
       set_config('request.jwt.claim.email', 'admin@invalid.test', true);

do $$
declare
  v_target constant uuid        := '22222222-2222-4222-8222-222222222222';
  v_status public.approval_status;
begin
  update public.profiles set status = 'approved' where id = v_target;
  select p.status into v_status from public.profiles p where p.id = v_target;
  insert into guard_test_results values (
    1, 'admin approves another member', 'allowed, status=approved',
    'allowed, status=' || v_status::text, v_status = 'approved');
exception
  when others then
    insert into guard_test_results values (
      1, 'admin approves another member', 'allowed, status=approved',
      'BLOCKED: ' || sqlerrm, false);
end $$;

do $$
declare
  v_target constant uuid        := '22222222-2222-4222-8222-222222222222';
  v_status public.approval_status;
begin
  update public.profiles set status = 'rejected' where id = v_target;
  select p.status into v_status from public.profiles p where p.id = v_target;
  insert into guard_test_results values (
    2, 'admin rejects another member', 'allowed, status=rejected',
    'allowed, status=' || v_status::text, v_status = 'rejected');
exception
  when others then
    insert into guard_test_results values (
      2, 'admin rejects another member', 'allowed, status=rejected',
      'BLOCKED: ' || sqlerrm, false);
end $$;

-- ===========================================================================
-- CASE 3 and CASE 4: the vulnerability. An admin approving or rejecting their
-- OWN profile must be refused, and the refusal must come from this guard.
-- The row must also be left untouched, proving there was no partial write.
-- ===========================================================================
do $$
declare
  v_admin  constant uuid        := '11111111-1111-4111-8111-111111111111';
  v_state  text;
  v_msg    text;
  v_status public.approval_status;
begin
  begin
    update public.profiles set status = 'approved' where id = v_admin;
    insert into guard_test_results values (
      3, 'admin approves own profile', 'rejected by admin self-approval guard',
      'ALLOWED - VULNERABLE', false);
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      select p.status into v_status from public.profiles p where p.id = v_admin;
      insert into guard_test_results values (
        3, 'admin approves own profile', 'rejected by admin self-approval guard',
        v_state || ': ' || v_msg,
        v_state = '42501'
        and v_msg like 'Admins cannot approve or reject their own profile%'
        and v_status = 'pending');
  end;
end $$;

do $$
declare
  v_admin  constant uuid        := '11111111-1111-4111-8111-111111111111';
  v_state  text;
  v_msg    text;
  v_status public.approval_status;
begin
  begin
    update public.profiles set status = 'rejected' where id = v_admin;
    insert into guard_test_results values (
      4, 'admin rejects own profile', 'rejected by admin self-approval guard',
      'ALLOWED - VULNERABLE', false);
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      select p.status into v_status from public.profiles p where p.id = v_admin;
      insert into guard_test_results values (
        4, 'admin rejects own profile', 'rejected by admin self-approval guard',
        v_state || ': ' || v_msg,
        v_state = '42501'
        and v_msg like 'Admins cannot approve or reject their own profile%'
        and v_status = 'pending');
  end;
end $$;

-- ===========================================================================
-- CASE 5: an ordinary member editing their own permitted field is unaffected.
-- ===========================================================================
select set_config('request.jwt.claim.sub',   '33333333-3333-4333-8333-333333333333', true),
       set_config('request.jwt.claim.email', 'member@invalid.test', true);

do $$
declare
  v_member constant uuid := '33333333-3333-4333-8333-333333333333';
  v_name   text;
begin
  update public.profiles
     set full_name = 'Member Fixture Renamed'
   where id = v_member;
  select p.full_name into v_name from public.profiles p where p.id = v_member;
  insert into guard_test_results values (
    5, 'member edits own permitted field', 'allowed, full_name updated',
    'full_name=' || coalesce(v_name, '(null)'), v_name = 'Member Fixture Renamed');
exception
  when others then
    insert into guard_test_results values (
      5, 'member edits own permitted field', 'allowed, full_name updated',
      'BLOCKED: ' || sqlerrm, false);
end $$;

-- ===========================================================================
-- CASE 6: the pre-existing client self-approval rule is still in force.
-- ===========================================================================
do $$
declare
  v_member constant uuid := '33333333-3333-4333-8333-333333333333';
  v_state  text;
  v_msg    text;
begin
  begin
    update public.profiles set status = 'approved' where id = v_member;
    insert into guard_test_results values (
      6, 'member self-approval still blocked', 'rejected by pre-existing client rule',
      'ALLOWED - VULNERABLE', false);
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      insert into guard_test_results values (
        6, 'member self-approval still blocked', 'rejected by pre-existing client rule',
        v_state || ': ' || v_msg,
        v_state = '42501'
        and v_msg like 'Clients cannot approve or reject their own profile%');
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Report, then fail loudly if anything regressed, then undo everything.
-- ---------------------------------------------------------------------------
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
    raise exception '% of % admin self-approval guard test case(s) FAILED', v_failed, v_total;
  end if;

  raise notice 'All % admin self-approval guard test cases passed', v_total;
end $$;

rollback;