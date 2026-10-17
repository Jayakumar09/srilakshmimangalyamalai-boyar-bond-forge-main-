// Offline only: real validators, URL builders and handlers; all external boundaries mocked.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";

const read = (name) => readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
function load(source, globals = {}) {
  const exports = {};
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(js, { exports, URL, Request, ...globals });
  return exports;
}
const keys = load(read("storage-key"));
const screening = load(read("screening"), {
  require(name) {
    assert.equal(name, "@/lib/storage-key");
    return keys;
  },
});
const owner = "11111111-1111-4111-8111-111111111111";
const victim = "22222222-2222-4222-8222-222222222222";
const folders = ["photo", "govt_id", "divorce_doc", "payment_proof", "jathagam", "attachment"];
const valid = [
  ...folders.map((folder) => `${owner}/${folder}/1790000000000-${victim}-Report_1..final.pdf`),
  `${owner}/receipts/${victim}-receipt.html`,
  `${owner}/photo/legacy.JPG`,
  `${owner}/older-folder/subfolder/File-1.png`,
  `${owner}/${"a".repeat(263)}`, // 300-character boundary
];
const invalid = [
  "", "single-segment", `/${owner}/photo/x`, `${owner}/photo/`, `${owner}//photo/x`,
  `${owner}/./photo/x`, `${owner}/../${victim}/photo/x`,
  `${owner}/..\\${victim}/photo/x`, `${owner}/photo\\..\\..\\${victim}/x`,
  ...["%2e%2e", "%2E%2E", "%2e.", ".%2e", "%252e%252e"].map((s) => `${owner}/${s}/${victim}/x`),
  ...["%2f", "%2F", "%5c", "%5C", "%252f", "%255c", "%", "%zz", "%E0%A4%A", "%41"].map((s) => `${owner}/photo/${s}x`),
  ...["?", "#", "\0", "\t", "\r", "\n", "\x7f", " ", "é"].map((s) => `${owner}/photo/a${s}b`),
  `${owner}/photo/x\n`, `${owner}/${"a".repeat(264)}`,
];

function setup() {
  const calls = { sign: [], fetch: 0, db: 0 };
  const context = {
    userId: owner,
    supabase: {
      from() { calls.db++; throw new Error("unexpected database operation"); },
      rpc() { calls.db++; throw new Error("unexpected authorization RPC"); },
    },
  };
  function createServerFn() {
    let validate;
    return {
      middleware() { return this; },
      inputValidator(fn) { validate = fn; return this; },
      handler(fn) {
        return async ({ data, context: supplied = context }) => fn({ data: validate(data), context: supplied });
      },
    };
  }
  const modules = {
    "@tanstack/react-start": { createServerFn },
    zod: { z },
    "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: {} },
    "@/lib/storage-key": keys,
    "@/lib/screening": screening,
    "@/lib/compress": {},
    "@/integrations/supabase/client": { supabase: context.supabase },
    aws4fetch: {
      AwsClient: class {
        async sign(request) {
          calls.sign.push({ url: request.url, method: request.method });
          return { url: request.url };
        }
      },
    },
  };
  const globals = {
    process: { env: { R2_ACCOUNT_ID: "offline", R2_BUCKET_NAME: "test-bucket", R2_ACCESS_KEY_ID: "dummy", R2_SECRET_ACCESS_KEY: "dummy" } },
    fetch: () => { calls.fetch++; throw new Error("network prohibited"); },
    require(name) {
      assert.ok(Object.hasOwn(modules, name), `unmocked import: ${name}`);
      return modules[name];
    },
  };
  const storage = load(`${read("storage.functions")}\nexport { signR2 };`, globals);
  const receipts = load(`${read("receipts.functions")}\nexport { signR2Put };`, globals);
  return { storage, receipts, calls, context };
}

test("existing upload, receipt and safe legacy keys retain exact object identity", async () => {
  const ctx = setup();
  for (const key of valid) {
    assert.equal(keys.isCanonicalStorageKey(key), true, key);
    assert.equal(screening.isOwnedStorageKey(key, owner), true);
    assert.equal(screening.isOwnedStorageKey(key, victim), false);
    for (const method of ["GET", "PUT", "DELETE"]) {
      const url = new URL(await ctx.storage.signR2(key, method));
      assert.equal(url.pathname, `/test-bucket/${key}`);
      assert.equal(url.hash, "");
      assert.equal(url.search, "?X-Amz-Expires=900");
    }
  }
  const receipt = valid[6];
  assert.equal(new URL(await ctx.receipts.signR2Put(receipt, "text/html")).pathname, `/test-bucket/${receipt}`);
  assert.equal(ctx.calls.fetch, 0);
});

test("unsafe keys fail shared validation, ownership and cleanup selection", () => {
  for (const key of invalid) {
    assert.equal(keys.isCanonicalStorageKey(key), false, JSON.stringify(key));
    assert.equal(screening.isOwnedStorageKey(key, owner), false);
    assert.equal(screening.keysSafeToDelete([key], [], owner).length, 0);
    assert.throws(() => keys.storageObjectUrl("offline", "test-bucket", key), /Invalid storage key/);
  }
});

test("both real signers reject every unsafe key before AWS signing or fetch", async () => {
  const ctx = setup();
  for (const key of invalid) {
    for (const method of ["GET", "PUT", "DELETE"]) {
      await assert.rejects(ctx.storage.signR2(key, method), /Invalid storage key/);
    }
    await assert.rejects(ctx.receipts.signR2Put(key, "text/html"), /Invalid storage key/);
  }
  assert.deepEqual(ctx.calls, { sign: [], fetch: 0, db: 0 });
});

test("server validators reject unsafe keys before authorization, metadata or R2 operations", async () => {
  const ctx = setup();
  // Both own-prefix and foreign-prefix requests must fail before role checks.
  for (const userId of [owner, victim]) {
    const context = { ...ctx.context, userId };
    for (const key of invalid) {
      for (const name of ["deleteUpload", "createViewUrl", "setPrimaryPhoto"]) {
        await assert.rejects(ctx.storage[name]({ data: { key }, context }));
      }
      await assert.rejects(ctx.storage.createViewUrls({ data: { keys: [valid[0], key] }, context }));
    }
  }
  assert.deepEqual(ctx.calls, { sign: [], fetch: 0, db: 0 });
});

test("valid single and batch viewing reach signing without changing the key", async () => {
  const ctx = setup();
  const { url } = await ctx.storage.createViewUrl({ data: { key: valid[0] } });
  assert.equal(new URL(url).pathname, `/test-bucket/${valid[0]}`);
  const context = { userId: owner, supabase: { rpc: async () => ({ data: false }) } };
  const urls = await ctx.storage.createViewUrls({ data: { keys: valid }, context });
  for (const key of valid) assert.equal(new URL(urls[key]).pathname, `/test-bucket/${key}`);
  assert.equal(ctx.calls.fetch, 0);
});
