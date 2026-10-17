// slmm-quota-sql-contract-tests.mjs
// ---------------------------------------------------------------------------
// Offline static contract tests for the document-upload quota reservation
// migration and its application wiring.
//
// WHAT THIS IS
//   Static assertions over the TEXT of
//   `supabase/migrations/20260926210000_document_upload_quota_reservation.sql`
//   (the atomic 6 photo / 5 document / 11 file / 20 MiB reservation), plus the
//   cap constants in `src/lib/compress.ts` and the RPC wiring in
//   `src/lib/storage.functions.ts`. It pins: the counter table shape, the
//   per-owner advisory lock that serialises concurrent reservations, the
//   service_role-only guard, the exact cap comparisons and raised codes, the
//   seed-only-on-insert semantics, the GREATEST floors, and the REVOKE/GRANT
//   privilege surface.
//
// WHAT THIS IS NOT
//   It is not a database test. It never proves the migration was applied, that
//   Postgres takes the advisory lock, or that a concurrent reservation is
//   actually refused at runtime. Those belong to a live SQL harness (psql
//   against a real database), which is deliberately NOT run here. A static
//   PASS plus a live FAIL is possible; a static FAIL is a real source defect.
//
// ISOLATION
//   Node built-ins only (node:assert/strict, node:fs, node:test). No network,
//   no database, no environment file, no credentials, no SQL execution, no
//   child_process, no external service. Every path opened is funnelled through
//   a tiny scope guard that refuses anything outside the three approved files.
//
// Run: node --test test-harness/slmm-quota-sql-contract-tests.mjs
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

const MIGRATION = "supabase/migrations/20260926210000_document_upload_quota_reservation.sql";
const COMPRESS = "src/lib/compress.ts";
const STORAGE = "src/lib/storage.functions.ts";
const ALLOWED = [MIGRATION, COMPRESS, STORAGE];

function read(path) {
  if (!ALLOWED.includes(path)) throw new Error(`scope guard refused a read: ${path}`);
  return readFileSync(new URL(path, ROOT), "utf8");
}

const sql = read(MIGRATION);
const compress = read(COMPRESS);
const storage = read(STORAGE);

/** Number of non-overlapping occurrences of a literal. */
const count = (hay, needle) => hay.split(needle).length - 1;

/** Slice one `CREATE OR REPLACE FUNCTION public.<name>(...)` body. */
function fnBody(name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `${name} must be defined in the migration`);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION public.", start + 20);
  const end = next === -1 ? sql.indexOf("REVOKE ALL ON FUNCTION public.", start) : next;
  assert.ok(end > start, `${name} body boundary must be found`);
  return sql.slice(start, end);
}

const reserve = fnBody("reserve_upload_quota");
const release = fnBody("release_upload_quota");
const resync = fnBody("resync_upload_quota");

// ---------------------------------------------------------------------------
// 1. Counter table shape
// ---------------------------------------------------------------------------
test("Q01 counter table exists with the exact measured columns and types", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.document_upload_counters \(/);
  assert.match(sql, /user_id uuid PRIMARY KEY REFERENCES public\.profiles\(id\) ON DELETE CASCADE/);
  assert.match(sql, /photo_count integer NOT NULL DEFAULT 0/);
  assert.match(sql, /doc_count integer NOT NULL DEFAULT 0/);
  assert.match(sql, /byte_count bigint NOT NULL DEFAULT 0/);
  assert.match(sql, /updated_at timestamptz NOT NULL DEFAULT now\(\)/);
});

test("Q02 the non-negative check forbids a counter from going below zero", () => {
  assert.match(sql, /CONSTRAINT document_upload_counters_nonneg/);
  assert.match(sql, /CHECK \(photo_count >= 0 AND doc_count >= 0 AND byte_count >= 0\)/);
});

test("Q03 the counter table is RLS-protected and unreachable from anon/authenticated", () => {
  assert.match(sql, /ALTER TABLE public\.document_upload_counters ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.document_upload_counters FROM anon, authenticated/);
});

// ---------------------------------------------------------------------------
// 2. Every mutator is hardened and serialised per owner
// ---------------------------------------------------------------------------
for (const [name, body] of [
  ["reserve_upload_quota", reserve],
  ["release_upload_quota", release],
  ["resync_upload_quota", resync],
]) {
  test(`Q04 ${name}: SECURITY DEFINER with a pinned search_path`, () => {
    assert.match(body, /LANGUAGE plpgsql/);
    assert.match(body, /SECURITY DEFINER/);
    assert.match(body, /SET search_path = public, pg_temp/);
  });

  test(`Q05 ${name}: refuses any caller that is not service_role (ERRCODE 42501)`, () => {
    assert.match(
      body,
      /IF coalesce\(auth\.role\(\), ''\) <> 'service_role' THEN\s*\n\s*RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'/,
    );
  });

  test(`Q06 ${name}: takes the same per-owner advisory xact lock before mutating`, () => {
    assert.match(body, /PERFORM pg_advisory_xact_lock\(hashtextextended\(p_user_id::text, 0\)\)/);
    // The lock must precede the mutation it protects.
    const lockAt = body.indexOf("pg_advisory_xact_lock");
    const writeAt = body.search(/INSERT INTO public\.document_upload_counters|UPDATE public\.document_upload_counters/);
    assert.ok(lockAt >= 0 && writeAt > lockAt, `${name}: the advisory lock must precede the write`);
  });
}

test("Q07 the advisory lock is taken in exactly the three mutators (no fourth, no omission)", () => {
  assert.equal(count(sql, "pg_advisory_xact_lock("), 3);
});

// ---------------------------------------------------------------------------
// 3. Reservation caps, codes and seed semantics
// ---------------------------------------------------------------------------
test("Q08 reserve enforces the 6 photo / 5 document caps for the folder in question", () => {
  assert.match(reserve, /IF p_folder = 'photo' THEN\s*\n\s*IF v_photo >= 6 THEN\s*\n\s*RAISE EXCEPTION 'UPLOAD_LIMIT_PHOTOS'/);
  assert.match(reserve, /ELSE\s*\n\s*IF v_doc >= 5 THEN\s*\n\s*RAISE EXCEPTION 'UPLOAD_LIMIT_DOCS'/);
});

test("Q09 reserve enforces the combined 11-file cap", () => {
  assert.match(reserve, /IF v_photo \+ v_doc >= 11 THEN\s*\n\s*RAISE EXCEPTION 'UPLOAD_LIMIT_TOTAL'/);
});

test("Q10 reserve enforces the 20 MiB (20971520 byte) storage cap with a strict upper bound", () => {
  assert.match(reserve, /IF v_bytes \+ p_size_bytes > 20971520 THEN\s*\n\s*RAISE EXCEPTION 'UPLOAD_LIMIT_STORAGE'/);
});

test("Q11 reserve validates its inputs and rejects a null/negative size", () => {
  assert.match(reserve, /IF p_user_id IS NULL OR p_size_bytes IS NULL OR p_size_bytes < 0 THEN/);
  assert.match(reserve, /RAISE EXCEPTION 'Invalid quota reservation\.' USING ERRCODE = '22023'/);
});

test("Q12 reserve seeds only on first insert; the conflict path never overwrites counters with the seed", () => {
  assert.match(reserve, /ON CONFLICT \(user_id\) DO UPDATE\s*\n\s*SET updated_at = now\(\)/);
  // The seed must be floored at zero (never a client-supplied negative).
  assert.match(reserve, /GREATEST\(COALESCE\(p_seed_photo, 0\), 0\)/);
  assert.match(reserve, /GREATEST\(COALESCE\(p_seed_doc, 0\), 0\)/);
  assert.match(reserve, /GREATEST\(COALESCE\(p_seed_bytes, 0\), 0\)/);
  // The seed is honoured only by the INSERT values, never by the UPDATE set.
  const conflict = reserve.slice(reserve.indexOf("ON CONFLICT"));
  assert.ok(!/photo_count = .*p_seed/.test(conflict), "the ON CONFLICT path must not restore the seed");
});

test("Q13 reserve increments exactly one counter and adds the measured bytes", () => {
  assert.match(
    reserve,
    /SET photo_count = photo_count \+ CASE WHEN p_folder = 'photo' THEN 1 ELSE 0 END,\s*\n\s*doc_count = doc_count \+ CASE WHEN p_folder = 'photo' THEN 0 ELSE 1 END,\s*\n\s*byte_count = byte_count \+ p_size_bytes/,
  );
});

// ---------------------------------------------------------------------------
// 4. Release and resync safety
// ---------------------------------------------------------------------------
test("Q14 release floors every counter at zero so a double release cannot create free quota", () => {
  assert.match(release, /GREATEST\(photo_count - CASE WHEN p_folder = 'photo' THEN 1 ELSE 0 END, 0\)/);
  assert.match(release, /GREATEST\(doc_count - CASE WHEN p_folder = 'photo' THEN 0 ELSE 1 END, 0\)/);
  assert.match(release, /GREATEST\(byte_count - p_size_bytes, 0\)/);
  assert.match(release, /IF p_user_id IS NULL OR p_size_bytes IS NULL OR p_size_bytes < 0 THEN/);
  assert.match(release, /RAISE EXCEPTION 'Invalid quota release\.' USING ERRCODE = '22023'/);
});

test("Q15 resync overwrites all three counters from the measured listing (self-healing)", () => {
  assert.match(
    resync,
    /ON CONFLICT \(user_id\) DO UPDATE\s*\n\s*SET photo_count = EXCLUDED\.photo_count,\s*\n\s*doc_count = EXCLUDED\.doc_count,\s*\n\s*byte_count = EXCLUDED\.byte_count/,
  );
  assert.match(resync, /GREATEST\(COALESCE\(p_photo, 0\), 0\)/);
  assert.match(resync, /GREATEST\(COALESCE\(p_doc, 0\), 0\)/);
  assert.match(resync, /GREATEST\(COALESCE\(p_bytes, 0\), 0\)/);
  assert.match(resync, /IF p_user_id IS NULL THEN/);
  assert.match(resync, /RAISE EXCEPTION 'Invalid quota resync\.' USING ERRCODE = '22023'/);
});

// ---------------------------------------------------------------------------
// 5. Privilege surface and transaction wrapping
// ---------------------------------------------------------------------------
test("Q16 every quota function is revoked from PUBLIC/anon/authenticated", () => {
  for (const sig of [
    "public.reserve_upload_quota(uuid, text, bigint, integer, integer, bigint)",
    "public.release_upload_quota(uuid, text, bigint)",
    "public.resync_upload_quota(uuid, integer, integer, bigint)",
  ]) {
    assert.ok(
      sql.includes(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC, anon, authenticated;`),
      `missing REVOKE for ${sig}`,
    );
  }
});

test("Q17 EXECUTE is granted to service_role and to nothing else", () => {
  const grants = sql.match(/GRANT EXECUTE ON FUNCTION [^\n]+/g) ?? [];
  assert.equal(grants.length, 3, "exactly three EXECUTE grants expected");
  for (const g of grants) assert.match(g, / TO service_role;$/);
  assert.ok(!/GRANT EXECUTE ON FUNCTION[^\n]*TO (PUBLIC|anon|authenticated)/.test(sql), "no client role may execute the RPCs");
});

test("Q18 the migration is transaction-wrapped", () => {
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /^COMMIT;/m);
});

// ---------------------------------------------------------------------------
// 6. Cross-checks: TypeScript caps and RPC wiring agree with the SQL
// ---------------------------------------------------------------------------
const num = (name) => {
  const m = compress.match(new RegExp(`export const ${name} = ([^;]+);`));
  assert.ok(m, `${name} must be exported from compress.ts`);
  // eslint-disable-next-line no-new-func -- static text, no user input
  return Function(`"use strict";return (${m[1]});`)();
};

test("Q19 the TypeScript cap constants are exactly 6/5/11/20 MiB", () => {
  assert.equal(num("MAX_PHOTOS_PER_PROFILE"), 6);
  assert.equal(num("MAX_DOCS_PER_PROFILE"), 5);
  assert.equal(num("MAX_TOTAL_FILES_PER_PROFILE"), 11);
  assert.equal(num("MAX_PROFILE_STORAGE_BYTES"), 20 * 1024 * 1024);
});

test("Q20 the SQL caps match the TypeScript caps digit-for-digit", () => {
  const photos = num("MAX_PHOTOS_PER_PROFILE");
  const docs = num("MAX_DOCS_PER_PROFILE");
  const total = num("MAX_TOTAL_FILES_PER_PROFILE");
  const bytes = num("MAX_PROFILE_STORAGE_BYTES");
  assert.ok(reserve.includes(`v_photo >= ${photos}`), "photo cap drift between SQL and TypeScript");
  assert.ok(reserve.includes(`v_doc >= ${docs}`), "document cap drift between SQL and TypeScript");
  assert.ok(reserve.includes(`v_photo + v_doc >= ${total}`), "total cap drift between SQL and TypeScript");
  assert.ok(reserve.includes(`v_bytes + p_size_bytes > ${bytes}`), "storage cap drift between SQL and TypeScript");
});

test("Q21 storage.functions.ts wires all three quota RPCs", () => {
  for (const rpc of ["reserve_upload_quota", "release_upload_quota", "resync_upload_quota"]) {
    assert.ok(storage.includes(`rpc("${rpc}"`), `storage.functions.ts must call ${rpc}`);
  }
});

test("Q22 the raised codes are still resolvable by the TypeScript quota error mapper", () => {
  for (const code of ["UPLOAD_LIMIT_PHOTOS", "UPLOAD_LIMIT_DOCS", "UPLOAD_LIMIT_TOTAL", "UPLOAD_LIMIT_STORAGE"]) {
    assert.ok(compress.includes(`export const ${code} = "${code}"`), `compress.ts must export ${code}`);
    assert.ok(reserve.includes(code), `reserve_upload_quota must raise ${code}`);
  }
});
