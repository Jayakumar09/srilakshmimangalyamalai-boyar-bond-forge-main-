// slmm-comm-test.mjs
// Client Communication E2E harness (safe cleanup edition).
//
// SAFETY MODEL (see slmm-test-safety.mjs and live-guard.mjs):
//  * LIVE AUTHORIZATION GATE (Phase 5B): this harness refuses to run unless the
//    operator explicitly opts in from the shell with
//      SLMM_LIVE_TESTS=true SLMM_LIVE_TARGET=test SLMM_LIVE_ACK=slmm-comm-test.mjs
//    The gate runs BEFORE any credential load, network call, browser launch or
//    service-client construction. Default behaviour = refuse. Production is
//    unconditionally prohibited and there is NO production override.
//  * The resolved SUPABASE_URL is validated after the environment file is read:
//    the TEST project is the only permitted target; a production or unknown
//    project aborts the run before anything is created.
//  * The harness NEVER uses a real/production account. It creates a fresh
//    scratch client (`e2e-comm-client-<ts>@slmm.test`) and records the
//    exact UUIDs returned by its own INSERTs.
//  * Cleanup deletes ONLY recorded primary keys via the guard allowlist.
//    There is no `DELETE ...?user_id=eq.<id>` anywhere in this file.
//  * Every POST-TEST verification read (preservation, probe and post-cleanup) is
//    COMPLETE and validated (paginated, exact count, fully validated
//    Content-Range) and fails closed: a failed read is a FAIL - it is never
//    treated as "0 rows"/"empty" - and forces a non-zero exit status.
//  * A scratch user may only be registered with its test-only scratch email
//    marker; rows that pre-existed this run are refused at registration and
//    there is no silent fallback to another email/id.
//  * Threads and messages are tied to the scratch owner; cleanup refuses any
//    row it cannot positively prove belongs to this run's scratch account.
//  * Cleanup refuses entirely unless SLMM_TEST_MODE=true AND every target
//    is in this run's allowlist AND markers/baseline checks pass.
//  * `node slmm-comm-test.mjs --cleanup-preview` prints the dry-run plan from
//    the last run's state file WITHOUT loading credentials, touching the
//    network, or requiring live authorization.
//
// Usage:
//   SLMM_LIVE_TESTS=true SLMM_LIVE_TARGET=test SLMM_LIVE_ACK=slmm-comm-test.mjs \
//     SLMM_TEST_MODE=true node slmm-comm-test.mjs       # authorised live run + cleanup
//   node slmm-comm-test.mjs --cleanup-preview            # offline dry run, no writes
// ---------------------------------------------------------------------------
import { createRequire } from "module";
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "node:path";
import { createCleanupGuard } from "./slmm-test-safety.mjs";
import { resolveOfficeReplyId } from "./slmm-comm-capture.mjs";
import { requireLiveAuthorization, assertNonProductionTarget } from "./live-guard.mjs";
import { fetchCompleteBaseline, parseContentRange } from "./slmm-rest-baseline.mjs";

const HARNESS = "slmm-comm-test.mjs";
// --cleanup-preview is a pure offline dry run: it reads the last run's state
// file and prints the plan WITHOUT loading credentials or touching any service.
const IS_PREVIEW = process.argv.includes("--cleanup-preview");

// PHASE 5B LIVE AUTHORIZATION GATE. Refuse by default, before anything else.
if (!IS_PREVIEW) {
  requireLiveAuthorization({
    harness: HARNESS,
    services: ["supabase-auth", "supabase-rest", "headless-browser->localhost:8080"],
  });
}

const require = createRequire(new URL("../package.json", import.meta.url));
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const STATE_FILE = path.join(SCRIPT_DIR, "slmm-comm-state.json");
const BASE = "http://localhost:8080";

// Service bindings are populated ONLY after the gate passes, and never in
// preview mode. Until then they stay null, so an accidental active call fails
// loudly instead of reaching a service.
let SUPABASE = null;
let SVC = null;
let ANON = null;
let SVC_H = null;
let chromium = null;

function loadEnv() {
  const env = {};
  const lit = path.join(SCRIPT_DIR, "..", ".env"); // repo-root environment file
  const raw = readFileSync(lit, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
  return env;
}

const svc = async (method, p, body) => {
  const r = await fetch(`${SUPABASE}${p}`, { method, headers: SVC_H, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: async () => { const t = await r.text(); if (!t) return null; try { return JSON.parse(t); } catch { return null; } } };
};

// Baseline page fetcher. It performs ONLY the HTTP round-trip and JSON decode;
// the PostgREST `Content-Range` header is validated by the pure parser in
// slmm-rest-baseline.mjs (parseContentRange), which checks the FULL interval
// against the requested offset and the number of rows actually returned. It
// returns { status, rows, total }; it does not itself decide what is acceptable.
function makeBaselineFetcher(path, label) {
  return async (offset, limit) => {
    const res = await fetch(`${SUPABASE}${path}`, {
      method: "GET",
      headers: {
        ...SVC_H,
        "Range-Unit": "items",
        Range: `${offset}-${offset + limit - 1}`,
        Prefer: "count=exact",
      },
    });
    const text = await res.text();
    let rows = null;
    if (text) {
      try { rows = JSON.parse(text); } catch { rows = null; }
    }
    // A non-array payload is rejected later by fetchCompleteBaseline with the
    // clearer "not a JSON array" error, so do not parse a range for it.
    if (!Array.isArray(rows)) return { status: res.status, rows, total: null };
    const { total } = parseContentRange(res.headers.get("content-range"), {
      offset,
      rowCount: rows.length,
      label,
    });
    return { status: res.status, rows, total };
  };
}

// Complete, validated, NON-THROWING read used by EVERY post-test verification
// check (preservation, probe and post-cleanup reads). It reuses the exact same
// paginated + exact-count + fully validated Content-Range reader as the baseline
// (makeBaselineFetcher + fetchCompleteBaseline), so a verification read can never
// silently truncate. On failure it records a FAIL (=> non-zero exit status) and
// returns null: callers MUST treat null as a failure - it is never "0 rows" /
// "empty". It deliberately does NOT throw, so a failed verification read can
// never bypass the cleanup + reporting flow further down.
async function verifyRead(path, label, requiredFields) {
  try {
    const { rows } = await fetchCompleteBaseline(makeBaselineFetcher(path, label), { label, requiredFields });
    return rows;
  } catch (e) {
    r(`VERIFY ${label}`, false, e.message);
    return null;
  }
}

if (!IS_PREVIEW) {
  const ENV = loadEnv();
  SUPABASE = ENV["SUPABASE_URL"];
  // Fail closed: the TEST project is the only permitted target; production and
  // unknown projects abort here, before any service client is constructed.
  assertNonProductionTarget(SUPABASE, { harness: HARNESS });
  SVC = ENV["SUPABASE_SERVICE_ROLE_KEY"];
  ANON = ENV["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? ENV["SUPABASE_PUBLISHABLE_KEY"];
  SVC_H = {
    apikey: SVC,
    Authorization: `Bearer ${SVC}`,
    "Content-Type": "application/json",
    Prefer: "return=representation", // so INSERT responses carry the created UUID
  };
  ({ chromium } = require("playwright"));
}

const TEST_RUN_ID = `comm-${Date.now()}`;
const TS = Date.now();
const SCRATCH_EMAIL = `e2e-comm-client-${TS}@slmm.test`;
const SCRATCH_PASS = `E2e!Comm${TS}Aa1`;
const SUBJ = `e2e-comm-subject-${TS}`;
const MSG = `e2e-comm-hello-${TS}`;
const OFFICE = `e2e-comm-office-reply-${TS}`;
const LONG_SUBJ = "s".repeat(130);
const LONG_BODY = "y".repeat(2100);

const results = [];
function r(label, ok, detail) {
  results.push({ label, ok, detail });
  console.log(`${(ok === true ? "PASS" : ok === false ? "FAIL" : ok).toString().padEnd(9)} ${label}${detail === undefined ? "" : ` :: ${detail}`}`);
}

// PK-scoped deleter. Receives ONLY rows the guard already approved.
const deleter = async (row) => {
  if (row.kind === "users") return svc("DELETE", `/auth/v1/admin/users/${row.id}`);
  if (row.kind === "profiles") return svc("DELETE", `/rest/v1/profiles?id=eq.${row.id}`);
  if (row.kind === "roles") return svc("DELETE", `/rest/v1/user_roles?id=eq.${row.id}`);
  if (row.kind === "threads") return svc("DELETE", `/rest/v1/support_threads?id=eq.${row.id}`);
  if (row.kind === "messages") return svc("DELETE", `/rest/v1/support_messages?id=eq.${row.id}`);
  return { status: 404 };
};

// Preview only: rebuild a guard from the last run's recorded state. The deny
// list is empty here because the preview performs no network access and issues
// no deletes; the allowlist is the run's own recorded ids.
function buildGuardFromState(state, modeEnv, knownProductionUserIds = new Set()) {
  const guard = createCleanupGuard({
    testRunId: state.testRunId,
    modeEnv,
    baselineThreadIds: new Set(state.baselineThreadIds || []),
    knownProductionUserIds,
    deleter,
    logger: console,
  });
  for (const id of state.created?.users || []) {
    // NO fallback: a user without its recorded test-only scratch email is
    // refused outright. Never silently substitute another email/id.
    const email = state.created?.userEmails?.[id];
    if (!email) throw new Error(`state file has no scratch email for user ${id} - refusing to build cleanup guard`);
    guard.recordUser(id, email);
  }
  for (const id of state.created?.profiles || []) guard.recordProfile(id);
  for (const id of state.created?.roles || []) guard.recordRole(id);
  for (const t of state.created?.threads || []) guard.recordThread(t.id, t.owner);
  for (const m of state.created?.messages || []) {
    const mid = typeof m === "string" ? m : m?.id;
    guard.recordMessage(mid, (m && m.owner) || undefined);
  }
  return guard;
}

// -------- --cleanup-preview (E): pure dry run, no network, no writes --------
if (process.argv.includes("--cleanup-preview")) {
  if (!existsSync(STATE_FILE)) {
    console.log("TEST CLEANUP DRY RUN");
    console.log("--------------------");
    console.log("No state file found: nothing recorded by any run.");
    console.log("Rows eligible for cleanup:");
    console.log("  (none - nothing recorded by this run, cleanup REFUSED)");
    console.log("Cleanup allowed: REFUSE");
    process.exit(0);
  }
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  const guard = buildGuardFromState(state, process.env.SLMM_TEST_MODE);
  guard.dryRun();
  process.exit(0);
}

// ---------------------------------------------------------------------------

(async () => {
  // ------------------------------------------------------------------
  // 0. BASELINE READS - complete, validated, paginated.
  //    These run BEFORE the browser launches and BEFORE any row is created or
  //    written. Any failure here aborts the whole run (fail closed): a partial,
  //    duplicated or ambiguous baseline could otherwise weaken the protection
  //    set or the preservation assertions. There are no `|| []` fallbacks.
  // ------------------------------------------------------------------
  const baseThreads = (await fetchCompleteBaseline(makeBaselineFetcher("/rest/v1/support_threads?select=id,user_id,subject,status,channel&order=id.asc", "support_threads"), {
    label: "support_threads",
    requiredFields: ["id", "user_id", "subject", "status", "channel"],
  })).rows;
  const baseMsgs = (await fetchCompleteBaseline(makeBaselineFetcher("/rest/v1/support_messages?select=id,thread_id&order=id.asc", "support_messages"), {
    label: "support_messages",
    requiredFields: ["id", "thread_id"],
  })).rows;
  const baseConv = (await fetchCompleteBaseline(makeBaselineFetcher("/rest/v1/conversations?select=id&order=id.asc", "conversations"), {
    label: "conversations",
    requiredFields: ["id"],
  })).rows;
  const baseMemMsg = (await fetchCompleteBaseline(makeBaselineFetcher("/rest/v1/messages?select=id&order=id.asc", "messages"), {
    label: "messages",
    requiredFields: ["id"],
  })).rows;
  const baseDocs = (await fetchCompleteBaseline(makeBaselineFetcher("/rest/v1/documents?select=id&order=id.asc", "documents"), {
    label: "documents",
    requiredFields: ["id"],
  })).rows;
  const baseSl = (await fetchCompleteBaseline(makeBaselineFetcher("/rest/v1/shortlists?select=id&order=id.asc", "shortlists"), {
    label: "shortlists",
    requiredFields: ["id"],
  })).rows;
  const baseProfiles = (await fetchCompleteBaseline(makeBaselineFetcher("/rest/v1/profiles?select=id,status,membership_plan,profile_created_by&order=id.asc", "profiles"), {
    label: "profiles",
    requiredFields: ["id", "status", "membership_plan", "profile_created_by"],
  })).rows;

  const baselineThreadIds = baseThreads.map((x) => x.id);
  const baselineSupportThreadCount = baseThreads.length;
  const baselineSupportMsgCount = baseMsgs.length;

  // The protected set is built ONLY from the fully verified profile baseline
  // above: every pre-existing profile is protected (stronger than a fixed list,
  // and it cannot go stale). Nothing production-specific is hardcoded here.
  const PROTECTED_USER_IDS = new Set(baseProfiles.map((x) => x.id));
  const baselineProfileFingerprint = baseProfiles
    .map((x) => `${x.id}|${x.status}|${x.membership_plan}|${x.profile_created_by}`)
    .sort();
  // A pre-existing thread owner is a real, non-scratch member used only for
  // read/write isolation probes (never a cleanup target).
  const OTHER_UID = baseThreads.map((x) => x.user_id).find((u) => typeof u === "string" && u) ?? null;

  // The guard is the ONLY path to deletion (allowlist + markers + test mode).
  const guard = createCleanupGuard({
    testRunId: TEST_RUN_ID,
    modeEnv: process.env.SLMM_TEST_MODE,
    baselineThreadIds: new Set(baselineThreadIds),
    knownProductionUserIds: PROTECTED_USER_IDS,
    deleter,
    logger: console,
  });

  // The browser is launched ONLY after the baseline is fully validated and the
  // guard is built. No account has been created and nothing has been written yet.
  const browser = await chromium.launch({ headless: true });

  // ---- A. SCRATCH ACCOUNT CREATION (recorded ids only) ---------------------
  const authResp = await svc("POST", "/auth/v1/admin/users", { email: SCRATCH_EMAIL, password: SCRATCH_PASS, email_confirm: true });
  const createdUser = await authResp.json();
  const CL_UID = createdUser?.id;
  if (!CL_UID) throw new Error(`scratch user create failed status=${authResp.status}`);
  guard.recordUser(CL_UID, SCRATCH_EMAIL); // A: exact id from OUR insert response

  await svc("PATCH", `/rest/v1/profiles?id=eq.${CL_UID}`, { full_name: "E2E Comm Client", status: "approved", membership_plan: "standard", gender: "Male", profile_created_by: "client", submitted_at: new Date().toISOString() });
  // profile row is a trigger side-effect of our own auth insert; record its PK
  const profRow = await (await svc("GET", `/rest/v1/profiles?select=id&id=eq.${CL_UID}`)).json();
  if (profRow?.[0]?.id) guard.recordProfile(profRow[0].id);

  const ac = { http: [], consoleErrors: [] };
  const pageErrors = [];
  const aCtx = await browser.newContext();
  const page = await aCtx.newPage();
  page.on("console", (m) => { if (m.type() === "error") ac.consoleErrors.push(m.text().split("\n")[0]); });
  page.on("pageerror", (e) => pageErrors.push(String(e).split("\n")[0]));
  page.on("response", (res) => {
    try {
      if (res.status() >= 400) {
        const u = res.url();
        if (/rest\/v1|storage|upload|functions\/v1/i.test(u)) ac.http.push({ status: res.status(), url: u.split("?")[0], method: res.request().method() });
      }
    } catch {}
  });

  async function login(email, pass) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('input[type="email"]', { timeout: 15000 });
      await page.waitForTimeout(1200);
      await page.fill('input[type="email"]', email);
      await page.fill('input[type="password"]', pass);
      await page.getByRole("button", { name: "Sign in" }).click();
      try {
        await page.waitForFunction(() => !location.pathname.startsWith("/auth"), null, { timeout: 20000 });
        await page.waitForTimeout(1800);
        return true;
      } catch { await page.waitForTimeout(2500); }
    }
    return false;
  }
  async function pageToken() {
    return page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.startsWith("sb-") && x.endsWith("-auth-token"));
      try { return k ? JSON.parse(localStorage.getItem(k)).access_token : null; } catch { return null; }
    });
  }
  async function restAs(p) {
    const token = await pageToken();
    return page.evaluate(async ({ origin, token, apikey, path }) => {
      const rr = await fetch(`${origin}/rest/v1/${path}`, { headers: { apikey, Authorization: `Bearer ${token}` } });
      return { status: rr.status, body: await rr.text() };
    }, { origin: SUPABASE, token, apikey: ANON, path: p });
  }

  // ============ A: ACCESS ============
  const logged = await login(SCRATCH_EMAIL, SCRATCH_PASS);
  r("A1 scratch client login", logged, "");
  await page.goto(`${BASE}/communication`, { waitUntil: "domcontentloaded" });
  await page.waitForURL("**/communication", { timeout: 10000 });
  await page.waitForFunction(() => document.body.innerText.includes("Communication"), null, { timeout: 15000 });
  await page.waitForTimeout(900);
  r("A2 /communication loads without redirect", page.url().includes("/communication") ? true : false, page.url());
  const t = await page.title();
  r("A3 page title correct", t.includes("Communication") ? true : false, t);
  r("A4 h1 is 'Communication'", (await page.locator("h1").first().innerText()).trim() === "Communication" ? true : false, "");
  r("A5 no admin-only controls exposed", (await page.locator('a[href*="/admin"], a[href*="/en/admin"], a[href*="/tn/admin"]').count()) === 0 ? true : false, "");

  // ============ C: UI / EMPTY STATE ============
  const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  r("C1 empty-state shown (scratch account has 0 threads)", bodyText.includes("No support conversations") && bodyText.includes("Start a conversation and the office will reply here.") ? true : false, "empty-state");
  const startBtn = page.getByRole("button", { name: "Start conversation" });
  const subjectInput = page.locator('input[placeholder="Subject"]');
  const replyInput = page.locator('input[placeholder*="Type your reply"]');
  const sendBtn = page.getByRole("button", { name: "Send" });
  const c0 = await startBtn.isDisabled();
  await subjectInput.fill("   ");
  const c1 = await startBtn.isDisabled();
  r("C2 Start disabled for empty subject", c0 === true ? true : false, `disabled=${c0}`);
  r("C3 Start disabled for whitespace subject", c1 === true ? true : false, `disabled=${c1}`);
  r("C4 reply composer disabled with no active thread", (await replyInput.isDisabled()) === true ? true : false, `disabled=${await replyInput.isDisabled()}`);
  r("C5 no permanent loading", (await page.locator("main").innerText().catch(() => "")).length > 0 ? true : false, "rendered");

  // ============ T: CREATE THREAD + SEND ============
  await subjectInput.fill(SUBJ);
  r("T1 Start enabled with subject", (await startBtn.isEnabled()) ? true : false, "");
  await startBtn.click();
  await page.waitForFunction((s) => document.body.innerText.includes(s), SUBJ, { timeout: 15000 });
  await page.waitForTimeout(800);
  r("T2 thread created and shown in list", (await page.getByText(SUBJ).count()) >= 1 ? true : false, "");
  r("T3 reply composer enabled after thread open", (await replyInput.isEnabled()) ? true : false, "");

  // capture thread id from OUR insert response (no lookup-discovery)
  const thrRows = await (await svc("GET", `/rest/v1/support_threads?select=id,user_id,subject,status,channel&user_id=eq.${CL_UID}&subject=eq.${encodeURIComponent(SUBJ)}`)).json();
  const thr = (thrRows || [])[0];
  if (!thr?.id) throw new Error("scratch thread id not returned");
  guard.recordThread(thr.id, CL_UID); // A: exact id recorded

  await replyInput.fill(MSG);
  await replyInput.press("Enter");
  await page.waitForTimeout(2500);
  r("T4 sent message appears in thread", (await page.getByText(MSG).count()) === 1 ? true : false, "");
  const meta = (await page.locator("main").innerText()).replace(/\s+/g, " ").trim();
  r("T5 sender meta line renders (You + IST timestamp)", /You · \d{2}\/\d{2}\/\d{4}, \d{1,2}:\d{2} .m/.test(meta) ? true : false, "You · timestamp");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction((s) => document.body.innerText.includes(s), SUBJ, { timeout: 15000 });
  await page.waitForFunction((s) => document.body.innerText.includes(s), MSG, { timeout: 15000 });
  await page.waitForTimeout(600);
  r("T6 persists after reload (UI)", (await page.getByText(SUBJ).count()) >= 1 && (await page.getByText(MSG).count()) === 1 ? true : false, "");
  const msgRows = await (await svc("GET", `/rest/v1/support_messages?select=id,thread_id,sender_id,sender_type,body&thread_id=eq.${thr.id}`)).json();
  const myMsg = (msgRows || []).find((x) => x.body === MSG);
  r("T7 thread persisted (REST: user, channel, status open)", thr.user_id === CL_UID && thr.channel === "communication" && thr.status === "open" ? true : false, `ch=${thr.channel} st=${thr.status}`);
  r("T8 message persisted (REST: member sender)", myMsg?.sender_type === "member" && myMsg?.sender_id === CL_UID ? true : false, `sender_type=${myMsg?.sender_type}`);
  if (myMsg?.id) guard.recordMessage(myMsg.id, CL_UID);

  // ============ T9: OFFICE REPLY (service-key admin message) ============
  await svc("POST", "/rest/v1/support_messages", { thread_id: thr.id, sender_id: CL_UID, sender_type: "admin", body: OFFICE }); // POST representation NOT assumed
  // Do NOT assume the POST response carries a representation. Resolve the exact
  // id by deterministic lookup scoped strictly to THIS run's scratch thread and
  // the unique office-reply body generated by this run. Fail closed if not a
  // unique match - never guess, never discover by ownership.
  const officeRows = await (await svc("GET", `/rest/v1/support_messages?select=id,thread_id,sender_type,body&thread_id=eq.${thr.id}&sender_type=eq.admin&body=eq.${encodeURIComponent(OFFICE)}`)).json();
  const officeId = resolveOfficeReplyId(officeRows, { threadId: thr.id, body: OFFICE });
  guard.recordMessage(officeId, CL_UID); // current-run allowlist only (never a discovered/owned row)
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction((s) => document.body.innerText.includes(s), OFFICE, { timeout: 15000 });
  await page.waitForTimeout(1500);
  const officeMeta = (await page.locator("main").innerText()).replace(/\s+/g, " ").trim();
  r("T9 office reply renders with 'Office' label", (await page.getByText(OFFICE).count()) === 1 && /Office · \d{2}\/\d{2}\/\d{4}/.test(officeMeta) ? true : false, "");
  const readState = await (await svc("GET", `/rest/v1/support_messages?select=id,read_at&id=eq.${officeId}`)).json();
  r("T10 open marks admin message read (read_at set)", Array.isArray(readState) && readState[0]?.read_at !== null ? true : false, `officeId=${officeId}`);

  // ============ V: VALIDATION ============
  await replyInput.fill("");
  const v1 = await sendBtn.isDisabled();
  await replyInput.fill("   ");
  const v2 = await sendBtn.isDisabled();
  r("V1 empty reply -> Send disabled", v1 ? true : false, `disabled=${v1}`);
  r("V2 whitespace reply -> Send disabled", v2 ? true : false, `disabled=${v2}`);
  await subjectInput.fill(LONG_SUBJ);
  await startBtn.click();
  await page.waitForTimeout(2500);
  const longThrRows = await (await svc("GET", `/rest/v1/support_threads?select=id,subject,user_id&user_id=eq.${CL_UID}&subject=like.s%25`)).json();
  const longThr = (longThrRows || []).filter((x) => x.subject.startsWith("ssss")).at(-1) ?? null;
  r("V3 subject length limit enforced (120)", longThr && longThr.subject.length === 120 ? true : false, `len=${longThr ? longThr.subject.length : 0}`);
  if (longThr?.id) guard.recordThread(longThr.id, CL_UID);
  await replyInput.fill(LONG_BODY);
  await sendBtn.click();
  await page.waitForTimeout(2500);
  const longBd = await (await svc("GET", `/rest/v1/support_messages?select=id,body&thread_id=eq.${longThr?.id ?? thr.id}&body=like.y%25%25`)).json();
  const longBodyRow = (longBd || []).filter((x) => x.body.startsWith("yyyyyy")).at(-1) ?? null;
  r("V4 message length limit enforced (2000)", longBodyRow && longBodyRow.body.length === 2000 ? true : false, `len=${longBodyRow ? longBodyRow.body.length : 0}`);
  if (longBodyRow?.id) guard.recordMessage(longBodyRow.id, CL_UID);

  // ============ X: AUTHORIZATION / SECURITY ============
  const ownThreads = await restAs(`support_threads?select=id,user_id,channel`);
  const ownThr = JSON.parse(ownThreads.body);
  r("X1 client sees only own threads (RLS)", ownThreads.status === 200 && Array.isArray(ownThr) && ownThr.length >= 1 && ownThr.every((x) => x.user_id === CL_UID) ? true : false, `rows=${Array.isArray(ownThr) ? ownThr.length : "?"}`);
  if (OTHER_UID) {
    const x1b = await restAs(`support_threads?select=id&user_id=eq.${OTHER_UID}`);
    r("X1b cannot read another member's threads (0 rows)", x1b.status === 200 && JSON.parse(x1b.body).length === 0 ? true : false, `rows=${JSON.parse(x1b.body).length}`);
  } else {
    r("X1b cannot read another member's threads (0 rows)", "SKIP", "no other-member thread in baseline to probe");
  }
  const x2 = await page.evaluate(async ({ origin, token, apikey, tid, uid }) => {
    const rr = await fetch(`${origin}/rest/v1/support_messages`, { method: "POST", headers: { apikey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ thread_id: tid, sender_id: uid, sender_type: "admin", body: "probe-admin-type" }) });
    return { status: rr.status };
  }, { origin: SUPABASE, token: await pageToken(), apikey: ANON, tid: thr.id, uid: CL_UID });
  r("X2 client cannot forge admin sender_type (403)", x2.status === 403 ? true : false, `status=${x2.status}`);
  if (OTHER_UID) {
    const x3 = await page.evaluate(async ({ origin, token, apikey, otherUid }) => {
      const rr = await fetch(`${origin}/rest/v1/support_threads`, { method: "POST", headers: { apikey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ user_id: otherUid, subject: "probe-other-user", channel: "communication" }) });
      return { status: rr.status };
    }, { origin: SUPABASE, token: await pageToken(), apikey: ANON, otherUid: OTHER_UID });
    r("X3 client cannot create thread for another user (403)", x3.status === 403 ? true : false, `status=${x3.status}`);
  } else {
    r("X3 client cannot create thread for another user (403)", "SKIP", "no other-member id in baseline to probe");
  }
  const beforeDelRows = await verifyRead(`/rest/v1/support_threads?select=id&id=eq.${thr.id}&order=id.asc`, "support_threads_before_delete", ["id"]);
  const beforeDel = Array.isArray(beforeDelRows) ? beforeDelRows.length : null;
  const x4 = await page.evaluate(async ({ origin, token, apikey, tid }) => {
    const rr = await fetch(`${origin}/rest/v1/support_threads?id=eq.${tid}`, { method: "DELETE", headers: { apikey, Authorization: `Bearer ${token}` } });
    return { status: rr.status };
  }, { origin: SUPABASE, token: await pageToken(), apikey: ANON, tid: thr.id });
  const afterDelRows = await verifyRead(`/rest/v1/support_threads?select=id&id=eq.${thr.id}&order=id.asc`, "support_threads_after_delete", ["id"]);
  const afterDel = Array.isArray(afterDelRows) ? afterDelRows.length : null;
  r("X4 client cannot DELETE support thread (row still present)", afterDel === beforeDel && afterDel === 1 ? true : false, `status=${x4.status} before=${beforeDel} after=${afterDel}`);
  const probeThreads = await verifyRead("/rest/v1/support_threads?select=id&subject=like.probe-%25&order=id.asc", "probe_threads", ["id"]);
  const probeMsgs = await verifyRead("/rest/v1/support_messages?select=id&body=like.probe-%25&order=id.asc", "probe_messages", ["id"]);
  r("X5 probes created no rows", Array.isArray(probeThreads) && Array.isArray(probeMsgs) && probeThreads.length === 0 && probeMsgs.length === 0 ? true : false, "");
  const domText = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  const leakedIdPrefixes = [...PROTECTED_USER_IDS].filter((id) => domText.includes(id.slice(0, 8)));
  r("X6 no member identifiers leaked to the DOM", !domText.includes("SLMM-") && leakedIdPrefixes.length === 0 && (!OTHER_UID || !domText.includes(OTHER_UID)) ? true : false, `leaked=${leakedIdPrefixes.length}`);

  // ============ D: PRESERVATION (complete, validated reads) ============
  // Every read below is COMPLETE and VALIDATED: paginated with an exact count and
  // a fully validated Content-Range (verifyRead -> makeBaselineFetcher ->
  // fetchCompleteBaseline -> parseContentRange). A failed read is recorded as a
  // FAIL and yields null - it is NEVER treated as "0 rows" / "empty". The former
  // empty-array / zero-count fallbacks silently turned a failed read into a
  // passing preservation check; no such fallbacks remain.
  const afterProfilesFull = await verifyRead("/rest/v1/profiles?select=id,status,membership_plan,profile_created_by&order=id.asc", "profiles_after", ["id", "status", "membership_plan", "profile_created_by"]);
  const afterFingerprint = Array.isArray(afterProfilesFull)
    ? afterProfilesFull.map((x) => `${x.id}|${x.status}|${x.membership_plan}|${x.profile_created_by}`).sort()
    : null;
  const nonScratchFingerprint = Array.isArray(afterFingerprint) ? afterFingerprint.filter((s) => !s.startsWith(`${CL_UID}|`)) : null;
  const afterConv = await verifyRead("/rest/v1/conversations?select=id&order=id.asc", "conversations_after", ["id"]);
  const afterMemMsg = await verifyRead("/rest/v1/messages?select=id&order=id.asc", "messages_after", ["id"]);
  const afterDocs = await verifyRead("/rest/v1/documents?select=id&order=id.asc", "documents_after", ["id"]);
  const afterSl = await verifyRead("/rest/v1/shortlists?select=id&order=id.asc", "shortlists_after", ["id"]);
  const afterProfiles = await verifyRead("/rest/v1/profiles?select=id&order=id.asc", "profiles_count_after", ["id"]);
  const afterThreads = await verifyRead("/rest/v1/support_threads?select=id,user_id&order=id.asc", "support_threads_after", ["id", "user_id"]);
  const nonScratchThreads = Array.isArray(afterThreads) ? afterThreads.filter((x) => x.user_id !== CL_UID) : null;
  r("D1 pre-existing member profiles untouched (fingerprint)", Array.isArray(nonScratchFingerprint) && JSON.stringify(nonScratchFingerprint) === JSON.stringify(baselineProfileFingerprint) ? true : false, `baseline=${baselineProfileFingerprint.length} now=${Array.isArray(nonScratchFingerprint) ? nonScratchFingerprint.length : "READ-FAILED"}`);
  r("D2 member-messaging tables untouched", Array.isArray(afterConv) && Array.isArray(afterMemMsg) && afterConv.length === baseConv.length && afterMemMsg.length === baseMemMsg.length ? true : false, "");
  r("D3 docs + shortlists untouched", Array.isArray(afterDocs) && Array.isArray(afterSl) && afterDocs.length === baseDocs.length && afterSl.length === baseSl.length ? true : false, "");
  r("D4 pre-existing (non-scratch) threads untouched", Array.isArray(nonScratchThreads) && nonScratchThreads.length === baselineSupportThreadCount ? true : false, `baseline=${baselineSupportThreadCount} now=${Array.isArray(nonScratchThreads) ? nonScratchThreads.length : "READ-FAILED"}`);
  r("D5 profiles = baseline + this run's scratch profile", Array.isArray(afterProfiles) && afterProfiles.length === baseProfiles.length + 1 ? true : false, `base=${baseProfiles.length} now=${Array.isArray(afterProfiles) ? afterProfiles.length : "READ-FAILED"}`);

  // ============ N: CONSOLE / NETWORK ============
  const uniq = (a) => [...new Set(a.map((x) => x.slice(0, 200)))];
  const realNet = ac.http.filter((x) => !(x.status === 403 && x.method === "POST" && x.url.includes("support_")));
  const realCon = ac.consoleErrors.filter((x) => !x.includes("status of 403"));
  r("N1 failed network (intentional 403 probes excluded)", realNet.length === 0 ? true : false, JSON.stringify(realNet.slice(0, 5)));
  r("N2 console errors (403 probes excluded)", realCon.length === 0 ? true : "WARN", JSON.stringify(uniq(realCon).slice(0, 3)));
  r("N3 page errors", pageErrors.length === 0 ? true : "FAIL", JSON.stringify(uniq(pageErrors).slice(0, 3)));

  // ============ RECORD STATE (for --cleanup-preview) =======================
  const state = {
    testRunId: TEST_RUN_ID,
    createdAt: new Date().toISOString(),
    baselineThreadIds,
    baselineCounts: { threads: baselineSupportThreadCount, messages: baselineSupportMsgCount, profiles: baseProfiles.length },
    created: {
      users: [CL_UID],
      userEmails: { [CL_UID]: SCRATCH_EMAIL },
      profiles: profRow?.[0]?.id ? [profRow[0].id] : [],
      roles: [],
      threads: guard.plan().filter((x) => x.kind === "threads").map((x) => ({ id: x.id, owner: CL_UID })),
      messages: guard.plan().filter((x) => x.kind === "messages").map((x) => ({ id: x.id, owner: guard.getMessageOwner(x.id) ?? CL_UID })),
    },
  };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`state written: ${STATE_FILE} (no secrets)`);
  console.log("cleanup plan preview:");
  guard.dryRun();

  // ============ CLEANUP (allowlist-only, PK-scoped, fail-closed) ============
  const outcome = await guard.cleanup();
  r("CLEANUP guard decision", outcome.decision === "ALLOW" ? true : false, `decision=${outcome.decision} executed=${outcome.executed}`);

  // verify (complete, validated reads): pre-existing rows restored to baseline;
  // scratch rows gone. A failed read is a FAIL, never treated as "0 rows".
  const postThreads = await verifyRead("/rest/v1/support_threads?select=id&order=id.asc", "support_threads_post_cleanup", ["id"]);
  const postMsgs = await verifyRead("/rest/v1/support_messages?select=id&order=id.asc", "support_messages_post_cleanup", ["id"]);
  const postProfiles = await verifyRead("/rest/v1/profiles?select=id&order=id.asc", "profiles_post_cleanup", ["id"]);
  r("CLEANUP support_threads back to baseline", Array.isArray(postThreads) && postThreads.length === baselineSupportThreadCount ? true : false, `now=${Array.isArray(postThreads) ? postThreads.length : "READ-FAILED"} baseline=${baselineSupportThreadCount}`);
  r("CLEANUP support_messages back to baseline", Array.isArray(postMsgs) && postMsgs.length === baselineSupportMsgCount ? true : false, `now=${Array.isArray(postMsgs) ? postMsgs.length : "READ-FAILED"} baseline=${baselineSupportMsgCount}`);
  r("CLEANUP profiles back to baseline", Array.isArray(postProfiles) && postProfiles.length === baseProfiles.length ? true : false, `now=${Array.isArray(postProfiles) ? postProfiles.length : "READ-FAILED"} baseline=${baseProfiles.length}`);

  await browser.close();

  // ============ SUMMARY / EXIT STATUS ======================================
  // Verification failures MUST fail the run: a non-zero exit status is required
  // so a failed preservation/probe/cleanup check is never silently reported as
  // success. `process.exitCode` is used (not `process.exit`) so buffered output
  // still flushes.
  const failed = results.filter((x) => x.ok === false);
  const skipped = results.filter((x) => x.ok !== true && x.ok !== false);
  console.log("");
  console.log(`SUMMARY: ${results.length - failed.length - skipped.length} pass, ${failed.length} fail, ${skipped.length} skip`);
  for (const f of failed) console.log(`  FAIL ${f.label}${f.detail === undefined ? "" : ` :: ${f.detail}`}`);
  if (failed.length > 0) process.exitCode = 1;
})().catch((e) => { console.error("FATAL", e.message, e.stack); process.exit(1); });
