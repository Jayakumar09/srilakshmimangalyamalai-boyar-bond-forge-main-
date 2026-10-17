// slmm-elite-code-tests.mjs
// Offline tests for the Elite local code fixes. NO network, NO database.
// Covers:
//   T1  notifyPaymentSubmitted item validation accepts standard/premium/elite/jathagam
//   T2  generated-type runtime Constants include the 'elite' enum value
//   T3  isEliteEligible decision: only elite_eligible === true grants Elite;
//       the client-writable family_value claim never does
//   T4  handler-level: notifyPaymentSubmitted accepts Elite; submitManualPayment
//       rejects ineligible Elite and still accepts Standard
//   T5  migration source contract: elite_eligible is pinned for every
//       non-owner/service caller BEFORE the trusted early-return, and the RPC
//       keeps its SECURITY DEFINER + locked search_path + role/self checks +
//       same-transaction audit + grants. TEXT CHECKS ONLY (see note in T5).
//   T6  app layer: eligibility changes go through the RPC, not a direct update
//       (also TEXT CHECKS ONLY).
//   T7  checkout UI gate: Elite is shown only when profiles.elite_eligible is
//       exactly true (pure decision cases + TEXT CHECKS on the route source).
// The real modules are compiled/loaded through vite with the server-only imports
// mocked (same technique as slmm-delivery-mock-tests.mjs).
// Run: node slmm-elite-code-tests.mjs
import { createServer } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const MOCK_PROFILE_ID = "00000000-0000-0000-0000-0000000000aa";

const mockSources = {
  "@tanstack/react-start": `
export function createServerFn(){ const o={}; o.middleware=()=>o; o.inputValidator=()=>o; o.handler=(h)=>({handler:h}); return o; }
export function createMiddleware(){ const o={}; o.server=(fn)=>fn; o.client=(fn)=>fn; o.middleware=()=>o; o.inputValidator=()=>o; o.handler=(h)=>({handler:h}); return o; }
`,
  "@tanstack/react-start/server": `
export function getRequest(){ return undefined; }
`,
  "@/integrations/supabase/auth-middleware": `export const requireSupabaseAuth = {};`,
  "@/integrations/supabase/client.server": `
// Awaitable chainable stub: every builder method returns the same proxy, which
// resolves to a benign result. Enough to let server-function handlers complete
// without a real database.
function makeChain() {
  const result = Promise.resolve({ data: { id: "${MOCK_PROFILE_ID}", elite_eligible: false }, error: null });
  const proxy = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") return result.then.bind(result);
      if (prop === "catch") return result.catch.bind(result);
      if (prop === "finally") return result.finally.bind(result);
      return () => proxy;
    },
  });
  return proxy;
}
export const supabaseAdmin = {
  from: () => makeChain(),
  rpc: () => makeChain(),
};
`,
  "@/lib/email-templates/send-email": `
export async function sendTemplateEmail(){ return { sent: true }; }
`,
};

const PREFIX = "\0slmm-mock:";
function mockKeyFor(id) {
  const clean = id.split("?")[0].replace(/\\/g, "/");
  if (clean === "@tanstack/react-start/server" || clean.includes("node_modules/@tanstack/react-start/server")) return "@tanstack/react-start/server";
  if (clean === "@tanstack/react-start" || clean.includes("node_modules/@tanstack/react-start")) return "@tanstack/react-start";
  if (clean.includes("integrations/supabase/client.server")) return "@/integrations/supabase/client.server";
  if (clean.includes("integrations/supabase/auth-middleware")) return "@/integrations/supabase/auth-middleware";
  if (clean.includes("lib/email-templates/send-email")) return "@/lib/email-templates/send-email";
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

const results = [];
function check(id, name, got, expected) {
  const pass = JSON.stringify(got) === JSON.stringify(expected);
  results.push({ id, name, pass, got, expected });
  console.log(`${pass ? "PASS" : "FAIL"}  [T${id}] ${name} :: got=${JSON.stringify(got)} expected=${JSON.stringify(expected)}`);
}

const server = await createServer({
  configFile: false,
  root,
  logLevel: "error",
  resolve: { alias: { "@": path.resolve(root, "src") } },
  ssr: { noExternal: ["@tanstack/react-start"] },
  server: { middlewareMode: true },
  plugins: [mockPlugin],
});

// ---- T1: notifyPaymentSubmitted item validation --------------------------
const notify = await server.ssrLoadModule("/src/lib/notify.functions.ts");
const { notifyPaymentItemSchema, NOTIFY_PAYMENT_ITEMS } = notify;

for (const item of ["standard", "premium", "elite", "jathagam"]) {
  check(1, `notify item accepts ${item}`, notifyPaymentItemSchema.safeParse(item).success, true);
}
check(1, "notify item rejects unknown value", notifyPaymentItemSchema.safeParse("gold").success, false);
check(1, "notify item rejects uppercase Elite", notifyPaymentItemSchema.safeParse("Elite").success, false);
check(
  1,
  "NOTIFY_PAYMENT_ITEMS covers all four items",
  [...NOTIFY_PAYMENT_ITEMS].sort(),
  ["elite", "jathagam", "premium", "standard"],
);

// ---- T2: generated-type runtime enum constants ---------------------------
const types = await server.ssrLoadModule("/src/integrations/supabase/types.ts");
const enums = types.Constants.public.Enums;
check(2, "membership_plan constant includes elite", enums.membership_plan.includes("elite"), true);
check(2, "payment_item constant includes elite", enums.payment_item.includes("elite"), true);
check(2, "membership_plan constant exact", enums.membership_plan, ["free", "standard", "premium", "elite"]);
check(2, "payment_item constant exact", enums.payment_item, ["standard", "premium", "elite", "jathagam"]);

// ---- T3: authoritative eligibility decision (pure) -----------------------
const payments = await server.ssrLoadModule("/src/lib/payments.functions.ts");
const { isEliteEligible } = payments;
check(3, "elite_eligible true is eligible", isEliteEligible({ elite_eligible: true }), true);
check(3, "elite_eligible false is not eligible", isEliteEligible({ elite_eligible: false }), false);
check(
  3,
  "family_value above_10cr alone never grants eligibility",
  isEliteEligible({ elite_eligible: false, family_value: "above_10cr" }),
  false,
);
check(3, "null profile is not eligible", isEliteEligible(null), false);
check(3, "non-boolean truthy value is not eligible", isEliteEligible({ elite_eligible: "true" }), false);

// ---- T4: handler-level behaviour -----------------------------------------
const notifyHandlerResult = await notify.notifyPaymentSubmitted.handler({
  data: { item: "elite", amount: 10000, reference: "UTR-ELITE-TEST", fullName: "Test User" },
  context: { userId: MOCK_PROFILE_ID, supabase: {} },
});
check(4, "notifyPaymentSubmitted handler accepts elite", notifyHandlerResult?.ok, true);

let eliteErr = null;
try {
  await payments.submitManualPayment.handler({
    data: { item: "elite", method: "upi", utrReference: "UTR-ELITE-1", proofKey: null },
    context: { userId: MOCK_PROFILE_ID, supabase: {} },
  });
} catch (e) {
  eliteErr = e;
}
check(4, "submitManualPayment rejects ineligible elite", eliteErr?.message, "ELITE_ELIGIBILITY_REQUIRED");

const stdResult = await payments.submitManualPayment.handler({
  data: { item: "standard", method: "upi", utrReference: "UTR-STD-1", proofKey: null },
  context: { userId: MOCK_PROFILE_ID, supabase: {} },
});
check(4, "submitManualPayment still accepts standard", stdResult?.paymentId, MOCK_PROFILE_ID);

// ---- T5: migration source-contract invariants ----------------------------
// OFFLINE TEXT CHECKS ONLY. These assert the SQL contains the intended guard
// ordering, RPC authorization/audit, and grants. They do NOT execute PostgreSQL
// and therefore do NOT prove database authorization or trigger behaviour.
const migrationPath = path.resolve(
  root,
  "supabase",
  "migrations",
  "20261010130000_elite_eligibility_verification.sql",
);
let sql = "";
try {
  sql = fs.readFileSync(migrationPath, "utf8");
} catch {
  sql = "";
}
const norm = sql.replace(/\r\n/g, "\n");

check(5, "migration file is readable", sql.length > 0, true);
check(5, "owner/service detection declared", /v_owner_or_service\s*:=/.test(norm), true);
check(
  5,
  "trusted derives from owner/service OR admin",
  /v_trusted\s*:=\s*\n\s*v_owner_or_service\s*\n\s*OR/.test(norm),
  true,
);
check(5, "elite pin guards non-owner/service callers", norm.includes("IF NOT v_owner_or_service THEN"), true);
check(
  5,
  "elite pin sets INSERT->false and UPDATE->OLD",
  norm.includes("NEW.elite_eligible := false;") && norm.includes("NEW.elite_eligible := OLD.elite_eligible;"),
  true,
);
const pinIdx = norm.indexOf("IF NOT v_owner_or_service THEN");
const trustedIdx = norm.indexOf("IF v_trusted THEN");
check(5, "elite pin runs before the trusted early-return", pinIdx !== -1 && trustedIdx !== -1 && pinIdx < trustedIdx, true);
check(
  5,
  "RPC is SECURITY DEFINER with locked search_path",
  /FUNCTION public\.set_elite_eligibility[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = public, pg_temp/.test(norm),
  true,
);
check(
  5,
  "RPC requires an authenticated admin via has_role",
  /set_elite_eligibility[\s\S]*public\.has_role\(v_actor_id, 'admin'/.test(norm),
  true,
);
check(
  5,
  "RPC blocks admin self-grant",
  /set_elite_eligibility[\s\S]*p_profile_id = v_actor_id[\s\S]*self_grant_blocked/.test(norm),
  true,
);
check(
  5,
  "RPC revoked from PUBLIC/anon/authenticated",
  ["FROM PUBLIC", "FROM anon", "FROM authenticated"].every((s) =>
    norm.includes(`REVOKE EXECUTE ON FUNCTION public.set_elite_eligibility(uuid, boolean) ${s}`),
  ),
  true,
);
check(
  5,
  "RPC granted to authenticated and service_role",
  norm.includes("GRANT EXECUTE ON FUNCTION public.set_elite_eligibility(uuid, boolean) TO authenticated;") &&
    norm.includes("GRANT EXECUTE ON FUNCTION public.set_elite_eligibility(uuid, boolean) TO service_role;"),
  true,
);
check(
  5,
  "RPC writes profile_audit in the same function body",
  /set_elite_eligibility[\s\S]*INSERT INTO public\.profile_audit/.test(norm),
  true,
);

// ---- T6: app-layer contract (TEXT CHECKS ONLY) ---------------------------
const adminDataSrc = fs.readFileSync(path.resolve(root, "src", "lib", "admin-data.ts"), "utf8");
check(6, "app calls the set_elite_eligibility RPC", adminDataSrc.includes('.rpc("set_elite_eligibility"'), true);
check(
  6,
  "eligibility callback does not write profiles.elite_eligible directly",
  !/setEliteEligibility[\s\S]{0,400}elite_eligible\s*:/.test(adminDataSrc),
  true,
);

// ---- T7: checkout UI gate uses the authoritative elite_eligible field -----
// OFFLINE. Pure decision cases the checkout gate relies on, plus TEXT CHECKS
// that the route reads profiles.elite_eligible and no longer keys the Elite
// option off the client-writable family_value claim. The server-side rejection
// of an ineligible Elite submission is asserted last (defense in depth).
check(7, "elite_eligible=true (family_value below_5cr) shows Elite", isEliteEligible({ elite_eligible: true, family_value: "below_5cr" }), true);
check(7, "elite_eligible=true (family_value above_10cr) shows Elite", isEliteEligible({ elite_eligible: true, family_value: "above_10cr" }), true);
check(7, "elite_eligible=true (no family_value) shows Elite", isEliteEligible({ elite_eligible: true }), true);
check(7, "elite_eligible=false + family_value above_10cr hides Elite", isEliteEligible({ elite_eligible: false, family_value: "above_10cr" }), false);
check(7, "null profile hides Elite (fail closed)", isEliteEligible(null), false);
check(7, "missing eligibility hides Elite (fail closed)", isEliteEligible({ family_value: "above_10cr" }), false);
check(7, "null eligibility hides Elite (fail closed)", isEliteEligible({ elite_eligible: null, family_value: "above_10cr" }), false);

const checkoutSrc = fs.readFileSync(
  path.resolve(root, "src", "routes", "_authenticated", "checkout.tsx"),
  "utf8",
);
check(7, "checkout profile query selects elite_eligible", /\.select\("full_name,\s*elite_eligible"\)/.test(checkoutSrc), true);
check(7, "checkout decides Elite via isEliteEligible(profile)", checkoutSrc.includes("isEliteEligible(profile)"), true);
check(7, "checkout no longer gates Elite on family_value", !/family_?[Vv]alue\s*===\s*"above_10cr"/.test(checkoutSrc), true);

let eliteRejected = null;
try {
  await payments.submitManualPayment.handler({
    data: { item: "elite", method: "upi", utrReference: "UTR-ELITE-2", proofKey: null },
    context: { userId: MOCK_PROFILE_ID, supabase: {} },
  });
} catch (e) {
  eliteRejected = e;
}
check(7, "server still rejects ineligible Elite submission", eliteRejected?.message, "ELITE_ELIGIBILITY_REQUIRED");

await server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:", failed.map((f) => `T${f.id} ${f.name}`).join("; "));
  process.exit(1);
}
