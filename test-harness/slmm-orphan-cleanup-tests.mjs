// Offline regression for the actual cleanupOrphanedUploads implementation.
// Only the selected source functions are transpiled; all database and delete
// operations are mocked. No Vite config, environment files, or network access.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

function loadFunction(source, context, name) {
  const exports = {};
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(js, { ...context, exports });
  assert.equal(typeof exports[name], "function", `${name} must be exported`);
  return exports[name];
}

const screening = readFileSync(new URL("../src/lib/screening.ts", import.meta.url), "utf8");
const keysSafeToDelete = loadFunction(screening, {}, "keysSafeToDelete");
const storage = readFileSync(new URL("../src/lib/storage.functions.ts", import.meta.url), "utf8");
const start = storage.indexOf("export async function cleanupOrphanedUploads(");
const end = storage.indexOf("/** Returns a short-lived view URL.", start);
assert.ok(start >= 0 && end > start, "cleanupOrphanedUploads source must be located");
const cleanupSource = storage.slice(start, end);

const owner = "test-owner";
const fresh = `${owner}/photo/fresh.png`;
const fresh2 = `${owner}/photo/fresh2.png`;
const fresh3 = `${owner}/photo/fresh3.png`;
const stored = `${owner}/photo/stored.png`;
const foreign = "another-owner/photo/foreign.png";

function setup(queryResult, deleteImpl) {
  const deletions = [];
  const attempts = [];
  let queries = 0;
  const supabase = {
    from(table) {
      assert.equal(table, "documents");
      return {
        select(columns) {
          assert.equal(columns, "storage_key");
          return {
            in(column, keys) {
              assert.equal(column, "storage_key");
              assert.ok(keys.every((key) => typeof key === "string"));
              queries++;
              return typeof queryResult === "function" ? queryResult() : queryResult;
            },
          };
        },
      };
    },
  };
  const cleanup = loadFunction(
    cleanupSource,
    {
      supabase,
      keysSafeToDelete,
      deleteUpload: async ({ data: { key } }) => {
        attempts.push(key);
        if (deleteImpl) return deleteImpl(key, deletions);
        deletions.push(key);
      },
    },
    "cleanupOrphanedUploads",
  );
  return { cleanup, deletions, attempts, get queries() { return queries; } };
}

test("returned document-query error never deletes a potentially persisted key", async () => {
  const ctx = setup(Promise.resolve({ data: null, error: { message: "read failed" } }));
  await ctx.cleanup(owner, [stored, fresh]);
  assert.deepEqual(ctx.deletions, []);
  assert.equal(ctx.queries, 1);
});

test("returned error also blocks cleanup when the response includes rows", async () => {
  const ctx = setup(Promise.resolve({ data: [{ storage_key: stored }], error: { message: "partial read" } }));
  await ctx.cleanup(owner, [stored, fresh]);
  assert.deepEqual(ctx.deletions, []);
});

test("null document data without an error also fails closed", async () => {
  const ctx = setup(Promise.resolve({ data: null, error: null }));
  await ctx.cleanup(owner, [stored]);
  assert.deepEqual(ctx.deletions, []);
});

test("a thrown document-query failure does not delete anything", async () => {
  const ctx = setup(() => Promise.reject(new Error("read failed")));
  await ctx.cleanup(owner, [stored]);
  assert.deepEqual(ctx.deletions, []);
});

test("successful read deletes only unreferenced keys owned by the caller", async () => {
  const ctx = setup(Promise.resolve({ data: [{ storage_key: stored }], error: null }));
  await ctx.cleanup(owner, [stored, fresh, foreign]);
  assert.deepEqual(ctx.deletions, [fresh]);
});

test("successful empty read still permits cleanup of an owned orphan", async () => {
  const ctx = setup(Promise.resolve({ data: [], error: null }));
  await ctx.cleanup(owner, [fresh]);
  assert.deepEqual(ctx.deletions, [fresh]);
});

test("an orphan whose R2 DELETE throws does not stop the remaining orphans", async () => {
  const ctx = setup(Promise.resolve({ data: [], error: null }), (key, deletions) => {
    if (key === fresh2) throw new Error("R2 DELETE failed (500).");
    deletions.push(key);
  });
  await ctx.cleanup(owner, [fresh, fresh2, fresh3]);
  assert.deepEqual(ctx.attempts, [fresh, fresh2, fresh3], "every eligible key is attempted, in order");
  assert.deepEqual(ctx.deletions, [fresh, fresh3], "the failing key is skipped, not recorded as deleted");
});

test("an orphan whose R2 DELETE rejects does not stop the remaining orphans", async () => {
  const ctx = setup(Promise.resolve({ data: [], error: null }), (key, deletions) => {
    if (key === fresh) return Promise.reject(new Error("network error"));
    deletions.push(key);
  });
  await ctx.cleanup(owner, [fresh, fresh2, fresh3]);
  assert.deepEqual(ctx.attempts, [fresh, fresh2, fresh3], "every eligible key is attempted, in order");
  assert.deepEqual(ctx.deletions, [fresh2, fresh3], "later keys are still processed after a rejection");
});

test("a repeat cleanup attempt re-tries every key and never treats a 404 as success", async () => {
  const gone = new Set();
  const deleteImpl = (key, deletions) => {
    if (gone.has(key)) {
      const err = new Error("R2 DELETE failed (404).");
      err.status = 404;
      throw err;
    }
    gone.add(key);
    deletions.push(key);
  };

  const first = setup(Promise.resolve({ data: [], error: null }), deleteImpl);
  await first.cleanup(owner, [fresh, fresh2]);
  assert.equal(first.queries, 1, "first attempt reads documents once");
  assert.deepEqual(first.deletions, [fresh, fresh2], "first attempt removes both orphans");

  const second = setup(Promise.resolve({ data: [], error: null }), deleteImpl);
  await second.cleanup(owner, [fresh, fresh2]);
  assert.equal(second.queries, 1, "a repeat attempt still re-reads documents");
  assert.deepEqual(second.attempts, [fresh, fresh2], "every key is re-attempted on a repeat run");
  assert.deepEqual(second.deletions, [], "an already-absent object (404) is not recorded as a fresh success");
});
