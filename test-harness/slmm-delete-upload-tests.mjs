// Offline regression for the actual deleteUpload handler. Only this handler is
// transpiled; Supabase, R2 signing, fetch and quota resync are all mocked.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/storage.functions.ts", import.meta.url), "utf8");
const start = source.indexOf('export const deleteUpload = createServerFn({ method: "POST" })');
// End the slice at the next handler's doc comment. That comment exists in both
// the Phase 2-only source and the combined working tree, so this boundary no
// longer depends on any Phase 3 code being present in the file.
const end = source.indexOf("/** Returns a short-lived view URL. Owners and admins only. */", start);
assert.ok(start >= 0 && end > start, "deleteUpload handler must be located");
const handlerSource = source.slice(start, end);

const owner = "mock-owner";
const key = `${owner}/govt_id/example.pdf`;

function setup(lookup, options = {}) {
  const calls = [];
  const requireSupabaseAuth = Symbol("auth middleware");
  const exports = {};
  const js = ts.transpileModule(handlerSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(js, {
    exports,
    requireSupabaseAuth,
    createServerFn({ method }) {
      assert.equal(method, "POST");
      return {
        middleware(items) {
          assert.equal(items.length, 1);
          assert.equal(items[0], requireSupabaseAuth);
          return this;
        },
        inputValidator(validator) {
          assert.equal(typeof validator, "function");
          return this;
        },
        handler(fn) { return { handler: fn }; },
      };
    },
    signR2: async (_key, method) => {
      calls.push("sign");
      assert.equal(method, "DELETE");
      if (options.signError) throw new Error("mock signing failure");
      return "https://mock.invalid/deletion";
    },
    fetch: async (_url, { method }) => {
      calls.push("r2-delete");
      assert.equal(method, "DELETE");
      if (options.networkError) throw new Error("mock network failure");
      const status = options.status ?? 204;
      return { ok: status >= 200 && status < 300, status };
    },
    resyncProfileQuota: async (userId) => {
      assert.equal(userId, owner);
      calls.push("quota-resync");
      if (options.resyncError) throw new Error("mock quota failure");
    },
  });
  assert.equal(typeof exports.deleteUpload?.handler, "function");

  const context = {
    userId: owner,
    supabase: {
      from(table) {
        assert.equal(table, "documents");
        return {
          select(columns) {
            assert.equal(columns, "user_id, doc_type");
            return {
              eq(column, value) {
                assert.equal(column, "storage_key");
                assert.equal(value, key);
                calls.push("lookup");
                return lookup;
              },
            };
          },
          delete() {
            return {
              eq(column, value) {
                assert.equal(column, "storage_key");
                assert.equal(value, key);
                calls.push("metadata-delete");
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      },
      rpc() { throw new Error("owner must not require an admin check"); },
    },
  };
  const run = () => exports.deleteUpload.handler({ data: { key }, context });
  return { run, calls };
}

test("returned lookup error stops before metadata, R2 and quota operations", async () => {
  const ctx = setup(Promise.resolve({ data: null, error: { message: "read failed" } }));
  await assert.rejects(ctx.run(), /Cannot verify document references/);
  assert.deepEqual(ctx.calls, ["lookup"]);
});

test("returned error stops even when the lookup contains a row", async () => {
  const ctx = setup(Promise.resolve({ data: [{ user_id: owner, doc_type: "govt_id" }], error: { message: "partial read" } }));
  await assert.rejects(ctx.run(), /Cannot verify document references/);
  assert.deepEqual(ctx.calls, ["lookup"]);
});

test("null lookup data without an error also stops before deletion", async () => {
  const ctx = setup(Promise.resolve({ data: null, error: null }));
  await assert.rejects(ctx.run(), /Cannot verify document references/);
  assert.deepEqual(ctx.calls, ["lookup"]);
});

test("valid empty lookup still deletes an orphaned object and resyncs quota", async () => {
  const ctx = setup(Promise.resolve({ data: [], error: null }));
  const result = await ctx.run();
  assert.equal(result.ok, true);
  assert.deepEqual(ctx.calls, ["lookup", "sign", "r2-delete", "quota-resync"]);
});

test("referenced row still deletes metadata before R2 and quota resync", async () => {
  const ctx = setup(Promise.resolve({ data: [{ user_id: owner, doc_type: "govt_id" }], error: null }));
  const result = await ctx.run();
  assert.equal(result.ok, true);
  assert.deepEqual(ctx.calls, ["lookup", "metadata-delete", "sign", "r2-delete", "quota-resync"]);
});

for (const status of [403, 404, 500]) {
  test(`HTTP ${status} never reports success and still resyncs quota`, async () => {
    const ctx = setup(Promise.resolve({ data: [], error: null }), { status });
    await assert.rejects(ctx.run(), { message: `Storage deletion failed (${status}).` });
    assert.deepEqual(ctx.calls, ["lookup", "sign", "r2-delete", "quota-resync"]);
  });
}

test("signing failure stays a failure without exposing its details", async () => {
  const ctx = setup(Promise.resolve({ data: [], error: null }), { signError: true });
  await assert.rejects(ctx.run(), { message: "Storage deletion failed." });
  assert.deepEqual(ctx.calls, ["lookup", "sign", "quota-resync"]);
});

test("network rejection stays a failure without exposing its details", async () => {
  const ctx = setup(Promise.resolve({ data: [], error: null }), { networkError: true });
  await assert.rejects(ctx.run(), { message: "Storage deletion failed." });
  assert.deepEqual(ctx.calls, ["lookup", "sign", "r2-delete", "quota-resync"]);
});

test("quota resync failure cannot mask the original R2 failure", async () => {
  const ctx = setup(Promise.resolve({ data: [], error: null }), { status: 500, resyncError: true });
  await assert.rejects(ctx.run(), { message: "Storage deletion failed (500)." });
  assert.deepEqual(ctx.calls, ["lookup", "sign", "r2-delete", "quota-resync"]);
});
