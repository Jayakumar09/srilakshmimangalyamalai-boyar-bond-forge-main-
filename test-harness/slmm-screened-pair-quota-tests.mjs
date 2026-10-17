// Offline Phase 4 regression for the screened-pair quota path.
//
// Phase 4 correction: `submitScreenedPair` in src/lib/verify.functions.ts no
// longer hands a reservation back on a failed `documents` insert. The amount it
// would have returned (`photoSizeBytes` / `idSizeBytes`) is client-supplied,
// while the reservation was taken by `uploadFile` from the server-measured
// `file.size`; a client-controlled decrement could drive the counters *below*
// the true reservation ("drift low"), which the quota design forbids. The
// reservation is instead left held (drift high, safe and recoverable) and the
// caller's compensation path reconciles the counters from a fresh R2 listing
// via `resyncProfileQuota` / `resync_upload_quota`.
//
// These tests execute the REAL `submitScreenedPair` handler body in a VM. Every
// collaborator is mocked: the Supabase admin client, the Gemini call
// (`runIdScreen`), the release wrapper (as a tripwire that throws if ever
// called), and the dynamic import of the server Supabase client. No Supabase,
// R2, Gemini, Vite config, environment file or secret access.
//
// The 6/5/11/20MiB caps, the advisory lock and the RPC bodies live in Postgres
// and are NOT exercised here (nor can they be offline). The R2 PUT
// success/failure/ambiguous matrix is already pinned by
// slmm-quota-release-tests.mjs and is not duplicated.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

function loadModule(source, context) {
  const exports = {};
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(js, { ...context, exports });
  return exports;
}

// ---- real screening policy and pure storage-key dependency ----------------
const screening = readFileSync(new URL("../src/lib/screening.ts", import.meta.url), "utf8");
const keyPolicy = loadModule(readFileSync(new URL("../src/lib/storage-key.ts", import.meta.url), "utf8"), {});
const policy = loadModule(screening, {
  require(name) {
    assert.equal(name, "@/lib/storage-key");
    return keyPolicy;
  },
});
const { isOwnedStorageKey, isApprovedMandatoryIdKind, summarizePersistedPair, decideScreenedPair } =
  policy;

// ---- submitScreenedPair slice ----------------------------------------------
const verify = readFileSync(new URL("../src/lib/verify.functions.ts", import.meta.url), "utf8");
const pairStart = verify.indexOf("const PairInput = z.object({");
assert.ok(pairStart >= 0, "PairInput must be located");
const pairSource = verify.slice(pairStart);
assert.ok(pairSource.includes("export const submitScreenedPair"), "slice must include the handler");
assert.ok(!pairSource.includes("preScreenDocuments"), "slice must not run past submitScreenedPair");

// Static guards that pin the Phase 4 correction.
assert.ok(
  !/from\s+["']@\/lib\/storage\.functions["']/.test(verify),
  "verify.functions.ts must not import quota mutators from storage.functions",
);
assert.ok(
  !/releaseProfileQuota\s*\(/.test(pairSource),
  "submitScreenedPair must not call releaseProfileQuota",
);

const USER = "11111111-1111-1111-1111-111111111111";
const PHOTO_KEY = `${USER}/photo/1700000000000-aaaa-photo.webp`;
const ID_KEY = `${USER}/govt_id/1700000000001-bbbb-pan.pdf`;
const FOREIGN_KEY = `22222222-2222-2222-2222-222222222222/photo/x.webp`;
const PHOTO_SIZE = 123456;
const ID_SIZE = 654321;
const PASS = {
  faceMatch: true,
  idReadable: true,
  photoClear: true,
  faceMatchConfidence: 0.97,
  idType: "PAN",
  notes: "clear",
};
const BLOCKED = {
  faceMatch: false,
  idReadable: false,
  photoClear: true,
  faceMatchConfidence: 0.2,
  idType: "PAN",
  notes: "unreadable",
};

// A minimal chainable server-fn stand-in, mirroring the module's own usage.
function makeCreateServerFn(requireSupabaseAuth) {
  return function createServerFn({ method }) {
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
      handler(fn) {
        return { handler: fn };
      },
    };
  };
}

// `z` is only used to build PairInput, which the harness never re-validates
// (the handler is invoked directly), so a structural chainable stub is enough.
function zChain() {
  const chain = {};
  for (const method of ["min", "max", "int", "nonnegative", "positive", "optional", "nullable", "regex", "length"]) {
    chain[method] = () => chain;
  }
  return chain;
}
const zStub = { object: () => ({ parse: (value) => value }), string: zChain, number: zChain };

function setup(options = {}) {
  const calls = { select: 0, selectKeys: [], insert: [], quota: [], model: 0 };
  const selectResult = options.selectResult ?? { data: [], error: null };
  const insertResult = options.insertResult ?? { error: null };
  const runIdScreen = options.runIdScreen ?? (() => {
    calls.model++;
    return Promise.resolve(PASS);
  });

  const supabaseAdmin = {
    from(table) {
      assert.equal(table, "documents");
      return {
        select(columns) {
          calls.selectColumns = columns;
          return {
            eq(column, value) {
              assert.equal(column, "user_id");
              assert.equal(value, USER);
              return {
                in(column, keys) {
                  assert.equal(column, "storage_key");
                  calls.select++;
                  calls.selectKeys.push(keys);
                  return typeof selectResult === "function" ? selectResult() : selectResult;
                },
              };
            },
          };
        },
        insert(rows) {
          calls.insert.push(rows);
          return typeof insertResult === "function" ? insertResult(rows) : insertResult;
        },
      };
    },
  };

  const requireSupabaseAuth = Symbol("auth middleware");
  const exports = loadModule(pairSource, {
    z: zStub,
    createServerFn: makeCreateServerFn(requireSupabaseAuth),
    requireSupabaseAuth,
    runIdScreen,
    isOwnedStorageKey,
    isApprovedMandatoryIdKind,
    summarizePersistedPair,
    decideScreenedPair,
    // Tripwire: if the handler ever reaches for a quota mutation again, the
    // test fails loudly rather than silently trusting a client amount.
    releaseProfileQuota: (owner, folder, size) => {
      calls.quota.push([owner, folder, size]);
      throw new Error("releaseProfileQuota must not be called on the screened-pair path");
    },
    require: (specifier) => {
      assert.equal(specifier, "@/integrations/supabase/client.server");
      return { supabaseAdmin };
    },
  });

  const data = {
    idImage: "i".repeat(64),
    photoImage: "p".repeat(64),
    photoKey: options.photoKey ?? PHOTO_KEY,
    idKey: options.idKey ?? ID_KEY,
    idKind: options.idKind ?? "PAN",
    photoFileName: "photo.webp",
    idFileName: "pan.pdf",
    photoMimeType: "image/webp",
    idMimeType: "application/pdf",
    photoSizeBytes: options.photoSizeBytes ?? PHOTO_SIZE,
    idSizeBytes: options.idSizeBytes ?? ID_SIZE,
  };
  const context = { userId: USER };

  const run = () => exports.submitScreenedPair.handler({ data, context });
  return { run, calls };
}

test("successful insert persists both rows and mutates no quota", async () => {
  const ctx = setup();
  const res = await ctx.run();
  assert.equal(res.status, "pass");
  assert.equal(res.alreadyPersisted, false);
  assert.equal(ctx.calls.select, 1);
  assert.equal(ctx.calls.insert.length, 1);
  assert.equal(ctx.calls.insert[0].length, 2, "photo and govt_id rows are inserted together");
  assert.deepEqual(ctx.calls.quota, [], "a persisted pair keeps its reservation");
});

test("failed insert rethrows the original error and mutates no quota", async () => {
  const boom = new Error("insert failed");
  const ctx = setup({ insertResult: { error: boom } });
  const error = await ctx.run().then(
    () => {
      throw new Error("handler unexpectedly resolved");
    },
    (err) => err,
  );
  assert.equal(error, boom, "the ORIGINAL insert error is rethrown");
  assert.deepEqual(ctx.calls.quota, [], "no reservation is handed back from the server");
});

test("a client-supplied byte amount cannot influence the quota", async () => {
  // Sentinels that would be tempting to release against if the amount were
  // trusted; the assertion is simply that nothing is mutated for any value.
  for (const [photoSizeBytes, idSizeBytes] of [
    [0, 0],
    [15_728_640, 15_728_640],
    [1, 15_728_640],
    [15_728_640, 1],
  ]) {
    const ctx = setup({ insertResult: { error: new Error("boom") }, photoSizeBytes, idSizeBytes });
    await ctx.run().catch(() => {});
    assert.deepEqual(ctx.calls.quota, [], `no mutation for sizes ${photoSizeBytes}/${idSizeBytes}`);
  }
});

test("repeated failed inserts mutate no quota (no duplicate-release risk)", async () => {
  const ctx = setup({ insertResult: { error: new Error("boom") } });
  await ctx.run().catch(() => {});
  await ctx.run().catch(() => {});
  await ctx.run().catch(() => {});
  assert.deepEqual(ctx.calls.quota, [], "no release on any of the repeated attempts");
});

test("missing reservation: unowned or unknown keys still release nothing", async () => {
  // Keys that pass ownership but were never reserved (e.g. an object that is
  // merely referenced) still must not trigger a release.
  const ctx = setup({
    insertResult: { error: new Error("boom") },
    photoKey: `${USER}/photo/never-reserved.webp`,
    idKey: `${USER}/govt_id/never-reserved.pdf`,
  });
  await ctx.run().catch(() => {});
  assert.deepEqual(ctx.calls.quota, []);
});

test("rows already screened are skipped: no model call, no insert, no mutation", async () => {
  const ctx = setup({
    selectResult: {
      data: [
        { storage_key: PHOTO_KEY, doc_type: "photo", ai_check_status: "pass", ai_check_notes: "n", ai_face_match_score: 0.9 },
        { storage_key: ID_KEY, doc_type: "govt_id", ai_check_status: "pass", ai_check_notes: "n", ai_face_match_score: 0.9 },
      ],
      error: null,
    },
  });
  const res = await ctx.run();
  assert.equal(res.alreadyPersisted, true);
  assert.equal(res.status, "pass");
  assert.equal(ctx.calls.model, 0, "the model is not re-run for a persisted pair");
  assert.equal(ctx.calls.insert.length, 0);
  assert.deepEqual(ctx.calls.quota, []);
});

test("a blocked verdict inserts nothing and mutates no quota", async () => {
  const ctx = setup({
    runIdScreen: () => {
      ctx.calls.model++;
      return Promise.resolve(BLOCKED);
    },
  });
  const res = await ctx.run();
  assert.equal(res.status, "blocked");
  assert.equal(ctx.calls.insert.length, 0);
  assert.deepEqual(ctx.calls.quota, []);
});

test("partial state: only the missing row is inserted and it mutates no quota", async () => {
  const ctx = setup({
    selectResult: {
      data: [
        { storage_key: ID_KEY, doc_type: "govt_id", ai_check_status: "pass", ai_check_notes: "n", ai_face_match_score: 0.9 },
      ],
      error: null,
    },
    insertResult: { error: new Error("boom") },
  });
  await ctx.run().catch(() => {});
  assert.equal(ctx.calls.insert.length, 1);
  assert.equal(ctx.calls.insert[0].length, 1, "only the still-missing row is inserted");
  assert.deepEqual(ctx.calls.quota, []);
});

test("a document read error throws and mutates no quota", async () => {
  const ctx = setup({ selectResult: { data: null, error: new Error("read failed") } });
  await assert.rejects(ctx.run(), /read failed/);
  assert.equal(ctx.calls.insert.length, 0);
  assert.deepEqual(ctx.calls.quota, []);
});

test("a foreign storage key is rejected before any read or mutation", async () => {
  const ctx = setup({ photoKey: FOREIGN_KEY });
  await assert.rejects(ctx.run(), /Invalid storage key/);
  assert.equal(ctx.calls.select, 0);
  assert.deepEqual(ctx.calls.quota, []);
});

test("an unapproved id kind is rejected before any read or mutation", async () => {
  const ctx = setup({ idKind: "NotAnId" });
  await assert.rejects(ctx.run(), /Invalid document kind/);
  assert.equal(ctx.calls.select, 0);
  assert.deepEqual(ctx.calls.quota, []);
});

test("unsafe storage keys are rejected before screening reads or persistence", async () => {
  for (const suffix of ["..\\another-owner/photo/x", "%2e%2e/photo/x", "photo/x?alias", "photo/x\n"]) {
    const photoKey = `${PHOTO_KEY.split("/")[0]}/${suffix}`;
    const ctx = setup({ photoKey });
    await assert.rejects(ctx.run(), /Invalid storage key/);
    assert.equal(ctx.calls.select, 0);
    assert.equal(ctx.calls.insert.length, 0);
    assert.equal(ctx.calls.model, 0);
    assert.deepEqual(ctx.calls.quota, []);
  }
});

test("quota-counter integrity: the handler only ever reads documents, never mutates quota", async () => {
  // The handler may select and insert `documents`; it must never reach any
  // counter mutation. Exercised across success and failure paths.
  for (const insertResult of [{ error: null }, { error: new Error("boom") }]) {
    const ctx = setup({ insertResult });
    await ctx.run().catch(() => {});
    assert.equal(ctx.calls.select, 1);
    assert.equal(ctx.calls.quota.length, 0, "no reserve/release/resync RPC is invoked");
  }
});
