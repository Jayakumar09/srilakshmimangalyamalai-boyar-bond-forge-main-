// Offline SQL text contracts only. Does not execute SQL or verify deployed RLS,
// grants, function ownership, or concurrent-insertion behaviour.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../supabase/migrations/20261017140000_storage_deletion_lifecycle.sql", import.meta.url),
  "utf8",
);

test("durable request table stores the full lifecycle state with constraints", () => {
  assert.match(sql, /CREATE TABLE public\.storage_deletion_requests \(/);
  for (const column of [
    "id uuid PRIMARY KEY",
    "storage_key text NOT NULL",
    "owner_id uuid NOT NULL",
    "requested_by uuid NOT NULL",
    "requested_as_admin boolean NOT NULL",
    "status text NOT NULL",
    "r2_state text NOT NULL",
    "finalize_state text NOT NULL",
    "block_reason text",
    "last_error text",
    "attempt_count integer NOT NULL",
    "document_row_ids uuid\[\] NOT NULL",
    "lease_token uuid",
    "lease_expires_at timestamptz",
    "quota_resynced_at timestamptz",
    "finalized_at timestamptz",
  ]) {
    assert.ok(sql.includes(column), `missing column: ${column}`);
  }
  assert.match(sql, /status IN \('pending', 'deleting', 'blocked', 'finalizing', 'deleted', 'failed', 'cancelled'\)/);
  assert.match(sql, /r2_state IN \('not_attempted', 'uncertain', 'confirmed_absent'\)/);
  assert.match(sql, /finalize_state IN \('pending', 'done'\)/);
  // Owner is always the key prefix; metadata cannot finalize before R2 is absent.
  assert.match(sql, /split_part\(storage_key, '\/', 1\) = owner_id::text/);
  assert.match(sql, /finalize_state = 'pending' OR r2_state = 'confirmed_absent'/);
  assert.match(sql, /status <> 'deleted' OR \(r2_state = 'confirmed_absent' AND finalize_state = 'done'\)/);
  assert.match(sql, /lease_expires_at IS NULL OR lease_token IS NOT NULL/);
});

test("one live request per key and no client RLS policies", () => {
  assert.match(sql, /CREATE UNIQUE INDEX storage_deletion_requests_live_key/);
  assert.match(sql, /WHERE status IN \('pending', 'deleting', 'blocked', 'finalizing'\)/);
  assert.match(sql, /ALTER TABLE public\.storage_deletion_requests ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /CREATE POLICY .*storage_deletion_requests/);
});

test("client roles hold no direct table privileges on the request table", () => {
  // Supabase default privileges grant ALL (which includes TRUNCATE, REFERENCES
  // and TRIGGER) to anon/authenticated on new public tables. RLS does not filter
  // TRUNCATE, so every table privilege must be revoked explicitly for clients.
  const revoke = sql.match(/REVOKE ([A-Z, ]+)\s+ON public\.storage_deletion_requests\s+FROM ([A-Za-z, ]+);/);
  assert.ok(revoke, "explicit request-table privilege revoke must be present");
  const privileges = revoke[1].split(",").map((p) => p.trim()).sort();
  assert.deepEqual(
    privileges,
    ["DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"].sort(),
  );
  const grantees = revoke[2].split(",").map((g) => g.trim()).sort();
  assert.deepEqual(grantees, ["PUBLIC", "anon", "authenticated"].sort());

  // A client cannot INSERT/UPDATE/DELETE/TRUNCATE the table directly: the revoke
  // above removes the privileges and RLS stays enabled with no client policies.
  assert.ok(grantees.includes("authenticated"));
  for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
    assert.ok(privileges.includes(privilege), `authenticated must not retain ${privilege}`);
  }
  assert.match(sql, /ALTER TABLE public\.storage_deletion_requests ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /CREATE POLICY .*storage_deletion_requests/);

  // Ordering: the revoke must follow table creation and RLS enablement.
  const enableRls = sql.indexOf("ALTER TABLE public.storage_deletion_requests ENABLE ROW LEVEL SECURITY");
  const revokeIdx = sql.indexOf("REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER");
  assert.ok(revokeIdx > enableRls, "table REVOKE must follow ENABLE ROW LEVEL SECURITY");

  // service_role keeps its own direct worker access; RPC access is preserved via
  // the definer-owned functions, whose EXECUTE grants are untouched by the revoke.
  assert.match(sql, /GRANT ALL ON public\.storage_deletion_requests TO service_role;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.request_storage_deletion\(text\) TO authenticated;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.cancel_storage_deletion\(uuid\) TO authenticated;/);
  assert.match(sql, /SECURITY DEFINER/);
});

test("request creation reuses Finding 3 authorization and is idempotent", () => {
  const body = sql.split("CREATE FUNCTION public.request_storage_deletion")[1].split("$$;")[0];
  assert.match(body, /auth\.uid\(\)/);
  assert.match(body, /auth\.role\(\) IS DISTINCT FROM 'authenticated'/);
  assert.match(body, /FROM public\.get_storage_reference_state\(p_storage_key\) AS s/);
  assert.match(body, /has_protected_references IS TRUE/);
  assert.match(body, /may_delete_document_references IS NOT TRUE/);
  assert.match(body, /FROM public\.documents AS d\s+WHERE d\.storage_key = p_storage_key/);
  assert.match(body, /ON CONFLICT DO NOTHING/);
  assert.match(body, /RETURNING id INTO v_id/);
});

test("service-role reference re-check mirrors the Finding 3 predicate list", () => {
  const finding3 = readFileSync(
    new URL("../supabase/migrations/20261017130000_storage_reference_state.sql", import.meta.url),
    "utf8",
  );
  const extract = (text) =>
    [...text.matchAll(/SELECT 1 FROM public\.([a-z_]+) AS [a-z]+ WHERE [a-z]+\.([a-z_]+) = p_storage_key/g)]
      .map((m) => `${m[1]}.${m[2]}`)
      .sort();
  const expected = [
    "jathagam_requests.report_key",
    "payment_events.receipt_key",
    "payments.proof_key",
    "profiles.photo_url",
    "support_messages.attachment_key",
  ];
  assert.deepEqual(extract(finding3), expected);
  const checkBody = sql.split("CREATE FUNCTION public.check_storage_deletion_references")[1].split("$$;")[0];
  assert.deepEqual(extract(checkBody), expected);
  assert.match(checkBody, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(checkBody, /array_agg\(d\.id ORDER BY d\.id\)/);
});

test("claiming is lease/CAS based and reclaims expired leases", () => {
  for (const fn of ["claim_storage_deletion_request", "claim_storage_deletion_requests"]) {
    const body = sql.split(`CREATE FUNCTION public.${fn}`)[1].split("$$;")[0];
    assert.match(body, /lease_token = v_token/);
    assert.match(body, /lease_expires_at = now\(\) \+ interval '5 minutes'/);
    assert.match(body, /lease_expires_at IS NULL OR [a-z]\.lease_expires_at < now\(\)/);
    assert.match(body, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
    assert.match(body, /RETURNING r\.\*/);
  }
  assert.match(sql.split("CREATE FUNCTION public.claim_storage_deletion_requests")[1].split("$$;")[0], /FOR UPDATE SKIP LOCKED/);
});

test("blocked requests back off for one hour on the server clock before reclaim", () => {
  for (const [fn, alias] of [["claim_storage_deletion_request", "r"], ["claim_storage_deletion_requests", "c"]]) {
    const body = sql.split(`CREATE FUNCTION public.${fn}`)[1].split("$$;")[0];
    // Only blocked rows are held back; pending/deleting/finalizing are untouched.
    assert.ok(
      body.includes(`(${alias}.status <> 'blocked' OR ${alias}.updated_at < now() - interval '1 hour')`),
      `${fn} must back blocked rows off for one hour`,
    );
    // Server clock and the unchanged lease/status filters.
    assert.ok(body.includes(`${alias}.status IN ('pending', 'deleting', 'blocked', 'finalizing')`));
    assert.ok(body.includes(`${alias}.lease_expires_at IS NULL OR ${alias}.lease_expires_at < now()`));
    assert.match(body, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
  }
  // updated_at is a reliable blocked-at time only because block_storage_deletion
  // is the sole writer of updated_at while a row is blocked (it also drops the
  // lease, so the failure/confirm/finalize paths can never touch a blocked row).
  const block = sql.split("CREATE FUNCTION public.block_storage_deletion")[1].split("$$;")[0];
  assert.match(block, /status = 'blocked'/);
  assert.match(block, /updated_at = now\(\)/);
  assert.match(block, /lease_token = NULL/);
  assert.match(block, /lease_expires_at = NULL/);
  // Finding 5 remains explicitly documented and is not addressed by this backoff.
  assert.match(sql, /Finding 5/);
});

test("failed requests cool down for 15 minutes under a shared per-key lock", () => {
  const body = sql.split("CREATE FUNCTION public.request_storage_deletion")[1].split("$$;")[0];

  // Cooldown is scoped to FAILED rows only, on a 15-minute server-clock window.
  assert.match(body, /r\.status = 'failed'/);
  assert.match(body, /r\.updated_at > now\(\) - interval '15 minutes'/);
  // Cancelled requests are deliberately exempt: a user may recreate after a
  // cancellation, and there is no 'cancelled' branch anywhere in the creator.
  assert.doesNotMatch(body, /'cancelled'/);

  // Everything the cooldown must not weaken stays in place.
  assert.match(body, /auth\.role\(\) IS DISTINCT FROM 'authenticated'/);
  assert.match(body, /FROM public\.get_storage_reference_state\(p_storage_key\) AS s/);
  assert.match(body, /has_protected_references IS TRUE/);
  assert.match(body, /may_delete_document_references IS NOT TRUE/);
  assert.match(body, /ON CONFLICT DO NOTHING/);
  assert.match(body, /RETURNING id INTO v_id/);

  // Concurrency: the cooldown read is guarded by a transaction-scoped advisory
  // lock on the canonical key, AND the failure transition takes the SAME lock, so
  // the terminal 'failed' commit cannot race past the cooldown read. A plain
  // read-then-insert would lose that race under READ COMMITTED because the
  // live-key unique index does not cover terminal rows.
  assert.match(body, /PERFORM pg_catalog\.pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(p_storage_key, 0\)\)/);
  const cooldownIdx = body.indexOf("pg_advisory_xact_lock");
  const insertIdx = body.indexOf("INSERT INTO public.storage_deletion_requests");
  assert.ok(cooldownIdx < insertIdx, "the lock/cooldown must precede the insert");
  const failure = sql.split("CREATE FUNCTION public.record_storage_deletion_failure")[1].split("$$;")[0];
  assert.match(failure, /PERFORM pg_catalog\.pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(v_key, 0\)\)/);
  // The failure transition still flips to 'failed' and still honours the ceiling.
  assert.match(failure, /THEN 'failed'/);
  assert.match(failure, /GREATEST\(p_max_attempts, 1\)/);
  // A failed row is never reclaimed, so its updated_at is a stable failure time.
  for (const fn of ["claim_storage_deletion_request", "claim_storage_deletion_requests"]) {
    const claim = sql.split(`CREATE FUNCTION public.${fn}`)[1].split("$$;")[0];
    assert.doesNotMatch(claim, /'failed'/);
  }
});

test("every R2/finalize state transition is gated to service_role and CAS on a live lease", () => {
  for (const fn of [
    "block_storage_deletion",
    "record_storage_deletion_failure",
    "set_r2_confirmed_absent",
    "finalize_storage_deletion",
  ]) {
    const body = sql.split(`CREATE FUNCTION public.${fn}`)[1].split("$$;")[0];
    assert.match(body, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/, `${fn} must be service_role gated`);
    assert.match(body, /r\.lease_token = p_lease_token/, `${fn} must CAS on the lease token`);
    assert.match(body, /r\.lease_expires_at > now\(\)/, `${fn} must require a live lease`);
  }
  // Quota tracking intentionally has no lease: it is idempotent bookkeeping.
  const quota = sql.split("CREATE FUNCTION public.mark_storage_deletion_quota_resynced")[1].split("$$;")[0];
  assert.match(quota, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(quota, /r\.status = 'deleted'/);
});

test("quota-resync recovery listing is read-only, service-role gated and fully filtered", () => {
  const body = sql.split("CREATE FUNCTION public.list_storage_deletion_quota_resyncs")[1].split("$$;")[0];
  // Only completed, fully finalized deletions with no recorded resync.
  assert.match(body, /r\.status = 'deleted'/);
  assert.match(body, /r\.finalize_state = 'done'/);
  assert.match(body, /r\.r2_state = 'confirmed_absent'/);
  assert.match(body, /r\.quota_resynced_at IS NULL/);
  // Read-only: recovery can never remove an R2 object or a document row.
  assert.doesNotMatch(body, /\bDELETE\b/);
  assert.doesNotMatch(body, /\bINSERT\b/);
  assert.doesNotMatch(body, /\bUPDATE\b/);
  // Bounded by a non-negative limit, like the batch claim RPC.
  assert.match(body, /LIMIT GREATEST\(p_limit, 0\)/);
  // Same definer hardening as the other lifecycle RPCs.
  assert.match(body, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(body, /\bSTABLE\b/);
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /SET search_path = pg_catalog, pg_temp/);
  assert.match(body, /SET row_security = off/);
  assert.match(body, /RETURNS TABLE \(/);
  assert.match(body, /id uuid/);
  assert.match(body, /owner_id uuid/);
  // Restricted execute grant, trusted ownership and full revoke from clients.
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.list_storage_deletion_quota_resyncs\(integer\) FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /ALTER FUNCTION public\.list_storage_deletion_quota_resyncs\(integer\) OWNER TO postgres/);
});

test("finalize deletes only captured ids, transactionally, and records done", () => {
  const body = sql.split("CREATE FUNCTION public.finalize_storage_deletion")[1].split("$$;")[0];
  assert.match(body, /r\.r2_state = 'confirmed_absent'/);
  assert.match(body, /r\.finalize_state = 'pending'/);
  assert.match(body, /FOR UPDATE/);
  assert.match(body, /DELETE FROM public\.documents AS d\s+WHERE d\.id = ANY\(v_ids\)\s+AND d\.storage_key = v_key/);
  assert.match(body, /finalize_state = 'done'/);
  assert.match(body, /status = 'deleted'/);
  assert.match(body, /lease_token = NULL/);
});

test("finalize fails closed if a captured row still references the key after DELETE", () => {
  const body = sql.split("CREATE FUNCTION public.finalize_storage_deletion")[1].split("$$;")[0];

  // The post-DELETE existence check re-tests exactly the captured ids AND the key,
  // so it can only be satisfied by a row this finalization was supposed to remove.
  assert.match(
    body,
    /IF EXISTS \(\s*SELECT 1 FROM public\.documents AS d\s+WHERE d\.id = ANY\(v_ids\)\s+AND d\.storage_key = v_key\s*\) THEN/,
  );
  // It aborts (fail-closed) rather than silently marking the request done, so the
  // whole finalization transaction rolls back and the request can be retried.
  assert.match(
    body,
    /RAISE EXCEPTION 'Storage deletion could not remove captured document rows for %', v_key/,
  );

  // Ordering/atomicity: DELETE, then the check, then the done/deleted transition.
  const deleteIdx = body.indexOf("DELETE FROM public.documents");
  const checkIdx = body.indexOf("IF EXISTS (");
  const doneIdx = body.indexOf("finalize_state = 'done'");
  assert.ok(deleteIdx >= 0 && checkIdx > deleteIdx, "the existence check must follow the DELETE");
  assert.ok(doneIdx > checkIdx, "the request must only be marked done after the check passes");

  // It is an existence check, NOT a strict deleted-row-count equality: captured
  // rows legitimately removed by an earlier attempt must remain acceptable.
  assert.doesNotMatch(body, /GET DIAGNOSTICS/i);
  assert.doesNotMatch(body, /ROW_COUNT/i);
  assert.doesNotMatch(body, /array_length\(v_ids/);

  // The captured-ID restriction is preserved: only captured ids that still
  // reference the key are considered; unrelated rows are never touched.
  assert.match(
    body,
    /DELETE FROM public\.documents AS d\s+WHERE d\.id = ANY\(v_ids\)\s+AND d\.storage_key = v_key/,
  );
  assert.doesNotMatch(body, /DELETE FROM public\.(?!documents)/);
});

test("cancellation is requester/admin scoped and only before any attempt", () => {
  const body = sql.split("CREATE FUNCTION public.cancel_storage_deletion")[1].split("$$;")[0];
  assert.match(body, /auth\.uid\(\)/);
  assert.match(body, /auth\.role\(\) IS DISTINCT FROM 'authenticated'/);
  assert.match(body, /r\.status = 'pending'/);
  assert.match(body, /r\.r2_state = 'not_attempted'/);
  assert.match(body, /r\.attempt_count = 0/);
  assert.match(body, /r\.requested_by = v_actor OR public\.has_role\(v_actor, 'admin'::public\.app_role\) IS TRUE/);
});

test("EXECUTE grants stay minimal and search_path/owner hardening is applied", () => {
  assert.match(sql, /CREATE FUNCTION public\.request_storage_deletion\(p_storage_key text\)/);
  const grants = sql.match(/GRANT EXECUTE[^;]+;/g) ?? [];
  assert.deepEqual(grants.sort(), [
    "GRANT EXECUTE ON FUNCTION public.block_storage_deletion(uuid, uuid, text) TO service_role;",
    "GRANT EXECUTE ON FUNCTION public.cancel_storage_deletion(uuid) TO authenticated;",
    "GRANT EXECUTE ON FUNCTION public.check_storage_deletion_references(text) TO service_role;",
    "GRANT EXECUTE ON FUNCTION public.claim_storage_deletion_request(uuid) TO service_role;",
    "GRANT EXECUTE ON FUNCTION public.claim_storage_deletion_requests(integer) TO service_role;",
    "GRANT EXECUTE ON FUNCTION public.finalize_storage_deletion(uuid, uuid) TO service_role;",
    "GRANT EXECUTE ON FUNCTION public.list_storage_deletion_quota_resyncs(integer) TO service_role;",
    "GRANT EXECUTE ON FUNCTION public.mark_storage_deletion_quota_resynced(uuid) TO service_role;",
    "GRANT EXECUTE ON FUNCTION public.record_storage_deletion_failure(uuid, uuid, text, integer) TO service_role;",
    "GRANT EXECUTE ON FUNCTION public.request_storage_deletion(text) TO authenticated;",
    "GRANT EXECUTE ON FUNCTION public.set_r2_confirmed_absent(uuid, uuid) TO service_role;",
  ]);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.request_storage_deletion\(text\) FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /SET search_path = pg_catalog, pg_temp/);
  assert.match(sql, /SET row_security = off/);
  assert.match(sql, /OWNER TO postgres/);
});

test("trusted owner visibility guard covers every table the lifecycle reads", () => {
  // Scope to the SELECT visibility loop so the separate DELETE check does not leak in.
  const loop = sql.split("FOR v_table IN SELECT unnest(ARRAY[")[1].split("]) LOOP")[0];
  const tables = [...loop.matchAll(/'public\.([a-z_]+)'::regclass/g)].map((m) => m[1]);
  assert.deepEqual(tables, [
    "documents",
    "storage_deletion_requests",
    "payments",
    "jathagam_requests",
    "support_messages",
    "profiles",
    "payment_events",
  ]);
  assert.match(sql, /RAISE EXCEPTION 'Storage deletion RPC owner lacks authoritative visibility on %', v_table/);
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /^COMMIT;/m);
});

test("finalization owner must hold effective DELETE on public.documents", () => {
  // The guarded check targets public.documents specifically. Scope to just the
  // DELETE block so the SELECT loop cannot satisfy the assertions.
  const deleteGuard = sql.split("v_table := 'public.documents'::regclass")[1].split("END;\n$$;")[0];
  assert.match(deleteGuard, /FROM pg_catalog\.pg_roles AS r/);
  assert.match(deleteGuard, /JOIN pg_catalog\.pg_class AS c ON c\.oid = v_table/);
  assert.match(deleteGuard, /WHERE r\.rolname = 'postgres'/);
  // DELETE is actually required, not silently substituted with visibility.
  assert.match(deleteGuard, /pg_catalog\.has_table_privilege\(r\.oid, c\.oid, 'DELETE'\)/);
  assert.doesNotMatch(deleteGuard, /has_table_privilege\(r\.oid, c\.oid, 'SELECT'\)/);
  // Same trusted-owner / RLS-bypass predicate as the SELECT visibility loop.
  assert.match(deleteGuard, /r\.rolsuper OR r\.rolbypassrls OR \(c\.relowner = r\.oid AND NOT c\.relforcerowsecurity\)/);
  // Fails the migration closed with a clear exception, in enforcing order.
  assert.match(deleteGuard, /RAISE EXCEPTION 'Storage deletion RPC owner lacks effective DELETE on %', v_table/);
  assert.ok(
    deleteGuard.indexOf("has_table_privilege(r.oid, c.oid, 'DELETE')") < deleteGuard.indexOf("RAISE EXCEPTION"),
    "the DELETE privilege must be tested before the exception",
  );
});

test("hardening items 1-4 remain intact alongside the DELETE guard", () => {
  // Item 1: client table privileges revoked (incl. TRUNCATE, which RLS cannot filter).
  assert.match(
    sql,
    /REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON public\.storage_deletion_requests\s+FROM PUBLIC, anon, authenticated;/,
  );
  // Item 2: read-only quota-resync recovery listing.
  assert.match(sql, /CREATE FUNCTION public\.list_storage_deletion_quota_resyncs\(p_limit integer\)/);
  // Item 3: one-hour blocked backoff on both claim paths.
  assert.match(sql, /\(r\.status <> 'blocked' OR r\.updated_at < now\(\) - interval '1 hour'\)/);
  assert.match(sql, /\(c\.status <> 'blocked' OR c\.updated_at < now\(\) - interval '1 hour'\)/);
  // Item 4: failed-request cooldown under a shared per-key advisory lock.
  assert.match(sql, /r\.status = 'failed'\s+AND r\.updated_at > now\(\) - interval '15 minutes'/);
  assert.match(sql, /pg_catalog\.pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(p_storage_key, 0\)\)/);
  assert.match(sql, /pg_catalog\.pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(v_key, 0\)\)/);
});

test("lifecycle reads never mutate the protected reference tables", () => {
  const mutations = [...sql.matchAll(/\b(INSERT INTO|UPDATE|DELETE FROM) public\.([a-z_]+)/g)]
    .map((m) => `${m[1]} ${m[2]}`);
  // Only the request table is written; only captured documents are deleted.
  const protectedTables = ["payments", "jathagam_requests", "support_messages", "profiles", "payment_events", "documents"];
  for (const table of protectedTables) {
    assert.ok(!mutations.some((m) => m === `INSERT INTO ${table}` || m === `UPDATE ${table}`), `must not insert/update ${table}`);
  }
  const deletes = mutations.filter((m) => m.startsWith("DELETE FROM"));
  assert.deepEqual(deletes, ["DELETE FROM documents"]);
  assert.deepEqual([...new Set(mutations.filter((m) => m.startsWith("UPDATE")))], ["UPDATE storage_deletion_requests"]);
  assert.deepEqual([...new Set(mutations.filter((m) => m.startsWith("INSERT INTO")))], ["INSERT INTO storage_deletion_requests"]);
});
