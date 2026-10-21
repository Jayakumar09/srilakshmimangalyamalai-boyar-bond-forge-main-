-- =============================================================================
-- T6 Group-L/Group-R harness -- Supabase TEST only.
--
--   test-harness/t6-checkpoint/t6-group-r-harness.sql
--
-- PURPOSE
--   The SQL for the eight T6 Group-R cases (T6-R01 .. T6-R08) defined in
--   test-harness/t6-checkpoint/t6-case-matrix.json (environment "R").
--
-- HOW IT IS USED
--   The file is a LIBRARY OF SECTIONS. Each section starts with a marker:
--
--       -- >>> SECTION: <name>
--
--   t6-group-r-runner.mjs parses the markers and feeds the selected section
--   to the correct psql session. Nothing here is executed by hand.
--
--   The runner supplies these psql variables to every session:
--       owner   the synthetic T6 owner uuid
--       other   the synthetic T6 other uuid
--       admin   the synthetic T6 admin uuid
--       prefix  the synthetic T6 storage-key prefix
--       key     the case-specific synthetic storage key
--
--   The two acting sessions are tagged by application_name: session A is
--   slmm-t6-a and session B is slmm-t6-b, exactly the tagging the matrix's
--   synchronisation clauses require. The observer is slmm-t6-obs and never
--   sets a jwt role.
--
-- ERROR PROTOCOL (why every body is a DO block)
--   psql reports errors on STDERR and successful statements on STDOUT. Those
--   are different pipes and their events are NOT ordered relative to each
--   other, so a runner that reads stderr after the stdout completion marker
--   can miss an error entirely. Every case body below is therefore a
--   DO block whose EXCEPTION handler captures the SQLSTATE and the message
--   into session settings (t6r.sqlstate / t6r.message). The runner then reads
--   those settings back with a plain SELECT, which arrives on the SAME ordered
--   STDOUT stream as the completion marker. A body that fails without
--   catching (or a broken transaction) produces no result row at all, which
--   the runner also treats as a failure. No error detection depends on
--   stderr timing.
--
--   A successful RAISE NOTICE goes to stderr and is NOT a failure: the
--   captured SQLSTATE stays 00000 and the transaction is unaffected.
--
--   The t6r.* settings are session-level (set_config(..., false)), not
--   transaction-local, so the runner can reset and read them before and
--   after every statement regardless of the transaction state.
--
-- SAFETY PROPERTIES
--   * Every session opens a transaction and ENDS WITH ROLLBACK. There is no
--     COMMIT anywhere in this file, and the runner's R06 statement allowlist
--     fails the whole case set if a COMMIT is ever issued.
--   * The target is pinned to the TEST project. The runner refuses the
--     production project, an empty configuration, a localhost fallback, the
--     local disposable-lab port and the transaction-mode pooler.
--   * Only synthetic identities and synthetic keys are used. The three T6
--     uuids are not real auth.users rows (verified on TEST) and the key
--     prefix is bound to owner_id by a CHECK constraint, so a fixture can
--     never impersonate a genuine client record.
--   * No R2 object is created, asserted or deleted. No object storage call
--     appears in this file.
--   * The observer session is READ ONLY and never sets a JWT role.
--   * The write-capable sessions explicitly ASSERT read-committed isolation.
--
-- ROLE SIMULATION
--   The sessions connect as the pooler login role and simulate the acting
--   identity through the request.jwt.* settings, which is what auth.uid(),
--   auth.role() and every SECURITY DEFINER RPC in this schema actually read.
--   The session's SQL current_user is deliberately NOT switched: the acting
--   RPCs authorize on the jwt claims alone, and every fixture below is
--   written so that it is valid under the same row-level security policy
--   that the real client would be subject to (user_id = the synthetic owner).
--
-- SCHEMA NOTES (verified against the migrations and the Supabase TEST project)
--   * public.support_messages has `sender_id`, NOT `user_id`.
--   * public.payments exposes only SELECT to authenticated (migration
--     20260925120000 revoked INSERT and dropped the insert policy), so the
--     R02 payments fixture is inserted with service_role.
--   * The payments CHECK `payments_method_allowed` allows only
--     'online' | 'upi' | 'bank_transfer'; 'online' is the only value that
--     needs no UTR reference. `payment_item` is
--     standard|premium|jathagam|elite and `payment_status` is
--     submitted|verified|rejected.
--   * The fence trigger is a BEFORE INSERT OR UPDATE OF <col> row guard that
--     takes the per-key transaction advisory lock and then re-checks the
--     fence table AFTER the wait, so the serialisation under test is the
--     lock, not a stale snapshot. It fires on documents.storage_key and on
--     payments.proof_key, so BOTH fixtures must carry the key in that
--     column or the trigger returns early without taking the lock.
--   * The fence trigger raises 'Storage key is fenced for deletion.' with
--     SQLSTATE 23514; the payments CHECK raises 23514 as well. The two are
--     told apart by their messages, never by their code alone.
--   * request_storage_deletion refuses every role except authenticated, and
--     the worker RPCs (claim / fence) refuse every role except
--     service_role, so a case may need both -- in separate statements.
-- =============================================================================


-- >>> SECTION: prelude.authenticated
-- Open a transaction as an AUTHENTICATED end user (the synthetic T6 owner).
-- Used by the cases that call request_storage_deletion, which refuses every
-- role other than authenticated.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';
SET LOCAL idle_in_transaction_session_timeout = '90s';
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', :'owner', false);
SELECT set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub', :'owner')::text, false);
SELECT set_config('t6r.owner', :'owner', false);
SELECT set_config('t6r.other', :'other', false);
SELECT set_config('t6r.admin', :'admin', false);
SELECT set_config('t6r.prefix', :'prefix', false);
SELECT set_config('t6r.key', :'key', false);


-- >>> SECTION: prelude.service_role
-- Open a transaction with service-role rights. Used by the worker-side calls
-- (claim / fence) and by the payments fixture, which authenticated may not
-- insert.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';
SET LOCAL idle_in_transaction_session_timeout = '90s';
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT set_config('request.jwt.claim.sub', :'owner', false);
SELECT set_config('request.jwt.claims', jsonb_build_object('role','service_role','sub', :'owner')::text, false);
SELECT set_config('t6r.owner', :'owner', false);
SELECT set_config('t6r.other', :'other', false);
SELECT set_config('t6r.admin', :'admin', false);
SELECT set_config('t6r.prefix', :'prefix', false);
SELECT set_config('t6r.key', :'key', false);


-- >>> SECTION: prelude.observer
-- The observer session is READ ONLY and carries NO jwt role, so it can never
-- be mistaken for an acting session. It is used for the pg_locks polls and
-- for the R07 / R08 checks.
BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SELECT set_config('t6r.owner', :'owner', false);
SELECT set_config('t6r.other', :'other', false);
SELECT set_config('t6r.admin', :'admin', false);
SELECT set_config('t6r.prefix', :'prefix', false);


-- >>> SECTION: prelude.isolation_check
-- The T6 matrix deliberately departs from T3/T5's REPEATABLE READ: "the
-- harness guard must assert read committed, not repeatable read". Every
-- session runs this immediately after its prelude. It is a DO block, so a
-- failure is captured with its SQLSTATE like any other body, and it
-- publishes the observed isolation level for the runner to check.
DO $t6r$
BEGIN
  PERFORM set_config('t6r.isolation', current_setting('transaction_isolation'), false);
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'T6-R: transaction isolation is % but read committed is required',
      current_setting('transaction_isolation');
  END IF;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('t6r.sqlstate', SQLSTATE, false);
  PERFORM set_config('t6r.message', SQLERRM, false);
END
$t6r$;


-- >>> SECTION: escalate.service_role
-- Switch the acting role to service_role inside the open transaction.
-- request_storage_deletion refuses service_role, and the worker RPCs refuse
-- authenticated, so a case may need both -- in separate statements.
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT set_config('request.jwt.claims', jsonb_build_object('role','service_role','sub', :'owner')::text, false);


-- >>> SECTION: escalate.authenticated
-- Switch the acting role back to authenticated inside the open transaction.
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub', :'owner')::text, false);


-- >>> SECTION: poll.granted_a
-- How many GRANTED advisory locks does session A hold? A waiter pre-waits on
-- this so it never issues its statement before the lock is actually held --
-- otherwise the "wait" under test would not happen.
SELECT count(*)::text
FROM pg_catalog.pg_locks l
JOIN pg_catalog.pg_stat_activity s ON s.pid = l.pid
WHERE l.locktype = 'advisory'
  AND l.granted
  AND s.application_name = 'slmm-t6-a';


-- >>> SECTION: poll.granted_b
-- How many GRANTED advisory locks does session B hold? Used by T6-R03, where
-- the REFERENCE WRITER (session B) holds the per-key lock.
SELECT count(*)::text
FROM pg_catalog.pg_locks l
JOIN pg_catalog.pg_stat_activity s ON s.pid = l.pid
WHERE l.locktype = 'advisory'
  AND l.granted
  AND s.application_name = 'slmm-t6-b';


-- >>> SECTION: poll.waiting_a
-- How many sessions are WAITING on an advisory lock, where the waiting
-- session is A. This is the state-based synchronisation the matrix requires.
SELECT count(*)::text
FROM pg_catalog.pg_locks l
JOIN pg_catalog.pg_stat_activity s ON s.pid = l.pid
WHERE l.locktype = 'advisory'
  AND NOT l.granted
  AND s.application_name = 'slmm-t6-a';


-- >>> SECTION: poll.waiting_b
-- How many sessions are WAITING on an advisory lock, where the waiting
-- session is B.
SELECT count(*)::text
FROM pg_catalog.pg_locks l
JOIN pg_catalog.pg_stat_activity s ON s.pid = l.pid
WHERE l.locktype = 'advisory'
  AND NOT l.granted
  AND s.application_name = 'slmm-t6-b';


-- >>> SECTION: poll.t6_backends
-- How many T6-tagged backends are alive other than the observer itself? The
-- runner waits (bounded) for this to reach zero after the acting sessions are
-- closed, so a backend that is still shutting down is not mistaken for
-- residue and a backend that never leaves is caught.
SELECT count(*)::text
FROM pg_catalog.pg_stat_activity
WHERE application_name LIKE 'slmm-t6-%'
  AND pid <> pg_backend_pid();


-- >>> SECTION: a.create_request
-- Session A (authenticated): create A's own request for the case key. The
-- row is A's own and stays uncommitted. The call takes the per-key advisory
-- lock, so it also blocks while a reference writer holds it -- which is the
-- serialisation R03 and R05 exercise.
DO $t6r$
DECLARE v_id uuid;
BEGIN
  v_id := public.request_storage_deletion(current_setting('t6r.key'));
  PERFORM set_config('t6r.req_id', coalesce(v_id::text, ''), false);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('t6r.sqlstate', SQLSTATE, false);
  PERFORM set_config('t6r.message', SQLERRM, false);
END
$t6r$;


-- >>> SECTION: a.claim_fence
-- Session A (service_role): claim the request, then call the fence. The
-- fence takes the per-key transaction advisory lock and inserts an
-- UNCOMMITTED fence row -- both are released by A's ROLLBACK.
DO $t6r$
DECLARE
  v_lease  uuid;
  v_status text;
  v_fence  text;
BEGIN
  SELECT lease_token, status INTO v_lease, v_status
    FROM public.claim_storage_deletion_request(
      nullif(current_setting('t6r.req_id', true), '')::uuid);
  PERFORM set_config('t6r.lease', coalesce(v_lease::text, ''), false);
  PERFORM set_config('t6r.claimstatus', coalesce(v_status, ''), false);
  v_fence := public.fence_storage_key_for_deletion(
    nullif(current_setting('t6r.req_id', true), '')::uuid, v_lease);
  PERFORM set_config('t6r.fence', coalesce(v_fence, ''), false);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('t6r.sqlstate', SQLSTATE, false);
  PERFORM set_config('t6r.message', SQLERRM, false);
END
$t6r$;


-- >>> SECTION: b.insert_document
-- Session B (authenticated): insert a documents row for the same key. The
-- fence trigger takes the same per-key advisory lock, so this statement
-- BLOCKS while A holds it; after A's rollback no fence is committed, so the
-- insert succeeds.
DO $t6r$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.documents (user_id, doc_type, storage_key, file_name)
  VALUES (nullif(current_setting('t6r.owner', true), '')::uuid, 't6',
          current_setting('t6r.key'), 't6-r-document')
  RETURNING id INTO v_id;
  PERFORM set_config('t6r.doc_id', coalesce(v_id::text, ''), false);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('t6r.sqlstate', SQLSTATE, false);
  PERFORM set_config('t6r.message', SQLERRM, false);
END
$t6r$;


-- >>> SECTION: b.insert_payment
-- Session B (service_role): the payments reference source. payments exposes
-- only SELECT to authenticated on TEST, so this insert must run with
-- service_role. 'online' is the only method that needs no UTR reference, and
-- 'standard' is a valid payment_item. proof_key MUST carry the case key:
-- the fence trigger is BEFORE INSERT OR UPDATE OF proof_key and returns
-- early (without taking the advisory lock) when the column is NULL.
DO $t6r$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.payments (user_id, item, amount_inr, method, status, proof_key)
  VALUES (nullif(current_setting('t6r.owner', true), '')::uuid, 'standard', 1,
          'online', 'submitted', current_setting('t6r.key'))
  RETURNING id INTO v_id;
  PERFORM set_config('t6r.pay_id', coalesce(v_id::text, ''), false);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('t6r.sqlstate', SQLSTATE, false);
  PERFORM set_config('t6r.message', SQLERRM, false);
END
$t6r$;


-- >>> SECTION: b.insert_document_first
-- Session B (authenticated): insert the documents row FIRST and hold the
-- transaction open, so the trigger holds the per-key advisory lock. Used by
-- R03, where the fence must wait for the reference writer.
DO $t6r$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.documents (user_id, doc_type, storage_key, file_name)
  VALUES (nullif(current_setting('t6r.owner', true), '')::uuid, 't6',
          current_setting('t6r.key'), 't6-r-document')
  RETURNING id INTO v_id;
  PERFORM set_config('t6r.doc_id', coalesce(v_id::text, ''), false);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('t6r.sqlstate', SQLSTATE, false);
  PERFORM set_config('t6r.message', SQLERRM, false);
END
$t6r$;


-- >>> SECTION: b.set_short_lock_timeout
-- R04: B shortens lock_timeout so the wait is bounded and fail-closed.
SET LOCAL lock_timeout = '3s';


-- >>> SECTION: r07.hygiene
-- R07 (observer, READ ONLY): no T6-tagged backend may survive, none may
-- hold an open transaction, and therefore no T6 advisory lock may survive.
-- The three counters are published under the EXACT contract keys the runner
-- reads (backends / openXacts / advisoryLocks). The observer's own backend
-- is excluded. A missing, null, unknown or non-numeric counter is never
-- treated as zero by the runner.
DO $t6r$
DECLARE
  v_backends int;
  v_open     int;
  v_lock_count int;
BEGIN
  SELECT count(*) INTO v_backends FROM pg_catalog.pg_stat_activity
   WHERE application_name LIKE 'slmm-t6-%' AND pid <> pg_backend_pid();
  SELECT count(*) INTO v_open FROM pg_catalog.pg_stat_activity
   WHERE application_name LIKE 'slmm-t6-%' AND xact_start IS NOT NULL
     AND pid <> pg_backend_pid();
  SELECT count(*) INTO v_lock_count FROM pg_catalog.pg_locks l
    JOIN pg_catalog.pg_stat_activity s ON s.pid = l.pid
   WHERE s.application_name LIKE 'slmm-t6-%' AND l.locktype = 'advisory'
     AND s.pid <> pg_backend_pid();
  PERFORM set_config('t6r.hygiene', jsonb_build_object(
    'backends', v_backends,
    'openXacts', v_open,
    'advisoryLocks', v_lock_count)::text, false);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('t6r.sqlstate', SQLSTATE, false);
  PERFORM set_config('t6r.message', SQLERRM, false);
END
$t6r$;


-- >>> SECTION: r08.residue
-- R08 (observer, READ ONLY, runs LAST after both sessions disconnected):
-- every one of the ten relations must show ZERO rows for the synthetic T6
-- identities and key prefix, and no T6 backend or advisory lock may remain.
-- The ten relation counters are published under the exact relation names
-- the runner reads; the session counters follow the r07.hygiene contract.
-- A nonzero count is a fail-closed RAISE that the runner records as FAIL.
DO $t6r$
DECLARE
  v_owner  constant uuid := nullif(current_setting('t6r.owner', true), '')::uuid;
  v_other  constant uuid := nullif(current_setting('t6r.other', true), '')::uuid;
  v_admin  constant uuid := nullif(current_setting('t6r.admin', true), '')::uuid;
  v_prefix constant text := current_setting('t6r.prefix');
  v_hits   jsonb;
  v_backends int;
  v_xact_count int;
  v_lock_count int;
BEGIN
  SELECT jsonb_build_object(
    'storage_deletion_requests', (SELECT count(*) FROM public.storage_deletion_requests r
       WHERE r.owner_id IN (v_owner,v_other,v_admin) OR r.requested_by IN (v_owner,v_other,v_admin)
          OR r.storage_key LIKE v_prefix || '%'),
    'storage_deletion_fences', (SELECT count(*) FROM public.storage_deletion_fences f
       WHERE f.storage_key LIKE v_prefix || '%'),
    'documents', (SELECT count(*) FROM public.documents d
       WHERE d.user_id IN (v_owner,v_other,v_admin) OR d.storage_key LIKE v_prefix || '%'),
    'profiles', (SELECT count(*) FROM public.profiles p
       WHERE p.id IN (v_owner,v_other,v_admin) OR p.photo_url LIKE v_prefix || '%'),
    'user_roles', (SELECT count(*) FROM public.user_roles ur
       WHERE ur.user_id IN (v_owner,v_other,v_admin)),
    'payments', (SELECT count(*) FROM public.payments p
       WHERE p.user_id IN (v_owner,v_other,v_admin) OR p.proof_key LIKE v_prefix || '%'),
    'jathagam_requests', (SELECT count(*) FROM public.jathagam_requests j
       WHERE j.report_key LIKE v_prefix || '%'),
    'support_threads', (SELECT count(*) FROM public.support_threads st
       WHERE st.user_id IN (v_owner,v_other,v_admin)),
    'support_messages', (SELECT count(*) FROM public.support_messages m
       WHERE m.sender_id IN (v_owner,v_other,v_admin) OR m.attachment_key LIKE v_prefix || '%'),
    'payment_events', (SELECT count(*) FROM public.payment_events e
       WHERE e.receipt_key LIKE v_prefix || '%')
  ) INTO v_hits;
  PERFORM set_config('t6r.residue', v_hits::text, false);

  SELECT count(*) INTO v_backends FROM pg_catalog.pg_stat_activity
   WHERE application_name LIKE 'slmm-t6-%' AND pid <> pg_backend_pid();
  SELECT count(*) INTO v_xact_count FROM pg_catalog.pg_stat_activity
   WHERE application_name LIKE 'slmm-t6-%' AND xact_start IS NOT NULL
     AND pid <> pg_backend_pid();
  SELECT count(*) INTO v_lock_count FROM pg_catalog.pg_locks l
    JOIN pg_catalog.pg_stat_activity s ON s.pid = l.pid
   WHERE s.application_name LIKE 'slmm-t6-%' AND l.locktype = 'advisory'
     AND s.pid <> pg_backend_pid();
  PERFORM set_config('t6r.hygiene', jsonb_build_object(
    'backends', v_backends,
    'openXacts', v_xact_count,
    'advisoryLocks', v_lock_count)::text, false);

  IF EXISTS (SELECT 1 FROM jsonb_each_text(v_hits) AS h(relation, n) WHERE h.n::int > 0) THEN
    RAISE EXCEPTION 'T6 residue detected; synthetic rows remain: %', v_hits::text;
  END IF;
  IF v_backends > 0 THEN
    RAISE EXCEPTION 'T6 session residue detected: % surviving T6 backend(s)', v_backends;
  END IF;
  IF v_xact_count > 0 THEN
    RAISE EXCEPTION 'T6 open transaction residue detected: % backend(s)', v_xact_count;
  END IF;
  IF v_lock_count > 0 THEN
    RAISE EXCEPTION 'T6 advisory lock residue detected: % lock(s)', v_lock_count;
  END IF;

  RAISE NOTICE 'T6 residue check clean (ten relations zero, no T6 backends): %', v_hits::text;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('t6r.sqlstate', SQLSTATE, false);
  PERFORM set_config('t6r.message', SQLERRM, false);
END
$t6r$;


-- >>> SECTION: rollback
-- Every session ends here. ROLLBACK is the ONLY permitted terminator: the
-- R06 allowlist fails the case set if a COMMIT is ever issued.
ROLLBACK;
