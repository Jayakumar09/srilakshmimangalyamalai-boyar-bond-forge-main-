-- document-client-verification-guard.sql
--
-- Regression test for supabase/migrations/20260926200000_document_client_verification_guard.sql
-- Audit finding #61 / M61-D1: client-forgeable document verification / AI status.
--
--   CASE 1  client forges documents.verified                EXPECTED REJECTED
--   CASE 2  client forges documents.ai_check_status         EXPECTED REJECTED
--   CASE 3  client forges documents.ai_check_notes          EXPECTED REJECTED
--   CASE 4  client forges documents.ai_face_match_score     EXPECTED REJECTED
--   CASE 5  client clears a verified flag on own row        EXPECTED REJECTED
--   CASE 6  client INSERTs a document forged as verified    EXPECTED REJECTED
--   CASE 7  client INSERTs a document with AI state         EXPECTED REJECTED
--   CASE 8  client updates an unprotected document field    EXPECTED allowed
--   CASE 9  client restates a protected value unchanged     EXPECTED allowed
--   CASE 10 client INSERT with explicit verified = false    EXPECTED allowed
--   CASE 11 client INSERT omitting the protected columns    EXPECTED allowed
--   CASE 12 admin sets documents.verified                   EXPECTED allowed
--   CASE 13 admin sets all three AI review fields           EXPECTED allowed
--   CASE 14 service_role sets verified + AI fields          EXPECTED allowed
--   CASE 15 ownership: client cannot read another's row     EXPECTED 0 rows
--   CASE 16 ownership: client cannot update another's row   EXPECTED 0 rows
--   CASE 17 ownership: client cannot delete another's row   EXPECTED 0 rows
--   CASE 18 ownership: client cannot insert for another     EXPECTED REJECTED
--   CASE 19 ownership: admin still reads every document     EXPECTED 2 rows
--   CASE 20 admin approval RPC still approves a profile     EXPECTED allowed
--
-- CASES 1-7 are the finding. All four columns are writable by the owning
-- member on both UPDATE and INSERT; CASES 1-7 fail without 20260926200000.
-- CASE 5 matters separately: without it a member could not only promote a
-- document, they could also strip the admin's verified flag.
--
-- CASES 8-11 are the false-positive controls. They fail if the guard is
-- over-broad, and they pin the four real client upload paths
-- (DashboardPage.tsx, RegisterWizard.tsx, CreateClientProfileDialog.tsx,
-- ProfileReviewDialog.tsx), which all INSERT documents from the browser.
--
-- CASES 12-14 are the authorized-writer controls. CASES 12-13 are the admin
-- verification/approval surface that reads these four columns, and CASE 14 is
-- the service_role path a future server-side AI prescreen would use, mirroring
-- payments.functions.ts which drives verify_payment through supabaseAdmin.
--
-- CASES 15-19 are the ownership controls. The migration must not have altered
-- RLS row visibility: deleteUpload() in storage.functions.ts deletes with the
-- caller's own client, and the per-member quota reads documents by user_id.
--
-- CASE 20 proves the migration did not disturb the unrelated admin approval
-- path (decide_profile_approval), which the admin workspace calls for profiles.
--
-- ############################################################################
-- # RUN THIS AGAINST A LOCAL OR THROWAWAY TEST DATABASE ONLY.               #
-- # NEVER against production. It writes fixture rows into public.profiles,   #
-- # public.user_roles and public.documents.                                  #
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
--     -f test-harness/document-client-verification-guard.sql

begin;

-- ---------------------------------------------------------------------------
-- Fixtures. Written while the session is still privileged so the guard's own
-- rules cannot interfere with setup.
-- ---------------------------------------------------------------------------
insert into public.profiles
  (id, email, full_name, status, membership_plan, submitted_at, consent_accepted_at)
values
  ('11111111-1111-4111-8111-111111111111', 'admin@invalid.test',    'Admin Fixture',   'approved', 'free', now(), now()),
  ('22222222-2222-4222-8222-222222222222', 'member@invalid.test',  'Member Fixture',  'approved', 'free', now(), now()),
  ('33333333-3333-4333-8333-333333333333', 'other@invalid.test',   'Other Fixture',   'approved', 'free', now(), now()),
  ('44444444-4444-4444-8444-444444444444', 'target@invalid.test',  'Approval Target', 'pending',  'free', now(), now());

insert into public.user_roles (user_id, role)
values
  ('11111111-1111-4111-8111-111111111111', 'admin'),
  ('22222222-2222-4222-8222-222222222222', 'client'),
  ('33333333-3333-4333-8333-333333333333', 'client'),
  ('44444444-4444-4444-8444-444444444444', 'client');

insert into public.documents
  (id, user_id, doc_type, id_kind, storage_key, file_name, mime_type, size_bytes, verified, ai_check_status, ai_check_notes, ai_face_match_score)
values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '22222222-2222-4222-8222-222222222222', 'govt_id', 'Aadhaar', '22222222-2222-4222-8222-222222222222/govt_id/aadhaar.pdf', 'aadhaar.pdf', 'application/pdf', 102400, false, null, null, null),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '33333333-3333-4333-8333-333333333333', 'govt_id', 'PAN',     '33333333-3333-4333-8333-333333333333/govt_id/pan.pdf',     'pan.pdf',     'image/png',      51200, true,  'pass', 'checked by admin', 0.97);

-- ---------------------------------------------------------------------------
-- Results table. Created privileged, then explicitly opened to the impersonated
-- role so the DO blocks below can record into it.
-- ---------------------------------------------------------------------------
create temp table doc_guard_test_results (
  case_no   int primary key,
  case_name text    not null,
  expected  text    not null,
  observed  text    not null,
  passed    boolean not null
) on commit drop;

grant insert, select, update on doc_guard_test_results to authenticated;
grant insert, select, update on doc_guard_test_results to service_role;

-- Impersonate the ordinary member: the attacker in M61-D1.
set local role authenticated;
select set_config('request.jwt.claim.sub',   '22222222-2222-4222-8222-222222222222', true),
       set_config('request.jwt.claim.role',  'authenticated', true),
       set_config('request.jwt.claim.email', 'member@invalid.test', true);

-- ===========================================================================
-- CASE 1: client promotes its own document to verified.
-- ===========================================================================
do $$
declare
  v_verified boolean;
  v_msg text;
begin
  begin
    update public.documents set verified = true
     where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    select d.verified into v_verified from public.documents d
     where d.id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    insert into doc_guard_test_results values (
      1, 'client cannot set verified', 'rejected, verified still false',
      'accepted, verified = ' || coalesce(v_verified::text, 'null'), false);
  exception when others then
    v_msg := sqlerrm;
    select d.verified into v_verified from public.documents d
     where d.id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    insert into doc_guard_test_results values (
      1, 'client cannot set verified', 'rejected, verified still false',
      case when v_verified then 'rejected but verified flipped anyway'
           else 'rejected: ' || left(v_msg, 60) end,
      v_verified is not true);
  end;
end $$;

-- ===========================================================================
-- CASE 2: client sets the AI pre-screen verdict.
-- ===========================================================================
do $$
declare
  v_status text;
  v_msg text;
begin
  begin
    update public.documents set ai_check_status = 'pass'
     where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    select d.ai_check_status into v_status from public.documents d
     where d.id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    insert into doc_guard_test_results values (
      2, 'client cannot set ai_check_status', 'rejected, status still null',
      'accepted, status = ' || coalesce(v_status, 'null'), v_status is null);
  exception when others then
    v_msg := sqlerrm;
    select d.ai_check_status into v_status from public.documents d
     where d.id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    insert into doc_guard_test_results values (
      2, 'client cannot set ai_check_status', 'rejected, status still null',
      case when v_status is not null then 'rejected but status flipped anyway'
           else 'rejected: ' || left(v_msg, 60) end,
      v_status is null);
  end;
end $$;

-- ===========================================================================
-- CASE 3: client writes AI review notes.
-- ===========================================================================
do $$
declare
  v_notes text;
  v_msg text;
begin
  begin
    update public.documents set ai_check_notes = 'approved by me, trust me'
     where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    select d.ai_check_notes into v_notes from public.documents d
     where d.id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    insert into doc_guard_test_results values (
      3, 'client cannot set ai_check_notes', 'rejected, notes still null',
      'accepted, notes = ' || coalesce(v_notes, 'null'), v_notes is null);
  exception when others then
    v_msg := sqlerrm;
    select d.ai_check_notes into v_notes from public.documents d
     where d.id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    insert into doc_guard_test_results values (
      3, 'client cannot set ai_check_notes', 'rejected, notes still null',
      case when v_notes is not null then 'rejected but notes flipped anyway'
           else 'rejected: ' || left(v_msg, 60) end,
      v_notes is null);
  end;
end $$;

-- ===========================================================================
-- CASE 4: client writes the face-match score.
-- ===========================================================================
do $$
declare
  v_score numeric;
  v_msg text;
begin
  begin
    update public.documents set ai_face_match_score = 0.99
     where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    select d.ai_face_match_score into v_score from public.documents d
     where d.id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    insert into doc_guard_test_results values (
      4, 'client cannot set ai_face_match_score', 'rejected, score still null',
      'accepted, score = ' || coalesce(v_score::text, 'null'), v_score is null);
  exception when others then
    v_msg := sqlerrm;
    select d.ai_face_match_score into v_score from public.documents d
     where d.id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    insert into doc_guard_test_results values (
      4, 'client cannot set ai_face_match_score', 'rejected, score still null',
      case when v_score is not null then 'rejected but score flipped anyway'
           else 'rejected: ' || left(v_msg, 60) end,
      v_score is null);
  end;
end $$;

-- ===========================================================================
-- CASE 5: client strips the admin's verified flag from its own row. Without
-- the guard this needs no forgery at all, it is the same column read by the
-- admin verification surface with the value inverted.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub',   '33333333-3333-4333-8333-333333333333', true),
       set_config('request.jwt.claim.role',  'authenticated', true),
       set_config('request.jwt.claim.email', 'other@invalid.test', true);

do $$
declare
  v_verified boolean;
  v_msg text;
begin
  begin
    update public.documents set verified = false
     where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    select d.verified into v_verified from public.documents d
     where d.id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    insert into doc_guard_test_results values (
      5, 'client cannot clear its own verified flag', 'rejected, verified still true',
      case when v_verified then 'accepted, verified = false'
           else 'verified already false (fixture changed)' end,
      v_verified);
  exception when others then
    v_msg := sqlerrm;
    select d.verified into v_verified from public.documents d
     where d.id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    insert into doc_guard_test_results values (
      5, 'client cannot clear its own verified flag', 'rejected, verified still true',
      case when v_verified then 'rejected: ' || left(v_msg, 60)
           else 'rejected but verified was cleared anyway' end,
      v_verified);
  end;
end $$;

-- ===========================================================================
-- CASE 6: client INSERTs a document that arrives pre-verified.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub',   '22222222-2222-4222-8222-222222222222', true),
       set_config('request.jwt.claim.role',  'authenticated', true),
       set_config('request.jwt.claim.email', 'member@invalid.test', true);

do $$
declare
  v_count int;
  v_msg text;
begin
  begin
    insert into public.documents
      (user_id, doc_type, storage_key, file_name, verified)
    values
      ('22222222-2222-4222-8222-222222222222', 'govt_id',
       '22222222-2222-4222-8222-222222222222/govt_id/forged-a.pdf', 'forged-a.pdf', true);
    select count(*) into v_count from public.documents
     where storage_key like '%/forged-a.pdf';
    insert into doc_guard_test_results values (
      6, 'client cannot INSERT a pre-verified document', 'rejected, 0 rows created',
      'accepted, rows created = ' || v_count::text, v_count = 0);
  exception when others then
    v_msg := sqlerrm;
    insert into doc_guard_test_results values (
      6, 'client cannot INSERT a pre-verified document', 'rejected, 0 rows created',
      'rejected: ' || left(v_msg, 60), true);
  end;
end $$;

-- ===========================================================================
-- CASE 7: client INSERTs a document carrying AI review state.
-- ===========================================================================
do $$
declare
  v_count int;
  v_msg text;
begin
  begin
    insert into public.documents
      (user_id, doc_type, storage_key, file_name, ai_check_status, ai_face_match_score)
    values
      ('22222222-2222-4222-8222-222222222222', 'govt_id',
       '22222222-2222-4222-8222-222222222222/govt_id/forged-b.pdf', 'forged-b.pdf', 'pass', 1.00);
    select count(*) into v_count from public.documents
     where storage_key like '%/forged-b.pdf';
    insert into doc_guard_test_results values (
      7, 'client cannot INSERT AI review state', 'rejected, 0 rows created',
      'accepted, rows created = ' || v_count::text, v_count = 0);
  exception when others then
    v_msg := sqlerrm;
    insert into doc_guard_test_results values (
      7, 'client cannot INSERT AI review state', 'rejected, 0 rows created',
      'rejected: ' || left(v_msg, 60), true);
  end;
end $$;

-- ===========================================================================
-- CASE 8: CONTROL. The guard must not make any other document column
-- unwritable for the owner.
-- ===========================================================================
do $$
declare
  v_count int;
begin
  update public.documents
     set file_name  = 'aadhaar-renamed.pdf',
         mime_type  = 'image/png',
         size_bytes = 204800
   where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  get diagnostics v_count = row_count;
  insert into doc_guard_test_results values (
    8, 'owner still updates unrelated document fields', 'rows_updated = 1',
    'rows_updated = ' || v_count::text, v_count = 1);
end $$;

-- ===========================================================================
-- CASE 9: CONTROL. Restating a protected value that already holds must not be
-- an error, otherwise any client write that happens to name the column breaks.
-- ===========================================================================
do $$
declare
  v_count int;
begin
  update public.documents
     set file_name = 'aadhaar-renamed-2.pdf',
         verified  = false
   where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  get diagnostics v_count = row_count;
  insert into doc_guard_test_results values (
    9, 'owner restating verified = false is not an error', 'rows_updated = 1',
    'rows_updated = ' || v_count::text, v_count = 1);
end $$;

-- ===========================================================================
-- CASE 10: CONTROL. DashboardPage.tsx, RegisterWizard.tsx,
-- CreateClientProfileDialog.tsx and ProfileReviewDialog.tsx all INSERT from the
-- browser. An explicit verified = false must still be accepted.
-- ===========================================================================
do $$
declare
  v_count int;
  v_verified boolean;
begin
  insert into public.documents
    (user_id, doc_type, storage_key, file_name, verified)
  values
    ('22222222-2222-4222-8222-222222222222', 'govt_id',
     '22222222-2222-4222-8222-222222222222/govt_id/honest-a.pdf', 'honest-a.pdf', false);
  get diagnostics v_count = row_count;
  select d.verified into v_verified from public.documents d
   where d.storage_key like '%/honest-a.pdf';
  insert into doc_guard_test_results values (
    10, 'client INSERT with explicit verified = false', 'rows_inserted = 1',
    'rows_inserted = ' || v_count::text, v_count = 1 and v_verified is false);
end $$;

-- ===========================================================================
-- CASE 11: CONTROL. The same insert path omitting the column entirely.
-- ===========================================================================
do $$
declare
  v_count int;
  v_status text;
begin
  insert into public.documents (user_id, doc_type, storage_key, file_name)
  values
    ('22222222-2222-4222-8222-222222222222', 'govt_id',
     '22222222-2222-4222-8222-222222222222/govt_id/honest-b.pdf', 'honest-b.pdf');
  get diagnostics v_count = row_count;
  select d.ai_check_status into v_status from public.documents d
   where d.storage_key like '%/honest-b.pdf';
  insert into doc_guard_test_results values (
    11, 'client INSERT omitting the protected columns', 'rows_inserted = 1',
    'rows_inserted = ' || v_count::text, v_count = 1 and v_status is null);
end $$;

-- ===========================================================================
-- CASE 12: the admin verification surface must still be able to set verified.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub',   '11111111-1111-4111-8111-111111111111', true),
       set_config('request.jwt.claim.role',  'authenticated', true),
       set_config('request.jwt.claim.email', 'admin@invalid.test', true);

do $$
declare
  v_count int;
  v_verified boolean;
begin
  update public.documents set verified = true
   where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  get diagnostics v_count = row_count;
  select d.verified into v_verified from public.documents d
   where d.id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  insert into doc_guard_test_results values (
    12, 'admin can still set verified', 'rows_updated = 1, verified = true',
    'rows_updated = ' || v_count::text || ', verified = ' || v_verified::text,
    v_count = 1 and v_verified);
end $$;

-- ===========================================================================
-- CASE 13: the admin AI review surface must still write all three AI fields.
-- ===========================================================================
do $$
declare
  v_count int;
  v_status text; v_notes text; v_score numeric;
begin
  update public.documents
     set ai_check_status      = 'pass',
         ai_check_notes       = 'face matched, id readable',
         ai_face_match_score  = 0.93
   where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  get diagnostics v_count = row_count;
  select d.ai_check_status, d.ai_check_notes, d.ai_face_match_score
    into v_status, v_notes, v_score
    from public.documents d where d.id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  insert into doc_guard_test_results values (
    13, 'admin can still set all three AI review fields', 'rows_updated = 1, status = pass, score = 0.93',
    'rows_updated = ' || v_count::text || ', status = ' || coalesce(v_status, 'null')
      || ', notes = ' || coalesce(v_notes, 'null') || ', score = ' || coalesce(v_score::text, 'null'),
    v_count = 1 and v_status = 'pass' and v_notes is not null and v_score = 0.93);
end $$;

-- ===========================================================================
-- CASE 14: service_role, the path any server-side AI prescreen would use.
-- Mirrors payments.functions.ts driving verify_payment through supabaseAdmin.
-- ===========================================================================
reset role;

do $$
declare
  v_count int;
  v_verified boolean; v_status text; v_score numeric;
begin
  update public.documents
     set verified             = true,
         ai_check_status      = 'pass',
         ai_face_match_score  = 0.88
   where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  get diagnostics v_count = row_count;
  select d.verified, d.ai_check_status, d.ai_face_match_score
    into v_verified, v_status, v_score
    from public.documents d where d.id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  insert into doc_guard_test_results values (
    14, 'service_role can still set verified + AI fields', 'rows_updated = 1, verified = true, status = pass',
    'rows_updated = ' || v_count::text || ', verified = ' || v_verified::text
      || ', status = ' || coalesce(v_status, 'null') || ', score = ' || coalesce(v_score::text, 'null'),
    v_count = 1 and v_verified and v_status = 'pass' and v_score = 0.88);
end $$;

-- ===========================================================================
-- CASE 15: ownership. A member still sees only its own documents.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub',   '22222222-2222-4222-8222-222222222222', true),
       set_config('request.jwt.claim.role',  'authenticated', true),
       set_config('request.jwt.claim.email', 'member@invalid.test', true);

do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from public.documents
   where user_id = '33333333-3333-4333-8333-333333333333';
  insert into doc_guard_test_results values (
    15, 'member cannot read another member documents', 'rows_visible = 0',
    'rows_visible = ' || v_count::text, v_count = 0);
end $$;

-- ===========================================================================
-- CASE 16: ownership. RLS still blocks an update of someone else's row, and
-- the new guard is not what stops it: the WITH CHECK predicate is.
-- ===========================================================================
do $$
declare
  v_count int;
begin
  update public.documents set file_name = 'hijacked.pdf'
   where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  get diagnostics v_count = row_count;
  insert into doc_guard_test_results values (
    16, 'member cannot update another member document', 'rows_updated = 0',
    'rows_updated = ' || v_count::text, v_count = 0);
end $$;

-- ===========================================================================
-- CASE 17: ownership. deleteUpload() deletes with the caller's own client,
-- so cross-owner deletion must still be blocked.
-- ===========================================================================
do $$
declare
  v_count int;
begin
  delete from public.documents where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  get diagnostics v_count = row_count;
  insert into doc_guard_test_results values (
    17, 'member cannot delete another member document', 'rows_deleted = 0',
    'rows_deleted = ' || v_count::text, v_count = 0);
end $$;

-- ===========================================================================
-- CASE 18: ownership. A member cannot attach a document to someone else.
-- ===========================================================================
do $$
declare
  v_msg text;
begin
  begin
    insert into public.documents (user_id, doc_type, storage_key, file_name)
    values ('33333333-3333-4333-8333-333333333333', 'govt_id',
            '33333333-3333-4333-8333-333333333333/govt_id/injected.pdf', 'injected.pdf');
    insert into doc_guard_test_results values (
      18, 'member cannot insert a document for another member', 'rejected, 0 rows created',
      'accepted, rows created = 1', false);
  exception when others then
    v_msg := sqlerrm;
    insert into doc_guard_test_results values (
      18, 'member cannot insert a document for another member', 'rejected, 0 rows created',
      'rejected by rls with check: ' || left(v_msg, 40), true);
  end;
end $$;

-- ===========================================================================
-- CASE 19: ownership. An admin still reads every document, which is what the
-- admin review dialog and useAdminData() depend on.
--
-- Counted over the two fixture rows rather than over the whole table: the
-- total is otherwise coupled to CASES 6, 7, 10 and 11, so this control would
-- also fail whenever the guard is absent and would stop being evidence about
-- admin read scope.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub',   '11111111-1111-4111-8111-111111111111', true),
       set_config('request.jwt.claim.role',  'authenticated', true),
       set_config('request.jwt.claim.email', 'admin@invalid.test', true);

do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from public.documents
   where storage_key in (
     '22222222-2222-4222-8222-222222222222/govt_id/aadhaar.pdf',
     '33333333-3333-4333-8333-333333333333/govt_id/pan.pdf');
  insert into doc_guard_test_results values (
    19, 'admin still reads every document', 'rows_visible = 2',
    'rows_visible = ' || v_count::text, v_count = 2);
end $$;

-- ===========================================================================
-- CASE 20: the unrelated admin approval path must be untouched. The admin
-- workspace calls decide_profile_approval() from admin-data.ts.
-- ===========================================================================
do $$
declare
  v_new public.approval_status;
  v_err text;
begin
  select r.new_status, r.error_code into v_new, v_err
    from public.decide_profile_approval(
      '44444444-4444-4444-8444-444444444444', 'approved'::public.approval_status, null) r;
  insert into doc_guard_test_results values (
    20, 'existing admin approval RPC still works', 'new_status = approved, error_code = null',
    'new_status = ' || coalesce(v_new::text, 'null') || ', error_code = ' || coalesce(v_err, 'null'),
    v_new = 'approved'::public.approval_status and v_err is null);
end $$;

-- ---------------------------------------------------------------------------
-- Summary
-- ---------------------------------------------------------------------------
\echo ''
\echo '===== M61-D1 document verification guard ====='
select case_no as "#", case_name, expected, observed, passed
  from doc_guard_test_results
 order by case_no;

\echo ''
\echo '===== totals ====='
select count(*) as total,
       count(*) filter (where passed) as passed,
       count(*) filter (where not passed) as failed
  from doc_guard_test_results;

\echo ''
\echo '===== no fixture row survives (all work rolled back) ====='
select (select count(*) from public.documents) as documents_left,
       (select count(*) from public.profiles) as profiles_left,
       (select count(*) from public.user_roles) as roles_left;

rollback;