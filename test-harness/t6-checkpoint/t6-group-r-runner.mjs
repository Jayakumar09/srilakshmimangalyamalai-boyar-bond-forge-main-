// test-harness/t6-checkpoint/t6-group-r-runner.mjs
// ---------------------------------------------------------------------------
// T6 Group-R runner -- Supabase TEST only. ZERO-COMMIT, rollback-only.
//
// Implements the eight Group-R cases of the T6 case matrix
// (test-harness/t6-checkpoint/t6-case-matrix.json, environment "R"):
//
//   T6-R01  documents reference INSERT waits for an in-flight fence, then
//            succeeds after the fence ROLLBACK
//   T6-R02  the same serialisation for a second source (payments.proof_key)
//   T6-R03  the fence waits for an in-flight reference writer and re-checks
//            freshly, returning 'fenced'
//   T6-R04  lock_timeout produces a bounded, fail-closed wait (55P03)
//   T6-R05  two sessions creating a request for the same fresh key serialise
//            on the per-key advisory lock
//   T6-R06  zero-commit enforcement (statement allowlist)
//   T6-R07  no open transactions or retained advisory locks after all cases
//   T6-R08  post-rollback zero-residue check over the ten relations
//
// ERROR PROTOCOL (why nothing here reads stderr)
//   psql writes successful statements to STDOUT and errors to STDERR. Those
//   are two different pipes whose events are NOT ordered relative to each
//   other, so a runner that reads stderr after the stdout completion marker
//   can miss an error entirely: a late 23514 chunk can arrive after the
//   marker and be discarded, and the failed statement then looks successful.
//
//   This runner therefore never inspects stderr for correctness. Every
//   statement is sent as:
//
//       <reset>            clears the t6r.* result settings
//       <statement>        the harness section
//       <probe>            a SELECT that republishes the t6r.* settings
//       \echo <end marker> the completion marker
//
//   The probe and the completion marker travel on the SAME ordered stdout
//   stream, so their relative order is guaranteed. Every harness case body
//   is a DO block whose EXCEPTION handler captures the SQLSTATE and the
//   message into the t6r.* settings, so the failure travels back to the
//   runner on that same ordered stream. A statement that fails without
//   catching aborts the transaction, the probe then produces NO row, and the
//   runner treats the missing probe exactly like a failure. A disconnected
//   session produces no completion marker at all and is likewise a failure.
//
//   A successful RAISE NOTICE is not a failure: it never aborts the
//   transaction and never changes the captured SQLSTATE.
//
// SAFETY ARCHITECTURE
//   * The target is pinned to the Supabase TEST project. The production
//     project, an empty configuration, a localhost fallback, the local
//     disposable-lab port and the transaction-mode pooler (6543) are all
//     refused BEFORE any process is started.
//   * Three independently connected psql sessions: holder, waiter and a
//     READ ONLY observer. Each is its own connection, its own transaction.
//   * Every session ends with ROLLBACK. A COMMIT anywhere is a hard failure
//     of the whole case set (R06).
//   * The runner never reads an environment file and never embeds a
//     credential. The password is supplied by the operator at run time.
//
// IMPORT SAFETY
//   This module has NO top-level side effects. Everything below is either a
//   pure function or an explicitly invoked runner, so the offline unit tests
//   (t6-group-r-runner-tests.mjs) can import it without touching a database.
//
// Usage (requires a separate execution approval):
//   node test-harness/t6-checkpoint/t6-group-r-runner.mjs --run-group-r
// ---------------------------------------------------------------------------
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync,
  existsSync, openSync, closeSync, fsyncSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SUPABASE_PROJECT_REFS, requireLiveAuthorization, assertNonProductionTarget } from "../live-guard.mjs";

const HARNESS = "t6-checkpoint/t6-group-r-runner.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const HARNESS_SQL = path.join(HERE, "t6-group-r-harness.sql");

// --- the fixed, non-overridable target shape ---------------------------------
export const REQUIRED_PORT = 5432; // session-mode pooler
export const TRANSACTION_POOLER_PORT = 6543; // refused: no session semantics
export const LOCAL_LAB_PORT = 15432; // refused: the disposable local lab
export const REQUIRED_DATABASE = "postgres";

// --- the synthetic T6 namespace (never real users) -------------------------
export const T6_OWNER = "5d8f1c62-9a37-4e0b-b1f4-7c0e2a6d9f41";
export const T6_OTHER = "9a4b7e20-6c15-4d38-82fa-1e5b9c07d3aa";
export const T6_ADMIN = "c3f7b518-2e64-4a90-b7d5-84f2e6a10c79";
export const T6_KEY_PREFIX = `${T6_OWNER}/t6/`;
export const HOLDER_TAG = "slmm-t6-a";
export const WAITER_TAG = "slmm-t6-b";
export const OBSERVER_TAG = "slmm-t6-obs";
// The preflight gets its OWN session and its OWN bounded READ ONLY
// transaction, so it can never be confused with the observer or with an
// acting session, and it is closed before the residue measurement.
export const PREFLIGHT_TAG = "slmm-t6-pf";

// ---------------------------------------------------------------------------
// The pinned T6 function-definition fingerprint
// ---------------------------------------------------------------------------
// The contract (T6-specific, version-stable):
//
//   md5( jsonb_build_object('schema', 't6-group-r-fingerprint/v2',
//                           'functions', <jsonb_agg> )::text )
//
// where <jsonb_agg> aggregates, ORDER BY proname, one object per CONTRACT
// function, each contributing exactly these ten catalog-derived fields:
//   name      proname
//   args      oidvectortypes(proargtypes)
//   returns   format_type(prorettype, NULL)
//   setof     proretset
//   secdef    prosecdef
//   volatile  provolatile
//   parallel  proparallel
//   leakproof proleakproof
//   owner     pg_get_userbyid(proowner)
//   body_md5  md5(prosrc)
//
// The expected digest was OBSERVED on Supabase TEST (PostgreSQL 17.11) and
// independently reproduced from that capture; it is pinned as the expected
// baseline. PostgreSQL 17.11 is recorded as the OBSERVED baseline version but
// is NOT a blocking condition: the digest and the other contracts decide.
//
// The v1 fingerprint (which mixes in pg_get_functiondef, a per-server-version
// rendering) is kept for historical reference only and is never asserted.
export const T6_FINGERPRINT_CONTRACT = "t6-group-r-fingerprint/v2";
export const T6_FINGERPRINT_EXPECTED = "a85fea6468487830a4ca9afc268d9aef";
export const T6_FINGERPRINT_SERVER_VERSION = "17.11";
export const T6_FINGERPRINT_FUNCTION_COUNT = 17;
export const T6_FINGERPRINT_FIELDS = Object.freeze([
  "name", "args", "returns", "setof", "secdef", "volatile", "parallel", "leakproof", "owner", "body_md5",
]);

// jsonb orders object keys by length, then bytewise.
const jsonbKeyOrder = (keys) => [...keys].sort((a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0));
const RAW_JSON = Symbol("raw-json");
const jsonbValue = (v) => {
  if (v && typeof v === "object" && v[RAW_JSON] !== undefined) return v[RAW_JSON];
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return String(v);
  return JSON.stringify(String(v));
};
const jsonbObject = (pairs) => {
  const ordered = jsonbKeyOrder(pairs.map(([k]) => k)).map((k) => pairs.find(([kk]) => kk === k));
  return `{${ordered.map(([k, v]) => `${JSON.stringify(k)}: ${jsonbValue(v)}`).join(", ")}}`;
};

/**
 * Independently compute the v2 fingerprint from the captured catalog
 * material, using the exact PostgreSQL jsonb serialisation and md5 contract
 * verified against the hosted TEST capture. Returns null when the material is
 * absent or incomplete -- the caller then fails closed.
 */
export function computeT6Fingerprint(functions = []) {
  if (!Array.isArray(functions) || functions.length === 0) return null;
  for (const f of functions) {
    if (!f || typeof f.name !== "string" || !f.name) return null;
    for (const k of T6_FINGERPRINT_FIELDS) {
      if (f[k] === undefined || f[k] === null) return null;
    }
  }
  const ordered = [...functions].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const objects = ordered.map((f) => jsonbObject(T6_FINGERPRINT_FIELDS.map((k) => [k, f[k]])));
  const canonical = jsonbObject([
    ["schema", T6_FINGERPRINT_CONTRACT],
    ["functions", { [RAW_JSON]: `[${objects.join(", ")}]` }],
  ]);
  return createHash("md5").update(Buffer.from(canonical, "utf8")).digest("hex");
}

/**
 * Evaluate the fingerprint the preflight published. FAIL CLOSED: a missing
 * function, a changed body or checked attribute, a digest that differs, a
 * digest that cannot be calculated, and a missing or malformed digest are all
 * failures. A PostgreSQL version difference alone is NOT a failure.
 */
export function evaluateT6Fingerprint(fingerprint = {}) {
  const problems = [];
  const fp = fingerprint && typeof fingerprint === "object" ? fingerprint : {};
  if (fp.schema !== T6_FINGERPRINT_CONTRACT) {
    problems.push(`the fingerprint contract is "${fp.schema ?? "<missing>"}", expected "${T6_FINGERPRINT_CONTRACT}"`);
  }
  if (fp.functionCount !== T6_FINGERPRINT_FUNCTION_COUNT) {
    problems.push(`the fingerprint set holds ${fp.functionCount ?? "<missing>"} functions, expected ${T6_FINGERPRINT_FUNCTION_COUNT}`);
  }
  if (typeof fp.computed !== "string" || !/^[0-9a-f]{32}$/.test(fp.computed)) {
    problems.push("the fingerprint digest is missing or malformed");
  } else if (fp.computed !== T6_FINGERPRINT_EXPECTED) {
    problems.push(`the T6 fingerprint drifted: expected ${T6_FINGERPRINT_EXPECTED}, computed ${fp.computed}`);
  }
  if (fp.expected !== T6_FINGERPRINT_EXPECTED) {
    problems.push(`the preflight's expected digest is "${fp.expected ?? "<missing>"}", expected ${T6_FINGERPRINT_EXPECTED}`);
  }
  return {
    ok: problems.length === 0,
    problems,
    expected: T6_FINGERPRINT_EXPECTED,
    computed: typeof fp.computed === "string" ? fp.computed : null,
    serverVersion: typeof fp.serverVersion === "string" ? fp.serverVersion : null,
  };
}

// ---------------------------------------------------------------------------
// Endpoint identity guards (pure)
// ---------------------------------------------------------------------------

/** Is this host a loopback / local fallback? */
export function isLoopbackHost(host) {
  const h = String(host || "").trim().toLowerCase();
  if (!h) return true;
  if (h === "localhost" || h === "::1" || h === "0.0.0.0") return true;
  if (/^127\./.test(h)) return true;
  // A bare IP address can never be a Supabase project host.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  if (h.startsWith("[") && /^\[?::1\]?$/.test(h)) return true;
  return false;
}

/**
 * Is this a Supabase-managed host shape?
 * The project API host is <ref>.supabase.co, the direct database host is
 * db.<ref>.supabase.co, and the pooler host is
 * aws-0-<region>.pooler.supabase.com. All of them end in a supabase domain.
 */
export function isSupabaseHost(host) {
  const h = String(host || "").trim().toLowerCase();
  return /^[a-z0-9.-]+\.supabase\.(co|com)$/.test(h);
}

/**
 * Extract the Supabase project ref a connection endpoint identifies.
 * The direct host is db.<ref>.supabase.co; the session pooler carries the ref
 * in the user name (postgres.<ref>). Returns null when the endpoint
 * identifies no project at all.
 */
export function projectRefFromEndpoint({ host, user } = {}) {
  const h = String(host || "").trim().toLowerCase();
  const m1 = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(h);
  if (m1) return m1[1];
  const m2 = /^postgres\.([a-z0-9]{20})$/.exec(String(user || "").trim().toLowerCase());
  if (m2) return m2[1];
  return null;
}

/**
 * Refuse anything that is not the approved Supabase TEST session pooler.
 * Throws with an explicit reason. Returns the resolved TEST project ref.
 */
export function assertTestEndpointIdentity(endpoint = {}) {
  const host = String(endpoint.host || "").trim();
  const user = String(endpoint.user || "").trim();
  const database = String(endpoint.database || "").trim();
  const port = Number(endpoint.port);

  if (!host || !user || !database || !Number.isInteger(port) || port <= 0) {
    throw new Error("T6-R: refusing an empty connection configuration");
  }
  const all = `${host}|${user}|${database}`;
  if (all.includes(SUPABASE_PROJECT_REFS.prod)) {
    throw new Error("T6-R: refusing the production project");
  }
  if (isLoopbackHost(host)) {
    throw new Error("T6-R: refusing a localhost fallback");
  }
  if (!isSupabaseHost(host)) {
    throw new Error("T6-R: refusing a host that is not a Supabase project host");
  }
  if (port === TRANSACTION_POOLER_PORT) {
    throw new Error("T6-R: refusing the transaction-mode pooler (6543); session mode is required");
  }
  if (port === LOCAL_LAB_PORT) {
    throw new Error("T6-R: refusing the local disposable-lab port");
  }
  if (port !== REQUIRED_PORT) {
    throw new Error(`T6-R: unexpected port ${port}; the TEST session pooler is ${REQUIRED_PORT}`);
  }
  if (database !== REQUIRED_DATABASE) {
    throw new Error(`T6-R: unexpected database ${database}`);
  }
  // The ref may come from the direct host or from the pooler user. When both
  // carry one they must agree, otherwise the endpoint is ambiguous and is
  // refused rather than resolved in the operator's favour.
  const hostRef = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(host.toLowerCase());
  const userRef = /^postgres\.([a-z0-9]{20})$/.exec(user.toLowerCase());
  if (hostRef && userRef && hostRef[1] !== userRef[1]) {
    throw new Error("T6-R: the endpoint host and user name identify different projects");
  }
  const ref = projectRefFromEndpoint({ host, user });
  if (!ref) {
    throw new Error("T6-R: the endpoint does not identify a Supabase project");
  }
  if (ref !== SUPABASE_PROJECT_REFS.test) {
    throw new Error("T6-R: refusing a non-TEST project");
  }
  return ref;
}

// ---------------------------------------------------------------------------
// R06 -- the zero-commit statement allowlist (pure)
// ---------------------------------------------------------------------------

// Exactly the statement kinds the matrix allows: BEGIN/SET/SELECT/INSERT/
// UPDATE/DELETE/DO/ROLLBACK. The runner's own reset/probe statements are
// SELECT/DO, and its completion marker is a psql meta-command, not a
// statement.
export const ALLOWED_STATEMENT_VERBS = Object.freeze([
  "BEGIN", "SET", "SELECT", "INSERT", "UPDATE", "DELETE", "DO", "ROLLBACK",
]);
export const FORBIDDEN_STATEMENT_VERBS = Object.freeze(["COMMIT", "END", "ABORT"]);

/** Strip comments, dollar-quoted bodies and quoted literals. */
export function stripSqlNoise(stmt) {
  return String(stmt || "")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    // Any dollar-quoted body ($tag$ ... $tag$), so a PL/pgSQL "END IF" is not
    // mistaken for a transaction terminator. Dollar-quoted bodies are removed
    // BEFORE quoted literals, so a stray apostrophe inside a body can never
    // unbalance the literal scan.
    .replace(/\$[A-Za-z_][A-Za-z0-9_]*\$[\s\S]*?\$[A-Za-z_][A-Za-z0-9_]*\$/g, " $$ ")
    .replace(/\$\$[\s\S]*?\$\$/g, " $$ ")
    .replace(/'(?:[^']|'')*'/g, "''");
}

/** The leading SQL verb of a statement, upper-cased. */
export function statementVerb(stmt) {
  const s = stripSqlNoise(stmt).trim();
  const first = s.split(/[\s;(]/)[0] || "";
  return first.toUpperCase();
}

/**
 * Does the statement contain a transaction terminator anywhere?
 * A terminator may be trailed onto an otherwise permitted statement, so the
 * whole statement is scanned, not only its leading verb.
 */
export function containsTerminator(stmt) {
  const s = stripSqlNoise(stmt);
  for (const v of FORBIDDEN_STATEMENT_VERBS) {
    if (new RegExp(`\\b${v}\\b`, "i").test(s)) return v;
  }
  return null;
}

/**
 * Scan arbitrary SQL text (a whole script) for transaction terminators.
 * Returns the list of terminator keywords found. Comments, string literals and
 * dollar-quoted bodies are ignored, so a PL/pgSQL "END IF" is not a hit.
 */
export function findTerminators(text) {
  const s = stripSqlNoise(text);
  const found = [];
  for (const v of FORBIDDEN_STATEMENT_VERBS) {
    const re = new RegExp(`\\b${v}\\b`, "gi");
    const m = s.match(re);
    if (m) found.push(...m);
  }
  return found;
}

/** Is this statement permitted by the R06 allowlist? */
export function isAllowedStatement(stmt) {
  if (containsTerminator(stmt)) return false;
  const verb = statementVerb(stmt);
  if (!verb) return false;
  return ALLOWED_STATEMENT_VERBS.includes(verb);
}

/**
 * Audit a whole session log. Returns the offending statements.
 * Any COMMIT anywhere is an immediate case-set FAIL.
 */
export function auditStatementLog(statements) {
  const violations = [];
  for (const s of statements || []) {
    if (!isAllowedStatement(s)) violations.push(s);
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Harness section parsing (pure)
// ---------------------------------------------------------------------------

const SECTION_MARKER = /^--\s*>>>\s*SECTION:\s*([A-Za-z0-9_.-]+)\s*$/gm;

/**
 * Split the harness SQL into its labelled sections.
 * Returns a Map of section name -> SQL text.
 */
export function parseHarnessSections(text) {
  const out = new Map();
  const src = String(text || "");
  const marks = [...src.matchAll(SECTION_MARKER)];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index + marks[i][0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : src.length;
    out.set(marks[i][1], src.slice(start, end).trim());
  }
  return out;
}

/** The sections the runner requires. A missing one is a hard error. */
export const REQUIRED_SECTIONS = Object.freeze([
  "preflight.schema",
  "prelude.authenticated", "prelude.service_role", "prelude.observer",
  "prelude.isolation_check",
  "escalate.service_role", "escalate.authenticated",
  "poll.granted_a", "poll.granted_b", "poll.waiting_a", "poll.waiting_b",
  "poll.t6_backends",
  "a.create_request", "a.claim_fence", "b.insert_document", "b.insert_payment",
  "b.insert_document_first", "b.set_short_lock_timeout",
  "r07.hygiene", "r08.residue", "rollback",
]);

/** Which required sections are missing from the parsed harness? */
export function missingHarnessSections(sections) {
  const have = sections instanceof Map ? sections : new Map(Object.entries(sections || {}));
  return REQUIRED_SECTIONS.filter((s) => !have.has(s) || !String(have.get(s)).trim());
}

// ---------------------------------------------------------------------------
// The strict JSON contracts (pure) -- one exact contract, never a default
// ---------------------------------------------------------------------------

export const RESIDUE_RELATIONS = Object.freeze([
  "storage_deletion_requests", "storage_deletion_fences", "documents", "profiles",
  "user_roles", "payments", "jathagam_requests", "support_threads",
  "support_messages", "payment_events",
]);

// THE contract between the harness SQL and the runner for the session / lock
// counters. The harness publishes exactly these three keys; the runner accepts
// exactly these three keys. Anything else -- a missing key, a null, a
// non-numeric value, an unknown extra key -- is NOT clean. A counter is never
// silently defaulted to zero.
export const HYGIENE_KEYS = Object.freeze(["backends", "openXacts", "advisoryLocks"]);

/**
 * Parse the hygiene payload published by r07.hygiene / r08.residue.
 * Returns { valid, clean, values, problems }. `clean` is true only when the
 * payload is exactly the contract AND every counter is zero.
 */
export function parseHygiene(raw) {
  const problems = [];
  const values = {};
  let obj = null;
  if (typeof raw !== "string" || !raw.trim()) {
    problems.push("the hygiene payload is missing");
  } else {
    try {
      obj = JSON.parse(raw);
    } catch {
      problems.push("the hygiene payload is not valid JSON");
    }
  }
  if (obj !== null) {
    if (typeof obj !== "object" || Array.isArray(obj)) {
      problems.push("the hygiene payload is not a JSON object");
    } else {
      for (const k of Object.keys(obj)) {
        if (!HYGIENE_KEYS.includes(k)) problems.push(`unknown hygiene counter "${k}"`);
      }
      for (const k of HYGIENE_KEYS) {
        const v = obj[k];
        if (v === undefined || v === null) {
          problems.push(`the hygiene counter "${k}" is missing`);
          continue;
        }
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
          problems.push(`the hygiene counter "${k}" is not a non-negative integer`);
          continue;
        }
        values[k] = v;
      }
    }
  }
  const valid = problems.length === 0;
  const clean = valid && HYGIENE_KEYS.every((k) => values[k] === 0);
  return { valid, clean, values, problems };
}

/**
 * Parse the residue payload published by r08.residue. The ten relation
 * counters must all be present and numeric; anything else is invalid.
 */
export function parseResidue(raw) {
  const problems = [];
  const counts = {};
  let obj = null;
  if (typeof raw !== "string" || !raw.trim()) {
    problems.push("the residue payload is missing");
  } else {
    try {
      obj = JSON.parse(raw);
    } catch {
      problems.push("the residue payload is not valid JSON");
    }
  }
  if (obj !== null) {
    if (typeof obj !== "object" || Array.isArray(obj)) {
      problems.push("the residue payload is not a JSON object");
    } else {
      for (const k of Object.keys(obj)) {
        if (!RESIDUE_RELATIONS.includes(k)) problems.push(`unknown relation counter "${k}"`);
      }
      for (const r of RESIDUE_RELATIONS) {
        const v = obj[r];
        if (v === undefined || v === null) {
          problems.push(`the relation counter "${r}" is missing`);
          continue;
        }
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
          problems.push(`the relation counter "${r}" is not a non-negative integer`);
          continue;
        }
        counts[r] = v;
      }
    }
  }
  return { valid: problems.length === 0, counts, problems };
}

/**
 * Turn the ten relation counts plus the session/lock counts into a verdict.
 * Fail closed: a missing, unknown or malformed counter is never a zero, and
 * anything nonzero is never a PASS.
 */
export function summarizeResidue(counts = {}, sessions = {}) {
  const problems = [];
  const relationCounts = {};
  for (const k of Object.keys(counts || {})) {
    if (!RESIDUE_RELATIONS.includes(k)) problems.push(`unknown relation counter "${k}"`);
  }
  for (const r of RESIDUE_RELATIONS) {
    const v = counts ? counts[r] : undefined;
    if (v === undefined || v === null) {
      problems.push(`the relation counter "${r}" is missing`);
      continue;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) {
      problems.push(`the relation counter "${r}" is not a non-negative integer`);
      continue;
    }
    relationCounts[r] = n;
  }
  const sessionCounts = {};
  for (const k of HYGIENE_KEYS) {
    const v = sessions ? sessions[k] : undefined;
    if (v === undefined || v === null) {
      problems.push(`the session counter "${k}" is missing`);
      continue;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) {
      problems.push(`the session counter "${k}" is not a non-negative integer`);
      continue;
    }
    sessionCounts[k] = n;
  }
  const nonzero = Object.entries(relationCounts)
    .filter(([, n]) => n !== 0)
    .map(([relation, count]) => ({ relation, count }));
  const clean =
    problems.length === 0 &&
    nonzero.length === 0 &&
    HYGIENE_KEYS.every((k) => sessionCounts[k] === 0);
  return { clean, valid: problems.length === 0, nonzero, problems, counts: relationCounts, sessions: sessionCounts };
}

/** The matrix requires EXACTLY ONE waiter for the holder's key lock. */
export function isSingleWaiter(count) {
  return Number(count) === 1;
}

// ---------------------------------------------------------------------------
// SQLSTATE classification (pure)
// ---------------------------------------------------------------------------

/**
 * Classify a captured SQLSTATE against the T6 matrix.
 *
 *   55P03  lock_not_available -- in R01/R02/R03/R05 a bounded wait that ends
 *           in a timeout is a SYNC FAILURE and is BLOCKED. In R04 it is the
 *           EXPECTED bounded-wait outcome the matrix names in its pass
 *           clause, so the caller promotes it there and only there.
 *   40P01  deadlock_detected -- always a FAIL.
 *   23514  check_violation -- the storage-fence trigger and the payments
 *           method CHECK share this code. They are told apart by their
 *           messages (the fence says "Storage key is fenced for deletion.",
 *           the payments CHECK names payments_method_allowed), never by the
 *           code alone and never by guesswork.
 *   other  never a PASS.
 *
 * Returns { outcome, kind, reason } where outcome is FAIL or BLOCKED.
 */
export function classifySqlFailure({ sqlstate = "", message = "", label = "" } = {}) {
  const st = String(sqlstate || "").trim().toUpperCase();
  const msg = String(message || "");
  const ctx = String(label || "");
  if (!st || st === "00000") return { outcome: "NONE", kind: "none", reason: "no failure" };
  if (st === "TPF01") {
    return {
      outcome: "BLOCKED",
      kind: "preflight",
      reason: `the hosted-schema preflight failed at ${ctx}: ${msg}`,
    };
  }
  if (st === "40P01") {
    return { outcome: "FAIL", kind: "deadlock", reason: `a deadlock (40P01) was reported at ${ctx}` };
  }
  if (st === "55P03") {
    return {
      outcome: "BLOCKED",
      kind: "lock_timeout",
      reason: `the wait ended in lock_not_available (55P03) at ${ctx}: the lock was not released in time`,
    };
  }
  if (st === "23514") {
    if (/fenced for deletion|storage key is fenced/i.test(msg)) {
      return {
        outcome: "FAIL",
        kind: "fence_rejection",
        reason: `the storage fence rejected the reference write at ${ctx}: ${msg}`,
      };
    }
    if (/payments_method_allowed/i.test(msg) || (/payments/i.test(msg) && /check constraint/i.test(msg))) {
      return {
        outcome: "BLOCKED",
        kind: "payments_fixture_drift",
        reason: `the payments fixture drifted at ${ctx} (constraint violation, not a fence result): ${msg}`,
      };
    }
    return { outcome: "FAIL", kind: "check_violation", reason: `a check violation (23514) was reported at ${ctx}: ${msg}` };
  }
  if (st === "57014") {
    return { outcome: "FAIL", kind: "statement_timeout", reason: `the statement timed out (57014) at ${ctx}` };
  }
  if (st === "40001") {
    return { outcome: "FAIL", kind: "serialization_failure", reason: `a serialization failure (40001) was reported at ${ctx}` };
  }
  if (st === "42501") {
    return { outcome: "FAIL", kind: "authorization", reason: `the call was not authorized (42501) at ${ctx}: ${msg}` };
  }
  if (st === "22023") {
    return { outcome: "FAIL", kind: "invalid_parameter", reason: `an invalid parameter was rejected (22023) at ${ctx}: ${msg}` };
  }
  if (st === "T6NOPROBE") {
    return {
      outcome: "FAIL",
      kind: "protocol",
      reason: `no completion probe was produced at ${ctx}; the statement failed or the session broke`,
    };
  }
  return { outcome: "FAIL", kind: "unknown_sqlstate", reason: `an unexpected SQLSTATE ${st} was reported at ${ctx}: ${msg}` };
}

// ---------------------------------------------------------------------------
// The ordered statement protocol (pure text + pure interpretation)
// ---------------------------------------------------------------------------

/** The prefix the probe line carries on stdout. */
export const PROBE_PREFIX = "T6RPROBE|";

/**
 * The reset statement. It clears the result settings so a stale value from a
 * previous statement can never be read as the outcome of this one. It is a
 * DO block, so it produces no output row of its own. The settings are
 * session-level, so the reset works before BEGIN and after ROLLBACK too.
 */
export const RESET_SQL = `DO $t6r$
BEGIN
  PERFORM set_config('t6r.sqlstate', '00000', false);
  PERFORM set_config('t6r.message', '', false);
  PERFORM set_config('t6r.req_id', '', false);
  PERFORM set_config('t6r.lease', '', false);
  PERFORM set_config('t6r.claimstatus', '', false);
  PERFORM set_config('t6r.fence', '', false);
  PERFORM set_config('t6r.doc_id', '', false);
  PERFORM set_config('t6r.pay_id', '', false);
  PERFORM set_config('t6r.hygiene', '', false);
  PERFORM set_config('t6r.residue', '', false);
  PERFORM set_config('t6r.preflight', '', false);
END
$t6r$;`;

/**
 * The probe statement. It republishes the captured SQLSTATE, the captured
 * message and the values the harness bodies recorded, as ONE row on stdout.
 * The row and the completion marker travel on the same ordered stream.
 */
export const PROBE_SQL = `SELECT '${PROBE_PREFIX}' || jsonb_build_object(
  'sqlstate', coalesce(current_setting('t6r.sqlstate', true), 'MISSING'),
  'message', replace(coalesce(current_setting('t6r.message', true), ''), chr(10), ' '),
  'isolation', coalesce(current_setting('t6r.isolation', true), ''),
  'reqId', coalesce(current_setting('t6r.req_id', true), ''),
  'leaseToken', coalesce(current_setting('t6r.lease', true), ''),
  'claimStatus', coalesce(current_setting('t6r.claimstatus', true), ''),
  'fence', coalesce(current_setting('t6r.fence', true), ''),
  'docId', coalesce(current_setting('t6r.doc_id', true), ''),
  'payId', coalesce(current_setting('t6r.pay_id', true), ''),
  'hygiene', coalesce(current_setting('t6r.hygiene', true), ''),
  'residue', coalesce(current_setting('t6r.residue', true), ''),
  'preflight', coalesce(current_setting('t6r.preflight', true), '')
)::text;`;

/**
 * Interpret the stdout lines a statement produced.
 *
 * The function takes ONLY the ordered stdout lines. It never sees stderr, so
 * a late error chunk can neither create nor hide a failure. A missing probe
 * row, a malformed probe row or a non-00000 SQLSTATE can never be a PASS.
 */
export function interpretExec(tag, label, lines) {
  const out = [];
  let probe = null;
  let sawProbe = false;
  for (const l of lines || []) {
    if (typeof l === "string" && l.startsWith(PROBE_PREFIX)) {
      sawProbe = true;
      try {
        probe = JSON.parse(l.slice(PROBE_PREFIX.length));
      } catch {
        probe = null;
      }
      continue;
    }
    if (String(l).trim() !== "") out.push(l);
  }
  if (!sawProbe) {
    return {
      ok: false,
      fatal: true,
      sqlstate: "T6NOPROBE",
      message: `${tag}: the statement produced no completion probe (${label})`,
      probe: null,
      lines: out,
      label,
    };
  }
  if (!probe || typeof probe !== "object" || Array.isArray(probe)) {
    return {
      ok: false,
      fatal: true,
      sqlstate: "T6NOPROBE",
      message: `${tag}: the completion probe was malformed (${label})`,
      probe: null,
      lines: out,
      label,
    };
  }
  const sqlstate = String(probe.sqlstate || "").trim().toUpperCase();
  const message = String(probe.message || "");
  if (!sqlstate) {
    return {
      ok: false,
      fatal: true,
      sqlstate: "T6NOPROBE",
      message: `${tag}: the completion probe carried no SQLSTATE (${label})`,
      probe,
      lines: out,
      label,
    };
  }
  return {
    ok: sqlstate === "00000",
    fatal: false,
    sqlstate,
    message,
    probe,
    lines: out,
    label,
  };
}

/**
 * Remove the final ROLLBACK terminator of a harness section.
 *
 * The preflight section ends with ROLLBACK (the harness invariant: every
 * session ends with ROLLBACK). The runner removes that final terminator
 * before it runs the section, because the completion probe has to run INSIDE
 * the preflight's read-only transaction: the published payload lives in a
 * session setting, and a session setting made inside a transaction is undone
 * by that transaction's ROLLBACK. The session still ends with a ROLLBACK --
 * the runner issues it itself, in its finally block -- so the invariant is
 * preserved.
 *
 * Only a trailing terminator is removed. A ROLLBACK anywhere else in the
 * section is left untouched.
 */
export function stripTrailingRollback(section) {
  const text = String(section == null ? "" : section);
  const m = text.match(/\s*ROLLBACK\s*;\s*$/i);
  if (!m) return text;
  return text.slice(0, text.length - m[0].length);
}

/**
 * Interpret the preflight result. Fail closed: anything that is not an
 * explicit, complete, all-zero preflight payload is a failure.
 */
export const PREFLIGHT_SCHEMA = "t6-group-r-preflight/v1";

// Every relation the preflight must prove free of the synthetic namespace.
export const PREFLIGHT_NAMESPACE_KEYS = Object.freeze([
  "auth.users", "storage_deletion_requests", "storage_deletion_fences", "documents",
  "profiles", "user_roles", "payments", "jathagam_requests", "support_threads",
  "support_messages", "payment_events",
]);

export function interpretPreflight(r) {
  const fail = (reason, extra = {}) => ({
    ok: false, reason, failures: [], checks: 0, namespace: null, ...extra,
  });
  if (!r || r.fatal) {
    return fail(`the preflight produced no completion probe${r && r.message ? `: ${r.message}` : ""}`);
  }
  // The diagnostic payload is parsed on EVERY path, so a FAILED preflight
  // still reports how many objects were checked and exactly what failed. The
  // payload is NEVER proof of success: only the success path below can return
  // ok:true, and it does so only after the runner re-verifies the namespace
  // counts itself.
  const raw = r.probe ? r.probe.preflight : null;
  let payload = null;
  try { payload = (typeof raw === "string" && raw.trim()) ? JSON.parse(raw) : null; } catch { payload = null; }
  const payloadOk = !!(payload && typeof payload === "object" && !Array.isArray(payload)
    && payload.schema === PREFLIGHT_SCHEMA);
  const failures = payloadOk && Array.isArray(payload.failures) ? payload.failures.map((f) => String(f)) : [];
  const checks = payloadOk && Number.isFinite(Number(payload.checks)) ? Number(payload.checks) : 0;
  const namespace = payloadOk && payload.namespace && typeof payload.namespace === "object" && !Array.isArray(payload.namespace)
    ? payload.namespace : null;

  if (!r.ok) {
    // The SQL operation itself failed. Whatever the payload says, this is not
    // a success: the contract, the namespace and the object checks were never
    // all satisfied.
    const why = failures.length ? `: ${failures.join(" | ")}` : "";
    return {
      ok: false,
      reason: `the preflight statement failed (${describeFailure(r)})${why}`,
      failures, checks, namespace, diagnostic: true,
    };
  }
  if (!payloadOk) {
    return fail("the preflight published no usable result");
  }
  if (payload.ok !== true || failures.length > 0) {
    return {
      ok: false,
      reason: failures.length ? failures.join(" | ") : "the preflight reported a failure",
      failures, checks, namespace, fingerprint: evaluateT6Fingerprint(payload.fingerprint || {}),
    };
  }
  // Independent re-verification: the runner never takes the preflight's own
  // "ok" on trust. Every relation must be present and exactly zero.
  if (!namespace) return fail("the preflight published no namespace counts", { failures, checks });
  const missing = PREFLIGHT_NAMESPACE_KEYS.filter((k) => !Object.prototype.hasOwnProperty.call(namespace, k));
  if (missing.length) {
    return fail(`the preflight did not count: ${missing.join(", ")}`, { failures, checks, namespace });
  }
  const bad = Object.entries(namespace).filter(([, n]) => !Number.isInteger(n) || n !== 0);
  if (bad.length) {
    return {
      ok: false,
      reason: `the synthetic namespace is not empty: ${bad.map(([k, n]) => `${k}=${n}`).join(", ")}`,
      failures, checks, namespace, fingerprint: evaluateT6Fingerprint(payload.fingerprint || {}),
    };
  }
  // The fingerprint is evaluated LAST and fails closed: the preflight is not
  // accepted unless the pinned T6 baseline digest is reproduced exactly.
  const fingerprint = evaluateT6Fingerprint(payload.fingerprint || {});
  if (!fingerprint.ok) {
    return {
      ok: false,
      reason: `the T6 fingerprint check failed: ${fingerprint.problems.join(" | ")}`,
      failures, checks, namespace, fingerprint,
    };
  }
  return { ok: true, reason: "", failures: [], checks, namespace, fingerprint };
}
/** Describe a failed statement for a case detail string. */
export function describeFailure(r) {
  if (!r) return "an unknown failure";
  if (r.fatal) return r.message;
  return `SQLSTATE ${r.sqlstate}: ${r.message || "(no message)"}`;
}

// ---------------------------------------------------------------------------
// The psql session (one independent connection)
// ---------------------------------------------------------------------------

/**
 * A psql-backed session. Each instance is its own connection with its own
 * transaction, its own application_name and its own statement log.
 */
export class PgSession {
  constructor({ tag, applicationName, endpoint, password, psqlPath, variables, onStatement, onWire, stopOnError }) {
    this.tag = tag;
    this.applicationName = applicationName;
    this.endpoint = endpoint;
    this.password = password;
    this.psqlPath = psqlPath;
    this.variables = variables || {};
    this.onStatement = onStatement || (() => {});
    this.onWire = onWire || (() => {});
    this.stopOnError = stopOnError !== false;
    this.log = [];
    this.seq = 0;
    this.closed = false;
    this.stderr = "";
    this.buf = "";
    this.waiter = null;
  }

  #spawn() {
    // VERBOSITY=verbose makes psql print the SQLSTATE with every error, so the
    // operator's transcript is diagnostic -- but the runner never reads it.
    // The runner's own verdict comes from the ordered stdout probe.
    // The two acting sessions stop on the first psql-level error, exactly as
    // the matrix's rule requires ("ON_ERROR_STOP=1 in both sessions"). The
    // observer must survive every acting session so that the residue check
    // can still run, so it does not stop on error.
    const args = ["-X", "-q", "-A", "-t", "-P", "pager=off",
      "-v", `ON_ERROR_STOP=${this.stopOnError ? "on" : "off"}`,
      "-v", "VERBOSITY=verbose", "-f", "-"];
    for (const [k, v] of Object.entries(this.variables)) args.push("-v", `${k}=${v}`);
    args.push("host=" + this.endpoint.host, "port=" + String(this.endpoint.port),
      "user=" + this.endpoint.user, "dbname=" + this.endpoint.database);
    const env = { ...process.env, PGPASSWORD: this.password, PGAPPNAME: this.applicationName,
      PGCONNECT_TIMEOUT: "20", PGSSLMODE: "require" };
    // Drop every other libpq variable so an ambient one cannot redirect us.
    for (const k of Object.keys(env)) {
      if (/^(PG|POSTGRES)/i.test(k) && !/^(PGPASSWORD|PGAPPNAME|PGCONNECT_TIMEOUT|PGSSLMODE)$/i.test(k)) delete env[k];
    }
    this.child = spawn(this.psqlPath, args, { stdio: ["pipe", "pipe", "pipe"], env });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (d) => this.#onData(d));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (d) => { this.stderr += d; });
    this.child.on("exit", (code) => { this.closed = true; this.exitCode = code;
      const w = this.waiter; this.waiter = null; if (w) w.reject(new Error(`${this.tag}: psql exited (${code})`)); });
  }

  #onData(d) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, "");
      this.buf = this.buf.slice(i + 1);
      const w = this.waiter;
      if (!w) continue;
      if (line === w.marker) { this.waiter = null; w.resolve(w.lines); }
      else w.lines.push(line);
    }
  }

  async start() { this.#spawn(); }

  /**
   * Run one statement under the ordered protocol and interpret the result.
   * Never throws for a SQL error: the SQLSTATE is returned so the caller can
   * classify it. Throws only when the session itself is gone.
   */
  async exec(sql, { label = "" } = {}) {
    if (this.closed) throw new Error(`${this.tag}: session is closed`);
    const stmt = String(sql || "").trim();
    if (!stmt) throw new Error(`${this.tag}: refusing to run an empty statement`);
    this.log.push(stmt);
    this.onStatement(this.tag, stmt);
    const marker = `__T6R_END_${this.tag}_${++this.seq}__`;
    const wire = `${RESET_SQL}\n${stmt}\n${PROBE_SQL}\n\\echo ${marker}\n`;
    this.onWire(this.tag, wire);
    const lines = await new Promise((resolve, reject) => {
      this.waiter = { marker, lines: [], resolve, reject };
      this.child.stdin.write(wire);
    });
    return interpretExec(this.tag, label || stmt.slice(0, 60), lines);
  }

  async rollback() {
    if (this.closed) return;
    try { await this.exec("ROLLBACK;", { label: "rollback" }); } catch { /* already gone */ }
  }
  close() { try { this.child.stdin.end(); } catch {} try { this.child.kill(); } catch {} }
}

// ---------------------------------------------------------------------------
// Case bookkeeping (pure)
// ---------------------------------------------------------------------------

export const CASE_IDS = Object.freeze([
  "T6-R01", "T6-R02", "T6-R03", "T6-R04", "T6-R05", "T6-R06", "T6-R07", "T6-R08",
]);
export const CASE_STATUSES = Object.freeze(["PASS", "FAIL", "BLOCKED", "NOT RUN"]);

// The cases whose PASS depends on the residue check being verified clean.
export const RESIDUE_GATED_CASES = Object.freeze(["T6-R01", "T6-R02", "T6-R03", "T6-R04", "T6-R05"]);

/**
 * Turn the per-case assertions into the final verdicts.
 *
 * `assertion` is the historically observed, case-level outcome. `verdict` is
 * the final acceptance decision. The two are kept apart on purpose: a case
 * that observed its own pass clause can still be refused a final PASS when
 * the residue check did not come out clean.
 */
export function finalizeResults(assertions = {}, residueGate = "NOT RUN") {
  const gate = residueGate === "PASS" ? "PASS" : residueGate === "FAIL" ? "FAIL" : "BLOCKED";
  const out = [];
  for (const id of CASE_IDS) {
    const a = assertions && assertions[id] ? assertions[id] : null;
    const assertion = a && CASE_STATUSES.includes(a.assertion) ? a.assertion : "NOT RUN";
    let verdict = assertion;
    let detail = a && a.detail ? a.detail : "the case did not run";
    // The residue check is a RUN-LEVEL acceptance condition. The matrix names
    // it in the R01-R05 pass clauses (RESIDUE_GATED_CASES), but no case may be
    // finally accepted while the residue verification is incomplete or
    // unsuccessful, so the gate is applied to every case. The observed
    // case-level assertion is preserved next to the verdict, so nothing about
    // the case's own clause is lost.
    if (assertion === "PASS" && gate !== "PASS") {
      verdict = gate;
      detail = `${detail}; T6-R08 did not verify a clean residue (${gate}), so this case cannot be a PASS`;
    }
    out.push({ id, assertion, verdict, detail });
  }
  return out;
}

/** The overall verdict of the case set. Fail closed. */
export function suiteVerdict(results = []) {
  const list = Array.isArray(results) ? results : [];
  if (list.length !== CASE_IDS.length) return "FAIL";
  const verdicts = list.map((r) => r.verdict);
  if (verdicts.every((v) => v === "PASS")) return "PASS";
  if (verdicts.some((v) => v === "FAIL" || v === "NOT RUN")) return "FAIL";
  return "BLOCKED";
}

// ---------------------------------------------------------------------------
// Evidence -- one structured JSON line per case, plus a separate digest
// manifest (matrix rule 3).
//
//   "Every R-case result must be echoed as a single JSON line from each
//    session and captured to a file with SHA-256 recorded (fixes the T5
//    evidence gap)."
//
// The pattern is the proven Group-L one (t6-local-runner.mjs):
//   * one JSON object per line, newline terminated, in a .jsonl file;
//   * the SHA-256 computed over the EXACT final bytes of that file;
//   * the digest recorded in a separate manifest and echoed as a JSON line.
//
// Everything here fails closed. The evidence is only accepted when all eight
// case records are present, well formed and internally consistent, when the
// finalized file matches the intended bytes byte for byte, and when the
// manifest digest matches the file digest. Any failure means the run is NOT a
// successful suite verdict.
//
// NOTHING sensitive may enter the evidence: no password, no connection
// string, no environment secret, no client data and no full SQL statement
// text. Only counts, verdicts and short redacted messages are recorded.
// ---------------------------------------------------------------------------

export const EVIDENCE_SCHEMA = "t6-group-r-result/v1";
export const MANIFEST_SCHEMA = "t6-group-r-manifest/v1";
export const EVIDENCE_FILE_NAME = "t6-group-r-results.jsonl";
export const MANIFEST_FILE_NAME = "t6-group-r-manifest.json";

// A detail is a short human sentence, never a payload. The cap keeps one
// evidence line bounded and keeps a server message from becoming a channel.
const MAX_DETAIL_CHARS = 400;

// Ordered redactions. The first match wins for each position, so the
// connection-string rule runs before the looser parameter rules.
const REDACTIONS = Object.freeze([
  [/\b(?:postgres|postgresql):\/\/[^\s"'<>]*/gi, "[redacted-connection-string]"],
  [/\b(?:password|passfile|pgpassword)\s*=\s*[^\s;"']*/gi, "[redacted-password]"],
  [/\b(?:host|hostaddr|port|user|username|dbname|database)\s*=\s*[^\s;"']*/gi, "[redacted-connection-parameter]"],
  [/\b(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|RESEND_API_KEY|PGPASSWORD|API_KEY|SECRET|TOKEN)\b\s*[:=]\s*[^\s;"']*/gi, "[redacted-secret]"],
  [/\b(?:SELECT|INSERT INTO|UPDATE|DELETE FROM|CREATE TABLE|CREATE OR REPLACE|CREATE FUNCTION|CREATE TRIGGER|ALTER TABLE|DROP TABLE|BEGIN ISOLATION|SET LOCAL)\b[^;]{0,300};/g, "[redacted-sql]"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^\s"';]*/gi, "[redacted-key]"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[redacted-uuid]"],
]);

/**
 * Remove anything that could carry a credential, a connection detail, an
 * environment secret, a client identifier or a key from a message.
 * The result is short and safe to record.
 */
export function redactSensitive(text) {
  let out = String(text === null || text === undefined ? "" : text);
  for (const [re, to] of REDACTIONS) out = out.replace(re, to);
  if (out.length > MAX_DETAIL_CHARS) out = `${out.slice(0, MAX_DETAIL_CHARS)}...[truncated]`;
  return out;
}

/**
 * Build exactly one evidence record per matrix case, in matrix order.
 * Both the observed case-level assertion and the final residue-gated verdict
 * are preserved on every record.
 */
export function buildEvidenceRecords(results = [], { residueGate = "NOT RUN" } = {}) {
  const byId = new Map((Array.isArray(results) ? results : []).map((r) => [r && r.id, r]));
  const records = [];
  for (const id of CASE_IDS) {
    const r = byId.get(id);
    const assertion = r && CASE_STATUSES.includes(r.assertion) ? r.assertion : "NOT RUN";
    const verdict = r && CASE_STATUSES.includes(r.verdict) ? r.verdict : "NOT RUN";
    records.push({
      schema: EVIDENCE_SCHEMA,
      case: id,
      assertion,
      verdict,
      residueGate,
      detail: redactSensitive(r && r.detail ? r.detail : "the case did not run"),
    });
  }
  return records;
}

/** Render the records as the exact JSONL bytes (one object per line). */
export function renderEvidenceJsonl(records = []) {
  const lines = (Array.isArray(records) ? records : []).map((r) => JSON.stringify(r));
  return `${lines.join("\n")}\n`;
}

/** SHA-256 over the exact final evidence bytes, as lower-case hex. */
export function sha256Hex(text) {
  return createHash("sha256").update(Buffer.from(String(text), "utf8")).digest("hex");
}

/**
 * Are the evidence records complete and well formed? Fail closed: anything
 * missing, duplicated, unknown or malformed is a problem.
 */
export function validateEvidenceRecords(records = []) {
  const problems = [];
  if (!Array.isArray(records)) return { ok: false, problems: ["the evidence records are not an array"] };
  if (records.length !== CASE_IDS.length) {
    problems.push(`expected ${CASE_IDS.length} evidence records, found ${records.length}`);
  }
  const seen = new Set();
  for (const r of records) {
    if (!r || typeof r !== "object" || Array.isArray(r)) {
      problems.push("an evidence record is not a JSON object");
      continue;
    }
    if (r.schema !== EVIDENCE_SCHEMA) problems.push(`the record for ${r.case} has the wrong schema`);
    if (!CASE_IDS.includes(r.case)) problems.push(`unknown evidence case id "${r.case}"`);
    if (seen.has(r.case)) problems.push(`duplicate evidence case id "${r.case}"`);
    seen.add(r.case);
    if (!CASE_STATUSES.includes(r.assertion)) problems.push(`the record for ${r.case} has no valid assertion`);
    if (!CASE_STATUSES.includes(r.verdict)) problems.push(`the record for ${r.case} has no valid verdict`);
    if (typeof r.detail !== "string" || r.detail.length === 0) {
      problems.push(`the record for ${r.case} has no detail`);
    }
  }
  for (const id of CASE_IDS) if (!seen.has(id)) problems.push(`no evidence record for ${id}`);
  return { ok: problems.length === 0, problems };
}

/**
 * The residue gate is a run-level acceptance condition: while it is not
 * PASS, no case may report a PASS verdict. This is checked independently of
 * the builder, so a hand-made or tampered record set cannot slip through.
 */
export function validateEvidenceGate(records = []) {
  const problems = [];
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || typeof r !== "object") continue;
    if (r.verdict === "PASS" && r.residueGate !== "PASS") {
      problems.push(`${r.case} reports PASS while the residue gate is ${r.residueGate}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/** Write a file atomically: a temp file in the same directory, then a rename. */
function writeFileAtomic(filePath, bytes) {
  const tmp = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(tmp, bytes);
    // Best effort durability. The atomicity guarantee comes from the rename,
    // not from the flush, so a platform that refuses the flush is not fatal.
    try {
      const fd = openSync(tmp, "r+");
      try { fsyncSync(fd); } finally { closeSync(fd); }
    } catch { /* best effort */ }
    renameSync(tmp, filePath);
  } catch (e) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

/**
 * Write the evidence bundle: the JSONL file and the separate digest manifest.
 * Throws on ANY problem, so the caller can fail the run closed.
 */
export function writeEvidenceBundle({ evidenceDir, records = [], meta = {} } = {}) {
  if (!evidenceDir || !String(evidenceDir).trim()) {
    throw new Error("T6-R: an evidence directory is required for a live run");
  }
  const shape = validateEvidenceRecords(records);
  if (!shape.ok) throw new Error(`T6-R: the evidence records are incomplete: ${shape.problems.join("; ")}`);
  const gate = validateEvidenceGate(records);
  if (!gate.ok) throw new Error(`T6-R: the evidence claims success without a clean residue: ${gate.problems.join("; ")}`);

  mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = path.join(evidenceDir, EVIDENCE_FILE_NAME);
  const manifestPath = path.join(evidenceDir, MANIFEST_FILE_NAME);

  const jsonl = renderEvidenceJsonl(records);
  const bytes = Buffer.from(jsonl, "utf8");
  const digest = sha256Hex(jsonl);

  const outcomes = { PASS: 0, FAIL: 0, BLOCKED: 0, "NOT RUN": 0 };
  for (const r of records) if (outcomes[r.verdict] !== undefined) outcomes[r.verdict] += 1;

  const manifest = {
    schema: MANIFEST_SCHEMA,
    runId: (meta && meta.runId) || new Date().toISOString(),
    harness: (meta && meta.harness) || HARNESS,
    projectRef: (meta && meta.projectRef) || null,
    evidenceFile: EVIDENCE_FILE_NAME,
    evidenceBytes: bytes.length,
    evidenceSha256: digest,
    recordCount: records.length,
    caseOutcomes: outcomes,
    residueGate: records.length ? records[0].residueGate : "NOT RUN",
    statementsIssued: (meta && meta.statementsIssued) || 0,
    forbiddenStatements: (meta && meta.forbiddenStatements) || 0,
    createdAt: new Date().toISOString(),
  };

  let evidenceWritten = false;
  let manifestWritten = false;
  try {
    writeFileAtomic(evidencePath, bytes);
    evidenceWritten = true;

    // The finalized file must match the intended bytes exactly, and its
    // digest must match. A truncated or partially written file fails here.
    const written = readFileSync(evidencePath);
    if (!written.equals(bytes)) throw new Error("the finalized evidence file does not match the intended bytes");
    const writtenDigest = createHash("sha256").update(written).digest("hex");
    if (writtenDigest !== digest) throw new Error("the finalized evidence file digest does not match the computed digest");

    writeFileAtomic(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"));
    manifestWritten = true;

    // The manifest must agree with the file it describes.
    const manifestRead = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifestRead.evidenceSha256 !== writtenDigest) {
      throw new Error("the manifest digest does not match the evidence file digest");
    }
    if (manifestRead.recordCount !== records.length) {
      throw new Error("the manifest record count does not match the evidence records");
    }
    if (manifestRead.evidenceBytes !== written.length) {
      throw new Error("the manifest byte count does not match the evidence file");
    }
    return {
      evidencePath,
      manifestPath,
      sha256: writtenDigest,
      bytes: written.length,
      recordCount: records.length,
      manifest,
    };
  } catch (e) {
    // Never leave a file behind that claims a success the run did not have.
    if (manifestWritten) { try { if (existsSync(manifestPath)) unlinkSync(manifestPath); } catch { /* ignore */ } }
    if (evidenceWritten) { try { if (existsSync(evidencePath)) unlinkSync(evidencePath); } catch { /* ignore */ } }
    throw e;
  }
}

/**
 * Re-read a written bundle and verify it end to end. Used by the offline
 * tests and available for an operator re-check of a captured run.
 */
export function verifyEvidenceBundle({ evidenceDir } = {}) {
  const problems = [];
  if (!evidenceDir) return { ok: false, problems: ["no evidence directory was given"] };
  const evidencePath = path.join(evidenceDir, EVIDENCE_FILE_NAME);
  const manifestPath = path.join(evidenceDir, MANIFEST_FILE_NAME);
  if (!existsSync(evidencePath)) problems.push("the evidence file is missing");
  if (!existsSync(manifestPath)) problems.push("the evidence manifest is missing");
  if (problems.length) return { ok: false, problems, sha256: null };
  let text = "";
  let digest = null;
  try {
    text = readFileSync(evidencePath, "utf8");
    digest = createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
  } catch (e) {
    problems.push(`the evidence file could not be read: ${e.message}`);
    return { ok: false, problems, sha256: null };
  }
  const lines = text.split("\n");
  if (lines[lines.length - 1] !== "") problems.push("the evidence file does not end with a newline");
  const records = lines.filter((l) => l.length > 0).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  });
  if (records.some((r) => r === null)) problems.push("an evidence line is not valid JSON");
  const shape = validateEvidenceRecords(records.filter(Boolean));
  for (const p of shape.problems) problems.push(p);
  const gate = validateEvidenceGate(records.filter(Boolean));
  for (const p of gate.problems) problems.push(p);
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    problems.push(`the evidence manifest could not be read: ${e.message}`);
  }
  if (manifest) {
    if (manifest.evidenceSha256 !== digest) problems.push("the manifest digest does not match the evidence file");
    if (manifest.evidenceBytes !== Buffer.byteLength(text, "utf8")) {
      problems.push("the manifest byte count does not match the evidence file");
    }
    if (manifest.recordCount !== records.length) problems.push("the manifest record count does not match");
  }
  return { ok: problems.length === 0, problems, sha256: digest, records, manifest };
}

/**
 * Finalize the evidence. Never throws: a failure is reported so the caller
 * can turn it into a failed suite verdict instead of a false success.
 */
export function finalizeEvidence({ evidenceDir, records = [], meta = {} } = {}) {
  try {
    const bundle = writeEvidenceBundle({ evidenceDir, records, meta });
    return { ok: true, ...bundle };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

/**
 * The final suite verdict. A run is only successful when every case verdict
 * is a PASS AND the evidence was finalized and verified.
 */
export function finalSuiteVerdict(results = [], evidence = null) {
  if (!evidence || evidence.ok !== true) return "FAIL";
  return suiteVerdict(results);
}

// ---------------------------------------------------------------------------
// The live run (only reached via the explicit CLI switch)
// ---------------------------------------------------------------------------

const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const CASE_TIMEOUT_MS = 180000;

/** Never let a promise rejection escape unobserved. */
const settle = (p) =>
  Promise.resolve(p).then((v) => ({ ok: true, value: v }), (e) => ({ ok: false, error: e && e.message ? e.message : String(e) }));

/** Bound a promise. The timer is always cleared. */
async function withTimeout(promise, ms, label) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The last numeric line of a statement's own output. */
export function lastNumeric(lines) {
  const nums = (lines || [])
    .map((l) => String(l).trim())
    .filter((l) => /^-?\d+$/.test(l))
    .map((l) => Number(l));
  return nums.length ? nums[nums.length - 1] : null;
}

export async function runGroupR({ endpoint, password, psqlPath = "psql", evidenceDir } = {}) {
  // The live-authorization gate comes FIRST: this harness talks to a live
  // Supabase project and is off unless an operator opts in explicitly with
  // SLMM_LIVE_TESTS=true, SLMM_LIVE_TARGET=test and a matching
  // SLMM_LIVE_ACK. Production is unconditionally prohibited by the guard.
  requireLiveAuthorization({ harness: HARNESS, services: ["supabase-test-postgres"] });

  const ref = assertTestEndpointIdentity(endpoint);
  // The project we resolved must be the TEST project. This is not
  // tautological: the ref is derived from the endpoint the operator supplied.
  assertNonProductionTarget(`https://${ref}.supabase.co`, { harness: HARNESS });

  const sections = parseHarnessSections(readFileSync(HARNESS_SQL, "utf8"));
  const missing = missingHarnessSections(sections);
  if (missing.length) throw new Error(`T6-R: harness SQL is missing sections: ${missing.join(", ")}`);

  const variables = { owner: T6_OWNER, other: T6_OTHER, admin: T6_ADMIN, prefix: T6_KEY_PREFIX };

  const statements = [];
  let wire = "";
  const onStatement = (tag, stmt) => statements.push({ tag, stmt });
  const onWire = (tag, text) => { wire += `${text}\n`; };
  const mk = (tag, applicationName, extraVars, stopOnError) =>
    new PgSession({ tag, applicationName, endpoint, password, psqlPath,
      variables: { ...variables, ...(extraVars || {}) }, onStatement, onWire, stopOnError });

  const assertions = Object.create(null);
  const record = (id, assertion, detail) => { assertions[id] = { assertion, detail }; };

  const S = (n) => sections.get(n);

  // The observer is spawned once and is READ ONLY. It must survive every
  // acting session so that the residue check can still run, so it does not
  // stop on error. The two acting sessions stop on the first psql-level
  // error, exactly as the matrix's rule requires.
  const observer = mk("obs", OBSERVER_TAG, {}, false);
  let holder = null;
  let waiter = null;

  const openCase = async (key) => {
    const vars = { key };
    holder = mk("a", HOLDER_TAG, vars, true);
    waiter = mk("b", WAITER_TAG, vars, true);
    await Promise.all([holder.start(), waiter.start()]);
  };
  const closeCase = async () => {
    for (const s of [holder, waiter]) { if (s) { await s.rollback(); s.close(); } }
    holder = null; waiter = null;
  };
  // A fresh, unused, synthetic key per case. The prefix is bound to owner_id
  // by a CHECK constraint, so the key can never name another user's object.
  const keyFor = (tag) => `${T6_KEY_PREFIX}${tag}/object`;

  const failure = (label, r) => {
    const c = classifySqlFailure({ sqlstate: r.sqlstate, message: r.message, label });
    return { status: c.outcome, detail: `${label}: ${c.reason}` };
  };

  /** Run a harness section and return its interpreted result. */
  const must = async (session, section) => {
    const r = await session.exec(S(section), { label: section });
    return r;
  };

  /** Open a session, then assert the read-committed isolation guard. */
  const openSession = async (session, preludeName) => {
    const r = await must(session, preludeName);
    if (!r.ok) return { ok: false, detail: `the ${preludeName} prelude failed: ${describeFailure(r)}` };
    const iso = await must(session, "prelude.isolation_check");
    if (!iso.ok) {
      return { ok: false, detail: `the read-committed guard failed: ${describeFailure(iso)}` };
    }
    const level = String(iso.probe && iso.probe.isolation ? iso.probe.isolation : "").trim().toLowerCase();
    if (level !== "read committed") {
      return { ok: false, detail: `the session isolation is "${level}" but read committed is required` };
    }
    return { ok: true };
  };

  /** Poll the observer until the predicate holds. Every poll is bounded. */
  const poll = async (section, predicate, timeoutMs = 30000) => {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      const r = await observer.exec(S(section), { label: section });
      if (!r.ok) return { ok: false, count: last, error: `the observer poll failed: ${describeFailure(r)}` };
      last = lastNumeric(r.lines);
      if (predicate(last)) return { ok: true, count: last };
      await SLEEP(100);
    }
    return { ok: false, count: last, error: "the poll deadline expired" };
  };

  /** Wait for every T6 backend (except the observer) to disappear. */
  const waitForBackendsGone = async (timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      const r = await observer.exec(S("poll.t6_backends"), { label: "poll.t6_backends" });
      if (!r.ok) return { ok: false, count: last };
      last = lastNumeric(r.lines);
      if (last === 0) return { ok: true, count: 0 };
      await SLEEP(150);
    }
    return { ok: false, count: last };
  };

  /** Every case must leave a definite record. Never omit one. */
  const runCase = async (id, fn) => {
    try {
      const outcome = await withTimeout(Promise.resolve().then(fn), CASE_TIMEOUT_MS, id);
      const status = CASE_STATUSES.includes(outcome && outcome.status) ? outcome.status : "FAIL";
      record(id, status, (outcome && outcome.detail) || "the case produced no detail");
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      record(id, /timed out/.test(msg) ? "BLOCKED" : "FAIL", `unexpected ${(e && e.name) || "error"}: ${msg}`);
    }
  };

  /** The mandatory fail-closed hosted-schema preflight. */
  const runPreflight = async () => {
    const pf = mk("pf", PREFLIGHT_TAG, {}, true);
    try {
      await pf.start();
      // The trailing ROLLBACK is removed so the completion probe runs
      // inside the preflight's read-only transaction and can read the
      // published payload. The session is rolled back by the finally block
      // below.
      const r = await pf.exec(stripTrailingRollback(S("preflight.schema")), { label: "preflight.schema" });
      return interpretPreflight(r);
    } catch (e) {
      return {
        ok: false,
        reason: `the preflight session failed: ${e && e.message ? e.message : String(e)}`,
        failures: [],
        checks: 0,
        namespace: null,
      };
    } finally {
      try { await pf.rollback(); } catch { /* already gone */ }
      try { pf.close(); } catch { /* already gone */ }
    }
  };

  // The preflight result is declared OUTSIDE the try block so the evidence
  // manifest below can record it even when the run aborts.
  let preflight = null;

  try {
    // MANDATORY fail-closed hosted-schema preflight. It runs on its own
    // session, in its own bounded READ ONLY transaction, before the observer
    // and before any acting session or synthetic fixture exists.
    preflight = await runPreflight();

    await observer.start();
    const obsPre = await openSession(observer, "prelude.observer");
    if (!obsPre.ok) throw new Error(`T6-R: the observer session could not be opened: ${obsPre.detail}`);

    // ---- T6-R01: a reference INSERT waits for an in-flight fence ----------
    // A fences the key (holding the per-key advisory lock and an uncommitted
    // fence row); B's documents INSERT must then WAIT, and must succeed once
    // A rolls back, because no fence was ever committed.
    await runCase("T6-R01", async () => {
      if (!preflight.ok) {
        return { status: "BLOCKED", detail: `the hosted-schema preflight blocked this case: ${preflight.reason}` };
      }
      await openCase(keyFor("r01"));
      try {
        const a = await openSession(holder, "prelude.authenticated");
        if (!a.ok) return { status: "FAIL", detail: a.detail };
        const b = await openSession(waiter, "prelude.authenticated");
        if (!b.ok) return { status: "FAIL", detail: b.detail };

        const req = await must(holder, "a.create_request");
        if (!req.ok) return failure("a.create_request", req);
        const esc = await must(holder, "escalate.service_role");
        if (!esc.ok) return failure("escalate.service_role", esc);
        const fence = await must(holder, "a.claim_fence");
        if (!fence.ok) return failure("a.claim_fence", fence);
        const fenceResult = String(fence.probe.fence || "");
        if (fenceResult !== "fenced") {
          return { status: "FAIL", detail: `the fence returned "${fenceResult}" instead of "fenced"` };
        }

        const held = await poll("poll.granted_a", (n) => n !== null && n >= 1);
        if (!held.ok) {
          return { status: "BLOCKED", detail: `session A never took the per-key advisory lock (${held.error})` };
        }

        const pending = settle(waiter.exec(S("b.insert_document"), { label: "b.insert_document" }));
        const seen = await poll("poll.waiting_b", (n) => isSingleWaiter(n));
        await holder.rollback();
        const done = await pending;

        if (!seen.ok) {
          return { status: "BLOCKED", detail: `session B was never observed waiting on the per-key lock (${seen.error})` };
        }
        if (!done.ok) return { status: "FAIL", detail: `the reference INSERT failed: ${done.error}` };
        if (!done.value.ok) return failure("b.insert_document", done.value);
        return {
          status: "PASS",
          detail: "the reference INSERT waited for the in-flight fence and succeeded after the rollback",
        };
      } finally { await closeCase(); }
    });

    // ---- T6-R02: the same serialisation for a second source -------------
    // The payments fixture is inserted with service_role: payments exposes only
    // SELECT to authenticated on the hosted schema.
    await runCase("T6-R02", async () => {
      if (!preflight.ok) {
        return { status: "BLOCKED", detail: `the hosted-schema preflight blocked this case: ${preflight.reason}` };
      }
      await openCase(keyFor("r02"));
      try {
        const a = await openSession(holder, "prelude.authenticated");
        if (!a.ok) return { status: "FAIL", detail: a.detail };
        const b = await openSession(waiter, "prelude.service_role");
        if (!b.ok) return { status: "FAIL", detail: b.detail };

        const req = await must(holder, "a.create_request");
        if (!req.ok) return failure("a.create_request", req);
        const esc = await must(holder, "escalate.service_role");
        if (!esc.ok) return failure("escalate.service_role", esc);
        const fence = await must(holder, "a.claim_fence");
        if (!fence.ok) return failure("a.claim_fence", fence);
        const fenceResult = String(fence.probe.fence || "");
        if (fenceResult !== "fenced") {
          return { status: "FAIL", detail: `the fence returned "${fenceResult}" instead of "fenced"` };
        }

        const held = await poll("poll.granted_a", (n) => n !== null && n >= 1);
        if (!held.ok) {
          return { status: "BLOCKED", detail: `session A never took the per-key advisory lock (${held.error})` };
        }

        const pending = settle(waiter.exec(S("b.insert_payment"), { label: "b.insert_payment" }));
        const seen = await poll("poll.waiting_b", (n) => isSingleWaiter(n));
        await holder.rollback();
        const done = await pending;

        if (!seen.ok) {
          return { status: "BLOCKED", detail: `session B was never observed waiting on the per-key lock (${seen.error})` };
        }
        if (!done.ok) return { status: "FAIL", detail: `the payments fixture failed: ${done.error}` };
        if (!done.value.ok) return failure("b.insert_payment", done.value);
        return {
          status: "PASS",
          detail: "the proof_key INSERT waited for the in-flight fence and succeeded after the rollback",
        };
      } finally { await closeCase(); }
    });

    // ---- T6-R03: the fence waits for a reference writer ------------------
    // B inserts the reference row first and holds it, so the trigger holds the
    // per-key advisory lock. A's request creation must then WAIT, and once B
    // rolls back A's fence must re-check freshly and return 'fenced'.
    await runCase("T6-R03", async () => {
      if (!preflight.ok) {
        return { status: "BLOCKED", detail: `the hosted-schema preflight blocked this case: ${preflight.reason}` };
      }
      await openCase(keyFor("r03"));
      try {
        const b = await openSession(waiter, "prelude.authenticated");
        if (!b.ok) return { status: "FAIL", detail: b.detail };
        const ins = await must(waiter, "b.insert_document_first");
        if (!ins.ok) return failure("b.insert_document_first", ins);

        const held = await poll("poll.granted_b", (n) => n !== null && n >= 1);
        if (!held.ok) {
          return { status: "BLOCKED", detail: `the reference writer never took the per-key advisory lock (${held.error})` };
        }

        const a = await openSession(holder, "prelude.authenticated");
        if (!a.ok) return { status: "FAIL", detail: a.detail };

        const pending = settle(holder.exec(S("a.create_request"), { label: "a.create_request" }));
        const seen = await poll("poll.waiting_a", (n) => isSingleWaiter(n));
        await waiter.rollback();
        const done = await pending;

        if (!seen.ok) {
          return { status: "BLOCKED", detail: `the reference writer never observed the fence waiting (${seen.error})` };
        }
        if (!done.ok) return { status: "FAIL", detail: `the request creation failed: ${done.error}` };
        if (!done.value.ok) return failure("a.create_request", done.value);

        const esc = await must(holder, "escalate.service_role");
        if (!esc.ok) return failure("escalate.service_role", esc);
        const fence = await must(holder, "a.claim_fence");
        if (!fence.ok) return failure("a.claim_fence", fence);
        const fenceResult = String(fence.probe.fence || "");
        if (fenceResult !== "fenced") {
          return { status: "FAIL", detail: `the fence returned "${fenceResult}" instead of "fenced"` };
        }
        return {
          status: "PASS",
          detail: "the fence waited for the reference writer and re-checked freshly, returning fenced",
        };
      } finally { await closeCase(); }
    });

    // ---- T6-R04: a bounded, fail-closed wait ------------------------------
    // A holds the lock; B shortens lock_timeout and attempts the INSERT, which
    // must fail with 55P03 and never with a deadlock (40P01) and never hang.
    await runCase("T6-R04", async () => {
      if (!preflight.ok) {
        return { status: "BLOCKED", detail: `the hosted-schema preflight blocked this case: ${preflight.reason}` };
      }
      await openCase(keyFor("r04"));
      try {
        const a = await openSession(holder, "prelude.authenticated");
        if (!a.ok) return { status: "FAIL", detail: a.detail };

        const req = await must(holder, "a.create_request");
        if (!req.ok) return failure("a.create_request", req);
        const esc = await must(holder, "escalate.service_role");
        if (!esc.ok) return failure("escalate.service_role", esc);
        const fence = await must(holder, "a.claim_fence");
        if (!fence.ok) return failure("a.claim_fence", fence);

        const held = await poll("poll.granted_a", (n) => n !== null && n >= 1);
        if (!held.ok) {
          return { status: "BLOCKED", detail: `session A never took the per-key advisory lock (${held.error})` };
        }

        const b = await openSession(waiter, "prelude.authenticated");
        if (!b.ok) return { status: "FAIL", detail: b.detail };
        const short = await must(waiter, "b.set_short_lock_timeout");
        if (!short.ok) return failure("b.set_short_lock_timeout", short);

        const started = Date.now();
        const pending = settle(waiter.exec(S("b.insert_document"), { label: "b.insert_document" }));
        const seen = await poll("poll.waiting_b", (n) => isSingleWaiter(n), 8000);
        const done = await pending;
        const waited = Date.now() - started;
        await holder.rollback();

        if (!done.ok) return { status: "FAIL", detail: `the waiting INSERT failed unexpectedly: ${done.error}` };
        if (done.value.ok) {
          return { status: "FAIL", detail: "the waiting INSERT did not fail; the bounded wait was not enforced" };
        }
        const c = classifySqlFailure({
          sqlstate: done.value.sqlstate,
          message: done.value.message,
          label: "b.insert_document",
        });
        if (c.kind !== "lock_timeout") {
          return { status: c.outcome, detail: `b.insert_document: ${c.reason}` };
        }
        if (!seen.ok) {
          return {
            status: "BLOCKED",
            detail: `the waiter was never observed on the per-key lock (${seen.error}); the bounded wait could not be proven`,
          };
        }
        if (waited > 15000) {
          return { status: "FAIL", detail: `the wait was not bounded (${waited} ms)` };
        }
        return { status: "PASS", detail: `the wait was bounded and fail-closed (55P03 after ${waited} ms)` };
      } finally { await closeCase(); }
    });

    // ---- T6-R05: two sessions creating a request for the same key --------
    // A creates a request for a fresh key and holds the per-key advisory lock
    // from inside request_storage_deletion; B must wait, and after A's
    // rollback B creates its own request (no committed duplicate can exist).
    await runCase("T6-R05", async () => {
      if (!preflight.ok) {
        return { status: "BLOCKED", detail: `the hosted-schema preflight blocked this case: ${preflight.reason}` };
      }
      await openCase(keyFor("r05"));
      try {
        const a = await openSession(holder, "prelude.authenticated");
        if (!a.ok) return { status: "FAIL", detail: a.detail };
        const b = await openSession(waiter, "prelude.authenticated");
        if (!b.ok) return { status: "FAIL", detail: b.detail };

        const req = await must(holder, "a.create_request");
        if (!req.ok) return failure("a.create_request", req);

        const held = await poll("poll.granted_a", (n) => n !== null && n >= 1);
        if (!held.ok) {
          return { status: "BLOCKED", detail: `session A never took the per-key advisory lock (${held.error})` };
        }

        const pending = settle(waiter.exec(S("a.create_request"), { label: "a.create_request" }));
        const seen = await poll("poll.waiting_b", (n) => isSingleWaiter(n));
        await holder.rollback();
        const done = await pending;

        if (!seen.ok) {
          return { status: "BLOCKED", detail: `session A never observed session B waiting (${seen.error})` };
        }
        if (!done.ok) return { status: "FAIL", detail: `the competing request creation failed: ${done.error}` };
        if (!done.value.ok) return failure("a.create_request", done.value);
        return {
          status: "PASS",
          detail: "the duplicate creation serialised on the per-key advisory lock",
        };
      } finally { await closeCase(); }
    });

    // ---- T6-R06: zero-commit enforcement ----------------------------------
    // The allowlist is audited over every statement the runner sent, and the
    // terminator scan is repeated over the COMPLETE wire text (reset,
    // statement, probe and marker), so a terminator hidden in the plumbing
    // cannot slip through.
    await runCase("T6-R06", async () => {
      const violations = auditStatementLog(statements.map((s) => s.stmt));
      const wireTerminators = findTerminators(wire);
      if (violations.length) {
        return { status: "FAIL", detail: `forbidden statements: ${violations.length}` };
      }
      if (wireTerminators.length) {
        return { status: "FAIL", detail: `a transaction terminator appeared on the wire: ${wireTerminators.join(", ")}` };
      }
      return { status: "PASS", detail: "no COMMIT was issued by either session" };
    });

    // ---- T6-R07: no open transactions or retained advisory locks -----------
    // The acting sessions have been closed, but a backend may still be
    // shutting down, so the runner waits (bounded) for the last one to
    // disappear before it measures anything.
    await runCase("T6-R07", async () => {
      const gone = await waitForBackendsGone(15000);
      if (!gone.ok) {
        return {
          status: "FAIL",
          detail: `a T6 backend was still alive after the case set (${gone.count} surviving)`,
        };
      }
      const h = await observer.exec(S("r07.hygiene"), { label: "r07.hygiene" });
      if (!h.ok) return failure("r07.hygiene", h);
      const hyg = parseHygiene(h.probe && h.probe.hygiene);
      if (!hyg.valid) {
        return { status: "FAIL", detail: `the hygiene payload is not the agreed contract: ${hyg.problems.join("; ")}` };
      }
      if (!hyg.clean) {
        return { status: "FAIL", detail: `session hygiene is not clean: ${JSON.stringify(hyg.values)}` };
      }
      return { status: "PASS", detail: "no T6 backend, open transaction or advisory lock survived" };
    });

    // ---- T6-R08: post-rollback zero residue ------------------------------
    await runCase("T6-R08", async () => {
      const r = await observer.exec(S("r08.residue"), { label: "r08.residue" });
      const res = parseResidue(r.probe && r.probe.residue);
      const hyg = parseHygiene(r.probe && r.probe.hygiene);
      const sum = summarizeResidue(res.counts, hyg.values);
      if (!r.ok) {
        // The harness raises on any nonzero counter: that is the fail-closed
        // path, never a PASS.
        const why = res.valid ? JSON.stringify(res.counts) : res.problems.join("; ");
        return { status: "FAIL", detail: `the residue check raised (${describeFailure(r)}); counters: ${why}` };
      }
      if (!res.valid) {
        return { status: "FAIL", detail: `the residue payload is not the agreed contract: ${res.problems.join("; ")}` };
      }
      if (!hyg.valid) {
        return { status: "FAIL", detail: `the session counters are not the agreed contract: ${hyg.problems.join("; ")}` };
      }
      if (!sum.clean) {
        return {
          status: "FAIL",
          detail: `residue is not clean: relations ${JSON.stringify(sum.nonzero)}, sessions ${JSON.stringify(hyg.values)}`,
        };
      }
      return {
        status: "PASS",
        detail: "all ten relations zero; no T6 backends, open transactions or advisory locks",
      };
    });

    await observer.rollback();
  } finally {
    if (holder) holder.close();
    if (waiter) waiter.close();
    observer.close();
  }

  // The final verdicts. R01-R05 cannot be a PASS unless R08 verified a clean
  // residue; the case-level assertions are preserved next to the verdicts.
  const residueGate = assertions["T6-R08"] ? assertions["T6-R08"].assertion : "NOT RUN";
  const results = finalizeResults(assertions, residueGate);

  // Exactly one structured JSON line per case, echoed and captured. The
  // echoed line is byte-identical to the line in the evidence file.
  const records = buildEvidenceRecords(results, { residueGate });
  for (const record of records) console.log(JSON.stringify(record));

  // The evidence bundle is mandatory and fails closed. A missing, unwritable,
  // truncated or hash-mismatched bundle means the run is NOT a success, and
  // no file is left behind claiming otherwise.
  const runId = new Date().toISOString();
  const evidence = finalizeEvidence({
    evidenceDir,
    records,
    meta: {
      runId,
      harness: HARNESS,
      projectRef: ref,
      statementsIssued: statements.length,
      forbiddenStatements: auditStatementLog(statements.map((s) => s.stmt)).length,
      preflight: {
        ok: preflight.ok === true,
        checks: preflight.checks || 0,
        failures: (preflight.failures || []).map((f) => redactSensitive(f)),
        reason: redactSensitive(preflight.reason || ""),
        fingerprint: {
          contract: T6_FINGERPRINT_CONTRACT,
          expected: T6_FINGERPRINT_EXPECTED,
          computed: (preflight.fingerprint && preflight.fingerprint.computed) || null,
          serverVersion: (preflight.fingerprint && preflight.fingerprint.serverVersion) || null,
          ok: !!(preflight.fingerprint && preflight.fingerprint.ok),
        },
      },    },
  });
  const verdict = finalSuiteVerdict(results, evidence);
  if (evidence.ok) {
    console.log(JSON.stringify({
      evidence_file: evidence.evidencePath,
      evidence_sha256: evidence.sha256,
      manifest_file: evidence.manifestPath,
    }));
  } else {
    console.error(`T6-R: evidence finalization failed: ${evidence.error}`);
  }
  console.log(JSON.stringify({ suite: verdict }));
  return { projectRef: ref, verdict, results, records, evidence, statements };
}

// ---------------------------------------------------------------------------
// CLI entry point (never runs on import)
// ---------------------------------------------------------------------------
if (process.argv.includes("--run-group-r")) {
  const endpoint = {
    host: process.env.T6R_PGHOST || "",
    port: Number(process.env.T6R_PGPORT || 0),
    user: process.env.T6R_PGUSER || "",
    database: process.env.T6R_PGDATABASE || "",
  };
  const password = process.env.PGPASSWORD || "";
  try {
    const out = await runGroupR({ endpoint, password, evidenceDir: process.env.T6R_EVIDENCE_DIR });
    // The per-case JSON lines are echoed by runGroupR itself, one per case.
    console.log(JSON.stringify({ suite: out.verdict }));
    if (out.verdict !== "PASS") process.exitCode = 1;
  } catch (e) {
    console.error(`T6-R: ${e.message}`);
    process.exitCode = 1;
  }
}
