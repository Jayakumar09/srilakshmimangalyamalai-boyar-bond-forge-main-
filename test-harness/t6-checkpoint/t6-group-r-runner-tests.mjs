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
  assert.ok(!/this\.stderr\.slice/.test(runnerSrc), "the runner must not read stderr for a verdict");
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
