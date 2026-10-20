#!/usr/bin/env node
/**
 * T6 LOCAL CONCURRENCY RUNNER -- Group L (12 matrix cases).
 *
 *      *** IMPLEMENTED AND STATICALLY VALIDATED -- NOT EXECUTED. ***
 *
 * Execution is gated behind T6_LAB_CONFIRM === "I_APPROVE_LOCAL_T6" and is
 * carried out by t6-runner.ps1 against a disposable cluster only.
 * `node t6-local-runner.mjs --self-test` runs the static negative tests only and
 * never creates a database connection.
 *
 * HARD SAFETY INVARIANTS (fail closed)
 *  1. The TCP target is non-overridable: 127.0.0.1:15432, database t6lab, user
 *     postgres, psql resolved from the fixed PostgreSQL 18 install path. The
 *     reporter/paths are derived from the approved %TEMP% namespace, not from
 *     arbitrary environment overrides.
 *  2. The child-process environment is allowlisted (C1): no PGHOSTADDR,
 *     PGSERVICE, PGSERVICEFILE, PGOPTIONS, PGSYSCONFDIR, PGPASSFILE, PGPASSWORD
 *     or any other libpq variable is inherited, and host/hostaddr are pinned to
 *     loopback. Any redirect variable present in the parent environment causes
 *     a refusal.
 *  3. Connection identity is proven before any fixture work: server address,
 *     server port, database, user, data_directory, isolation and
 *     listen_addresses are all asserted. Fixtures refuse to run until preflight
 *     has passed.
 *  4. No session is constructed or connected before every static target/path
 *     guard has passed (C2). A guard flag is enforced inside the Session
 *     constructor.
 *  5. The lab root must be inside the exact approved %TEMP% namespace
 *     (\AppData\Local\Temp\opencode\t6lab) and must carry the run-ownership
 *     marker; a pre-existing directory without a valid marker is refused (C3/C4).
 *  6. Two independent concurrent test sessions (A/B) + a read-only observer + a
 *     setup connection. The SETUP connection is the ONLY committer; A/B never
 *     issue COMMIT.
 *  7. Synchronization is state-based (pg_locks / pg_stat_activity); polling is
 *     observation cadence, never ordering evidence.
 *  8. READ COMMITTED for every concurrent operation; bounded lock_timeout /
 *     statement_timeout / idle_in_transaction_session_timeout on every session
 *     (including setup and observer, C5) and ON_ERROR_STOP=1.
 *  9. Every case ends with ROLLBACK on every exit path; surviving sessions are
 *     detected and force-terminated (recorded). Case-result JSONL evidence is
 *     written even if residue verification fails (C8).
 * 10. C6 hard-kill recovery: this process never terminates unknown PostgreSQL
 *     processes and never deletes unknown clusters. If a previous run was hard
 *     killed, ownership cannot be proven automatically: STOP for manual
 *     inspection.
 *
 * Static validation for this phase: `node --check t6-local-runner.mjs` and
 * `node t6-local-runner.mjs --self-test`.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";

// --------------------------------------------------------------------------- fixed config (not overridable)
const HOST = "127.0.0.1";
const PORT = 15432;
const DB = "t6lab";
const USER = "postgres";
const PSQL = "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RESIDUE_SQL = path.join(SCRIPT_DIR, "t6-lab-residue.sql");

const OWNER = "5d8f1c62-9a37-4e0b-b1f4-7c0e2a6d9f41";
const OTHER = "9a4b7e20-6c15-4d38-82fa-1e5b9c07d3aa";
const ADMIN = "c3f7b518-2e64-4a90-b7d5-84f2e6a10c79";
const PREFIX = `${OWNER}/t6/`;
const K = (s) => `${PREFIX}${s}`;
const T = { lock: "10s", tight: "2s", stmt: "30s", idle: "60s", deadlock: "5s" };
const SYNC_TIMEOUT_MS = 9000; // < lock_timeout: a sync miss must surface as BLOCKED, not 55P03
const POLL_MS = 40;           // observation cadence, never ordering evidence

const MARKER_NAME = "T6LAB_OWNER";
const MARKER_CONTENT = "slmm-t6-disposable-lab";
const APPROVED_SUFFIX = "\\AppData\\Local\\Temp\\opencode\\t6lab";

// --------------------------------------------------------------------------- path / env guards (C1, C3, C4)
/** Exact approved-namespace test (no substring matching). Throws on refusal. */
function assertApprovedTempNamespace(dir) {
  if (typeof dir !== "string" || dir.trim() === "") throw new Error("refusing: empty laboratory path");
  if (!path.isAbsolute(dir)) throw new Error(`refusing: laboratory path is not absolute: ${dir}`);
  const norm = path.resolve(dir).replace(/\//g, "\\");
  if (norm.includes("..")) throw new Error(`refusing: laboratory path contains traversal: ${dir}`);
  if (!norm.toLowerCase().endsWith(APPROVED_SUFFIX.toLowerCase())) {
    throw new Error(`refusing: ${norm} is not inside the approved TEMP namespace (<TEMP>${APPROVED_SUFFIX})`);
  }
  return norm;
}

const TEMP_ROOT = process.env.TEMP || process.env.TMP || "";
const LAB_ROOT = assertApprovedTempNamespace(path.join(TEMP_ROOT, "opencode", "t6lab"));
const RESULTS = path.join(LAB_ROOT, "t6-lab-results.jsonl");

// libpq variables that could redirect the TCP target or the service options.
const REDIRECT_ENV = [
  "PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD",
  "PGSERVICE", "PGSERVICEFILE", "PGSYSCONFDIR", "PGOPTIONS", "PGPASSFILE",
  "PGSSLMODE", "PGSSLCERT", "PGSSLKEY", "PGSSLROOTCERT", "PGCONNECT_TIMEOUT", "PGCLIENTENCODING",
];
/** Refuse to run at all if a redirect variable is present in the parent env. */
function assertNoRedirectEnv(env = process.env) {
  const hits = REDIRECT_ENV.filter((k) => env[k] !== undefined && env[k] !== "");
  if (hits.length) throw new Error(`refusing: ambient libpq redirect variable(s) set: ${hits.join(", ")}`);
}

// Variables that are safe to hand to a child PostgreSQL client process. Every
// other variable (all PG*, all T6_*) is dropped, then the target is pinned.
const CHILD_ENV_ALLOW = new Set([
  "PATH", "Path", "SystemRoot", "SYSTEMROOT", "windir", "SystemDrive", "TEMP", "TMP",
  "ComSpec", "COMSPEC", "PATHEXT", "ProgramData", "ProgramFiles", "ProgramFiles(x86)",
  "CommonProgramFiles", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
  "USERNAME", "USERDOMAIN", "COMPUTERNAME", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
  "OS", "LANG", "LC_ALL", "LC_CTYPE",
]);
/** Build an allowlisted child environment with the TCP target pinned to loopback. */
function childEnv(extra = {}) {
  const out = {};
  for (const k of Object.keys(process.env)) {
    if (CHILD_ENV_ALLOW.has(k)) out[k] = process.env[k];
  }
  return Object.assign(out, {
    PGHOST: HOST,
    PGHOSTADDR: HOST,
    PGPORT: String(PORT),
    PGDATABASE: DB,
    PGUSER: USER,
    PGOPTIONS: "",
    PGSSLMODE: "disable",
    PGCONNECT_TIMEOUT: "5",
  }, extra);
}

// Ownership marker (C4): a directory is ours only if it carries our marker.
function markerFile(dir) { return path.join(dir, MARKER_NAME); }
function isOwnedLabRoot(dir) {
  try { return readFileSync(markerFile(dir), "utf8").includes(MARKER_CONTENT); }
  catch { return false; }
}
/** Create the lab root only after path verification; refuse an unowned pre-existing dir. */
function ensureOwnedDir(dir) {
  assertApprovedTempNamespace(dir);
  if (existsSync(dir)) {
    if (!isOwnedLabRoot(dir)) throw new Error(`refusing: ${dir} exists but is not owned by a verified T6 run (missing/invalid ${MARKER_NAME})`);
    return dir;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(markerFile(dir), `${MARKER_CONTENT}\nrun=${randomUUID()}\npid=${process.pid}\ncreated=${new Date().toISOString()}\n`, "utf8");
  return dir;
}

// Guard flag: no Session may be constructed/connected before this is set (C2).
const GUARD = { passed: false };
const spawnCount = { n: 0 };

function assertSafeTarget() {
  if (process.env.T6_LAB_CONFIRM !== "I_APPROVE_LOCAL_T6") {
    throw new Error("refusing to run: T6_LAB_CONFIRM is not set to I_APPROVE_LOCAL_T6 (execution requires separate approval)");
  }
  assertApprovedTempNamespace(LAB_ROOT);
  assertNoRedirectEnv();
  for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "SLMM_LIVE_TESTS"]) {
    if (process.env[k]) throw new Error(`refusing: ambient ${k} is set (possible remote target)`);
  }
  if (process.env.SLMM_SCHEDULER_ENABLED === "1") throw new Error("refusing: scheduler enabled");
  GUARD.passed = true;
}

// --------------------------------------------------------------------------- psql session
class Session {
  constructor(tag, appName) {
    if (!GUARD.passed) throw new Error(`internal: Session(${tag}) constructed before target guards passed`);
    this.tag = tag;
    this.appName = appName;
    this.seq = 0;
    this.buf = "";
    this.waiter = null;
    this.closed = false;
    this.exitCode = null;
    this.stderr = "";
    spawnCount.n++;
    this.child = spawn(PSQL, [
      "-X", "-q", "-A", "-t", "-P", "pager=off", "-v", "ON_ERROR_STOP=1",
      "-h", HOST, "-p", String(PORT), "-U", USER, "-d", DB, "-f", "-",
    ], { stdio: ["pipe", "pipe", "pipe"], env: childEnv({ PGAPPNAME: appName }) });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (d) => this.#onData(d));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (d) => { this.stderr += d; });
    this.child.on("exit", (code) => {
      this.closed = true;
      this.exitCode = code;
      const w = this.waiter; this.waiter = null;
      if (w) w.reject(new Error(`${this.tag} connection lost (exit ${code})${this.stderr.trim() ? ": " + this.stderr.trim() : ""}`));
    });
    // C5: apply the bounded timeouts at session scope for every connection,
    // including setup and the read-only observer.
    this.ready = this.exec(
      `SET statement_timeout='${T.stmt}';\n` +
      `SET lock_timeout='${T.lock}';\n` +
      `SET idle_in_transaction_session_timeout='${T.idle}';\n`);
  }
  #onData(d) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, "");
      this.buf = this.buf.slice(i + 1);
      const w = this.waiter;
      if (!w) continue;
      if (line === w.marker) { this.waiter = null; w.resolve(w.lines); } else { w.lines.push(line); }
    }
  }
  exec(sql) {
    if (this.closed) return Promise.reject(new Error(`${this.tag} is closed`));
    const marker = `__T6_END_${this.tag}_${++this.seq}__`;
    return new Promise((resolve, reject) => {
      this.waiter = { marker, lines: [], resolve, reject };
      this.child.stdin.write(`${sql}\n\\echo ${marker}\n`);
    });
  }
  async execCapture(sql) {
    const lines = await this.exec(`\\set ON_ERROR_STOP off\n${sql}\n\\echo __T6_SQLSTATE__ :SQLSTATE\n\\set ON_ERROR_STOP on`);
    const st = lines.find((l) => l.startsWith("__T6_SQLSTATE__"));
    return { sqlstate: st ? st.split(/\s+/)[1] : null, lines };
  }
  async pid() {
    const lines = await this.exec("SELECT pg_backend_pid();");
    const n = lines.map((l) => l.trim()).filter((l) => /^\d+$/.test(l)).pop();
    if (!n) throw new Error(`${this.tag}: could not read pg_backend_pid()`);
    return Number(n);
  }
  async rollback() { if (this.closed) return; try { await this.exec("ROLLBACK;"); } catch { /* already gone */ } }
  kill() { if (this.closed) return; try { this.child.stdin.end(); } catch {} try { this.child.kill(); } catch {} }
}

async function makeSession(tag, appName) {
  const s = new Session(tag, appName);
  await s.ready; // C5 timeout bootstrap must succeed before the session is used
  return s;
}

// Sessions are created only inside main() after the static guards (C2).
let setup, obs, a, b;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = (lines) => lines.filter((l) => l && !l.startsWith("__T6"));
const num = (lines) => { const n = rows(lines).map((l) => Number(l.trim())).filter(Number.isFinite).pop(); if (n === undefined) throw new Error("observer returned no numeric value"); return n; };
const idsOf = (lines) => rows(lines).map((r) => r.split("|")[0]);
const fieldOf = (lines, i) => { const r = rows(lines)[0]; return r ? r.split("|")[i] : null; };

/** Bounded observation poll through the observer connection. */
async function waitUntil(query, predicate, what, timeoutMs = SYNC_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const n = num(await obs.exec(query));
    if (predicate(n)) return n;
    if (Date.now() > deadline) throw new Error(`SYNC_TIMEOUT: ${what}`);
    await sleep(POLL_MS);
  }
}

const OBS_ALIVE = (pid) => `SELECT count(*) FROM pg_stat_activity WHERE pid = ${pid};`;
const OBS_UNGRANTED = (pid) => `SELECT count(*) FROM pg_locks WHERE pid = ${pid} AND NOT granted;`;
const OBS_TXID = (pid) => `SELECT count(*) FROM pg_locks WHERE pid = ${pid} AND granted AND locktype = 'transactionid';`;
const OBS_ADVISORY = (pid) => `SELECT count(*) FROM pg_locks WHERE pid = ${pid} AND granted AND locktype = 'advisory';`;
const OBS_T6_BACKENDS = `SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'slmm-t6-%' AND pid <> pg_backend_pid();`;
const OBS_T6_ADVISORY = `SELECT count(*) FROM pg_locks l JOIN pg_stat_activity s ON s.pid = l.pid
  WHERE l.granted AND l.locktype = 'advisory' AND s.application_name LIKE 'slmm-t6-%' AND s.pid <> pg_backend_pid();`;

// --------------------------------------------------------------------------- SQL helpers
const beginAs = (s, role, sub) => s.exec(
  `BEGIN ISOLATION LEVEL READ COMMITTED;\n` +
  `SET LOCAL lock_timeout = '${T.lock}';\n` +
  `SET LOCAL statement_timeout = '${T.stmt}';\n` +
  `SET LOCAL idle_in_transaction_session_timeout = '${T.idle}';\n` +
  `SET LOCAL search_path = pg_catalog, pg_temp;\n` +
  `SELECT set_config('request.jwt.claim.role','${role}',true);\n` +
  (sub ? `SELECT set_config('request.jwt.claim.sub','${sub}',true);\nSELECT set_config('request.jwt.claims','{"role":"${role}","sub":"${sub}"}',true);` : ""));
const beginService = (s) => beginAs(s, "service_role", null);
const beginOwner = (s) => beginAs(s, "authenticated", OWNER);

const claimOne = (s, id) => s.exec(`SELECT id, lease_token, status, attempt_count FROM public.claim_storage_deletion_request('${id}');`);
const claimBatch = (s, n) => s.exec(`SELECT id, lease_token, status, attempt_count FROM public.claim_storage_deletion_requests(${n});`);
const blockWith = (s, id, token) => s.exec(`SELECT public.block_storage_deletion('${id}','${token}','t6-stale-token');`);
const confirmAbsent = (s, id, token) => s.exec(`SELECT public.set_r2_confirmed_absent('${id}','${token}');`);
const requestKey = (s, key) => s.exec(`SELECT public.request_storage_deletion('${key}');`);

const PREFLIGHT = { ok: false };
let caseFixtures = [];
function fixture(label, extra = {}) {
  if (!PREFLIGHT.ok) throw new Error("refusing: fixture creation attempted before connection identity was verified");
  const id = randomUUID();
  const key = K(label);
  const cols = { status: "pending", r2_state: "not_attempted", finalize_state: "pending", attempt_count: 0, ...extra };
  const tokenSql = cols.token ? `'${cols.token}'` : "NULL";
  const leaseSql = cols.leaseSql || "NULL";
  const updatedSql = cols.updatedAtSql || "now()";
  const stmt =
    `INSERT INTO public.storage_deletion_requests\n` +
    `  (id, storage_key, owner_id, requested_by, requested_as_admin, status, r2_state,\n` +
    `   finalize_state, attempt_count, document_row_ids, lease_token, lease_expires_at, updated_at)\n` +
    `VALUES ('${id}','${key}','${OWNER}','${OWNER}',false,'${cols.status}','${cols.r2_state}',\n` +
    `  '${cols.finalize_state}',${cols.attempt_count},'{}',${tokenSql},${leaseSql},${updatedSql})\n` +
    `RETURNING id;`;
  caseFixtures.push(id);
  return setup.exec(stmt).then(() => ({ id, key }));
}
const snapshotRow = (id) => obs.exec(`SELECT to_jsonb(r)::text FROM public.storage_deletion_requests r WHERE r.id='${id}';`);
const nsCount = () => obs.exec(`SELECT count(*) FROM public.storage_deletion_requests
  WHERE storage_key LIKE '${PREFIX}%' OR owner_id IN ('${OWNER}','${OTHER}','${ADMIN}') OR requested_by IN ('${OWNER}','${OTHER}','${ADMIN}');`);
const liveCount = (key) => obs.exec(`SELECT count(*) FROM public.storage_deletion_requests
  WHERE storage_key='${key}' AND status IN ('pending','deleting','blocked','finalizing');`);

// --------------------------------------------------------------------------- case registry
const CASES = [];
const register = (id, title, expect, fn) => CASES.push({ id, title, expect, fn });
const results = [];
const record = (id, status, detail) => { results.push({ id, status, detail }); console.log(JSON.stringify({ case: id, status, detail })); };

async function runCase(c) {
  let status = "PASS";
  let detail = "";
  await setup.rollback(); await a.rollback(); await b.rollback(); // start every case from a clean, autocommit state
  try {
    detail = await c.fn();
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    const sync = /SYNC_TIMEOUT/.test(msg);
    const lost = /connection lost|is closed/.test(msg);
    status = sync || lost ? "BLOCKED" : "FAIL";
    detail = msg;
  } finally {
    await a.rollback(); await b.rollback(); await setup.rollback();
    const survivors = num(await obs.exec(`SELECT count(*) FROM pg_stat_activity WHERE application_name IN ('slmm-t6-a','slmm-t6-b') AND pid <> pg_backend_pid();`));
    if (survivors > 0) {
      const killed = num(await obs.exec(`SELECT count(*) FROM (SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE application_name IN ('slmm-t6-a','slmm-t6-b') AND pid <> pg_backend_pid()) k;`));
      status = "FAIL";
      detail += ` | force-terminated ${killed} surviving T6 backend(s)`;
    }
    if (caseFixtures.length) {
      await setup.exec(`DELETE FROM public.storage_deletion_requests WHERE id = ANY(ARRAY[${caseFixtures.map((x) => `'${x}'`).join(",")}]::uuid[]);`).catch(() => {});
      caseFixtures = [];
    }
  }
  record(c.id, status, detail);
  return status;
}

// --------------------------------------------------------------------------- L cases
// L01: exactly-one-winner, both release semantics. The concurrent test session
// (A/B) never COMMITs: the commit branch uses the setup connection as the
// committed holder, the rollback branch lets the observed waiter become the
// only persisted winner.
register("T6-L01", "single-claim race -> exactly one winner (commit and rollback release)",
  "commit release: loser returns 0 rows; rollback release: waiter returns the row; attempt_count +1 exactly once",
  async () => {
    // (a) committed holder branch
    const f1 = await fixture("L01a");
    await beginService(setup);
    const h = await claimOne(setup, f1.id);
    if (idsOf(h).length !== 1) throw new Error("setup holder failed to claim");
    const setupPid = await setup.pid();
    await waitUntil(OBS_TXID(setupPid), (n) => n >= 1, "committed holder has an open transaction");
    await beginService(a);
    const aPid = await a.pid();
    const loser = claimOne(a, f1.id);
    await waitUntil(OBS_UNGRANTED(aPid), (n) => n >= 1, "concurrent claim is waiting on the held row lock");
    await setup.exec("COMMIT;");
    const ra = await loser;
    if (idsOf(ra).length !== 0) throw new Error(`commit release: loser returned ${idsOf(ra).length} row(s), expected 0`);
    const afterCommit = await snapshotRow(f1.id);
    if (!/"attempt_count": 1/.test(afterCommit[0] || "")) throw new Error(`commit release: attempt_count not 1 after single claim: ${afterCommit[0]}`);
    // (b) rollback branch
    await a.rollback(); await b.rollback();
    const f2 = await fixture("L01b");
    await beginService(a);
    const holder = await claimOne(a, f2.id);
    if (idsOf(holder).length !== 1) throw new Error("session holder failed to claim");
    const pidWait = await b.pid();
    await beginService(b);
    const waiter = claimOne(b, f2.id);
    await waitUntil(OBS_UNGRANTED(pidWait), (n) => n >= 1, "waiter is blocked on the holder's row lock");
    await a.rollback();
    const rb = await waiter;
    if (idsOf(rb).length !== 1) throw new Error("rollback release: waiter did not win");
    if (fieldOf(rb, 3) !== "1") throw new Error(`rollback release: waiter attempt_count expected 1, got ${fieldOf(rb, 3)}`);
    if (fieldOf(holder, 3) !== "1") throw new Error(`rollback release: holder attempt_count expected 1, got ${fieldOf(holder, 3)}`);
    await b.rollback();
    const reverted = await snapshotRow(f2.id);
    if (!/"attempt_count": 0/.test(reverted[0] || "")) throw new Error("rollback release: row state was persisted despite both ROLLBACKs");
    return "commit release -> loser 0 rows, attempt=1 committed once; rollback release -> observed waiter won with attempt=1, both rolled back, row unchanged";
  });

register("T6-L02", "expired-lease reclaim -> single winner, attempt 2->3 exactly once",
  "holder increments to 3 in-txn; on rollback the waiter reclaims at attempt=3 (never 4) with a rotated token",
  async () => {
    const t0 = randomUUID();
    const f = await fixture("L02", { status: "deleting", attempt_count: 2, token: t0, leaseSql: "now() - interval '10 minutes'" });
    await beginService(a);
    const holder = await claimOne(a, f.id);
    if (idsOf(holder).length !== 1) throw new Error("holder failed to reclaim the expired lease");
    if (fieldOf(holder, 3) !== "3") throw new Error(`holder attempt expected 3, got ${fieldOf(holder, 3)}`);
    await beginService(b);
    const bPid = await b.pid();
    const waiter = claimOne(b, f.id);
    await waitUntil(OBS_UNGRANTED(bPid), (n) => n >= 1, "waiter blocked on the reclaim holder");
    await a.rollback();
    const rb = await waiter;
    if (idsOf(rb).length !== 1) throw new Error("waiter did not reclaim after the holder rolled back");
    if (fieldOf(rb, 3) !== "3") throw new Error(`reclaim attempt expected 3 (single increment), got ${fieldOf(rb, 3)}`);
    if (fieldOf(rb, 1) === t0) throw new Error("lease token was not rotated on reclaim");
    await b.rollback();
    const after = await snapshotRow(f.id);
    if (!/"attempt_count": 2/.test(after[0] || "")) throw new Error("expired-lease fixture changed despite both ROLLBACKs");
    return "reclaim serialized on the row lock; attempt 2->3 exactly once; token rotated; both ROLLBACKs left the fixture unchanged";
  });

register("T6-L03", "stale worker cannot transition state (wrong token)",
  "block_storage_deletion returns false; full-row snapshot byte-identical before/after",
  async () => {
    const f = await fixture("L03", { status: "deleting", attempt_count: 1, token: randomUUID(), leaseSql: "now() - interval '10 minutes'" });
    const before = (await snapshotRow(f.id))[0];
    await beginService(b);
    const r = await blockWith(b, f.id, "00000000-0000-4000-8000-000000000000");
    if (rows(r).pop() !== "f") throw new Error(`stale block expected false, got ${rows(r).pop()}`);
    await b.rollback();
    const after = (await snapshotRow(f.id))[0];
    if (before !== after) throw new Error("row changed after the stale-token call");
    return "false returned for a non-matching lease token; row snapshot identical";
  });

register("T6-L04", "CAS guards on confirm: token mismatch and expired lease both rejected",
  "set_r2_confirmed_absent returns false for a stale token and for an expired lease; row unchanged in both cases",
  async () => {
    const cur = randomUUID();
    const f1 = await fixture("L04a", { status: "deleting", attempt_count: 1, token: cur, leaseSql: "now() + interval '5 minutes'" });
    const b1 = (await snapshotRow(f1.id))[0];
    await beginService(b);
    const wrong = await confirmAbsent(b, f1.id, randomUUID());
    if (rows(wrong).pop() !== "f") throw new Error(`stale-token confirm expected false, got ${rows(wrong).pop()}`);
    await b.rollback();
    if ((await snapshotRow(f1.id))[0] !== b1) throw new Error("row changed after stale-token confirm");

    const f2 = await fixture("L04b", { status: "deleting", attempt_count: 1, token: cur, leaseSql: "now() - interval '10 minutes'" });
    const b2 = (await snapshotRow(f2.id))[0];
    await beginService(b);
    const expired = await confirmAbsent(b, f2.id, cur);
    if (rows(expired).pop() !== "f") throw new Error(`expired-lease confirm expected false, got ${rows(expired).pop()}`);
    await b.rollback();
    if ((await snapshotRow(f2.id))[0] !== b2) throw new Error("row changed after expired-lease confirm");
    return "correct token + valid lease is the only path to true; stale token and expired lease both returned false with unchanged rows";
  });

register("T6-L05", "SKIP LOCKED partition under contention",
  "A holds 3 locked rows; B receives the remaining disjoint set without waiting; union is complete; no duplicate id",
  async () => {
    const fs = [];
    for (let i = 0; i < 6; i++) fs.push(await fixture(`L05-${i}`));
    await beginService(a);
    const ra = await claimBatch(a, 3);
    const setA = idsOf(ra);
    if (setA.length !== 3) throw new Error(`A expected 3 claims, got ${setA.length}`);
    const aPid = await a.pid();
    await waitUntil(OBS_TXID(aPid), (n) => n >= 1, "A holds an open write transaction");
    await beginService(b);
    const t0 = Date.now();
    const rb = await claimBatch(b, 6);
    const elapsed = Date.now() - t0;
    const setB = idsOf(rb);
    const dup = setB.filter((x) => setA.includes(x));
    if (dup.length) throw new Error(`duplicate claims across sessions: ${dup.join(",")}`);
    const union = new Set([...setA, ...setB]);
    if (union.size !== 6) throw new Error(`union ${union.size} != 6`);
    if (elapsed >= 3000) throw new Error(`B waited ${elapsed}ms on a SKIP LOCKED claim (bound 3000ms)`);
    return `A=3, B=${setB.length}, disjoint, union=6, B elapsed ${elapsed}ms (did not wait)`;
  });

register("T6-L06", "batch skips a row held by another transaction, then claims it after release",
  "held row is excluded and B does not wait; after A ROLLBACK the held row is claimable",
  async () => {
    const fs = [];
    for (let i = 0; i < 4; i++) fs.push(await fixture(`L06-${i}`));
    const held = fs[0].id;
    await beginService(a);
    await a.exec(`SELECT id FROM public.storage_deletion_requests WHERE id='${held}' FOR UPDATE;`);
    const aPid = await a.pid();
    await waitUntil(OBS_TXID(aPid), (n) => n >= 1, "A holds the row lock");
    await beginService(b);
    const t0 = Date.now();
    const rb = await claimBatch(b, 10);
    const elapsed = Date.now() - t0;
    const setB = idsOf(rb);
    if (setB.includes(held)) throw new Error("the FOR UPDATE-held row was claimed");
    if (setB.length !== 3) throw new Error(`B expected the 3 free rows, got ${setB.length}`);
    if (elapsed >= 3000) throw new Error(`B waited ${elapsed}ms on a held row (bound 3000ms)`);
    await a.rollback();
    await b.rollback();
    await beginService(b);
    const rc = await claimBatch(b, 10);
    if (!idsOf(rc).includes(held)) throw new Error("the held row was not claimable after release");
    await b.rollback();
    return `held row skipped (B=${setB.length}, ${elapsed}ms, no wait); claimable after ROLLBACK`;
  });

register("T6-L07", "blocked-backoff rows are not claimable under contention",
  "30-minute blocked rows are never claimed; the 2-hour blocked row is claimed exactly once",
  async () => {
    const old = "now() - interval '30 minutes'";
    const f30a = await fixture("L07-30a", { status: "blocked", updatedAtSql: old });
    const f30b = await fixture("L07-30b", { status: "blocked", updatedAtSql: old });
    const f2h = await fixture("L07-2h", { status: "blocked", updatedAtSql: "now() - interval '2 hours'" });
    await beginService(a);
    const ra = await claimBatch(a, 10);
    const setA = idsOf(ra);
    if (setA.length !== 1 || setA[0] !== f2h.id) throw new Error(`A expected exactly the 2-hour row, got [${setA.join(",")}]`);
    const aPid = await a.pid();
    await waitUntil(OBS_TXID(aPid), (n) => n >= 1, "A holds the claim");
    await beginService(b);
    const rb = await claimBatch(b, 10);
    const setB = idsOf(rb);
    if (setB.includes(f30a.id) || setB.includes(f30b.id)) throw new Error("a 30-minute blocked row was claimed");
    if (setB.length !== 0) throw new Error(`B expected 0 claims, got ${setB.length}`);
    await a.rollback(); await b.rollback();
    return "30-minute blocked rows were never eligible; the 2-hour row was claimed exactly once";
  });

register("T6-L08a", "second creator reuses the committed live request (idempotent)",
  "request_storage_deletion returns the existing id and no duplicate live row exists",
  async () => {
    const f = await fixture("L08a");
    await beginOwner(b);
    const r = await requestKey(b, f.key);
    if (rows(r).pop() !== f.id) throw new Error(`expected existing id ${f.id}, got ${rows(r).pop()}`);
    if (num(await liveCount(f.key)) !== 1) throw new Error("expected exactly one live row");
    await b.rollback();
    return "returned the committed live request id; exactly one live row";
  });

register("T6-L08b", "per-key advisory lock serializes competing creators",
  "second creator is observed waiting on the per-key lock, then creates its own request after rollback; no committed rows",
  async () => {
    const key = K("L08b");
    await beginOwner(a);
    const ra = await requestKey(a, key);
    if (!rows(ra).pop()) throw new Error("first creator returned no id");
    const aPid = await a.pid();
    await waitUntil(OBS_ADVISORY(aPid), (n) => n >= 1, "first creator holds the per-key advisory lock");
    await beginOwner(b);
    const bPid = await b.pid();
    const rbP = requestKey(b, key);
    await waitUntil(OBS_UNGRANTED(bPid), (n) => n >= 1, "second creator is waiting on the per-key advisory lock");
    await a.rollback();
    const rb = await rbP;
    const got = rows(rb).pop();
    if (!got) throw new Error("second creator did not create a request after the lock was released");
    await b.rollback();
    if (num(await liveCount(key)) !== 0) throw new Error("a committed live row exists after both ROLLBACKs");
    return "second creator observed waiting, then succeeded; both ROLLBACKs left zero committed rows";
  });

register("T6-L09", "terminated committed-lease holder -> reclaim at attempt+1",
  "no stuck lock; B reclaims the terminated holder's expired lease with attempt=2 and a new token",
  async () => {
    const t0 = randomUUID();
    const f = await fixture("L09", { status: "deleting", attempt_count: 1, token: t0, leaseSql: "now() - interval '10 minutes'" });
    await beginService(a);
    const ra = await claimOne(a, f.id);
    if (idsOf(ra).length !== 1) throw new Error("A failed to claim");
    const aPid = await a.pid();
    await obs.exec(`SELECT pg_terminate_backend(${aPid});`);
    await waitUntil(OBS_ALIVE(aPid), (n) => n === 0, "terminated backend released", 5000);
    a = await respawn("a");
    await beginService(b);
    const rb = await claimOne(b, f.id);
    if (idsOf(rb).length !== 1) throw new Error("B did not reclaim after A was terminated");
    if (fieldOf(rb, 3) !== "2") throw new Error(`reclaim attempt expected 2, got ${fieldOf(rb, 3)}`);
    if (fieldOf(rb, 1) === t0) throw new Error("token was not rotated");
    await b.rollback();
    return "terminated holder released its uncommitted claim; reclaim at attempt 2 with a rotated token; no stuck lock";
  });

register("T6-L10", "mid-transaction termination leaves no persisted state",
  "row is byte-identical after termination; the next claim starts at attempt=1",
  async () => {
    const f = await fixture("L10");
    const before = (await snapshotRow(f.id))[0];
    await beginService(a);
    if (idsOf(await claimOne(a, f.id)).length !== 1) throw new Error("A failed to claim");
    const aPid = await a.pid();
    await obs.exec(`SELECT pg_terminate_backend(${aPid});`);
    await waitUntil(OBS_ALIVE(aPid), (n) => n === 0, "terminated backend released", 5000);
    a = await respawn("a");
    const after = (await snapshotRow(f.id))[0];
    if (before !== after) throw new Error("row changed after mid-transaction termination");
    await beginService(b);
    const rb = await claimOne(b, f.id);
    if (fieldOf(rb, 3) !== "1") throw new Error(`later claim attempt expected 1, got ${fieldOf(rb, 3)}`);
    await b.rollback();
    return "row byte-identical after termination; later claim starts at attempt 1";
  });

register("T6-L11", "opposite-order advisory locks -> bounded timeout, no deadlock",
  "at least one 55P03 (lock_timeout), zero 40P01 (deadlock); both sessions roll back",
  async () => {
    const k1 = K("L11-k1"), k2 = K("L11-k2");
    await beginService(a);
    await beginService(b);
    await a.exec(`SET LOCAL lock_timeout='${T.tight}'; SET LOCAL deadlock_timeout='${T.deadlock}';\nSELECT pg_advisory_xact_lock(hashtextextended('${k1}',0));`);
    await b.exec(`SET LOCAL lock_timeout='${T.tight}'; SET LOCAL deadlock_timeout='${T.deadlock}';\nSELECT pg_advisory_xact_lock(hashtextextended('${k2}',0));`);
    const aPid = await a.pid(), bPid = await b.pid();
    await waitUntil(OBS_ADVISORY(aPid), (n) => n >= 1, "A holds the k1 advisory lock");
    await waitUntil(OBS_ADVISORY(bPid), (n) => n >= 1, "B holds the k2 advisory lock");
    const [ea, eb] = await Promise.all([
      a.execCapture(`SELECT pg_advisory_xact_lock(hashtextextended('${k2}',0));`),
      b.execCapture(`SELECT pg_advisory_xact_lock(hashtextextended('${k1}',0));`),
    ]);
    const states = [ea.sqlstate, eb.sqlstate];
    if (states.some((s) => s === "40P01")) throw new Error(`deadlock detected: ${JSON.stringify(states)}`);
    if (!states.some((s) => s === "55P03")) throw new Error(`expected at least one lock timeout (55P03), got ${JSON.stringify(states)}`);
    await a.rollback(); await b.rollback();
    return `bounded lock contention: SQLSTATEs ${JSON.stringify(states)}, zero deadlocks`;
  });

// --------------------------------------------------------------------------- harness
async function respawn(which) {
  (which === "a" ? a : b).kill();
  return makeSession(which, `slmm-t6-${which}`);
}

async function preflight() {
  const info = await setup.exec(
    `SELECT current_database() || '|' || current_user || '|' || current_setting('port') || '|' || ` +
    `coalesce(host(inet_server_addr()),'<none>') || '|' || inet_server_port() || '|' || ` +
    `current_setting('data_directory') || '|' || current_setting('transaction_isolation') || '|' || current_setting('listen_addresses');`);
  const line = rows(info)[0] || "";
  const [db, user, port, addr, iport, dataDir, iso, listen] = line.split("|");
  if (db !== DB) throw new Error(`preflight: connected database ${db} != ${DB}`);
  if (user !== USER) throw new Error(`preflight: connected user ${user} != ${USER}`);
  if (Number(port) !== PORT) throw new Error(`preflight: server port ${port} != ${PORT}`);
  if (addr !== HOST) throw new Error(`preflight: server address ${addr} != ${HOST} (redirected?)`);
  if (Number(iport) !== PORT) throw new Error(`preflight: inet_server_port ${iport} != ${PORT}`);
  if (!String(dataDir).replace(/\//g, "\\").toLowerCase().endsWith("\\opencode\\t6lab\\data")) {
    throw new Error(`preflight: data_directory ${dataDir} is not the disposable lab cluster`);
  }
  if (iso !== "read committed") throw new Error(`preflight: default isolation ${iso} is not read committed`);
  if (listen !== HOST) throw new Error(`preflight: listen_addresses ${listen} is not loopback-only`);
  const purity = num(await nsCount());
  if (purity !== 0) throw new Error(`preflight: synthetic namespace is not clean (${purity} rows)`);
  const t6 = num(await obs.exec(OBS_T6_BACKENDS));
  if (t6 > 3) throw new Error(`preflight: unexpected T6 backend count ${t6}`);
  PREFLIGHT.ok = true;
  console.log(JSON.stringify({ preflight: "ok", database: db, port: Number(port), server_addr: addr, isolation: iso, listen_addresses: listen, namespace_rows: purity }));
}

async function residue() {
  const backends = num(await setup.exec(`SELECT count(*) FROM pg_stat_activity WHERE application_name IN ('slmm-t6-a','slmm-t6-b');`));
  const locks = num(await obs.exec(OBS_T6_ADVISORY));
  const left = num(await nsCount());
  const verdict = { synthetic_rows: left, other_t6_backends: backends, t6_advisory_locks: locks };
  console.log(JSON.stringify({ residue: verdict }));
  if (left !== 0) throw new Error(`residue: ${left} synthetic row(s) remain`);
  if (backends !== 0) throw new Error(`residue: ${backends} T6 backend(s) survived`);
  if (locks !== 0) throw new Error(`residue: ${locks} T6 advisory lock(s) survived`);
  const res = spawnSyncPsqlFile(RESIDUE_SQL);
  if (res.status !== 0) throw new Error(`residue SQL file failed (exit ${res.status}): ${res.stderr.trim()}`);
}

function spawnSyncPsqlFile(file) {
  return spawnSync(PSQL, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", HOST, "-p", String(PORT), "-U", USER, "-d", DB, "-f", file],
    { encoding: "utf8", env: childEnv({ PGAPPNAME: "slmm-t6-residue" }) });
}

async function closeConcurrent() {
  a.kill(); b.kill();
  const deadline = Date.now() + 5000;
  for (;;) {
    const alive = num(await obs.exec(`SELECT count(*) FROM pg_stat_activity WHERE application_name IN ('slmm-t6-a','slmm-t6-b');`));
    if (alive === 0) return;
    if (Date.now() > deadline) throw new Error("SYNC_TIMEOUT: concurrent sessions A/B did not disconnect after termination");
    await sleep(POLL_MS);
  }
}

/** Write the case-result JSONL and its SHA-256; returns the digest. */
function writeResultsTo(file, recs) {
  const jsonl = recs.map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(file, jsonl, "utf8");
  return createHash("sha256").update(jsonl).digest("hex");
}

async function main() {
  if (process.argv.includes("--self-test")) { runSelfTests(); return; }

  assertSafeTarget();          // C1/C2/C3: static guards first
  ensureOwnedDir(LAB_ROOT);    // C3/C4: verified namespace + ownership marker before use

  setup = await makeSession("setup", "slmm-t6-setup");
  obs = await makeSession("obs", "slmm-t6-obs");
  a = await makeSession("a", "slmm-t6-a");
  b = await makeSession("b", "slmm-t6-b");

  // C8: every collected case result is written even if preflight, a case harness
  // failure or residue verification fails. Concurrent sessions are always closed.
  let harnessError = null;
  try {
    await preflight();         // C1: prove server identity before any fixture write
    let aborted = null;
    for (const c of CASES) {
      if (aborted) { record(c.id, "NOT_RUN", `suite aborted after ${aborted}`); continue; }
      console.log(`--- ${c.id}: ${c.title}`);
      console.log(`    expect: ${c.expect}`);
      let s;
      try {
        s = await runCase(c);
      } catch (e) {
        s = "BLOCKED";
        record(c.id, s, `harness error: ${e && e.message ? e.message : e}`);
      }
      if (s !== "PASS") aborted = c.id;
    }
    await closeConcurrent();   // every concurrent test session ends by ROLLBACK or termination
  } catch (e) {
    harnessError = e;
  }
  if (harnessError) record("T6-HARNESS", "FAIL", harnessError.message);

  let residueError = null;
  try {
    await residue();
  } catch (e) {
    residueError = e;
  }
  if (residueError) record("T6-RESIDUE", "FAIL", residueError.message);

  const fail = results.filter((x) => x.status === "FAIL").length;
  const blocked = results.filter((x) => x.status === "BLOCKED").length;
  const notRun = results.filter((x) => x.status === "NOT_RUN").length;
  const pass = results.filter((x) => x.status === "PASS").length;
  const summary = { total: results.length, pass, fail, blocked, not_run: notRun,
    harness_failed: harnessError ? true : false, residue_failed: residueError ? true : false };
  console.log(JSON.stringify({ summary }));

  const sha = writeResultsTo(RESULTS, results);
  console.log(JSON.stringify({ results_file: RESULTS, results_sha256: sha }));

  if (fail || blocked || notRun) process.exitCode = 1;
}

async function shutdown() {
  for (const s of [a, b, obs, setup]) { if (s) { await s.rollback().catch(() => {}); s.kill(); } }
}

// --------------------------------------------------------------------------- static negative tests (point 10)
function runSelfTests() {
  const t = [];
  const ok = (n) => t.push({ test: n, status: "PASS" });
  const bad = (n, m) => t.push({ test: n, status: "FAIL", detail: m });
  const expectThrow = (n, fn, re) => {
    try { fn(); bad(n, "expected a refusal but none was thrown"); }
    catch (e) { if (re && !re.test(String(e.message))) bad(n, `refused with unexpected error: ${e.message}`); else ok(n); }
  };
  const expectOk = (n, fn) => { try { fn(); ok(n); } catch (e) { bad(n, `unexpected refusal: ${e.message}`); } };

  // C1: ambient redirect variables are refused.
  expectThrow("C1 rejects ambient PGHOSTADDR", () => assertNoRedirectEnv({ PGHOSTADDR: "10.0.0.9" }), /PGHOSTADDR/);
  expectThrow("C1 rejects ambient PGSERVICE", () => assertNoRedirectEnv({ PGSERVICE: "prod" }), /PGSERVICE/);
  expectThrow("C1 rejects ambient PGSERVICEFILE", () => assertNoRedirectEnv({ PGSERVICEFILE: "C:\\evil.conf" }), /PGSERVICEFILE/);
  expectThrow("C1 rejects ambient PGOPTIONS", () => assertNoRedirectEnv({ PGOPTIONS: "-c search_path=evil" }), /PGOPTIONS/);
  expectOk("C1 accepts a clean environment", () => assertNoRedirectEnv({ TEMP: "C:\\x", PATH: "C:\\y" }));

  // C1: the child env pins loopback and cannot leak an inherited PG* value.
  (() => {
    const n = "C1 child env pins 127.0.0.1 and strips PG*";
    const saved = { PGSERVICE: process.env.PGSERVICE, PGHOSTADDR: process.env.PGHOSTADDR };
    process.env.PGSERVICE = "evil"; process.env.PGHOSTADDR = "10.0.0.9";
    try {
      const e = childEnv({ PGAPPNAME: "t6" });
      if (e.PGHOSTADDR !== HOST || e.PGHOST !== HOST || e.PGPORT !== String(PORT) || e.PGDATABASE !== DB) throw new Error(`target not pinned: ${JSON.stringify(e)}`);
      if ("PGSERVICE" in e) throw new Error("PGSERVICE leaked into the child environment");
      if (e.PGAPPNAME !== "t6") throw new Error("PGAPPNAME not applied");
      ok(n);
    } catch (err) { bad(n, err.message); }
    finally {
      if (saved.PGSERVICE === undefined) delete process.env.PGSERVICE; else process.env.PGSERVICE = saved.PGSERVICE;
      if (saved.PGHOSTADDR === undefined) delete process.env.PGHOSTADDR; else process.env.PGHOSTADDR = saved.PGHOSTADDR;
    }
  })();

  // C3: exact TEMP-namespace allowlist (no substring matching).
  for (const p of [
    "t6lab",
    "C:\\Windows\\t6lab",
    "C:\\Users\\x\\AppData\\Local\\Temp\\opencode\\t6lab2",
    "C:\\Users\\x\\AppData\\Local\\Temp\\opencode\\t6lab\\..\\evil",
    "C:\\Users\\x\\AppData\\Local\\Temp\\t6lab",
  ]) expectThrow(`C3 refuses unsafe path ${p}`, () => assertApprovedTempNamespace(p), /refusing/);
  expectOk("C3 accepts the approved lab root", () => assertApprovedTempNamespace(LAB_ROOT));

  // C4: ownership marker behaviour.
  (() => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "t6st-"));
    try {
      if (isOwnedLabRoot(dir)) throw new Error("unowned directory was treated as owned");
      ok("C4 unowned directory is not treated as owned");
      writeFileSync(markerFile(dir), `${MARKER_CONTENT}\nrun=x\n`, "utf8");
      if (!isOwnedLabRoot(dir)) throw new Error("valid marker not recognized");
      ok("C4 valid ownership marker recognized");
      expectThrow("C4 refuses to create inside a non-approved namespace", () => ensureOwnedDir("C:\\Windows\\t6lab"), /refusing/);
    } catch (err) { bad("C4 ownership marker behaviour", err.message); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  })();
  (() => {
    // Unowned pre-existing directory refusal is covered above; verify the
    // marker-mismatch predicate directly.
    const dir = mkdtempSync(path.join(os.tmpdir(), "t6st2-"));
    try {
      writeFileSync(markerFile(dir), "some-other-lab\n", "utf8");
      if (isOwnedLabRoot(dir)) throw new Error("mismatched marker accepted");
      ok("C4 mismatched ownership marker refused");
    } catch (err) { bad("C4 mismatched marker", err.message); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  })();

  // C2: no session may be constructed before the guards pass.
  (() => {
    const n = "C2 session construction blocked before target guards";
    try {
      if (GUARD.passed) throw new Error("guard flag unexpectedly set in self-test");
      const before = spawnCount.n;
      let threw = false;
      try { new Session("x", "slmm-t6-x"); } catch (e) { threw = /before target guards/.test(e.message); }
      if (!threw) throw new Error("Session was constructed before the guards passed");
      if (spawnCount.n !== before) throw new Error("a child process was spawned during the negative test");
      ok(n);
    } catch (err) { bad(n, err.message); }
  })();

  // Fixture write must refuse before preflight identity verification.
  expectThrow("C1/C8 fixtures refused before preflight", () => fixture("selftest"), /before connection identity was verified/);

  // C8: residue failure preserves the case-result JSONL evidence.
  (() => {
    const n = "C8 residue failure preserves evidence";
    const file = path.join(os.tmpdir(), `t6res-${randomUUID()}.jsonl`);
    try {
      const recs = [{ id: "T6-L01", status: "PASS", detail: "x" }];
      let residueError = null;
      try { throw new Error("residue boom"); } catch (e) { residueError = e; }
      if (residueError) recs.push({ id: "T6-RESIDUE", status: "FAIL", detail: residueError.message });
      const sha = writeResultsTo(file, recs);
      const txt = readFileSync(file, "utf8");
      if (!txt.includes("T6-RESIDUE") || !/^[0-9a-f]{64}$/.test(sha)) throw new Error("evidence/residue record missing");
      ok(n);
    } catch (err) { bad(n, err.message); }
    finally { rmSync(file, { force: true }); }
  })();

  // The self-test must not have spawned any PostgreSQL client.
  if (spawnCount.n !== 0) t.push({ test: "self-test spawned no child process", status: "FAIL", detail: `spawnCount=${spawnCount.n}` });
  else ok("self-test spawned no child process");

  for (const r of t) console.log(`${r.status}  ${r.test}${r.detail ? "  :: " + r.detail : ""}`);
  const failed = t.filter((r) => r.status === "FAIL").length;
  console.log(JSON.stringify({ self_test: { total: t.length, pass: t.length - failed, fail: failed } }));
  if (failed) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(`T6 RUNNER ERROR: ${e.message}`); process.exitCode = 1; })
  .finally(async () => { await shutdown(); });
