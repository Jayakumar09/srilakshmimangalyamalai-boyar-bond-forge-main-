import { createServer } from "vite";
import path from "node:path";
import nodeCrypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const mockSources = {
  "@tanstack/react-start": `
export function createServerFn(){ const o={}; o.middleware=()=>o; o.inputValidator=()=>o; o.handler=(h)=>({handler:h}); return o; }
`,
  "@tanstack/react-start/server": `
export function getRequest(){ const r = globalThis.__SLMM_MOCK_REQUEST__; if (!r) throw new Error("No Start context found in AsyncLocalStorage."); return r; }
`,
  "@/integrations/supabase/auth-middleware": `export const requireSupabaseAuth = {};`,
  "@/integrations/supabase/client.server": `
export const supabaseAdmin = {
  from: (table) => globalThis.__SLMM_MOCK_DB__.makeBuilder(table),
  rpc: (fn, args) => globalThis.__SLMM_MOCK_RPC__(fn, args),
};
`,
  "@/lib/email-templates/send-email": `
export async function sendTemplateEmail(name, to, options){ return await globalThis.__SLMM_MOCK_SEND__(name, to, options); }
`,
  aws4fetch: `
export class AwsClient { async sign(req){ return globalThis.__SLMM_MOCK_SIGN__(req); } }
`,
};

const PREFIX = "\0slmm-mock:";
function mockKeyFor(id) {
  const clean = id.split("?")[0].replace(/\\/g, "/");
  if (clean === "@tanstack/react-start/server" || /@tanstack\/react-start\/.*\/server(\.rsc)?\.js$/.test(clean)) return "@tanstack/react-start/server";
  if (clean === "@tanstack/react-start" || clean.includes("/node_modules/@tanstack/react-start/")) return "@tanstack/react-start";
  if (clean === "aws4fetch" || clean.includes("/node_modules/aws4fetch/")) return "aws4fetch";
  if (clean === "@/integrations/supabase/client.server" || clean.endsWith("/integrations/supabase/client.server") || clean.endsWith("/integrations/supabase/client.server.ts")) return "@/integrations/supabase/client.server";
  if (clean === "@/integrations/supabase/auth-middleware" || clean.endsWith("/integrations/supabase/auth-middleware") || clean.endsWith("/integrations/supabase/auth-middleware.ts")) return "@/integrations/supabase/auth-middleware";
  if (clean === "@/lib/email-templates/send-email" || clean.endsWith("/lib/email-templates/send-email") || clean.endsWith("/lib/email-templates/send-email.ts")) return "@/lib/email-templates/send-email";
  return null;
}
const mockPlugin = {
  name: "slmm-mock-plugin",
  enforce: "pre",
  resolveId(id) {
    const key = mockKeyFor(id);
    return key ? PREFIX + key : null;
  },
  load(id) {
    if (id.startsWith(PREFIX)) return mockSources[id.slice(PREFIX.length)];
    return null;
  },
};

const R2_RE = /^https:\/\/testacct\.r2\.cloudflarestorage\.com\//;
const networkViolations = [];
const allFetchUrls = [];
let emailBehavior = async () => ({ sent: true });
let emailCalls = [];
let fetchCalls = [];
let fetchBehavior = async () => ({ ok: true, status: 200 });
const consoleErrors = [];
console.error = (...args) => {
  consoleErrors.push(args);
};

globalThis.__SLMM_MOCK_SIGN__ = (req) => ({ url: String(req.url) });
globalThis.__SLMM_MOCK_SEND__ = async (name, to, options) => {
  emailCalls.push({ name, to, options });
  return await emailBehavior(name, to, options);
};
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  allFetchUrls.push(url);
  if (!R2_RE.test(url)) {
    networkViolations.push(url);
    throw new Error("UNEXPECTED_NETWORK_" + url);
  }
  fetchCalls.push({ url, method: init?.method, body: init?.body });
  return await fetchBehavior(url, init);
};

process.env.R2_ACCOUNT_ID = "testacct";
process.env.R2_ACCESS_KEY_ID = "dummy-access-id";
process.env.R2_SECRET_ACCESS_KEY = "dummy-secret";
process.env.R2_BUCKET_NAME = "slmm-mock-bucket";

function project(row, cols) {
  if (!cols || cols === "*") return { ...row };
  const out = {};
  for (const key of cols.split(",").map((s) => s.trim())) out[key] = row?.[key];
  return out;
}

function matchFilter(row, filters) {
  return filters.every(([type, col, val]) => {
    const actual = row[col];
    if (type === "eq") return actual === val;
    if (type === "is") return val === null ? actual === null || actual === undefined : actual === val;
    if (type === "in") return val.includes(actual);
    return true;
  });
}

function makeWorld(seed = {}) {
  const tables = {
    payment_events: (seed.events || []).map((r) => ({ ...r })),
    notifications: (seed.notifications || []).map((r) => ({ ...r })),
    payments: (seed.payments || []).map((r) => ({ ...r })),
    profiles: (seed.profiles || []).map((r) => ({ ...r })),
    payment_tax_config: (seed.tax || []).map((r) => ({ ...r })),
  };
  const log = [];
  let claimMissOnce = false;
  const failUpdate = [];
  const failInsert = [];
  const consumeFail = (list, table, payload) => {
    const hit = list.find((f) => !f.used && f.match(table, payload));
    if (!hit) return null;
    hit.used = true;
    return { data: null, error: { message: "SIMULATED_DB_FAILURE" } };
  };

  function makeBuilder(table) {
    const chain = (op, arg) => {
    const b = { table, op, projection: null, filters: [], orderBy: null, patch: null, rows: null };
    b.select = (cols) => {
      if (b.op === null) b.op = "select";
      b.projection = cols || "*";
      return b;
    };
    if (op === "select") b.projection = arg || "*";
    if (op === "update") b.patch = arg;
    if (op === "insert") b.rows = arg;
    b.eq = (col, val) => {
      b.filters.push(["eq", col, val]);
      return b;
    };
    b.is = (col, val) => {
      b.filters.push(["is", col, val]);
      return b;
    };
    b.in = (col, val) => {
      b.filters.push(["in", col, val]);
      return b;
    };
    b.order = (col, opts) => {
      b.orderBy = [col, opts];
      return b;
    };
    const matchedRows = () => tables[table].filter((r) => matchFilter(r, b.filters));
    const doSelect = () => {
      let rows = matchedRows();
      if (b.orderBy) {
        const [col, opts] = b.orderBy;
        rows = rows.slice().sort((x, y) => {
          const asc = !(opts && opts.ascending === false);
          if (x[col] < y[col]) return asc ? -1 : 1;
          if (x[col] > y[col]) return asc ? 1 : -1;
          return 0;
        });
      }
      return rows.map((r) => project(r, b.projection));
    };
    const doUpdate = () => {
      const rows = matchedRows();
      for (const r of rows) Object.assign(r, b.patch);
      log.push({ table, op: "update", filters: b.filters.map((f) => [...f]), patch: { ...b.patch }, count: rows.length });
      return rows;
    };
    const doInsert = () => {
      const arr = Array.isArray(b.rows) ? b.rows : [b.rows];
      for (const r of arr) {
        const defaults =
          table === "payment_events"
            ? {
                gateway_order_id: null,
                gateway_payment_id: null,
                receipt_status: "pending",
                receipt_key: null,
                receipt_error: null,
                receipt_attempts: 0,
                receipt_lease_until: null,
                receipt_processed_at: null,
                notification_status: "pending",
                notification_error: null,
                notification_attempts: 0,
                notification_sent_at: null,
              }
            : {};
        tables[table].push({ id: r.id || `${table}-${tables[table].length + 1}`, ...defaults, ...r });
      }
      log.push({ table, op: "insert", count: arr.length });
    };
    b.maybeSingle = async () => {
      if (b.op === "update" && claimMissOnce) {
        claimMissOnce = false;
        return { data: null, error: null };
      }
      if (b.op === "select") {
        const rows = doSelect();
        return rows.length ? { data: rows[0], error: null } : { data: null, error: null };
      }
      if (b.op === "update") {
        const failed = consumeFail(failUpdate, table, b.patch);
        if (failed) return failed;
        const rows = doUpdate();
        return rows.length ? { data: project(rows[0], b.projection || "*"), error: null } : { data: null, error: null };
      }
      return { data: null, error: null };
    };
    b.then = (resolve, reject) => {
      try {
        if (b.op === "select") resolve({ data: doSelect(), error: null });
        else if (b.op === "update") {
          const failed = consumeFail(failUpdate, table, b.patch);
          if (failed) {
            resolve(failed);
            return;
          }
          doUpdate();
          resolve({ data: null, error: null });
        } else if (b.op === "insert") {
          const failed = consumeFail(failInsert, table, b.rows);
          if (failed) {
            resolve(failed);
            return;
          }
          doInsert();
          resolve({ data: null, error: null });
        } else resolve({ data: null, error: null });
      } catch (err) {
        reject(err);
      }
    };
    return b;
    };

    return {
      select: (cols) => chain("select", cols),
      update: (patch) => chain("update", patch),
      insert: (rows) => chain("insert", rows),
    };
  }

  return { makeBuilder, tables, log, forceClaimMiss() { claimMissOnce = true; }, failNextUpdate(match) { failUpdate.push({ match, used: false }); }, failNextInsert(match) { failInsert.push({ match, used: false }); } };
}

const PID = "11111111-1111-4111-8111-111111111111";
const PID2 = "44444444-4444-4444-8444-444444444444";
const UID = "22222222-2222-4222-8222-222222222222";
const UID2 = "33333333-3333-4333-8333-333333333333";

function baseEvent(over = {}) {
  return {
    payment_id: PID,
    user_id: UID,
    item: "standard",
    amount_inr: 2000,
    gateway_order_id: "order_mock_1",
    gateway_payment_id: "pay_mock_1",
    verified_at: "2026-09-25T10:00:00.000Z",
    receipt_status: "pending",
    receipt_key: null,
    receipt_error: null,
    receipt_attempts: 0,
    receipt_lease_until: null,
    notification_status: "pending",
    notification_error: null,
    notification_attempts: 0,
    notification_sent_at: null,
    ...over,
  };
}

function baseSeed(over = {}) {
  return {
    events: over.events || [baseEvent(over.event)],
    payments: over.payments || [{ id: PID, method: "upi", utr_reference: "UTR-MOCK-1" }],
    profiles: over.profiles || [over.profile || { id: UID, full_name: "Mock Member", email: "e2e-mock@slmm.test" }],
    tax: over.tax || [
      {
        item: "standard",
        seller_legal_name: "SLMM Trust",
        seller_gstin: "29ABCDE1234F1Z5",
        seller_address: "1 Mock Road",
        tax_label: "GST",
        tax_rate: 18,
      },
    ],
    notifications: over.notifications || [],
  };
}

let results = [];
function check(id, name, got, expected) {
  const pass = JSON.stringify(got) === JSON.stringify(expected);
  results.push({ id, name, pass, got, expected });
  console.log(`${pass ? "PASS" : "FAIL"}  [T${id}] ${name} :: got=${JSON.stringify(got)} expected=${JSON.stringify(expected)}`);
}

function resetIo() {
  emailCalls = [];
  fetchCalls = [];
  emailBehavior = async () => ({ sent: true });
  fetchBehavior = async () => ({ ok: true, status: 200 });
  consoleErrors.length = 0;
}

function loggedMessages() {
  return consoleErrors.map((args) => String(args[0]));
}

const server = await createServer({
  configFile: false,
  root,
  logLevel: "error",
  resolve: { alias: { "@": path.resolve(root, "src") } },
  ssr: { noExternal: ["@tanstack/react-start", "aws4fetch"] },
  server: { middlewareMode: true },
  plugins: [mockPlugin],
});
const mod = await server.ssrLoadModule("/src/lib/receipts.functions.ts");
const { processPendingPaymentDeliveries, retryPaymentDeliveries } = mod;
const backgroundTask = await server.ssrLoadModule("/src/lib/background-task.ts");
const payments = await server.ssrLoadModule("/src/lib/payments.functions.ts");

{
  const world = makeWorld(baseSeed());
  globalThis.__SLMM_MOCK_DB__ = world;
  resetIo();
  const out = await processPendingPaymentDeliveries();
  const ev = world.tables.payment_events[0];
  check(1, "happy path counts", `${out.receipts}/${out.notifications}`, "1/1");
  check(1, "receipt committed", ev.receipt_status, "generated");
  check(1, "receipt key owner-scoped deterministic", ev.receipt_key, `${UID}/receipts/${PID}-receipt.html`);
  check(1, "receipt attempts incremented", ev.receipt_attempts, 1);
  check(1, "notification sent", ev.notification_status, "sent");
  check(1, "exactly one R2 PUT", fetchCalls.length, 1);
  check(1, "R2 PUT method is PUT", fetchCalls[0]?.method, "PUT");
  check(
    1,
    "receipt html has amount+utr+tax",
    /\u20b92000/.test(String(fetchCalls[0]?.body)) &&
      /UTR-MOCK-1/.test(String(fetchCalls[0]?.body)) &&
      /GST/.test(String(fetchCalls[0]?.body)),
    true,
  );
  check(1, "exactly one email send", emailCalls.length, 1);
  check(1, "email destination is scratch", emailCalls[0]?.to, "e2e-mock@slmm.test");
  check(1, "email idempotency key deterministic", emailCalls[0]?.options?.idempotencyKey, `payment-verified-${PID}`);
  check(1, "payment source row untouched", world.tables.payments[0].method, "upi");

  const fetchBefore = fetchCalls.length;
  const emailBefore = emailCalls.length;
  const out2 = await processPendingPaymentDeliveries();
  check(2, "second pass performs no work", `${out2.receipts}/${out2.notifications}`, "0/0");
  check(2, "no duplicate R2 writes", fetchCalls.length - fetchBefore, 0);
  check(2, "no duplicate emails", emailCalls.length - emailBefore, 0);
  check(2, "receipt key unchanged", world.tables.payment_events[0].receipt_key, `${UID}/receipts/${PID}-receipt.html`);
}

{
  const world = makeWorld(baseSeed());
  globalThis.__SLMM_MOCK_DB__ = world;
  resetIo();
  fetchBehavior = async () => ({ ok: false, status: 500 });
  const out = await processPendingPaymentDeliveries();
  const ev = world.tables.payment_events[0];
  check(3, "receipt store failure -> 0 receipts", out.receipts, 0);
  check(3, "receipt_status failed", ev.receipt_status, "failed");
  check(3, "receipt_error recorded", ev.receipt_error, "Receipt store failed (500)");
  check(3, "receipt attempts incremented", ev.receipt_attempts, 1);
  check(3, "notification still delivered independently", ev.notification_status, "sent");
  check(3, "exactly one email attempt", emailCalls.length, 1);
}

{
  const world = makeWorld(baseSeed({ profile: { id: UID, full_name: "Mock", email: null } }));
  globalThis.__SLMM_MOCK_DB__ = world;
  resetIo();
  const out = await processPendingPaymentDeliveries();
  const ev = world.tables.payment_events[0];
  check(4, "receipt still generated without email", out.receipts, 1);
  check(4, "notification failed", ev.notification_status, "failed");
  check(4, "notification_error explains no email", ev.notification_error, "no email on profile");
  check(4, "no email send attempted", emailCalls.length, 0);
}

{
  const world = makeWorld(
    baseSeed({
      event: { receipt_status: "failed", receipt_attempts: 5, notification_status: "failed", notification_attempts: 5 },
    }),
  );
  globalThis.__SLMM_MOCK_DB__ = world;
  resetIo();
  const out = await processPendingPaymentDeliveries();
  check(5, "max attempts cap -> no work", `${out.receipts}/${out.notifications}`, "0/0");
  check(5, "no R2 write at cap", fetchCalls.length, 0);
  check(5, "no email at cap", emailCalls.length, 0);
  check(5, "receipt_status unchanged at cap", world.tables.payment_events[0].receipt_status, "failed");
}

{
  const world = makeWorld(baseSeed());
  globalThis.__SLMM_MOCK_DB__ = world;
  resetIo();
  world.forceClaimMiss();
  const out = await processPendingPaymentDeliveries();
  const ev = world.tables.payment_events[0];
  check(6, "CAS claim miss -> no work", `${out.receipts}/${out.notifications}`, "0/0");
  check(6, "no R2 write on claim miss", fetchCalls.length, 0);
  check(6, "no email on claim miss", emailCalls.length, 0);
  check(6, "event left reclaimable", ev.receipt_status, "pending");
  check(6, "receipt not written on claim miss", ev.receipt_key, null);
}

{
  const world = makeWorld(
    baseSeed({ notifications: [{ id: "n1", kind: "payment_verified_member", related_user_id: UID, emailed: true }] }),
  );
  globalThis.__SLMM_MOCK_DB__ = world;
  resetIo();
  const out = await processPendingPaymentDeliveries();
  const ev = world.tables.payment_events[0];
  check(7, "already-emailed notification counted sent", out.notifications, 1);
  check(7, "notification_status sent", ev.notification_status, "sent");
  check(7, "no duplicate email when already emailed", emailCalls.length, 0);
  check(7, "no duplicate notification row", world.tables.notifications.length, 1);
}

{
  const world = makeWorld(
    baseSeed({ notifications: [{ id: "n1", kind: "payment_verified_member", related_user_id: UID, emailed: false }] }),
  );
  globalThis.__SLMM_MOCK_DB__ = world;
  resetIo();
  await processPendingPaymentDeliveries();
  check(8, "existing notification row updated not duplicated", world.tables.notifications.length, 1);
  check(8, "existing notification row marked emailed", world.tables.notifications[0].emailed, true);
}

{
  const world = makeWorld(baseSeed());
  globalThis.__SLMM_MOCK_DB__ = world;
  resetIo();
  emailBehavior = async () => {
    throw new Error("boom");
  };
  const out = await processPendingPaymentDeliveries();
  const ev = world.tables.payment_events[0];
  check(9, "notification failure recorded", ev.notification_status, "failed");
  check(9, "notification_error is the thrown message", ev.notification_error, "boom");
  check(9, "failure recorded as a single row", world.tables.notifications.length, 1);
  check(9, "failure row not emailed", world.tables.notifications[0].emailed, false);
  check(9, "receipt succeeded independently", out.receipts, 1);
}

{
  const world = makeWorld(baseSeed());
  globalThis.__SLMM_MOCK_DB__ = world;
  resetIo();
  emailBehavior = async () => ({ sent: false, reason: "recipient_suppressed" });
  await processPendingPaymentDeliveries();
  check(10, "suppressed recipient recorded as failure", world.tables.payment_events[0].notification_error, "recipient_suppressed");
  check(10, "suppressed recipient status failed", world.tables.payment_events[0].notification_status, "failed");
}

{
  const world = makeWorld({
    events: [baseEvent(), baseEvent({ payment_id: PID2, user_id: UID2 })],
    payments: [
      { id: PID, method: "upi", utr_reference: "UTR-MOCK-1" },
      { id: PID2, method: "bank_transfer", utr_reference: "UTR-MOCK-2" },
    ],
    profiles: [
      { id: UID, full_name: "Mock Member", email: "e2e-mock-a@slmm.test" },
      { id: UID2, full_name: "Mock Member 2", email: "e2e-mock-b@slmm.test" },
    ],
    tax: [
      {
        item: "standard",
        seller_legal_name: "SLMM Trust",
        seller_gstin: "29ABCDE1234F1Z5",
        seller_address: "1 Mock Road",
        tax_label: "GST",
        tax_rate: 18,
      },
    ],
  });
  globalThis.__SLMM_MOCK_DB__ = world;
  resetIo();
  const out = await processPendingPaymentDeliveries({ paymentId: PID });
  const ev1 = world.tables.payment_events.find((r) => r.payment_id === PID);
  const ev2 = world.tables.payment_events.find((r) => r.payment_id === PID2);
  check(11, "filtered run processes only the target payment", `${out.receipts}/${out.notifications}`, "1/1");
  check(11, "target payment receipt generated", ev1.receipt_status, "generated");
  check(11, "other payment untouched", `${ev2.receipt_status}/${ev2.notification_status}`, "pending/pending");
  check(11, "single R2 write for filtered run", fetchCalls.length, 1);
  check(11, "single email for filtered run", emailCalls.length, 1);
}

{
  const world = makeWorld(baseSeed());
  globalThis.__SLMM_MOCK_DB__ = world;
  resetIo();
  world.failNextUpdate((table, patch) => table === "payment_events" && patch.receipt_status === "generated");
  const out1 = await processPendingPaymentDeliveries();
  const ev = world.tables.payment_events[0];
  check(12, "R2 ok but recording failure -> not counted", out1.receipts, 0);
  check(12, "receipt stays pending after recording failure", ev.receipt_status, "pending");
  check(12, "receipt_key still null after recording failure", ev.receipt_key, null);
  check(12, "silent recording failure records no receipt_error", ev.receipt_error, null);
  check(12, "R2 PUT still happened before the failed record", fetchCalls.length, 1);
  const out2 = await processPendingPaymentDeliveries();
  check(12, "retry later commits the receipt", out2.receipts, 1);
  check(12, "receipt_key set after recovery", world.tables.payment_events[0].receipt_key, `${UID}/receipts/${PID}-receipt.html`);
  check(12, "retry produced a second R2 write", fetchCalls.length, 2);
  check(12, "both R2 writes target the SAME deterministic object key", fetchCalls[0].url === fetchCalls[1].url, true);
}

{
  const world = makeWorld(baseSeed());
  globalThis.__SLMM_MOCK_DB__ = world;
  resetIo();
  world.failNextInsert((table, rows) => table === "notifications" && (Array.isArray(rows) ? rows[0] : rows).kind === "payment_verified_member");
  world.failNextUpdate((table, patch) => table === "payment_events" && patch.notification_status === "sent");
  const out1 = await processPendingPaymentDeliveries();
  const ev = world.tables.payment_events[0];
  check(13, "email attempted once despite record failure", emailCalls.length, 1);
  check(13, "notification row not recorded on failure", world.tables.notifications.length, 0);
  check(13, "notification stays pending after record failure", ev.notification_status, "pending");
  const out2 = await processPendingPaymentDeliveries();
  check(13, "retry re-attempts the email", emailCalls.length, 2);
  check(13, "re-attempt uses the SAME provider idempotency key", emailCalls[0].options.idempotencyKey === emailCalls[1].options.idempotencyKey, true);
  check(13, "notification sent after recovery", world.tables.payment_events[0].notification_status, "sent");
  check(13, "exactly one notification row after recovery", world.tables.notifications.length, 1);
  check(13, "recovered notification counted once", out2.notifications, 1);
}

{
  const world = makeWorld(
    baseSeed({ notifications: [{ id: "n1", kind: "payment_verified_member", related_user_id: UID, emailed: true }] }),
  );
  globalThis.__SLMM_MOCK_DB__ = world;
  resetIo();
  world.failNextUpdate((table, patch) => table === "payment_events" && patch.notification_status === "sent");
  await processPendingPaymentDeliveries();
  check(14, "already-emailed short-circuits before any send", emailCalls.length, 0);
  check(14, "status update failure leaves notification pending", world.tables.payment_events[0].notification_status, "pending");
  await processPendingPaymentDeliveries();
  check(14, "retry of already-emailed still sends nothing", emailCalls.length, 0);
  check(14, "status reaches sent on retry", world.tables.payment_events[0].notification_status, "sent");
}

{
  const world = makeWorld(
    baseSeed({
      event: { receipt_status: "failed", receipt_attempts: 5, receipt_key: null, notification_status: "failed", notification_attempts: 5 },
    }),
  );
  globalThis.__SLMM_MOCK_DB__ = world;
  resetIo();
  const summary = await retryPaymentDeliveries.handler({
    data: { paymentId: PID },
    context: { supabase: { rpc: async () => ({ data: true }) }, userId: UID },
  });
  const ev = world.tables.payment_events[0];
  check(15, "admin retry recovers receipt past attempt cap", summary.receipts, 1);
  check(15, "admin retry recovers notification past attempt cap", summary.notifications, 1);
  check(15, "attempts reset then incremented to 1", ev.receipt_attempts, 1);
  check(15, "receipt generated after admin retry", ev.receipt_status, "generated");
  check(15, "notification sent after admin retry", ev.notification_status, "sent");
}

// ============================================================
// D2 — persistence failures are surfaced, delivery outcome untouched
// ============================================================

{
  const world = makeWorld(baseSeed());
  globalThis.__SLMM_MOCK_DB__ = world;
  resetIo();
  world.failNextUpdate((table, patch) => table === "payment_events" && patch.receipt_status === "generated");
  await processPendingPaymentDeliveries();
  const msgs = loggedMessages();
  check(16, "D2: failed receipt status write is logged", msgs.some((m) => m.includes("committing receipt")), true);
  check(16, "D2: persistence error is not written to receipt_error", world.tables.payment_events[0].receipt_error, null);
  check(16, "D2: delivery outcome left recoverable (pending, not failed)", world.tables.payment_events[0].receipt_status, "pending");
  check(16, "D2: receipt object was still stored in R2", fetchCalls.length, 1);
}

{
  const world = makeWorld(baseSeed());
  globalThis.__SLMM_MOCK_DB__ = world;
  resetIo();
  world.failNextInsert((table) => table === "notifications");
  world.failNextUpdate((table, patch) => table === "payment_events" && patch.notification_status === "sent");
  await processPendingPaymentDeliveries();
  const msgs = loggedMessages();
  check(17, "D2: failed notification-row write is logged", msgs.some((m) => m.includes("recording notification success")), true);
  check(17, "D2: failed notification status write is logged", msgs.some((m) => m.includes("recording notification sent")), true);
  check(17, "D2: email accepted but event stays recoverable", world.tables.payment_events[0].notification_status, "pending");
}

{
  const world = makeWorld(baseSeed({ profile: { id: UID, full_name: "Mock", email: null } }));
  globalThis.__SLMM_MOCK_DB__ = world;
  resetIo();
  await processPendingPaymentDeliveries();
  check(17, "D2: no-email delivery still recorded as a real failure", world.tables.payment_events[0].notification_error, "no email on profile");
}

// ============================================================
// D1 — background delivery is attached to the Worker lifecycle
// ============================================================

{
  resetIo();
  const waitUntilCalls = [];
  globalThis.__SLMM_MOCK_REQUEST__ = { waitUntil: (p) => waitUntilCalls.push(p) };
  let taskDone = false;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await backgroundTask.runBackgroundTask(async () => {
    await gate;
    taskDone = true;
  });
  check(18, "D1: waitUntil is used to schedule the task", waitUntilCalls.length, 1);
  check(18, "D1: scheduling does not await the task inline", taskDone, false);
  release();
  await waitUntilCalls[0];
  check(18, "D1: task completes once waitUntil settles", taskDone, true);
}

{
  resetIo();
  globalThis.__SLMM_MOCK_REQUEST__ = { waitUntil: undefined };
  let taskDone = false;
  await backgroundTask.runBackgroundTask(async () => {
    taskDone = true;
  });
  check(19, "D1: no waitUntil on request -> awaited inline", taskDone, true);

  globalThis.__SLMM_MOCK_REQUEST__ = undefined;
  let taskDone2 = false;
  await backgroundTask.runBackgroundTask(async () => {
    taskDone2 = true;
  });
  check(19, "D1: no request context -> awaited inline (never dropped)", taskDone2, true);
}

{
  resetIo();
  globalThis.__SLMM_MOCK_REQUEST__ = { waitUntil: () => {} };
  let rejected = false;
  await backgroundTask.runBackgroundTask(async () => {
    throw new Error("bg boom");
  }).catch(() => {
    rejected = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  check(20, "D1: background task error never rejects the caller", rejected, false);
  check(20, "D1: background task error is logged", loggedMessages().some((m) => m.includes("background-task")), true);
}

{
  resetIo();
  globalThis.__SLMM_MOCK_REQUEST__ = {
    waitUntil: () => {
      throw new Error("execution context unavailable");
    },
  };
  let taskDone = false;
  let rejected = false;
  await backgroundTask.runBackgroundTask(async () => {
    taskDone = true;
  }).catch(() => {
    rejected = true;
  });
  check(23, "D1: waitUntil throwing never rejects the caller", rejected, false);
  check(23, "D1: waitUntil throwing falls back to inline execution", taskDone, true);
  check(23, "D1: waitUntil registration failure is logged", loggedMessages().some((m) => m.includes("waitUntil registration failed")), true);
}

{
  const world = makeWorld(baseSeed());
  globalThis.__SLMM_MOCK_DB__ = world;
  resetIo();
  const waitUntilCalls = [];
  globalThis.__SLMM_MOCK_REQUEST__ = { waitUntil: (p) => waitUntilCalls.push(p) };
  globalThis.__SLMM_MOCK_RPC__ = async () => ({
    data: [{ payment_id: PID, item: "standard", amount_inr: 2000, verified: true, already_processed: false }],
    error: null,
  });
  process.env.RAZORPAY_KEY_SECRET = "test-secret";
  let releaseFetch;
  const fetchGate = new Promise((resolve) => {
    releaseFetch = resolve;
  });
  fetchBehavior = async () => {
    await fetchGate;
    return { ok: true, status: 200 };
  };
  const orderId = "order_mock_1";
  const gatewayPaymentId = "pay_mock_1";
  const signature = nodeCrypto.createHmac("sha256", "test-secret").update(`${orderId}|${gatewayPaymentId}`).digest("hex");

  const handlerPromise = payments.confirmPaymentOrder.handler({
    data: { orderId, paymentId: gatewayPaymentId, signature },
    context: { userId: UID, supabase: {} },
  });
  const outcome = await Promise.race([
    handlerPromise.then(
      () => "resolved",
      () => "rejected",
    ),
    new Promise((resolve) => setTimeout(() => resolve("blocked"), 50)),
  ]);
  check(21, "D1: confirmPaymentOrder response is not blocked by delivery", outcome, "resolved");
  check(21, "D1: confirmPaymentOrder registers delivery with waitUntil", waitUntilCalls.length, 1);
  releaseFetch();
  await waitUntilCalls[0];
  check(21, "D1: delivery ran after waitUntil settled (receipt)", world.tables.payment_events[0].receipt_status, "generated");
  check(21, "D1: delivery ran after waitUntil settled (notification)", world.tables.payment_events[0].notification_status, "sent");
}

{
  const world = makeWorld({
    events: [],
    payments: [
      { id: PID, user_id: UID, item: "standard", amount_inr: 2000, status: "submitted", verified_at: null, admin_notes: null },
    ],
    profiles: [{ id: UID, full_name: "Mock Member", email: "e2e-mock@slmm.test" }],
    tax: [
      {
        item: "standard",
        seller_legal_name: "SLMM Trust",
        seller_gstin: "29ABCDE1234F1Z5",
        seller_address: "1 Mock Road",
        tax_label: "GST",
        tax_rate: 18,
      },
    ],
    notifications: [],
  });
  globalThis.__SLMM_MOCK_DB__ = world;
  resetIo();
  const waitUntilCalls = [];
  globalThis.__SLMM_MOCK_REQUEST__ = { waitUntil: (p) => waitUntilCalls.push(p) };
  const session = { rpc: async () => ({ data: true }), from: (table) => world.makeBuilder(table) };
  let releaseFetch;
  const fetchGate = new Promise((resolve) => {
    releaseFetch = resolve;
  });
  fetchBehavior = async () => {
    await fetchGate;
    return { ok: true, status: 200 };
  };

  const handlerPromise = payments.reviewPayment.handler({
    data: { paymentId: PID, decision: "verified", note: null },
    context: { userId: UID, supabase: session },
  });
  const outcome = await Promise.race([
    handlerPromise.then(
      () => "resolved",
      () => "rejected",
    ),
    new Promise((resolve) => setTimeout(() => resolve("blocked"), 50)),
  ]);
  check(22, "D1: reviewPayment response is not blocked by delivery", outcome, "resolved");
  check(22, "D1: reviewPayment registers delivery with waitUntil", waitUntilCalls.length, 1);
  check(22, "D1: payment row terminally verified before delivery", world.tables.payments[0].status, "verified");
  releaseFetch();
  await waitUntilCalls[0];
  const ev = world.tables.payment_events[0];
  check(22, "D1: reviewPayment delivery completed (receipt)", ev?.receipt_status, "generated");
  check(22, "D1: reviewPayment delivery completed (notification)", ev?.notification_status, "sent");
}

await server.close();

check(0, "no non-mock network attempted (tripwire)", networkViolations, []);
check(
  0,
  "every recorded fetch hit only the mock R2 host",
  allFetchUrls.every((u) => R2_RE.test(u)),
  true,
);

const failed = results.filter((r) => !r.pass);
console.log("----------------------------------------");
console.log(`DELIVERY MOCK TESTS: ${results.length - failed.length}/${results.length} passed`);
console.log(`network requests attempted: ${allFetchUrls.length} (all to mock R2 host: ${allFetchUrls.every((u) => R2_RE.test(u))})`);
process.exit(failed.length === 0 ? 0 : 1);
