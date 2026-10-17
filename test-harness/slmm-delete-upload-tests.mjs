// Real deletion validator/handler, with offline database, signing and R2 boundaries.
// RLS and SQL execution are NOT simulated or verified by these mocks.
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
const row = { user_id: owner, doc_type: "govt_id" };
const state = (has_references, may_delete_references = true) => ({
  data: [{ has_references, may_delete_references }], error: null,
});
const absent = () => state(false);

function setup(options = {}) {
  const calls = [];
  const rows = options.rows ?? [];
  let checks = 0;
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
        assert.equal(name, "get_document_storage_reference_state");
        assert.deepEqual(Object.keys(args), ["p_storage_key"]);
        assert.equal(args.p_storage_key, key);
        calls.push("reference-check");
        const result = options.states
          ? options.states[checks++]
          : checks++ === 0 ? state(rows.length > 0) : absent();
        if (result instanceof Error) throw result;
        return result;
      },
      from(table) {
        assert.equal(table, "documents", "blocked deletion must not touch profile pointers");
        return {
          select(columns) {
            assert.equal(columns, "user_id, doc_type");
            return { eq(column, value) {
              assert.equal(column, "storage_key");
              assert.equal(value, key);
              calls.push("lookup");
              return options.lookup ?? { data: rows, error: null };
            } };
          },
          delete() {
            return { eq(column, value) {
              assert.equal(column, "storage_key");
              assert.equal(value, key);
              calls.push("metadata-delete");
              return { error: options.deleteError ?? null };
            } };
          },
        };
      },
    },
  };
  const requireSupabaseAuth = Symbol("authentication");
  const mod = load(source.slice(start, end), {
    z, isCanonicalStorageKey, requireSupabaseAuth,
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
      assert.equal(signedKey, key);
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
      assert.equal(userId, owner);
      calls.push("quota-resync");
      if (options.resyncError) throw new Error("quota failed");
    },
  });
  return { calls, run: (data = {}) => mod.deleteUpload({ key, ...data }) };
}

test("hidden foreign references block owner deletion before metadata or R2", async () => {
  const ctx = setup({ rows: [], states: [state(true, false)] });
  await assert.rejects(ctx.run(), /Not allowed/);
  assert.deepEqual(ctx.calls, ["reference-check"]);
});

test("mixed visible own and hidden foreign references also block deletion", async () => {
  const ctx = setup({ rows: [row], states: [state(true, false)] });
  await assert.rejects(ctx.run(), /Not allowed/);
  assert.deepEqual(ctx.calls, ["reference-check"]);
});

for (const refs of [state(true), state(true, false)]) {
  for (const userId of [owner, "admin-user"]) {
    test(`cleanup skips referenced objects without deleting rows (${userId}, deletable=${refs.data[0].may_delete_references})`, async () => {
      const ctx = setup({ userId, states: [refs] });
      assert.equal((await ctx.run({ onlyIfUnreferenced: true })).skipped, true);
      assert.deepEqual(ctx.calls, userId === owner ? ["reference-check"] : ["authorize", "reference-check"]);
    });
  }
}

test("explicit own-document deletion confirms absence after metadata deletion", async () => {
  const ctx = setup({ rows: [row] });
  assert.equal((await ctx.run()).ok, true);
  assert.deepEqual(ctx.calls, ["reference-check", "lookup", "metadata-delete", "reference-check", "sign", "r2-delete", "quota-resync"]);
});

test("admin explicit deletion retains access but requires final authoritative absence", async () => {
  const ctx = setup({ userId: "admin-user", rows: [row, { ...row, user_id: "another-owner" }] });
  assert.equal((await ctx.run()).ok, true);
  assert.deepEqual(ctx.calls, ["authorize", "reference-check", "lookup", "metadata-delete", "reference-check", "sign", "r2-delete", "quota-resync"]);
});

for (const onlyIfUnreferenced of [false, true]) {
  test(`true orphan can be deleted (cleanup=${onlyIfUnreferenced})`, async () => {
    const ctx = setup();
    assert.equal((await ctx.run({ onlyIfUnreferenced })).ok, true);
    assert.deepEqual(ctx.calls, ["reference-check", "lookup", "reference-check", "sign", "r2-delete", "quota-resync"]);
  });
}

test("successful metadata DELETE with references remaining cannot reach R2", async () => {
  const ctx = setup({ rows: [row], states: [state(true), state(true, false)] });
  await assert.rejects(ctx.run(), /Document references remain/);
  assert.deepEqual(ctx.calls, ["reference-check", "lookup", "metadata-delete", "reference-check"]);
});

test("scoped empty lookup cannot override remaining authoritative references", async () => {
  const ctx = setup({ states: [state(true), state(true)] });
  await assert.rejects(ctx.run(), /Document references remain/);
  assert.deepEqual(ctx.calls, ["reference-check", "lookup", "reference-check"]);
});

test("cleanup never deletes a row appearing in the scoped lookup", async () => {
  const ctx = setup({ rows: [row], states: [absent()] });
  assert.equal((await ctx.run({ onlyIfUnreferenced: true })).skipped, true);
  assert.deepEqual(ctx.calls, ["reference-check", "lookup"]);
});

test("cleanup skips references appearing by the second authoritative check", async () => {
  const ctx = setup({ states: [absent(), state(true)] });
  assert.equal((await ctx.run({ onlyIfUnreferenced: true })).skipped, true);
  assert.deepEqual(ctx.calls, ["reference-check", "lookup", "reference-check"]);
});

const uncertain = [
  { data: null, error: { code: "PGRST202", message: "RPC missing" } },
  { ...absent(), error: { message: "partial error" } },
  new Error("transport failed"), undefined, null,
  { data: null }, { data: [] }, { data: [null] }, { data: [[]] },
  { data: [absent().data[0], absent().data[0]] }, { data: {} },
  { data: [{}] }, { data: [{ has_references: "false", may_delete_references: true }] },
  { data: [{ has_references: false, may_delete_references: null }] },
  state(false, false),
];
for (const [index, result] of uncertain.entries()) {
  test(`uncertain reference response ${index} fails closed at both checkpoints`, async () => {
    const initial = setup({ states: [result] });
    await assert.rejects(initial.run(), /Cannot verify document references/);
    assert.deepEqual(initial.calls, ["reference-check"]);
    const final = setup({ rows: [row], states: [state(true), result] });
    await assert.rejects(final.run(), /Cannot verify document references/);
    assert.deepEqual(final.calls, ["reference-check", "lookup", "metadata-delete", "reference-check"]);
  });
}

for (const roleResult of [{ data: false }, { data: null }, { data: "true" }, { data: true, error: { message: "uncertain" } }]) {
  test(`uncertain/unauthorized admin result ${JSON.stringify(roleResult)} blocks reference access`, async () => {
    const ctx = setup({ userId: "another-user", roleResult });
    await assert.rejects(ctx.run(), /Not allowed/);
    assert.deepEqual(ctx.calls, ["authorize"]);
  });
}

for (const lookup of [{ data: null, error: null }, { data: [], error: { message: "read failed" } }]) {
  test("scoped metadata lookup failures still fail closed", async () => {
    const ctx = setup({ lookup });
    await assert.rejects(ctx.run(), /Cannot verify document references/);
    assert.deepEqual(ctx.calls, ["reference-check", "lookup"]);
  });
}

test("metadata deletion failure stops before the second check and R2", async () => {
  const ctx = setup({ rows: [row], deleteError: new Error("delete failed") });
  await assert.rejects(ctx.run(), /delete failed/);
  assert.deepEqual(ctx.calls, ["reference-check", "lookup", "metadata-delete"]);
});

for (const status of [403, 404, 500]) {
  test(`R2 HTTP ${status} remains a failure after authoritative absence`, async () => {
    const ctx = setup({ status });
    await assert.rejects(ctx.run(), { message: `Storage deletion failed (${status}).` });
    assert.deepEqual(ctx.calls, ["reference-check", "lookup", "reference-check", "sign", "r2-delete", "quota-resync"]);
  });
}

for (const options of [{ signError: true }, { networkError: true }, { networkError: true, resyncError: true }]) {
  test(`signing/network errors stay generic ${JSON.stringify(options)}`, async () => {
    const ctx = setup(options);
    await assert.rejects(ctx.run(), { message: "Storage deletion failed." });
    assert.equal(ctx.calls.at(-1), "quota-resync");
  });
}

test("canonical validation and cleanup boolean validation precede reference calls", async () => {
  const ctx = setup();
  await assert.rejects(ctx.run({ key: `${owner}/..\\victim/x` }));
  await assert.rejects(ctx.run({ onlyIfUnreferenced: "true" }));
  assert.deepEqual(ctx.calls, []);
});
