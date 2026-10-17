// Real deletion lifecycle handler, with offline database, signing, R2 and
// service-role RPC boundaries. The durable state machine (claims, CAS,
// finalization) is a test double: SQL and RLS execution are NOT simulated or
// verified here, and neither is concurrent reference insertion.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";

const read = (file) => readFileSync(new URL(`../src/lib/${file}.ts`, import.meta.url), "utf8");
function load(source, globals = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, ...globals });
  return exports;
}
const { isCanonicalStorageKey } = load(read("storage-key"));
const source = read("storage.functions");
const start = source.indexOf("const zStorageKey = z");
const end = source.indexOf("/** Returns a short-lived view URL.", start);
assert.ok(start >= 0 && end > start);
const owner = "mock-owner";
const key = `${owner}/govt_id/example.pdf`;
const REQUEST_ID = "11111111-1111-1111-1111-111111111111";

const state = (has_document_references, may_delete_document_references = true, has_protected_references = false) => ({
  data: [{ has_document_references, may_delete_document_references, has_protected_references }], error: null,
});
const absent = () => state(false);

function setup(options = {}) {
  const storageKey = options.key ?? key;
  const calls = [];
  let checks = 0;
  const claimOwner = options.ownerId ?? owner;
  const capturedIds = options.rowIds ?? [];
  const issuedRequestId = options.requestId ?? REQUEST_ID;
  const defaultClaim = {
    id: issuedRequestId,
    storage_key: storageKey,
    owner_id: claimOwner,
    lease_token: "lease-1",
    status: "deleting",
    r2_state: "not_attempted",
    finalize_state: "pending",
    document_row_ids: capturedIds,
    attempt_count: 1,
  };
  // Outstanding quota-resync records the worker can recover. A successful
  // `mark_...` removes the record, so a later pass that re-lists sees it as
  // already stamped (this mirrors the quota_resynced_at IS NULL filter).
  const pendingResyncs = (options.resyncRecords ?? []).map((r) => ({ ...r }));
  let resyncFailRemaining = options.resyncFailCount ?? 0;

  const context = {
    userId: options.userId ?? owner,
    supabase: {
      async rpc(name, args) {
        if (name === "has_role") {
          calls.push("authorize");
          assert.equal(args._user_id, context.userId);
          assert.equal(args._role, "admin");
          return options.roleResult ?? { data: true, error: null };
        }
        if (name === "get_storage_reference_state") {
          assert.deepEqual(Object.keys(args), ["p_storage_key"]);
          assert.equal(args.p_storage_key, storageKey);
          calls.push("reference-check");
          const result = options.states
            ? options.states[checks++]
            : checks++ === 0 ? state(capturedIds.length > 0) : absent();
          if (result instanceof Error) throw result;
          return result;
        }
        if (name === "request_storage_deletion") {
          assert.deepEqual(Object.keys(args), ["p_storage_key"]);
          assert.equal(args.p_storage_key, storageKey);
          calls.push("request-deletion");
          if (options.requestError) return { data: null, error: options.requestError };
          return { data: issuedRequestId, error: null };
        }
        throw new Error(`unexpected rpc: ${name}`);
      },
    },
  };

  const serviceRpc = async (name, args) => {
    if (name === "claim_storage_deletion_request") {
      assert.deepEqual(Object.keys(args), ["p_request_id"]);
      assert.equal(args.p_request_id, issuedRequestId, "claim must use the server-issued request id");
      calls.push("claim");
      if (options.claimError) return { data: null, error: options.claimError };
      if (options.claimEmpty) return { data: [], error: null };
      return { data: [options.claim ?? defaultClaim], error: null };
    }
    if (name === "claim_storage_deletion_requests") {
      calls.push("claim-batch");
      if (options.claimError) return { data: null, error: options.claimError };
      return { data: options.claims ?? [options.claim ?? defaultClaim], error: null };
    }
    if (name === "fence_storage_key_for_deletion") {
      assert.deepEqual(Object.keys(args), ["p_request_id", "p_lease_token"]);
      assert.equal(args.p_request_id, issuedRequestId, "fence must use the server-issued request id");
      assert.equal(typeof args.p_lease_token, "string");
      calls.push("fence");
      if (options.fenceError) return { data: null, error: options.fenceError };
      return { data: options.fence ?? "fenced", error: null };
    }
    if (name === "block_storage_deletion") {
      calls.push("block");
      return { data: options.blockResult ?? true, error: null };
    }
    if (name === "record_storage_deletion_failure") {
      calls.push("failure");
      return { data: options.failureResult ?? "pending", error: null };
    }
    if (name === "set_r2_confirmed_absent") {
      calls.push("confirm");
      return { data: options.confirmResult ?? true, error: null };
    }
    if (name === "finalize_storage_deletion") {
      calls.push("finalize");
      if (options.finalizeError) return { data: null, error: options.finalizeError };
      return { data: options.finalizeResult ?? true, error: null };
    }
    if (name === "mark_storage_deletion_quota_resynced") {
      calls.push("quota-mark");
      if (options.markError) return { data: null, error: options.markError };
      const index = pendingResyncs.findIndex((record) => record.id === args.p_request_id);
      if (index >= 0) pendingResyncs.splice(index, 1);
      return { data: undefined, error: null };
    }
    if (name === "list_storage_deletion_quota_resyncs") {
      assert.deepEqual(Object.keys(args), ["p_limit"]);
      calls.push("quota-resync-list");
      if (options.resyncListError) return { data: null, error: options.resyncListError };
      if ("resyncListData" in options) return { data: options.resyncListData, error: null };
      return { data: pendingResyncs, error: null };
    }
    throw new Error(`unexpected service rpc: ${name}`);
  };

  const requireSupabaseAuth = Symbol("authentication");
  const mod = load(source.slice(start, end), {
    z, isCanonicalStorageKey, requireSupabaseAuth,
    storageDeletionServiceRpc: serviceRpc,
    createServerFn({ method }) {
      assert.equal(method, "POST");
      let validate;
      return {
        middleware(items) { assert.equal(items[0], requireSupabaseAuth); return this; },
        inputValidator(fn) { validate = fn; return this; },
        handler(fn) { return async (data) => fn({ data: validate(data), context }); },
      };
    },
    signR2: async (signedKey, method) => {
      calls.push("sign");
      assert.equal(signedKey, storageKey);
      assert.equal(method, "DELETE");
      if (options.signError) throw new Error("private signing details");
      return "https://mock.invalid/deletion";
    },
    fetch: async () => {
      calls.push("r2-delete");
      if (options.networkError) throw new Error("private network details");
      const status = options.status ?? 204;
      return { ok: status >= 200 && status < 300, status };
    },
    resyncProfileQuota: async (userId) => {
      assert.equal(userId, claimOwner);
      calls.push("quota-resync");
      if (options.resyncError) throw new Error("quota failed");
      if (resyncFailRemaining > 0) {
        resyncFailRemaining--;
        throw new Error("quota failed");
      }
    },
  });
  return {
    calls,
    run: (data = {}) => mod.deleteUpload({ key: storageKey, ...data }),
    process: (opts = {}) => mod.processStorageDeletionRequests(opts),
  };
}

// --- Findings 2-3 authorization / reference gates -------------------------

for (const rows of [[], ["doc-1"]]) {
  test(`hidden foreign document references block owner deletion (rows=${rows.length})`, async () => {
    const ctx = setup({ rowIds: rows, states: [state(true, false)] });
    await assert.rejects(ctx.run(), /Not allowed/);
    assert.deepEqual(ctx.calls, ["reference-check"]);
  });
}

for (const refs of [state(true), state(true, false)]) {
  for (const userId of [owner, "admin-user"]) {
    test(`cleanup skips referenced objects (${userId}, deletable=${refs.data[0].may_delete_document_references})`, async () => {
      const ctx = setup({ userId, states: [refs] });
      assert.equal((await ctx.run({ onlyIfUnreferenced: true })).skipped, true);
      assert.deepEqual(ctx.calls, userId === owner ? ["reference-check"] : ["authorize", "reference-check"]);
    });
  }
}

const uncertain = [
  { data: null, error: { code: "PGRST202", message: "RPC missing" } },
  { ...absent(), error: { message: "partial error" } },
  new Error("transport failed"), undefined, null,
  { data: null }, { data: [] }, { data: [null] }, { data: [[]] },
  { data: [absent().data[0], absent().data[0]] }, { data: {} },
  { data: [{}] }, { data: [{ ...absent().data[0], has_document_references: "false" }] },
  { data: [{ ...absent().data[0], may_delete_document_references: null }] },
  { data: [{ ...absent().data[0], has_protected_references: null }] },
  { data: [{ ...absent().data[0], has_protected_references: "false" }] },
  { data: [{ has_document_references: false, may_delete_document_references: true }] },
  { data: [{ has_references: false, may_delete_references: true }] },
  { data: null, error: { code: "42P01", message: "missing relation" } },
  state(false, false),
];
for (const [index, result] of uncertain.entries()) {
  test(`uncertain reference response ${index} fails closed before any request`, async () => {
    const ctx = setup({ states: [result] });
    await assert.rejects(ctx.run(), /Cannot verify storage references/);
    assert.deepEqual(ctx.calls, ["reference-check"]);
  });
}

for (const roleResult of [{ data: false }, { data: null }, { data: "true" }, { data: true, error: { message: "uncertain" } }]) {
  test(`uncertain/unauthorized admin result ${JSON.stringify(roleResult)} blocks all work`, async () => {
    const ctx = setup({ userId: "another-user", roleResult });
    await assert.rejects(ctx.run(), /Not allowed/);
    assert.deepEqual(ctx.calls, ["authorize"]);
  });
}

// Source labels describe mocked aggregate RPC responses, not executed SQL.
// The separate SQL contract suite pins each real table/column predicate.
const protectedSources = [
  ["payments.proof_key", "payment_proof"],
  ["jathagam_requests.report_key", "jathagam"],
  ["support_messages.attachment_key", "attachment"],
  ["profiles.photo_url", "photo"],
  ["payment_events.receipt_key", "receipts"],
];
for (const [sourceName, folder] of protectedSources) {
  test(`${sourceName}: hidden protected reference blocks deletion and cleanup for owner/admin`, async () => {
    for (const userId of [owner, "admin-user"]) {
      for (const rowIds of [[], ["doc-1"]]) {
        for (const onlyIfUnreferenced of [false, true]) {
          const ctx = setup({
            key: `${owner}/${folder}/existing-file.pdf`, userId, rowIds,
            states: [state(rowIds.length > 0, true, true)],
          });
          if (onlyIfUnreferenced) {
            assert.equal((await ctx.run({ onlyIfUnreferenced })).skipped, true);
          } else {
            await assert.rejects(ctx.run(), /File is still in use/);
          }
          assert.deepEqual(ctx.calls, userId === owner ? ["reference-check"] : ["authorize", "reference-check"]);
        }
      }
    }
  });
}

// --- Durable lifecycle ordering ------------------------------------------

test("explicit own-document deletion: intent, confirmed R2, then transactional finalize", async () => {
  const ctx = setup({ rowIds: ["doc-1"] });
  assert.equal((await ctx.run()).ok, true);
  assert.deepEqual(ctx.calls, [
    "reference-check", "request-deletion", "claim", "fence",
    "sign", "r2-delete", "confirm", "finalize", "quota-resync", "quota-mark",
  ]);
});

test("admin explicit deletion authorizes then follows the same lifecycle", async () => {
  const ctx = setup({ userId: "admin-user", rowIds: ["doc-1", "doc-2"] });
  assert.equal((await ctx.run()).ok, true);
  assert.deepEqual(ctx.calls, [
    "authorize", "reference-check", "request-deletion", "claim", "fence",
    "sign", "r2-delete", "confirm", "finalize", "quota-resync", "quota-mark",
  ]);
});

for (const onlyIfUnreferenced of [false, true]) {
  test(`true orphan can be deleted (cleanup=${onlyIfUnreferenced})`, async () => {
    const ctx = setup();
    assert.equal((await ctx.run({ onlyIfUnreferenced })).ok, true);
    assert.deepEqual(ctx.calls, [
      "reference-check", "request-deletion", "claim", "fence",
      "sign", "r2-delete", "confirm", "finalize", "quota-resync", "quota-mark",
    ]);
  });
}

test("protected reference appearing before dispatch blocks R2 and keeps metadata", async () => {
  const ctx = setup({
    rowIds: ["doc-1"],
    fence: "blocked_protected_reference",
  });
  await assert.rejects(ctx.run(), /File is still in use/);
  assert.deepEqual(ctx.calls, ["reference-check", "request-deletion", "claim", "fence", "block"]);
});

test("document id not captured at request time blocks deletion before R2", async () => {
  const ctx = setup({
    rowIds: ["doc-1"],
    fence: "blocked_document_set_changed",
  });
  await assert.rejects(ctx.run(), /File is still in use/);
  assert.deepEqual(ctx.calls, ["reference-check", "request-deletion", "claim", "fence", "block"]);
});

test("a clean fence where the captured document row was since removed proceeds", async () => {
  const ctx = setup({ rowIds: ["doc-1"], fence: "fenced" });
  assert.equal((await ctx.run()).ok, true);
  assert.deepEqual(ctx.calls, [
    "reference-check", "request-deletion", "claim", "fence",
    "sign", "r2-delete", "confirm", "finalize", "quota-resync", "quota-mark",
  ]);
});

// --- Finding 5: the durable fence gates the R2 DELETE ---------------------

test("fence is durably established before R2 and before finalization", async () => {
  const ctx = setup({ rowIds: ["doc-1"] });
  assert.equal((await ctx.run()).ok, true);
  const fenceAt = ctx.calls.indexOf("fence");
  const signAt = ctx.calls.indexOf("sign");
  const r2At = ctx.calls.indexOf("r2-delete");
  const finalizeAt = ctx.calls.indexOf("finalize");
  assert.ok(fenceAt >= 0 && fenceAt < signAt && fenceAt < r2At && fenceAt < finalizeAt,
    "the fence must be committed before the R2 DELETE and before finalization");
});

test("a fence that is no longer claimed stops before R2 and is retried, never blocked", async () => {
  const ctx = setup({ rowIds: ["doc-1"], fence: "not_claimed" });
  await assert.rejects(ctx.run(), /will be retried/);
  assert.equal(ctx.calls.includes("fence"), true);
  for (const forbidden of ["sign", "r2-delete", "confirm", "finalize", "block", "failure"]) {
    assert.equal(ctx.calls.includes(forbidden), false, `a not-claimed fence must not ${forbidden}`);
  }
});

test("an unexpected fence outcome fails closed before any R2 work", async () => {
  const ctx = setup({ rowIds: ["doc-1"], fence: "surprise" });
  await assert.rejects(ctx.run(), /Cannot verify storage references/);
  assert.deepEqual(ctx.calls, ["reference-check", "request-deletion", "claim", "fence", "block"]);
  assert.equal(ctx.calls.includes("r2-delete"), false);
});

test("a blocked fence is skipped (not failed) for cleanup-style deletion", async () => {
  const ctx = setup({ fence: "blocked_document_set_changed" });
  assert.equal((await ctx.run({ onlyIfUnreferenced: true })).skipped, true);
  assert.deepEqual(ctx.calls, ["reference-check", "request-deletion", "claim", "fence", "block"]);
  assert.equal(ctx.calls.includes("r2-delete"), false);
});

test("a confirmed-absent retry still establishes the fence before finalizing", async () => {
  const ctx = setup({
    claim: {
      id: REQUEST_ID, storage_key: key, owner_id: owner, lease_token: "lease-2",
      status: "finalizing", r2_state: "confirmed_absent", finalize_state: "pending",
      document_row_ids: ["doc-1"], attempt_count: 1,
    },
  });
  assert.equal((await ctx.process({ requestId: REQUEST_ID })).processed, 1);
  const fenceAt = ctx.calls.indexOf("fence");
  const finalizeAt = ctx.calls.indexOf("finalize");
  assert.ok(fenceAt >= 0 && fenceAt < finalizeAt, "the fence must precede finalization on a retry");
  assert.equal(ctx.calls.includes("r2-delete"), false);
});

// --- Failure and uncertainty (metadata must stay intact) -----------------

for (const status of [403, 500]) {
  test(`R2 HTTP ${status} leaves metadata intact and records a durable failure`, async () => {
    const ctx = setup({ rowIds: ["doc-1"], status });
    await assert.rejects(ctx.run(), { message: `Storage deletion failed (${status}).` });
    assert.deepEqual(ctx.calls, ["reference-check", "request-deletion", "claim", "fence", "sign", "r2-delete", "failure"]);
  });
}

for (const options of [{ networkError: true }, { signError: true }]) {
  test(`uncertain R2 outcome ${JSON.stringify(options)} never finalizes or reports success`, async () => {
    const ctx = setup({ rowIds: ["doc-1"], ...options });
    await assert.rejects(ctx.run(), { message: "Storage deletion failed." });
    assert.equal(ctx.calls.includes("finalize"), false);
    assert.equal(ctx.calls.at(-1), "failure");
  });
}

test("already-absent R2 object (404) is idempotent success", async () => {
  const ctx = setup({ status: 404 });
  assert.equal((await ctx.run()).ok, true);
  assert.deepEqual(ctx.calls, [
    "reference-check", "request-deletion", "claim", "fence",
    "sign", "r2-delete", "confirm", "finalize", "quota-resync", "quota-mark",
  ]);
});

test("missing request RPC fails closed before any R2 work", async () => {
  const ctx = setup({ rowIds: ["doc-1"], requestError: { code: "PGRST202", message: "missing" } });
  await assert.rejects(ctx.run(), /Cannot record storage deletion/);
  assert.deepEqual(ctx.calls, ["reference-check", "request-deletion"]);
});

test("missing claim RPC fails closed and never touches R2", async () => {
  const ctx = setup({ claimError: { code: "PGRST202", message: "missing" } });
  await assert.rejects(ctx.run(), /will be retried/);
  assert.deepEqual(ctx.calls, ["reference-check", "request-deletion", "claim"]);
});

test("malformed service reference re-check blocks before R2", async () => {
  const ctx = setup({ fenceError: { message: "missing" } });
  await assert.rejects(ctx.run(), /Cannot verify storage references/);
  assert.deepEqual(ctx.calls, ["reference-check", "request-deletion", "claim", "fence", "block"]);
});

// --- Lease/CAS and finalization recovery ---------------------------------

test("R2 confirmed but finalization fails: metadata intact and retry finalizes", async () => {
  const first = setup({ rowIds: ["doc-1"], finalizeResult: false });
  await assert.rejects(first.run(), /will be retried/);
  assert.deepEqual(first.calls, [
    "reference-check", "request-deletion", "claim", "fence",
    "sign", "r2-delete", "confirm", "finalize",
  ]);
  assert.equal(first.calls.includes("quota-resync"), false);

  // Retry pass: R2 is already confirmed, so only DB finalization runs.
  const retry = setup({
    claim: {
      id: REQUEST_ID, storage_key: key, owner_id: owner, lease_token: "lease-2",
      status: "finalizing", r2_state: "confirmed_absent", finalize_state: "pending",
      document_row_ids: ["doc-1"], attempt_count: 1,
    },
  });
  assert.equal((await retry.process({ requestId: REQUEST_ID })).processed, 1);
  assert.deepEqual(retry.calls, ["claim", "fence", "finalize", "quota-resync", "quota-mark", "quota-resync-list"]);
});

test("stale worker: CAS-rejected confirm stops before finalize", async () => {
  const ctx = setup({ rowIds: ["doc-1"], confirmResult: false });
  await assert.rejects(ctx.run(), /will be retried/);
  assert.deepEqual(ctx.calls, ["reference-check", "request-deletion", "claim", "fence", "sign", "r2-delete", "confirm"]);
  assert.equal(ctx.calls.includes("finalize"), false);
});

test("stale worker: CAS-rejected finalize never resyncs or reports success", async () => {
  const ctx = setup({ rowIds: ["doc-1"], finalizeResult: false });
  await assert.rejects(ctx.run(), /will be retried/);
  assert.equal(ctx.calls.includes("quota-resync"), false);
  assert.equal(ctx.calls.includes("quota-mark"), false);
});

test("batch worker claims queued requests and finalizes after R2 confirmation", async () => {
  const claim = {
    id: REQUEST_ID, storage_key: key, owner_id: owner, lease_token: "lease-b",
    status: "deleting", r2_state: "uncertain", finalize_state: "pending",
    document_row_ids: [], attempt_count: 2,
  };
  const ctx = setup({ claim, claims: [claim] });
  assert.equal((await ctx.process()).processed, 1);
  assert.deepEqual(ctx.calls, [
    "claim-batch", "fence", "sign", "r2-delete", "confirm", "finalize", "quota-resync", "quota-mark",
    "quota-resync-list",
  ]);
});

test("quota resync failure does not fail an otherwise-confirmed deletion", async () => {
  const ctx = setup({ rowIds: ["doc-1"], resyncError: true });
  assert.equal((await ctx.run()).ok, true);
  assert.deepEqual(ctx.calls, [
    "reference-check", "request-deletion", "claim", "fence",
    "sign", "r2-delete", "confirm", "finalize", "quota-resync",
  ]);
  assert.equal(ctx.calls.includes("quota-mark"), false);
});

test("repeat deletion reuses the server-issued request id (no client-side id)", async () => {
  const ctx = setup({ requestId: "server-issued-1" });
  await ctx.run();
  await ctx.run();
  assert.equal(ctx.calls.filter((c) => c === "request-deletion").length, 2);
  assert.equal(ctx.calls.filter((c) => c === "claim").length, 2);
});

// --- Item 3: one-hour backoff on blocked deletion requests -----------------
// The backoff itself lives in SQL (pinned by the SQL contract suite). These
// tests prove the processor behaves safely whether the claim path returns a
// blocked row (after backoff) or no row at all (during backoff). Real RLS,
// SQL execution and concurrency are NOT simulated here.

const blockedClaim = (overrides = {}) => ({
  id: REQUEST_ID, storage_key: key, owner_id: owner, lease_token: "lease-back",
  status: "deleting", r2_state: "uncertain", finalize_state: "pending",
  document_row_ids: [], attempt_count: 2, ...overrides,
});

test("immediate reclaim of a blocked request is rejected and performs no work", async () => {
  // The database refuses to claim a just-blocked row, so both claim paths
  // return nothing and the worker must not re-check, delete or finalize.
  const single = setup({ claimEmpty: true });
  await assert.rejects(single.run(), /will be retried/);
  assert.deepEqual(single.calls, ["reference-check", "request-deletion", "claim"]);
  for (const forbidden of ["fence", "sign", "r2-delete", "confirm", "finalize", "block"]) {
    assert.equal(single.calls.includes(forbidden), false, `throttled single reclaim must not ${forbidden}`);
  }

  const batch = setup({ claims: [] });
  const result = await batch.process();
  assert.equal(result.processed, 0);
  for (const forbidden of ["fence", "sign", "r2-delete", "confirm", "finalize", "block"]) {
    assert.equal(batch.calls.includes(forbidden), false, `throttled batch reclaim must not ${forbidden}`);
  }
});

test("blocked request is eligible after backoff and re-checks references before R2", async () => {
  const ctx = setup({ claims: [blockedClaim()] });
  assert.equal((await ctx.process()).processed, 1);
  assert.deepEqual(ctx.calls, [
    "claim-batch", "fence", "sign", "r2-delete", "confirm", "finalize", "quota-resync", "quota-mark",
    "quota-resync-list",
  ]);
});

test("post-backoff reclaim still blocks when the reference is protected", async () => {
  const ctx = setup({
    claims: [blockedClaim({ document_row_ids: ["doc-1"] })],
    fence: "blocked_protected_reference",
  });
  await ctx.process();
  assert.deepEqual(ctx.calls, ["claim-batch", "fence", "block", "quota-resync-list"]);
  assert.equal(ctx.calls.includes("r2-delete"), false);
});

test("post-backoff reclaim fails closed when the reference-check RPC is unavailable", async () => {
  const ctx = setup({ claims: [blockedClaim()], fenceError: { message: "missing" } });
  await ctx.process();
  assert.deepEqual(ctx.calls, ["claim-batch", "fence", "block", "quota-resync-list"]);
  assert.equal(ctx.calls.includes("r2-delete"), false);
});

test("non-blocked states keep their existing lease recovery behavior", async () => {
  // Pending/deleting rows proceed exactly as before (no client-side backoff).
  const deleting = setup({ claims: [blockedClaim({ status: "deleting", r2_state: "not_attempted", attempt_count: 1 })] });
  assert.equal((await deleting.process()).processed, 1);
  assert.deepEqual(deleting.calls, [
    "claim-batch", "fence", "sign", "r2-delete", "confirm", "finalize", "quota-resync", "quota-mark",
    "quota-resync-list",
  ]);

  // A confirmed_absent finalizing row still only finalizes: no R2 call at all.
  const finalizing = setup({
    claims: [blockedClaim({ status: "finalizing", r2_state: "confirmed_absent", document_row_ids: ["doc-1"] })],
  });
  assert.equal((await finalizing.process()).processed, 1);
  assert.deepEqual(finalizing.calls, ["claim-batch", "fence", "finalize", "quota-resync", "quota-mark", "quota-resync-list"]);
  assert.equal(finalizing.calls.includes("r2-delete"), false);
});

// --- Item 4: 15-minute cooldown after a failed deletion request ------------
// The cooldown itself is enforced in request_storage_deletion under a per-key
// advisory lock (pinned by the SQL contract suite). These tests prove the
// caller surfaces a refused request safely, still proceeds once the window has
// passed, and never conflates a cancelled request with a failed one. SQL, RLS
// execution and concurrency are NOT simulated here.

test("a request refused by the failed-request cooldown performs no claim or R2 work", async () => {
  const ctx = setup({
    rowIds: ["doc-1"],
    requestError: { code: "22023", message: "A recent deletion attempt for this file failed." },
  });
  await assert.rejects(ctx.run(), /Cannot record storage deletion/);
  assert.deepEqual(ctx.calls, ["reference-check", "request-deletion"]);
  for (const forbidden of ["claim", "fence", "sign", "r2-delete", "confirm", "finalize", "block", "failure", "quota-resync"]) {
    assert.equal(ctx.calls.includes(forbidden), false, `a cooled-down request must not ${forbidden}`);
  }
});

test("once the cooldown elapsed a fresh request is accepted and follows the lifecycle", async () => {
  // The server now issues a brand-new request id instead of cooling the caller
  // down, so the full confirmed-R2-before-metadata ordering runs again.
  const ctx = setup({ rowIds: ["doc-1"], requestId: "recreated-after-cooldown" });
  assert.equal((await ctx.run()).ok, true);
  assert.deepEqual(ctx.calls, [
    "reference-check", "request-deletion", "claim", "fence",
    "sign", "r2-delete", "confirm", "finalize", "quota-resync", "quota-mark",
  ]);
});

test("recreation after a cancellation is accepted (cancelled is not cooled down)", async () => {
  // A prior request that was cancelled must not block recreation the way a
  // failed one does: the server issues a fresh id and work proceeds normally.
  const ctx = setup({ requestId: "recreated-after-cancel" });
  assert.equal((await ctx.run()).ok, true);
  assert.equal(ctx.calls.includes("request-deletion"), true);
  assert.equal(ctx.calls.includes("claim"), true);
  for (const forbidden of ["block", "failure"]) {
    assert.equal(ctx.calls.includes(forbidden), false, `post-cancellation recreation must not ${forbidden}`);
  }
});

// --- Item 2: recovery of completed deletions missing their quota stamp ----
// These exercise the real processStorageDeletionRequests recovery pass against
// a mocked service-role boundary. SQL/RLS execution and concurrency are NOT
// simulated here; the separate SQL contract suite pins the listing definition.

const resyncRecord = (id) => ({ id, storage_key: key, owner_id: owner, finalized_at: "2026-01-01T00:00:00.000Z" });

test("completed deletion missing its quota stamp is recovered without touching R2 or metadata", async () => {
  const ctx = setup({ claims: [], resyncRecords: [resyncRecord("r-1")] });
  const result = await ctx.process();
  assert.equal(result.processed, 0);
  assert.equal(result.quotaResyncs, 1);
  assert.deepEqual(ctx.calls, ["claim-batch", "quota-resync-list", "quota-resync", "quota-mark"]);
  // Recovery must never re-run R2 deletion or document finalization.
  for (const forbidden of ["sign", "r2-delete", "confirm", "finalize", "fence", "failure", "block"]) {
    assert.equal(ctx.calls.includes(forbidden), false, `recovery must not ${forbidden}`);
  }
});

test("failed quota recovery leaves the record outstanding for a later pass", async () => {
  const ctx = setup({ claims: [], resyncRecords: [resyncRecord("r-2")], resyncFailCount: 1 });
  const first = await ctx.process();
  assert.equal(first.quotaResyncs, 0);
  assert.equal(ctx.calls.includes("quota-mark"), false, "a failed resync must not record completion");
  // The record is still unstamped, so the next pass retries and succeeds.
  const second = await ctx.process();
  assert.equal(second.quotaResyncs, 1);
  assert.deepEqual(ctx.calls, [
    "claim-batch", "quota-resync-list", "quota-resync",
    "claim-batch", "quota-resync-list", "quota-resync", "quota-mark",
  ]);
});

test("repeated recovery is idempotent: a stamped record is never resynced again", async () => {
  const ctx = setup({ claims: [], resyncRecords: [resyncRecord("r-3")] });
  await ctx.process();
  await ctx.process();
  assert.equal(ctx.calls.filter((c) => c === "quota-resync").length, 1);
  assert.equal(ctx.calls.filter((c) => c === "quota-mark").length, 1);
});

test("a database error on the recovery mark is not treated as a successful resync", async () => {
  const ctx = setup({ claims: [], resyncRecords: [resyncRecord("r-4")], markError: { message: "db down" } });
  const result = await ctx.process();
  assert.equal(result.quotaResyncs, 0, "an errored mark must not count as recovered");
  assert.equal(ctx.calls.filter((c) => c === "quota-mark").length, 1);
  // quota_resynced_at stays NULL, so the record is re-listed and retried.
  await ctx.process();
  assert.equal(ctx.calls.filter((c) => c === "quota-resync").length, 2);
});

test("missing recovery listing RPC recovers nothing and does not fail the pass", async () => {
  const ctx = setup({ claims: [], resyncListError: { code: "PGRST202", message: "missing" } });
  const result = await ctx.process();
  assert.equal(result.processed, 0);
  assert.equal(result.quotaResyncs, 0);
  assert.equal(ctx.calls.includes("quota-resync"), false);
  assert.equal(ctx.calls.includes("quota-mark"), false);
});

const malformedResyncListings = [
  undefined, null, "nope", {}, [null], [{}], [{ id: 1, owner_id: owner }],
  [{ id: "r", owner_id: 2 }], [{ id: "", owner_id: owner }],
];
for (const [index, listing] of malformedResyncListings.entries()) {
  test(`malformed recovery listing ${index} is ignored without resync or mark`, async () => {
    const ctx = setup({ claims: [], resyncListData: listing });
    const result = await ctx.process();
    assert.equal(result.quotaResyncs, 0);
    assert.equal(ctx.calls.includes("quota-resync"), false);
    assert.equal(ctx.calls.includes("quota-mark"), false);
  });
}

// --- Findings 1-3 invariants and moved authorization ----------------------

test("canonical and boolean validation precede every call", async () => {
  const ctx = setup();
  await assert.rejects(ctx.run({ key: `${owner}/..\\victim/x` }));
  await assert.rejects(ctx.run({ onlyIfUnreferenced: "true" }));
  assert.deepEqual(ctx.calls, []);
});

test("client-side code no longer deletes document metadata or profile pointers", () => {
  const slice = source.slice(start, end);
  assert.doesNotMatch(slice, /\.from\("documents"\)|\.from\("profiles"\)|photo_url:\s*null/);
  assert.match(slice, /request_storage_deletion/);
  assert.match(slice, /finalize_storage_deletion/);
});
