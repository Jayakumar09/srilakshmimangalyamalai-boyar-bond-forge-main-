// slmm-safety-tests.mjs
// Local mock safety tests for the cleanup guard. NO network, NO database.
// Run: node slmm-safety-tests.mjs
// ---------------------------------------------------------------------------
import { createCleanupGuard } from "./slmm-test-safety.mjs";

const PROD_UUID = "4409e9c8-b57c-4e92-9333-983bdc2cb6fc"; // real client (jayakumar)
const SCRATCH_EMAIL = "e2e-comm-client-1790000000000@slmm.test";
const SCRATCH_OWNER = "scratch-owner-uuid-0001";

// Quiet logger: captures strings instead of printing (keeps the results table clean).
const quiet = {
  log: () => {},
  error: () => {},
};

function mkGuard(overrides = {}) {
  const calls = [];
  const guard = createCleanupGuard({
    testRunId: "mock-run",
    modeEnv: "true",
    scratchEmailPattern: /^e2e-[a-zA-Z0-9._-]+@slmm\.test$/,
    baselineThreadIds: new Set(["baseline-thread-pre"]),
    knownProductionUserIds: new Set([PROD_UUID]),
    deleter: async (row) => { calls.push(row); return { status: 204 }; },
    logger: quiet,
    ...overrides,
  });
  return { guard, calls };
}

const results = [];
function check(caseNo, label, got, expected, extra = "") {
  const pass = got === expected || (expected === "REFUSE" && got === "REFUSE") || (expected === "ALLOW" && got === "ALLOW");
  results.push({ caseNo, pass, label });
  console.log(`${pass ? "PASS" : "FAIL"}  CASE ${caseNo} ${label} :: got=${JSON.stringify(got)} expected=${JSON.stringify(expected)} ${extra}`);
}

// ---- CASE 1: scratch user + scratch thread created this run -> ALLOW -------
{
  const { guard, calls } = mkGuard();
  guard.recordUser(SCRATCH_OWNER, SCRATCH_EMAIL);
  guard.recordProfile(SCRATCH_OWNER);
  guard.recordThread("thread-scratch-1", SCRATCH_OWNER);
  guard.recordMessage("msg-scratch-1");
  const e = guard.evaluateAll();
  check(1, "scratch-created target -> cleanup allowed", e.decision, "ALLOW");
  const out = await awaitGuardCleanup(guard, calls);
  check(1, "only allowlisted PKs deleted", out.executed, 4);
  const bad = calls.some((c) => !["profiles", "threads", "messages", "users"].includes(c.kind));
  check(1, "deleter received only {kind,id} rows", bad, false);
}

// ---- CASE 2: real/pre-existing user ID -> REFUSED --------------------------
{
  const { guard, calls } = mkGuard();
  guard.recordUser(SCRATCH_OWNER, SCRATCH_EMAIL);
  guard.proposeExternal("users", PROD_UUID);
  const e = guard.evaluateAll();
  check(2, "pre-existing real user id -> cleanup refused", e.decision, "REFUSE");
  check(2, "zero deletes executed", (await guard.cleanup()).executed, 0, `calls=${calls.length}`);
}

// ---- CASE 3: existing support_thread not created by current run -> REFUSED -
{
  const { guard, calls } = mkGuard();
  guard.recordUser(SCRATCH_OWNER, SCRATCH_EMAIL);
  guard.proposeExternal("threads", "thread-from-lookup");
  const e = guard.evaluateAll();
  check(3, "pre-existing thread id -> refused", e.decision, "REFUSE");
  check(3, "zero deletes executed", (await guard.cleanup()).executed, 0, `calls=${calls.length}`);
}

// ---- CASE 4: scratch email, but thread NOT created by this run -> REFUSED --
{
  const { guard, calls } = mkGuard();
  guard.recordUser(SCRATCH_OWNER, SCRATCH_EMAIL);
  guard.proposeExternal("threads", "thread-other-run");
  const e = guard.evaluateAll();
  check(4, "scratch owner but foreign thread -> refused", e.decision, "REFUSE");
  check(4, "zero deletes executed", (await guard.cleanup()).executed, 0, `calls=${calls.length}`);
}

// ---- CASE 5: missing SLMM_TEST_MODE -> REFUSED -----------------------------
{
  const { guard, calls } = mkGuard({ modeEnv: undefined });
  guard.recordUser(SCRATCH_OWNER, SCRATCH_EMAIL);
  guard.recordThread("thread-scratch-1", SCRATCH_OWNER);
  const e = guard.evaluateAll();
  check(5, "missing test mode -> refused", e.decision, "REFUSE");
  check(5, "zero deletes executed", (await guard.cleanup()).executed, 0, `calls=${calls.length}`);
}

// ---- CASE 6: mixed list (one allowed + one unknown) -> ENTIRE op REFUSED ----
{
  const { guard, calls } = mkGuard();
  guard.recordUser(SCRATCH_OWNER, SCRATCH_EMAIL);
  guard.recordThread("thread-scratch-1", SCRATCH_OWNER);
  guard.proposeExternal("threads", "unknown-thread-x");
  const e = guard.evaluateAll();
  check(6, "mixed allowlist -> entire operation refused", e.decision, "REFUSE");
  check(6, "nothing partially deleted", (await guard.cleanup()).executed, 0, `calls=${calls.length}`);
}

// ---- CASE 7: hard-coded production UUID passed to cleanup -> REFUSED -------
{
  const { guard, calls } = mkGuard();
  // simulate a naive harness that records the live prod uuid directly
  guard.recordUser(PROD_UUID, "jayakumarv2025@gmail.com");
  const e = guard.evaluateAll();
  check(7, "hard-coded production UUID -> refused", e.decision, "REFUSE");
  check(7, "zero deletes executed", (await guard.cleanup()).executed, 0, `calls=${calls.length}`);
}

// ---- CASE 8: no recorded created IDs -> REFUSED ----------------------------
{
  const { guard, calls } = mkGuard();
  const e = guard.evaluateAll();
  check(8, "empty allowlist -> refused", e.decision, "REFUSE");
  check(8, "zero deletes executed", (await guard.cleanup()).executed, 0, `calls=${calls.length}`);
}

// ---- REGRESSION: old incident pattern (DELETE by user_id) would be REFUSED -
{
  const { guard, calls } = mkGuard();
  // the previous buggy cleanup proposed `DELETE support_threads WHERE user_id=prodUuid`
  guard.proposeExternal("threads", "deleted-by-ownership-lookalike");
  guard.proposeExternal("users", PROD_UUID);
  const e = guard.evaluateAll();
  check(9, "old user_id-scoped pattern -> refused", e.decision, "REFUSE");
  check(9, "zero deletes executed", (await guard.cleanup()).executed, 0, `calls=${calls.length}`);
}

async function awaitGuardCleanup(guard, calls) {
  const out = await guard.cleanup();
  return { ...out, calls };
}

const failed = results.filter((x) => !x.pass);
console.log("----------------------------------------");
console.log(`SAFETY TESTS: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);