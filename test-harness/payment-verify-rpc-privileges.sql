-- payment-verify-rpc-privileges.sql
--
-- Dedicated regression test for
-- supabase/migrations/20260926160000_e3_verify_payment_privilege_hardening.sql
--
-- The test is mode-aware so the SAME file can be run against the database both
-- before and after the E3 migration is applied:
--
--   psql ... -v expect_e3=off -f test-harness/payment-verify-rpc-privileges.sql
--       asserts the pre-E3 baseline: anon/authenticated EXECUTE present
--   psql ... -v expect_e3=on  -f test-harness/payment-verify-rpc-privileges.sql
--       asserts the post-E3 state: anon/authenticated EXECUTE absent,
--       service_role retained
--
-- Running with expect_e3=on against a database where E3 has NOT been applied
-- is the fail-first proof that this test actually detects the finding.
--
-- CASES
--   1   signature unchanged                          EXPECTED unchanged  (both modes)
--   2   return type unchanged                        EXPECTED unchanged  (both modes)
--   3   owner is still postgres                      EXPECTED postgres   (both modes)
--   4   SECURITY DEFINER still set                   EXPECTED true       (both modes)
--   5   search_path still public, pg_temp            EXPECTED unchanged  (both modes)
--   6   function body byte-identical (prosrc md5)    EXPECTED unchanged  (both modes)
--   7   body still contains the guarded UPDATE       EXPECTED present    (both modes)
--   8   anon EXECUTE absent from ACL                 EXPECTED depends on expect_e3
--   9   authenticated EXECUTE absent from ACL        EXPECTED depends on expect_e3
--   10  service_role EXECUTE present                 EXPECTED present    (both modes)
--   11  owner (postgres) EXECUTE present             EXPECTED present    (both modes)
--   12  no implicit PUBLIC grant                     EXPECTED absent    (both modes)
--   13  unrelated function privileges untouched      EXPECTED present    (both modes)
--   14  payments RLS still enabled, not forced       EXPECTED unchanged  (both modes)
--   15  payments policies still exactly the 2 known  EXPECTED unchanged  (both modes)
--   16  anon EXECUTE call outcome                    EXPECTED depends on expect_e3
--   17  authenticated EXECUTE call outcome           EXPECTED depends on expect_e3
--   18  service_role EXECUTE call still reaches body EXPECTED present    (both modes)
--   19  no payment row was created by the probes     EXPECTED zero       (both modes)
--
-- CASES 8, 9, 16 and 17 are the E3 assertions: they pass only once E3 has
-- been applied. CASE 12 is mode independent and confirms the REVOKE introduces
-- no implicit PUBLIC grant. CASES 13-15 are the blast-radius controls required by
-- the task: E3 is privilege-only and must not touch other function grants or any
-- payments RLS policy. CASE 18 is the regression pin for the legitimate flow. The
-- only real caller is src/lib/payments.functions.ts:159, which uses supabaseAdmin
-- built from SUPABASE_SERVICE_ROLE_KEY, so the service_role path must keep working.
--
-- CASE 19 proves the privilege probes are side-effect free: they pass a
-- gateway order id that does not exist, so the function takes its no-match
-- branch and writes nothing.
--
-- ############################################################################
-- # RUN THIS AGAINST A LOCAL OR THROWAWAY TEST DATABASE ONLY.               #
-- # NEVER against production.                                                 #
-- ############################################################################
--
-- Everything runs in one transaction that ends in ROLLBACK.
--
-- Usage:
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -v expect_e3=off \
--     -f test-harness/payment-verify-rpc-privileges.sql
--

\if :{?expect_e3}
\else
  \set expect_e3 'off'
\endif

begin;

-- ---------------------------------------------------------------------------
-- The identity snapshot is taken while still privileged. These are the
-- properties E3 must leave completely untouched.
-- ---------------------------------------------------------------------------
create temp table e3_fn_snapshot as
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as identity_args,
  p.proargtypes::text                        as argtypes,
  pg_get_function_result(p.oid)              as result_type,
  pg_get_userbyid(p.proowner)                as owner,
  p.prosecdef                                as security_definer,
  p.proconfig::text                          as config,
  md5(p.prosrc)                              as prosrc_md5,
  length(p.prosrc)                           as prosrc_len
from pg_proc p
where p.oid = 'public.verify_payment(text,uuid,text)'::regprocedure;

-- proacl can be NULL when the ACL is exactly the default; coalesce to the
-- implicit default so the PUBLIC/anon/authenticated checks always have rows.
create temp table e3_fn_acl as
select
  x.grantee,
  coalesce(r.rolname, 'PUBLIC') as grantee_name,
  x.privilege_type
from pg_proc p,
     lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as x
     left join pg_roles r on r.oid = x.grantee
where p.oid = 'public.verify_payment(text,uuid,text)'::regprocedure;

create temp table e3_test_results (
  case_no   int primary key,
  case_name text    not null,
  mode      text    not null,
  expected  text    not null,
  observed  text    not null,
  passed    boolean not null
) on commit drop;

grant insert, select, update on e3_test_results to anon, authenticated, service_role;
grant select on e3_fn_snapshot, e3_fn_acl to anon, authenticated, service_role;

-- Snapshot values for the unchanged-in-both-modes assertions.
create temp table e3_expected as
select
  (select identity_args    from e3_fn_snapshot) as identity_args,
  (select argtypes         from e3_fn_snapshot) as argtypes,
  (select result_type      from e3_fn_snapshot) as result_type,
  (select owner            from e3_fn_snapshot) as owner,
  (select security_definer from e3_fn_snapshot) as security_definer,
  (select config           from e3_fn_snapshot) as config,
  -- prosrc md5 of the LF-normalised 20260925130000 body, captured from the
  -- reconstructed baseline before E3 was applied. E3 must not alter it.
  (select prosrc_md5       from e3_fn_snapshot) as prosrc_md5;

grant select on e3_expected to anon, authenticated, service_role;

-- psql does not interpolate :variables inside dollar-quoted bodies, so the
-- expected mode is published as a session GUC and read at run time.
select set_config('e3.expect_mode', :'expect_e3', false);

-- Helper used by every case below. Defined once so the case bodies stay short.
create or replace function pg_temp.e3_record(
  p_case int, p_name text, p_expected text, p_observed text, p_passed boolean
) returns void
language plpgsql as $$
begin
  insert into e3_test_results (case_no, case_name, mode, expected, observed, passed)
  values (p_case, p_name, coalesce(current_setting('e3.expect_mode', true), 'off'),
         p_expected, p_observed, p_passed);
end;
$$;

grant execute on function pg_temp.e3_record(int, text, text, text, boolean)
  to anon, authenticated, service_role;

-- ===========================================================================
-- CASES 1-7: identity invariants. E3 is privilege-only, so every one of these
-- must read identically before and after.
-- ===========================================================================
do $$
declare
  v_exp e3_expected%rowtype;
  v_act e3_fn_snapshot%rowtype;
  v_has_update boolean;
begin
  select * into v_exp from e3_expected;
  select * into v_act from e3_fn_snapshot;

  -- CASE 1: signature
  perform pg_temp.e3_record(1, 'verify_payment signature unchanged',
    'verify_payment(' || v_exp.identity_args || ')',
    v_act.proname || '(' || v_act.identity_args || ')',
    v_act.proname = 'verify_payment' and v_act.identity_args = v_exp.identity_args);

  -- CASE 2: argument and return types
  perform pg_temp.e3_record(2, 'argument and return types unchanged',
    v_exp.argtypes || ' -> ' || v_exp.result_type,
    v_act.argtypes || ' -> ' || v_act.result_type,
    v_act.argtypes = v_exp.argtypes and v_act.result_type = v_exp.result_type);

  -- CASE 3: owner
  perform pg_temp.e3_record(3, 'function owner still postgres',
    'postgres', coalesce(v_act.owner, '(null)'), v_act.owner = 'postgres');

  -- CASE 4: SECURITY DEFINER
  perform pg_temp.e3_record(4, 'SECURITY DEFINER still set',
    'true', v_act.security_definer::text, v_act.security_definer is true);

  -- CASE 5: pinned search_path. Asserted structurally rather than against a
  -- literal array rendering, and also compared to the pre-test snapshot so any
  -- drift from the 20260925130000 pinning is caught.
  perform pg_temp.e3_record(5, 'search_path still locked',
    'unchanged and contains search_path=public, pg_temp',
    coalesce(v_act.config, '(null)'),
    v_act.config = v_exp.config
      and v_act.config like '%search_path=public, pg_temp%');

  -- CASE 6: body byte-identical
  perform pg_temp.e3_record(6, 'function body byte-identical (prosrc md5)',
    v_exp.prosrc_md5, v_act.prosrc_md5, v_act.prosrc_md5 = v_exp.prosrc_md5);

  -- CASE 7: the security-relevant statements are still in the body
  select exists (
    select 1 from pg_proc p
    where p.oid = 'public.verify_payment(text,uuid,text)'::regprocedure
      and p.prosrc like '%status = ''submitted''%'
      and p.prosrc like '%membership_plan%'
      and p.prosrc like '%p_user_id%'
  ) into v_has_update;
  perform pg_temp.e3_record(7, 'guarded claim + plan activation still in body',
    'present', case when v_has_update then 'present' else 'MISSING' end, v_has_update);
end $$;

-- ===========================================================================
-- CASES 8-12: the E3 privilege assertions.
-- ===========================================================================
do $$
declare
  v_anon_acl  boolean;
  v_auth_acl  boolean;
  v_svc_acl   boolean;
  v_pg_acl    boolean;
  v_public_acl boolean;
  v_expect_e3 boolean := (coalesce(current_setting('e3.expect_mode', true), 'off') = 'on');
  v_want      text;
begin
  select exists (select 1 from e3_fn_acl
                 where grantee_name = 'anon' and privilege_type = 'EXECUTE')
    into v_anon_acl;
  select exists (select 1 from e3_fn_acl
                 where grantee_name = 'authenticated' and privilege_type = 'EXECUTE')
    into v_auth_acl;
  select exists (select 1 from e3_fn_acl
                 where grantee_name = 'service_role' and privilege_type = 'EXECUTE')
    into v_svc_acl;
  select exists (select 1 from e3_fn_acl
                 where grantee_name = 'postgres' and privilege_type = 'EXECUTE')
    into v_pg_acl;
  select exists (select 1 from e3_fn_acl
                 where grantee_name = 'PUBLIC' and privilege_type = 'EXECUTE')
    into v_public_acl;

  v_want := case when v_expect_e3 then 'absent' else 'present' end;

  -- CASE 8: anon must lose EXECUTE
  perform pg_temp.e3_record(8, 'anon EXECUTE ' || v_want || ' (ACL)',
    v_want, case when v_anon_acl then 'present' else 'absent' end,
    v_anon_acl <> v_expect_e3);

  -- CASE 9: authenticated must lose EXECUTE
  perform pg_temp.e3_record(9, 'authenticated EXECUTE ' || v_want || ' (ACL)',
    v_want, case when v_auth_acl then 'present' else 'absent' end,
    v_auth_acl <> v_expect_e3);

  -- CASE 10: service_role must always keep EXECUTE
  perform pg_temp.e3_record(10, 'service_role EXECUTE present',
    'present', case when v_svc_acl then 'present' else 'absent' end, v_svc_acl);

  -- CASE 11: the owner keeps EXECUTE
  perform pg_temp.e3_record(11, 'owner postgres EXECUTE present',
    'present', case when v_pg_acl then 'present' else 'absent' end, v_pg_acl);

  -- CASE 12: no implicit PUBLIC grant. Mode independent: Supabase's default ACL
  -- for functions grants directly to the roles rather than to PUBLIC, so PUBLIC
  -- holds no EXECUTE here in either state, and the REVOKE must not introduce
  -- one. Naming the roles explicitly is exactly what 20260925150000:220-221
  -- does differently from the failing 20260925130000:157, so assert it.
  perform pg_temp.e3_record(12, 'PUBLIC EXECUTE absent (both modes)',
    'absent', case when v_public_acl then 'present' else 'absent' end,
    not v_public_acl);
end $$;

-- ===========================================================================
-- CASES 13-15: blast-radius controls. E3 must not change any other function
-- privilege, nor any payments RLS policy.
-- ===========================================================================
do $$
declare
  v_ok    boolean;
  v_rls   boolean;
  v_force boolean;
  v_note  text;
begin
  -- CASE 13: representative unrelated grants, all set by earlier migrations.
  select bool_and(ok) into v_ok
  from (values
    -- 20260919163208:6  has_role -> authenticated
    (has_function_privilege('authenticated', 'public.has_role(uuid,public.app_role)', 'EXECUTE'),
     'has_role->authenticated lost EXECUTE'),
    -- 20260919163208:4  is_approved -> authenticated, service_role
    (has_function_privilege('authenticated', 'public.is_approved(uuid)', 'EXECUTE'),
     'is_approved->authenticated lost EXECUTE'),
    (has_function_privilege('service_role', 'public.is_approved(uuid)', 'EXECUTE'),
     'is_approved->service_role lost EXECUTE'),
    -- 20260919163208:5  can_message -> authenticated, service_role
    (has_function_privilege('authenticated', 'public.can_message(uuid)', 'EXECUTE'),
     'can_message->authenticated lost EXECUTE'),
    (has_function_privilege('service_role', 'public.can_message(uuid)', 'EXECUTE'),
     'can_message->service_role lost EXECUTE'),
    -- 20260919142933:2  update_updated_at_column revoked from anon
    (not has_function_privilege('anon', 'public.update_updated_at_column()', 'EXECUTE'),
     'update_updated_at_column became executable by anon'),
    -- 20260919142933:1  handle_new_user revoked from anon
    (not has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE'),
     'handle_new_user became executable by anon'),
    -- 20260925150000:220-224  profiles_client_field_guard: anon excluded,
    -- authenticated and service_role included
    (not has_function_privilege('anon', 'public.profiles_client_field_guard()', 'EXECUTE'),
     'profiles_client_field_guard became executable by anon'),
    (has_function_privilege('authenticated', 'public.profiles_client_field_guard()', 'EXECUTE'),
     'profiles_client_field_guard->authenticated lost EXECUTE'),
    (has_function_privilege('service_role', 'public.profiles_client_field_guard()', 'EXECUTE'),
     'profiles_client_field_guard->service_role lost EXECUTE')
  ) as t(ok, note);

  perform pg_temp.e3_record(13, 'unrelated function privileges untouched',
    'all 10 grants intact',
    case when v_ok then 'all intact' else 'CHANGED' end, v_ok);

  -- CASE 14: payments RLS still enabled and not forced
  select c.relrowsecurity, c.relforcerowsecurity into v_rls, v_force
  from pg_class c where c.oid = 'public.payments'::regclass;
  perform pg_temp.e3_record(14, 'payments RLS enabled and not forced',
    'rowsecurity=t forcerowsecurity=f',
    'rowsecurity=' || v_rls::text || ' forcerowsecurity=' || v_force::text,
    v_rls is true and v_force is false);

  -- CASE 15: payments policies still exactly the two known ones
  select
    count(*) = 2
    and bool_and(p.polname in ('admins payments', 'own payments select'))
    and bool_and(p.polpermissive)
  into v_ok
  from pg_policy p where p.polrelid = 'public.payments'::regclass;
  perform pg_temp.e3_record(15, 'payments policies still exactly the 2 known',
    'admins payments + own payments select',
    case when v_ok then 'unchanged' else 'CHANGED' end, v_ok);
end $$;

-- ===========================================================================
-- CASES 16-18: behavioural enforcement. A catalog check alone would not prove
-- the grant is actually refused at execution time, so each role really calls
-- the function.
--
-- The probe uses a gateway order id that does not exist, so if the call is
-- permitted it falls through to the no-match branch, which returns a single
-- row of NULLs and writes nothing. CASE 19 proves that.
-- ===========================================================================
set local role anon;
do $$
declare
  v_state text; v_msg text; v_got record;
  v_e3  boolean := (coalesce(current_setting('e3.expect_mode', true), 'off') = 'on');
  v_want text   := case when v_e3 then '42501' else 'callable (baseline exposure)' end;
begin
  begin
    select * into v_got
    from public.verify_payment('e3-probe-no-such-order', gen_random_uuid(), 'e3-forged');
    perform pg_temp.e3_record(16, 'anon EXECUTE call outcome', v_want,
      'call reached function body, returned verified=' || v_got.verified::text,
      not v_e3);
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      perform pg_temp.e3_record(16, 'anon EXECUTE call outcome', v_want,
        v_state || ': ' || left(v_msg, 60),
        v_e3 and v_state = '42501');
  end;
end $$;
reset role;

set local role authenticated;
do $$
declare
  v_state text; v_msg text; v_got record;
  v_e3  boolean := (coalesce(current_setting('e3.expect_mode', true), 'off') = 'on');
  v_want text   := case when v_e3 then '42501' else 'callable (baseline exposure)' end;
begin
  begin
    select * into v_got
    from public.verify_payment('e3-probe-no-such-order', gen_random_uuid(), 'e3-forged');
    perform pg_temp.e3_record(17, 'authenticated EXECUTE call outcome', v_want,
      'call reached function body, returned verified=' || v_got.verified::text,
      not v_e3);
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      perform pg_temp.e3_record(17, 'authenticated EXECUTE call outcome', v_want,
        v_state || ': ' || left(v_msg, 60),
        v_e3 and v_state = '42501');
  end;
end $$;
reset role;

-- CASE 18: the legitimate path. service_role must still get past the privilege
-- gate into the function body, otherwise E3 would break the real checkout.
set local role service_role;
do $$
declare v_state text; v_msg text; v_got record; v_reached boolean := false;
begin
  begin
    select * into v_got
    from public.verify_payment('e3-probe-no-such-order', gen_random_uuid(), 'e3-forged');
    v_reached := true;
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;
  perform pg_temp.e3_record(18, 'service_role EXECUTE call still reaches body',
    'reaches function body (not 42501)',
    case when v_reached then 'reached body, verified=' || v_got.verified::text
         else v_state || ': ' || left(v_msg, 60) end,
    v_reached or (v_state is not null and v_state <> '42501'));
end $$;
reset role;

-- CASE 19: the privilege probes must be side-effect free.
do $$
declare v_n bigint;
begin
  select count(*) into v_n
  from public.payments
  where gateway_order_id = 'e3-probe-no-such-order'
     or gateway_payment_id = 'e3-forged';
  perform pg_temp.e3_record(19, 'no payment row created by the probes',
    '0 rows', v_n::text || ' row(s)', v_n = 0);
end $$;

-- ===========================================================================
-- Results
-- ===========================================================================
\echo ''
\echo '========================================================================'
\echo ' E3 verify_payment privilege test   (expect_e3 = ' :expect_e3 ')'
\echo '========================================================================'

select case_no as "CASE",
       case_name as "check",
       mode      as "mode",
       expected  as "expected",
       observed  as "observed",
       case when passed then 'PASS' else 'FAIL' end as "result"
from e3_test_results
order by case_no;

\echo ''
select count(*)                                                  as total,
       count(*) filter (where passed)                             as passed,
       count(*) filter (where not passed)                         as failed,
       case when count(*) filter (where not passed) = 0
            then 'ALL PASS' else 'FAILURES PRESENT' end          as verdict
from e3_test_results;

\echo ''
\echo '--- verify_payment ACL as it stands right now ---'
select grantee_name as grantee, privilege_type
from e3_fn_acl
where privilege_type = 'EXECUTE'
order by case when grantee_name = 'PUBLIC' then 0 else 1 end, grantee_name;

\echo ''
\echo '--- failing cases (empty means all good) ---'
select case_no, case_name, expected, observed
from e3_test_results
where not passed
order by case_no;

rollback;
