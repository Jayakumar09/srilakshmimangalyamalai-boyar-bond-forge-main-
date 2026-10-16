// test-harness/slmm-harness-safety-tests.mjs
// ---------------------------------------------------------------------------
// Phase 5B - OFFLINE enforcement suite for the harness safety architecture.
//
// Static, deterministic and hermetic: it reads files as text and asserts the
// safety contracts. It performs no network or database access, and it reads no
// credential. Run with:  node --test test-harness/slmm-harness-safety-tests.mjs
//
// Detector needles are assembled from fragments so that this analyzer's own
// source never contains the very tokens it forbids (mirrors the Phase 5A
// self-scanner technique): the scan therefore applies uniformly, including to
// this file.
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  OFFLINE_SUITES,
  LIVE_HARNESSES,
  HELPER_MODULES,
  classifiedMjsFiles,
  classifiedSqlFiles,
  liveHarnessFiles,
  helperFiles,
} from "./harness-registry.mjs";
import { SUPABASE_PROJECT_REFS, evaluateLiveAuthorization, assertNonProductionTarget } from "./live-guard.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const read = (p) => readFileSync(p, "utf8");
const readHarness = (f) => read(path.join(HERE, f));

// --- fragmented detector tokens (never present contiguously in this file) ---
const J = (a, b) => a + b;
const NEEDLE = Object.freeze({
  httpCall: J("fet", "ch("),
  clientCtor: J("createCli", "ent("),
  browserDriver: J("play", "wright"),
  browserEngine: J("chrom", "ium"),
  serviceKey: J("SUPABASE_SERVICE_ROLE", "_KEY"),
  emailKey: J("RESEND_API", "_KEY"),
});
const DOT_ENV = J(".", "env");
const ENV_PATH_LITERAL = new RegExp(`["'](?:[^"'\\n]*\\/)?${DOT_ENV.replace(".", "\\.")}["']`);
const ENV_SHELL_READ = J("cmd /c type ", DOT_ENV);

const firstIndex = (src, needles) => {
  const idxs = needles.map((n) => src.indexOf(n)).filter((i) => i >= 0);
  return idxs.length ? Math.min(...idxs) : Infinity;
};
const hasEnvFileAccess = (src) => ENV_PATH_LITERAL.test(src) || src.includes(ENV_SHELL_READ);
const hasLiveCapability = (src) =>
  src.includes(NEEDLE.httpCall) ||
  src.includes(NEEDLE.clientCtor) ||
  src.includes(NEEDLE.browserDriver) ||
  src.includes(NEEDLE.browserEngine) ||
  src.includes(NEEDLE.serviceKey) ||
  src.includes(NEEDLE.emailKey) ||
  hasEnvFileAccess(src);

// ---------------------------------------------------------------------------
// 1. Classification (fail closed on any new/unknown file)
// ---------------------------------------------------------------------------
test("every test-harness .mjs is classified", () => {
  const present = readdirSync(HERE).filter((f) => f.endsWith(".mjs"));
  const classified = new Set(classifiedMjsFiles());
  const unclassified = present.filter((f) => !classified.has(f));
  assert.deepEqual(unclassified, [], `unclassified .mjs harness files: ${unclassified.join(", ")}`);
});

test("every test-harness .sql harness is classified", () => {
  const present = readdirSync(HERE).filter((f) => f.endsWith(".sql"));
  const classified = new Set(classifiedSqlFiles());
  const unclassified = present.filter((f) => !classified.has(f));
  assert.deepEqual(unclassified, [], `unclassified .sql harness files: ${unclassified.join(", ")}`);
});

test("registry lists only existing files, with no duplicate classification", () => {
  const all = [...classifiedMjsFiles(), ...classifiedSqlFiles()];
  assert.equal(new Set(all).size, all.length, "a file is classified more than once");
  for (const f of all) assert.ok(existsSync(path.join(HERE, f)), `registry lists a missing file: ${f}`);
});

test("no file is both an offline suite and a live harness", () => {
  const offline = new Set(OFFLINE_SUITES.map((s) => s.file));
  for (const f of liveHarnessFiles()) assert.ok(!offline.has(f), `${f} is classified as both offline and live`);
});

// ---------------------------------------------------------------------------
// 2. Offline suites cannot reach a live service
// ---------------------------------------------------------------------------
test("offline suites declare no live-service capability", () => {
  for (const s of OFFLINE_SUITES) {
    const src = readHarness(s.file);
    assert.ok(!src.includes(NEEDLE.httpCall), `${s.file}: contains a direct HTTP request call`);
    assert.ok(!src.includes(NEEDLE.clientCtor), `${s.file}: constructs a Supabase service client`);
    assert.ok(
      !src.includes(NEEDLE.browserDriver) && !src.includes(NEEDLE.browserEngine),
      `${s.file}: references a headless browser driver`,
    );
    assert.ok(!src.includes(NEEDLE.serviceKey), `${s.file}: references the service-role key variable`);
    assert.ok(!src.includes(NEEDLE.emailKey), `${s.file}: references the email provider key variable`);
    assert.ok(!hasEnvFileAccess(src), `${s.file}: reads an environment file`);
  }
});

test("helper modules are side-effect free", () => {
  for (const f of helperFiles()) {
    const src = readHarness(f);
    assert.ok(!src.includes(NEEDLE.httpCall), `${f}: helper must not perform HTTP`);
    assert.ok(!src.includes(NEEDLE.clientCtor), `${f}: helper must not construct a client`);
    assert.ok(!hasEnvFileAccess(src), `${f}: helper must not read an environment file`);
  }
});

// ---------------------------------------------------------------------------
// 3. Live harnesses are gated before anything can reach a service
// ---------------------------------------------------------------------------
test("each live harness authorizes before credentials, network or browser", () => {
  for (const h of LIVE_HARNESSES) {
    const src = readHarness(h.file);
    const gateAt = src.indexOf("requireLiveAuthorization(");
    assert.ok(gateAt >= 0, `${h.file}: does not call the live authorization gate`);

    const envAt = src.search(ENV_PATH_LITERAL);
    const credentialOrNetworkAt = firstIndex(src, [
      NEEDLE.httpCall,
      NEEDLE.clientCtor,
      NEEDLE.browserDriver,
      NEEDLE.browserEngine,
    ]);
    const firstSensitiveAt = Math.min(envAt >= 0 ? envAt : Infinity, credentialOrNetworkAt);
    assert.ok(
      gateAt < firstSensitiveAt,
      `${h.file}: the live authorization gate must precede every environment-file read, HTTP call, client construction and browser launch`,
    );

    assert.ok(src.includes("assertNonProductionTarget("), `${h.file}: must validate the resolved target after loading credentials`);
    assert.ok(!src.includes(ENV_SHELL_READ), `${h.file}: must not shell out to read the environment file`);
    assert.ok(
      !src.includes(SUPABASE_PROJECT_REFS.prod),
      `${h.file}: must not hardcode the production project ref (import it via the guard instead)`,
    );
  }
});

// ---------------------------------------------------------------------------
// 4. Guard purity + target classification unit tests (offline, in-process)
// ---------------------------------------------------------------------------
test("live-guard performs no I/O and names the production ref only for refusal", () => {
  const src = readHarness("live-guard.mjs");
  assert.ok(!src.includes(NEEDLE.httpCall), "live-guard must not perform HTTP");
  assert.ok(!src.includes(NEEDLE.clientCtor), "live-guard must not construct a client");
  assert.ok(!hasEnvFileAccess(src), "live-guard must not read an environment file");
});

test("the production project ref is named only in live-guard.mjs", () => {
  const offenders = readdirSync(HERE)
    .filter((f) => f.endsWith(".mjs") && f !== "live-guard.mjs")
    .filter((f) => readHarness(f).includes(SUPABASE_PROJECT_REFS.prod));
  assert.deepEqual(offenders, [], `these files hardcode the production ref: ${offenders.join(", ")}`);
});

test("evaluateLiveAuthorization refuses by default and only allows a complete TEST opt-in", () => {
  const H = "slmm-comm-test.mjs";
  const testUrl = `https://${SUPABASE_PROJECT_REFS.test}.supabase.co`;
  const prodUrl = `https://${SUPABASE_PROJECT_REFS.prod}.supabase.co`;
  assert.equal(evaluateLiveAuthorization({}, { harness: H }).allowed, false);
  assert.equal(evaluateLiveAuthorization({ SLMM_LIVE_TESTS: "true" }, { harness: H }).allowed, false);
  assert.equal(
    evaluateLiveAuthorization({ SLMM_LIVE_TESTS: "true", SLMM_LIVE_TARGET: "test" }, { harness: H }).allowed,
    false,
    "missing per-harness acknowledgement must refuse",
  );
  assert.equal(
    evaluateLiveAuthorization({ SLMM_LIVE_TESTS: "true", SLMM_LIVE_TARGET: "prod", SLMM_LIVE_ACK: H }, { harness: H }).allowed,
    false,
    "production target must always refuse",
  );
  assert.equal(
    evaluateLiveAuthorization({ SLMM_LIVE_TESTS: "true", SLMM_LIVE_TARGET: "test", SLMM_LIVE_ACK: "another.mjs" }, { harness: H }).allowed,
    false,
    "acknowledgement must match the exact harness name",
  );
  assert.equal(
    evaluateLiveAuthorization({ SLMM_LIVE_TESTS: "true", SLMM_LIVE_TARGET: "test", SLMM_LIVE_ACK: H, SUPABASE_URL: prodUrl }, { harness: H }).allowed,
    false,
    "a production ambient URL must refuse even with a TEST opt-in",
  );
  assert.equal(
    evaluateLiveAuthorization({ SLMM_LIVE_TESTS: "true", SLMM_LIVE_TARGET: "test", SLMM_LIVE_ACK: H, SUPABASE_URL: testUrl }, { harness: H }).allowed,
    true,
  );
});

test("assertNonProductionTarget permits only the TEST project", () => {
  const H = "x.mjs";
  assert.throws(() => assertNonProductionTarget(`https://${SUPABASE_PROJECT_REFS.prod}.supabase.co`, { harness: H }));
  assert.throws(() => assertNonProductionTarget("https://example.com", { harness: H }));
  assert.throws(() => assertNonProductionTarget("", { harness: H }));
  assert.throws(() => assertNonProductionTarget(undefined, { harness: H }));
  assert.doesNotThrow(() => assertNonProductionTarget(`https://${SUPABASE_PROJECT_REFS.test}.supabase.co`, { harness: H }));
});

// ---------------------------------------------------------------------------
// 5. Tooling: npm scripts, runner, gitignore, pinned refs
// ---------------------------------------------------------------------------
test("no npm script can invoke a live harness; the default test is offline-only", () => {
  const pkg = JSON.parse(read(path.join(ROOT, "package.json")));
  const scripts = pkg.scripts || {};
  for (const [name, cmd] of Object.entries(scripts)) {
    const s = String(cmd);
    for (const f of liveHarnessFiles()) assert.ok(!s.includes(f), `script '${name}' references live harness ${f}`);
    assert.ok(!s.includes(J("test-harness/", "*")), `script '${name}' globs the test-harness directory`);
  }
  assert.equal(scripts.test, J("node scripts/run-offline-tests", ".mjs"), "npm test must run the offline-only runner");
  assert.equal(scripts[J("test:", "offline")], J("node scripts/run-offline-tests", ".mjs"));
});

test("the offline runner uses the explicit registry allowlist, not a glob", () => {
  const src = read(path.join(ROOT, "scripts", "run-offline-tests.mjs"));
  assert.ok(src.includes("OFFLINE_SUITES"), "runner must import the registry allowlist");
  assert.ok(!src.includes("readdirSync"), "runner must not discover suites by directory scan");
});

test(".gitignore covers generated test artifacts", () => {
  const gi = read(path.join(ROOT, ".gitignore"));
  const required = [
    "test-harness/slmm-comm-state.json",
    "receipt-delivery-select-fix-functional-test-report.txt",
    "payment-review-guard-functional-test-report.txt",
    "profile-self-approval-trigger-report.txt",
    "payment_b1_atomic_readonly_precheck.txt",
  ];
  for (const p of required) assert.ok(gi.includes(p), `.gitignore must ignore ${p}`);
});

test("TEST/PROD project refs remain pinned and agree with the build-target check", () => {
  const bt = read(path.join(ROOT, "scripts", "check-build-target.mjs"));
  assert.ok(bt.includes(SUPABASE_PROJECT_REFS.test), "check-build-target.mjs must still pin the TEST ref");
  assert.ok(bt.includes(SUPABASE_PROJECT_REFS.prod), "check-build-target.mjs must still pin the PROD ref");
});

// ---------------------------------------------------------------------------
// 6. Safety-critical protected sets are read completely and validated
// ---------------------------------------------------------------------------
// Extract a top-level `function <name>(...) { ... }` body by brace matching.
const functionBody = (src, name) => {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return null;
  const open = src.indexOf("{", start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
};

test("harness protected sets are read through the paginated, validated reader", () => {
  // The deletion deny-lists must come from the complete + Content-Range-validated
  // reader, never a single unpaginated response. A truncated read would silently
  // shrink a deny-list and let cleanup delete a real row, so this is a safety
  // contract, not a style preference.
  const receipt = readHarness("slmm-receipt-delivery-test.mjs");
  for (const loader of ["loadProtectedPaymentIds", "loadProtectedUserIds"]) {
    const body = functionBody(receipt, loader);
    assert.ok(body, `slmm-receipt-delivery-test.mjs: missing ${loader}()`);
    assert.ok(body.includes("fetchCompleteBaseline("), `${loader}() must read via the paginated, validated reader`);
    assert.ok(!body.includes("svc(") && !body.includes("rest("), `${loader}() must not use an unpaginated svc()/rest() read`);
  }
  for (const f of ["slmm-comm-test.mjs", "slmm-receipt-delivery-test.mjs"]) {
    const src = readHarness(f);
    assert.ok(src.includes("fetchCompleteBaseline("), `${f}: baseline/protected reads must use the validated reader`);
    assert.ok(src.includes("parseContentRange("), `${f}: must validate the Content-Range interval`);
  }
});

// ---------------------------------------------------------------------------
// 7. Comm-harness post-test reads stay complete + validated
// ---------------------------------------------------------------------------
test("comm harness post-test reads use the validated reader, not an unpaginated svc read", () => {
  const src = readHarness("slmm-comm-test.mjs");

  // Every post-test verification read must route through verifyRead(), which
  // delegates to the paginated + Content-Range-validated reader.
  const helper = functionBody(src, "verifyRead");
  assert.ok(helper, "slmm-comm-test.mjs: missing verifyRead() helper");
  assert.ok(helper.includes("fetchCompleteBaseline("), "verifyRead() must delegate to the paginated, validated reader");

  // Slice from the authorization section to EOF: that is where every post-test
  // read lives (X probes, D preservation, post-cleanup). None may revert to an
  // unpaginated svc("GET", ...) call, nor to a `|| []` / `?.length ?? 0`
  // fallback that would turn a FAILED read into a PASSING check.
  const marker = "============ X: AUTHORIZATION";
  const at = src.indexOf(marker);
  assert.ok(at > 0, "slmm-comm-test.mjs: authorization section marker not found");
  const post = src.slice(at);
  assert.ok(post.includes("verifyRead("), "post-test reads must use verifyRead()");
  assert.ok(!post.includes('svc("GET"'), 'post-test reads must not call svc("GET", ...)');
  assert.ok(!post.includes("?.length ?? 0"), "post-test reads must not use the ?.length ?? 0 fallback");
  assert.ok(!/\|\|\s*\[\]/.test(post), "post-test reads must not fall back to an empty array");
});
