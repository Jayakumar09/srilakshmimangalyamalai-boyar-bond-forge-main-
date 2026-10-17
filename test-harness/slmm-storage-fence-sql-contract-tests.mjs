// Offline SQL text contracts for Finding 5 (the durable per-key deletion fence)
// plus the worker wiring that depends on it. Does not execute SQL: real locks,
// triggers, grants and concurrency are verified only by the isolated PostgreSQL
// harness. Here we pin that the migration and the TypeScript agree.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20261017150000_storage_deletion_fence.sql", import.meta.url),
  "utf8",
);
const deletionMigration = readFileSync(
  new URL("../supabase/migrations/20261017140000_storage_deletion_lifecycle.sql", import.meta.url),
  "utf8",
);
const worker = readFileSync(
  new URL("../src/lib/storage.functions.ts", import.meta.url),
  "utf8",
);
const types = readFileSync(
  new URL("../src/integrations/supabase/types.ts", import.meta.url),
  "utf8",
);

/** The body of `CREATE FUNCTION public.<name>` up to its closing `$$;`. */
function functionBody(source, name) {
  const start = source.indexOf(`CREATE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `CREATE FUNCTION public.${name} must exist`);
  const end = source.indexOf("$$;", start);
  assert.ok(end > start, `public.${name} body must terminate`);
  return source.slice(start, end);
}

// --- The fence table -------------------------------------------------------

test("a permanent per-key fence table exists, keyed by the literal storage key", () => {
  assert.match(migration, /CREATE TABLE public\.storage_deletion_fences \(/);
  assert.match(migration, /storage_key text PRIMARY KEY/);
  assert.match(migration, /request_id uuid,/);
  assert.match(migration, /fenced_at timestamptz NOT NULL DEFAULT now\(\)/);
  // A tombstone must outlive the request row, so no FK is declared.
  assert.doesNotMatch(migration, /REFERENCES public\.storage_deletion_requests/);
  // The fence is never removed by any lifecycle transition.
  assert.doesNotMatch(migration, /DELETE FROM public\.storage_deletion_fences/);
  assert.doesNotMatch(migration, /ALTER TABLE public\.storage_deletion_fences[\s\S]*?DROP/);
});

test("the fence table is RLS-locked to service_role with no policies", () => {
  assert.match(migration, /ALTER TABLE public\.storage_deletion_fences ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /CREATE POLICY[\s\S]*?storage_deletion_fences/);
  assert.match(migration, /REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON public\.storage_deletion_fences\s+FROM PUBLIC, anon, authenticated;/);
  assert.match(migration, /GRANT ALL ON public\.storage_deletion_fences TO service_role;/);
});

// --- The reference-write guard --------------------------------------------

const SIX = [
  ["storage_key", "public.documents"],
  ["proof_key", "public.payments"],
  ["report_key", "public.jathagam_requests"],
  ["attachment_key", "public.support_messages"],
  ["photo_url", "public.profiles"],
  ["receipt_key", "public.payment_events"],
];

test("one BEFORE INSERT/UPDATE guard is attached to each of the six sources", () => {
  for (const [column, table] of SIX) {
    assert.match(
      migration,
      new RegExp(`CREATE TRIGGER \\w+\\s+BEFORE INSERT OR UPDATE OF ${column}\\s+ON ${table}\\b[\\s\\S]*?EXECUTE FUNCTION public\\.enforce_storage_key_fence\\('${column}'\\);`),
      `${table}.${column} must be guarded`,
    );
  }
});

test("the guard is SECURITY DEFINER, pinned and fail-closed", () => {
  const body = functionBody(migration, "enforce_storage_key_fence");
  assert.match(body, /RETURNS trigger/);
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /SET search_path = pg_catalog, pg_temp/);
  assert.match(body, /SET row_security = off/);
  assert.match(body, /TG_ARGV\[0\]/);
  // Fail closed if the trigger is created without its column argument.
  assert.match(body, /IF v_column IS NULL OR v_column = '' THEN[\s\S]*?RAISE EXCEPTION/);
  // NULL reference values are not fenced.
  assert.match(body, /IF v_key IS NULL THEN[\s\S]*?RETURN NEW;/);
});

test("the guard serialises on the same per-key lock and rejects a fenced key", () => {
  const body = functionBody(migration, "enforce_storage_key_fence");
  assert.match(body, /pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(v_key, 0\)\)/);
  assert.match(body, /EXISTS \([\s\S]*?FROM public\.storage_deletion_fences AS f[\s\S]*?WHERE f\.storage_key = v_key/);
  assert.match(body, /RAISE EXCEPTION 'Storage key is fenced for deletion\.'/);
});

// --- Fence establishment ---------------------------------------------------

test("fence establishment is service_role-only and lease-guarded", () => {
  const body = functionBody(migration, "fence_storage_key_for_deletion");
  assert.match(body, /RETURNS text/);
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /IF coalesce\(auth\.role\(\), ''\) <> 'service_role' THEN[\s\S]*?RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';/);
  assert.match(body, /r\.lease_token = p_lease_token/);
  assert.match(body, /r\.lease_expires_at > now\(\)/);
  assert.match(body, /r\.status IN \('pending', 'deleting', 'blocked', 'finalizing'\)/);
  assert.match(body, /RETURN 'not_claimed';/);
});

test("fence establishment takes the per-key lock BEFORE any re-check", () => {
  const body = functionBody(migration, "fence_storage_key_for_deletion");
  const lockAt = body.indexOf("pg_advisory_xact_lock");
  const recheckAt = body.indexOf("blocked_protected_reference");
  assert.ok(lockAt >= 0 && recheckAt > lockAt, "the lock must be taken before the re-check");
});

test("fence establishment is idempotent and re-checks all six sources", () => {
  const body = functionBody(migration, "fence_storage_key_for_deletion");
  // A committed fence short-circuits: a retry reuses it without re-checking.
  assert.match(body, /IF EXISTS \([\s\S]*?FROM public\.storage_deletion_fences AS f[\s\S]*?\) THEN\s*RETURN 'fenced';/);
  for (const [column, table] of SIX) {
    assert.match(body, new RegExp(`${table.replace(".", "\\.")} AS \\w+\\s+WHERE \\w+\\.${column} = v_key`), `${table}.${column} must be re-checked`);
  }
  // Captured document rows are allowed; any new one blocks.
  assert.match(body, /NOT \(d\.id = ANY \(v_ids\)\)/);
  assert.match(body, /RETURN 'blocked_protected_reference';/);
  assert.match(body, /RETURN 'blocked_document_set_changed';/);
  // The durable fence is written last, on the clean path.
  assert.match(body, /INSERT INTO public\.storage_deletion_fences \(storage_key, request_id\)[\s\S]*?ON CONFLICT \(storage_key\) DO NOTHING;[\s\S]*?RETURN 'fenced';/);
});

test("the fence re-check mirrors Finding 4's authoritative predicate list", () => {
  const fence = functionBody(migration, "fence_storage_key_for_deletion");
  const check = functionBody(deletionMigration, "check_storage_deletion_references");
  for (const [column, table] of SIX) {
    const tablePattern = `${table.replace(".", "\\.")} AS \\w+\\s+WHERE \\w+\\.${column}`;
    assert.match(check, new RegExp(tablePattern), `Finding 4 check must keep ${table}.${column}`);
    assert.match(fence, new RegExp(tablePattern), `the fence must re-check ${table}.${column}`);
  }
});

// --- Object-creation safety net -------------------------------------------

test("a service-role-only fence probe guards object creation", () => {
  const body = functionBody(migration, "is_storage_key_fenced");
  assert.match(body, /RETURNS boolean/);
  assert.match(body, /STABLE/);
  assert.match(body, /IF coalesce\(auth\.role\(\), ''\) <> 'service_role' THEN[\s\S]*?RAISE EXCEPTION 'Not allowed'/);
  assert.match(body, /FROM public\.storage_deletion_fences AS f[\s\S]*?WHERE f\.storage_key = p_storage_key/);
});

// --- Privileges ------------------------------------------------------------

test("the Finding 5 functions are revoked from clients and granted narrowly", () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.enforce_storage_key_fence\(\)\s+FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.fence_storage_key_for_deletion\(uuid, uuid\)\s+FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.is_storage_key_fenced\(text\)\s+FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.fence_storage_key_for_deletion\(uuid, uuid\)\s+TO service_role;/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.is_storage_key_fenced\(text\)\s+TO service_role;/);
  // anon must never be able to read or write the fence.
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.fence_storage_key_for_deletion[\s\S]*?TO authenticated/);
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.is_storage_key_fenced[\s\S]*?TO authenticated/);
});

// --- Worker + types wiring -------------------------------------------------

test("the worker fences through the service RPC before it signs or deletes", () => {
  assert.match(worker, /deletionRpc<unknown>\("fence_storage_key_for_deletion"/);
  const fenceAt = worker.indexOf('"fence_storage_key_for_deletion"');
  const signAt = worker.indexOf('signR2(claim.storage_key, "DELETE")');
  assert.ok(fenceAt >= 0 && signAt > fenceAt, "the fence must be requested before the R2 DELETE is signed");
  // The race-prone read-only re-check is replaced by the fencing RPC.
  assert.doesNotMatch(worker, /"check_storage_deletion_references"/);
});

test("the worker fails closed on every non-fenced outcome", () => {
  assert.match(worker, /if \(fence === null\)[\s\S]*?reference_check_unavailable/);
  assert.match(worker, /if \(fence === "not_claimed"\)[\s\S]*?status: "failed"/);
  assert.match(worker, /blocked_protected_reference[\s\S]*?blocked_document_set_changed[\s\S]*?status: "blocked"/);
  // A not-claimed fence must not block (nothing to back off) or touch R2.
  assert.match(worker, /FENCE_OUTCOMES = \[\s*"fenced",\s*"blocked_protected_reference",\s*"blocked_document_set_changed",\s*"not_claimed",\s*\]/);
});

test("the upload path probes the fence before the PUT", () => {
  assert.match(worker, /rpc\("is_storage_key_fenced", \{ p_storage_key: key \}\)/);
  assert.match(worker, /await assertStorageKeyNotFenced\(key\);[\s\S]*?signR2\(key, "PUT"/);
});

test("the generated types expose the Finding 5 table and RPCs", () => {
  assert.match(types, /storage_deletion_fences: \{/);
  assert.match(types, /fence_storage_key_for_deletion: \{\s*Args: \{ p_request_id: string; p_lease_token: string \}\s*Returns: string/);
  assert.match(types, /is_storage_key_fenced: \{\s*Args: \{ p_storage_key: string \}\s*Returns: boolean/);
});
