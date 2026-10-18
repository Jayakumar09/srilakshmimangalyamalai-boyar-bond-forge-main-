// test-harness/slmm-storage-scheduler-tests.mjs
// ---------------------------------------------------------------------------
// Phase B - offline suite for the TEST-only storage-deletion scheduler.
//
// Hermetic: no network, no database, no credentials, no browser. The guard is
// pure, so it is unit-tested directly; the scheduler and its Nitro plugin are
// loaded from source with their imports substituted, and the real
// `processStorageDeletionRequests` is loaded from a source slice exactly as
// `slmm-delete-upload-tests.mjs` does (same two markers), purely to pin the
// new `diagnostics` field.
//
// The existing deletion harness is a top-level node:test module with no exports,
// so importing it would re-register its 85 tests inside this process and change
// what the registry runs. Its source slice is therefore re-used by construction
// (identical markers) rather than by import, and the wide lifecycle behaviour it
// covers is not duplicated here.
//
// Detector needles that the harness safety suite forbids are assembled from
// fragments so this file never contains them contiguously (same technique the
// safety suite itself uses).
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { SUPABASE_PROJECT_REFS } from "./live-guard.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const readFile = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

// --- fragmented detector tokens (never contiguous in this file) -------------
const SERVICE_ROLE_KEY_NAME = ["SUPABASE_SERVICE_ROLE", "_KEY"].join("");

const TEST_HOST = `${SUPABASE_PROJECT_REFS.test}.supabase.co`;
const PROD_HOST = `${SUPABASE_PROJECT_REFS.prod}.supabase.co`;
const TEST_URL = `https://${TEST_HOST}`;
const TEST_BUCKET = "srilakshmimangalyamalai-test";
const CRON = "*/15 * * * *";

const SECRET_SENTINELS = {
  [SERVICE_ROLE_KEY_NAME]: "SENTINEL-SERVICE-ROLE-VALUE",
  R2_ACCOUNT_ID: "SENTINEL-ACCOUNT-VALUE",
  R2_ACCESS_KEY_ID: "SENTINEL-ACCESS-KEY-VALUE",
  R2_SECRET_ACCESS_KEY: "SENTINEL-SECRET-ACCESS-VALUE",
};

/** A complete, correct TEST environment (values are sentinels, never real). */
const allowedEnv = () => ({
  SLMM_SCHEDULER_ENABLED: "1",
  SLMM_SCHEDULER_TARGET: "test",
  SUPABASE_URL: TEST_URL,
  R2_BUCKET_NAME: TEST_BUCKET,
  ...SECRET_SENTINELS,
});

// Production-shaped ambient sentinels: distinct from SECRET_SENTINELS so a
// mix-up between the ambient environment and a bindings-derived view is
// detectable wherever an ambient `process.env` double is used.
const PROD_SENTINELS = Object.freeze({
  [SERVICE_ROLE_KEY_NAME]: "SENTINEL-PROD-SERVICE-ROLE-VALUE",
  R2_ACCOUNT_ID: "SENTINEL-PROD-ACCOUNT-VALUE",
  R2_ACCESS_KEY_ID: "SENTINEL-PROD-ACCESS-KEY-VALUE",
  R2_SECRET_ACCESS_KEY: "SENTINEL-PROD-SECRET-ACCESS-VALUE",
});
const prodShapedAmbient = () => ({
  SLMM_SCHEDULER_ENABLED: "1",
  SLMM_SCHEDULER_TARGET: "test",
  SUPABASE_URL: `https://${PROD_HOST}`,
  R2_BUCKET_NAME: "srilakshmimangalyamalai",
  ...PROD_SENTINELS,
});

// --- source module loader ---------------------------------------------------
function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function loadModule(rel, context = {}) {
  const exports = {};
  runInNewContext(transpile(readFile(rel)), {
    exports,
    module: { exports },
    console: { log() {}, error() {}, warn() {} },
    URL,
    ...context,
  });
  return exports;
}

const unexpectedImport = (id) => {
  throw new Error(`unexpected import while loading an offline test double: ${id}`);
};

const guard = loadModule("src/lib/storage-scheduler-guard.ts", { require: unexpectedImport });

// The real key validator and URL builder, loaded from source exactly as the
// deletion harness does (storage-key.ts has no imports of its own).
const { isCanonicalStorageKey, assertCanonicalStorageKey, storageObjectUrl } = loadModule(
  "src/lib/storage-key.ts",
  { require: unexpectedImport },
);

const OK_DIAGNOSTICS = Object.freeze({
  claim: "empty",
  claimed: 0,
  deleted: 0,
  blocked: 0,
  blockedUnavailable: 0,
  failed: 0,
  quotaResyncListing: "ok",
  ok: true,
});

/** Loads src/lib/storage-scheduler.ts with its two imports substituted. */
function loadScheduler({ env = {}, processDeletion } = {}) {
  const processCalls = [];
  // Every view the real guard was asked to evaluate (the wrapper delegates to
  // the real guard, so behaviour is unchanged and identity is observable).
  const guardViews = [];
  // Lines the scheduler's DEFAULT logger writes (tests that pass their own
  // logger bypass this, so it stays empty for them).
  const logLines = [];
  const processor =
    processDeletion ??
    (async (options) => {
      processCalls.push(options);
      return { processed: 0, quotaResyncs: 0, diagnostics: OK_DIAGNOSTICS };
    });
  const mod = loadModule("src/lib/storage-scheduler.ts", {
    process: { env },
    console: { log: (line) => logLines.push(line), error() {}, warn() {} },
    require: (id) => {
      if (id === "./storage.functions") return { processStorageDeletionRequests: processor };
      if (id === "./storage-scheduler-guard")
        return {
          ...guard,
          evaluateSchedulerTarget: (view) => {
            guardViews.push(view);
            return guard.evaluateSchedulerTarget(view);
          },
        };
      return unexpectedImport(id);
    },
  });
  return { mod, processCalls, processor, guardViews, logLines };
}

/** Loads src/lib/storage-scheduler-plugin.ts with its single import substituted. */
function loadPlugin(schedulerModule) {
  return loadModule("src/lib/storage-scheduler-plugin.ts", {
    require: (id) => (id === "./storage-scheduler" ? schedulerModule : unexpectedImport(id)),
  });
}

function fakeNitroApp() {
  const hooks = new Map();
  return {
    app: { hooks: { hook: (name, handler) => hooks.set(name, handler) } },
    registered: (name) => hooks.has(name),
    emit: (name, payload) => hooks.get(name)(payload),
  };
}

const capture = () => {
  const lines = [];
  return { lines, logger: (line) => lines.push(line) };
};

// Structural comparison that ignores the realm the values were created in:
// `assert/strict` models prototype identity, and a value built inside a vm
// context carries that context's prototypes. Normalising both sides through JSON
// compares the data only, which is what these assertions mean.
const eq = (actual, expected, message) =>
  assert.deepEqual(
    JSON.parse(JSON.stringify(actual ?? null)),
    JSON.parse(JSON.stringify(expected ?? null)),
    message,
  );

const parseLog = (lines) => {
  assert.equal(lines.length, 1, "exactly one structured log line per run");
  return JSON.parse(lines[0]);
};

// ---------------------------------------------------------------------------
// 1. Drift pins: schedule and batch limit live in one place each
// ---------------------------------------------------------------------------
test("schedule, batch limit and log marker are the reviewed literals", () => {
  const { mod } = loadScheduler();
  assert.equal(mod.SCHEDULER_CRON, CRON);
  assert.equal(mod.SCHEDULER_BATCH_LIMIT, 10);
  assert.equal(mod.SCHEDULER_LOG_EVENT, "storage-deletion-scheduler");
});

test("the cron literal is identical in the scheduler, the Nitro config and the build check", () => {
  const { mod } = loadScheduler();
  const nitroConfig = readFile(".config/nitro.config.mjs");
  const buildCheck = readFile("scripts/check-build-target.mjs");
  const nitroCron = /const STORAGE_SCHEDULER_CRON = "([^"]+)";/.exec(nitroConfig);
  const checkCron = /const SCHEDULER_CRON = "([^"]+)";/.exec(buildCheck);
  assert.ok(nitroCron, "nitro.config.mjs must pin STORAGE_SCHEDULER_CRON");
  assert.ok(checkCron, "check-build-target.mjs must pin SCHEDULER_CRON");
  assert.equal(nitroCron[1], mod.SCHEDULER_CRON, "nitro.config.mjs cron drifted");
  assert.equal(checkCron[1], mod.SCHEDULER_CRON, "check-build-target.mjs cron drifted");
});

test("the Nitro config installs the TEST-only trigger and plugin, and uses no task runtime", () => {
  const src = readFile(".config/nitro.config.mjs");
  assert.ok(
    /triggers:\s*\{\s*crons:\s*\[\s*STORAGE_SCHEDULER_CRON\s*\]\s*\}/.test(src),
    "the TEST branch must install exactly the scheduler cron trigger",
  );
  assert.ok(src.includes("plugins: [storageSchedulerPlugin]"), "the TEST branch must register the plugin");
  assert.ok(
    src.includes('"../src/lib/storage-scheduler-plugin.ts"'),
    "the plugin path must point at the scheduler plugin module",
  );
  assert.ok(src.includes("isTestBuild") && src.includes(": {};"), "the non-TEST branch must stay empty");
  // The Nitro tasks path would pull in `croner`, which is not installed. The
  // prose may mention it, but the exported options must not set it.
  assert.ok(!/^\s*experimental\s*:/m.test(src), "must not enable Nitro experimental features");
  assert.ok(!/^\s*scheduledTasks\s*:/m.test(src), "must not use the Nitro tasks path");
  assert.ok(!/^\s*tasks\s*:/m.test(src), "must not declare Nitro tasks");
  assert.ok(!src.includes(SUPABASE_PROJECT_REFS.prod), "the Nitro config must not name production");
});

test("the guard names the TEST project only, never production", () => {
  const src = readFile("src/lib/storage-scheduler-guard.ts");
  assert.ok(src.includes(SUPABASE_PROJECT_REFS.test), "the guard must pin the TEST project");
  assert.ok(!src.includes(SUPABASE_PROJECT_REFS.prod), "the guard must not name the production project");
  assert.ok(src.includes(TEST_BUCKET), "the guard must pin the TEST bucket");
});

test("the scheduler modules are imported only by the plugin and each other", () => {
  const importers = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && /from\s+"[^"]*storage-scheduler/.test(readFileSync(full, "utf8"))) {
        importers.push(path.relative(ROOT, full).replace(/\\/g, "/"));
      }
    }
  };
  walk(path.join(ROOT, "src"));
  assert.deepEqual(importers.sort(), [
    "src/lib/storage-scheduler-plugin.ts",
    "src/lib/storage-scheduler.ts",
  ]);
  assert.ok(!readFile("src/server.ts").includes("storage-scheduler"), "the SSR entry must not reference the scheduler");
});

// ---------------------------------------------------------------------------
// 2. Guard: fail closed
// ---------------------------------------------------------------------------
test("the guard refuses an empty environment with every reason code", () => {
  const decision = guard.evaluateSchedulerTarget({});
  assert.equal(decision.allowed, false);
  eq(decision.reasons, [
    "scheduler_disabled",
    "target_not_test",
    "supabase_host_not_test",
    "bucket_not_test",
    "credentials_missing",
  ]);
  assert.equal(decision.checks.length, 5);
  assert.ok(decision.checks.every((check) => check.ok === false));
});

test("the guard allows a complete, exact TEST environment", () => {
  const decision = guard.evaluateSchedulerTarget(allowedEnv());
  assert.equal(decision.allowed, true);
  eq(decision.reasons, []);
  assert.ok(decision.checks.every((check) => check.ok === true));
});

for (const value of [undefined, "", "1 ", " 1", "true", "yes", "0", 1]) {
  test(`the guard refuses SLMM_SCHEDULER_ENABLED=${JSON.stringify(value)}`, () => {
    const env = { ...allowedEnv() };
    if (value === undefined) delete env.SLMM_SCHEDULER_ENABLED;
    else env.SLMM_SCHEDULER_ENABLED = value;
    const decision = guard.evaluateSchedulerTarget(env);
    assert.equal(decision.allowed, false);
    eq(decision.reasons, ["scheduler_disabled"]);
  });
}

for (const value of [undefined, "", "prod", "production", "TEST", "Test", "test ", " test", "staging", "local"]) {
  test(`the guard refuses SLMM_SCHEDULER_TARGET=${JSON.stringify(value)}`, () => {
    const env = { ...allowedEnv() };
    if (value === undefined) delete env.SLMM_SCHEDULER_TARGET;
    else env.SLMM_SCHEDULER_TARGET = value;
    const decision = guard.evaluateSchedulerTarget(env);
    assert.equal(decision.allowed, false);
    eq(decision.reasons, ["target_not_test"]);
  });
}

// Host matching is exact: none of these may be accepted, including production.
const rejectedHosts = [
  ["production", `https://${PROD_HOST}`],
  ["a suffix after the TEST host", `${TEST_URL}.evil.test`],
  ["a prefix before the TEST host", `https://x${TEST_HOST}`],
  ["http (not https)", `http://${TEST_HOST}`],
  ["embedded credentials", `https://user:pw@${TEST_HOST}`],
  ["bare host without a scheme", TEST_HOST],
  ["another project", "https://example.supabase.co"],
  ["a non-URL", "not a url"],
];
for (const [label, value] of rejectedHosts) {
  test(`the guard refuses SUPABASE_URL with ${label}`, () => {
    const decision = guard.evaluateSchedulerTarget({ ...allowedEnv(), SUPABASE_URL: value });
    assert.equal(decision.allowed, false);
    assert.ok(decision.reasons.includes("supabase_host_not_test"), label);
  });
}

for (const [label, value] of [
  ["an empty string", ""],
  ["a non-string value", 42],
]) {
  test(`the guard treats SUPABASE_URL ${label} as both a bad host and a missing credential`, () => {
    const decision = guard.evaluateSchedulerTarget({ ...allowedEnv(), SUPABASE_URL: value });
    assert.equal(decision.allowed, false);
    eq(decision.reasons, ["supabase_host_not_test", "credentials_missing"]);
  });
}

test("the guard accepts the canonical TEST URL forms", () => {
  for (const value of [TEST_URL, `${TEST_URL}/`, `${TEST_URL}/rest/v1`, `https://${TEST_HOST}:443`]) {
    assert.equal(guard.evaluateSchedulerTarget({ ...allowedEnv(), SUPABASE_URL: value }).allowed, true, value);
  }
});

test("host matching is by host, not by string, so URL padding is normalised away", () => {
  // `new URL()` strips surrounding whitespace, so a padded value still resolves
  // to the exact TEST host. Matching the parsed host (never a substring) is the
  // guarantee that matters; the padding itself is not treated as a new target.
  assert.equal(guard.evaluateSchedulerTarget({ ...allowedEnv(), SUPABASE_URL: ` ${TEST_URL}` }).allowed, true);
});

for (const value of [undefined, "", `${TEST_BUCKET}-backup`, `${TEST_BUCKET}2`, "srilakshmimangalyamalai", TEST_BUCKET.toUpperCase(), 1]) {
  test(`the guard refuses R2_BUCKET_NAME=${JSON.stringify(value)}`, () => {
    const env = { ...allowedEnv() };
    if (value === undefined) delete env.R2_BUCKET_NAME;
    else env.R2_BUCKET_NAME = value;
    const decision = guard.evaluateSchedulerTarget(env);
    assert.equal(decision.allowed, false);
    eq(decision.reasons, ["bucket_not_test"]);
  });
}

for (const key of Object.keys(SECRET_SENTINELS)) {
  test(`the guard refuses a missing ${key}`, () => {
    const env = { ...allowedEnv() };
    delete env[key];
    const decision = guard.evaluateSchedulerTarget(env);
    assert.equal(decision.allowed, false);
    eq(decision.reasons, ["credentials_missing"]);
    const detail = decision.checks.find((check) => check.name === "required credentials are present");
    assert.ok(detail.detail.includes(key), "the denial must name the missing key (names only)");
  });
}

for (const value of ["", undefined, null, 0, false, {}]) {
  test(`the guard treats a non-string credential (${JSON.stringify(value)}) as missing`, () => {
    const decision = guard.evaluateSchedulerTarget({ ...allowedEnv(), R2_ACCESS_KEY_ID: value });
    assert.equal(decision.allowed, false);
    eq(decision.reasons, ["credentials_missing"]);
  });
}

test("a guard decision never contains a credential value", () => {
  const serialized = JSON.stringify(guard.evaluateSchedulerTarget(allowedEnv()));
  for (const sentinel of Object.values(SECRET_SENTINELS)) assert.ok(!serialized.includes(sentinel));
  const refused = JSON.stringify(guard.evaluateSchedulerTarget({ ...allowedEnv(), R2_BUCKET_NAME: "other" }));
  assert.ok(!refused.includes(TEST_URL), "even the refusal must not echo the URL value");
});

test("the guard is total: it never throws on hostile input", () => {
  for (const env of [undefined, null, [], "string", 7, { SUPABASE_URL: {} }, { SLMM_SCHEDULER_ENABLED: [] }]) {
    assert.doesNotThrow(() => guard.evaluateSchedulerTarget(env));
    assert.equal(guard.evaluateSchedulerTarget(env).allowed, false);
  }
});

// ---------------------------------------------------------------------------
// 3. Scheduler: cron gate, guard-first ordering, outcomes, safe logging
// ---------------------------------------------------------------------------
test("the scheduler refuses any cron it did not install and never calls the processor", async () => {
  for (const cron of [null, undefined, "", "* * * * *", "*/15 * * *", `${CRON} `, "0 * * * *", 1]) {
    const { mod, processCalls } = loadScheduler({ env: allowedEnv() });
    const { lines, logger } = capture();
    const result = await mod.runStorageDeletionScheduler({ cron, env: allowedEnv(), logger });
    assert.equal(result.outcome, "refused", `cron=${JSON.stringify(cron)}`);
    eq(result.reasons, ["cron_mismatch"]);
    assert.equal(result.processed, 0);
    assert.equal(result.quotaResyncs, 0);
    assert.equal(result.diagnostics, null);
    assert.equal(processCalls.length, 0);
    assert.equal(parseLog(lines).outcome, "refused");
  }
});

test("the guard runs before the processor and its reasons are reported verbatim", async () => {
  const { mod, processCalls } = loadScheduler({ env: {} });
  const { lines, logger } = capture();
  const result = await mod.runStorageDeletionScheduler({ cron: CRON, env: { SLMM_SCHEDULER_ENABLED: "1" }, logger });
  assert.equal(result.outcome, "refused");
  eq(result.reasons, [
    "target_not_test",
    "supabase_host_not_test",
    "bucket_not_test",
    "credentials_missing",
  ]);
  assert.equal(processCalls.length, 0, "no privileged work may happen after a refusal");
  eq(parseLog(lines).reasons, result.reasons, "the log must carry the same reasons as the result");
});

test("an allowed run calls the processor once with the limit and the validated credentials", async () => {
  const validatedEnv = allowedEnv();
  const { mod, processCalls } = loadScheduler({
    env: validatedEnv,
    processDeletion: async (options) => {
      processCalls.push(options);
      return {
        processed: 3,
        quotaResyncs: 1,
        diagnostics: { ...OK_DIAGNOSTICS, claim: "claimed", claimed: 3, deleted: 3 },
      };
    },
  });
  const { lines, logger } = capture();
  const result = await mod.runStorageDeletionScheduler({ cron: CRON, env: validatedEnv, logger });
  eq(
    processCalls,
    [{ limit: mod.SCHEDULER_BATCH_LIMIT, credentials: validatedEnv }],
    "the processor must be called once with the batch limit and the exact validated env",
  );
  // The guard validates the same object the processor is handed: this is what
  // proves a PASS means the deletion operations target the checked environment.
  assert.equal(result.outcome, "ok");
  assert.equal(result.processed, 3);
  assert.equal(result.quotaResyncs, 1);
  eq(result.reasons, []);
  const log = parseLog(lines);
  assert.equal(log.event, "storage-deletion-scheduler");
  assert.equal(log.outcome, "ok");
  assert.equal(log.batchLimit, 10);
  eq(log.diagnostics, { ...OK_DIAGNOSTICS, claim: "claimed", claimed: 3, deleted: 3 }, "the log must carry the pass diagnostics");
});

test("the credentials handed to the processor are the validated view, not a re-read of process.env", async () => {
  // Ambient process.env carries PRODUCTION-shaped values; the validated bindings
  // are TEST. The processor must receive the validated TEST view so it can never
  // act on the conflicting ambient configuration.
  const ambient = {
    ...allowedEnv(),
    SUPABASE_URL: PROD_HOST ? `https://${PROD_HOST}` : "",
    R2_BUCKET_NAME: "srilakshmimangalyamalai",
  };
  const bindings = allowedEnv();
  let received = null;
  const { mod } = loadScheduler({
    env: ambient,
    processDeletion: async (options) => {
      received = options.credentials ?? null;
      return { processed: 0, quotaResyncs: 0, diagnostics: OK_DIAGNOSTICS };
    },
  });
  const { logger } = capture();
  const result = await mod.runStorageDeletionScheduler({ cron: CRON, env: bindings, logger });
  assert.equal(result.outcome, "ok");
  assert.ok(received, "the processor must receive an explicit credential source");
  eq(received, bindings, "the processor must receive the validated bindings, not ambient process.env");
  assert.notEqual(received.SUPABASE_URL, ambient.SUPABASE_URL, "must not fall back to the ambient endpoint");
  assert.notEqual(received.R2_BUCKET_NAME, ambient.R2_BUCKET_NAME, "must not fall back to the ambient bucket");
});

for (const [label, diagnostics, expected] of [
  ["a claim error", { claim: "rpc_error", ok: false }, "partial"],
  ["a transport error", { claim: "transport_error", ok: false }, "partial"],
  ["a malformed claim payload", { claim: "malformed", ok: false }, "partial"],
  ["a failed pass", { claim: "claimed", claimed: 1, failed: 1, ok: false }, "partial"],
  ["an unavailable reference check", { claim: "claimed", claimed: 1, blockedUnavailable: 1, ok: false }, "partial"],
  ["an empty queue", { claim: "empty", ok: true }, "ok"],
]) {
  test(`the scheduler reports ${expected} for ${label}`, async () => {
    const { mod } = loadScheduler({
      env: allowedEnv(),
      processDeletion: async () => ({
        processed: diagnostics.ok ? 0 : 1,
        quotaResyncs: 0,
        diagnostics: { ...OK_DIAGNOSTICS, ...diagnostics },
      }),
    });
    const { lines, logger } = capture();
    const result = await mod.runStorageDeletionScheduler({ cron: CRON, env: allowedEnv(), logger });
    assert.equal(result.outcome, expected);
    assert.equal(parseLog(lines).outcome, expected);
  });
}

test("a processor failure becomes an error outcome and never leaks the message", async () => {
  const { mod } = loadScheduler({
    env: allowedEnv(),
    processDeletion: async () => {
      throw new Error(`upstream said ${TEST_URL} ${SECRET_SENTINELS[SERVICE_ROLE_KEY_NAME]}`);
    },
  });
  const { lines, logger } = capture();
  const result = await mod.runStorageDeletionScheduler({ cron: CRON, env: allowedEnv(), logger });
  assert.equal(result.outcome, "error");
  eq(result.reasons, ["scheduler_error"]);
  assert.equal(result.processed, 0);
  assert.equal(result.diagnostics, null);
  const raw = lines.join("\n");
  assert.ok(!raw.includes(TEST_URL), "the log must not echo the endpoint");
  assert.ok(!raw.includes(SECRET_SENTINELS[SERVICE_ROLE_KEY_NAME]), "the log must not echo a credential");
  assert.ok(!raw.includes("upstream said"), "the log must not echo the upstream message");
});

test("no run ever logs a credential value, on any path", async () => {
  for (const outcome of ["refused", "ok", "partial", "error"]) {
    const { mod } = loadScheduler({
      env: allowedEnv(),
      processDeletion: async () => {
        if (outcome === "error") throw new Error("boom");
        return { processed: 0, quotaResyncs: 0, diagnostics: { ...OK_DIAGNOSTICS, ok: outcome === "ok" } };
      },
    });
    const { lines, logger } = capture();
    const env = outcome === "refused" ? { SLMM_SCHEDULER_ENABLED: "1" } : allowedEnv();
    await mod.runStorageDeletionScheduler({ cron: CRON, env, logger });
    const raw = lines.join("\n");
    for (const sentinel of Object.values(SECRET_SENTINELS)) assert.ok(!raw.includes(sentinel));
    assert.ok(JSON.parse(lines[0]).event === "storage-deletion-scheduler");
  }
});

// ---------------------------------------------------------------------------
// 4. Environment projection
// ---------------------------------------------------------------------------
test("collectSchedulerEnv prefers bindings, falls back to the ambient environment, and whitelists keys", () => {
  const { mod } = loadScheduler({
    env: { ...allowedEnv(), R2_BUCKET_NAME: "ambient-bucket", EVIL_EXTRA_KEY: "must-not-be-copied" },
  });
  const view = mod.collectSchedulerEnv({
    ...allowedEnv(),
    R2_BUCKET_NAME: "binding-bucket",
    R2_ACCOUNT_ID: "",
    EVIL_EXTRA_KEY: "must-not-be-copied",
  });
  assert.equal(view.R2_BUCKET_NAME, "binding-bucket", "a binding must win over the ambient value");
  assert.equal(view.R2_ACCOUNT_ID, SECRET_SENTINELS.R2_ACCOUNT_ID, "an empty binding must fall back");
  assert.equal(view.SUPABASE_URL, TEST_URL);
  assert.ok(!("EVIL_EXTRA_KEY" in view), "only whitelisted keys may be projected");
});

test("collectSchedulerEnv with no bindings is exactly the ambient view", () => {
  const { mod } = loadScheduler({ env: allowedEnv() });
  const view = mod.collectSchedulerEnv();
  for (const [key, value] of Object.entries(allowedEnv())) assert.equal(view[key], value);
  assert.equal(guard.evaluateSchedulerTarget(view).allowed, true);
});

test("collectSchedulerBindings reads ONLY the bindings: the ambient environment is never consulted", () => {
  // The ambient double here is a COMPLETE TEST environment; the projection must
  // still return only the keys the bindings themselves carry.
  const { mod } = loadScheduler({ env: allowedEnv() });
  const partial = { SLMM_SCHEDULER_ENABLED: "1", R2_BUCKET_NAME: TEST_BUCKET };
  eq(mod.collectSchedulerBindings(partial), partial, "only the supplied bindings may appear in the view");
  eq(mod.collectSchedulerBindings({}), {}, "empty bindings must project empty, never to the ambient view");
  eq(mod.collectSchedulerBindings(undefined), {}, "a missing event.env must project empty");
  eq(mod.collectSchedulerBindings(null), {}, "a null event.env must project empty");
  eq(mod.collectSchedulerBindings("hostile"), {}, "a non-object binding source must project empty");
});

test("collectSchedulerBindings drops empty, non-string and unlisted values instead of borrowing the ambient ones", () => {
  const { mod } = loadScheduler({ env: allowedEnv() });
  const view = mod.collectSchedulerBindings({
    ...allowedEnv(),
    SUPABASE_URL: "", // an empty binding is absent, not borrowed
    R2_ACCOUNT_ID: null, // non-string: absent
    EVIL_EXTRA_KEY: "must-not-be-copied",
  });
  assert.ok(!("SUPABASE_URL" in view), "an empty binding must be dropped so the guard reports it missing");
  assert.ok(!("R2_ACCOUNT_ID" in view), "a non-string binding must be dropped");
  assert.ok(!("EVIL_EXTRA_KEY" in view), "only whitelisted keys may be projected");
  assert.equal(view.SLMM_SCHEDULER_ENABLED, "1", "valid bindings must survive projection");
  assert.equal(view.R2_SECRET_ACCESS_KEY, SECRET_SENTINELS.R2_SECRET_ACCESS_KEY);
});

test("collectSchedulerBindings is total: a hostile binding source refuses instead of throwing", () => {
  const { mod } = loadScheduler({ env: allowedEnv() });
  const view = mod.collectSchedulerBindings({
    get SLMM_SCHEDULER_ENABLED() {
      throw new Error("boom");
    },
  });
  eq(view, {}, "an unreadable binding source may only ever project an incomplete view");
  assert.equal(guard.evaluateSchedulerTarget(view).allowed, false, "and the guard must refuse it");
});

test("the scheduler defaults to the projected environment when none is passed", async () => {
  const { mod, processCalls } = loadScheduler({ env: allowedEnv() });
  const { lines, logger } = capture();
  const result = await mod.runStorageDeletionScheduler({ cron: CRON, logger });
  assert.equal(result.outcome, "ok");
  assert.equal(processCalls.length, 1);
  assert.equal(parseLog(lines).outcome, "ok");
});

// ---------------------------------------------------------------------------
// 5. Nitro plugin
// ---------------------------------------------------------------------------
test("the plugin registers cloudflare:scheduled, ignores other crons, and forwards the bindings", async () => {
  const calls = [];
  const plugin = loadPlugin({
    SCHEDULER_CRON: CRON,
    collectSchedulerBindings: (bindings) => ({ projected: true, bindings }),
    runStorageDeletionScheduler: async (input) => {
      calls.push(input);
      return {};
    },
  });
  assert.equal(typeof plugin.default, "function");
  const nitro = fakeNitroApp();
  plugin.default(nitro.app);
  assert.equal(nitro.registered("cloudflare:scheduled"), true);

  await nitro.emit("cloudflare:scheduled", { controller: { cron: "0 * * * *" }, env: { A: "1" } });
  await nitro.emit("cloudflare:scheduled", {});
  await nitro.emit("cloudflare:scheduled", { controller: {}, env: {} });
  await nitro.emit("cloudflare:scheduled", { controller: null, env: null });
  assert.equal(calls.length, 0, "only the installed cron may run the scheduler");

  const bindings = { SLMM_SCHEDULER_ENABLED: "1" };
  await nitro.emit("cloudflare:scheduled", { controller: { cron: CRON }, env: bindings });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cron, CRON);
  eq(calls[0].env, { projected: true, bindings }, "the plugin must forward the projected bindings");
});

test("the plugin never throws when the Cloudflare event is malformed", async () => {
  const plugin = loadPlugin({
    SCHEDULER_CRON: CRON,
    collectSchedulerBindings: () => ({}),
    runStorageDeletionScheduler: async () => ({}),
  });
  const nitro = fakeNitroApp();
  plugin.default(nitro.app);
  for (const payload of [undefined, null, {}, { controller: { cron: CRON } }]) {
    await assert.doesNotReject(() => nitro.emit("cloudflare:scheduled", payload));
  }
});

// --- scheduled-event bindings: event.env is the ONLY configuration source ---
// The ambient `process.env` double under the real scheduler is deliberately
// COMPLETE (TEST-shaped, or production-shaped) in the tests below: before the
// bindings-only projection existed, collectSchedulerEnv silently completed an
// incomplete event.env from the ambient environment and the run proceeded
// against credentials the event never carried. Every incomplete scenario must
// now refuse, with the processor untouched and one structured log line.

/** The real plugin over the real scheduler and guard, emitting `cloudflare:scheduled`. */
function loadScheduledPlugin({ env = {}, processDeletion } = {}) {
  const scheduler = loadScheduler({ env, processDeletion });
  const plugin = loadPlugin(scheduler.mod);
  const nitro = fakeNitroApp();
  plugin.default(nitro.app);
  return { ...scheduler, emit: (payload) => nitro.emit("cloudflare:scheduled", payload) };
}

test("a scheduled run with no event.env refuses before the processor, despite a complete ambient TEST environment", async () => {
  const { processCalls, logLines, emit } = loadScheduledPlugin({ env: allowedEnv() });
  await emit({ controller: { cron: CRON } }); // event.env missing entirely
  assert.equal(processCalls.length, 0, "no bindings must never reach the processor");
  const log = parseLog(logLines);
  assert.equal(log.event, "storage-deletion-scheduler");
  assert.equal(log.outcome, "refused");
  eq(log.reasons, [
    "scheduler_disabled",
    "target_not_test",
    "supabase_host_not_test",
    "bucket_not_test",
    "credentials_missing",
  ]);
});

test("an incomplete or empty event.env refuses instead of being completed from the ambient environment", async () => {
  const scenarios = [
    ["a missing credential", (env) => delete env.R2_SECRET_ACCESS_KEY, ["credentials_missing"]],
    [
      "an empty credential value",
      (env) => {
        env.SUPABASE_URL = "";
      },
      ["supabase_host_not_test", "credentials_missing"],
    ],
    ["a missing scheduler switch", (env) => delete env.SLMM_SCHEDULER_ENABLED, ["scheduler_disabled"]],
    ["a missing target switch", (env) => delete env.SLMM_SCHEDULER_TARGET, ["target_not_test"]],
    [
      "a wrong bucket binding",
      (env) => {
        env.R2_BUCKET_NAME = "prod-bucket";
      },
      ["bucket_not_test"],
    ],
  ];
  for (const [label, mutate, reasons] of scenarios) {
    const bindings = allowedEnv();
    mutate(bindings);
    const { processCalls, logLines, emit } = loadScheduledPlugin({ env: allowedEnv() }); // ambient: complete TEST
    await emit({ controller: { cron: CRON }, env: bindings });
    assert.equal(processCalls.length, 0, `${label}: the ambient environment must never complete the bindings`);
    eq(parseLog(logLines).reasons, reasons, label);
  }
});

test("the guard validates the exact binding-derived object the processor receives", async () => {
  const bindings = allowedEnv();
  // The ambient environment is production-shaped on purpose: nothing from it
  // may reach the view, and the view must be the guard's input itself.
  const { processCalls, guardViews, logLines, emit } = loadScheduledPlugin({ env: prodShapedAmbient() });
  await emit({ controller: { cron: CRON }, env: bindings });
  assert.equal(processCalls.length, 1, "a complete binding set must run");
  assert.equal(guardViews.length, 1, "the guard must have validated exactly one view");
  assert.equal(
    processCalls[0].credentials,
    guardViews[0],
    "the guard input and the processor credentials must be the same object",
  );
  eq(processCalls[0].credentials, bindings, "and that object must be exactly the projected event.env");
  assert.equal(parseLog(logLines).outcome, "ok");
  for (const sentinel of Object.values(PROD_SENTINELS)) {
    assert.ok(
      !JSON.stringify(processCalls[0].credentials).includes(sentinel),
      "no ambient production value may reach the credentials",
    );
  }
});

test("the scheduled path is bindings-only at the source", () => {
  const pluginSrc = readFile("src/lib/storage-scheduler-plugin.ts");
  assert.ok(pluginSrc.includes("collectSchedulerBindings("), "the plugin must project from event.env only");
  assert.ok(
    !pluginSrc.includes("collectSchedulerEnv"),
    "the ambient-fallback projection must not appear in the scheduled path",
  );

  const schedulerSrc = readFile("src/lib/storage-scheduler.ts");
  const start = schedulerSrc.indexOf("export function collectSchedulerBindings");
  const end = schedulerSrc.indexOf("export async function runStorageDeletionScheduler", start);
  assert.ok(start >= 0 && end > start, "the bindings-only projection moved");
  assert.ok(
    !schedulerSrc.slice(start, end).includes("process.env"),
    "the bindings-only projection must not consult the ambient environment",
  );
});

// ---------------------------------------------------------------------------
// 6. Batch processor diagnostics (real source slice, mocked service boundary)
// ---------------------------------------------------------------------------
const functionsSource = readFile("src/lib/storage.functions.ts");
const sliceStart = functionsSource.indexOf("const zStorageKey = z");
const sliceEnd = functionsSource.indexOf("/** Returns a short-lived view URL.", sliceStart);
assert.ok(sliceStart >= 0 && sliceEnd > sliceStart, "the deletion slice markers moved");

const OWNER = "mock-owner";
const STORAGE_KEY = `${OWNER}/govt_id/example.pdf`;
const REQUEST_PREFIX = "22222222-2222-2222-2222-22222222222";
const claimRow = (n, extra = {}) => ({
  id: `${REQUEST_PREFIX}${n}`,
  storage_key: STORAGE_KEY,
  owner_id: OWNER,
  lease_token: `lease-${n}`,
  status: "deleting",
  r2_state: "not_attempted",
  finalize_state: "pending",
  document_row_ids: [],
  attempt_count: 1,
  ...extra,
});

function loadProcessor(options = {}) {
  const calls = [];
  // Records the credential argument each privileged seam receives, so a test
  // can prove every RPC / R2 sign / quota resync in a pass operates on the
  // same credential view (and that the ambient path passes none).
  const credentialViews = [];
  let confirmThrowsFor = options.confirmThrowsFor ?? null;
  const serviceRpc = async (name, args, credentials) => {
    calls.push(name);
    credentialViews.push(credentials);
    switch (name) {
      case "claim_storage_deletion_request":
        assert.deepEqual(Object.keys(args), ["p_request_id"]);
        if (options.claimThrows) throw new Error("service boundary down");
        if (options.claimError) return { data: null, error: options.claimError };
        return { data: "singleClaimData" in options ? options.singleClaimData : [], error: null };
      case "claim_storage_deletion_requests":
        assert.deepEqual(Object.keys(args), ["p_limit"]);
        assert.equal(args.p_limit, options.limit ?? 25);
        if (options.claimThrows) throw new Error("service boundary down");
        if (options.claimError) return { data: null, error: options.claimError };
        // Presence-based: an explicit `null` must stay null (a malformed payload
        // is a claim failure), never be quietly coerced into an empty queue.
        return { data: "claims" in options ? options.claims : [], error: null };
      case "fence_storage_key_for_deletion":
        // Presence-based for the same reason: `null` means "RPC unavailable".
        return { data: "fence" in options ? options.fence : "fenced", error: null };
      case "set_r2_confirmed_absent":
        if (confirmThrowsFor && args.p_request_id === confirmThrowsFor) {
          confirmThrowsFor = null;
          throw new Error("lost response");
        }
        return { data: true, error: null };
      case "block_storage_deletion":
      case "record_storage_deletion_failure":
      case "finalize_storage_deletion":
      case "mark_storage_deletion_quota_resynced":
        return { data: true, error: null };
      case "list_storage_deletion_quota_resyncs":
        return { data: options.resyncRecords ?? [], error: options.resyncListError ?? null };
      default:
        throw new Error(`unexpected service rpc: ${name}`);
    }
  };

  const exports = {};
  const requireSupabaseAuth = Symbol("auth");
  const serverFnChain = { middleware: () => serverFnChain, inputValidator: () => serverFnChain, handler: (fn) => fn };
  runInNewContext(transpile(functionsSource.slice(sliceStart, sliceEnd)), {
    exports,
    module: { exports },
    console: { log() {}, error() {}, warn() {} },
    URL,
    z,
    isCanonicalStorageKey,
    requireSupabaseAuth,
    storageDeletionServiceRpc: serviceRpc,
    createServerFn: () => serverFnChain,
    signR2: async (key, method, contentType, credentials) => {
      credentialViews.push(credentials);
      return "https://mock.invalid/deletion";
    },
    fetch: async () => {
      calls.push("r2-delete");
      const status = options.r2Status ?? 204;
      return { ok: status >= 200 && status < 300, status };
    },
    resyncProfileQuota: async (owner, credentials) => {
      credentialViews.push(credentials);
      calls.push("quota-resync");
      if (options.resyncError) throw new Error("quota failed");
    },
  });
  return { process: (opts) => exports.processStorageDeletionRequests(opts), calls, credentialViews };
}

test("an empty queue is reported as an empty claim, not a failure", async () => {
  const ctx = loadProcessor({ claims: [] });
  const result = await ctx.process();
  assert.equal(result.processed, 0);
  assert.equal(result.quotaResyncs, 0);
  assert.equal(result.diagnostics.claim, "empty");
  assert.equal(result.diagnostics.claimed, 0);
  assert.equal(result.diagnostics.ok, true);
  assert.deepEqual(ctx.calls, ["claim_storage_deletion_requests", "list_storage_deletion_quota_resyncs"]);
});

test("a claim RPC error is distinguishable from an empty queue", async () => {
  const ctx = loadProcessor({ claimError: { code: "PGRST202", message: "missing" } });
  const result = await ctx.process();
  assert.equal(result.processed, 0);
  assert.equal(result.diagnostics.claim, "rpc_error");
  assert.equal(result.diagnostics.ok, false);
});

test("a claim transport failure is distinguishable from an empty queue", async () => {
  const ctx = loadProcessor({ claimThrows: true });
  const result = await ctx.process();
  assert.equal(result.processed, 0);
  assert.equal(result.diagnostics.claim, "transport_error");
  assert.equal(result.diagnostics.ok, false);
});

for (const [label, data] of [
  ["rows that fail shape validation", [{}]],
  ["a non-array payload", { not: "an array" }],
  ["a null payload", null],
]) {
  test(`a malformed claim payload (${label}) is reported and processed nothing`, async () => {
    const ctx = loadProcessor({ claims: data });
    const result = await ctx.process();
    assert.equal(result.processed, 0);
    assert.equal(result.diagnostics.claim, "malformed");
    assert.equal(result.diagnostics.ok, false);
  });
}

test("a claimed, finalised deletion is counted as deleted", async () => {
  const ctx = loadProcessor({ claims: [claimRow(1, { finalize_state: "done" })] });
  const result = await ctx.process();
  assert.equal(result.processed, 1);
  assert.equal(result.diagnostics.claim, "claimed");
  assert.equal(result.diagnostics.claimed, 1);
  assert.equal(result.diagnostics.deleted, 1);
  assert.equal(result.diagnostics.ok, true);
});

test("a fully executed deletion is counted as deleted", async () => {
  const ctx = loadProcessor({ claims: [claimRow(1)] });
  const result = await ctx.process();
  assert.equal(result.diagnostics.deleted, 1);
  assert.equal(result.diagnostics.failed, 0);
  assert.equal(result.diagnostics.ok, true);
  assert.deepEqual(ctx.calls, [
    "claim_storage_deletion_requests",
    "fence_storage_key_for_deletion",
    "r2-delete",
    "set_r2_confirmed_absent",
    "finalize_storage_deletion",
    "quota-resync",
    "mark_storage_deletion_quota_resynced",
    "list_storage_deletion_quota_resyncs",
  ]);
});

test("a protected-reference block is counted as blocked and keeps the pass ok", async () => {
  const ctx = loadProcessor({ claims: [claimRow(1)], fence: "blocked_protected_reference" });
  const result = await ctx.process();
  assert.equal(result.diagnostics.blocked, 1);
  assert.equal(result.diagnostics.blockedUnavailable, 0);
  assert.equal(result.diagnostics.failed, 0);
  assert.equal(result.diagnostics.ok, true, "a deliberate protected block is a safe stop, not a failure");
});

test("an unavailable reference check is counted separately and clears ok", async () => {
  const ctx = loadProcessor({ claims: [claimRow(1)], fence: null });
  const result = await ctx.process();
  assert.equal(result.diagnostics.blocked, 0);
  assert.equal(result.diagnostics.blockedUnavailable, 1);
  assert.equal(result.diagnostics.ok, false);
});

test("an R2 failure is counted as failed and clears ok", async () => {
  const ctx = loadProcessor({ claims: [claimRow(1)], r2Status: 500 });
  const result = await ctx.process();
  assert.equal(result.diagnostics.failed, 1);
  assert.equal(result.diagnostics.deleted, 0);
  assert.equal(result.diagnostics.ok, false);
  assert.equal(result.processed, 1);
});

test("one throwing pass does not stop the others", async () => {
  const ctx = loadProcessor({
    claims: [claimRow(1), claimRow(2)],
    confirmThrowsFor: `${REQUEST_PREFIX}1`,
  });
  const result = await ctx.process();
  assert.equal(result.processed, 2, "both claims must be attempted");
  assert.equal(result.diagnostics.failed, 1);
  assert.equal(result.diagnostics.deleted, 1);
  assert.equal(result.diagnostics.ok, false);
});

test("the quota-resync listing status is reported", async () => {
  const ok = await loadProcessor({}).process();
  assert.equal(ok.diagnostics.quotaResyncListing, "ok");
  const unavailable = await loadProcessor({ resyncListError: { message: "down" } }).process();
  assert.equal(unavailable.diagnostics.quotaResyncListing, "unavailable");
  assert.equal(unavailable.diagnostics.ok, true, "a best-effort recovery listing must not fail the delete pass");
});

test("diagnostics keep the legacy fields and add only counts and enums", async () => {
  const result = await loadProcessor({ claims: [] }).process();
  assert.equal(typeof result.processed, "number");
  assert.equal(typeof result.quotaResyncs, "number");
  assert.deepEqual(Object.keys(result).sort(), ["diagnostics", "processed", "quotaResyncs"]);
  assert.deepEqual(Object.keys(result.diagnostics).sort(), [
    "blocked",
    "blockedUnavailable",
    "claim",
    "claimed",
    "deleted",
    "failed",
    "ok",
    "quotaResyncListing",
  ]);
});

test("the single-request claim path reports an empty queue the same way", async () => {
  const ctx = loadProcessor({ singleClaimData: [] });
  const result = await ctx.process({ requestId: `${REQUEST_PREFIX}9` });
  assert.equal(result.diagnostics.claim, "empty");
  assert.equal(result.diagnostics.ok, true);
  assert.deepEqual(ctx.calls, ["claim_storage_deletion_request", "list_storage_deletion_quota_resyncs"]);
});

// ---------------------------------------------------------------------------
// 7. Credential threading: the validated view is the ONLY source (real readers)
//
// This section loads the real credential readers from storage.functions.ts
// (readCredential, signR2, r2OwnerUsage, quotaAdminClient,
// storageDeletionServiceRpc) into a vm whose ambient `process.env` is shaped
// like PRODUCTION, and intercepts the two lazily-imported SDKs so the exact
// credentials used to sign R2 requests and to build the service-role client
// can be observed. It proves: an explicit TEST view wins over a conflicting
// production ambient, a missing explicit key fails closed instead of borrowing
// the ambient one, and the no-source HTTP path is unchanged.
// ---------------------------------------------------------------------------

// Real credential-reader region: from the StorageCredentials type to the end of
// storageDeletionServiceRpc (which ends immediately before the
// reserveProfileQuota doc comment). The trailing export list exposes the
// module-private readers to the harness; the TypeScript erases it to plain
// `exports.<name> = <name>` assignments.
const credentialReaderSource = (() => {
  const start = functionsSource.indexOf("export type StorageCredentials");
  const end = functionsSource.indexOf("async function reserveProfileQuota", start);
  assert.ok(start >= 0 && end > start, "the credential-reader markers moved");
  return `${functionsSource.slice(start, end)}
export { readCredential, signR2, r2OwnerUsage, quotaAdminClient, storageDeletionServiceRpc };
`;
})();

// The real upload-limit codes, so the slice's module-level
// `UPLOAD_LIMIT_CODES` binding resolves to the production values.
const compressModule = loadModule("src/lib/compress.ts", { require: unexpectedImport });

/** Loads the real credential readers with the two SDKs and R2 listing mocked. */
function loadCredentialReaders({ ambientEnv = {}, listingXml = "" } = {}) {
  const calls = { awsConfigs: [], signs: [], clients: [], rpcs: [], gets: [] };
  const aws4 = {
    AwsClient: class {
      constructor(config) {
        calls.awsConfigs.push({ ...config });
      }
      async sign(request) {
        calls.signs.push({ url: String(request.url), method: request.method });
        return { url: `https://r2.signed.invalid/object-${calls.signs.length}` };
      }
    },
  };
  const supabaseJs = {
    createClient: (url, key) => {
      calls.clients.push({ url, key });
      return {
        rpc: async (name, args) => {
          calls.rpcs.push({ name, args, url, key });
          return { data: true, error: null };
        },
      };
    },
  };
  const exports = {};
  runInNewContext(transpile(credentialReaderSource), {
    exports,
    module: { exports },
    console: { log() {}, error() {}, warn() {} },
    URL,
    Request,
    process: { env: ambientEnv },
    fetch: async (url) => {
      calls.gets.push(String(url));
      return { ok: true, status: 200, text: async () => listingXml };
    },
    assertCanonicalStorageKey,
    storageObjectUrl,
    UPLOAD_LIMIT_PHOTOS: compressModule.UPLOAD_LIMIT_PHOTOS,
    UPLOAD_LIMIT_DOCS: compressModule.UPLOAD_LIMIT_DOCS,
    UPLOAD_LIMIT_TOTAL: compressModule.UPLOAD_LIMIT_TOTAL,
    UPLOAD_LIMIT_STORAGE: compressModule.UPLOAD_LIMIT_STORAGE,
    require: (id) => {
      if (id === "aws4fetch") return aws4;
      if (id === "@supabase/supabase-js") return supabaseJs;
      return unexpectedImport(id);
    },
  });
  return { readers: exports, calls };
}

test("explicit TEST credentials are the only source consulted: the production ambient is ignored", async () => {
  const { readers, calls } = loadCredentialReaders({ ambientEnv: prodShapedAmbient() });
  const explicit = allowedEnv();

  const url = await readers.signR2(STORAGE_KEY, "DELETE", undefined, explicit);
  assert.ok(url, "signing must succeed with the explicit view");
  assert.equal(calls.awsConfigs.length, 1);
  assert.equal(calls.awsConfigs[0].accessKeyId, SECRET_SENTINELS.R2_ACCESS_KEY_ID);
  assert.equal(calls.awsConfigs[0].secretAccessKey, SECRET_SENTINELS.R2_SECRET_ACCESS_KEY);
  // URL hostnames are lowercased by the URL parser, so compare case-insensitively.
  assert.ok(calls.signs[0].url.toLowerCase().includes(explicit.R2_ACCOUNT_ID.toLowerCase()), "the object URL must use the TEST account");
  assert.ok(calls.signs[0].url.includes(explicit.R2_BUCKET_NAME), "the object URL must use the TEST bucket");
  for (const sentinel of Object.values(PROD_SENTINELS)) {
    assert.ok(!calls.signs[0].url.includes(sentinel), "no production ambient value may reach the signed URL");
    assert.ok(!JSON.stringify(calls.awsConfigs).includes(sentinel), "no production ambient value may reach the signer");
  }

  await readers.quotaAdminClient(explicit);
  assert.equal(calls.clients.length, 1);
  assert.deepEqual(calls.clients[0], { url: TEST_URL, key: SECRET_SENTINELS[SERVICE_ROLE_KEY_NAME] });

  await readers.storageDeletionServiceRpc("claim_storage_deletion_requests", { p_limit: 1 }, explicit);
  assert.equal(calls.clients.length, 2, "the RPC boundary must build its client from the same explicit source");
  assert.deepEqual(calls.clients[1], { url: TEST_URL, key: SECRET_SENTINELS[SERVICE_ROLE_KEY_NAME] });
  assert.equal(calls.rpcs.length, 1);
  assert.equal(calls.rpcs[0].name, "claim_storage_deletion_requests");
  for (const client of calls.clients) {
    assert.ok(client.url !== `https://${PROD_HOST}`, "the production ambient endpoint must never be used");
    assert.ok(client.key !== PROD_SENTINELS[SERVICE_ROLE_KEY_NAME], "the production ambient key must never be used");
  }
});

test("the R2 usage listing signs with the explicit credentials, not the ambient ones", async () => {
  const xml = `<ListBucketResult><Contents><Key>${STORAGE_KEY}</Key><Size>1234</Size></Contents>`
    + `<Contents><Key>mock-owner/photo/p.png</Key><Size>99</Size></Contents></ListBucketResult>`;
  const { readers, calls } = loadCredentialReaders({ ambientEnv: prodShapedAmbient(), listingXml: xml });
  const usage = await readers.r2OwnerUsage(OWNER, allowedEnv());
  eq(usage, { totalBytes: 1333, photoCount: 1, docCount: 1 });
  assert.equal(calls.awsConfigs.length, 1);
  assert.equal(calls.awsConfigs[0].accessKeyId, SECRET_SENTINELS.R2_ACCESS_KEY_ID);
  assert.equal(calls.awsConfigs[0].secretAccessKey, SECRET_SENTINELS.R2_SECRET_ACCESS_KEY);
  assert.ok(calls.signs[0].url.toLowerCase().includes(allowedEnv().R2_ACCOUNT_ID.toLowerCase()), "the listing must target the TEST account");
  assert.ok(calls.signs[0].url.includes(TEST_BUCKET), "the listing must target the TEST bucket");
  for (const sentinel of Object.values(PROD_SENTINELS)) {
    assert.ok(!JSON.stringify(calls).includes(sentinel), "no production ambient value may reach R2 or the logs of this pass");
  }
});

test("readCredential consults exactly one source: explicit when given, ambient only when omitted", async () => {
  const ambient = { ...allowedEnv(), R2_BUCKET_NAME: "ambient-bucket" };
  const { readers } = loadCredentialReaders({ ambientEnv: ambient });
  assert.equal(readers.readCredential(undefined, "R2_BUCKET_NAME"), "ambient-bucket");
  assert.equal(readers.readCredential(allowedEnv(), "R2_BUCKET_NAME"), TEST_BUCKET);
  assert.equal(
    readers.readCredential({}, "R2_BUCKET_NAME"),
    undefined,
    "an explicit source that lacks a key must not borrow the ambient one",
  );
});

test("a missing explicit credential fails closed even though the ambient environment has it", async () => {
  const ambient = allowedEnv();
  const { readers, calls } = loadCredentialReaders({ ambientEnv: ambient });

  const partialR2 = { ...ambient };
  delete partialR2.R2_SECRET_ACCESS_KEY;
  await assert.rejects(
    () => readers.signR2(STORAGE_KEY, "DELETE", undefined, partialR2),
    /Cloud storage is not configured yet/,
  );
  assert.equal(calls.awsConfigs.length, 0, "no signer may be built from an unvalidated ambient fallback");

  const partialAdmin = { ...ambient };
  delete partialAdmin[SERVICE_ROLE_KEY_NAME];
  await assert.rejects(
    () => readers.quotaAdminClient(partialAdmin),
    /Server is not configured yet/,
  );
  assert.equal(calls.clients.length, 0, "no service client may be built from an unvalidated ambient fallback");
});

test("credential errors carry no credential value", async () => {
  const { readers } = loadCredentialReaders({ ambientEnv: allowedEnv() });
  const partial = { ...allowedEnv() };
  delete partial.R2_ACCOUNT_ID;
  const err = await readers.signR2(STORAGE_KEY, "DELETE", undefined, partial).then(() => null, (e) => e);
  assert.ok(err, "the rejected read must produce an error");
  for (const sentinel of [...Object.values(SECRET_SENTINELS), ...Object.values(PROD_SENTINELS)]) {
    assert.ok(!String(err.message).includes(sentinel), "the error must not echo a credential value");
  }
});

test("a pass never writes to the credential source or to the ambient environment", async () => {
  const ambient = { ...allowedEnv() };
  const explicit = allowedEnv();
  const ambientSnapshot = JSON.stringify(ambient);
  const explicitSnapshot = JSON.stringify(explicit);
  const { readers } = loadCredentialReaders({ ambientEnv: ambient });
  await readers.signR2(STORAGE_KEY, "DELETE", undefined, explicit);
  await readers.r2OwnerUsage(OWNER, explicit);
  await readers.storageDeletionServiceRpc("set_r2_confirmed_absent", { p_request_id: "x" }, explicit);
  assert.equal(JSON.stringify(ambient), ambientSnapshot, "the ambient environment must be untouched");
  assert.equal(JSON.stringify(explicit), explicitSnapshot, "the validated view must be untouched");
});

test("every privileged call in a pass receives the same validated credential view", async () => {
  const credentials = allowedEnv();
  const ctx = loadProcessor({ claims: [claimRow(1)] });
  const result = await ctx.process({ credentials });
  assert.equal(result.diagnostics.deleted, 1);
  assert.ok(ctx.credentialViews.length >= 7, "the pass must thread credentials through every privileged call");
  for (const view of ctx.credentialViews) {
    assert.equal(view, credentials, "every privileged call must receive the exact validated view");
  }
  assert.ok(ctx.calls.includes("fence_storage_key_for_deletion"));
  assert.ok(ctx.calls.includes("r2-delete"));
});

test("the ambient path passes no credential view at all, exactly as before the DI change", async () => {
  const ctx = loadProcessor({ claims: [claimRow(1)] });
  const result = await ctx.process();
  assert.equal(result.diagnostics.deleted, 1);
  assert.ok(ctx.credentialViews.length >= 7, "the ambient path must still exercise every privileged call");
  for (const view of ctx.credentialViews) {
    assert.equal(view, undefined, "with no explicit source every seam must fall back to process.env");
  }
});

test("the single-request (worker retry) path threads the same credential view", async () => {
  const credentials = allowedEnv();
  const ctx = loadProcessor({
    singleClaimData: [claimRow(1, { attempt_count: 4, r2_state: "uncertain" })],
  });
  const result = await ctx.process({ requestId: `${REQUEST_PREFIX}1`, credentials });
  assert.equal(result.diagnostics.deleted, 1, "a retry of an uncertain delete must still complete");
  assert.deepEqual(ctx.calls.slice(0, 4), [
    "claim_storage_deletion_request",
    "fence_storage_key_for_deletion",
    "r2-delete",
    "set_r2_confirmed_absent",
  ]);
  for (const view of ctx.credentialViews) {
    assert.equal(view, credentials, "the retry path must receive the exact validated view too");
  }
});

test("production-shaped bindings are refused even when the ambient environment is TEST", async () => {
  const productionBindings = prodShapedAmbient();
  const { mod, processCalls } = loadScheduler({ env: allowedEnv() });
  const { lines, logger } = capture();
  const result = await mod.runStorageDeletionScheduler({ cron: CRON, env: productionBindings, logger });
  assert.equal(result.outcome, "refused");
  eq(result.reasons, ["supabase_host_not_test", "bucket_not_test"]);
  assert.equal(processCalls.length, 0, "a production target must never reach the processor");
  eq(parseLog(lines).reasons, result.reasons, "the log must carry the same reasons as the result");
});

test("no R2 DELETE or metadata write happens before a committed fence", async () => {
  for (const [label, fence] of [
    ["an unavailable fence", null],
    ["a protected reference", "blocked_protected_reference"],
    ["a changed document set", "blocked_document_set_changed"],
  ]) {
    const ctx = loadProcessor({ claims: [claimRow(1)], fence });
    const result = await ctx.process();
    assert.ok(result.diagnostics.ok === true || result.diagnostics.blockedUnavailable === 1);
    for (const forbidden of ["r2-delete", "set_r2_confirmed_absent", "finalize_storage_deletion", "mark_storage_deletion_quota_resynced"]) {
      assert.equal(ctx.calls.includes(forbidden), false, `${label} must not ${forbidden}`);
    }
  }
  const lost = loadProcessor({ claims: [claimRow(1)], fence: "not_claimed" });
  const lostResult = await lost.process();
  assert.equal(lostResult.diagnostics.failed, 1, "a lost lease is a retryable failure, not a success");
  for (const forbidden of ["r2-delete", "set_r2_confirmed_absent", "finalize_storage_deletion"]) {
    assert.equal(lost.calls.includes(forbidden), false, `a lost lease must not ${forbidden}`);
  }
});
