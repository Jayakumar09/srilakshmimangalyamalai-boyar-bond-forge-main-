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


-- >>> SECTION: preflight.schema
-- MANDATORY, FAIL-CLOSED hosted-schema preflight.
--
-- It runs in its OWN bounded READ ONLY transaction, on its OWN session
-- (application_name slmm-t6-pf), after the live-authorization gate and the
-- TEST endpoint identity checks, and BEFORE any T6-R01..T6-R05 fixture is
-- created. The two acting sessions are not even connected yet.
--
-- The expected contract below is reviewed and explicit. It is derived from
-- the committed migrations:
--   20261017120000_document_storage_reference_state.sql
--   20261017130000_storage_reference_state.sql
--   20261017140000_storage_deletion_lifecycle.sql
--   20261017150000_storage_deletion_fence.sql
--
-- Every check is fail-closed: a missing, unreadable, unexpected or drifted
-- object is a FAILURE, never a warning. All failures are reported together
-- so one blocked run names every gap. The runner treats a failed preflight
-- as BLOCKED for T6-R01..T6-R05 and never starts the cases.
--
-- Checks:
--   1. every relevant relation exists (10 T6 relations + auth.users);
--   2. the synthetic T6 namespace is COMPLETELY empty: all three synthetic
--      identities and the storage-key prefix must count zero everywhere;
--   3. every required lifecycle/fence function exists with the expected
--      argument types, return type, set-returning shape and SECURITY
--      DEFINER property;
--   4. every fence trigger exists, is enabled, is a row-level BEFORE INSERT
--      OR UPDATE trigger and guards the expected column;
--   5. the expected constraints are present with the expected definitions;
--   6. the expected indexes are present, unique, valid and (where required)
--      partial;
--   7. row-level security is ENABLED on the two T6 tables with no policies,
--      service_role keeps full access, and anon/authenticated hold no data
--      privilege on them;
--   8. the expected function EXECUTE grants hold and nobody else has them.
BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY;
SET LOCAL search_path = pg_catalog, public;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SELECT set_config('t6r.owner', :'owner', false);
SELECT set_config('t6r.other', :'other', false);
SELECT set_config('t6r.admin', :'admin', false);
SELECT set_config('t6r.prefix', :'prefix', false);
DO $t6r$
DECLARE
  v_fail     text[] := ARRAY[]::text[];
  v_checked  int := 0;
  v_missing  text[];
  v_owner    constant uuid := nullif(current_setting('t6r.owner', true), '')::uuid;
  v_other    constant uuid := nullif(current_setting('t6r.other', true), '')::uuid;
  v_admin    constant uuid := nullif(current_setting('t6r.admin', true), '')::uuid;
  v_prefix   constant text := current_setting('t6r.prefix');
  v_rel      text;
  v_trg      text;
  v_col      text;
  v_fn       text;
  v_idx      text;
  v_kind     text;
  v_exp_args text;
  v_exp_ret  text;
  v_exp_set  boolean;
  v_exp_exec text;
  v_oid      oid;
  v_act_ret  text;
  v_act_set  boolean;
  v_secdef   boolean;
  v_def      text;
  v_enabled  text;
  v_tgtype   smallint;
  v_trg_oid  oid;
  v_attnum   smallint;
  v_tgattr   text;
  v_upd_clause text;
  v_upd_names text[];
  v_actual_cols int2[];
  v_n_listed int;
  v_n        bigint;
  v_fp_expected constant text := 'a85fea6468487830a4ca9afc268d9aef';
  v_fp_count int := 0;
  v_fp_digest text := NULL;
  v_uniq     boolean;
  v_valid    boolean;
  v_partial  boolean;
  v_rls      boolean;
  v_counts   jsonb := '{}'::jsonb;
BEGIN
  -- 1. every relevant relation must exist -----------------------------------
  SELECT array_agg(r ORDER BY r) INTO v_missing
    FROM unnest(ARRAY[
      'public.storage_deletion_requests', 'public.storage_deletion_fences',
      'public.documents', 'public.profiles', 'public.user_roles', 'public.payments',
      'public.jathagam_requests', 'public.support_threads', 'public.support_messages',
      'public.payment_events', 'auth.users'
    ]) AS r
   WHERE to_regclass(r) IS NULL;
  IF v_missing IS NOT NULL THEN
    v_fail := array_append(v_fail, 'missing relation(s): ' || array_to_string(v_missing, ', '));
  END IF;

  -- 2. the synthetic T6 namespace must be completely empty -------------------
  IF v_missing IS NULL THEN
    SELECT count(*) INTO v_n FROM auth.users u WHERE u.id IN (v_owner, v_other, v_admin);
    v_counts := v_counts || jsonb_build_object('auth.users', v_n);
    v_checked := v_checked + 1;
    IF v_n <> 0 THEN
      v_fail := array_append(v_fail, format('auth.users holds %s synthetic identity row(s)', v_n));
    END IF;

    SELECT count(*) INTO v_n FROM public.storage_deletion_requests r
     WHERE r.owner_id IN (v_owner, v_other, v_admin) OR r.requested_by IN (v_owner, v_other, v_admin)
        OR r.storage_key LIKE v_prefix || '%';
    v_counts := v_counts || jsonb_build_object('storage_deletion_requests', v_n);
    v_checked := v_checked + 1;
    IF v_n <> 0 THEN
      v_fail := array_append(v_fail, format('storage_deletion_requests holds %s synthetic row(s)', v_n));
    END IF;

    SELECT count(*) INTO v_n FROM public.storage_deletion_fences f WHERE f.storage_key LIKE v_prefix || '%';
    v_counts := v_counts || jsonb_build_object('storage_deletion_fences', v_n);
    v_checked := v_checked + 1;
    IF v_n <> 0 THEN
      v_fail := array_append(v_fail, format('storage_deletion_fences holds %s synthetic row(s)', v_n));
    END IF;

    SELECT count(*) INTO v_n FROM public.documents d
     WHERE d.user_id IN (v_owner, v_other, v_admin) OR d.storage_key LIKE v_prefix || '%';
    v_counts := v_counts || jsonb_build_object('documents', v_n);
    v_checked := v_checked + 1;
    IF v_n <> 0 THEN
      v_fail := array_append(v_fail, format('documents holds %s synthetic row(s)', v_n));
    END IF;

    SELECT count(*) INTO v_n FROM public.profiles p
     WHERE p.id IN (v_owner, v_other, v_admin) OR p.photo_url LIKE v_prefix || '%';
    v_counts := v_counts || jsonb_build_object('profiles', v_n);
    v_checked := v_checked + 1;
    IF v_n <> 0 THEN
      v_fail := array_append(v_fail, format('profiles holds %s synthetic row(s)', v_n));
    END IF;

    SELECT count(*) INTO v_n FROM public.user_roles ur WHERE ur.user_id IN (v_owner, v_other, v_admin);
    v_counts := v_counts || jsonb_build_object('user_roles', v_n);
    v_checked := v_checked + 1;
    IF v_n <> 0 THEN
      v_fail := array_append(v_fail, format('user_roles holds %s synthetic row(s)', v_n));
    END IF;

    SELECT count(*) INTO v_n FROM public.payments p
     WHERE p.user_id IN (v_owner, v_other, v_admin) OR p.proof_key LIKE v_prefix || '%';
    v_counts := v_counts || jsonb_build_object('payments', v_n);
    v_checked := v_checked + 1;
    IF v_n <> 0 THEN
      v_fail := array_append(v_fail, format('payments holds %s synthetic row(s)', v_n));
    END IF;

    SELECT count(*) INTO v_n FROM public.jathagam_requests j
     WHERE j.user_id IN (v_owner, v_other, v_admin) OR j.report_key LIKE v_prefix || '%';
    v_counts := v_counts || jsonb_build_object('jathagam_requests', v_n);
    v_checked := v_checked + 1;
    IF v_n <> 0 THEN
      v_fail := array_append(v_fail, format('jathagam_requests holds %s synthetic row(s)', v_n));
    END IF;

    SELECT count(*) INTO v_n FROM public.support_threads st WHERE st.user_id IN (v_owner, v_other, v_admin);
    v_counts := v_counts || jsonb_build_object('support_threads', v_n);
    v_checked := v_checked + 1;
    IF v_n <> 0 THEN
      v_fail := array_append(v_fail, format('support_threads holds %s synthetic row(s)', v_n));
    END IF;

    SELECT count(*) INTO v_n FROM public.support_messages m
     WHERE m.sender_id IN (v_owner, v_other, v_admin) OR m.attachment_key LIKE v_prefix || '%';
    v_counts := v_counts || jsonb_build_object('support_messages', v_n);
    v_checked := v_checked + 1;
    IF v_n <> 0 THEN
      v_fail := array_append(v_fail, format('support_messages holds %s synthetic row(s)', v_n));
    END IF;

    SELECT count(*) INTO v_n FROM public.payment_events e
     WHERE e.user_id IN (v_owner, v_other, v_admin) OR e.receipt_key LIKE v_prefix || '%';
    v_counts := v_counts || jsonb_build_object('payment_events', v_n);
    v_checked := v_checked + 1;
    IF v_n <> 0 THEN
      v_fail := array_append(v_fail, format('payment_events holds %s synthetic row(s)', v_n));
    END IF;
  END IF;

  -- 3. the required lifecycle and fence functions ---------------------------
  FOR v_fn, v_exp_args, v_exp_ret, v_exp_set IN
    SELECT * FROM (VALUES
      ('request_storage_deletion',                 'text',                 'uuid',    false),
      ('get_document_storage_reference_state',     'text',                 'record',  true),
      ('get_storage_reference_state',              'text',                 'record',  true),
      ('check_storage_deletion_references',        'text',                 'record',  true),
      ('claim_storage_deletion_request',           'uuid',                 'record',  true),
      ('claim_storage_deletion_requests',          'integer',              'record',  true),
      ('block_storage_deletion',                   'uuid, uuid, text',     'boolean', false),
      ('record_storage_deletion_failure',          'uuid, uuid, text, integer', 'text', false),
      ('set_r2_confirmed_absent',                  'uuid, uuid',           'boolean', false),
      ('finalize_storage_deletion',                'uuid, uuid',           'boolean', false),
      ('mark_storage_deletion_quota_resynced',     'uuid',                 'void',    false),
      ('list_storage_deletion_quota_resyncs',      'integer',              'record',  true),
      ('cancel_storage_deletion',                  'uuid',                 'boolean', false),
      ('enforce_storage_key_fence',                '',                     'trigger', false),
      ('fence_storage_key_for_deletion',           'uuid, uuid',           'text',    false),
      ('is_storage_key_fenced',                    'text',                 'boolean', false),
      ('has_role',                                 'uuid, public.app_role','boolean', false)
    ) AS t(fn, args, ret, setret)
  LOOP
    v_checked := v_checked + 1;
    -- The function is resolved by IDENTITY (schema, name and the EXACT
    -- argument types) through the catalog, never by comparing a RENDERED type
    -- string. A rendered string schema-qualifies every non-builtin type, so
    -- an unqualified literal would never match and a correctly configured
    -- project would be refused. The argument list below is written in the
    -- regprocedure input form, which resolves to an OID.
    v_oid := pg_catalog.to_regprocedure('public.' || v_fn || '(' || v_exp_args || ')')::oid;
    IF v_oid IS NULL THEN
      SELECT count(*) INTO v_n FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = v_fn;
      IF v_n = 0 THEN
        v_fail := array_append(v_fail, format('function public.%s(%s) is missing', v_fn, v_exp_args));
      ELSE
        v_fail := array_append(v_fail, format('function public.%s exists but NOT with the expected argument types (%s)', v_fn, v_exp_args));
      END IF;
    ELSE
      SELECT pg_catalog.format_type(p.prorettype, NULL), p.proretset, p.prosecdef
        INTO v_act_ret, v_act_set, v_secdef
        FROM pg_catalog.pg_proc p
       WHERE p.oid = v_oid;
      IF v_act_ret <> v_exp_ret THEN
        v_fail := array_append(v_fail, format('function public.%s(%s) returns %s, expected %s',
          v_fn, v_exp_args, v_act_ret, v_exp_ret));
      ELSIF v_act_set <> v_exp_set THEN
        v_fail := array_append(v_fail, format('function public.%s(%s) has a different set-returning shape', v_fn, v_exp_args));
      ELSIF NOT v_secdef THEN
        v_fail := array_append(v_fail, format('function public.%s(%s) is not SECURITY DEFINER', v_fn, v_exp_args));
      END IF;
    END IF;
  END LOOP;
  -- 4. the fence triggers ----------------------------------------------------
  FOR v_rel, v_trg, v_col IN
    SELECT * FROM (VALUES
      ('public.documents',         'documents_50_storage_key_fence',         'storage_key'),
      ('public.payments',          'payments_50_proof_key_fence',            'proof_key'),
      ('public.jathagam_requests', 'jathagam_requests_50_report_key_fence',  'report_key'),
      ('public.support_messages',  'support_messages_50_attachment_key_fence','attachment_key'),
      ('public.profiles',          'profiles_50_photo_url_fence',             'photo_url'),
      ('public.payment_events',    'payment_events_50_receipt_key_fence',    'receipt_key')
    ) AS t(rel, trg, col)
  LOOP
    v_checked := v_checked + 1;
    SELECT pg_catalog.pg_get_triggerdef(tg.oid), tg.tgenabled, tg.tgtype, tg.oid
      INTO v_def, v_enabled, v_tgtype, v_trg_oid
      FROM pg_catalog.pg_trigger tg
     WHERE tg.tgrelid = to_regclass(v_rel) AND tg.tgname = v_trg AND NOT tg.tgisinternal;
    IF NOT FOUND THEN
      v_fail := array_append(v_fail, format('trigger %s is missing on %s', v_trg, v_rel));
    ELSIF v_enabled NOT IN ('O', 'A') THEN
      v_fail := array_append(v_fail, format('trigger %s on %s is not enabled (%s)', v_trg, v_rel, v_enabled));
    ELSIF (v_tgtype & 1) <> 1 OR (v_tgtype & 2) <> 2 OR (v_tgtype & 4) <> 4 OR (v_tgtype & 16) <> 16 THEN
      v_fail := array_append(v_fail, format('trigger %s on %s is not a row-level BEFORE INSERT OR UPDATE trigger (tgtype=%s)',
        v_trg, v_rel, v_tgtype));
    ELSIF v_def NOT LIKE '%enforce_storage_key_fence%' THEN
      v_fail := array_append(v_fail, format('trigger %s on %s does not execute enforce_storage_key_fence', v_trg, v_rel));
    ELSE
      -- The guarded column is verified by COLUMN NUMBER, never by a substring:
      -- the rendered definition always begins with the trigger NAME, and every
      -- fence trigger name already contains the column name, so a substring
      -- test could be satisfied by the name alone.
      SELECT a.attnum INTO v_attnum
        FROM pg_catalog.pg_attribute a
       WHERE a.attrelid = to_regclass(v_rel) AND a.attname = v_col
         AND a.attnum > 0 AND NOT a.attisdropped;
      IF v_attnum IS NULL THEN
        v_fail := array_append(v_fail, format('column %s does not exist on %s', v_col, v_rel));
      ELSE
        -- The rendered UPDATE OF clause must name the expected column. The
        -- clause comes from the trigger's RECONSTRUCTED command, and
        -- pg_get_triggerdef's documented contract is to reconstruct the
        -- creating command, whose documented syntax is
        -- "UPDATE [ OF column_name [, ... ] ]".
        v_upd_clause := pg_catalog.substring(v_def from 'UPDATE OF ([^ ]+)');
        IF v_upd_clause IS DISTINCT FROM v_col THEN
          v_fail := array_append(v_fail, format('trigger %s on %s does not guard column %s (it guards "%s")',
            v_trg, v_rel, v_col, coalesce(v_upd_clause, 'nothing')));
        ELSE
          -- AUTHORITATIVE CHECK: the trigger's COMPLETE UPDATE-column set,
          -- as an ARRAY OF COLUMN NUMBERS, must be exactly the expected
          -- pg_attribute.attnum.
          --
          -- The set is rebuilt from the reconstructed command and every
          -- listed name is resolved to its attnum, so the comparison does not
          -- depend on how any catalog vector is rendered. A wrong column, an
          -- extra column and a listed column that no longer exists all make
          -- the resolved set differ from the expected attnum.
          v_upd_names := pg_catalog.string_to_array(pg_catalog.replace(btrim(v_upd_clause), ' ', ''), ',');
          SELECT count(*) INTO v_n_listed FROM pg_catalog.unnest(v_upd_names);
          SELECT array_agg(a.attnum ORDER BY a.attnum) INTO v_actual_cols
            FROM pg_catalog.unnest(v_upd_names) AS s(cname)
            JOIN pg_catalog.pg_attribute a
              ON a.attrelid = to_regclass(v_rel) AND a.attname = s.cname
             AND a.attnum > 0 AND NOT a.attisdropped;
          IF v_n_listed <> coalesce(pg_catalog.cardinality(v_actual_cols), 0) THEN
            v_fail := array_append(v_fail, format('trigger %s on %s lists a column that does not exist on %s',
              v_trg, v_rel, v_rel));
          ELSIF v_actual_cols IS DISTINCT FROM ARRAY[v_attnum]::int2[] THEN
            v_fail := array_append(v_fail, format('trigger %s on %s guards column number(s) %s instead of %s (attnum %s)',
              v_trg, v_rel, coalesce(v_actual_cols::text, 'none'), v_col, v_attnum));
          END IF;
          -- CROSS-CHECK against the trigger's OWN stored column numbers.
          -- int2vector is an array-LIKE type (its element type is int2 and
          -- it supports subscripting) and its TEXT rendering differs between
          -- PostgreSQL releases, so the braces are canonicalised away before
          -- the comparison. This check can therefore no longer refuse a
          -- correct trigger because of a rendering difference.
          SELECT pg_catalog.replace(pg_catalog.replace(pg_catalog.btrim(tg.tgattr::text), '{', ''), '}', '')
            INTO v_tgattr
            FROM pg_catalog.pg_trigger tg
           WHERE tg.oid = v_trg_oid;
          IF v_tgattr IS NOT NULL AND v_tgattr <> '' AND v_tgattr <> v_attnum::text THEN
            v_fail := array_append(v_fail, format('trigger %s on %s stores column number(s) %s instead of %s (attnum %s)',
              v_trg, v_rel, v_tgattr, v_col, v_attnum));
          END IF;
        END IF;
      END IF;
    END IF;  END LOOP;

  -- 5. the expected constraints ----------------------------------------------
  v_checked := v_checked + 1;
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = to_regclass('public.storage_deletion_requests')
     AND c.conname = 'storage_deletion_requests_owner_prefix_check';
  IF NOT FOUND THEN
    v_fail := array_append(v_fail, 'constraint storage_deletion_requests_owner_prefix_check is missing');
  ELSIF v_def NOT LIKE '%split_part%' OR v_def NOT LIKE '%owner_id%' THEN
    v_fail := array_append(v_fail, 'constraint storage_deletion_requests_owner_prefix_check has an unexpected definition: ' || v_def);
  END IF;

  v_checked := v_checked + 1;
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = to_regclass('public.payments') AND c.conname = 'payments_method_allowed';
  IF NOT FOUND THEN
    v_fail := array_append(v_fail, 'constraint payments_method_allowed is missing');
  ELSIF v_def NOT LIKE '%online%' OR v_def NOT LIKE '%upi%' OR v_def NOT LIKE '%bank_transfer%' THEN
    v_fail := array_append(v_fail, 'constraint payments_method_allowed has an unexpected definition: ' || v_def);
  END IF;

  v_checked := v_checked + 1;
  SELECT c.conname INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = to_regclass('public.storage_deletion_fences') AND c.contype = 'p';
  IF NOT FOUND THEN
    v_fail := array_append(v_fail, 'public.storage_deletion_fences has no primary key');
  END IF;

  -- 6. the expected indexes ---------------------------------------------------
  FOR v_idx, v_kind IN
    SELECT * FROM (VALUES
      ('storage_deletion_requests_live_key',   'unique-partial'),
      ('storage_deletion_fences_pkey',          'unique'),
      ('payments_manual_utr_user_item_uniq',    'unique-partial'),
      ('payments_manual_submitted_user_item_uniq','unique-partial')
    ) AS t(idx, kind)
  LOOP
    v_checked := v_checked + 1;
    SELECT i.indisunique, i.indisvalid, (i.indpred IS NOT NULL)
      INTO v_uniq, v_valid, v_partial
      FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = v_idx;
    IF NOT FOUND THEN
      v_fail := array_append(v_fail, format('index %s is missing', v_idx));
    ELSIF NOT v_uniq THEN
      v_fail := array_append(v_fail, format('index %s is not unique', v_idx));
    ELSIF NOT v_valid THEN
      v_fail := array_append(v_fail, format('index %s is not valid', v_idx));
    ELSIF v_kind = 'unique-partial' AND NOT v_partial THEN
      v_fail := array_append(v_fail, format('index %s is not the expected partial index', v_idx));
    END IF;
  END LOOP;

  v_checked := v_checked + 1;
  SELECT pg_catalog.pg_get_indexdef(i.indexrelid) INTO v_def
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'storage_deletion_requests_live_key';
  IF NOT FOUND THEN
    v_fail := array_append(v_fail, 'index storage_deletion_requests_live_key is missing');
  ELSIF v_def NOT LIKE '%storage_key%' OR v_def NOT LIKE '%pending%' THEN
    v_fail := array_append(v_fail, 'index storage_deletion_requests_live_key has an unexpected definition: ' || v_def);
  END IF;

  -- 7. row-level security, policies and table privileges --------------------
  FOR v_rel IN SELECT unnest(ARRAY['public.storage_deletion_requests', 'public.storage_deletion_fences']) LOOP
    v_checked := v_checked + 1;
    SELECT c.relrowsecurity INTO v_rls FROM pg_catalog.pg_class c WHERE c.oid = to_regclass(v_rel);
    IF NOT FOUND THEN
      v_fail := array_append(v_fail, format('relation %s does not exist', v_rel));
    ELSIF NOT v_rls THEN
      v_fail := array_append(v_fail, format('row-level security is not enabled on %s', v_rel));
    END IF;

    v_checked := v_checked + 1;
    SELECT count(*) INTO v_n FROM pg_catalog.pg_policies
     WHERE schemaname = split_part(v_rel, '.', 1) AND tablename = split_part(v_rel, '.', 2);
    IF v_n <> 0 THEN
      v_fail := array_append(v_fail, format('%s exposes %s row-level policy/policies', v_rel, v_n));
    END IF;

    v_checked := v_checked + 1;
    IF NOT has_table_privilege('service_role', v_rel, 'SELECT,INSERT,UPDATE,DELETE') THEN
      v_fail := array_append(v_fail, format('service_role does not hold full data access on %s', v_rel));
    END IF;

    v_checked := v_checked + 1;
    IF has_table_privilege('anon', v_rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN
      v_fail := array_append(v_fail, format('anon holds a data privilege on %s', v_rel));
    END IF;

    v_checked := v_checked + 1;
    IF has_table_privilege('authenticated', v_rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN
      v_fail := array_append(v_fail, format('authenticated holds a data privilege on %s', v_rel));
    END IF;
  END LOOP;

  -- 8. the expected function EXECUTE grants ----------------------------------
  FOR v_fn, v_exp_args, v_exp_exec IN
    SELECT * FROM (VALUES
      ('request_storage_deletion',              'text',                 'authenticated'),
      ('cancel_storage_deletion',                'uuid',                 'authenticated'),
      ('get_document_storage_reference_state',  'text',                 'authenticated'),
      ('get_storage_reference_state',           'text',                 'authenticated'),
      ('enforce_storage_key_fence',             '',                     'authenticated,service_role'),
      ('check_storage_deletion_references',     'text',                 'service_role'),
      ('claim_storage_deletion_request',        'uuid',                 'service_role'),
      ('claim_storage_deletion_requests',       'integer',              'service_role'),
      ('block_storage_deletion',                'uuid, uuid, text',     'service_role'),
      ('record_storage_deletion_failure',       'uuid, uuid, text, integer', 'service_role'),
      ('set_r2_confirmed_absent',               'uuid, uuid',           'service_role'),
      ('finalize_storage_deletion',             'uuid, uuid',           'service_role'),
      ('mark_storage_deletion_quota_resynced',  'uuid',                 'service_role'),
      ('list_storage_deletion_quota_resyncs',   'integer',              'service_role'),
      ('fence_storage_key_for_deletion',        'uuid, uuid',           'service_role'),
      ('is_storage_key_fenced',                 'text',                 'service_role')
    ) AS t(fn, args, exec)
  LOOP
    v_checked := v_checked + 1;
    -- Resolved by identity, exactly as the contract check above.
    v_oid := pg_catalog.to_regprocedure('public.' || v_fn || '(' || v_exp_args || ')')::oid;
    IF v_oid IS NULL THEN
      v_fail := array_append(v_fail, format('function public.%s(%s) is missing, so its EXECUTE grant cannot be verified', v_fn, v_exp_args));
      CONTINUE;
    END IF;
    IF v_exp_exec LIKE '%authenticated%' AND NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      v_fail := array_append(v_fail, format('authenticated cannot EXECUTE public.%s(%s)', v_fn, v_exp_args));
    END IF;
    IF v_exp_exec LIKE '%service_role%' AND NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      v_fail := array_append(v_fail, format('service_role cannot EXECUTE public.%s(%s)', v_fn, v_exp_args));
    END IF;
    IF v_exp_exec NOT LIKE '%authenticated%' AND has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      v_fail := array_append(v_fail, format('authenticated may EXECUTE public.%s(%s) but must not', v_fn, v_exp_args));
    END IF;
    IF v_exp_exec NOT LIKE '%service_role%' AND has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      v_fail := array_append(v_fail, format('service_role may EXECUTE public.%s(%s) but must not', v_fn, v_exp_args));
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      v_fail := array_append(v_fail, format('anon may EXECUTE public.%s(%s) but must not', v_fn, v_exp_args));
    END IF;
  END LOOP;

  -- 9. THE PINNED T6 FUNCTION-DEFINITION FINGERPRINT -------------------------
  -- Fail closed. The contract is T6-specific and version-stable:
  --   md5(jsonb_build_object('schema','t6-group-r-fingerprint/v2','functions',
  --        jsonb_agg( jsonb_build_object(
  --            'name',p.proname, 'args',pg_catalog.oidvectortypes(p.proargtypes),
  --            'returns',pg_catalog.format_type(p.prorettype,NULL), 'setof',p.proretset,
  --            'secdef',p.prosecdef, 'volatile',p.provolatile, 'parallel',p.proparallel,
  --            'leakproof',p.proleakproof, 'owner',pg_get_userbyid(p.proowner),
  --            'body_md5',md5(p.prosrc) ) ORDER BY p.proname) ))::text)
  -- The expected digest was OBSERVED on Supabase TEST and independently
  -- reproduced from that capture. PostgreSQL 17.11 is recorded as the observed
  -- baseline version but is NOT a blocking condition: the digest and the other
  -- contracts decide. The v1 fingerprint is kept for historical reference only
  -- and is never asserted.
  SELECT count(*) INTO v_fp_count
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = ANY(ARRAY[
       'request_storage_deletion','get_document_storage_reference_state','get_storage_reference_state',
       'check_storage_deletion_references','claim_storage_deletion_request','claim_storage_deletion_requests',
       'block_storage_deletion','record_storage_deletion_failure','set_r2_confirmed_absent',
       'finalize_storage_deletion','mark_storage_deletion_quota_resynced','list_storage_deletion_quota_resyncs',
       'cancel_storage_deletion','enforce_storage_key_fence','fence_storage_key_for_deletion',
       'is_storage_key_fenced','has_role']);
  SELECT md5(jsonb_build_object(
           'schema', 't6-group-r-fingerprint/v2',
           'functions', (
             SELECT coalesce(jsonb_agg(jsonb_build_object(
               'name', p.proname,
               'args', pg_catalog.oidvectortypes(p.proargtypes),
               'returns', pg_catalog.format_type(p.prorettype, NULL),
               'setof', p.proretset,
               'secdef', p.prosecdef,
               'volatile', p.provolatile,
               'parallel', p.proparallel,
               'leakproof', p.proleakproof,
               'owner', pg_get_userbyid(p.proowner),
               'body_md5', md5(p.prosrc)
             ) ORDER BY p.proname), '[]'::jsonb)
             FROM pg_catalog.pg_proc p
             JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname = ANY(ARRAY[
                'request_storage_deletion','get_document_storage_reference_state','get_storage_reference_state',
                'check_storage_deletion_references','claim_storage_deletion_request','claim_storage_deletion_requests',
                'block_storage_deletion','record_storage_deletion_failure','set_r2_confirmed_absent',
                'finalize_storage_deletion','mark_storage_deletion_quota_resynced','list_storage_deletion_quota_resyncs',
                'cancel_storage_deletion','enforce_storage_key_fence','fence_storage_key_for_deletion',
                'is_storage_key_fenced','has_role'])
           ))::text) INTO v_fp_digest;

  IF v_fp_count <> 17 THEN
    v_fail := array_append(v_fail, format('the fingerprint set is incomplete: expected 17 contract functions, found %s', v_fp_count));
  END IF;
  IF v_fp_digest IS NULL OR v_fp_digest !~ '^[0-9a-f]{32}$' THEN
    v_fail := array_append(v_fail, 'the T6 fingerprint could not be calculated or is malformed');
  ELSIF v_fp_digest <> v_fp_expected THEN
    v_fail := array_append(v_fail, format('the T6 fingerprint drifted: expected %s, computed %s', v_fp_expected, v_fp_digest));
  END IF;
  PERFORM set_config('t6r.fingerprint', jsonb_build_object(
    'schema', 't6-group-r-fingerprint/v2',
    'expected', v_fp_expected,
    'computed', coalesce(v_fp_digest, ''),
    'functionCount', v_fp_count,
    'serverVersion', current_setting('server_version'),
    'observedBaselineServerVersion', '17.11'
  )::text, false);

  -- publish the result and fail closed --------------------------------------
  PERFORM set_config('t6r.preflight', jsonb_build_object(
    'schema', 't6-group-r-preflight/v1',
    'ok', (v_missing IS NULL AND array_length(v_fail, 1) IS NULL),
    'checks', v_checked,
    'failures', coalesce(to_jsonb(v_fail), '[]'::jsonb),
    'namespace', v_counts,
    'fingerprint', coalesce(nullif(current_setting('t6r.fingerprint', true), '')::jsonb, '{}'::jsonb)
  )::text, false);

  IF array_length(v_fail, 1) IS NOT NULL THEN
    PERFORM set_config('t6r.sqlstate', 'TPF01', false);
    PERFORM set_config('t6r.message',
      'T6-R hosted-schema preflight failed: ' || array_to_string(v_fail, ' | '), false);
    RAISE EXCEPTION 'T6-R hosted-schema preflight failed: %', array_to_string(v_fail, ' | ')
      USING ERRCODE = 'TPF01';
  END IF;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('t6r.sqlstate', SQLSTATE, false);
  PERFORM set_config('t6r.message', SQLERRM, false);
END
$t6r$;
ROLLBACK;


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
