-- elite-eligibility-verification.sql
--
-- Dedicated DB-level verification for
--   supabase/migrations/20261010130000_elite_eligibility_verification.sql
--
-- This file is intentionally SEPARATE from the migration. It changes no
-- application code and alters no existing migration.
--
-- CASES
--   1  client INSERT omitting elite_eligible                -> allowed, default false
--   2  client INSERT supplying elite_eligible = true         -> forced false (or rejected)
--   3  client UPDATE changing elite_eligible                 -> unchanged (pinned)
--   4  direct authenticated admin UPDATE of elite_eligible   -> pinned, no audit
--   5  non-admin calls set_elite_eligibility()               -> forbidden, no change
--   6  anon calls set_elite_eligibility()                    -> permission denied (42501)
--   7  admin GRANT through the RPC                           -> flag true, 1 audit row
--   8  admin REVOKE through the RPC                          -> flag false, 1 audit row
--   9  repeated identical grant/revoke                       -> idempotent, no extra audit
--  10  admin self-grant                                      -> self_grant_blocked, no audit
--  11  audit failure raises (23514)                         -> exception raised
--  12  ... and rolls the change back                         -> flag + audit counts equal pre-failure snapshot
--  13  client still edits an unrelated profile field         -> allowed, elite_eligible still false
--  14  payment_item enum intact (standard/premium/elite/jathagam)
--  15  membership_plan enum intact (free/standard/premium/elite)
--  16  all cases 1-15 recorded a result                      -> 15 rows present; ends in ROLLBACK
--
-- ############################################################################
-- # RUN THIS AGAINST A LOCAL OR THROWAWAY TEST DATABASE ONLY.                #
-- # NEVER against production. It writes synthetic fixture rows into          #
-- # public.profiles, public.user_roles and public.profile_audit, and it      #
-- # temporarily adds a CHECK constraint to public.profile_audit (case 11).   #
-- # All fixtures are synthetic (@elite.invalid). No production customer      #
-- # data, credentials or connection strings belong in this file.             #
-- ############################################################################
--
-- Everything runs inside ONE transaction that ends in ROLLBACK, so on a
-- disposable database it leaves nothing behind.
--
-- PREREQUISITES
--   * The test database has all migrations applied up to and including
--     20261010130000_elite_eligibility_verification.sql (the preflight below
--     fails fast with a clear message if not).
--   * psql (the script uses \if, \warn and \conninfo). The connected session
--     should be a privileged role (the local Supabase `postgres` role), because
--     fixtures and the temporary constraint are created before impersonation.
--
-- USAGE (disposable local/test stack only; NEVER production)
--   1. Operator provisions the test-only sentinel ONCE in the disposable
--      database (this script does NOT create it):
--        create table public.slmm_elite_test_marker (ok boolean not null default true);
--      The sentinel is never part of production migrations; its absence makes
--      the script fail closed.
--   2. Run, passing BOTH the opt-in flag and the exact disposable database
--      name (must equal current_database()):
--        psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 \
--          -v allow_elite_test=yes \
--          -v elite_test_db=<exact current_database() name> \
--          -f test-harness/elite-eligibility-verification.sql
--      Supply the connection via a shell variable or pgpass; never store a
--      connection string or credentials in this file.
--
-- LIMITATIONS / WHAT THIS DOES *NOT* PROVE
--   * It DOES exercise real database roles (SET LOCAL ROLE), the real auth
--     context (request.jwt.* GUCs consumed by auth.uid()/auth.role()) and real
--     trigger/RLS/function execution. It does NOT exercise the PostgREST HTTP
--     layer, JWT signature verification, the browser admin UI, or the payment
--     gateway. Setting request.jwt.* GUCs only simulates what auth.uid()/
--     auth.role() read; it does NOT prove PostgREST request routing, JWT
--     signature/expiry validation, or that a token was issued by this project.
--   * TARGET CONFIRMATION: the script fails closed unless BOTH -v
--     allow_elite_test=yes (value enforced, exactly 'yes') and -v
--     elite_test_db=<name> are supplied, current_database() equals <name>
--     exactly, and the operator-provisioned sentinel public.slmm_elite_test_marker
--     exists. The %prod% name denylist is kept only as defense in depth
--     (Supabase databases are named "postgres", so the name check alone cannot
--     identify production).
--   * The server-function Elite gate (submitManualPayment / assertEliteEligible)
--     and the notify item validation are APPLICATION logic, covered by the
--     offline harness test-harness/slmm-elite-code-tests.mjs (T1-T4), not here.
--     No claim about database authorization is made by that offline harness.
--   * The RPC's security-definer owner is assumed to be
--     postgres / supabase_admin / service_role (the Supabase convention the
--     guard and the existing decide_profile_approval() RPC already rely on).
--     If a test database runs migrations under a different owner, the guard's
--     owner/service carve-out may not recognise it; re-run and inspect case 4/7.
--   * Case 11 forces an audit-insert failure with a temporary always-false
--     CHECK constraint. It does not simulate disk-full / I/O failures.
--   * Single-session only: two-session concurrency races are not covered.

-- ---------------------------------------------------------------------------
-- Fail fast: stop at the first error so a failed interlock, preflight or test
-- statement cannot be silently skipped. Refusal paths end via \quit (which
-- exits 0; see the exit-status caveat in the helper scripts).
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Hard opt-in interlock (1/2): refuse to run unless the operator passes
-- -v allow_elite_test=yes, so this can never run by accident.
-- ---------------------------------------------------------------------------
\if :{?allow_elite_test}
\else
\warn 'REFUSING TO RUN: this script writes synthetic fixtures. Re-run with -v allow_elite_test=yes -v elite_test_db=<disposable db name> against a disposable local/test database only.'
\quit
\endif

-- ---------------------------------------------------------------------------
-- Hard opt-in interlock (2/2): also require the operator to name the exact
-- disposable database they intend to hit. Refuse if the variable is absent.
-- ---------------------------------------------------------------------------
\if :{?elite_test_db}
\else
\warn 'REFUSING TO RUN: pass -v elite_test_db=<exact disposable database name>.'
\quit
\endif

\echo '=== Elite eligibility verification: connected session ==='
\conninfo

begin;

-- psql variable interpolation (:var / :'var') does NOT happen inside dollar
-- quotes ($$ ... $$), so the operator-supplied values are carried into the DO
-- block via transaction-local GUCs set at top level, where :'var' is expanded
-- into a safe quoted literal by psql.
select set_config('elite.opt_in',           :'allow_elite_test', true),
       set_config('elite.test_db_expected', :'elite_test_db',    true);

-- ---------------------------------------------------------------------------
-- Fail-closed target confirmation. All checks must pass or the transaction
-- aborts before any fixture is written:
--   1. the opt-in flag is exactly 'yes';
--   2. the operator-named database equals current_database() exactly;
--   3. the operator-provisioned test-only sentinel relation exists (never
--      created by a production migration and never created by this script);
--   4. the production-name denylist does not match (defense in depth).
-- ---------------------------------------------------------------------------
do $$
declare
  v_opt_in   text := current_setting('elite.opt_in', true);
  v_expected text := current_setting('elite.test_db_expected', true);
begin
  if v_opt_in is distinct from 'yes' then
    raise exception 'REFUSING: opt-in must be exactly -v allow_elite_test=yes (got %)',
      coalesce(v_opt_in, '<missing>');
  end if;

  if v_expected is null or current_database() is distinct from v_expected then
    raise exception 'REFUSING: connected to "%" but -v elite_test_db=% was supplied',
      current_database(), coalesce(v_expected, '<missing>');
  end if;

  if to_regclass('public.slmm_elite_test_marker') is null then
    raise exception 'REFUSING: required test-only sentinel public.slmm_elite_test_marker is missing. Provision it once on the disposable database (see header); it must never exist in production.';
  end if;

  if current_database() ilike '%prod%' then
    raise exception 'REFUSING: database "%" looks like production', current_database();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Preflight: the migration under test must already be applied.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'profiles'
       and column_name  = 'elite_eligible'
  ) then
    raise exception 'PREFLIGHT: public.profiles.elite_eligible is missing — apply migration 20261010130000 first';
  end if;

  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'set_elite_eligibility'
  ) then
    raise exception 'PREFLIGHT: public.set_elite_eligibility(uuid, boolean) is missing — apply migration 20261010130000 first';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures. Written while the session is still privileged so the guard cannot
-- interfere with setup. Synthetic UUIDs only: neither public.profiles nor
-- public.user_roles has a foreign key to auth.users, so no auth user is needed.
-- ---------------------------------------------------------------------------
insert into public.profiles
  (id, email, full_name, status, membership_plan)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin@elite.invalid',   'Elite Admin',   'pending', 'free'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'member@elite.invalid',  'Elite Member',  'pending', 'free'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'target1@elite.invalid', 'Elite Target1', 'pending', 'free'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'target2@elite.invalid', 'Elite Target2', 'pending', 'free');

insert into public.user_roles (user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'client'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'client'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'client'),
  ('11111111-1111-4111-8111-111111111111', 'client'),
  ('22222222-2222-4222-8222-222222222222', 'client');

-- Base grants are idempotent; included so the client INSERT cases are explicit.
grant insert on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Results table, created privileged then opened to the impersonated roles so
-- the DO blocks below can record into it.
-- ---------------------------------------------------------------------------
create temp table elite_test_results (
  case_no   int primary key,
  case_name text    not null,
  expected  text    not null,
  observed  text    not null,
  passed    boolean not null
) on commit drop;

grant insert, select, update on elite_test_results to anon, authenticated, service_role;

create or replace function pg_temp.elite_record(
  p_case int, p_name text, p_expected text, p_observed text, p_passed boolean
) returns void
language plpgsql as $$
begin
  insert into elite_test_results (case_no, case_name, expected, observed, passed)
  values (p_case, p_name, p_expected, p_observed, p_passed);
end $$;

grant execute on function pg_temp.elite_record(int, text, text, text, boolean)
  to anon, authenticated, service_role;

-- ===========================================================================
-- CASE 1: client INSERT omitting elite_eligible -> allowed, default false
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub',   '11111111-1111-4111-8111-111111111111', true),
       set_config('request.jwt.claim.role',  'authenticated', true),
       set_config('request.jwt.claim.email', 'client1@elite.invalid', true);

do $$
declare
  v_inserted boolean := false;
  v_val boolean;
  v_state text; v_msg text;
begin
  begin
    insert into public.profiles (id, email, full_name, status)
    values ('11111111-1111-4111-8111-111111111111', 'client1@elite.invalid', 'Client One', 'pending');
    v_inserted := true;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;

  if v_inserted then
    select elite_eligible into v_val
      from public.profiles where id = '11111111-1111-4111-8111-111111111111';
    perform pg_temp.elite_record(
      1, 'client INSERT omitting elite_eligible',
      'allowed, elite_eligible=false',
      'allowed, elite_eligible=' || coalesce(v_val::text, 'null'),
      v_val is false);
  else
    perform pg_temp.elite_record(
      1, 'client INSERT omitting elite_eligible',
      'allowed, elite_eligible=false',
      'unexpected rejection: ' || v_state || ': ' || v_msg,
      false);
  end if;
end $$;
reset role;

-- ===========================================================================
-- CASE 2: client INSERT supplying elite_eligible = true -> forced false
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub',   '22222222-2222-4222-8222-222222222222', true),
       set_config('request.jwt.claim.role',  'authenticated', true),
       set_config('request.jwt.claim.email', 'client2@elite.invalid', true);

do $$
declare
  v_inserted boolean := false;
  v_val boolean;
  v_exists boolean;
  v_true int;
  v_state text; v_msg text;
begin
  begin
    insert into public.profiles (id, email, full_name, status, elite_eligible)
    values ('22222222-2222-4222-8222-222222222222', 'client2@elite.invalid', 'Client Two', 'pending', true);
    v_inserted := true;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;

  -- FINAL-STATE check regardless of path: no row for this id may be true.
  -- This is what makes a rejection or a pin both provably secure, and prevents
  -- the case from passing merely because the row was never created.
  select exists (select 1 from public.profiles where id = '22222222-2222-4222-8222-222222222222')
    into v_exists;
  select elite_eligible into v_val
    from public.profiles where id = '22222222-2222-4222-8222-222222222222';
  select count(*) into v_true
    from public.profiles
   where id = '22222222-2222-4222-8222-222222222222'
     and elite_eligible is true;

  perform pg_temp.elite_record(
    2, 'client INSERT elite_eligible=true',
    'never true (guard-pinned false, or rejected); 0 elite_eligible=true rows',
    'mechanism=' || case when v_inserted then 'accepted/guard-pinned' else 'rejected (' || v_state || ')' end
      || ', row_exists=' || v_exists::text
      || ', elite_eligible=' || coalesce(v_val::text, 'null')
      || ', true_rows=' || v_true,
    v_true = 0);
end $$;
reset role;

-- ===========================================================================
-- CASE 3: client UPDATE attempting to change the flag -> unchanged
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub',   'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true),
       set_config('request.jwt.claim.role',  'authenticated', true),
       set_config('request.jwt.claim.email', 'member@elite.invalid', true);

do $$
declare
  v_before boolean;
  v_after boolean;
  v_true int;
  v_rejected boolean := false;
  v_state text; v_msg text;
begin
  select elite_eligible into v_before
    from public.profiles where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  begin
    update public.profiles set elite_eligible = true
     where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  exception when others then
    -- An RLS/permission rejection is a legitimate, secure outcome; record it
    -- distinctly from a guard pin so the mechanism is visible in the report.
    v_rejected := true;
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;

  -- FINAL-STATE check regardless of path. v_before is asserted false so the
  -- update to true is a real change (otherwise the case could pass vacuously).
  select elite_eligible into v_after
    from public.profiles where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  select count(*) into v_true
    from public.profiles
   where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
     and elite_eligible is true;

  perform pg_temp.elite_record(
    3, 'client UPDATE elite_eligible=true',
    'left unchanged (false); 0 elite_eligible=true rows',
    'before=' || coalesce(v_before::text, 'null')
      || ', after=' || coalesce(v_after::text, 'null')
      || ', true_rows=' || v_true
      || ', mechanism=' || case when v_rejected
           then 'rejected (' || v_state || ')'
           else 'guard-pinned (no error)' end,
    v_before is false and v_after is false and v_true = 0);
end $$;
reset role;

-- ===========================================================================
-- CASE 4: direct authenticated admin UPDATE of elite_eligible -> pinned,
--         and (the admin can read profile_audit) no audit row is produced.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub',   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
       set_config('request.jwt.claim.role',  'authenticated', true),
       set_config('request.jwt.claim.email', 'admin@elite.invalid', true);

do $$
declare
  v_after boolean;
  v_audit int;
  v_state text; v_msg text;
begin
  begin
    update public.profiles set elite_eligible = true
     where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    select elite_eligible into v_after
      from public.profiles where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    select count(*) into v_audit
      from public.profile_audit
     where profile_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
       and action in ('elite_eligibility_granted', 'elite_eligibility_revoked');
    perform pg_temp.elite_record(
      4, 'direct admin UPDATE elite_eligible=true',
      'pinned to false, audit_count=0',
      'after=' || coalesce(v_after::text, 'null') || ', audit_count=' || v_audit,
      v_after is false and v_audit = 0);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    perform pg_temp.elite_record(
      4, 'direct admin UPDATE elite_eligible=true',
      'pinned to false, audit_count=0',
      'unexpected error: ' || v_state || ': ' || v_msg,
      false);
  end;
end $$;
reset role;

-- ===========================================================================
-- CASE 5: non-admin calls set_elite_eligibility() -> forbidden, no change.
--         The member targets their own row so their own audit is readable via
--         the "owner reads own audit" policy.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub',   'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true),
       set_config('request.jwt.claim.role',  'authenticated', true),
       set_config('request.jwt.claim.email', 'member@elite.invalid', true);

do $$
declare
  v_res record;
  v_after boolean;
  v_audit int;
  v_state text; v_msg text;
begin
  begin
    select * into v_res
      from public.set_elite_eligibility('cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
    select elite_eligible into v_after
      from public.profiles where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    select count(*) into v_audit
      from public.profile_audit
     where profile_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
       and action in ('elite_eligibility_granted', 'elite_eligibility_revoked');
    perform pg_temp.elite_record(
      5, 'non-admin RPC call',
      'forbidden, flag unchanged, audit_count=0',
      'error_code=' || coalesce(v_res.error_code, 'null') ||
      ', profile_id=' || coalesce(v_res.profile_id::text, 'null') ||
      ', after=' || coalesce(v_after::text, 'null') || ', audit_count=' || v_audit,
      v_res.error_code = 'forbidden' and v_res.profile_id is null
      and v_after is false and v_audit = 0);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    perform pg_temp.elite_record(
      5, 'non-admin RPC call',
      'forbidden, flag unchanged, audit_count=0',
      'unexpected error: ' || v_state || ': ' || v_msg,
      false);
  end;
end $$;
reset role;

-- ===========================================================================
-- CASE 6: anon (unauthenticated) cannot EXECUTE the RPC -> permission denied.
-- ===========================================================================
set local role anon;
do $$
declare
  v_res record;
  v_state text; v_msg text;
begin
  begin
    select * into v_res
      from public.set_elite_eligibility('dddddddd-dddd-4ddd-8ddd-dddddddddddd', true);
    perform pg_temp.elite_record(
      6, 'anon RPC call',
      'permission denied (42501)',
      'callable (unexpected): error_code=' || coalesce(v_res.error_code, 'null'),
      false);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    perform pg_temp.elite_record(
      6, 'anon RPC call',
      'permission denied (42501)',
      v_state || ': ' || v_msg,
      v_state = '42501');
  end;
end $$;
reset role;

-- ===========================================================================
-- CASE 7: admin GRANT through the RPC -> flag true + exactly one audit row
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub',   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
       set_config('request.jwt.claim.role',  'authenticated', true),
       set_config('request.jwt.claim.email', 'admin@elite.invalid', true);

do $$
declare
  v_res record;
  v_after boolean;
  v_granted int;
  v_actor uuid;
  v_details text;
  v_state text; v_msg text;
begin
  begin
    select * into v_res
      from public.set_elite_eligibility('dddddddd-dddd-4ddd-8ddd-dddddddddddd', true);
    select elite_eligible into v_after
      from public.profiles where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    select count(*), (array_agg(actor_id))[1], max(details)
      into v_granted, v_actor, v_details
      from public.profile_audit
     where profile_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
       and action = 'elite_eligibility_granted';
    perform pg_temp.elite_record(
      7, 'admin GRANT via RPC',
      'old=false,new=true,already=false,error=null, flag=true, granted_audit=1, actor=admin',
      'profile_id=' || coalesce(v_res.profile_id::text, 'null') ||
      ', old=' || coalesce(v_res.old_eligible::text, 'null') ||
      ', new=' || coalesce(v_res.new_eligible::text, 'null') ||
      ', already=' || v_res.already_processed::text ||
      ', error=' || coalesce(v_res.error_code, 'null') ||
      ', flag=' || coalesce(v_after::text, 'null') ||
      ', granted_audit=' || v_granted ||
      ', actor=' || coalesce(v_actor::text, 'null') ||
      ', details_like=' || case when v_details like '%granted%' then 'granted' else 'no_match' end,
      v_res.profile_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
      and v_res.old_eligible is false and v_res.new_eligible is true
      and v_res.already_processed is false and v_res.error_code is null
      and v_after is true and v_granted = 1
      and v_actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and v_details like '%granted%');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    perform pg_temp.elite_record(
      7, 'admin GRANT via RPC',
      'old=false,new=true,already=false,error=null, flag=true, granted_audit=1, actor=admin',
      'unexpected error: ' || v_state || ': ' || v_msg,
      false);
  end;
end $$;
reset role;

-- ===========================================================================
-- CASE 8: admin REVOKE through the RPC -> flag false + exactly one audit row
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub',   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
       set_config('request.jwt.claim.role',  'authenticated', true),
       set_config('request.jwt.claim.email', 'admin@elite.invalid', true);

do $$
declare
  v_res record;
  v_after boolean;
  v_revoked int;
  v_actor uuid;
  v_details text;
  v_state text; v_msg text;
begin
  begin
    select * into v_res
      from public.set_elite_eligibility('dddddddd-dddd-4ddd-8ddd-dddddddddddd', false);
    select elite_eligible into v_after
      from public.profiles where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    select count(*), (array_agg(actor_id))[1], max(details)
      into v_revoked, v_actor, v_details
      from public.profile_audit
     where profile_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
       and action = 'elite_eligibility_revoked';
    perform pg_temp.elite_record(
      8, 'admin REVOKE via RPC',
      'old=true,new=false,already=false,error=null, flag=false, revoked_audit=1, actor=admin',
      'profile_id=' || coalesce(v_res.profile_id::text, 'null') ||
      ', old=' || coalesce(v_res.old_eligible::text, 'null') ||
      ', new=' || coalesce(v_res.new_eligible::text, 'null') ||
      ', already=' || v_res.already_processed::text ||
      ', error=' || coalesce(v_res.error_code, 'null') ||
      ', flag=' || coalesce(v_after::text, 'null') ||
      ', revoked_audit=' || v_revoked ||
      ', actor=' || coalesce(v_actor::text, 'null') ||
      ', details_like=' || case when v_details like '%revoked%' then 'revoked' else 'no_match' end,
      v_res.profile_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
      and v_res.old_eligible is true and v_res.new_eligible is false
      and v_res.already_processed is false and v_res.error_code is null
      and v_after is false and v_revoked = 1
      and v_actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and v_details like '%revoked%');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    perform pg_temp.elite_record(
      8, 'admin REVOKE via RPC',
      'old=true,new=false,already=false,error=null, flag=false, revoked_audit=1, actor=admin',
      'unexpected error: ' || v_state || ': ' || v_msg,
      false);
  end;
end $$;
reset role;

-- ===========================================================================
-- CASE 9: repeated identical grant/revoke is idempotent (target2)
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub',   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
       set_config('request.jwt.claim.role',  'authenticated', true),
       set_config('request.jwt.claim.email', 'admin@elite.invalid', true);

do $$
declare
  v_g1 record; v_g2 record; v_r1 record; v_r2 record;
  v_flag boolean;
  v_granted int;
  v_revoked int;
  v_state text; v_msg text;
begin
  begin
    select * into v_g1 from public.set_elite_eligibility('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', true);
    select * into v_g2 from public.set_elite_eligibility('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', true);
    select * into v_r1 from public.set_elite_eligibility('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', false);
    select * into v_r2 from public.set_elite_eligibility('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', false);

    select elite_eligible into v_flag
      from public.profiles where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    select count(*) into v_granted
      from public.profile_audit
     where profile_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
       and action = 'elite_eligibility_granted';
    select count(*) into v_revoked
      from public.profile_audit
     where profile_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
       and action = 'elite_eligibility_revoked';

    perform pg_temp.elite_record(
      9, 'repeated identical grant/revoke is idempotent',
      'g1.already=false, g2.already=true, r1.already=false, r2.already=true, granted=1, revoked=1, flag=false',
      'g1=' || v_g1.already_processed::text || ', g2=' || v_g2.already_processed::text ||
      ', r1=' || v_r1.already_processed::text || ', r2=' || v_r2.already_processed::text ||
      ', granted=' || v_granted || ', revoked=' || v_revoked ||
      ', flag=' || coalesce(v_flag::text, 'null'),
      v_g1.already_processed is false and v_g2.already_processed is true
      and v_r1.already_processed is false and v_r2.already_processed is true
      and v_g1.error_code is null and v_g2.error_code is null
      and v_r1.error_code is null and v_r2.error_code is null
      and v_granted = 1 and v_revoked = 1 and v_flag is false);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    perform pg_temp.elite_record(
      9, 'repeated identical grant/revoke is idempotent',
      'idempotent, no extra audit',
      'unexpected error: ' || v_state || ': ' || v_msg,
      false);
  end;
end $$;
reset role;

-- ===========================================================================
-- CASE 10: admin self-grant blocked (admin targets their own row)
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub',   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
       set_config('request.jwt.claim.role',  'authenticated', true),
       set_config('request.jwt.claim.email', 'admin@elite.invalid', true);

do $$
declare
  v_res record;
  v_after boolean;
  v_audit int;
  v_state text; v_msg text;
begin
  begin
    select * into v_res
      from public.set_elite_eligibility('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
    select elite_eligible into v_after
      from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    select count(*) into v_audit
      from public.profile_audit
     where profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
       and action in ('elite_eligibility_granted', 'elite_eligibility_revoked');
    perform pg_temp.elite_record(
      10, 'admin self-grant blocked',
      'self_grant_blocked, flag=false, audit_count=0',
      'error_code=' || coalesce(v_res.error_code, 'null') ||
      ', profile_id=' || coalesce(v_res.profile_id::text, 'null') ||
      ', flag=' || coalesce(v_after::text, 'null') || ', audit_count=' || v_audit,
      v_res.error_code = 'self_grant_blocked' and v_after is false and v_audit = 0);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    perform pg_temp.elite_record(
      10, 'admin self-grant blocked',
      'self_grant_blocked, flag=false, audit_count=0',
      'unexpected error: ' || v_state || ': ' || v_msg,
      false);
  end;
end $$;
reset role;

-- ===========================================================================
-- Snapshot the pre-failure state of the synthetic target (captured while still
-- privileged) so cases 11-12 compare against measured values, not hardcoded
-- counts or cross-case assumptions.
-- ===========================================================================
create temp table elite_baseline_dddd on commit drop as
select
  (select elite_eligible from public.profiles
    where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd') as flag,
  (select count(*) from public.profile_audit
    where profile_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
      and action = 'elite_eligibility_granted') as granted,
  (select count(*) from public.profile_audit
    where profile_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
      and action = 'elite_eligibility_revoked') as revoked;

grant select on elite_baseline_dddd to anon, authenticated, service_role;

-- ===========================================================================
-- CASE 11: an audit-insert failure makes the RPC raise (23514).
-- A temporary always-false CHECK constraint forces the RPC's audit INSERT to
-- fail; the whole RPC statement (including its UPDATE) must roll back.
-- ===========================================================================
alter table public.profile_audit
  add constraint elite_test_block_audit check (false) not valid;

set local role authenticated;
select set_config('request.jwt.claim.sub',   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
       set_config('request.jwt.claim.role',  'authenticated', true),
       set_config('request.jwt.claim.email', 'admin@elite.invalid', true);

do $$
declare
  v_res record;
  v_raised boolean := false;
  v_state text; v_msg text;
  v_flag_before boolean; v_granted_before int; v_revoked_before int;
  v_flag_after boolean; v_granted_after int; v_revoked_after int;
begin
  select flag, granted, revoked
    into v_flag_before, v_granted_before, v_revoked_before
    from elite_baseline_dddd;

  begin
    select * into v_res
      from public.set_elite_eligibility('dddddddd-dddd-4ddd-8ddd-dddddddddddd', true);
  exception when others then
    v_raised := true;
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;

  -- Measured final state, compared against the snapshot: an exception alone is
  -- not enough; the change must have been rolled back.
  select elite_eligible into v_flag_after
    from public.profiles where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  select count(*) into v_granted_after
    from public.profile_audit
   where profile_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
     and action = 'elite_eligibility_granted';
  select count(*) into v_revoked_after
    from public.profile_audit
   where profile_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
     and action = 'elite_eligibility_revoked';

  perform pg_temp.elite_record(
    11, 'audit failure raises (23514)',
    'raises 23514; flag and audit counts unchanged (genuine rollback)',
    'raised=' || v_raised::text
      || ', sqlstate=' || coalesce(v_state, 'null')
      || ', flag=' || coalesce(v_flag_before::text, 'null') || '->' || coalesce(v_flag_after::text, 'null')
      || ', granted=' || v_granted_before || '->' || v_granted_after
      || ', revoked=' || v_revoked_before || '->' || v_revoked_after
      || ', msg=' || coalesce(v_msg, 'null'),
    v_raised and v_state = '23514'
      and v_flag_after is not distinct from v_flag_before
      and v_granted_after = v_granted_before
      and v_revoked_after = v_revoked_before);
end $$;
reset role;

alter table public.profile_audit drop constraint elite_test_block_audit;

-- ===========================================================================
-- CASE 12: independent re-check that the flag and audit trail still match the
-- pre-failure snapshot (no partial write survived the failed RPC).
-- ===========================================================================
do $$
declare
  v_flag_before boolean; v_granted_before int; v_revoked_before int;
  v_flag_after boolean; v_granted_after int; v_revoked_after int;
begin
  select flag, granted, revoked
    into v_flag_before, v_granted_before, v_revoked_before
    from elite_baseline_dddd;

  select elite_eligible into v_flag_after
    from public.profiles where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  select count(*) into v_granted_after
    from public.profile_audit
   where profile_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
     and action = 'elite_eligibility_granted';
  select count(*) into v_revoked_after
    from public.profile_audit
   where profile_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
     and action = 'elite_eligibility_revoked';

  perform pg_temp.elite_record(
    12, 'audit failure rolled the change back',
    'flag and audit counts equal the pre-failure snapshot',
    'flag=' || coalesce(v_flag_before::text, 'null') || '->' || coalesce(v_flag_after::text, 'null')
      || ', granted=' || v_granted_before || '->' || v_granted_after
      || ', revoked=' || v_revoked_before || '->' || v_revoked_after,
    v_flag_after is not distinct from v_flag_before
      and v_granted_after = v_granted_before
      and v_revoked_after = v_revoked_before);
end $$;

-- ===========================================================================
-- CASE 13: a client can still edit an unrelated profile field (guard is
-- scoped to elite_eligible only, not the whole row).
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub',   'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true),
       set_config('request.jwt.claim.role',  'authenticated', true),
       set_config('request.jwt.claim.email', 'member@elite.invalid', true);

do $$
declare
  v_name text;
  v_flag boolean;
  v_state text; v_msg text;
begin
  begin
    update public.profiles set full_name = 'Elite Member Edited'
     where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    select full_name, elite_eligible into v_name, v_flag
      from public.profiles where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    perform pg_temp.elite_record(
      13, 'client edits unrelated field',
      'full_name updated, elite_eligible still false',
      'full_name=' || coalesce(v_name, 'null') || ', elite_eligible=' || coalesce(v_flag::text, 'null'),
      v_name = 'Elite Member Edited' and v_flag is false);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    perform pg_temp.elite_record(
      13, 'client edits unrelated field',
      'full_name updated, elite_eligible still false',
      'unexpected error: ' || v_state || ': ' || v_msg,
      false);
  end;
end $$;
reset role;

-- ===========================================================================
-- CASE 14/15: the payment enums are intact, so Standard/Premium/Jathagam are
-- unaffected at the schema level. (Their handler branching is application code
-- covered by the offline .mjs harness, not by SQL.)
-- ===========================================================================
do $$
declare
  v_items text[];
  v_plans text[];
begin
  select array_agg(e.enumlabel order by e.enumlabel)
    into v_items
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public' and t.typname = 'payment_item';

  select array_agg(e.enumlabel order by e.enumlabel)
    into v_plans
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public' and t.typname = 'membership_plan';

  perform pg_temp.elite_record(
    14, 'payment_item enum intact',
    '{elite,jathagam,premium,standard}',
    coalesce(v_items::text, 'null'),
    coalesce(v_items = array['elite', 'jathagam', 'premium', 'standard'], false));

  perform pg_temp.elite_record(
    15, 'membership_plan enum intact',
    '{elite,free,premium,standard}',
    coalesce(v_plans::text, 'null'),
    coalesce(v_plans = array['elite', 'free', 'premium', 'standard'], false));
end $$;

-- ===========================================================================
-- CASE 16: every prior case (1-15) recorded exactly one result row, so a case
-- that raised before recording cannot silently vanish from the report. The
-- transaction still ends in ROLLBACK, which removes every fixture and the
-- temporary constraint.
-- ===========================================================================
do $$
declare
  v_recorded int;
begin
  select count(*) into v_recorded
    from elite_test_results
   where case_no between 1 and 15;

  perform pg_temp.elite_record(
    16, 'all prior case results recorded',
    '15 result rows present (cases 1-15)',
    'recorded=' || v_recorded,
    v_recorded = 15);
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
from elite_test_results
order by case_no;

do $$
declare
  v_total  int;
  v_failed int;
begin
  select count(*) into v_total  from elite_test_results;
  -- `passed` is NOT NULL, but use `is not true` so a hypothetical NULL can
  -- never be treated as a pass.
  select count(*) into v_failed from elite_test_results where passed is not true;

  if v_failed > 0 then
    raise exception '% of % Elite eligibility test case(s) FAILED', v_failed, v_total;
  end if;

  raise notice 'All % Elite eligibility test cases passed', v_total;
end $$;

rollback;
