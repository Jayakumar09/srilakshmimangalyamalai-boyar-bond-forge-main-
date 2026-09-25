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
// Fail-closed registration must THROW, not silently record. Returns true only
// when the call threw with the expected message fragment.
function mustThrow(fn, needle) {
  try {
    fn();
    return `NO THROW (expected message containing ${JSON.stringify(needle)})`;
  } catch (e) {
    return typeof e.message === "string" && e.message.includes(needle) ? true : `WRONG ERROR: ${e.message}`;
  }
}

// ---- CASE 1: scratch user + scratch thread created this run -> ALLOW -------
// (proves requirement 10: normal cleanup still works for an explicitly
//  registered scratch account whose thread/message owners are recorded)
{
  const { guard, calls } = mkGuard();
  guard.recordUser(SCRATCH_OWNER, SCRATCH_EMAIL);
  guard.recordProfile(SCRATCH_OWNER);
  guard.recordThread("thread-scratch-1", SCRATCH_OWNER);
  guard.recordMessage("msg-scratch-1", SCRATCH_OWNER);
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

// ---- CASE 7: hard-coded production UUID supplied -> REFUSED at registration -
{
  const { guard, calls } = mkGuard();
  // A known production UUID can never be registered as a scratch cleanup
  // target, even with a plausible email: registration throws (fail-closed).
  const threw = mustThrow(() => guard.recordUser(PROD_UUID, "jayakumarv2025@gmail.com"), "refusing to register");
  check(7, "hard-coded production UUID -> registration refused", threw, true);
  check(7, "production user never entered the allowlist", guard.plan().filter((r) => r.kind === "users").length, 0);
  // Also: a real user id offered as an EXTERNAL cleanup target vetoes the run.
  const g2 = mkGuard();
  g2.guard.recordUser(SCRATCH_OWNER, SCRATCH_EMAIL);
  g2.guard.proposeExternal("users", PROD_UUID);
  const e2 = g2.guard.evaluateAll();
  check(7, "real user id offered as cleanup target -> cleanup refused", e2.decision, "REFUSE");
  check(7, "zero deletes executed", (await g2.guard.cleanup()).executed, 0, `calls=${g2.calls.length}`);
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

// ---- CASE 10: missing / non-scratch scratch marker -> REFUSED --------------
{
  const { guard, calls } = mkGuard();
  const missing = mustThrow(() => guard.recordUser("some-uuid", undefined), "scratch marker");
  check(10, "missing email marker -> registration refused", missing, true);
  const live = mustThrow(() => guard.recordUser("some-uuid-2", "jayakumarv2025@gmail.com"), "scratch marker");
  check(10, "real/live email supplied as the marker -> registration refused", live, true);
  check(10, "zero deletes possible (no targets registered)", (await guard.cleanup()).executed, 0, `calls=${calls.length}`);
}

// ---- CASE 11: unknown user UUID -> REFUSED ---------------------------------
{
  const { guard, calls } = mkGuard();
  guard.recordUser(SCRATCH_OWNER, SCRATCH_EMAIL);
  guard.proposeExternal("users", "c0ffee00-0000-4000-8000-0000000000aa");
  const e = guard.evaluateAll();
  check(11, "unknown user uuid -> cleanup refused", e.decision, "REFUSE");
  check(11, "zero deletes executed", (await guard.cleanup()).executed, 0, `calls=${calls.length}`);
}

// ---- CASE 12: no silent fallback to another user id when marker is missing -
{
  const { guard, calls } = mkGuard();
  // Old buggy harness: when a state file lacked the scratch email it silently
  // substituted a DEFAULT scratch identity. That fallback would have allowed a
  // live account to be deleted. It is now impossible: registration throws, so
  // cleanup can never infer/substitute another user id.
  const threw = mustThrow(() => guard.recordUser("real-but-unlisted-uuid", undefined), "scratch marker");
  check(12, "missing marker cannot be silently replaced (no fallback)", threw, true);
  check(12, "no user registered -> zero deletes", (await guard.cleanup()).executed, 0, `calls=${calls.length}`);
}

// ---- CASE 13: support_threads cleanup cannot target a non-scratch user -----
{
  const { guard } = mkGuard();
  guard.recordUser(SCRATCH_OWNER, SCRATCH_EMAIL);
  const threw = mustThrow(() => guard.recordThread("thread-prod-owned", PROD_UUID), "not a scratch user");
  check(13, "recordThread with a live-user owner -> registration refused", threw, true);
  check(13, "foreign thread never entered the allowlist", guard.plan().filter((r) => r.kind === "threads").length, 0);
}
{
  const { guard, calls } = mkGuard();
  guard.recordUser(SCRATCH_OWNER, SCRATCH_EMAIL);
  guard.recordThread("thread-ownerless-1", undefined); // lenient record (state-preview path)
  const e = guard.evaluateAll();
  check(13, "ownerless thread -> cleanup refused at evaluation", e.decision, "REFUSE");
  check(13, "zero deletes executed", (await guard.cleanup()).executed, 0, `calls=${calls.length}`);
}

// ---- CASE 14: support_messages cleanup cannot target a non-scratch user ----
{
  const { guard } = mkGuard();
  guard.recordUser(SCRATCH_OWNER, SCRATCH_EMAIL);
  const threw = mustThrow(() => guard.recordMessage("msg-prod-owned", PROD_UUID), "not a scratch user");
  check(14, "recordMessage with a live-user owner -> registration refused", threw, true);
  check(14, "foreign message never entered the allowlist", guard.plan().filter((r) => r.kind === "messages").length, 0);
}
{
  const { guard, calls } = mkGuard();
  guard.recordUser(SCRATCH_OWNER, SCRATCH_EMAIL);
  guard.recordMessage("message-ownerless-1", undefined); // lenient record (state-preview path)
  const e = guard.evaluateAll();
  check(14, "ownerless message -> cleanup refused at evaluation", e.decision, "REFUSE");
  check(14, "zero deletes executed", (await guard.cleanup()).executed, 0, `calls=${calls.length}`);
}

// ---- CASE 15: a failed safety check produces ZERO DELETE operations --------
{
  const { guard, calls } = mkGuard();
  guard.recordUser(SCRATCH_OWNER, SCRATCH_EMAIL);
  guard.proposeExternal("messages", "msg-from-live-thread");
  const out = await guard.cleanup();
  check(15, "refused cleanup executes zero deletes", out.executed, 0);
  check(15, "deleter invoked zero times for refused run", calls.length, 0);
}
{
  const { guard, calls } = mkGuard();
  const out = await guard.cleanup(); // empty registry -> REFUSE
  check(15, "empty-registry cleanup executes zero deletes", out.executed, 0);
  check(15, "deleter invoked zero times for empty registry", calls.length, 0);
}

// ---- CASE 16: any suspect row introduced late vetoes the WHOLE run ----------
{
  // A clean scratch set is ALLOWed, but the moment ANY unverified target is
  // introduced (here: a message that cannot be tied to a scratch owner) the
  // entire operation refuses before a single DELETE executes.
  const { guard, calls } = mkGuard();
  guard.recordUser(SCRATCH_OWNER, SCRATCH_EMAIL);
  guard.recordProfile(SCRATCH_OWNER);
  guard.recordThread("thread-scratch-2", SCRATCH_OWNER);
  guard.recordMessage("msg-scratch-2", SCRATCH_OWNER);
  check(16, "clean scratch set -> cleanup allowed", guard.evaluateAll().decision, "ALLOW");
  guard.proposeExternal("messages", "unverifiable-live-message-id");
  const e = guard.evaluateAll();
  check(16, "one suspect message later -> entire cleanup refused", e.decision, "REFUSE");
  check(16, "zero deletes executed", (await guard.cleanup()).executed, 0, `calls=${calls.length}`);
  check(16, "deleter invoked zero times", calls.length, 0);
}

async function awaitGuardCleanup(guard, calls) {
  const out = await guard.cleanup();
  return { ...out, calls };
}

const failed = results.filter((x) => !x.pass);
console.log("----------------------------------------");
console.log(`SAFETY TESTS: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);