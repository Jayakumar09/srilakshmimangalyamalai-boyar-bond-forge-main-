// Offline cleanup wrapper tests. The server's authoritative checks are exercised
// separately in slmm-delete-upload-tests.mjs, not replaced with browser visibility.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

function load(source, context = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { ...context, exports });
  return exports;
}
const read = (name) => readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
const keyPolicy = load(read("storage-key"));
const { keysSafeToDelete } = load(read("screening"), {
  require(name) { assert.equal(name, "@/lib/storage-key"); return keyPolicy; },
});
const source = read("storage.functions");
const start = source.indexOf("export async function cleanupOrphanedUploads(");
const end = source.indexOf("/** Returns a short-lived view URL.", start);
assert.ok(start >= 0 && end > start);
const owner = "test-owner";
const fresh = `${owner}/photo/fresh.png`;
const stored = `${owner}/photo/stored.png`;

function setup(deleteImpl = async () => ({ ok: true })) {
  const attempts = [];
  const { cleanupOrphanedUploads } = load(source.slice(start, end), {
    keysSafeToDelete,
    deleteUpload: async ({ data }) => {
      assert.equal(data.onlyIfUnreferenced, true, "cleanup must enforce orphan-only mode on the server");
      attempts.push(data.key);
      return deleteImpl(data.key);
    },
    // Any browser-side absence check is a test failure, even inside a swallowed catch.
    supabase: { from() { attempts.push("UNSAFE browser query"); throw new Error("forbidden"); } },
  });
  return { cleanup: cleanupOrphanedUploads, attempts };
}

test("cleanup delegates every eligible key to authoritative server mode", async () => {
  const ctx = setup();
  await ctx.cleanup(owner, [fresh, stored]);
  assert.deepEqual(ctx.attempts, [fresh, stored]);
});

test("cleanup filters foreign, malformed and duplicate keys before server calls", async () => {
  const ctx = setup();
  await ctx.cleanup(owner, [fresh, fresh, "other/photo/x", `${owner}/..\\other/x`, `${owner}/%2e%2e/x`, ""]);
  assert.deepEqual(ctx.attempts, [fresh]);
});

test("missing owner or empty keys makes no calls", async () => {
  const ctx = setup();
  await ctx.cleanup("", [fresh]);
  await ctx.cleanup(owner, []);
  assert.deepEqual(ctx.attempts, []);
});

test("server skips referenced keys without stopping independent orphan cleanup", async () => {
  const deleted = [];
  const ctx = setup(async (key) => {
    if (key === stored) return { ok: true, skipped: true };
    deleted.push(key);
    return { ok: true };
  });
  await ctx.cleanup(owner, [stored, fresh]);
  assert.deepEqual(ctx.attempts, [stored, fresh]);
  assert.deepEqual(deleted, [fresh]);
});

for (const message of ["RPC missing", "Cannot verify storage references.", "Not allowed", "Storage deletion failed."]) {
  test(`server failure remains best-effort: ${message}`, async () => {
    const deleted = [];
    const ctx = setup(async (key) => {
      if (key === stored) throw new Error(message);
      deleted.push(key);
      return { ok: true };
    });
    await ctx.cleanup(owner, [stored, fresh]);
    assert.deepEqual(ctx.attempts, [stored, fresh]);
    assert.deepEqual(deleted, [fresh]);
  });
}

test("repeat cleanup requests re-enter server verification", async () => {
  const ctx = setup();
  await ctx.cleanup(owner, [fresh]);
  await ctx.cleanup(owner, [fresh]);
  assert.deepEqual(ctx.attempts, [fresh, fresh]);
});

test("mixed six-table reference skips preserve independent orphan cleanup", async () => {
  // Server returns skips for documents, proofs, reports, attachments, photos,
  // and receipts. The wrapper must not retry these in explicit-delete mode.
  const referenced = ["govt_id", "payment_proof", "jathagam", "attachment", "photo", "receipts"]
    .map((folder) => `${owner}/${folder}/referenced-file.pdf`);
  const deleted = [];
  const ctx = setup(async (key) => {
    if (referenced.includes(key)) return { ok: true, skipped: true };
    deleted.push(key);
    return { ok: true };
  });
  await ctx.cleanup(owner, [...referenced, fresh]);
  assert.deepEqual(ctx.attempts, [...referenced, fresh]);
  assert.deepEqual(deleted, [fresh]);
});
