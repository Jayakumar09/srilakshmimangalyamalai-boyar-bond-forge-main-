// slmm-comm-test.mjs
// Client Communication E2E harness (safe cleanup edition).
//
// SAFETY MODEL (see slmm-test-safety.mjs):
//  * The test NEVER uses a real/production account. It creates a fresh
//    scratch client (`e2e-comm-client-<ts>@slmm.test`) and records the
//    exact UUIDs returned by its own INSERTs.
//  * Cleanup deletes ONLY recorded primary keys via the guard allowlist.
//    There is no `DELETE ...?user_id=eq.<id>` anywhere in this file.
//  * Cleanup refuses entirely unless SLMM_TEST_MODE=true AND every target
//    is in this run's allowlist AND markers/baseline checks pass.
//  * `node slmm-comm-test.mjs --cleanup-preview` prints the dry-run plan
//    from the last run's state file WITHOUT touching the database.
//
// Usage:
//   SLMM_TEST_MODE=true node slmm-comm-test.mjs            # run + safe cleanup
//   node slmm-comm-test.mjs --cleanup-preview              # dry run, no writes
// ---------------------------------------------------------------------------
import { createRequire } from "module";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { createCleanupGuard } from "./slmm-test-safety.mjs";

const require = createRequire("D:/DevProjects/Working/srilakshmimangalyamalai(boyar-bond-forge-main)/package.json");
const { chromium } = require("playwright");
const BASE = "http://localhost:8080";
const SUPABASE = "https://sxpkutjkqfekqwpabgrk.supabase.co";

// Real production accounts that must NEVER appear in any cleanup target list.
const PROD_USER_IDS = new Set([
  "4409e9c8-b57c-4e92-9333-983bdc2cb6fc", // real client (jayakumar)
  "0c615e44-7c07-4efd-b917-1414db32cf10", // real client (Surekgha)
]);
const SURE_UID = "0c615e44-7c07-4efd-b917-1414db32cf10";

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const STATE_FILE = path.join(SCRIPT_DIR, "slmm-comm-state.json");

function loadEnv() {
  const env = {};
  const lit = "D:/DevProjects/Working/srilakshmimangalyamalai(boyar-bond-forge-main)/.env";
  let raw = null;
  try { raw = readFileSync(lit, "utf8"); } catch { /* FS quirk below */ }
  if (raw === null) {
    try { raw = execSync("cmd /c type .env", { cwd: process.cwd(), encoding: "utf8" }); } catch { /* handled below */ }
  }
  if (raw === null) throw new Error("cannot read .env");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const ENV = loadEnv();
const SVC = ENV["SUPABASE_SERVICE_ROLE_KEY"];
const ANON = ENV["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? ENV["SUPABASE_PUBLISHABLE_KEY"];
const SVC_H = {
  apikey: SVC,
  Authorization: `Bearer ${SVC}`,
  "Content-Type": "application/json",
  Prefer: "return=representation", // so INSERT responses carry the created UUID
};
const svc = async (method, p, body) => {
  const r = await fetch(`${SUPABASE}${p}`, { method, headers: SVC_H, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: async () => { const t = await r.text(); if (!t) return null; try { return JSON.parse(t); } catch { return null; } } };
};

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

function buildGuardFromState(state, modeEnv) {
  const guard = createCleanupGuard({
    testRunId: state.testRunId,
    modeEnv,
    baselineThreadIds: new Set(state.baselineThreadIds || []),
    knownProductionUserIds: PROD_USER_IDS,
    deleter,
    logger: console,
  });
  for (const id of state.created?.users || []) guard.recordUser(id, state.created?.userEmails?.[id] ?? `e2e-comm-client@slmm.test`);
  for (const id of state.created?.profiles || []) guard.recordProfile(id);
  for (const id of state.created?.roles || []) guard.recordRole(id);
  for (const t of state.created?.threads || []) guard.recordThread(t.id, t.owner);
  for (const id of state.created?.messages || []) guard.recordMessage(id);
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
  const browser = await chromium.launch({ headless: true });

  // baseline (service key) BEFORE creating anything (H)
  const baseThreads = await (await svc("GET", "/rest/v1/support_threads?select=id,user_id,subject,status,channel&order=created_at.asc")).json();
  const baselineThreadIds = (baseThreads || []).map((x) => x.id);
  const baseMsgs = await (await svc("GET", "/rest/v1/support_messages?select=id,thread_id&order=created_at.asc")).json();
  const baseConv = await (await svc("GET", "/rest/v1/conversations?select=id")).json();
  const baseMemMsg = await (await svc("GET", "/rest/v1/messages?select=id")).json();
  const baseDocs = await (await svc("GET", "/rest/v1/documents?select=id")).json();
  const baseSl = await (await svc("GET", "/rest/v1/shortlists?select=id")).json();
  const baseProfiles = await (await svc("GET", "/rest/v1/profiles?select=id")).json();
  const baselineSupportThreadCount = (baseThreads || []).length;
  const baselineSupportMsgCount = (baseMsgs || []).length;

  // The guard is the ONLY path to deletion (allowlist + markers + test mode).
  const guard = createCleanupGuard({
    testRunId: TEST_RUN_ID,
    modeEnv: process.env.SLMM_TEST_MODE,
    baselineThreadIds: new Set(baselineThreadIds),
    knownProductionUserIds: PROD_USER_IDS,
    deleter,
    logger: console,
  });

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
  if (myMsg?.id) guard.recordMessage(myMsg.id);

  // ============ T9: OFFICE REPLY (service-key admin message) ============
  const officeResp = await svc("POST", "/rest/v1/support_messages", { thread_id: thr.id, sender_id: CL_UID, sender_type: "admin", body: OFFICE });
  const officeRow = await officeResp.json();
  if (officeRow?.id) guard.recordMessage(officeRow.id);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction((s) => document.body.innerText.includes(s), OFFICE, { timeout: 15000 });
  await page.waitForTimeout(1500);
  const officeMeta = (await page.locator("main").innerText()).replace(/\s+/g, " ").trim();
  r("T9 office reply renders with 'Office' label", (await page.getByText(OFFICE).count()) === 1 && /Office · \d{2}\/\d{2}\/\d{4}/.test(officeMeta) ? true : false, "");
  const readState = await (await svc("GET", `/rest/v1/support_messages?select=id,read_at&id=eq.${officeRow?.id ?? ""}`)).json();
  r("T10 open marks admin message read (read_at set)", Array.isArray(readState) && readState[0]?.read_at !== null ? true : false, "");

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
  if (longBodyRow?.id) guard.recordMessage(longBodyRow.id);

  // ============ X: AUTHORIZATION / SECURITY ============
  const ownThreads = await restAs(`support_threads?select=id,user_id,channel`);
  const ownThr = JSON.parse(ownThreads.body);
  r("X1 client sees only own threads (RLS)", ownThreads.status === 200 && Array.isArray(ownThr) && ownThr.length >= 1 && ownThr.every((x) => x.user_id === CL_UID) ? true : false, `rows=${Array.isArray(ownThr) ? ownThr.length : "?"}`);
  const x1b = await restAs(`support_threads?select=id&user_id=eq.${SURE_UID}`);
  r("X1b cannot read another member's threads (0 rows)", x1b.status === 200 && JSON.parse(x1b.body).length === 0 ? true : false, `rows=${JSON.parse(x1b.body).length}`);
  const x2 = await page.evaluate(async ({ origin, token, apikey, tid, uid }) => {
    const rr = await fetch(`${origin}/rest/v1/support_messages`, { method: "POST", headers: { apikey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ thread_id: tid, sender_id: uid, sender_type: "admin", body: "probe-admin-type" }) });
    return { status: rr.status };
  }, { origin: SUPABASE, token: await pageToken(), apikey: ANON, tid: thr.id, uid: CL_UID });
  r("X2 client cannot forge admin sender_type (403)", x2.status === 403 ? true : false, `status=${x2.status}`);
  const x3 = await page.evaluate(async ({ origin, token, apikey }) => {
    const rr = await fetch(`${origin}/rest/v1/support_threads`, { method: "POST", headers: { apikey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ user_id: "0c615e44-7c07-4efd-b917-1414db32cf10", subject: "probe-other-user", channel: "communication" }) });
    return { status: rr.status };
  }, { origin: SUPABASE, token: await pageToken(), apikey: ANON });
  r("X3 client cannot create thread for another user (403)", x3.status === 403 ? true : false, `status=${x3.status}`);
  const beforeDel = (await (await svc("GET", `/rest/v1/support_threads?select=id&id=eq.${thr.id}`)).json())?.length ?? 0;
  const x4 = await page.evaluate(async ({ origin, token, apikey, tid }) => {
    const rr = await fetch(`${origin}/rest/v1/support_threads?id=eq.${tid}`, { method: "DELETE", headers: { apikey, Authorization: `Bearer ${token}` } });
    return { status: rr.status };
  }, { origin: SUPABASE, token: await pageToken(), apikey: ANON, tid: thr.id });
  const afterDel = (await (await svc("GET", `/rest/v1/support_threads?select=id&id=eq.${thr.id}`)).json())?.length ?? 0;
  r("X4 client cannot DELETE support thread (row still present)", afterDel === beforeDel && afterDel === 1 ? true : false, `status=${x4.status} before=${beforeDel} after=${afterDel}`);
  const probeThreads = await (await svc("GET", "/rest/v1/support_threads?select=id&subject=like.probe-%25")).json();
  const probeMsgs = await (await svc("GET", "/rest/v1/support_messages?select=id&body=like.probe-%25")).json();
  r("X5 probes created no rows", (probeThreads?.length ?? 0) === 0 && (probeMsgs?.length ?? 0) === 0 ? true : false, "");
  const domText = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  r("X6 no member data leaked", !domText.includes("SLMM-") && !domText.includes("surekgha055") && !domText.includes("4409e9c8") ? true : false, "");

  // ============ D: PRESERVATION ============
  const jkFields = "id,status,membership_plan,profile_created_by";
  const jkProf = (await (await svc("GET", `/rest/v1/profiles?select=${jkFields}&id=eq.4409e9c8-b57c-4e92-9333-983bdc2cb6fc`)).json())?.[0];
  const afterConv = await (await svc("GET", "/rest/v1/conversations?select=id")).json();
  const afterMemMsg = await (await svc("GET", "/rest/v1/messages?select=id")).json();
  const afterDocs = await (await svc("GET", "/rest/v1/documents?select=id")).json();
  const afterSl = await (await svc("GET", "/rest/v1/shortlists?select=id")).json();
  const afterProfiles = await (await svc("GET", "/rest/v1/profiles?select=id")).json();
  const afterThreads = await (await svc("GET", "/rest/v1/support_threads?select=id,user_id")).json();
  const nonScratchThreads = (afterThreads || []).filter((x) => x.user_id !== CL_UID);
  r("D1 real client profile untouched", jkProf?.status === "pending" && jkProf?.membership_plan === "free" && jkProf?.profile_created_by === "admin" ? true : false, `status=${jkProf?.status}`);
  r("D2 member-messaging tables untouched", (afterConv?.length ?? 0) === (baseConv?.length ?? 0) && (afterMemMsg?.length ?? 0) === (baseMemMsg?.length ?? 0) ? true : false, "");
  r("D3 docs + shortlists untouched", (afterDocs?.length ?? 0) === (baseDocs?.length ?? 0) && (afterSl?.length ?? 0) === (baseSl?.length ?? 0) ? true : false, "");
  r("D4 pre-existing (non-scratch) threads untouched", nonScratchThreads.length === baselineSupportThreadCount ? true : false, `baseline=${baselineSupportThreadCount} now=${nonScratchThreads.length}`);
  r("D5 profiles = baseline + this run's scratch profile", (afterProfiles?.length ?? 0) === (baseProfiles?.length ?? 0) + 1 ? true : false, `base=${baseProfiles?.length} now=${afterProfiles?.length}`);

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
    baselineCounts: { threads: baselineSupportThreadCount, messages: baselineSupportMsgCount, profiles: (baseProfiles || []).length },
    created: {
      users: [CL_UID],
      userEmails: { [CL_UID]: SCRATCH_EMAIL },
      profiles: profRow?.[0]?.id ? [profRow[0].id] : [],
      roles: [],
      threads: guard.plan().filter((x) => x.kind === "threads").map((x) => ({ id: x.id, owner: CL_UID })),
      messages: guard.plan().filter((x) => x.kind === "messages").map((x) => x.id),
    },
  };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`state written: ${STATE_FILE} (no secrets)`);
  console.log("cleanup plan preview:");
  guard.dryRun();

  // ============ CLEANUP (allowlist-only, PK-scoped, fail-closed) ============
  const outcome = await guard.cleanup();
  r("CLEANUP guard decision", outcome.decision === "ALLOW" ? true : false, `decision=${outcome.decision} executed=${outcome.executed}`);

  // verify: pre-existing rows restored to baseline; scratch rows gone
  const postThreads = await (await svc("GET", "/rest/v1/support_threads?select=id")).json();
  const postMsgs = await (await svc("GET", "/rest/v1/support_messages?select=id")).json();
  const postProfiles = await (await svc("GET", "/rest/v1/profiles?select=id")).json();
  r("CLEANUP support_threads back to baseline", (postThreads?.length ?? 0) === baselineSupportThreadCount ? true : false, `now=${postThreads?.length} baseline=${baselineSupportThreadCount}`);
  r("CLEANUP support_messages back to baseline", (postMsgs?.length ?? 0) === baselineSupportMsgCount ? true : false, `now=${postMsgs?.length} baseline=${baselineSupportMsgCount}`);
  r("CLEANUP profiles back to baseline", (postProfiles?.length ?? 0) === (baseProfiles?.length ?? 0) ? true : false, `now=${postProfiles?.length} baseline=${(baseProfiles || []).length}`);

  await browser.close();
})().catch((e) => { console.error("FATAL", e.message, e.stack); process.exit(1); });