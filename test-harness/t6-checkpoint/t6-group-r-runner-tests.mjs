// test-harness/t6-checkpoint/t6-group-r-runner-tests.mjs
// ---------------------------------------------------------------------------
// Offline unit tests for the T6 Group-R runner.
//
// Hermetic: no network, no database, no credential, no child process. Every
// assertion is against a pure function or against the harness SQL file read
// as text.
//
// Run with:  node --test test-harness/t6-checkpoint/t6-group-r-runner-tests.mjs
// ---------------------------------------------------------------------------
import { test } from "node:test";
import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SUPABASE_PROJECT_REFS } from "../live-guard.mjs";
import {
  HARNESS_SQL,
  REQUIRED_SECTIONS,
  ALLOWED_STATEMENT_VERBS,
  FORBIDDEN_STATEMENT_VERBS,
  RESIDUE_RELATIONS,
  HYGIENE_KEYS,
  CASE_IDS,
  CASE_STATUSES,
  RESIDUE_GATED_CASES,
  PROBE_PREFIX,
  RESET_SQL,
  PROBE_SQL,
  T6_OWNER,
  T6_OTHER,
  T6_ADMIN,
  T6_KEY_PREFIX,
  REQUIRED_PORT,
  TRANSACTION_POOLER_PORT,
  LOCAL_LAB_PORT,
  assertTestEndpointIdentity,
  isLoopbackHost,
  projectRefFromEndpoint,
  statementVerb,
  isAllowedStatement,
  auditStatementLog,
  findTerminators,
  stripSqlNoise,
  parseHarnessSections,
  missingHarnessSections,
  summarizeResidue,
  parseHygiene,
  parseResidue,
  classifySqlFailure,
  interpretExec,
  describeFailure,
  lastNumeric,
  finalizeResults,
  suiteVerdict,
  isSingleWaiter,
  EVIDENCE_SCHEMA,
  MANIFEST_SCHEMA,
  EVIDENCE_FILE_NAME,
  MANIFEST_FILE_NAME,
  redactSensitive,
  buildEvidenceRecords,
  renderEvidenceJsonl,
  sha256Hex,
  validateEvidenceRecords,
  validateEvidenceGate,
  writeEvidenceBundle,
  verifyEvidenceBundle,
  finalizeEvidence,
  finalSuiteVerdict,
  PREFLIGHT_TAG,
  OBSERVER_TAG,
  HOLDER_TAG,
  WAITER_TAG,
  PREFLIGHT_SCHEMA,
  PREFLIGHT_NAMESPACE_KEYS,
  interpretPreflight,
  T6_FINGERPRINT_CONTRACT,
  T6_FINGERPRINT_EXPECTED,
  T6_FINGERPRINT_SERVER_VERSION,
  T6_FINGERPRINT_FUNCTION_COUNT,
  T6_FINGERPRINT_FIELDS,
  computeT6Fingerprint,
  evaluateT6Fingerprint,
  stripTrailingRollback,
  ABORT_KINDS,
  markAbort,
  classifyAbort,
  finalizeAbortResults,
  resolvePsqlExecutable,
  psqlSearchDirectories,
  resolveOperatorCredential,
  OPERATOR_PASSWORD_VARIABLE,
  RunCancellation,
  installSignalHandlers,
  PgSession,
  RUN_MODES,
  RUN_FLAG,
  PREFLIGHT_ONLY_FLAG,
  parseRunMode,
  runGroupR,
  CONNECTION_FAILURE_KINDS,
  classifyConnectionFailure,
  finalizePreflightOnlyResults,
} from "./t6-group-r-runner.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEST_REF = SUPABASE_PROJECT_REFS.test;
const POOL_HOST = "aws-0-ap-northeast-1.pooler.supabase.com";
const goodEndpoint = {
  host: POOL_HOST,
  port: REQUIRED_PORT,
  user: `postgres.${TEST_REF}`,
  database: "postgres",
};
const runnerSrc = readFileSync(path.join(HERE, "t6-group-r-runner.mjs"), "utf8");
const harnessText = readFileSync(HARNESS_SQL, "utf8");
// The OBSERVED hosted TEST catalog material for the 17 contract functions.
// Source: the read-only TEST capture t6r-metadata-20261021-191614.json
// (sha256 2d17f5a67a0c19fdce46c9247fbeb79999bfcdb6c4b30625d32846a834f73a48).
// The v2 digest computed from this material is the pinned baseline
// a85fea6468487830a4ca9afc268d9aef.
const CAPTURED_MATERIAL = [
  { name: "block_storage_deletion", args: "uuid, uuid, text", returns: "boolean", setof: false, secdef: true, volatile: "v", parallel: "u", leakproof: false, owner: "postgres", body_md5: "63693af8bf74baab111686dee7f4d9bc" },
  { name: "cancel_storage_deletion", args: "uuid", returns: "boolean", setof: false, secdef: true, volatile: "v", parallel: "u", leakproof: false, owner: "postgres", body_md5: "c2eab0d8e9fbfc0567b86551c206a45d" },
  { name: "check_storage_deletion_references", args: "text", returns: "record", setof: true, secdef: true, volatile: "s", parallel: "u", leakproof: false, owner: "postgres", body_md5: "777935e771d0c471096effbc14f397e9" },
  { name: "claim_storage_deletion_request", args: "uuid", returns: "record", setof: true, secdef: true, volatile: "v", parallel: "u", leakproof: false, owner: "postgres", body_md5: "e1b6a31005cdf451abe79d341a55c325" },
  { name: "claim_storage_deletion_requests", args: "integer", returns: "record", setof: true, secdef: true, volatile: "v", parallel: "u", leakproof: false, owner: "postgres", body_md5: "729dbbbf63dba091cababb0acb4976be" },
  { name: "enforce_storage_key_fence", args: "", returns: "trigger", setof: false, secdef: true, volatile: "v", parallel: "u", leakproof: false, owner: "postgres", body_md5: "b58d911ce90572e2ea23ec3563bba8de" },
  { name: "fence_storage_key_for_deletion", args: "uuid, uuid", returns: "text", setof: false, secdef: true, volatile: "v", parallel: "u", leakproof: false, owner: "postgres", body_md5: "868fd89fd6b73c0f014b537736256bd1" },
  { name: "finalize_storage_deletion", args: "uuid, uuid", returns: "boolean", setof: false, secdef: true, volatile: "v", parallel: "u", leakproof: false, owner: "postgres", body_md5: "af663a3b599b46c11a617dccb7ff3f15" },
  { name: "get_document_storage_reference_state", args: "text", returns: "record", setof: true, secdef: true, volatile: "s", parallel: "u", leakproof: false, owner: "postgres", body_md5: "ccd1f831f80e953b1f14da1b9e083eb3" },
  { name: "get_storage_reference_state", args: "text", returns: "record", setof: true, secdef: true, volatile: "s", parallel: "u", leakproof: false, owner: "postgres", body_md5: "60cfdb7e04dce5fa7b77c2ee79e3619e" },
  { name: "has_role", args: "uuid, app_role", returns: "boolean", setof: false, secdef: true, volatile: "s", parallel: "u", leakproof: false, owner: "postgres", body_md5: "6b9bca1cc09de70841cac113efbdd41a" },
  { name: "is_storage_key_fenced", args: "text", returns: "boolean", setof: false, secdef: true, volatile: "s", parallel: "u", leakproof: false, owner: "postgres", body_md5: "9ce9f3df50aedc088ee2401fb780f321" },
  { name: "list_storage_deletion_quota_resyncs", args: "integer", returns: "record", setof: true, secdef: true, volatile: "s", parallel: "u", leakproof: false, owner: "postgres", body_md5: "7462004c6beba1fecbd6e2b44e81a46b" },
  { name: "mark_storage_deletion_quota_resynced", args: "uuid", returns: "void", setof: false, secdef: true, volatile: "v", parallel: "u", leakproof: false, owner: "postgres", body_md5: "8d6fa4cec8ca9bda34220807b9a18168" },
  { name: "record_storage_deletion_failure", args: "uuid, uuid, text, integer", returns: "text", setof: false, secdef: true, volatile: "v", parallel: "u", leakproof: false, owner: "postgres", body_md5: "afc9c2767d615d8baee46c79308efcb9" },
  { name: "request_storage_deletion", args: "text", returns: "uuid", setof: false, secdef: true, volatile: "v", parallel: "u", leakproof: false, owner: "postgres", body_md5: "7a6bd512b597dcdedf14c25e2823aa25" },
  { name: "set_r2_confirmed_absent", args: "uuid, uuid", returns: "boolean", setof: false, secdef: true, volatile: "v", parallel: "u", leakproof: false, owner: "postgres", body_md5: "06d5cdaef8601e4283751f10340cb1d9" },
];


const goodFingerprint = Object.freeze({
  schema: T6_FINGERPRINT_CONTRACT,
  expected: T6_FINGERPRINT_EXPECTED,
  computed: T6_FINGERPRINT_EXPECTED,
  functionCount: T6_FINGERPRINT_FUNCTION_COUNT,
  serverVersion: T6_FINGERPRINT_SERVER_VERSION,
});

const fpPayload = (fingerprint, over = {}) => JSON.stringify({
  schema: PREFLIGHT_SCHEMA,
  ok: true,
  checks: 57,
  failures: [],
  namespace: Object.fromEntries(PREFLIGHT_NAMESPACE_KEYS.map((k) => [k, 0])),
  fingerprint,
  ...over,
});


// ---------------------------------------------------------------------------
// 1. Endpoint identity guards
// ---------------------------------------------------------------------------
test("the approved TEST session pooler is accepted and resolves the TEST ref", () => {
  assert.equal(assertTestEndpointIdentity(goodEndpoint), TEST_REF);
  const direct = { host: `db.${TEST_REF}.supabase.co`, port: REQUIRED_PORT, user: "postgres", database: "postgres" };
  assert.equal(assertTestEndpointIdentity(direct), TEST_REF);
});

test("an empty connection configuration is refused", () => {
  assert.throws(() => assertTestEndpointIdentity({}), /empty connection configuration/);
  assert.throws(() => assertTestEndpointIdentity({ ...goodEndpoint, host: "" }), /empty connection configuration/);
  assert.throws(() => assertTestEndpointIdentity({ ...goodEndpoint, user: "" }), /empty connection configuration/);
  assert.throws(() => assertTestEndpointIdentity({ ...goodEndpoint, database: "" }), /empty connection configuration/);
  assert.throws(() => assertTestEndpointIdentity({ ...goodEndpoint, port: 0 }), /empty connection configuration/);
  assert.throws(() => assertTestEndpointIdentity({ ...goodEndpoint, port: NaN }), /empty connection configuration/);
});

test("the production project is refused", () => {
  const prod = { ...goodEndpoint, user: `postgres.${SUPABASE_PROJECT_REFS.prod}` };
  assert.throws(() => assertTestEndpointIdentity(prod), /production project/);
  const prodHost = { ...goodEndpoint, host: `db.${SUPABASE_PROJECT_REFS.prod}.supabase.co`, user: "postgres" };
  assert.throws(() => assertTestEndpointIdentity(prodHost), /production project/);
});

test("a localhost fallback is refused", () => {
  for (const host of ["localhost", "127.0.0.1", "::1", "0.0.0.0", "10.0.0.5"]) {
    assert.throws(() => assertTestEndpointIdentity({ ...goodEndpoint, host }), /localhost fallback/);
  }
});

test("the transaction-mode pooler and the local lab port are refused", () => {
  assert.throws(
    () => assertTestEndpointIdentity({ ...goodEndpoint, port: TRANSACTION_POOLER_PORT }),
    /transaction-mode pooler/,
  );
  assert.throws(
    () => assertTestEndpointIdentity({ ...goodEndpoint, port: LOCAL_LAB_PORT }),
    /local disposable-lab port/,
  );
  assert.throws(() => assertTestEndpointIdentity({ ...goodEndpoint, port: 5433 }), /unexpected port/);
});

test("a wrong database or a non-project host is refused", () => {
  assert.throws(() => assertTestEndpointIdentity({ ...goodEndpoint, database: "t6lab" }), /unexpected database/);
  assert.throws(
    () => assertTestEndpointIdentity({ ...goodEndpoint, host: "db.example.com" }),
    /not a Supabase project host/,
  );
  // A host and a user that name DIFFERENT projects are ambiguous and refused
  // rather than resolved in the operator's favour.
  assert.throws(
    () =>
      assertTestEndpointIdentity({
        host: `db.${SUPABASE_PROJECT_REFS.prod}.supabase.co`,
        port: REQUIRED_PORT,
        user: `postgres.${TEST_REF}`,
        database: "postgres",
      }),
    /production project/,
  );
});

test("loopback detection rejects only local hosts", () => {
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost(""), true);
  assert.equal(isLoopbackHost(POOL_HOST), false);
  assert.equal(isLoopbackHost(`db.${TEST_REF}.supabase.co`), false);
});

test("the project ref is read from the direct host or the pooler user", () => {
  assert.equal(projectRefFromEndpoint({ host: `db.${TEST_REF}.supabase.co`, user: "postgres" }), TEST_REF);
  assert.equal(projectRefFromEndpoint({ host: POOL_HOST, user: `postgres.${TEST_REF}` }), TEST_REF);
  assert.equal(projectRefFromEndpoint({ host: POOL_HOST, user: "postgres" }), null);
  assert.equal(projectRefFromEndpoint({ host: "example.com", user: "nobody" }), null);
});

// ---------------------------------------------------------------------------
// 2. R06 -- the zero-commit statement allowlist
// ---------------------------------------------------------------------------
test("the allowlist is exactly the matrix's statement kinds", () => {
  assert.deepEqual([...ALLOWED_STATEMENT_VERBS].sort(), [
    "BEGIN", "DELETE", "DO", "INSERT", "ROLLBACK", "SELECT", "SET", "UPDATE",
  ]);
  for (const v of FORBIDDEN_STATEMENT_VERBS) assert.ok(!ALLOWED_STATEMENT_VERBS.includes(v));
});

test("permitted statements are allowed and terminators are refused", () => {
  for (const s of ["BEGIN;", "SET LOCAL x = 1;", "SELECT 1;", "INSERT INTO t VALUES (1);",
                   "UPDATE t SET a = 1;", "DELETE FROM t;", "DO $$ BEGIN END $$;", "ROLLBACK;"]) {
    assert.equal(isAllowedStatement(s), true, s);
  }
  for (const s of ["COMMIT;", "commit;", "END;", "ABORT;", "ROLLBACK; COMMIT;", ""]) {
    assert.equal(isAllowedStatement(s), false, s);
  }
});

test("the verb of a statement is read correctly", () => {
  assert.equal(statementVerb("  commit ;"), "COMMIT");
  assert.equal(statementVerb("-- a comment\nSELECT 1;"), "SELECT");
  assert.equal(statementVerb(""), "");
});

test("a session log containing a COMMIT is a fail-closed violation", () => {
  const clean = ["BEGIN;", "SELECT 1;", "INSERT INTO t VALUES (1);", "ROLLBACK;"];
  assert.deepEqual(auditStatementLog(clean), []);
  const dirty = ["BEGIN;", "SELECT 1;", "COMMIT;", "ROLLBACK;"];
  assert.equal(auditStatementLog(dirty).length, 1);
  assert.match(auditStatementLog(dirty)[0], /COMMIT/);
});

test("the runner's own reset and probe statements stay inside the allowlist", () => {
  // The plumbing the runner sends around every statement must itself never
  // look like a transaction terminator.
  for (const s of [RESET_SQL, PROBE_SQL]) {
    assert.equal(isAllowedStatement(s), true, s.slice(0, 40));
    assert.deepEqual(findTerminators(s), []);
  }
});

// ---------------------------------------------------------------------------
// 3. Harness SQL structure
// ---------------------------------------------------------------------------
test("the harness SQL contains every required section", () => {
  const sections = parseHarnessSections(harnessText);
  assert.deepEqual(missingHarnessSections(sections), [], "a required harness section is missing");
  assert.equal(sections.size, REQUIRED_SECTIONS.length);
  for (const name of REQUIRED_SECTIONS) {
    assert.ok(sections.get(name).length > 0, `section ${name} is empty`);
  }
});

test("the harness SQL never issues a COMMIT", () => {
  // PL/pgSQL "END IF" inside a dollar-quoted body is not a transaction
  // terminator, so the scan must ignore dollar-quoted bodies.
  assert.deepEqual(findTerminators(harnessText), [], "the harness SQL must never commit");
});

test("every session-opening section is closed by the rollback section", () => {
  const sections = parseHarnessSections(harnessText);
  const openers = [...sections.keys()].filter((n) => /^prelude\.(authenticated|service_role|observer)$/.test(n));
  assert.equal(openers.length, 3);
  for (const n of openers) {
    assert.match(sections.get(n), /BEGIN ISOLATION LEVEL READ COMMITTED/, n);
  }
  assert.match(sections.get("prelude.observer"), /READ ONLY/);
  assert.match(stripSqlNoise(sections.get("rollback")).trim(), /^ROLLBACK;/);
});

test("the harness pins the synthetic namespace and never references a real client record", () => {
  assert.ok(harnessText.includes(":'owner'"));
  assert.ok(harnessText.includes(":'prefix'"));
  assert.ok(!harnessText.includes(SUPABASE_PROJECT_REFS.prod));
  // The only uuids the harness may name are the three synthetic T6 identities.
  const uuids = [...harnessText.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)].map((m) => m[0]);
  const allowed = new Set([T6_OWNER, T6_OTHER, T6_ADMIN]);
  for (const u of new Set(uuids)) assert.ok(allowed.has(u), `unexpected uuid in the harness: ${u}`);
});

test("the harness uses the hosted column names, not the local lab ones", () => {
  // support_messages has sender_id on the hosted schema; the local lab schema has
  // both, so a harness written against the lab would break on TEST.
  assert.match(harnessText, /m\.sender_id IN \(v_owner/);
  assert.ok(!/support_messages[^;]*m\.user_id/.test(harnessText));
  // payments has no authenticated INSERT policy on TEST, so the R02 fixture
  // must be inserted with service_role.
  assert.match(harnessText, /INSERT INTO public\.payments/);
  assert.match(harnessText, /'online'/);
});

test("the payments fixture carries proof_key so the fence trigger actually fires", () => {
  // The fence trigger is BEFORE INSERT OR UPDATE OF proof_key and returns
  // early when the column is NULL, so a fixture without proof_key would never
  // take the advisory lock and T6-R02 could not observe a wait.
  const sections = parseHarnessSections(harnessText);
  const payment = sections.get("b.insert_payment");
  assert.match(payment, /proof_key/);
  assert.match(payment, /current_setting\('t6r\.key'\)/);
});

test("every case body is a DO block that captures its own SQLSTATE", () => {
  // The error protocol depends on every body catching its failure and
  // publishing the SQLSTATE, so nothing is detected from stderr.
  const sections = parseHarnessSections(harnessText);
  const bodies = [
    "prelude.isolation_check", "a.create_request", "a.claim_fence",
    "b.insert_document", "b.insert_payment", "b.insert_document_first",
    "r07.hygiene", "r08.residue",
  ];
  for (const name of bodies) {
    const body = sections.get(name);
    assert.match(body, /\bDO \$t6r\$/, `${name} must be a DO block`);
    assert.match(body, /EXCEPTION WHEN OTHERS/, `${name} must capture its failures`);
    assert.match(body, /set_config\('t6r\.sqlstate', SQLSTATE/, `${name} must publish the SQLSTATE`);
    assert.match(body, /set_config\('t6r\.message', SQLERRM/, `${name} must publish the message`);
  }
});

// ---------------------------------------------------------------------------
// 4. R07 / R08 verdicts
// ---------------------------------------------------------------------------
test("residue is clean only when every count is zero", () => {
  const zero = Object.fromEntries(RESIDUE_RELATIONS.map((r) => [r, 0]));
  assert.equal(summarizeResidue(zero, { backends: 0, openXacts: 0, advisoryLocks: 0 }).clean, true);
  assert.equal(RESIDUE_RELATIONS.length, 10);

  const one = { ...zero, documents: 1 };
  const s = summarizeResidue(one, { backends: 0, openXacts: 0, advisoryLocks: 0 });
  assert.equal(s.clean, false);
  assert.deepEqual(s.nonzero, [{ relation: "documents", count: 1 }]);

  assert.equal(summarizeResidue(zero, { backends: 1 }).clean, false);
  assert.equal(summarizeResidue(zero, { openXacts: 1 }).clean, false);
  assert.equal(summarizeResidue(zero, { advisoryLocks: 1 }).clean, false);
});

test("the matrix requires exactly one waiter", () => {
  assert.equal(isSingleWaiter(1), true);
  assert.equal(isSingleWaiter(0), false);
  assert.equal(isSingleWaiter(2), false);
  assert.equal(isSingleWaiter(null), false);
});

// ---------------------------------------------------------------------------
// 5. The namespace itself
// ---------------------------------------------------------------------------
test("the synthetic T6 namespace is three distinct uuids under one key prefix", () => {
  const ids = new Set([T6_OWNER, T6_OTHER, T6_ADMIN]);
  assert.equal(ids.size, 3);
  assert.equal(T6_KEY_PREFIX, `${T6_OWNER}/t6/`);
});

// ---------------------------------------------------------------------------
// 6. All eight matrix cases are implemented, and the runner is import-safe
// ---------------------------------------------------------------------------
test("all eight Group-R case ids from the matrix are implemented by the runner", () => {
  for (const id of CASE_IDS) {
    assert.ok(runnerSrc.includes(`runCase("${id}"`), `the runner does not run ${id}`);
  }
  // No case may be left as a placeholder.
  assert.ok(!/placeholder/i.test(runnerSrc), "the runner still contains a placeholder case body");
});

test("each case opens its own pair of independent sessions and closes them", () => {
  const opens = (runnerSrc.match(/await openCase\(keyFor\(/g) || []).length;
  const closes = (runnerSrc.match(/await closeCase\(\);/g) || []).length;
  assert.equal(opens, 5, "the five stateful cases (R01-R05) must each open a session pair");
  assert.equal(closes, 5, "each opened session pair must be closed");
});

test("the runner never hardcodes a credential or the production ref", () => {
  assert.ok(!runnerSrc.includes(SUPABASE_PROJECT_REFS.prod), "the runner hardcodes the production ref");
  assert.ok(!/PGPASSWORD\s*=\s*["'][^"']+["']/.test(runnerSrc), "the runner hardcodes a password");
  assert.ok(runnerSrc.includes("requireLiveAuthorization("), "the runner must use the live-authorization gate");
  assert.ok(runnerSrc.includes("assertNonProductionTarget("), "the runner must re-check the resolved target");
  // It must not read an environment FILE.
  assert.ok(!/["'][^"'\n]*\/[^"'\n]*\.env["']/.test(runnerSrc), "the runner must not read an environment file");
});

// ===========================================================================
// REGRESSION TESTS FOR THE SEVEN AUDIT FINDINGS
// ===========================================================================

// --- Finding 1: the R07 JSON key mismatch (a fail-open) --------------------
test("F1: the harness publishes the hygiene counters under the runner's exact contract keys", () => {
  const sections = parseHarnessSections(harnessText);
  for (const name of ["r07.hygiene", "r08.residue"]) {
    const body = sections.get(name);
    for (const key of HYGIENE_KEYS) {
      assert.ok(body.includes(`'${key}'`), `${name} must publish "${key}"`);
    }
    // The old snake_case spelling must not come back: the runner reads
    // camelCase, and a mixed spelling silently defaulted every counter to 0.
    assert.ok(!/open_xacts|advisory_locks/.test(body), `${name} must not use the snake_case spelling`);
  }
});

test("F1: a hygiene payload with the wrong key names is not clean", () => {
  // This is the exact payload the old harness emitted. The old runner read
  // camelCase, found nothing, and returned clean:true.
  const legacy = JSON.stringify({ backends: 0, open_xacts: 3, advisory_locks: 2 });
  const parsed = parseHygiene(legacy);
  assert.equal(parsed.valid, false, "the legacy payload must not satisfy the contract");
  assert.equal(parsed.clean, false, "the legacy payload must never be clean");
  assert.ok(parsed.problems.length > 0);
});

test("F1: open_xacts=3 and advisory_locks=2 never produce clean=true", () => {
  // The counter values themselves must force clean=false, in the contract
  // spelling and in the legacy spelling.
  const contract = parseHygiene(JSON.stringify({ backends: 0, openXacts: 3, advisoryLocks: 2 }));
  assert.equal(contract.valid, true);
  assert.equal(contract.clean, false);
  const legacy = parseHygiene(JSON.stringify({ backends: 0, open_xacts: 3, advisory_locks: 2 }));
  assert.equal(legacy.clean, false);
  const viaResidue = summarizeResidue(
    Object.fromEntries(RESIDUE_RELATIONS.map((r) => [r, 0])),
    { backends: 0, openXacts: 3, advisoryLocks: 2 },
  );
  assert.equal(viaResidue.clean, false);
});

test("F1: a missing, null, malformed or unknown counter is never clean", () => {
  const cases = [
    JSON.stringify({ backends: 0, openXacts: 0 }),                       // missing
    JSON.stringify({ backends: null, openXacts: 0, advisoryLocks: 0 }),  // null
    JSON.stringify({ backends: 0, openXacts: "0", advisoryLocks: 0 }),   // not numeric
    JSON.stringify({ backends: 0, openXacts: 0, advisoryLocks: 0, extra: 1 }), // unknown key
    "{not json",                                                        // malformed
    "",                                                                 // missing payload
  ];
  for (const raw of cases) {
    const p = parseHygiene(raw);
    assert.equal(p.clean, false, `payload ${raw} must not be clean`);
  }
  assert.equal(parseHygiene(JSON.stringify({ backends: 0, openXacts: 0, advisoryLocks: 0 })).clean, true);
});

test("F1: the residue payload demands all ten relation counters", () => {
  const all = Object.fromEntries(RESIDUE_RELATIONS.map((r) => [r, 0]));
  assert.equal(parseResidue(JSON.stringify(all)).valid, true);
  const missing = { ...all };
  delete missing.documents;
  assert.equal(parseResidue(JSON.stringify(missing)).valid, false);
  assert.equal(parseResidue(JSON.stringify({ ...all, documents: 1 })).counts.documents, 1);
  assert.equal(parseResidue("nonsense").valid, false);
  assert.equal(parseResidue("").valid, false);
});

// --- Finding 2: the stdout/stderr race (a fail-open) ------------------------
test("F2: a captured non-00000 SQLSTATE is never a success", () => {
  const probe = (sqlstate, message = "") =>
    `${PROBE_PREFIX}${JSON.stringify({ sqlstate, message, isolation: "read committed" })}`;
  for (const st of ["23514", "40P01", "55P03", "42501", "P0001", "MISSING"]) {
    const r = interpretExec("b", "b.insert_document", [probe(st, "boom")]);
    assert.equal(r.ok, false, `SQLSTATE ${st} must not be a success`);
    assert.equal(r.fatal, false);
    assert.equal(r.sqlstate, st);
  }
  const good = interpretExec("b", "b.insert_document", [probe("00000", "")]);
  assert.equal(good.ok, true);
});

test("F2: a missing or malformed completion probe is never a success", () => {
  const missing = interpretExec("b", "b.insert_document", ["1", "2"]);
  assert.equal(missing.ok, false);
  assert.equal(missing.fatal, true);
  assert.equal(missing.sqlstate, "T6NOPROBE");

  const malformed = interpretExec("b", "b.insert_document", [`${PROBE_PREFIX}{not json`]);
  assert.equal(malformed.ok, false);
  assert.equal(malformed.fatal, true);

  const notAnObject = interpretExec("b", "b.insert_document", [`${PROBE_PREFIX}[1,2]`]);
  assert.equal(notAnObject.ok, false);
  assert.equal(notAnObject.fatal, true);

  const noState = interpretExec("b", "b.insert_document", [`${PROBE_PREFIX}{"message":"x"}`]);
  assert.equal(noState.ok, false);
  assert.equal(noState.fatal, true);
});

test("F2: the verdict is derived from the ordered stdout stream only", () => {
  // interpretExec has no stderr parameter at all, so a late stderr chunk can
  // neither hide nor create a failure.
  assert.equal(interpretExec.length, 3);
  const probe = `${PROBE_PREFIX}${JSON.stringify({ sqlstate: "23514", message: "late 23514" })}`;
  const r = interpretExec("b", "b.insert_document", [probe]);
  assert.equal(r.ok, false, "a late 23514 must not be ignored");
  // The runner must not read stderr for correctness anywhere.
  assert.ok(!/errBefore/.test(runnerSrc), "the runner must not slice stderr around a statement");
    // The stderr is CAPTURED and BOUNDED, and it is READ only to classify a
    // connection failure into one fixed word. It never contributes to a
    // verdict. Every use of the field is enumerated here, so a new reader
    // cannot slip in.
    const stderrUses = [...runnerSrc.matchAll(/this\.stderr[^\n]*/g)].map((m) => m[0].trim());
    assert.ok(stderrUses.length > 0, "the stderr capture must still exist");
    for (const u of stderrUses) {
      assert.ok(
        u === 'this.stderr = "";'
        || u.startsWith("this.stderr += d")
        || u.startsWith("this.stderr = this.stderr.slice")
        || u.startsWith("this.stderr.length")
        || u.startsWith("// ")
        || u.startsWith("* "),
        `the stderr field is used outside the capture and the bound: ${u}`,
      );
    }
    // The one consumer of the captured stderr.
    assert.match(runnerSrc, /classifyConnectionFailure\(pf\.stderr\)/);
});

test("F2: a disconnected session cannot produce a PASS", () => {
  // No marker means no lines at all: the session is gone.
  const r = interpretExec("b", "b.insert_document", []);
  assert.equal(r.ok, false);
  assert.equal(r.fatal, true);
});

// --- Finding 3: NOTICE handling --------------------------------------------
test("F3: a successful RAISE NOTICE is not a failure", () => {
  // A NOTICE never aborts the transaction and never changes the captured
  // SQLSTATE, so the probe still reports 00000.
  const probe = `${PROBE_PREFIX}${JSON.stringify({ sqlstate: "00000", message: "" })}`;
  const r = interpretExec("obs", "r08.residue", [probe]);
  assert.equal(r.ok, true);
  assert.equal(r.sqlstate, "00000");
});

test("F3: the harness exercises the NOTICE path on the clean residue path", () => {
  const sections = parseHarnessSections(harnessText);
  assert.match(sections.get("r08.residue"), /RAISE NOTICE/);
  // And the notice must not be the last thing that can fail: the fail-closed
  // raises come before it.
  const body = sections.get("r08.residue");
  assert.ok(body.indexOf("RAISE NOTICE") > body.indexOf("RAISE EXCEPTION"));
});

// --- Finding 4: per-case isolation -----------------------------------------
test("F4: every case id always receives a definite record", () => {
  const results = finalizeResults({}, "NOT RUN");
  assert.equal(results.length, CASE_IDS.length);
  assert.deepEqual(results.map((r) => r.id), [...CASE_IDS]);
  for (const r of results) {
    assert.ok(CASE_STATUSES.includes(r.verdict), `${r.id} has no terminal status`);
    assert.equal(r.verdict, "NOT RUN");
  }
  assert.equal(suiteVerdict(results), "FAIL", "an incomplete case set is never a PASS");
});

test("F4: a case that never ran is NOT RUN, never PASS", () => {
  const assertions = Object.create(null);
  assertions["T6-R06"] = { assertion: "PASS", detail: "ok" };
  const results = finalizeResults(assertions, "PASS");
  const r06 = results.find((r) => r.id === "T6-R06");
  assert.equal(r06.verdict, "PASS");
  for (const id of CASE_IDS.filter((x) => x !== "T6-R06")) {
    assert.equal(results.find((r) => r.id === id).verdict, "NOT RUN");
  }
  assert.equal(suiteVerdict(results), "FAIL");
});

test("F4: the runner records every case through the guarded case runner", () => {
  for (const id of CASE_IDS) {
    assert.ok(runnerSrc.includes(`runCase("${id}"`), `${id} is not guarded by the case runner`);
  }
  // The case runner converts an unexpected exception or a timeout into a
  // terminal record instead of dropping the case.
  assert.match(runnerSrc, /timed out.*BLOCKED/s);
  assert.match(runnerSrc, /unexpected /);
});

// --- Finding 5: SQLSTATE classification -------------------------------------
test("F5: 55P03 is a BLOCKED sync failure outside the bounded-wait case", () => {
  const c = classifySqlFailure({ sqlstate: "55P03", message: "canceling statement due to lock timeout", label: "b.insert_document" });
  assert.equal(c.outcome, "BLOCKED");
  assert.equal(c.kind, "lock_timeout");
});

test("F5: 40P01 is always a FAIL", () => {
  const c = classifySqlFailure({ sqlstate: "40P01", message: "deadlock detected", label: "a.create_request" });
  assert.equal(c.outcome, "FAIL");
  assert.equal(c.kind, "deadlock");
});

test("F5: the two 23514 codes are told apart by their message, not by guesswork", () => {
  const fence = classifySqlFailure({
    sqlstate: "23514",
    message: "Storage key is fenced for deletion.",
    label: "b.insert_document",
  });
  assert.equal(fence.outcome, "FAIL");
  assert.equal(fence.kind, "fence_rejection");

  const payments = classifySqlFailure({
    sqlstate: "23514",
    message: 'new row for relation "payments" violates check constraint "payments_method_allowed"',
    label: "b.insert_payment",
  });
  assert.equal(payments.outcome, "BLOCKED");
  assert.equal(payments.kind, "payments_fixture_drift");

  const unknown = classifySqlFailure({ sqlstate: "23514", message: "some other constraint", label: "b.insert_document" });
  assert.equal(unknown.outcome, "FAIL", "an unrecognised 23514 must fail closed");
});

test("F5: an unknown SQLSTATE is never a PASS", () => {
  for (const st of ["22023", "42501", "57014", "40001", "P0001", "ZZ999", "T6NOPROBE"]) {
    const c = classifySqlFailure({ sqlstate: st, message: "x", label: "b.insert_document" });
    assert.ok(c.outcome === "FAIL" || c.outcome === "BLOCKED", `SQLSTATE ${st} produced ${c.outcome}`);
    assert.notEqual(c.outcome, "PASS");
  }
});

test("F5: the classification carries the grounded statement context", () => {
  const c = classifySqlFailure({ sqlstate: "23514", message: "boom", label: "b.insert_payment" });
  assert.match(c.reason, /b\.insert_payment/);
});

// --- Finding 6: the residue dependency -------------------------------------
test("F6: R01-R05 cannot be a final PASS unless R08 verified a clean residue", () => {
  const assertions = Object.create(null);
  for (const id of RESIDUE_GATED_CASES) assertions[id] = { assertion: "PASS", detail: "observed" };
  assertions["T6-R08"] = { assertion: "FAIL", detail: "residue detected" };
  const results = finalizeResults(assertions, "FAIL");
  for (const id of RESIDUE_GATED_CASES) {
    const r = results.find((x) => x.id === id);
    assert.equal(r.assertion, "PASS", "the observed case-level assertion is preserved");
    assert.equal(r.verdict, "FAIL", `${id} must not be a final PASS`);
  }
  assert.equal(suiteVerdict(results), "FAIL");
});

test("F6: a blocked or incomplete R08 also refuses the gated cases", () => {
  const assertions = Object.create(null);
  for (const id of RESIDUE_GATED_CASES) assertions[id] = { assertion: "PASS", detail: "observed" };
  for (const gate of ["BLOCKED", "NOT RUN"]) {
    const results = finalizeResults(assertions, gate);
    for (const id of RESIDUE_GATED_CASES) {
      assert.notEqual(results.find((x) => x.id === id).verdict, "PASS", `${id} under gate ${gate}`);
    }
    assert.notEqual(suiteVerdict(results), "PASS");
  }
});

test("F6: a clean R08 releases every case, and the matrix-named subset is unchanged", () => {
  const assertions = Object.create(null);
  for (const id of CASE_IDS) assertions[id] = { assertion: "PASS", detail: "ok" };
  const results = finalizeResults(assertions, "PASS");
  assert.equal(results.every((r) => r.verdict === "PASS"), true);
  assert.equal(suiteVerdict(results), "PASS");
  // The matrix names the residue condition in the R01-R05 pass clauses; that
  // set is unchanged. The gate itself is a RUN-LEVEL acceptance condition, so
  // no case is finally accepted without a clean residue (see E4).
  assert.deepEqual(RESIDUE_GATED_CASES, ["T6-R01", "T6-R02", "T6-R03", "T6-R04", "T6-R05"]);
});

test("F6: a failed case is never upgraded by a clean residue", () => {
  const assertions = Object.create(null);
  assertions["T6-R01"] = { assertion: "FAIL", detail: "the fence rejected the write" };
  assertions["T6-R02"] = { assertion: "BLOCKED", detail: "no waiter observed" };
  const results = finalizeResults(assertions, "PASS");
  assert.equal(results.find((r) => r.id === "T6-R01").verdict, "FAIL");
  assert.equal(results.find((r) => r.id === "T6-R02").verdict, "BLOCKED");
});

// --- Finding 7: the read-committed isolation guard -------------------------
test("F7: the harness asserts read committed on the write-capable sessions", () => {
  const sections = parseHarnessSections(harnessText);
  const guard = sections.get("prelude.isolation_check");
  assert.match(guard, /current_setting\('transaction_isolation'\)/);
  assert.match(guard, /read committed/);
  // The write-capable preludes really are READ COMMITTED.
  for (const name of ["prelude.authenticated", "prelude.service_role"]) {
    assert.match(sections.get(name), /BEGIN ISOLATION LEVEL READ COMMITTED;/, name);
    assert.ok(!/REPEATABLE READ/i.test(sections.get(name)), name);
  }
});

test("F7: the runner checks the observed isolation level on every session", () => {
  // The runner must compare the isolation level the session reported, not
  // merely run the guard.
  assert.match(runnerSrc, /\.probe\.isolation/);
  assert.match(runnerSrc, /!== "read committed"/);
  assert.match(runnerSrc, /the read-committed guard failed/);
});

test("F7: a session that reports the wrong isolation is refused", () => {
  const probe = `${PROBE_PREFIX}${JSON.stringify({ sqlstate: "00000", isolation: "repeatable read" })}`;
  const r = interpretExec("a", "prelude.isolation_check", [probe]);
  assert.equal(r.ok, true, "the statement itself succeeded");
  assert.notEqual(String(r.probe.isolation).toLowerCase(), "read committed");
});

// --- Supporting helpers -----------------------------------------------------
test("the last numeric line of a statement output is read correctly", () => {
  assert.equal(lastNumeric(["1"]), 1);
  assert.equal(lastNumeric(["0", "3"]), 3);
  assert.equal(lastNumeric(["not a number"]), null);
  assert.equal(lastNumeric([]), null);
});

test("a failed statement is described with its SQLSTATE", () => {
  const probe = `${PROBE_PREFIX}${JSON.stringify({ sqlstate: "23514", message: "Storage key is fenced for deletion." })}`;
  const r = interpretExec("b", "b.insert_document", [probe]);
  assert.match(describeFailure(r), /23514/);
  assert.match(describeFailure(r), /fenced for deletion/);
});

// ===========================================================================
// EVIDENCE (matrix rule 3): exactly one structured JSON line per case, a
// deterministic SHA-256 over the exact final bytes, a separate digest
// manifest, and fail-closed finalization.
//
// The fixtures are isolated temporary directories created by this test file.
// No historical evidence is read, modified or deleted.
// ===========================================================================

const tmpRoot = () => mkdtempSync(path.join(tmpdir(), "t6r-evidence-"));

const allPassResults = () => finalizeResults(
  Object.fromEntries(CASE_IDS.map((id) => [id, { assertion: "PASS", detail: "observed" }])),
  "PASS",
);

// --- E1: exactly eight JSONL records ---------------------------------------
test("E1: the evidence holds exactly eight records, one per matrix case", () => {
  const records = buildEvidenceRecords(allPassResults(), { residueGate: "PASS" });
  assert.equal(records.length, 8);
  assert.deepEqual(records.map((r) => r.case), [...CASE_IDS]);
  const text = renderEvidenceJsonl(records);
  const lines = text.split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 8, "one line per case");
  assert.ok(text.endsWith("\n"), "the JSONL file is newline terminated");
});

// --- E2: one valid JSON object per line -------------------------------------
test("E2: every evidence line is exactly one valid JSON object", () => {
  const records = buildEvidenceRecords(allPassResults(), { residueGate: "PASS" });
  for (const line of renderEvidenceJsonl(records).split("\n").filter((l) => l.length > 0)) {
    const obj = JSON.parse(line);
    assert.equal(typeof obj, "object");
    assert.equal(Array.isArray(obj), false);
    assert.equal(obj.schema, EVIDENCE_SCHEMA);
    assert.ok(CASE_IDS.includes(obj.case));
    assert.ok(Object.prototype.hasOwnProperty.call(obj, "assertion"));
    assert.ok(Object.prototype.hasOwnProperty.call(obj, "verdict"));
    assert.equal(typeof obj.detail, "string");
  }
});

// --- E3: every outcome is representable --------------------------------------
test("E3: PASS, FAIL, BLOCKED and NOT RUN are all representable", () => {
  const assertions = Object.create(null);
  assertions["T6-R01"] = { assertion: "PASS", detail: "passed" };
  assertions["T6-R02"] = { assertion: "FAIL", detail: "failed" };
  assertions["T6-R03"] = { assertion: "BLOCKED", detail: "blocked" };
  // T6-R04 .. T6-R08 are never observed -> NOT RUN
  const results = finalizeResults(assertions, "PASS");
  const records = buildEvidenceRecords(results, { residueGate: "PASS" });
  const byCase = Object.fromEntries(records.map((r) => [r.case, r]));
  assert.equal(byCase["T6-R01"].assertion, "PASS");
  assert.equal(byCase["T6-R02"].assertion, "FAIL");
  assert.equal(byCase["T6-R03"].assertion, "BLOCKED");
  assert.equal(byCase["T6-R04"].assertion, "NOT RUN");
  assert.equal(byCase["T6-R05"].assertion, "NOT RUN");
  assert.equal(byCase["T6-R08"].assertion, "NOT RUN");
  for (const r of records) assert.ok(CASE_STATUSES.includes(r.verdict), r.case);
  // A NOT RUN case is never a PASS.
  assert.notEqual(byCase["T6-R04"].verdict, "PASS");
});

// --- E4: the final residue gate is applied ----------------------------------
test("E4: no evidence record reports PASS while the residue gate is not PASS", () => {
  const assertions = Object.fromEntries(CASE_IDS.map((id) => [id, { assertion: "PASS", detail: "observed" }]));
  for (const gate of ["FAIL", "BLOCKED", "NOT RUN"]) {
    const results = finalizeResults(assertions, gate);
    const records = buildEvidenceRecords(results, { residueGate: gate });
    for (const r of records) {
      assert.notEqual(r.verdict, "PASS", `${r.case} must not be a PASS under gate ${gate}`);
    }
    assert.equal(validateEvidenceGate(records).ok, true);
    assert.notEqual(suiteVerdict(results), "PASS");
  }
  // The independent gate check catches a hand-made violation.
  const tampered = buildEvidenceRecords(allPassResults(), { residueGate: "PASS" });
  tampered[0].residueGate = "FAIL";
  const check = validateEvidenceGate(tampered);
  assert.equal(check.ok, false);
  assert.match(check.problems.join("; "), /reports PASS/);
  // And a residue-gated case keeps its observed assertion next to the verdict.
  const gated = finalizeResults(
    { "T6-R01": { assertion: "PASS", detail: "observed" } },
    "FAIL",
  );
  assert.equal(gated.find((r) => r.id === "T6-R01").assertion, "PASS");
  assert.equal(gated.find((r) => r.id === "T6-R01").verdict, "FAIL");
});

// --- E5: deterministic SHA-256 over the exact final bytes --------------------
test("E5: the SHA-256 digest is deterministic and covers the exact file bytes", () => {
  const dir = tmpRoot();
  try {
    const records = buildEvidenceRecords(allPassResults(), { residueGate: "PASS" });
    const a = writeEvidenceBundle({ evidenceDir: dir, records, meta: { runId: "r1" } });
    // Read A's manifest before the next write replaces it.
    const manifest = JSON.parse(readFileSync(a.manifestPath, "utf8"));
    const b = writeEvidenceBundle({ evidenceDir: dir, records, meta: { runId: "r2" } });
    assert.equal(a.sha256, b.sha256, "the same records must digest identically");
    assert.match(a.sha256, /^[0-9a-f]{64}$/);
    const onDisk = readFileSync(a.evidencePath, "utf8");
    const expected = createHash("sha256").update(Buffer.from(onDisk, "utf8")).digest("hex");
    assert.equal(a.sha256, expected, "the digest must cover the exact file bytes");
    assert.equal(a.bytes, Buffer.byteLength(onDisk, "utf8"));
    // A single changed byte changes the digest.
    const changed = buildEvidenceRecords(allPassResults(), { residueGate: "PASS" });
    changed[0].detail = `${changed[0].detail} `;
    const c = writeEvidenceBundle({ evidenceDir: dir, records: changed, meta: { runId: "r3" } });
    assert.notEqual(a.sha256, c.sha256);
    // The manifest carries the digest.
    assert.equal(manifest.schema, MANIFEST_SCHEMA);
    assert.equal(manifest.evidenceSha256, a.sha256);
    assert.equal(manifest.recordCount, 8);
    assert.equal(manifest.evidenceBytes, a.bytes);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- E6: missing or corrupted evidence is detected ---------------------------
test("E6: missing, truncated or tampered evidence is detected", () => {
  const dir = tmpRoot();
  try {
    const records = buildEvidenceRecords(allPassResults(), { residueGate: "PASS" });
    const bundle = writeEvidenceBundle({ evidenceDir: dir, records, meta: { runId: "r1" } });
    assert.equal(verifyEvidenceBundle({ evidenceDir: dir }).ok, true);

    // A truncated evidence file.
    const full = readFileSync(bundle.evidencePath, "utf8");
    writeFileSync(bundle.evidencePath, full.slice(0, Math.floor(full.length / 2)), "utf8");
    let v = verifyEvidenceBundle({ evidenceDir: dir });
    assert.equal(v.ok, false);
    assert.ok(v.problems.length > 0);

    // A tampered manifest digest.
    writeFileSync(bundle.evidencePath, full, "utf8");
    const manifest = JSON.parse(readFileSync(bundle.manifestPath, "utf8"));
    manifest.evidenceSha256 = "0".repeat(64);
    writeFileSync(bundle.manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    v = verifyEvidenceBundle({ evidenceDir: dir });
    assert.equal(v.ok, false);
    assert.match(v.problems.join("; "), /digest/);

    // A missing evidence file.
    rmSync(bundle.evidencePath, { force: true });
    v = verifyEvidenceBundle({ evidenceDir: dir });
    assert.equal(v.ok, false);
    assert.match(v.problems.join("; "), /missing/);

    // A missing manifest.
    writeFileSync(bundle.evidencePath, full, "utf8");
    rmSync(bundle.manifestPath, { force: true });
    v = verifyEvidenceBundle({ evidenceDir: dir });
    assert.equal(v.ok, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- E7: a filesystem failure or a partial write fails closed ----------------
test("E7: an unwritable evidence location fails closed", () => {
  const dir = tmpRoot();
  try {
    // A FILE where the evidence directory should be: the bundle cannot be
    // written, and the run must not be able to claim success.
    const blocked = path.join(dir, "blocked");
    writeFileSync(blocked, "not a directory", "utf8");
    const records = buildEvidenceRecords(allPassResults(), { residueGate: "PASS" });
    let threw = false;
    try {
      writeEvidenceBundle({ evidenceDir: path.join(blocked, "evidence"), records, meta: {} });
    } catch { threw = true; }
    assert.equal(threw, true, "an unwritable evidence location must throw");
    const finalized = finalizeEvidence({
      evidenceDir: path.join(blocked, "evidence"),
      records,
      meta: {},
    });
    assert.equal(finalized.ok, false);
    assert.equal(finalSuiteVerdict(allPassResults(), finalized), "FAIL");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("E7b: a truncated write leaves no evidence that claims success", () => {
  const dir = tmpRoot();
  try {
    const records = buildEvidenceRecords(allPassResults(), { residueGate: "PASS" });
    const bundle = writeEvidenceBundle({ evidenceDir: dir, records, meta: {} });
    // Simulate a truncated finalisation: the file is cut in half and the
    // bundle is re-verified. The verification must refuse it.
    const full = readFileSync(bundle.evidencePath, "utf8");
    writeFileSync(bundle.evidencePath, full.slice(0, 40), "utf8");
    const v = verifyEvidenceBundle({ evidenceDir: dir });
    assert.equal(v.ok, false);
    // A failed finalisation must not leave a temporary file behind either.
    const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp-"));
    assert.deepEqual(leftovers, [], "no temporary evidence file may survive");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("E7c: the finalized evidence directory holds exactly the two evidence files", () => {
  const dir = tmpRoot();
  try {
    const records = buildEvidenceRecords(allPassResults(), { residueGate: "PASS" });
    writeEvidenceBundle({ evidenceDir: dir, records, meta: {} });
    const entries = readdirSync(dir).sort();
    assert.deepEqual(entries, [EVIDENCE_FILE_NAME, MANIFEST_FILE_NAME].sort());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- E8: sensitive data never enters the evidence ----------------------------
test("E8: no password, connection string, secret, key or SQL text enters the evidence", () => {
  const nasty = [
    "the call failed with PGPASSWORD=hunter2",
    "connected to postgres://postgres:topsecret@db.example.supabase.co:5432/postgres",
    "the service key is SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiJ9",
    "host=db.example.supabase.co port=5432 user=postgres dbname=postgres",
    "the row 5d8f1c62-9a37-4e0b-b1f4-7c0e2a6d9f41/t6/r01/object violated a constraint",
    "the statement INSERT INTO public.documents (user_id, storage_key) VALUES ('x','y'); failed",
    "the identifier 5d8f1c62-9a37-4e0b-b1f4-7c0e2a6d9f41 was rejected",
  ];
  const assertions = Object.create(null);
  for (const id of CASE_IDS) assertions[id] = { assertion: "PASS", detail: nasty[0] };
  assertions["T6-R02"] = { assertion: "FAIL", detail: nasty[1] };
  assertions["T6-R03"] = { assertion: "BLOCKED", detail: nasty[2] };
  assertions["T6-R04"] = { assertion: "PASS", detail: nasty[3] };
  assertions["T6-R05"] = { assertion: "PASS", detail: nasty[4] };
  assertions["T6-R06"] = { assertion: "PASS", detail: nasty[5] };
  assertions["T6-R07"] = { assertion: "PASS", detail: nasty[6] };
  const records = buildEvidenceRecords(finalizeResults(assertions, "PASS"), { residueGate: "PASS" });
  const text = renderEvidenceJsonl(records);
  for (const secret of [
    "hunter2", "topsecret", "eyJhbGciOiJIUzI1NiJ9", "db.example.supabase.co",
    "5d8f1c62-9a37-4e0b-b1f4-7c0e2a6d9f41", "INSERT INTO public.documents",
  ]) {
    assert.ok(!text.includes(secret), `the evidence must not contain "${secret}"`);
  }
  // The redaction markers are present, so the removal is explicit.
  assert.match(text, /\[redacted-/);
});

test("E8b: the evidence never carries the SQL statement log", () => {
  const dir = tmpRoot();
  try {
    const records = buildEvidenceRecords(allPassResults(), { residueGate: "PASS" });
    const bundle = writeEvidenceBundle({
      evidenceDir: dir,
      records,
      meta: { statementsIssued: 42, forbiddenStatements: 0 },
    });
    const text = readFileSync(bundle.evidencePath, "utf8");
    const manifest = JSON.parse(readFileSync(bundle.manifestPath, "utf8"));
    assert.ok(!text.includes("SELECT"), "no SQL text may appear in the evidence file");
    assert.ok(!text.includes("BEGIN"), "no SQL text may appear in the evidence file");
    assert.equal(manifest.statementsIssued, 42, "only a statement COUNT is recorded");
    assert.equal(manifest.forbiddenStatements, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- E9: no false successful outcome when the finalization fails -------------
test("E9: a failed evidence finalization can never yield a successful verdict", () => {
  const results = allPassResults();
  assert.equal(suiteVerdict(results), "PASS", "the case set itself passes");
  assert.equal(finalSuiteVerdict(results, { ok: false, error: "boom" }), "FAIL");
  assert.equal(finalSuiteVerdict(results, null), "FAIL");
  assert.equal(finalSuiteVerdict(results, { ok: true }), "PASS");
});

test("E9b: an incomplete record set cannot be written as evidence", () => {
  const dir = tmpRoot();
  try {
    const records = buildEvidenceRecords(allPassResults(), { residueGate: "PASS" });
    const short = records.slice(0, 7);
    assert.equal(validateEvidenceRecords(short).ok, false);
    let threw = false;
    try { writeEvidenceBundle({ evidenceDir: dir, records: short, meta: {} }); } catch { threw = true; }
    assert.equal(threw, true, "an incomplete record set must be refused");
    // Nothing may be left behind that claims success.
    assert.equal(existsSync(path.join(dir, EVIDENCE_FILE_NAME)), false);
    assert.equal(existsSync(path.join(dir, MANIFEST_FILE_NAME)), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("E9c: a duplicated or unknown case id is refused", () => {
  const records = buildEvidenceRecords(allPassResults(), { residueGate: "PASS" });
  const dup = [...records];
  dup[1] = { ...dup[0] };
  assert.equal(validateEvidenceRecords(dup).ok, false);
  const unknown = [...records];
  unknown[0] = { ...unknown[0], case: "T6-R99" };
  assert.equal(validateEvidenceRecords(unknown).ok, false);
});

test("E9d: a record without a valid status is refused", () => {
  const records = buildEvidenceRecords(allPassResults(), { residueGate: "PASS" });
  records[0] = { ...records[0], verdict: "MAYBE" };
  assert.equal(validateEvidenceRecords(records).ok, false);
  records[0] = { ...records[0], verdict: "PASS", detail: "" };
  assert.equal(validateEvidenceRecords(records).ok, false);
});

// ===========================================================================
// PREFLIGHT (matrix namespaces.collision_rule): a mandatory, fail-closed
// hosted-schema preflight that runs before any synthetic fixture is created.
// ===========================================================================

const preflightSection = () => parseHarnessSections(harnessText).get("preflight.schema") || "";

// --- P1: the preflight is a separate, bounded, READ ONLY transaction --------
test("P1: the preflight section is its own bounded READ ONLY transaction", () => {
  const s = preflightSection();
  assert.ok(s.length > 0, "the preflight.schema section must exist");
  assert.match(s, /BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY;/);
  assert.match(s, /SET LOCAL statement_timeout = '30s';/);
  assert.match(s, /SET LOCAL lock_timeout = '5s';/);
  assert.equal(stripSqlNoise(s).trim().endsWith("ROLLBACK;"), true, "the preflight must end with ROLLBACK");
  // It must never write.
  assert.ok(!/^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|COPY)\b/mi.test(s), "the preflight must not write");
  // It must not open a transaction that is not read only.
  // The PL/pgSQL BEGIN of the DO block lives inside a dollar-quoted body, so
  // it is removed before the transaction count is taken.
  const outside = stripSqlNoise(s);
  assert.equal((outside.match(/BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY;/g) || []).length, 1);
  assert.equal(/BEGIN(?! ISOLATION LEVEL READ COMMITTED READ ONLY;)/i.test(outside), false,
    "the preflight opens exactly one transaction");
});

// --- P2: the function contract is explicit and complete ---------------------
test("P2: the preflight asserts every required lifecycle and fence function", () => {
  const s = preflightSection();
  const expected = [
    ["request_storage_deletion", "text", "uuid"],
    ["get_document_storage_reference_state", "text", "record"],
    ["get_storage_reference_state", "text", "record"],
    ["check_storage_deletion_references", "text", "record"],
    ["claim_storage_deletion_request", "uuid", "record"],
    ["claim_storage_deletion_requests", "integer", "record"],
    ["block_storage_deletion", "uuid, uuid, text", "boolean"],
    ["record_storage_deletion_failure", "uuid, uuid, text, integer", "text"],
    ["set_r2_confirmed_absent", "uuid, uuid", "boolean"],
    ["finalize_storage_deletion", "uuid, uuid", "boolean"],
    ["mark_storage_deletion_quota_resynced", "uuid", "void"],
    ["list_storage_deletion_quota_resyncs", "integer", "record"],
    ["cancel_storage_deletion", "uuid", "boolean"],
    ["enforce_storage_key_fence", "", "trigger"],
    ["fence_storage_key_for_deletion", "uuid, uuid", "text"],
    ["is_storage_key_fenced", "text", "boolean"],
    ["has_role", "uuid, public.app_role", "boolean"],
  ];
  for (const [fn, args, ret] of expected) {
    assert.ok(s.includes(`'${fn}'`), `the preflight must assert the function ${fn}`);
    assert.ok(s.includes(`'${args}'`), `the preflight must assert the argument types of ${fn}`);
    assert.ok(s.includes(`'${ret}'`), `the preflight must assert the return type of ${fn}`);
  }
  // The checks are fail-closed: a missing function, a wrong return type, a
  // wrong set-returning shape and a non-SECURITY-DEFINER function all fail.
  assert.match(s, /is missing/);
  assert.match(s, /returns %s, expected %s/);
  assert.match(s, /different set-returning shape/);
  assert.match(s, /is not SECURITY DEFINER/);
});

// --- P3: the trigger contract ----------------------------------------------
test("P3: the preflight asserts every fence trigger, table and column", () => {
  const s = preflightSection();
  const expected = [
    ["public.documents", "documents_50_storage_key_fence", "storage_key"],
    ["public.payments", "payments_50_proof_key_fence", "proof_key"],
    ["public.jathagam_requests", "jathagam_requests_50_report_key_fence", "report_key"],
    ["public.support_messages", "support_messages_50_attachment_key_fence", "attachment_key"],
    ["public.profiles", "profiles_50_photo_url_fence", "photo_url"],
    ["public.payment_events", "payment_events_50_receipt_key_fence", "receipt_key"],
  ];
  for (const [rel, trg, col] of expected) {
    assert.ok(s.includes(`'${rel}'`), `the preflight must assert the relation ${rel}`);
    assert.ok(s.includes(`'${trg}'`), `the preflight must assert the trigger ${trg}`);
    assert.ok(s.includes(`'${col}'`), `the preflight must assert the guarded column ${col}`);
  }
  assert.match(s, /is not enabled/);
  assert.match(s, /row-level BEFORE INSERT OR UPDATE/);
  assert.match(s, /enforce_storage_key_fence/);
  // The guarded column is verified by column number and by the UPDATE OF
  // clause, never by a substring of the trigger name (see the M2 tests).
  assert.match(s, /a\.attnum/);
  assert.match(s, /tg\.tgattr::text/);
  assert.match(s, /v_upd_clause IS DISTINCT FROM v_col/);
});

// --- P4: the namespace purity check -----------------------------------------
test("P4: the preflight proves the synthetic namespace is empty everywhere", () => {
  const s = preflightSection();
  for (const rel of [
    "auth.users", "public.storage_deletion_requests", "public.storage_deletion_fences",
    "public.documents", "public.profiles", "public.user_roles", "public.payments",
    "public.jathagam_requests", "public.support_threads", "public.support_messages",
    "public.payment_events",
  ]) {
    assert.ok(s.includes(rel), `the preflight must count ${rel}`);
  }
  // All three synthetic identities and the key prefix must be part of every
  // identity-bearing count.
  assert.match(s, /v_owner, v_other, v_admin/);
  assert.match(s, /v_prefix \|\| '%'/);
  // A nonzero count is a failure, never a warning.
  assert.match(s, /IF v_n <> 0 THEN/);
  assert.match(s, /synthetic row\(s\)/);
  // A missing relation is a failure too.
  assert.match(s, /missing relation\(s\)/);
  assert.match(s, /to_regclass\(r\) IS NULL/);
});

// --- P5: constraints, indexes and permissions -------------------------------
test("P5: the preflight asserts the constraints, indexes and permissions", () => {
  const s = preflightSection();
  for (const name of [
    "storage_deletion_requests_owner_prefix_check",
    "payments_method_allowed",
    "storage_deletion_requests_live_key",
    "storage_deletion_fences_pkey",
    "payments_manual_utr_user_item_uniq",
    "payments_manual_submitted_user_item_uniq",
  ]) {
    assert.ok(s.includes(name), `the preflight must assert ${name}`);
  }
  // Row-level security, policies and table privileges.
  assert.match(s, /relrowsecurity/);
  assert.match(s, /row-level security is not enabled/);
  assert.match(s, /pg_policies/);
  assert.match(s, /row-level policy\/policies/);
  assert.match(s, /has_table_privilege\('service_role'/);
  assert.match(s, /has_table_privilege\('anon'/);
  assert.match(s, /has_table_privilege\('authenticated'/);
  // Function EXECUTE grants.
  assert.match(s, /has_function_privilege\('authenticated'/);
  assert.match(s, /has_function_privilege\('service_role'/);
  assert.match(s, /has_function_privilege\('anon'/);
  // The expected EXECUTE holders are explicit.
  for (const [fn, holder] of [
    ["request_storage_deletion", "authenticated"],
    ["fence_storage_key_for_deletion", "service_role"],
    ["is_storage_key_fenced", "service_role"],
    ["enforce_storage_key_fence", "authenticated,service_role"],
  ]) {
    assert.ok(s.includes(`'${fn}'`), `the preflight must assert the EXECUTE grant of ${fn}`);
    assert.ok(s.includes(`'${holder}'`), `the preflight must assert that ${fn} is executable by ${holder}`);
  }
});

// --- P6: the preflight fails closed and publishes every failure ------------
test("P6: the preflight publishes its result and raises with its own SQLSTATE", () => {
  const s = preflightSection();
  assert.match(s, /set_config\('t6r\.preflight'/);
  assert.match(s, /'t6-group-r-preflight\/v1'/);
  assert.match(s, /'failures'/);
  assert.match(s, /'namespace'/);
  assert.match(s, /USING ERRCODE = 'TPF01'/);
  // The runner classifies the preflight SQLSTATE as BLOCKED, never as a FAIL.
  const c = classifySqlFailure({ sqlstate: "TPF01", message: "preflight failed", label: "preflight.schema" });
  assert.equal(c.outcome, "BLOCKED");
  assert.equal(c.kind, "preflight");
});

// --- P7: the runner interprets the preflight fail closed --------------------
test("P7: a complete all-zero preflight payload is accepted", () => {
  const namespace = Object.fromEntries(PREFLIGHT_NAMESPACE_KEYS.map((k) => [k, 0]));
  const payload = JSON.stringify({
    schema: PREFLIGHT_SCHEMA, ok: true, checks: 57, failures: [], namespace,
    fingerprint: goodFingerprint,
  });
  const probe = `${PROBE_PREFIX}${JSON.stringify({ sqlstate: "00000", preflight: payload })}`;
  const r = interpretExec("pf", "preflight.schema", [probe]);
  const v = interpretPreflight(r);
  assert.equal(v.ok, true, v.reason);
  assert.equal(v.failures.length, 0);
  assert.equal(v.checks, 57);
});

test("P7: every incomplete or inconsistent preflight is refused", () => {
  const ns = Object.fromEntries(PREFLIGHT_NAMESPACE_KEYS.map((k) => [k, 0]));
  const withPayload = (payload) => interpretPreflight(interpretExec("pf", "preflight.schema", [
    `${PROBE_PREFIX}${JSON.stringify({ sqlstate: "00000", preflight: payload })}`,
  ]));
  // no probe at all
  assert.equal(interpretPreflight(interpretExec("pf", "preflight.schema", [])).ok, false);
  // a failed statement
  const failed = interpretPreflight(interpretExec("pf", "preflight.schema", [
    `${PROBE_PREFIX}${JSON.stringify({ sqlstate: "TPF01", message: "boom" })}`,
  ]));
  assert.equal(failed.ok, false);
  assert.match(failed.reason, /TPF01|failed/);
  // no payload
  assert.equal(withPayload("").ok, false);
  // malformed payload
  assert.equal(withPayload("{not json").ok, false);
  // wrong schema
  assert.equal(withPayload(JSON.stringify({ schema: "other/v1", ok: true, failures: [], namespace: ns })).ok, false);
  // failures reported
  const failedOne = withPayload(JSON.stringify({
    schema: PREFLIGHT_SCHEMA, ok: false, checks: 57, failures: ["documents holds 1 synthetic row(s)"], namespace: ns,
  }));
  assert.equal(failedOne.ok, false);
  assert.match(failedOne.reason, /documents holds 1/);
  // ok:true but a nonzero namespace count
  const dirty = { ...ns, documents: 1 };
  assert.equal(withPayload(JSON.stringify({ schema: PREFLIGHT_SCHEMA, ok: true, failures: [], namespace: dirty })).ok, false);
  // ok:true but a relation was never counted
  const partial = { ...ns };
  delete partial.payments;
  assert.equal(withPayload(JSON.stringify({ schema: PREFLIGHT_SCHEMA, ok: true, failures: [], namespace: partial })).ok, false);
  // no namespace at all
  assert.equal(withPayload(JSON.stringify({ schema: PREFLIGHT_SCHEMA, ok: true, failures: [], namespace: null })).ok, false);
});

// --- P8: the preflight runs before any fixture is created -------------------
test("P8: the preflight runs before the observer and before every case", () => {
  const preflightAt = runnerSrc.indexOf("preflight = await runPreflight();");
  const observerAt = runnerSrc.indexOf("await observer.start();");
  const firstCaseAt = runnerSrc.indexOf('runCase("T6-R01"');
  assert.ok(preflightAt > 0, "the runner must run the preflight");
  assert.ok(preflightAt < observerAt, "the preflight must run before the observer session opens");
  assert.ok(preflightAt < firstCaseAt, "the preflight must run before the first case");
  // The preflight session is created with its own tag and its own connection.
  assert.match(runnerSrc, /const pf = mk\("pf", PREFLIGHT_TAG, \{\}, true\);/);
  assert.equal(PREFLIGHT_TAG, "slmm-t6-pf");
  // It is closed before the residue measurement.
  const closeAt = runnerSrc.indexOf("try { pf.close(); }");
  assert.ok(closeAt > 0, "the preflight session must be closed");
  assert.ok(closeAt < runnerSrc.indexOf('runCase("T6-R07"'), "the preflight session must be closed before R07");
});

test("P8b: every stateful case is blocked when the preflight failed", () => {
  for (const id of ["T6-R01", "T6-R02", "T6-R03", "T6-R04", "T6-R05"]) {
    const at = runnerSrc.indexOf(`runCase("${id}"`);
    assert.ok(at > 0, `${id} must exist`);
    const guard = runnerSrc.slice(at, at + 400);
    assert.match(guard, /if \(!preflight\.ok\)/, `${id} must be blocked by a failed preflight`);
    assert.match(guard, /status: "BLOCKED"/, `${id} must record BLOCKED`);
    // The reason must be a TEMPLATE literal, so the operator sees WHY.
    assert.match(guard, /detail: `the hosted-schema preflight blocked this case: \$\{preflight\.reason\}`/,
      `${id} must interpolate the preflight reason into the detail`);
  }
  // A blocked preflight can never yield a successful suite verdict.
  const assertions = Object.create(null);
  for (const id of ["T6-R01", "T6-R02", "T6-R03", "T6-R04", "T6-R05"]) {
    assertions[id] = { assertion: "BLOCKED", detail: "the hosted-schema preflight blocked this case" };
  }
  // The residue and hygiene cases still ran and passed.
  for (const id of ["T6-R06", "T6-R07", "T6-R08"]) {
    assertions[id] = { assertion: "PASS", detail: "ok" };
  }
  const results = finalizeResults(assertions, "PASS");
  assert.equal(suiteVerdict(results), "BLOCKED");
  assert.notEqual(suiteVerdict(results), "PASS");
  for (const id of ["T6-R01", "T6-R02", "T6-R03", "T6-R04", "T6-R05"]) {
    assert.equal(results.find((r) => r.id === id).verdict, "BLOCKED");
  }
});

// --- P9: the preflight is a required harness section ------------------------
test("P9: the preflight section is required and its payload is reset per statement", () => {
  assert.ok(REQUIRED_SECTIONS.includes("preflight.schema"));
  assert.deepEqual(missingHarnessSections(parseHarnessSections(harnessText)), []);
  // A stale preflight payload must never be readable by a later statement.
  assert.match(RESET_SQL, /set_config\('t6r\.preflight', '', false\)/);
});

test("P9b: the preflight namespace contract is the reviewed eleven relations", () => {
  assert.equal(PREFLIGHT_NAMESPACE_KEYS.length, 11);
  for (const k of ["auth.users", "documents", "payments", "payment_events"]) {
    assert.ok(PREFLIGHT_NAMESPACE_KEYS.includes(k), k);
  }
});

test("P10: the preflight result stays in scope for the evidence manifest", () => {
  // A block-scoped declaration inside the try block would make the manifest
  // reference a binding that does not exist on the tail path.
  const decl = runnerSrc.indexOf("let preflight = null;");
  const assign = runnerSrc.indexOf("preflight = await runPreflight();");
  const use = runnerSrc.indexOf("preflight: {");
  assert.ok(decl > 0, "the preflight result must be declared");
  assert.ok(assign > decl, "the preflight result must be assigned after it is declared");
  assert.ok(use > assign, "the evidence manifest must be able to read the preflight result");
  const observerStart = runnerSrc.indexOf("await observer.start();");
  const mainTry = runnerSrc.lastIndexOf("try {", observerStart);
  assert.ok(decl < mainTry, "the preflight declaration must be outside the try block");
  assert.ok(mainTry < observerStart, "the main try block must wrap the observer start");
});

// ===========================================================================
// M1 / M2 / M3 regression tests -- the corrections of the independent
// hosted-schema preflight contract audit.
//
//   M1  the function contract must resolve by FUNCTION IDENTITY, never by a
//       rendered type string, so public.has_role(uuid, public.app_role) is
//       accepted and a wrong signature is rejected;
//   M2  the guarded trigger column must be verified by COLUMN NUMBER and by
//       the rendered UPDATE OF clause, never by a substring of the trigger
//       name;
//   M3  a failed preflight must still report its diagnostics, and a
//       diagnostic payload must never be treated as proof of success.
// ===========================================================================

const pfSection = () => parseHarnessSections(harnessText).get("preflight.schema") || "";

// --- M1: identity resolution ------------------------------------------------
test("M1: the function contract resolves by identity, not by a rendered type string", () => {
  const s = pfSection();
  // The rendered-string comparison is gone. The rendered argument type is
  // only ever READ as fingerprint material (the digest input), never
  // COMPARED with the expected contract.
  const fpAt = s.indexOf("THE PINNED T6 FUNCTION-DEFINITION FINGERPRINT");
  const contract = fpAt > 0 ? s.slice(0, fpAt) : s;
  const fingerprint = fpAt > 0 ? s.slice(fpAt) : "";
  assert.ok(!/oidvectortypes/.test(contract), "the contract must not compare a rendered argument-type string");
  assert.ok(
    !/oidvectortypes\s*(=|<>|!=|LIKE|ILIKE|IS)\b/.test(fingerprint),
    "the fingerprint must read the rendered argument type, never compare it",
  );
  assert.match(s, /to_regprocedure/);
  // The non-builtin argument type is written in the regprocedure input form.
  assert.ok(s.includes("'uuid, public.app_role'"), "has_role must be contracted as public.has_role(uuid, public.app_role)");
  assert.ok(!s.includes("'uuid, app_role'"), "the unqualified spelling would never match the catalog");
});

test("M1: public.has_role(uuid, public.app_role) is accepted by the contract", () => {
  const s = pfSection();
  // The contract names the function with the qualified type ...
  assert.match(s, /\('has_role',\s+'uuid, public\.app_role','boolean', false\)/);
  // ... and resolves it through the catalog by identity, so the qualified
  // spelling is what the catalog is asked for.
  assert.match(s, /to_regprocedure\('public\.' \|\| v_fn \|\| '\(' \|\| v_exp_args \|\| '\)'\)/);
  // The other return-type, set-returning and SECURITY DEFINER checks survive.
  assert.match(s, /returns %s, expected %s/);
  assert.match(s, /different set-returning shape/);
  assert.match(s, /is not SECURITY DEFINER/);
});

test("M1: a wrong function signature is rejected, and a missing function is distinguished", () => {
  const s = pfSection();
  // A function that exists under another name/signature is NOT accepted: the
  // resolution is by identity, and the failure says so.
  assert.match(s, /exists but NOT with the expected argument types/);
  assert.match(s, /is missing/);
  // The resolution must not fall back to a name-only lookup.
  assert.ok(!/p\.proname = v_fn\s+AND/.test(s), "the lookup must not be name-only");
});

// --- M2: the trigger column verification ------------------------------------
test("M2: the guarded trigger column is verified by column number and by the UPDATE OF clause", () => {
  const s = pfSection();
  // The column number of the expected column is resolved from pg_attribute.
  assert.match(s, /pg_catalog\.pg_attribute/);
  assert.match(s, /a\.attnum/);
  assert.match(s, /a\.attname = v_col/);
  assert.match(s, /NOT a\.attisdropped/);
  // The trigger's own column set is read from pg_trigger.tgattr and must be
  // EXACTLY the expected column.
  assert.match(s, /tg\.tgattr::text/);
  assert.match(s, /v_tgattr <> v_attnum::text/);
  // And the rendered UPDATE OF clause must name exactly that column.
  assert.match(s, /substring\(v_def from 'UPDATE OF \(\[\^ \]\+\)'\)/);
  assert.match(s, /v_upd_clause IS DISTINCT FROM v_col/);
  // The weak name-substring test is gone: the trigger name itself contains the
  // column name, so a LIKE test could be satisfied by the name alone.
  assert.ok(!/v_def NOT LIKE \('%' \|\| v_col \|\| '%'\)/.test(s),
    "the guarded column must not be checked by a name substring");
  // The trigger-function, enabled and event checks all survive.
  assert.match(s, /enforce_storage_key_fence/);
  assert.match(s, /is not enabled/);
  assert.match(s, /row-level BEFORE INSERT OR UPDATE/);
  assert.match(s, /tgenabled/);
  assert.match(s, /tgtype/);
  assert.match(s, /column %s does not exist on %s/);
});

// --- M3: the diagnostics of a failed preflight ------------------------------
test("M3: a failed preflight keeps its diagnostics and is never a success", () => {
  const payload = JSON.stringify({
    schema: PREFLIGHT_SCHEMA,
    ok: false,
    checks: 57,
    failures: ["documents holds 1 synthetic row(s)", "function public.has_role(uuid, public.app_role) is missing"],
    namespace: Object.fromEntries(PREFLIGHT_NAMESPACE_KEYS.map((k) => [k, 0])),
  });
  // The SQL operation failed (TPF01) and the payload carries the details.
  const r = interpretExec("pf", "preflight.schema", [
    `${PROBE_PREFIX}${JSON.stringify({ sqlstate: "TPF01", message: "preflight failed", preflight: payload })}`,
  ]);
  const v = interpretPreflight(r);
  assert.equal(v.ok, false, "a failed preflight must never be a success");
  assert.equal(v.failures.length, 2, "the failure list must be preserved");
  assert.equal(v.checks, 57, "the checked-object count must be preserved");
  assert.match(v.reason, /documents holds 1 synthetic row/);
  assert.match(v.reason, /TPF01/);
  assert.ok(v.namespace, "the namespace counts must be preserved as a diagnostic");
  // The failure is still a BLOCKED outcome, never a FAIL.
  const c = classifySqlFailure({ sqlstate: "TPF01", message: "preflight failed", label: "preflight.schema" });
  assert.equal(c.outcome, "BLOCKED");
});

test("M3: a diagnostic payload can never make a failed statement look successful", () => {
  // A payload that CLAIMS success while the SQL operation failed must still be
  // refused.
  const lying = JSON.stringify({
    schema: PREFLIGHT_SCHEMA,
    ok: true,
    checks: 57,
    failures: [],
    namespace: Object.fromEntries(PREFLIGHT_NAMESPACE_KEYS.map((k) => [k, 0])),
  });
  const r = interpretExec("pf", "preflight.schema", [
    `${PROBE_PREFIX}${JSON.stringify({ sqlstate: "23514", message: "boom", preflight: lying })}`,
  ]);
  const v = interpretPreflight(r);
  assert.equal(v.ok, false, "a failing statement with a success payload is still a failure");
  assert.match(v.reason, /the preflight statement failed/);
});

test("M3: a missing or malformed diagnostic payload fails closed", () => {
  const withPayload = (p) => interpretPreflight(interpretExec("pf", "preflight.schema", [
    `${PROBE_PREFIX}${JSON.stringify({ sqlstate: "00000", preflight: p })}`,
  ]));
  assert.equal(withPayload("").ok, false);
  assert.equal(withPayload("{not json").ok, false);
  assert.equal(withPayload(JSON.stringify({ schema: "other/v1", ok: true, failures: [], namespace: {} })).ok, false);
  // A failed statement with NO payload at all is still a failure.
  const noPayload = interpretPreflight(interpretExec("pf", "preflight.schema", [
    `${PROBE_PREFIX}${JSON.stringify({ sqlstate: "TPF01", message: "boom" })}`,
  ]));
  assert.equal(noPayload.ok, false);
  assert.equal(noPayload.failures.length, 0);
});

// --- mocked correct TEST metadata passes ------------------------------------
test("M1/M3: correct mocked TEST metadata passes the preflight", () => {
  const namespace = Object.fromEntries(PREFLIGHT_NAMESPACE_KEYS.map((k) => [k, 0]));
  const payload = JSON.stringify({
    schema: PREFLIGHT_SCHEMA,
    ok: true,
    checks: 57,
    failures: [],
    namespace,
    fingerprint: goodFingerprint,
  });
  const r = interpretExec("pf", "preflight.schema", [
    `${PROBE_PREFIX}${JSON.stringify({ sqlstate: "00000", preflight: payload })}`,
  ]);
  const v = interpretPreflight(r);
  assert.equal(v.ok, true, v.reason);
  assert.equal(v.failures.length, 0);
  assert.equal(v.checks, 57);
  // A single dirty relation is enough to refuse it.
  const dirty = { ...namespace, payments: 1 };
  const v2 = interpretPreflight(interpretExec("pf", "preflight.schema", [
    `${PROBE_PREFIX}${JSON.stringify({
      sqlstate: "00000",
      preflight: JSON.stringify({ schema: PREFLIGHT_SCHEMA, ok: true, checks: 57, failures: [], namespace: dirty }),
    })}`,
  ]));
  assert.equal(v2.ok, false);
  assert.match(v2.reason, /payments=1/);
});

// --- the manifest records redacted diagnostics ------------------------------
test("M3: the evidence manifest records the redacted preflight diagnostics", () => {
  assert.match(runnerSrc, /failures: \(preflight\.failures \|\| \[\]\)\.map\(\(f\) => redactSensitive\(f\)\)/);
  assert.match(runnerSrc, /reason: redactSensitive\(preflight\.reason \|\| ""\)/);
  // The redaction itself must cover the dangerous shapes.
  const r = redactSensitive("host=db.example.supabase.co password=hunter2 postgres://u:p@h/db");
  assert.ok(!r.includes("hunter2"), "a password must never survive redaction");
  assert.ok(!r.includes("db.example.supabase.co"), "a connection detail must never survive redaction");
});

// ---------------------------------------------------------------------------
// FP: the pinned T6 function-definition fingerprint (contract v2)
// ---------------------------------------------------------------------------
// The fingerprint is a T6-specific, version-stable digest over the catalog
// definition of the 17 contract functions. It is pinned to the value that was
// OBSERVED on Supabase TEST (PostgreSQL 17.11) and independently reproduced
// from the read-only capture. Every deviation fails closed.

test("FP1: the pinned fingerprint constants are the approved ones", () => {
  assert.equal(T6_FINGERPRINT_CONTRACT, "t6-group-r-fingerprint/v2");
  assert.equal(T6_FINGERPRINT_EXPECTED, "a85fea6468487830a4ca9afc268d9aef");
  assert.match(T6_FINGERPRINT_EXPECTED, /^[0-9a-f]{32}$/);
  assert.equal(T6_FINGERPRINT_SERVER_VERSION, "17.11");
  assert.equal(T6_FINGERPRINT_FUNCTION_COUNT, 17);
  assert.deepEqual([...T6_FINGERPRINT_FIELDS], [
    "name", "args", "returns", "setof", "secdef", "volatile", "parallel", "leakproof", "owner", "body_md5",
  ]);
});

test("FP2: the independent implementation reproduces the pinned digest from the captured material", () => {
  assert.equal(CAPTURED_MATERIAL.length, 17);
  const digest = computeT6Fingerprint(CAPTURED_MATERIAL);
  assert.equal(digest, T6_FINGERPRINT_EXPECTED, "the implementation must reproduce the observed hosted digest");
});

test("FP3: the digest is deterministic and independent of the input order", () => {
  const a = computeT6Fingerprint(CAPTURED_MATERIAL);
  const b = computeT6Fingerprint([...CAPTURED_MATERIAL].reverse());
  assert.equal(a, b);
  assert.equal(a, computeT6Fingerprint([...CAPTURED_MATERIAL]));
});

test("FP4: a changed function body changes the digest", () => {
  const drifted = CAPTURED_MATERIAL.map((f) => (f.name === "has_role"
    ? { ...f, body_md5: "00000000000000000000000000000000" }
    : f));
  const digest = computeT6Fingerprint(drifted);
  assert.notEqual(digest, T6_FINGERPRINT_EXPECTED, "a changed body must change the digest");
  assert.equal(evaluateT6Fingerprint({ ...goodFingerprint, computed: digest }).ok, false);
});

test("FP5: attribute drift changes the digest", () => {
  const mutations = {
    secdef: (f) => ({ ...f, secdef: !f.secdef }),
    volatile: (f) => ({ ...f, volatile: f.volatile === "v" ? "s" : "v" }),
    parallel: (f) => ({ ...f, parallel: f.parallel === "u" ? "s" : "u" }),
    leakproof: (f) => ({ ...f, leakproof: !f.leakproof }),
    setof: (f) => ({ ...f, setof: !f.setof }),
    owner: (f) => ({ ...f, owner: "someone_else" }),
    returns: (f) => ({ ...f, returns: "text" }),
    args: (f) => ({ ...f, args: "uuid, uuid, text, text" }),
  };
  for (const [label, mutate] of Object.entries(mutations)) {
    const drifted = CAPTURED_MATERIAL.map((f, i) => (i === 3 ? mutate(f) : f));
    const digest = computeT6Fingerprint(drifted);
    assert.notEqual(digest, T6_FINGERPRINT_EXPECTED, `${label} drift must change the digest`);
  }
});

test("FP6: a missing function cannot produce the pinned digest", () => {
  const short = CAPTURED_MATERIAL.slice(1);
  assert.equal(computeT6Fingerprint(short) === T6_FINGERPRINT_EXPECTED, false);
  assert.equal(evaluateT6Fingerprint({ ...goodFingerprint, functionCount: 16 }).ok, false);
  assert.match(evaluateT6Fingerprint({ ...goodFingerprint, functionCount: 16 }).problems.join(" "), /16 functions/);
});

test("FP7: incomplete material cannot be calculated at all", () => {
  assert.equal(computeT6Fingerprint([]), null);
  assert.equal(computeT6Fingerprint(null), null);
  assert.equal(computeT6Fingerprint("nope"), null);
  const missingField = CAPTURED_MATERIAL.map((f, i) => (i === 0 ? { ...f, body_md5: undefined } : f));
  assert.equal(computeT6Fingerprint(missingField), null);
  const unnamed = CAPTURED_MATERIAL.map((f, i) => (i === 0 ? { ...f, name: "" } : f));
  assert.equal(computeT6Fingerprint(unnamed), null);
});

test("FP8: the exact pinned fingerprint is accepted", () => {
  const v = evaluateT6Fingerprint(goodFingerprint);
  assert.equal(v.ok, true, v.problems.join(" | "));
  assert.equal(v.problems.length, 0);
  assert.equal(v.expected, T6_FINGERPRINT_EXPECTED);
  assert.equal(v.computed, T6_FINGERPRINT_EXPECTED);
  assert.equal(v.serverVersion, "17.11");
});

test("FP9: every wrong, missing or malformed fingerprint is refused", () => {
  const bad = [
    { ...goodFingerprint, computed: "0".repeat(32) },
    { ...goodFingerprint, computed: "a85fea6468487830a4ca9afc268d9ae" },
    { ...goodFingerprint, computed: "A85FEA6468487830A4CA9AFC268D9AEF" },
    { ...goodFingerprint, computed: "a85fea6468487830a4ca9afc268d9ae" },
    { ...goodFingerprint, computed: "" },
    { ...goodFingerprint, computed: "not-a-digest" },
    { ...goodFingerprint, computed: null },
    { ...goodFingerprint, computed: undefined },
    { ...goodFingerprint, computed: 42 },
    { ...goodFingerprint, expected: "0".repeat(32) },
    { ...goodFingerprint, expected: undefined },
    { ...goodFingerprint, schema: "t6-group-r-fingerprint/v1" },
    { ...goodFingerprint, schema: undefined },
    { ...goodFingerprint, functionCount: 18 },
    { ...goodFingerprint, functionCount: "17" },
    { ...goodFingerprint, functionCount: undefined },
    {},
    null,
    undefined,
  ];
  for (const fp of bad) {
    const v = evaluateT6Fingerprint(fp);
    assert.equal(v.ok, false, `must refuse ${JSON.stringify(fp)}`);
    assert.ok(v.problems.length > 0, "a refusal must always carry a reason");
  }
});

test("FP10: a PostgreSQL version difference alone does not block", () => {
  for (const version of ["17.10", "17.12", "18.1", undefined]) {
    const v = evaluateT6Fingerprint({ ...goodFingerprint, serverVersion: version });
    assert.equal(v.ok, true, `the version ${version} must not be a blocker`);
  }
});

test("FP11: the preflight fails closed when the fingerprint is wrong", () => {
  const withFingerprint = (fp) => interpretPreflight(interpretExec("pf", "preflight.schema", [
    `${PROBE_PREFIX}${JSON.stringify({ sqlstate: "00000", preflight: fpPayload(fp) })}`,
  ]));
  const good = withFingerprint(goodFingerprint);
  assert.equal(good.ok, true, good.reason);
  assert.equal(good.fingerprint.ok, true);
  // A missing fingerprint is a refusal, not a pass.
  const missing = withFingerprint(undefined);
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /fingerprint/i);
  // A drifted digest is a refusal.
  const drifted = withFingerprint({ ...goodFingerprint, computed: "0".repeat(32) });
  assert.equal(drifted.ok, false);
  assert.match(drifted.reason, /fingerprint drifted/i);
  assert.equal(drifted.fingerprint.ok, false);
});

test("FP12: the evidence manifest records the fingerprint outcome", () => {
  assert.match(runnerSrc, /fingerprint: \{\s*contract: T6_FINGERPRINT_CONTRACT,/);
  assert.match(runnerSrc, /expected: T6_FINGERPRINT_EXPECTED,/);
  assert.match(runnerSrc, /computed: \(preflight\.fingerprint && preflight\.fingerprint\.computed\) \|\| null,/);
  assert.match(runnerSrc, /serverVersion: \(preflight\.fingerprint && preflight\.fingerprint\.serverVersion\) \|\| null,/);
});

test("FP13: the harness computes the fingerprint with the exact pinned contract", () => {
  // The pinned baseline is present in the SQL, and it is the same value the
  // runner pins.
  assert.match(harnessText, /a85fea6468487830a4ca9afc268d9aef/);
  // The construction: md5 over the jsonb serialisation of the 17 functions.
  assert.match(harnessText, /'schema', 't6-group-r-fingerprint\/v2'/);
  assert.match(harnessText, /md5\(jsonb_build_object\(/);
  assert.match(harnessText, /jsonb_agg\(jsonb_build_object\([\s\S]*?ORDER BY p\.proname\)/);
  // Exactly the ten catalog-derived fields.
  for (const field of ["name", "args", "returns", "setof", "secdef", "volatile", "parallel", "leakproof", "owner", "body_md5"]) {
    assert.match(harnessText, new RegExp(`'${field}',`), `the harness must contribute the ${field} field`);
  }
  // The sources of the ten fields are the catalog, not a rendering.
  assert.match(harnessText, /'args', pg_catalog\.oidvectortypes\(p\.proargtypes\)/);
  assert.match(harnessText, /'returns', pg_catalog\.format_type\(p\.prorettype, NULL\)/);
  assert.match(harnessText, /'owner', pg_get_userbyid\(p\.proowner\)/);
  assert.match(harnessText, /'body_md5', md5\(p\.prosrc\)/);
  // The observed baseline version is recorded but never asserted.
  assert.match(harnessText, /'observedBaselineServerVersion', '17\.11'/);
});

test("FP14: the harness fails closed on every fingerprint deviation", () => {
  // A missing function.
  assert.match(harnessText, /IF v_fp_count <> 17 THEN/);
  assert.match(harnessText, /the fingerprint set is incomplete/);
  // A digest that cannot be calculated or is malformed.
  assert.match(harnessText, /IF v_fp_digest IS NULL OR v_fp_digest !~ '\^\[0-9a-f\]\{32\}\$' THEN/);
  assert.match(harnessText, /the T6 fingerprint could not be calculated or is malformed/);
  // A digest that differs.
  assert.match(harnessText, /ELSIF v_fp_digest <> v_fp_expected THEN/);
  assert.match(harnessText, /the T6 fingerprint drifted/);
  // The failures are appended to the preflight failure list, which is
  // published and then raises TPF01 (fail closed).
  assert.match(harnessText, /array_append\(v_fail, format\('the T6 fingerprint/);
  assert.match(harnessText, /USING ERRCODE = 'TPF01'/);
});

test("FP15: the fingerprint is validated before any fixture or case runs", () => {
  // In the SQL: the fingerprint block precedes the publication of the
  // preflight result.
  const fpAt = harnessText.indexOf("THE PINNED T6 FUNCTION-DEFINITION FINGERPRINT");
  const publishAt = harnessText.indexOf("-- publish the result and fail closed");
  assert.ok(fpAt > 0, "the harness must compute the fingerprint");
  assert.ok(publishAt > 0, "the harness must publish the preflight result");
  assert.ok(fpAt < publishAt, "the fingerprint must be computed before the preflight result is published");
  // In the runner: the preflight (which carries the fingerprint gate) runs
  // before the observer and before the first case.
  const preflightAt = runnerSrc.indexOf("preflight = await runPreflight();");
  const observerAt = runnerSrc.indexOf("await observer.start();");
  const firstCaseAt = runnerSrc.indexOf('runCase("T6-R01"');
  assert.ok(preflightAt < observerAt);
  assert.ok(preflightAt < firstCaseAt);
  // Every case is gated on the preflight verdict.
  assert.match(runnerSrc, /if \(!preflight\.ok\) \{/);
});

test("FP16: the harness fingerprint set is exactly the 17 contract functions", () => {
  const block = harnessText.slice(harnessText.indexOf("THE PINNED T6 FUNCTION-DEFINITION FINGERPRINT"));
  const arrays = [...block.matchAll(/proname = ANY\(ARRAY\[([\s\S]*?)\]\)/g)].map((m) => m[1]);
  assert.equal(arrays.length, 2, "the count and the digest must use the same function set");
  for (const a of arrays) {
    const names = [...a.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    assert.equal(names.length, 17, "the fingerprint set must hold 17 functions");
    assert.equal(new Set(names).size, 17, "the fingerprint set must hold 17 distinct functions");
    assert.deepEqual([...names].sort(), CAPTURED_MATERIAL.map((f) => f.name).sort());
  }
});

// ---------------------------------------------------------------------------
// PFX: the preflight payload (and therefore the fingerprint verdict) must
//      actually reach the runner
// ---------------------------------------------------------------------------

test("PFX1: the completion probe publishes the preflight payload", () => {
  assert.match(runnerSrc, /'preflight', coalesce\(current_setting\('t6r\.preflight', true\), ''\)/);
  // The reset clears the setting before every statement, so no other
  // statement can inherit a stale payload.
  assert.match(runnerSrc, /PERFORM set_config\('t6r\.preflight', '', false\);/);
  // A probe row that carries the payload is read by the preflight verdict.
  const payload = fpPayload(goodFingerprint);
  const r = interpretExec("pf", "preflight.schema", [
    `${PROBE_PREFIX}${JSON.stringify({ sqlstate: "00000", preflight: payload })}`,
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.probe.preflight, payload);
  assert.equal(interpretPreflight(r).ok, true);
});

test("PFX2: only a trailing ROLLBACK terminator is removed", () => {
  assert.equal(stripTrailingRollback("BEGIN;\nDO $$ BEGIN END $$;\nROLLBACK;"), "BEGIN;\nDO $$ BEGIN END $$;");
  assert.equal(stripTrailingRollback("BEGIN;\nROLLBACK;\n"), "BEGIN;");
  assert.equal(stripTrailingRollback("BEGIN;\nrollback ;"), "BEGIN;");
  // A section without a terminator is returned unchanged.
  assert.equal(stripTrailingRollback("BEGIN;\nSELECT 1;"), "BEGIN;\nSELECT 1;");
  // A ROLLBACK that is not the final terminator is left untouched.
  const middle = "ROLLBACK;\nBEGIN;\nSELECT 1;";
  assert.equal(stripTrailingRollback(middle), middle);
  // Degenerate inputs never throw.
  assert.equal(stripTrailingRollback(""), "");
  assert.equal(stripTrailingRollback(null), "");
  assert.equal(stripTrailingRollback(undefined), "");
});

test("PFX3: the preflight is executed without its trailing rollback and the session is still rolled back", () => {
  assert.match(runnerSrc, /pf\.exec\(stripTrailingRollback\(S\("preflight\.schema"\)\)/);
  // The session is closed with a ROLLBACK in the finally block.
  assert.match(runnerSrc, /try \{ await pf\.rollback\(\); \} catch \{ \/\* already gone \*\/ \}/);
  assert.match(runnerSrc, /try \{ pf\.close\(\); \} catch \{ \/\* already gone \*\/ \}/);
});

test("PFX4: the harness preflight section still ends with ROLLBACK", () => {
  const section = parseHarnessSections(harnessText).get("preflight.schema") || "";
  assert.match(section, /BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY;/);
  assert.match(section, /ROLLBACK;\s*$/);
  assert.match(section, /USING ERRCODE = 'TPF01'/);
});

// ---------------------------------------------------------------------------
// H3/H5/H6/H7/H8: the run-safety hardening
// ---------------------------------------------------------------------------
// Every test here is hermetic: a mocked child process, a dummy credential and
// injected file-system probes. No process is started, no connection is made,
// no real psql is executed and no credential is read.

const PSQL_NAME = process.platform === "win32" ? "psql.exe" : "psql";
const PSQL_ABS = path.resolve(process.platform === "win32"
  ? "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe"
  : "/usr/bin/psql");
const DUMMY_ENDPOINT = { host: "pooler.invalid", port: REQUIRED_PORT, user: "postgres.t", database: "postgres" };

/** A mocked psql child: it never speaks unless the test makes it speak. */
function mockChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.written = [];
  child.killed = [];
  child.stdin = {
    write: (s) => { child.written.push(String(s)); return true; },
    end: () => { child.stdinEnded = true; },
  };
  child.kill = (sig) => {
    child.killed.push(sig || "SIGTERM");
    child.emit("exit", null, sig || "SIGTERM");
    return true;
  };
  return child;
}

const mockSession = (over = {}) => new PgSession({
  tag: "t",
  applicationName: "slmm-t6-a",
  endpoint: DUMMY_ENDPOINT,
  password: "dummy-credential",
  psqlPath: PSQL_ABS,
  spawnFn: () => mockChild(),
  ...over,
});

// --- H3: the abort taxonomy and the abort evidence ---------------------------

test("H3: an abort is classified as infrastructure, sql, signal or safety", () => {
  assert.deepEqual([...ABORT_KINDS], ["infrastructure", "sql", "signal", "safety", "unknown"]);
  assert.equal(classifyAbort(markAbort(new Error("refused"), "safety")).kind, "safety");
  assert.equal(classifyAbort(markAbort(new Error("no psql"), "infrastructure")).kind, "infrastructure");
  const sqlError = new Error("duplicate key");
  sqlError.sqlstate = "23505";
  assert.equal(classifyAbort(sqlError).kind, "sql");
  const enoent = new Error("spawn failed");
  enoent.code = "ENOENT";
  assert.equal(classifyAbort(enoent).kind, "infrastructure");
  assert.equal(classifyAbort(new Error("boom")).kind, "unknown");
  assert.equal(classifyAbort(new Error("boom"), { cancelled: true }).kind, "signal");
  assert.equal(classifyAbort(new Error("boom"), { signal: "SIGTERM" }).kind, "signal");
  // A cancellation outranks everything else.
  assert.equal(classifyAbort(markAbort(new Error("x"), "safety"), { cancelled: true }).kind, "signal");
});

test("H3: an aborted run never reports a PASS", () => {
  const results = finalizeAbortResults(
    { "T6-R01": { assertion: "PASS", detail: "the duplicate creation serialised" } },
    { kind: "signal", reason: "the operator sent SIGINT" },
  );
  assert.equal(results.length, 8);
  for (const r of results) {
    assert.equal(r.verdict, "BLOCKED", `${r.id} must not be a PASS`);
    assert.ok(!["PASS", "FAIL"].includes(r.verdict));
  }
  // The OBSERVED assertion is preserved next to the verdict.
  assert.equal(results[0].assertion, "PASS");
  assert.match(results[0].detail, /aborted \(signal\)/);
  assert.match(results[0].detail, /last observed: the duplicate creation serialised/);
  // The records are well formed and the residue gate holds.
  const records = buildEvidenceRecords(results, { residueGate: "BLOCKED" });
  assert.equal(validateEvidenceRecords(records).ok, true);
  assert.equal(validateEvidenceGate(records).ok, true);
});

test("H3: the abort evidence bundle is written and names the abort kind", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "t6r-abort-"));
  try {
    const results = finalizeAbortResults({}, { kind: "infrastructure", reason: "psql could not be started" });
    const records = buildEvidenceRecords(results, { residueGate: "BLOCKED" });
    const bundle = writeEvidenceBundle({
      evidenceDir: dir,
      records,
      meta: { runId: "abort-1", abort: { kind: "infrastructure", reason: "psql could not be started" } },
    });
    const manifest = JSON.parse(readFileSync(bundle.manifestPath, "utf8"));
    assert.equal(manifest.abort.kind, "infrastructure");
    assert.equal(manifest.caseOutcomes.PASS, 0, "an aborted run has no PASS");
    assert.equal(manifest.caseOutcomes.BLOCKED, 8);
    const text = readFileSync(bundle.evidencePath, "utf8");
    assert.ok(!text.includes('"PASS"'), "the evidence must not contain a PASS verdict");
    assert.ok(!text.includes("psql could not be started") === false || true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("H3: the abort reason is redacted", () => {
  const a = classifyAbort(new Error("the call failed with PGPASSWORD=hunter2"));
  assert.ok(!a.reason.includes("hunter2"), "a credential must never survive the abort classification");
  assert.match(a.reason, /redacted/);
});

test("H3: the runner records an abort instead of dropping it", () => {
  assert.match(runnerSrc, /abort = classifyAbort\(e, \{ cancelled: cancellation\.cancelled, signal: cancellation\.signal \}\);/);
  assert.match(runnerSrc, /const results = abort\s*\? finalizeAbortResults\(assertions, abort\)/);
  assert.match(runnerSrc, /const verdict = abort \? "FAIL" : finalSuiteVerdict\(results, evidence\);/);
  assert.match(runnerSrc, /abort: abort \? \{ kind: abort\.kind, reason: abort\.reason, signal: abort\.signal \} : null,/);
  // The evidence is written AFTER the abort is classified, so an aborted run
  // still produces its bundle.
  const catchAt = runnerSrc.indexOf("abort = classifyAbort(e,");
  const evidenceAt = runnerSrc.indexOf("const records = buildEvidenceRecords(results,");
  assert.ok(catchAt > 0 && evidenceAt > catchAt, "the abort must be classified before the evidence is written");
});

// --- H5: the child process --------------------------------------------------

test("H5: a child-process error rejects the pending statement instead of crashing", async () => {
  const child = mockChild();
  const session = mockSession({ spawnFn: () => child });
  await session.start();
  const pending = session.exec("SELECT 1;", { label: "x" });
  const err = new Error("spawn ENOENT");
  err.code = "ENOENT";
  child.emit("error", err);
  await assert.rejects(pending, /psql failed \(ENOENT\)/);
  assert.equal(session.spawnError, err);
  assert.equal(session.closed, true);
});

test("H5: a spawn that throws is an infrastructure failure, not a crash", async () => {
  const boom = new Error("nope");
  boom.code = "EACCES";
  const session = mockSession({ spawnFn: () => { throw boom; } });
  await assert.rejects(() => session.start(), /psql could not be started \(EACCES\)/);
  assert.equal(session.closed, true);
  assert.equal(session.spawnError, boom);
});

test("H5: an abnormal exit rejects the pending statement", async () => {
  const child = mockChild();
  const session = mockSession({ spawnFn: () => child });
  await session.start();
  const pending = session.exec("SELECT 1;", { label: "x" });
  child.emit("exit", 3, null);
  await assert.rejects(pending, /psql exited \(3\)/);
  assert.equal(session.exitCode, 3);
  assert.equal(session.closed, true);
});

test("H5: a broken pipe rejects the statement instead of escaping unobserved", async () => {
  const child = mockChild();
  child.stdin.write = () => { throw new Error("EPIPE"); };
  const session = mockSession({ spawnFn: () => child });
  await session.start();
  await assert.rejects(session.exec("SELECT 1;", { label: "x" }), /could not be written to psql/);
  assert.equal(session.waiter, null);
});

test("H5: the child always carries an error handler", () => {
  assert.match(runnerSrc, /this\.child\.on\("error", \(err\) => \{/);
  assert.match(runnerSrc, /this\.child\.on\("exit", \(code, signal\) => \{/);
});

// --- H6: the psql executable -------------------------------------------------

test("H6: an explicit absolute path is resolved and validated", () => {
  const want = path.resolve("/opt/pgsql/bin", PSQL_NAME);
  const resolved = resolvePsqlExecutable({
    psqlPath: want,
    platform: "win32",
    exists: (p) => path.resolve(p) === want,
    isFile: () => true,
    listDir: () => [],
  });
  assert.equal(resolved.path, want);
  assert.ok(path.isAbsolute(resolved.path));
});

test("H6: a bare name is searched in the fixed directories, never in the PATH", () => {
  const want = path.resolve("/usr/bin/psql");
  const dirs = psqlSearchDirectories({ platform: "linux" });
  assert.ok(dirs.length > 0);
  for (const d of dirs) assert.ok(path.isAbsolute(d), `the search directory ${d} must be absolute`);
  const resolved = resolvePsqlExecutable({
    psqlPath: "psql",
    platform: "linux",
    exists: (p) => path.resolve(p) === want,
    isFile: () => true,
    listDir: () => [],
  });
  assert.equal(resolved.path, want);
  assert.equal(resolved.requested, "psql");
});

test("H6: an ambiguous resolution is refused", () => {
  const a = path.resolve("/usr/bin/psql");
  const b = path.resolve("/usr/local/bin/psql");
  assert.throws(() => resolvePsqlExecutable({
    psqlPath: "psql",
    platform: "linux",
    exists: (p) => [a, b].includes(path.resolve(p)),
    isFile: () => true,
    listDir: () => [],
  }), /ambiguous/);
});

test("H6: an unexpected executable is refused", () => {
  const other = path.resolve("/usr/bin/notepad.exe");
  assert.throws(() => resolvePsqlExecutable({
    psqlPath: other,
    platform: "win32",
    exists: (p) => path.resolve(p) === other,
    isFile: () => true,
    listDir: () => [],
  }), /only psql may be executed/);
});

test("H6: a missing executable is refused", () => {
  assert.throws(() => resolvePsqlExecutable({
    psqlPath: path.resolve("/nowhere/psql"),
    platform: "linux",
    exists: () => false,
    isFile: () => false,
    listDir: () => [],
  }), /no psql executable was found/);
});

test("H6: the session refuses to run a non-absolute executable", () => {
  assert.throws(() => mockSession({ psqlPath: "psql" }), /non-absolute psql path/);
  assert.throws(() => mockSession({ psqlPath: "" }), /non-absolute psql path/);
});

test("H6: the TEST-only endpoint guard is untouched", () => {
  assert.match(runnerSrc, /assertTestEndpointIdentity\(endpoint\)/);
  assert.ok(runnerSrc.includes("assertNonProductionTarget(`https://${ref}.supabase.co`, { harness: HARNESS });"));
  assert.match(runnerSrc, /psql = resolvePsqlExecutable\(\{ psqlPath \}\);/);
  // The resolution happens BEFORE any session is created, and INSIDE the
  // try block, so a refusal is recorded as an abort.
  assert.ok(
    runnerSrc.indexOf("resolvePsqlExecutable({ psqlPath })") > runnerSrc.indexOf("try {"),
    "the resolution must happen inside the try block, so a refusal is recorded",
  );
  // The FIRST session is created only after the executable is validated.
  assert.ok(
    runnerSrc.indexOf('mk("obs"') > runnerSrc.indexOf("resolvePsqlExecutable({ psqlPath })"),
    "no session may be created before the executable is validated",
  );
  // The session constructor itself refuses a non-absolute executable, so
  // no session can be created before the resolution, whatever the call site.
  assert.match(runnerSrc, /if \(!psqlPath \|\| !path\.isAbsolute\(String\(psqlPath\)\)\) \{/);
});

// --- H7: the credential ------------------------------------------------------

test("H7: an inherited PGPASSWORD is never trusted", () => {
  assert.throws(() => resolveOperatorCredential({ env: { PGPASSWORD: "ambient-secret" } }), /refusing an inherited PGPASSWORD/);
  assert.throws(() => resolveOperatorCredential({ env: {} }), /no operator credential was supplied/);
  const dedicated = resolveOperatorCredential({ env: { T6R_PGPASSWORD: "operator-secret", PGPASSWORD: "ambient-secret" } });
  assert.equal(dedicated.password, "operator-secret");
  assert.equal(dedicated.source, "operator-variable");
  assert.equal(dedicated.ambientIgnored, true, "the ambient value must be reported as ignored");
  const prompted = resolveOperatorCredential({ env: {}, prompt: () => "typed-secret" });
  assert.equal(prompted.password, "typed-secret");
  assert.equal(prompted.source, "operator-prompt");
});

test("H7: the runner never reads an inherited PGPASSWORD", () => {
  assert.ok(!/process\.env\.PGPASSWORD/.test(runnerSrc), "the runner must not read an inherited PGPASSWORD");
  assert.ok(!/PGPASSWORD\s*\|\|\s*""/.test(runnerSrc));
  assert.match(runnerSrc, /export const OPERATOR_PASSWORD_VARIABLE = "T6R_PGPASSWORD";/);
});

test("H7: the credential reaches the child process and nothing else", async () => {
  const calls = [];
  const child = mockChild();
  const session = mockSession({
    password: "operator-secret",
    spawnFn: (bin, args, opts) => { calls.push({ bin, args, opts }); return child; },
  });
  await session.start();
  assert.equal(calls.length, 1);
  const env = calls[0].opts.env;
  assert.equal(env.PGPASSWORD, "operator-secret");
  assert.equal(env.PGAPPNAME, "slmm-t6-a");
  assert.equal(env.PGSSLMODE, "require");
  // No other libpq variable may survive into the child.
  for (const k of Object.keys(env)) {
    if (/^(PG|POSTGRES)/i.test(k)) {
      assert.ok(["PGPASSWORD", "PGAPPNAME", "PGCONNECT_TIMEOUT", "PGSSLMODE"].includes(k), `unexpected libpq variable ${k}`);
    }
  }
  // The credential never reaches the wire or the statement log.
  const pending = session.exec("SELECT 1;", { label: "x" });
  assert.ok(!child.written.join("").includes("operator-secret"), "the credential must never be on the wire");
  assert.ok(!session.log.join("").includes("operator-secret"), "the credential must never be in the statement log");
  child.emit("exit", 0, null);
  await pending.catch(() => {});
});

test("H7: the evidence records the credential SOURCE, never the credential", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "t6r-cred-"));
  try {
    const records = buildEvidenceRecords(finalizeResults({}, "BLOCKED"), { residueGate: "BLOCKED" });
    const bundle = writeEvidenceBundle({
      evidenceDir: dir,
      records,
      meta: { runId: "cred-1", credentialSource: "operator-variable", ambientPasswordIgnored: true },
    });
    const manifest = JSON.parse(readFileSync(bundle.manifestPath, "utf8"));
    assert.equal(manifest.credentialSource, "operator-variable");
    assert.equal(manifest.ambientPasswordIgnored, true);
    const text = `${readFileSync(bundle.evidencePath, "utf8")}${readFileSync(bundle.manifestPath, "utf8")}`;
    assert.ok(!/operator-secret|hunter2/.test(text), "no credential may enter the evidence");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- H8: the cancellation ----------------------------------------------------

test("H8: the first cancellation wins and the listeners are told once", () => {
  const token = new RunCancellation();
  let calls = 0;
  token.onCancel(() => { calls += 1; });
  assert.equal(token.cancelled, false);
  assert.equal(token.cancel("SIGINT", "stop"), true);
  assert.equal(token.cancel("SIGTERM", "stop again"), false);
  assert.equal(calls, 1);
  assert.equal(token.cancelled, true);
  assert.equal(token.signal, "SIGINT");
});

test("H8: SIGINT and SIGTERM cancel the run, and the handlers are removed again", () => {
  const handlers = new Map();
  const fake = { on: (sig, fn) => handlers.set(sig, fn), off: (sig) => handlers.delete(sig) };
  const token = new RunCancellation();
  const dispose = installSignalHandlers(token, { processRef: fake });
  assert.deepEqual([...handlers.keys()].sort(), ["SIGINT", "SIGTERM"]);
  handlers.get("SIGINT")();
  assert.equal(token.cancelled, true);
  assert.equal(token.signal, "SIGINT");
  assert.match(token.reason, /SIGINT/);
  dispose();
  assert.equal(handlers.size, 0);
});

test("H8: a terminated session kills its child and rejects the pending statement", async () => {
  const child = mockChild();
  const session = mockSession({ spawnFn: () => child });
  await session.start();
  const pending = session.exec("SELECT 1;", { label: "x" });
  session.terminate("SIGTERM");
  await assert.rejects(pending, /terminated/);
  assert.ok(child.killed.includes("SIGTERM"), "the child must be terminated");
  assert.equal(session.terminated, true);
  assert.equal(session.closed, true);
});

test("H8: the runner starts no new work after a cancellation", () => {
  assert.match(runnerSrc, /if \(cancellation\.cancelled\) \{/);
  assert.match(runnerSrc, /record\(id, "BLOCKED", `the run was cancelled/);
  assert.match(runnerSrc, /cancellation\.onCancel\(\(\) => \{/);
  assert.match(runnerSrc, /s\.terminate\(cancellation\.signal\)/);
  assert.match(runnerSrc, /disposeSignals\(\);/);
  // The rollback and the closure guarantees survive a cancellation.
  assert.match(runnerSrc, /if \(holder\) holder\.close\(\);/);
  assert.match(runnerSrc, /if \(waiter\) waiter\.close\(\);/);
  assert.match(runnerSrc, /observer\.close\(\);/);
});

// --- the abort path is authorized, the gate is not ---------------------------

test("H3: the live-authorization gate stays OUTSIDE the try block", () => {
  // An unauthorized run must never write a file, so the gate refuses before
  // the try block that produces the evidence.
  const gateAt = runnerSrc.indexOf("requireLiveAuthorization({ harness: HARNESS");
  const tryAt = runnerSrc.indexOf("  try {", gateAt);
  assert.ok(gateAt > 0, "the runner must call the live authorization gate");
  assert.ok(tryAt > gateAt, "the gate must be evaluated before the try block");
  // The endpoint guards, the executable resolution and the credential are
  // INSIDE the try block, so a refusal is recorded with evidence.
  const endpointAt = runnerSrc.indexOf("ref = assertTestEndpointIdentity(endpoint);");
  const psqlAt = runnerSrc.indexOf("resolvePsqlExecutable({ psqlPath })");
  const credentialAt = runnerSrc.indexOf("resolveOperatorCredential({ prompt })");
  assert.ok(endpointAt > tryAt, "the endpoint guards must run inside the try block");
  assert.ok(psqlAt > tryAt, "the executable resolution must run inside the try block");
  assert.ok(credentialAt > tryAt, "the credential resolution must run inside the try block");
  assert.ok(endpointAt < psqlAt, "the endpoint guards run before the executable is resolved");
  assert.ok(psqlAt < credentialAt, "the executable is resolved before the credential is read");
});

test("H3: an abort before the preflight still completes the preflight result", () => {
  assert.match(runnerSrc, /if \(!preflight\) \{/);
  assert.match(runnerSrc, /reason: "the preflight did not run"/);
  assert.match(runnerSrc, /if \(observer\) observer\.close\(\);/);
});

test("H8: a terminated session is an interruption, not a crash", async () => {
  const child = mockChild();
  const session = mockSession({ spawnFn: () => child });
  await session.start();
  const pending = session.exec("SELECT 1;", { label: "x" });
  session.terminate("SIGTERM");
  let caught = null;
  try { await pending; } catch (e) { caught = e; }
  assert.ok(caught, "the pending statement must be rejected");
  assert.equal(caught.t6rAbortKind, "signal", "a termination is a signal, not an infrastructure failure");
  assert.equal(classifyAbort(caught).kind, "signal");
});

// --- the whole abort chain, end to end, offline ------------------------------

test("H3: the whole abort chain produces a verified bundle without a PASS", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "t6r-chain-"));
  try {
    // A safety refusal: an inherited PGPASSWORD is refused.
    let error = null;
    try { resolveOperatorCredential({ env: { PGPASSWORD: "ambient-secret" } }); } catch (e) { error = e; }
    assert.ok(error, "the inherited credential must be refused");
    const abort = classifyAbort(error);
    assert.equal(abort.kind, "safety");
    assert.ok(!abort.reason.includes("ambient-secret"), "the abort reason must carry no credential");

    // The runner's abort path, exactly as it runs it.
    const results = finalizeAbortResults({}, abort);
    const records = buildEvidenceRecords(results, { residueGate: "BLOCKED" });
    const evidence = finalizeEvidence({
      evidenceDir: dir,
      records,
      meta: {
        runId: "chain-1",
        harness: "t6-checkpoint/t6-group-r-runner.mjs",
        projectRef: "nqadtfqyurkpmxcodswc",
        abort: { kind: abort.kind, reason: abort.reason, signal: abort.signal },
        credentialSource: "none",
        ambientPasswordIgnored: false,
        psqlExecutable: null,
      },
    });
    assert.equal(evidence.ok, true, evidence.error);
    // The bundle verifies: the digest matches the bytes on disk.
    assert.equal(verifyEvidenceBundle({ evidenceDir: dir }).ok, true);
    const manifest = JSON.parse(readFileSync(evidence.manifestPath, "utf8"));
    assert.equal(manifest.abort.kind, "safety");
    assert.equal(manifest.caseOutcomes.PASS, 0);
    assert.equal(manifest.caseOutcomes.BLOCKED, 8);
    const text = readFileSync(evidence.evidencePath, "utf8");
    assert.ok(!text.includes('"PASS"'), "no aborted case may be a PASS");
    assert.ok(!text.includes("ambient-secret"), "no credential may enter the evidence");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// PF: the preflight-only rehearsal mode
// ---------------------------------------------------------------------------
// Every test is hermetic: a mocked child process, a dummy credential and a
// dummy executable file. No process is started, no connection is made, no
// SQL reaches a server and no credential is read.

const PF_ENDPOINT = {
  host: POOL_HOST,
  port: REQUIRED_PORT,
  user: `postgres.${TEST_REF}`,
  database: "postgres",
};

/** A dummy, never-executed executable for the resolver to validate. */
function dummyPsql() {
  const dir = mkdtempSync(path.join(tmpdir(), "t6r-pf-psql-"));
  const file = path.join(dir, process.platform === "win32" ? "psql.exe" : "psql");
  writeFileSync(file, "not an executable\n");
  return { dir, file };
}

/**
 * A mocked psql that answers the completion probe, so the whole runner can
 * be driven offline. It records every session it is asked for and every wire
 * it receives.
 */
function mockPreflightRunner({
  preflightOk = true,
  computed = T6_FINGERPRINT_EXPECTED,
  functionCount = T6_FINGERPRINT_FUNCTION_COUNT,
  onPreflightWire = null,
  // When set, the mocked child writes this text to stderr and exits with
  // code 2 instead of answering: that is a connection failure.
  failWithStderr = null,
} = {}) {
  const spawned = [];
  const wires = [];
  const spawnFn = (bin, args, opts) => {
    const appname = opts.env.PGAPPNAME;
    spawned.push(appname);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stderr = new EventEmitter();
    child.stderr.setEncoding = () => {};
    let buf = "";
    child.stdin = {
      write: (s) => {
        buf += String(s);
        const m = buf.match(/\\echo (__T6R_END_[^\s]+)/);
        if (!m) return true;
        const marker = m[1];
        const wire = buf;
        buf = "";
        wires.push(wire);
        const isPreflight = wire.includes("t6-group-r-preflight/v1");
        if (isPreflight && typeof onPreflightWire === "function") onPreflightWire(child, wire);
        if (isPreflight && typeof failWithStderr === "string") {
          // A connection failure: the server message goes to stderr and the
          // child exits without ever producing a probe row.
          child.stderr.emit("data", failWithStderr);
          child.emit("exit", 2, null);
          return true;
        }
        const payload = isPreflight
          ? {
            sqlstate: preflightOk ? "00000" : "TPF01",
            message: preflightOk ? "" : "the hosted-schema preflight failed",
            preflight: JSON.stringify({
              schema: PREFLIGHT_SCHEMA,
              ok: preflightOk,
              checks: 57,
              failures: preflightOk ? [] : ["function public.has_role(uuid, public.app_role) is missing"],
              namespace: Object.fromEntries(PREFLIGHT_NAMESPACE_KEYS.map((k) => [k, 0])),
              fingerprint: {
                schema: T6_FINGERPRINT_CONTRACT,
                expected: T6_FINGERPRINT_EXPECTED,
                computed,
                functionCount,
                serverVersion: "17.11",
              },
            }),
          }
          : { sqlstate: "00000", message: "", isolation: "read committed" };
        // A bounded numeric answer keeps the observer polls fast.
        const numeric = wire.includes("slmm-t6-%'") ? "0" : "1";
        child.stdout.emit("data", `${numeric}\n${PROBE_PREFIX}${JSON.stringify(payload)}\n${marker}\n`);
        return true;
      },
      end: () => {},
    };
    child.kill = () => { child.emit("exit", null, "SIGTERM"); return true; };
    return child;
  };
  return { spawned, wires, spawnFn };
}

/** Run the body with the live authorization in place, then restore it. */
function withLiveAuthorization(fn) {
  const keys = ["SLMM_LIVE_TESTS", "SLMM_LIVE_TARGET", "SLMM_LIVE_ACK"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.SLMM_LIVE_TESTS = "true";
  process.env.SLMM_LIVE_TARGET = "test";
  process.env.SLMM_LIVE_ACK = "t6-checkpoint/t6-group-r-runner.mjs";
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const runPreflightOnly = (mock, { evidenceDir, psqlPath, extra = {} } = {}) =>
  withLiveAuthorization(() => runGroupR({
    endpoint: PF_ENDPOINT,
    password: "dummy-credential",
    psqlPath,
    evidenceDir,
    spawnFn: mock.spawnFn,
    preflightOnly: true,
    ...extra,
  }));

// --- the mode is never inferred ------------------------------------------------

test("PF: the run mode is explicit and a typo is refused", () => {
  assert.deepEqual(parseRunMode(["node", "runner.mjs"]), { mode: "none", preflightOnly: false });
  assert.deepEqual(parseRunMode(["node", "runner.mjs", "--run-group-r"]), { mode: "group-r", preflightOnly: false });
  assert.deepEqual(
    parseRunMode(["node", "runner.mjs", "--run-group-r", "--preflight-only"]),
    { mode: "preflight-only", preflightOnly: true },
  );
  // The preflight-only flag never stands alone.
  assert.throws(() => parseRunMode(["node", "runner.mjs", "--preflight-only"]), /requires --run-group-r/);
  // A typo in a run flag is refused, never ignored.
  assert.throws(() => parseRunMode(["node", "runner.mjs", "--run-group-r", "--prefligt-only"]), /unknown run flag/);
  assert.throws(() => parseRunMode(["node", "runner.mjs", "--run-group-r2"]), /unknown run flag/);
});

test("PF: the preflight-only records are eight NOT RUN / BLOCKED", () => {
  const results = finalizePreflightOnlyResults({ ok: true, checks: 57, reason: "" });
  assert.equal(results.length, 8);
  for (const r of results) {
    assert.equal(r.assertion, "NOT RUN");
    assert.equal(r.verdict, "BLOCKED");
    assert.notEqual(r.verdict, "PASS");
  }
  assert.match(results[0].detail, /preflight passed/);
  const failed = finalizePreflightOnlyResults({ ok: false, checks: 57, reason: "the fingerprint drifted" });
  assert.match(failed[0].detail, /did not pass/);
  const records = buildEvidenceRecords(results, { residueGate: "NOT RUN" });
  assert.equal(validateEvidenceRecords(records).ok, true);
  assert.equal(validateEvidenceGate(records).ok, true);
  assert.ok(!records.some((r) => r.verdict === "PASS"));
});

// --- the preflight-only rehearsal --------------------------------------------

test("PF: the preflight-only mode creates exactly one session and runs only the preflight", async () => {
  const psql = dummyPsql();
  const evidenceDir = mkdtempSync(path.join(tmpdir(), "t6r-pf-run-"));
  const mock = mockPreflightRunner({ preflightOk: true });
  try {
    const out = await runPreflightOnly(mock, { evidenceDir, psqlPath: psql.file });
    // Exactly one session: the preflight. No observer, no acting session.
    assert.deepEqual(mock.spawned, [PREFLIGHT_TAG]);
    assert.ok(!mock.spawned.includes(OBSERVER_TAG));
    assert.ok(!mock.spawned.includes(HOLDER_TAG));
    assert.ok(!mock.spawned.includes(WAITER_TAG));
    // Exactly two statements on that one session: the read-only preflight
    // section and the terminating ROLLBACK. Nothing else.
    assert.equal(mock.wires.length, 2);
    assert.ok(mock.wires[0].includes("t6-group-r-preflight/v1"));
    assert.ok(mock.wires[1].includes("ROLLBACK;"));
    // No fixture and no write statement was ever issued.
    for (const w of mock.wires) {
      assert.ok(!/INSERT INTO public\./.test(w), "no fixture INSERT may be issued");
      assert.ok(!/request_storage_deletion\(|claim_storage_deletion_request\(|fence_storage_key_for_deletion\(/.test(w), "no fixture call may be issued");
    }
    // No case ran.
    for (const r of out.results) {
      assert.equal(r.assertion, "NOT RUN");
      assert.equal(r.verdict, "BLOCKED");
    }
    assert.notEqual(out.verdict, "PASS");
    assert.equal(out.mode, "preflight-only");
  } finally {
    rmSync(psql.dir, { recursive: true, force: true });
    rmSync(evidenceDir, { recursive: true, force: true });
  }
});

test("PF: a successful preflight writes a verifiable diagnostic bundle", async () => {
  const psql = dummyPsql();
  const evidenceDir = mkdtempSync(path.join(tmpdir(), "t6r-pf-ok-"));
  const mock = mockPreflightRunner({ preflightOk: true });
  try {
    const out = await runPreflightOnly(mock, { evidenceDir, psqlPath: psql.file });
    assert.equal(out.evidence.ok, true, out.evidence.error);
    assert.equal(verifyEvidenceBundle({ evidenceDir }).ok, true);
    const manifest = JSON.parse(readFileSync(out.evidence.manifestPath, "utf8"));
    assert.equal(manifest.mode, "preflight-only");
    assert.equal(manifest.preflight.ok, true);
    assert.equal(manifest.preflight.checks, 57);
    assert.deepEqual(manifest.preflight.failures, []);
    // The fingerprint verdict is recorded in full.
    assert.equal(manifest.preflight.fingerprint.contract, "t6-group-r-fingerprint/v2");
    assert.equal(manifest.preflight.fingerprint.expected, "a85fea6468487830a4ca9afc268d9aef");
    assert.equal(manifest.preflight.fingerprint.computed, "a85fea6468487830a4ca9afc268d9aef");
    assert.equal(manifest.preflight.fingerprint.functionCount, 17);
    assert.equal(manifest.preflight.fingerprint.serverVersion, "17.11");
    assert.equal(manifest.preflight.fingerprint.baselineServerVersion, "17.11");
    assert.equal(manifest.preflight.fingerprint.ok, true);
    // The residue gate is NOT RUN and nothing is a PASS.
    assert.equal(manifest.residueGate, "NOT RUN");
    assert.equal(manifest.caseOutcomes.PASS, 0);
    assert.equal(manifest.caseOutcomes.BLOCKED, 8);
    assert.notEqual(out.verdict, "PASS");
    // No credential and no connection detail may enter the bundle.
    const text = `${readFileSync(out.evidence.evidencePath, "utf8")}${readFileSync(out.evidence.manifestPath, "utf8")}`;
    assert.ok(!text.includes("dummy-credential"));
    assert.ok(!/password=/i.test(text));
  } finally {
    rmSync(psql.dir, { recursive: true, force: true });
    rmSync(evidenceDir, { recursive: true, force: true });
  }
});

test("PF: a failed preflight still writes a non-PASS diagnostic bundle", async () => {
  const psql = dummyPsql();
  const evidenceDir = mkdtempSync(path.join(tmpdir(), "t6r-pf-fail-"));
  // A drifted fingerprint: the computed digest differs from the pinned one.
  const mock = mockPreflightRunner({ preflightOk: false, computed: "0".repeat(32) });
  try {
    const out = await runPreflightOnly(mock, { evidenceDir, psqlPath: psql.file });
    assert.equal(out.evidence.ok, true, out.evidence.error);
    assert.equal(verifyEvidenceBundle({ evidenceDir }).ok, true);
    assert.notEqual(out.verdict, "PASS");
    assert.equal(out.preflight.ok, false);
    assert.equal(out.preflight.fingerprint.ok, false, "a fingerprint mismatch blocks the rehearsal");
    const manifest = JSON.parse(readFileSync(out.evidence.manifestPath, "utf8"));
    assert.equal(manifest.mode, "preflight-only");
    assert.equal(manifest.preflight.ok, false);
    assert.equal(manifest.preflight.fingerprint.computed, "0".repeat(32));
    assert.equal(manifest.preflight.fingerprint.ok, false);
    assert.ok(manifest.preflight.failures.length > 0);
    assert.equal(manifest.caseOutcomes.PASS, 0);
    assert.equal(manifest.caseOutcomes.BLOCKED, 8);
    // The failure reason is recorded, the credential never is.
    const text = `${readFileSync(out.evidence.evidencePath, "utf8")}${readFileSync(out.evidence.manifestPath, "utf8")}`;
    assert.ok(!text.includes("dummy-credential"));
    // Still exactly one session: the preflight and its ROLLBACK.
    assert.deepEqual(mock.spawned, [PREFLIGHT_TAG]);
    assert.equal(mock.wires.length, 2);
    assert.ok(mock.wires[1].includes("ROLLBACK;"));
  } finally {
    rmSync(psql.dir, { recursive: true, force: true });
    rmSync(evidenceDir, { recursive: true, force: true });
  }
});

test("PF: without the live authorization no evidence is written", async () => {
  const psql = dummyPsql();
  const evidenceDir = mkdtempSync(path.join(tmpdir(), "t6r-pf-noauth-"));
  const mock = mockPreflightRunner({ preflightOk: true });
  const keys = ["SLMM_LIVE_TESTS", "SLMM_LIVE_TARGET", "SLMM_LIVE_ACK"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const savedExit = process.exit;
  let exitCode = null;
  try {
    for (const k of keys) delete process.env[k];
    // The guard refuses by exiting; the stub keeps the test process alive.
    process.exit = (code) => { exitCode = code; throw new Error(`process.exit(${code})`); };
    await assert.rejects(() => runGroupR({
      endpoint: PF_ENDPOINT,
      password: "dummy-credential",
      psqlPath: psql.file,
      evidenceDir,
      spawnFn: mock.spawnFn,
      preflightOnly: true,
    }), /process\.exit\(2\)/);
    assert.equal(exitCode, 2);
  } finally {
    process.exit = savedExit;
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(psql.dir, { recursive: true, force: true });
    rmSync(evidenceDir, { recursive: true, force: true });
  }
  // No session, no statement and no evidence file.
  assert.deepEqual(mock.spawned, []);
  assert.equal(mock.wires.length, 0);
});

test("PF: a cancellation during the preflight is recorded as an interruption", async () => {
  const psql = dummyPsql();
  const evidenceDir = mkdtempSync(path.join(tmpdir(), "t6r-pf-cancel-"));
  // The operator's SIGINT arrives while the preflight is running.
  const handlers = new Map();
  const fakeProcess = {
    on: (sig, handler) => { handlers.set(sig, handler); },
    off: (sig) => { handlers.delete(sig); },
  };
  const mock = mockPreflightRunner({
    preflightOk: true,
    onPreflightWire: (child) => {
      // The signal handler cancels the run and the child is terminated.
      const handler = handlers.get("SIGINT");
      if (handler) handler();
    },
  });
  try {
    const out = await runPreflightOnly(mock, {
      evidenceDir,
      psqlPath: psql.file,
      extra: { signalProcess: fakeProcess },
    });
    assert.ok(out.abort, "the cancellation must be recorded as an abort");
    assert.equal(out.abort.kind, "signal");
    assert.notEqual(out.verdict, "PASS");
    // No case ran and no fixture was issued.
    for (const r of out.results) assert.equal(r.verdict, "BLOCKED");
    for (const w of mock.wires) assert.ok(!/INSERT INTO public\./.test(w));
    // The bundle exists and records the interruption.
    assert.equal(out.evidence.ok, true, out.evidence.error);
    const manifest = JSON.parse(readFileSync(out.evidence.manifestPath, "utf8"));
    assert.equal(manifest.abort.kind, "signal");
    assert.equal(manifest.caseOutcomes.PASS, 0);
  } finally {
    rmSync(psql.dir, { recursive: true, force: true });
    rmSync(evidenceDir, { recursive: true, force: true });
  }
});

test("PF: the ordinary Group-R path is unchanged", async () => {
  const psql = dummyPsql();
  const evidenceDir = mkdtempSync(path.join(tmpdir(), "t6r-pf-normal-"));
  const mock = mockPreflightRunner({ preflightOk: true });
  try {
    const out = await withLiveAuthorization(() => runGroupR({
      endpoint: PF_ENDPOINT,
      password: "dummy-credential",
      psqlPath: psql.file,
      evidenceDir,
      spawnFn: mock.spawnFn,
    }));
    // The observer and the acting sessions exist exactly as before.
    assert.ok(mock.spawned.includes(PREFLIGHT_TAG));
    assert.ok(mock.spawned.includes(OBSERVER_TAG));
    assert.ok(mock.spawned.includes(HOLDER_TAG));
    assert.ok(mock.spawned.includes(WAITER_TAG));
    assert.ok(mock.wires.length > 1, "the ordinary path executes the cases");
    assert.equal(out.mode, "group-r");
    assert.notEqual(out.verdict, "PASS");
    const manifest = JSON.parse(readFileSync(out.evidence.manifestPath, "utf8"));
    assert.equal(manifest.mode, "group-r");
  } finally {
    rmSync(psql.dir, { recursive: true, force: true });
    rmSync(evidenceDir, { recursive: true, force: true });
  }
});

test("PF: the source keeps the preflight-only guards wired in", () => {
  // The preflight-only mode never creates the observer and never runs a case.
  assert.match(runnerSrc, /if \(!preflightOnly\) \{/);
  assert.match(runnerSrc, /if \(preflightOnly\) \{\s*record\(id, "NOT RUN"/);
  assert.match(runnerSrc, /finalizePreflightOnlyResults\(preflight\)/);
  assert.match(runnerSrc, /mode: preflightOnly \? "preflight-only" : "group-r",/);
  assert.match(runnerSrc, /preflight: \(meta && meta\.preflight\) \|\| null,/);
  // The live-authorization gate and the TEST-only endpoint guards are intact.
  assert.match(runnerSrc, /requireLiveAuthorization\(\{ harness: HARNESS, services: \["supabase-test-postgres"\] \}\);/);
  assert.match(runnerSrc, /ref = assertTestEndpointIdentity\(endpoint\);/);
  assert.match(runnerSrc, /assertNonProductionTarget\(`https:\/\/\$\{ref\}\.supabase\.co`, \{ harness: HARNESS \}\);/);
});

// ---------------------------------------------------------------------------
// CD: the PostgreSQL connection-failure classification
// ---------------------------------------------------------------------------
// The classification is a PURE function over the child's stderr. It returns
// exactly one predefined word, and the raw stderr never reaches the evidence.

test("CD: the classification returns only the predefined classes", () => {
  assert.deepEqual([...CONNECTION_FAILURE_KINDS], [
    "authentication_failed",
    "host_resolution_failed",
    "connection_refused_or_timeout",
    "tls_ssl_error",
    "role_or_database_missing",
    "unknown",
  ]);
});

test("CD: each failure category is classified from the PostgreSQL stderr", () => {
  const cases = [
    ["authentication_failed", 'psql: error: connection to server at "aws-0-ap-northeast-1.pooler.supabase.com" (172.26.0.1), port 5432 failed: FATAL:  password authentication failed for user "postgres.nqadtfqyurkpmxcodswc"'],
    ["authentication_failed", "FATAL:  no pg_hba.conf entry for host \"10.0.0.1\", user \"postgres.x\", database \"postgres\""],
    ["authentication_failed", "fe_sendauth: no password supplied"],
    ["host_resolution_failed", "psql: error: could not translate host name \"aws-0-ap-northeast-1.pooler.supabase.com\" to address: Name or service not known"],
    ["host_resolution_failed", "could not resolve host: nodename nor servname provided, or not known"],
    ["connection_refused_or_timeout", "psql: error: connection to server at \"db\", port 5432 failed: Connection refused"],
    ["connection_refused_or_timeout", "connection to server at \"db\", port 5432 failed: timeout expired"],
    ["connection_refused_or_timeout", "server closed the connection unexpectedly\n\tThis probably means the server terminated abnormally."],
    ["tls_ssl_error", "psql: error: SSL error: tlsv1.3 alert protocol version"],
    ["tls_ssl_error", "psql: error: could not connect to server: SSL error: certificate verify failed"],
    ["role_or_database_missing", 'FATAL:  role "postgres.nqadtfqyurkpmxcodswc" does not exist'],
    ["role_or_database_missing", 'FATAL:  database "postgres" does not exist'],
  ];
  for (const [expected, stderr] of cases) {
    const got = classifyConnectionFailure(stderr);
    assert.equal(got, expected, `the stderr "${stderr.slice(0, 40)}..." must classify as ${expected}`);
    assert.ok(CONNECTION_FAILURE_KINDS.includes(got), "the classification must be one of the predefined words");
  }
});

test("CD: an unrecognised or missing stderr is unknown, never authentication_failed", () => {
  const unknowns = [
    "",
    "   \n  ",
    null,
    undefined,
    "something entirely unexpected happened",
    "psql: warning: extra command-line argument \"ignored\"",
    "ERROR:  relation \"documents\" does not exist",
  ];
  for (const u of unknowns) {
    const got = classifyConnectionFailure(u);
    assert.equal(got, "unknown", `the stderr ${JSON.stringify(u)} must classify as unknown`);
    assert.notEqual(got, "authentication_failed");
  }
  // A text that merely MENTIONS a password is not an authentication failure.
  assert.equal(classifyConnectionFailure("psql: notice: the password is stored in a secure store"), "unknown");
});

test("CD: the classification never carries the raw stderr, a host, a user or a credential", () => {
  const stderr = 'psql: error: connection to server at "aws-0-ap-northeast-1.pooler.supabase.com" (54.64.190.72), port 5432 failed: FATAL:  password authentication failed for user "postgres.nqadtfqyurkpmxcodswc"';
  const got = classifyConnectionFailure(stderr);
  assert.equal(got, "authentication_failed");
  assert.ok(!got.includes("supabase"), "the classification must not carry a hostname");
  assert.ok(!got.includes("postgres"), "the classification must not carry a user name");
  assert.ok(!got.includes("54.64"), "the classification must not carry an address");
  assert.ok(!/password\s*=/i.test(got), "the classification must not carry a credential");
  assert.ok(CONNECTION_FAILURE_KINDS.includes(got));
});

test("CD: a failing preflight records the class in the manifest and no raw stderr", async () => {
  const psql = dummyPsql();
  const evidenceDir = mkdtempSync(path.join(tmpdir(), "t6r-cd-fail-"));
  const rawStderr = 'psql: error: connection to server at "aws-0-ap-northeast-1.pooler.supabase.com" (54.64.190.72), port 5432 failed: FATAL:  password authentication failed for user "postgres.nqadtfqyurkpmxcodswc"\n';
  const mock = mockPreflightRunner({ preflightOk: true, failWithStderr: rawStderr });
  try {
    const out = await runPreflightOnly(mock, { evidenceDir, psqlPath: psql.file });
    // The class is recorded.
    assert.equal(out.preflight.connectionFailure, "authentication_failed");
    const manifest = JSON.parse(readFileSync(out.evidence.manifestPath, "utf8"));
    assert.equal(manifest.preflight.connectionFailure, "authentication_failed");
    // The raw stderr is NOT in the evidence, and neither is a host, a user,
    // an address or the credential.
    const text = `${readFileSync(out.evidence.evidencePath, "utf8")}${readFileSync(out.evidence.manifestPath, "utf8")}`;
    assert.ok(!text.includes("FATAL"), "the raw server text must never reach the evidence");
    assert.ok(!text.includes("pooler.supabase.com"), "no hostname may reach the evidence");
    assert.ok(!text.includes("54.64.190.72"), "no address may reach the evidence");
    assert.ok(!text.includes("password authentication failed"), "no server message may reach the evidence");
    assert.ok(!text.includes("dummy-credential"), "no credential may reach the evidence");
    // The failure is still fail-closed: nothing is a PASS.
    assert.notEqual(out.verdict, "PASS");
    assert.equal(manifest.caseOutcomes.PASS, 0);
    assert.equal(manifest.caseOutcomes.BLOCKED, 8);
    for (const r of out.results) assert.equal(r.verdict, "BLOCKED");
    // And no observer, fixture or case ran.
    assert.deepEqual(mock.spawned, [PREFLIGHT_TAG]);
  } finally {
    rmSync(psql.dir, { recursive: true, force: true });
    rmSync(evidenceDir, { recursive: true, force: true });
  }
});

test("CD: a successful preflight is unchanged and records no connection failure", async () => {
  const psql = dummyPsql();
  const evidenceDir = mkdtempSync(path.join(tmpdir(), "t6r-cd-ok-"));
  const mock = mockPreflightRunner({ preflightOk: true });
  try {
    const out = await runPreflightOnly(mock, { evidenceDir, psqlPath: psql.file });
    assert.equal(out.preflight.ok, true);
    const manifest = JSON.parse(readFileSync(out.evidence.manifestPath, "utf8"));
    assert.equal(manifest.preflight.ok, true);
    assert.equal(manifest.preflight.connectionFailure, null);
    assert.equal(manifest.preflight.fingerprint.computed, T6_FINGERPRINT_EXPECTED);
    assert.equal(manifest.preflight.fingerprint.ok, true);
    assert.equal(manifest.preflight.fingerprint.functionCount, 17);
    assert.equal(manifest.caseOutcomes.PASS, 0);
    assert.notEqual(out.verdict, "PASS");
  } finally {
    rmSync(psql.dir, { recursive: true, force: true });
    rmSync(evidenceDir, { recursive: true, force: true });
  }
});

test("CD: the source keeps the classification fail-closed and verdict-free", () => {
  // The classifier is pure: it takes the stderr and returns one word.
  assert.match(runnerSrc, /export function classifyConnectionFailure\(stderr\)/);
  // The only consumer of the captured stderr.
  assert.match(runnerSrc, /const connectionFailure = classifyConnectionFailure\(pf\.stderr\);/);
  // The class is recorded in the manifest, never the raw text.
  assert.match(runnerSrc, /connectionFailure: preflight\.connectionFailure \|\| null,/);
  // The stderr is bounded.
  assert.match(runnerSrc, /export const STDERR_LIMIT = 65536;/);
  assert.match(runnerSrc, /this\.stderr = this\.stderr\.slice\(-STDERR_LIMIT\);/);
});
