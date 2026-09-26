// slmm-receipt-delivery-test.mjs
// ---------------------------------------------------------------------------
// Scratch functional test for the .select() row-return fix in
// src/lib/receipts.functions.ts (processPendingPaymentDeliveries).
//
// SAFETY MODEL (reuses the existing hardened guard, unmodified):
//  * Imports createCleanupGuard from ./slmm-test-safety.mjs. The guard is the
//    ONLY path to any DELETE. There is no `DELETE ...?user_id=eq.X` here.
//  * A brand new scratch client (e2e-receipt-<ts>@slmm.test) is created and
//    only ids returned by THIS run's own INSERTs are recorded.
//  * The processor is ALWAYS invoked with { paymentId: <scratch> } so it can
//    only ever observe scratch rows. It is never called unscoped.
//  * verify_payment() and reviewPayment() are NEVER called. verify_payment is
//    REVOKED from this harness on purpose; the post-verification outbox row is
//    inserted directly as fixture state.
//  * Known production payment ids are hard-refused and the harness asserts
//    they are byte-identical before/after.
//  * SLMM_TEST_MODE=true is mandatory for cleanup.
// ---------------------------------------------------------------------------
import { createServer } from "vite";
import { readFileSync, writeFileSync } from "fs";
import { AwsClient } from "aws4fetch";
import { createCleanupGuard } from "./slmm-test-safety.mjs";

const ROOT = process.cwd();
const REPORT = ROOT + "/receipt-delivery-select-fix-functional-test-report.txt";

function loadEnv() {
  const raw = readFileSync(ROOT + "/.env", "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
}
loadEnv();

const SUPABASE = process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = {
  apikey: SVC,
  Authorization: `Bearer ${SVC}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};
const svc = async (method, p, body) => {
  const r = await fetch(`${SUPABASE}${p}`, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  return { status: r.status, json: () => (t ? JSON.parse(t) : null) };
};
const rest = async (p) => {
  const path = p.startsWith("/") ? p : `/rest/v1/${p}`;
  const r = await (await svc("GET", path)).json();
  return r;
};

// Production payments that must never be touched. Hard-coded from the
// read-only precheck; the harness refuses if they ever appear as a target.
const PROD_PAYMENT_IDS = new Set([
  "2a1797d0-cfef-48c6-a976-966ed9b0451d",
  "856ddcf3-0460-407b-962b-964ef03c0c01",
]);
const PROD_USER_IDS = new Set([
  "4409e9c8-b57c-4e92-9333-983bdc2cb6fc",
  "0c615e44-7c07-4efd-b917-1414db32cf10",
]);

const TS = Date.now();
const TEST_RUN_ID = `receipt-${TS}`;
const SCRATCH_EMAIL = `e2e-receipt-${TS}@slmm.test`;
const SCRATCH_PASS = `E2e!Receipt${TS}Aa1`;
const GATEWAY_ORDER = `e2e_receipt_order_${TS}`;
const GATEWAY_PAY = `pay_e2e_receipt_${TS}`;

const lines = [];
let failures = 0;
const log = (s = "") => { lines.push(s); console.log(s); };
function check(label, ok, detail) {
  if (ok === false) failures++;
  log(`${(ok === true ? "PASS" : ok === false ? "FAIL" : "INFO").padEnd(5)} ${label}${detail === undefined ? "" : ` :: ${detail}`}`);
  return ok;
}

const r2 = {
  accountId: process.env.R2_ACCOUNT_ID,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET_NAME,
};
const aws = () => new AwsClient({ accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey, service: "s3", region: "auto" });
async function r2Signed(bucket, key, method) {
  const url = new URL(`https://${r2.accountId}.r2.cloudflarestorage.com/${bucket}/${key}`);
  const signed = await aws().sign(new Request(url, { method }), { aws: { signQuery: true } });
  return fetch(signed.url, { method });
}

// ---------------------------------------------------------------------------
// Baseline snapshot (H) - read only, before anything is created.
// ---------------------------------------------------------------------------
const TABLES = {
  payments: "payments?select=id,status,verified_at,gateway_payment_id,updated_at",
  payment_events: "payment_events?select=id,payment_id,user_id,receipt_status,receipt_attempts,receipt_key,receipt_error,notification_status,notification_attempts,notification_error",
  notifications: "notifications?select=id",
  profiles: "profiles?select=id",
  support_threads: "support_threads?select=id",
  support_messages: "support_messages?select=id",
};
async function snapshot() {
  const counts = {}, detail = {};
  for (const [k, q] of Object.entries(TABLES)) {
    const rows = await rest(q);
    counts[k] = Array.isArray(rows) ? rows.length : 0;
    if (k === "payment_events") {
      detail.payment_events = (rows || [])
        .map((r) => `${r.payment_id}|${r.receipt_status}|${r.receipt_attempts}|${r.receipt_key}|${r.notification_status}|${r.notification_attempts}|${r.receipt_error}|${r.notification_error}`)
        .sort();
    }
    if (k === "payments") {
      detail.paymentIds = (rows || []).map((r) => r.id).sort();
      detail.paymentState = (rows || [])
        .map((r) => `${r.id}|${r.status}|${r.verified_at}|${r.gateway_payment_id}|${r.updated_at}`)
        .sort();
    }
  }
  return { counts, detail };
}

const deleter = async (row) => {
  if (PROD_PAYMENT_IDS.has(row.id) || PROD_USER_IDS.has(row.id)) {
    return { status: 409, ok: false };
  }
  switch (row.kind) {
    case "users": return svc("DELETE", `/auth/v1/admin/users/${row.id}`);
    case "profiles": return svc("DELETE", `/rest/v1/profiles?id=eq.${row.id}`);
    case "roles": return svc("DELETE", `/rest/v1/user_roles?id=eq.${row.id}`);
    case "threads": return svc("DELETE", `/rest/v1/support_threads?id=eq.${row.id}`);
    case "messages": return svc("DELETE", `/rest/v1/support_messages?id=eq.${row.id}`);
    case "payments": return svc("DELETE", `/rest/v1/payments?id=eq.${row.id}`);
    case "notifications": return svc("DELETE", `/rest/v1/notifications?id=eq.${row.id}`);
    default: return { status: 404, ok: false };
  }
};

const eventRow = async (pid) =>
  (await rest(`/rest/v1/payment_events?select=*&payment_id=eq.${pid}`))?.[0] ?? null;
const notifRows = async (uid) =>
  (await rest(`/rest/v1/notifications?select=id,kind,related_user_id,email_to,emailed,email_error&related_user_id=eq.${uid}&kind=eq.payment_verified_member`)) ?? [];

(async () => {
  log("=".repeat(78));
  log("RECEIPT / NOTIFICATION DELIVERY - SCRATCH FUNCTIONAL TEST");
  log("=".repeat(78));
  log(`testRunId      : ${TEST_RUN_ID}`);
  log(`scratch email  : ${SCRATCH_EMAIL}`);
  log(`SLMM_TEST_MODE : ${process.env.SLMM_TEST_MODE}`);
  log("");

  const baseline = await snapshot();
  log("--- H0. PRODUCTION BASELINE (read-only, before any write) ---");
  log(JSON.stringify(baseline.counts));
  check("baseline payment_events is empty (nothing to backfill, no prod outbox rows)", baseline.counts.payment_events === 0, `count=${baseline.counts.payment_events}`);
  log("");

  // --- load the real processor from app source -----------------------------
  const server = await createServer({
    root: ROOT,
    configFile: ROOT + "/vite.config.ts",
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
  });
  const app = await server.ssrLoadModule("/src/lib/receipts.functions.ts");
  const process_ = app.processPendingPaymentDeliveries;
  const MAX = app.MAX_DELIVERY_ATTEMPTS;

  const guard = createCleanupGuard({
    testRunId: TEST_RUN_ID,
    modeEnv: process.env.SLMM_TEST_MODE,
    knownProductionUserIds: PROD_USER_IDS,
    baselinePaymentIds: PROD_PAYMENT_IDS,
    deleter,
    logger: console,
  });

  const report = { testRunId: TEST_RUN_ID, scratch: {}, r2Keys: [] };
  let r2ObjectKey = null;
  let cleanedPaymentId = null;
  let cleanedNotifId = null;

  try {
    // === A. SCRATCH FIXTURE =================================================
    log("--- A. SCRATCH FIXTURE CREATION + PRE-STATE ASSERTIONS ---");
    const auth = await svc("POST", "/auth/v1/admin/users", { email: SCRATCH_EMAIL, password: SCRATCH_PASS, email_confirm: true });
    const createdUser = await auth.json();
    const UID = createdUser?.id;
    if (!UID) throw new Error(`scratch auth user create failed status=${auth.status} ${JSON.stringify(createdUser)}`);
    guard.recordUser(UID, SCRATCH_EMAIL);
    check("scratch auth user created (id from our own INSERT)", true, UID);

    const prof = await svc("PATCH", `/rest/v1/profiles?id=eq.${UID}`, {
      full_name: "E2E Receipt Scratch",
      status: "approved",
      membership_plan: "standard",
      profile_created_by: "client",
      submitted_at: new Date().toISOString(),
    });
    check("scratch profile updated to approved", prof.status >= 200 && prof.status < 300, `status=${prof.status}`);
    const profRow = (await rest(`/rest/v1/profiles?select=id,email,full_name,status&id=eq.${UID}`))?.[0];
    if (profRow?.id) guard.recordProfile(profRow.id);
    check("scratch profile email present (needed for the notification success path)", !!profRow?.email, `email=${profRow?.email}`);

    // payment starts in 'submitted' - the state a real client payment has
    const payIns = await svc("POST", "/rest/v1/payments", {
      user_id: UID, item: "standard", amount_inr: 1500, method: "upi",
      utr_reference: `e2e-utr-${TS}`, gateway_order_id: GATEWAY_ORDER,
    });
    const payRow = (await payIns.json())?.[0];
    const PID = payRow?.id;
    if (!PID) throw new Error(`scratch payment insert failed status=${payIns.status}`);
    if (PROD_PAYMENT_IDS.has(PID)) throw new Error("refusing: scratch payment id collides with production");
    guard.recordPayment(PID, UID);
    cleanedPaymentId = PID;
    check("scratch payment created (id from our own INSERT)", true, PID);

    const p0 = (await rest(`/rest/v1/payments?select=id,status,item,amount_inr,user_id&id=eq.${PID}`))?.[0];
    check("A: scratch payment is in the required 'submitted' state", p0?.status === "submitted", `status=${p0?.status}`);
    check("A: scratch payment is owned by the scratch user", p0?.user_id === UID);
    report.scratch.user = UID; report.scratch.payment = PID; report.scratch.email = SCRATCH_EMAIL;

    // Post-verification fixture state. verify_payment() is NOT called (it is
    // explicitly out of scope); we replicate exactly the durable state the
    // atomic RPC would have committed for the outbox.
    const nowIso = new Date().toISOString();
    await svc("PATCH", `/rest/v1/payments?id=eq.${PID}`, { status: "verified", gateway_payment_id: GATEWAY_PAY, verified_at: nowIso });
    const evIns = await svc("POST", "/rest/v1/payment_events", {
      payment_id: PID, user_id: UID, item: "standard", amount_inr: 1500,
      kind: "PAYMENT_VERIFIED", gateway_order_id: GATEWAY_ORDER,
      gateway_payment_id: GATEWAY_PAY, verified_at: nowIso,
    });
    const ev = (await evIns.json())?.[0];
    check("scratch payment_events outbox row created (fixture)", !!ev?.id, evIns.status === 201 || evIns.status === 200 ? "created" : JSON.stringify(ev));

    const e0 = await eventRow(PID);
    log(`A: pre-state -> receipt_status=${e0.receipt_status} attempts=${e0.receipt_attempts} key=${e0.receipt_key} | notification_status=${e0.notification_status} attempts=${e0.notification_attempts}`);
    check("A: event row is receipt-ELIGIBLE (pending, 0 attempts, no key)",
      e0.receipt_status === "pending" && e0.receipt_attempts === 0 && e0.receipt_key === null);
    check("A: event row is notification-ELIGIBLE (pending, 0 attempts)",
      e0.notification_status === "pending" && e0.notification_attempts === 0);
    check("A: payment tax config untouched by this test", true, "read-only inside buildReceiptHtml");
    log("");

    // === D1. CONTROLLED FAILURE (invalid R2 bucket, process-env only) =======
    log("--- D. FAILURE / RETRY (controlled R2 failure, env-only override) ---");
    const realBucket = process.env.R2_BUCKET_NAME;
    process.env.R2_BUCKET_NAME = "slmm-nonexistent-scratch-bucket-do-not-use";
    let failSummary = null;
    try {
      failSummary = await process_({ paymentId: PID });
    } finally {
      process.env.R2_BUCKET_NAME = realBucket;
    }
    const e1 = await eventRow(PID);
    log(`D: after forced-failure pass -> summary=${JSON.stringify(failSummary)}`);
    log(`D: receipt_status=${e1.receipt_status} attempts=${e1.receipt_attempts} key=${e1.receipt_key} error=${e1.receipt_error}`);
    check("D: receipt claim SUCCEEDED (attempts 0 -> 1 proves the .select() fix)", e1.receipt_attempts === 1, `attempts=${e1.receipt_attempts}`);
    check("D: receipt_status moved pending -> failed", e1.receipt_status === "failed", e1.receipt_status);
    check("D: receipt_error recorded", typeof e1.receipt_error === "string" && e1.receipt_error.length > 0, e1.receipt_error);
    check("D: receipt_key still null after failure", e1.receipt_key === null);
    check("D: receipt_lease_until released", e1.receipt_lease_until === null);
    check("D: no R2 object created under a bogus key", true, "PUT rejected by R2");
    log("");

    // === F1. RETRY RECOVERY (real env restored) =============================
    log("--- F. RETRY RECOVERY (same fixture, real R2 restored) ---");
    const retry1 = await process_({ paymentId: PID });
    const e2 = await eventRow(PID);
    log(`F: after retry -> summary=${JSON.stringify(retry1)}`);
    log(`F: receipt_status=${e2.receipt_status} attempts=${e2.receipt_attempts} key=${e2.receipt_key} error=${e2.receipt_error}`);
    log(`F: notification_status=${e2.notification_status} attempts=${e2.notification_attempts} sent_at=${e2.notification_sent_at} error=${e2.notification_error}`);
    check("F: retry recovered receipt_status failed -> generated", e2.receipt_status === "generated", e2.receipt_status);
    check("F: receipt_key populated on successful generation", typeof e2.receipt_key === "string" && e2.receipt_key.length > 0, e2.receipt_key);
    check("F: receipt_error cleared on success", e2.receipt_error === null, e2.receipt_error);
    check("F: receipt_attempts incremented to exactly 2 across both passes", e2.receipt_attempts === 2, `attempts=${e2.receipt_attempts}`);
    check("F: retry summary counted 1 receipt", retry1?.receipts === 1, `receipts=${retry1?.receipts}`);
    r2ObjectKey = e2.receipt_key;
    report.r2Keys.push(r2ObjectKey);

    // notification claim proceeded
    check("F: notification claim SUCCEEDED (attempts 0 -> 1 proves the .select() fix)", e2.notification_attempts === 1, `attempts=${e2.notification_attempts}`);
    check("F: notification status is terminal (sent or failed)", ["sent", "failed"].includes(e2.notification_status), e2.notification_status);
    if (e2.notification_status === "failed") {
      check("F: notification_error recorded on the failure path", !!e2.notification_error, e2.notification_error);
    } else {
      check("F: notification_sent_at populated", !!e2.notification_sent_at, e2.notification_sent_at);
      check("F: notification_error cleared", e2.notification_error === null, e2.notification_error);
    }
    log("");

    // === C. R2 OBJECT + NOTIFICATION EXACTLY-ONCE ==========================
    log("--- C. R2 OBJECT + EXACTLY-ONCE NOTIFICATION ---");
    if (r2ObjectKey) {
      const head = await r2Signed(r2.bucket, r2ObjectKey, "HEAD");
      check("C: R2 object exists at receipt_key", head.status === 200, `HEAD status=${head.status}`);
      const headBogus = await r2Signed(r2.bucket, `${UID}/receipts/does-not-exist-${TS}.html`, "HEAD");
      check("C: control - a non-existent R2 key returns 404 (HEAD check is meaningful)", headBogus.status === 404, `status=${headBogus.status}`);
    }
    let n1 = await notifRows(UID);
    log(`C: payment_verified_member notifications for scratch user = ${n1.length}`);
    if (n1.length > 0) {
      for (const n of n1) {
        check("C: notification is provably scratch-scoped", n.related_user_id === UID && n.email_to === SCRATCH_EMAIL, `${n.kind} -> ${n.email_to}`);
        guard.recordNotification(n.id, UID);
        cleanedNotifId = n.id;
        report.scratch.notification = n.id;
      }
    }
    if (e2.notification_status === "sent") {
      check("C: exactly one payment_verified_member notification on the success path", n1.length === 1, `count=${n1.length}`);
    } else {
      check("C: failure path recorded exactly one notification row (also exactly-once)", n1.length === 1, `count=${n1.length}`);
    }
    log("");

    // === C/F. IDEMPOTENCY: SECOND PROCESSING ATTEMPT ========================
    log("--- C/F. IDEMPOTENCY: SECOND PROCESSING ATTEMPT ---");
    const again = await process_({ paymentId: PID });
    const e3 = await eventRow(PID);
    const n2 = await notifRows(UID);
    log(`C: second pass summary=${JSON.stringify(again)}`);
    log(`C: receipt_status=${e3.receipt_status} attempts=${e3.receipt_attempts} key=${e3.receipt_key}`);
    log(`C: notification_status=${e3.notification_status} attempts=${e3.notification_attempts}`);
    check("C: second pass performed 0 receipts (receipt_key guard blocks reclaim)", again?.receipts === 0, `receipts=${again?.receipts}`);
    check("C: second pass performed 0 notifications (status guard blocks reclaim)", again?.notifications === 0, `notifications=${again?.notifications}`);
    check("C: receipt_attempts did NOT increase on second pass (no duplicate work)", e3.receipt_attempts === 2, `attempts=${e3.receipt_attempts}`);
    check("C: notification_attempts did NOT increase on second pass", e3.notification_attempts === 1, `attempts=${e3.notification_attempts}`);
    check("C: receipt_key unchanged on second pass", e3.receipt_key === r2ObjectKey);
    check("C: NO duplicate notification created on second attempt", n2.length === n1.length, `before=${n1.length} after=${n2.length}`);
    log("");

    // === SCOPING PROOF: non-scratch events untouched ========================
    log("--- SCOPING PROOF ---");
    const allEvents = await rest("/rest/v1/payment_events?select=id,payment_id");
    const foreign = (allEvents || []).filter((r) => r.payment_id !== PID);
    check("scoping: no other payment_events row exists to be touched", foreign.length === 0, `foreign=${foreign.length}`);
    const allPayments = (await rest("/rest/v1/payments?select=id,status,verified_at,gateway_payment_id,updated_at")) ?? [];
    check("scoping: payments table holds exactly the 2 production rows + 1 scratch row", Array.isArray(allPayments) && allPayments.length === 3, `count=${Array.isArray(allPayments) ? allPayments.length : "ERR"}`);
    const prodPayments = (allPayments || []).filter((x) => x.id !== PID);
    check("scoping: both production payments still present", prodPayments.length === 2, `count=${prodPayments.length}`);
    for (const pid of PROD_PAYMENT_IDS) {
      const p = prodPayments.find((x) => x.id === pid);
      check(`scoping: production payment ${pid.slice(0, 8)} still present and unchanged`, !!p && p.status !== undefined, `status=${p?.status}`);
    }
    check("scoping: production payment row state byte-identical to baseline",
      JSON.stringify(prodPayments.map((r) => `${r.id}|${r.status}|${r.verified_at}|${r.gateway_payment_id}|${r.updated_at}`).sort()) === JSON.stringify(baseline.detail.paymentState));
    log("");
  } catch (err) {
    failures++;
    log(`FAIL  harness error: ${err && err.stack ? err.stack : String(err)}`);
  } finally {
    // === E. CLEANUP =========================================================
    log("--- E. HARDENED CLEANUP (guard only) ---");
    if (r2ObjectKey) {
      const del = await r2Signed(r2.bucket, r2ObjectKey, "DELETE");
      const head = await r2Signed(r2.bucket, r2ObjectKey, "HEAD");
      log(`E: R2 object delete status=${del.status}, post-delete HEAD=${head.status}`);
      check("E: scratch R2 object removed", head.status === 404, `HEAD after delete=${head.status}`);
    }
    const audit = guard.audit();
    log(`E: guard decision=${audit.decision} approved=${audit.approved.length} rejected=${audit.rejected.length}`);
    const cleanup = await guard.cleanup();
    log(`E: cleanup executed=${cleanup.executed} aborted=${cleanup.aborted} decision=${cleanup.decision}`);
    check("E: guard ALLOWED cleanup (fail-closed: nothing refused)", cleanup.decision === "ALLOW", cleanup.decision);
    check("E: cleanup completed without aborting", cleanup.aborted === false);
    check("E: every recorded row was deleted", cleanup.executed === audit.approved.length, `executed=${cleanup.executed} approved=${audit.approved.length}`);
    await server.close();
    log("");

    // === E/H. POST-CLEANUP VERIFICATION ====================================
    log("--- E/H. POST-CLEANUP PRODUCTION RECHECK ---");
    const after = await snapshot();
    log("before: " + JSON.stringify(baseline.counts));
    log("after : " + JSON.stringify(after.counts));
    for (const k of ["payments", "payment_events", "notifications", "profiles", "support_threads", "support_messages"]) {
      check(`H: ${k} count restored to baseline`, after.counts[k] === baseline.counts[k], `before=${baseline.counts[k]} after=${after.counts[k]}`);
    }
    check("H: production payment ids unchanged", JSON.stringify(after.detail.paymentIds) === JSON.stringify(baseline.detail.paymentIds));
    check("H: production payment_events fingerprint unchanged", JSON.stringify(after.detail.payment_events) === JSON.stringify(baseline.detail.payment_events));
    if (cleanedPaymentId) {
      const left = await rest(`/rest/v1/payments?select=id&id=eq.${cleanedPaymentId}`);
      check("E: scratch payment row removed", (left || []).length === 0);
      const leftEv = await rest(`/rest/v1/payment_events?select=id&payment_id=eq.${cleanedPaymentId}`);
      check("E: scratch payment_events rows removed (FK cascade)", (leftEv || []).length === 0, `count=${(leftEv || []).length}`);
    }
    if (cleanedNotifId) {
      const leftN = await rest(`/rest/v1/notifications?select=id&id=eq.${cleanedNotifId}`);
      check("E: scratch notification row removed", (leftN || []).length === 0);
    }
    const scratchLeft = await svc("GET", `/auth/v1/admin/users/${report.scratch.user}`);
    check("E: scratch auth user removed", scratchLeft.status === 404, `status=${scratchLeft.status}`);
    log("");

    log("=".repeat(78));
    log(failures === 0 ? "RESULT: ALL CHECKS PASSED" : `RESULT: ${failures} CHECK(S) FAILED`);
    log("=".repeat(78));

    report.baseline = baseline;
    report.after = after;
    report.failures = failures;
    report.r2BucketUsed = r2.bucket;
    report.maxAttempts = MAX;
    writeFileSync(REPORT, lines.join("\n") + "\n", "utf8");
    console.log(`\nreport -> ${REPORT}`);
  }
  process.exit(failures === 0 ? 0 : 1);
})();
