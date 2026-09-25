// slmm-test-safety.mjs
// ---------------------------------------------------------------------------
// Safe-by-design cleanup guard for SLMM E2E test harnesses.
//
// Design rules enforced here:
//  A. Every row eligible for cleanup must have been minted DURING the current
//     test run by recording the exact UUID returned by that run's own INSERT.
//  B. Cleanup operates ONLY on an explicit allowlist (created-{kind} sets).
//     Discovery/lookup of rows (e.g. "select where user_id = X") is NEVER a
//     valid source of cleanup targets: proposeExternal() always refuses.
//  C. Fail-closed. If ANY proposed target fails a guard, the ENTIRE cleanup
//     refuses and nothing is deleted. There is no "skip the bad one" path.
//  D. Deletion is primary-key scoped (deleter receives {kind,id}); the guard
//     never allows ownership-scoped statements like `DELETE ... user_id=eq.X`.
//  E. Dry-run / preview is available without deleting anything.
//  F. A dedicated environment guard (SLMM_TEST_MODE !== "true") is mandatory
//     in addition to the allowlist and scratch-marker checks.
//  G/H. Baseline ids captured before the run can never be cleaned.
//  K. Audit output logs ids and guard decisions only - NEVER secrets.
//
// HARD SAFETY GUARD (added for the real-data deletion incident):
//  * recordUser() FAILS CLOSED at registration: a user may only enter the
//    scratch registry if the exact test-only scratch email marker is supplied
//    AND the id is not a known production account. There is NO silent fallback
//    to any other id/email when the marker is missing.
//  * Threads and messages must be tied to a scratch user owner recorded THIS
//    run; ownerless or foreign-owned rows are refused at registration or, if
//    recorded leniently, refused at evaluation -> the WHOLE cleanup refuses.
//  * cleanup() re-verifies every row immediately before its DELETE; any
//    re-verification failure aborts the ENTIRE cleanup with ZERO deletes.
//  * Every original guard check also runs again in cleanup()'s execution loop
//    (defense in depth), so a previously-approved row can never be deleted
//    just because it passed once.
//
// This module is pure: it performs no network I/O. A live run must inject a
// `deleter` callback; mock tests inject a fake one.
// ---------------------------------------------------------------------------

export const DEFAULT_SCRATCH_EMAIL_RE = /^e2e-[a-zA-Z0-9._-]+@slmm\.test$/;

const KIND_LABEL = {
  users: "scratch user",
  profiles: "scratch profile",
  roles: "scratch role",
  threads: "scratch support thread",
  messages: "scratch support message",
};

const DEFAULT_DELETE_ORDER = ["roles", "profiles", "threads", "messages", "users"];

export function createCleanupGuard(options = {}) {
  const {
    testRunId = "unknown-run",
    modeEnv = process.env.SLMM_TEST_MODE,
    scratchEmailPattern = DEFAULT_SCRATCH_EMAIL_RE,
    baselineThreadIds = new Set(),
    knownProductionUserIds = new Set(),
    deleter = null,
    logger = console,
    deleteOrder = DEFAULT_DELETE_ORDER,
  } = options;

  const created = {
    users: new Set(),    // auth user UUIDs created THIS run
    profiles: new Set(), // profile UUIDs created THIS run
    roles: new Set(),    // role UUIDs created THIS run
    threads: new Set(),  // support_thread UUIDs created THIS run
    messages: new Set(), // support_message UUIDs created THIS run
  };
  const userEmail = new Map();      // userId -> email recorded at creation
  const userMarkerOk = new Map();   // userId -> matches scratch email pattern
  const threadOwner = new Map();    // threadId -> ownerUserId
  const messageOwner = new Map();   // messageId -> ownerUserId (scratch thread owner)
  const baselineThreads = new Set(baselineThreadIds);
  const externalProposals = [];     // rows offered from lookups/filters; never deletable

  const isTestModeActive = () => modeEnv === "true";

  // --- recording (the ONLY source of cleanup targets) ----------------------
  // FAIL-CLOSED at registration: a user may only be recorded as a scratch
  // target if its exact test-email marker is supplied and it is not a known
  // production account. No marker, no registration, no silent fallback.
  function recordUser(id, email) {
    if (!id) return false;
    if (knownProductionUserIds.has(id)) {
      throw new Error(`refusing to register known production user ${id} as a scratch cleanup target`);
    }
    if (typeof email !== "string" || !scratchEmailPattern.test(email)) {
      throw new Error(`refusing to register user ${id}: email must match the test-only scratch marker convention (got ${String(email)})`);
    }
    created.users.add(id);
    userEmail.set(id, email);
    userMarkerOk.set(id, true);
    return true;
  }
  function recordProfile(id) { if (!id) return false; created.profiles.add(id); return true; }
  function recordRole(id) { if (!id) return false; created.roles.add(id); return true; }
  // A thread may only be attributed to a scratch user created THIS run. An
  // explicit owner is mandatory for live runs; ownerless threads are recorded
  // leniently but ALWAYS refused at evaluation (fail-closed).
  function recordThread(id, ownerUserId) {
    if (!id) return false;
    if (ownerUserId !== undefined) {
      if (!created.users.has(ownerUserId)) {
        throw new Error(`refusing to register thread ${id}: owner ${ownerUserId} is not a scratch user created by this run`);
      }
      threadOwner.set(id, ownerUserId);
    }
    created.threads.add(id);
    return true;
  }
  // Messages must be tied to the scratch owner of the thread they belong to.
  // Same rule: explicit owner for live runs, ownerless refused at evaluation.
  function recordMessage(id, ownerUserId = undefined) {
    if (!id) return false;
    if (ownerUserId !== undefined) {
      if (!created.users.has(ownerUserId)) {
        throw new Error(`refusing to register message ${id}: owner ${ownerUserId} is not a scratch user created by this run`);
      }
      messageOwner.set(id, ownerUserId);
    }
    created.messages.add(id);
    return true;
  }

  // --- evaluation -----------------------------------------------------------
  function evaluateRow(kind, id, opts = {}) {
    const reasons = [];
    const { external = false } = opts;
    if (!isTestModeActive()) {
      reasons.push("SLMM_TEST_MODE must equal 'true' for any cleanup");
    }
    if (external) {
      reasons.push(`target ${KIND_LABEL[kind]} was NOT created by this test run (not in created allowlist)`);
    } else if (!created[kind].has(id)) {
      reasons.push(`target ${KIND_LABEL[kind]} id is not in this run's created allowlist (testRunId=${testRunId})`);
    }
    if (knownProductionUserIds.has(id)) {
      reasons.push("target id is a known real production account");
    }
    if (kind === "users" && created.users.has(id)) {
      // Positive requirement: the scratch marker must be VERIFIED, not merely
      // "not wrong". A user recorded without a marker is never eligible.
      if (userMarkerOk.get(id) !== true) {
        reasons.push("no verified test-only scratch marker recorded for this user");
      }
    }
    if (kind === "threads") {
      if (baselineThreads.has(id)) reasons.push("thread id existed before this test run (baseline)");
      const owner = threadOwner.get(id);
      if (!owner) {
        reasons.push("thread has no scratch owner recorded - cannot prove it was created by this run");
      } else if (!created.users.has(owner)) {
        reasons.push("thread owner is not a scratch user created by this run");
      }
    }
    if (kind === "messages") {
      const owner = messageOwner.get(id);
      if (!owner) {
        reasons.push("message has no scratch owner recorded - cannot prove it belongs to a scratch thread of this run");
      } else if (!created.users.has(owner)) {
        reasons.push("message owner is not a scratch user created by this run");
      }
    }
    return { kind, id, allowed: reasons.length === 0, reasons };
  }

  // Rows discovered from queries/filters are always refused. This is the
  // fail-closed path for ANY id that did not come from an INSERT return.
  function proposeExternal(kind, id, note = "") {
    const r = evaluateRow(kind, id, { external: true });
    externalProposals.push({ kind, id, note: note || "not created by this run (lookup)" });
    return r;
  }

  // --- plan / audit ---------------------------------------------------------
  function plan() {
    const rows = [];
    for (const kind of Object.keys(created)) {
      for (const id of created[kind]) rows.push({ kind, id });
    }
    for (const p of externalProposals) rows.push({ kind: p.kind, id: p.id });
    rows.sort((a, b) => {
      const d = deleteOrder.indexOf(a.kind) - deleteOrder.indexOf(b.kind);
      return d !== 0 ? d : String(a.id).localeCompare(String(b.id));
    });
    return rows;
  }

  function evaluateAll() {
    const rows = plan().map((row) => evaluateRow(row.kind, row.id));
    const rejected = rows.filter((r) => !r.allowed);
    const approved = rows.filter((r) => r.allowed);
    // Fail-closed: any rejection (or an empty allowlist) vetoes the entire run.
    const finalDecision = rows.length === 0 || rejected.length > 0 ? "REFUSE" : "ALLOW";
    return {
      testRunId,
      modeOn: isTestModeActive(),
      decision: finalDecision,
      rows,
      approved,
      rejected,
      counts: {
        users: created.users.size,
        profiles: created.profiles.size,
        roles: created.roles.size,
        threads: created.threads.size,
        messages: created.messages.size,
      },
    };
  }

  // --- dry run (E) ----------------------------------------------------------
  function printDryRun(e) {
    const lines = [
      "TEST CLEANUP DRY RUN",
      "--------------------",
      `testRunId: ${e.testRunId}`,
      `SLMM_TEST_MODE: ${e.modeOn ? "on" : "OFF (cleanup impossible)"}`,
      `Scratch users created:    ${e.counts.users}`,
      `Scratch profiles created: ${e.counts.profiles}`,
      `Scratch roles created:    ${e.counts.roles}`,
      `Scratch threads created:  ${e.counts.threads}`,
      `Scratch messages created: ${e.counts.messages}`,
      "Rows eligible for cleanup:",
    ];
    if (e.rows.length === 0) {
      lines.push("  (none - nothing recorded by this run, cleanup REFUSED)");
    }
    for (const row of e.rows) {
      const tag = row.allowed ? "ELIGIBLE" : "REJECTED";
      const why = row.reasons.length ? `  ${row.reasons.join("; ")}` : "";
      lines.push(`  [${tag}] ${row.kind} ${row.id}${why}`);
    }
    lines.push(`Cleanup allowed: ${e.decision}`);
    for (const l of lines) logger.log(l);
    return e;
  }

  function dryRun() {
    const e = evaluateAll();
    printDryRun(e);
    return e;
  }

  function audit() {
    return evaluateAll();
  }

  // --- guarded execution (only allowlisted PK-scoped deletes) ---------------
  async function cleanup() {
    const e = evaluateAll();
    logger.log(`[CLEANUP ${e.decision}] testRunId=${e.testRunId} rows=${e.rows.length} approved=${e.approved.length} rejected=${e.rejected.length}`);

    if (e.decision !== "ALLOW") {
      for (const r of e.rejected) {
        logger.error(`REFUSING CLEANUP ${r.kind} ${r.id}: ${r.reasons.join("; ")}`);
      }
      logger.error(`REFUSING CLEANUP (${e.decision}) - aborting ENTIRE cleanup; nothing will be deleted.`);
      return { decision: e.decision, executed: 0, aborted: true, rows: e.rows };
    }
    if (typeof deleter !== "function") {
      logger.error("REFUSING CLEANUP - no deleter provided; nothing deleted.");
      return { decision: "REFUSE", executed: 0, aborted: true, rows: e.rows };
    }
    let executed = 0;
    let aborted = false;
    for (const row of e.approved) {
      // Re-verify the row IMMEDIATELY before deleting it. Any re-verification
      // failure aborts the ENTIRE cleanup (fail-closed, zero further deletes),
      // so nothing is ever deleted on a stale/once-approved decision.
      const recheck = evaluateRow(row.kind, row.id);
      if (!recheck.allowed) {
        aborted = true;
        logger.error(`ABORTING CLEANUP - ${row.kind} ${row.id} failed immediate pre-delete verification: ${recheck.reasons.join("; ")}`);
        break;
      }
      // deleter receives ONLY {kind,id}; it must issue a primary-key DELETE.
      const res = await deleter(row);
      const ok = res && (res.status === 200 || res.status === 204 || res.ok === true);
      if (!ok) {
        aborted = true;
        logger.error(`ABORTING CLEANUP - unexpected delete response for ${row.kind} ${row.id}: ${res && res.status}`);
        break;
      }
      created[row.kind].delete(row.id);
      executed += 1;
    }
    logger.log(`[CLEANUP DONE] testRunId=${testRunId} executed=${executed} aborted=${aborted}`);
    return { decision: e.decision, executed, aborted, rows: e.rows };
  }

  return {
    testRunId,
    recordUser, recordProfile, recordRole, recordThread, recordMessage,
    getMessageOwner: (id) => messageOwner.get(id),
    getThreadOwner: (id) => threadOwner.get(id),
    proposeExternal,
    evaluateRow: (kind, id, opts) => evaluateRow(kind, id, opts),
    plan,
    evaluateAll,
    dryRun,
    audit,
    cleanup,
  };
}