// Offline regression for the ACTUAL uploadFile handler in
// src/lib/storage.functions.ts.
//
// Only the uploadFile handler is transpiled and executed in a VM. Every helper
// it reaches for is supplied by the harness: the auth-middleware marker, the
// quota reserve/release functions, R2 signing, fetch, the file-validation
// helpers, sanitize, resolveOwnerPrefix and a deterministic crypto.randomUUID.
// No Supabase, R2, network, Vite config, environment file or secret access.
//
// The 6/5/11/20MiB caps and the advisory lock live in Postgres RPCs and are NOT
// exercised here; these tests pin the *control flow* of uploadFile around them,
// in particular when a reservation is released:
//
//   reserveProfileQuota                     (before anything is dispatched)
//   try { assertStorageKeyNotFenced; assertValidMagicBytes; signR2 }
//                                           -> on failure: release, rethrow
//   fetch PUT                               -> throw propagates: reservation retained
//   !res.ok                                 -> any status: retain, throw
//
// Tests labelled "[confirms existing behavior]" document what the handler does
// today. Tests labelled "[fail-closed fix]" assert the guarantee that a PUT
// which was dispatched retains the reservation for every outcome except a
// proven pre-dispatch failure, so a possibly-stored object is never released
// (no undercount).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/storage.functions.ts", import.meta.url), "utf8");
const start = source.indexOf('export const uploadFile = createServerFn({ method: "POST" })');
const end = source.indexOf("/**", start);
assert.ok(start >= 0 && end > start, "uploadFile handler must be located");
const handlerSource = source.slice(start, end);
// Guard that the slice is the handler and spans the reservation control flow.
assert.ok(handlerSource.includes("export const uploadFile"), "slice must start at uploadFile");
assert.ok(handlerSource.includes("reserveProfileQuota"), "slice must include the reservation");
assert.ok(handlerSource.includes("releaseProfileQuota"), "slice must include the release");
assert.ok(!handlerSource.includes("deleteUpload"), "slice must not run past uploadFile");

const OWNER = "mock-owner";
const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00];
const JUNK_BYTES = [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07];

// Faithful copies of the module's magic-byte tables, so the "invalid magic
// bytes" case uses genuinely invalid bytes rather than a forced throw.
const IMAGE_MAGICS = [
  [0xff, 0xd8, 0xff], // jpeg
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], // png
  [0x52, 0x49, 0x46, 0x46], // RIFF (webp)
  [0x47, 0x49, 0x46], // gif
  [0x42, 0x4d], // bmp
];
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

function startsWithBytes(buf, magic) {
  if (buf.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) if (buf[i] !== magic[i]) return false;
  return true;
}

/**
 * Builds a fresh sandbox, loads the real uploadFile handler and returns it with
 * the ordered list of side-effect calls it made. `options` drives which helper
 * fails and with what.
 */
function setup(options = {}) {
  const calls = [];
  const folder = options.folder ?? "photo";
  const contentType = options.contentType ?? "image/png";
  const bytes = Uint8Array.from(options.bytes ?? PNG_BYTES);

  const requireSupabaseAuth = Symbol("auth middleware");
  const exports = {};

  class MockFile {
    constructor(name, type, data) {
      this.name = name;
      this.type = type;
      this._data = data;
      this.size = data.length;
    }
    async arrayBuffer() {
      return this._data.buffer.slice(this._data.byteOffset, this._data.byteOffset + this._data.byteLength);
    }
  }

  const js = ts.transpileModule(handlerSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  runInNewContext(js, {
    exports,
    requireSupabaseAuth,
    File: MockFile,
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
        handler(fn) {
          return { handler: fn };
        },
      };
    },
    // Mirror the module's constants (FOLDERS / PROFILE_FOLDERS / caps / codes).
    FOLDERS: ["photo", "govt_id", "divorce_doc", "payment_proof", "jathagam", "attachment"],
    PROFILE_FOLDERS: new Set(["photo", "govt_id", "divorce_doc"]),
    MAX_PHOTO_INPUT_BYTES: 3 * 1024 * 1024,
    MAX_DOC_INPUT_BYTES: 5 * 1024 * 1024,
    FILE_TOO_LARGE_PHOTO: "FILE_TOO_LARGE_PHOTO",
    FILE_TOO_LARGE_DOC: "FILE_TOO_LARGE_DOC",
    assertAllowedType(ct) {
      calls.push("type-check");
      if (!["image/", "application/pdf"].some((prefix) => ct.startsWith(prefix))) {
        throw new Error("Unsupported file type.");
      }
    },
    assertValidMagicBytes(ct, buf) {
      calls.push("magic-check");
      if (ct === "application/pdf") {
        if (!startsWithBytes(buf, PDF_MAGIC)) throw new Error("Invalid file contents.");
        return;
      }
      if (ct.startsWith("image/") && !IMAGE_MAGICS.some((magic) => startsWithBytes(buf, magic))) {
        throw new Error("Invalid file contents.");
      }
    },
    sanitize: (name) => name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80),
    resolveOwnerPrefix: async (_context, ownerId) => {
      calls.push("owner");
      return ownerId ?? OWNER;
    },
    reserveProfileQuota: async (_owner, _folder, _size) => {
      calls.push("reserve");
      if (options.reserveError) throw new Error("UPLOAD_LIMIT_PHOTOS");
    },
    releaseProfileQuota: async (_owner, _folder, _size) => {
      calls.push("release");
      if (options.releaseError) throw new Error("mock release failure");
    },
    // Finding 5 object-creation safety net. The real helper probes
    // is_storage_key_fenced and throws unless the key is unfenced; here the
    // generated key is always fresh, so it only records the ordered call.
    assertStorageKeyNotFenced: async (key) => {
      calls.push("fence");
      assert.ok(key.startsWith(`${OWNER}/${folder}/`), "fence probe must use the generated key");
      if (options.fenceProbeFails) throw new Error("Cannot verify storage key availability.");
    },
    signR2: async (key, method, ct) => {
      calls.push("sign");
      assert.equal(method, "PUT");
      assert.equal(ct, contentType);
      assert.ok(key.startsWith(`${OWNER}/${folder}/`), "key must be under the resolved owner/folder");
      if (options.signError) throw new Error("mock signing failure");
      return "https://mock.invalid/upload";
    },
    fetch: async (_url, init) => {
      calls.push("put");
      assert.equal(init.method, "PUT");
      if (options.networkError) throw new Error("mock network failure");
      const status = options.status ?? 200;
      return { ok: status >= 200 && status < 300, status };
    },
    crypto: { randomUUID: () => "11111111-1111-1111-1111-111111111111" },
  });

  assert.equal(typeof exports.uploadFile?.handler, "function");

  const file = new MockFile(options.fileName ?? "example.png", contentType, bytes);
  const entries = { file, folder };
  if (options.ownerId) entries.ownerId = options.ownerId;
  if (options.originalSize !== undefined) entries.originalSize = String(options.originalSize);
  if (options.originalName !== undefined) entries.originalName = options.originalName;
  const data = { get: (key) => (Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : null) };
  const context = { userId: options.callerId ?? OWNER };

  const run = () => exports.uploadFile.handler({ data, context });
  return { run, calls };
}

test("successful PUT retains the profile quota reservation [confirms existing behavior]", async () => {
  const ctx = setup();
  const result = await ctx.run();
  assert.ok(result.key.startsWith(`${OWNER}/photo/`));
  assert.equal(result.fileName, "example.png");
  assert.equal(result.sizeBytes, PNG_BYTES.length);
  // reserve, then the stored PUT: no release at all.
  assert.deepEqual(ctx.calls, ["type-check", "owner", "reserve", "fence", "magic-check", "sign", "put"]);
});

test("invalid magic bytes release the reservation [confirms existing behavior]", async () => {
  // Real invalid bytes (not a forced throw): image/png whose header matches nothing.
  const ctx = setup({ bytes: JUNK_BYTES, contentType: "image/png" });
  await assert.rejects(ctx.run(), /Invalid file contents/);
  assert.deepEqual(ctx.calls, ["type-check", "owner", "reserve", "fence", "magic-check", "release"]);
});

test("signing failure releases the reservation [confirms existing behavior]", async () => {
  const ctx = setup({ signError: true });
  await assert.rejects(ctx.run(), /mock signing failure/);
  assert.deepEqual(ctx.calls, ["type-check", "owner", "reserve", "fence", "magic-check", "sign", "release"]);
});

test("reservation failure prevents the PUT and any release [confirms existing behavior]", async () => {
  // reserveProfileQuota is called outside the try, so its rejection propagates
  // directly: nothing was stored, so there is nothing to release.
  const ctx = setup({ reserveError: true });
  await assert.rejects(ctx.run(), /UPLOAD_LIMIT_PHOTOS/);
  assert.deepEqual(ctx.calls, ["type-check", "owner", "reserve"]);
  assert.ok(!ctx.calls.includes("put"), "no PUT may be attempted");
  assert.ok(!ctx.calls.includes("release"), "no release may be attempted for a rejected reservation");
});

// Every explicit non-2xx response retains the reservation: even a 4xx is not
// trusted to prove the object is absent once the PUT has been dispatched, so no
// status releases the slot. The member-facing error is unchanged.
for (const status of [400, 403, 404, 413, 500, 502, 503]) {
  test(`explicit ${status} PUT response retains the reservation [fail-closed fix]`, async () => {
    const ctx = setup({ status });
    await assert.rejects(ctx.run(), new RegExp(`Upload failed \\(${status}\\)`));
    assert.deepEqual(ctx.calls, ["type-check", "owner", "reserve", "fence", "magic-check", "sign", "put"]);
    assert.ok(!ctx.calls.includes("release"), "a non-2xx response must not release the reservation");
  });
}

test("explicit 4xx retains the reservation even when a release helper is available [fail-closed fix]", async () => {
  // A release helper that would fail proves the handler never calls it on the
  // non-2xx path; the original upload error is still what the member sees.
  const ctx = setup({ status: 403, releaseError: true });
  const error = await ctx.run().then(
    () => {
      throw new Error("handler unexpectedly resolved");
    },
    (err) => err,
  );
  assert.match(error.message, /Upload failed \(403\)/);
  assert.ok(!/release failure/.test(error.message), "no release failure may surface");
  assert.deepEqual(ctx.calls, ["type-check", "owner", "reserve", "fence", "magic-check", "sign", "put"]);
});

test("ambiguous network failure after the PUT begins retains the reservation [fail-closed fix]", async (t) => {
  // The PUT was dispatched (sign + fetch recorded) and then the transport
  // rejected. The handler cannot tell "never reached R2" from "R2 stored it but
  // the response was lost", so it must not release the reservation.
  const ctx = setup({ networkError: true });
  await assert.rejects(ctx.run(), /mock network failure/);
  assert.deepEqual(ctx.calls, ["type-check", "owner", "reserve", "fence", "magic-check", "sign", "put"]);
  assert.ok(!ctx.calls.includes("release"), "a dispatched PUT with a lost response must retain the reservation");
  t.diagnostic(
    "FIXED (fail-closed): the PUT was dispatched but its outcome is unknown, so the reservation is retained. " +
      "This removes the previous undercount where a possibly-stored object was released. If nothing was stored, " +
      "the counters drift HIGH until the next resync -- a temporary, recoverable loss of one slot -- instead of " +
      "LOW, which would let the real 6 photo / 5 document / 11 file / 20 MiB caps be exceeded.",
  );
});

test("failed quota release cannot mask the original upload error [confirms existing behavior]", async () => {
  // A release failure happens inside the catch and is swallowed; the original
  // upload error is what the caller sees.
  const ctx = setup({ bytes: JUNK_BYTES, contentType: "image/png", releaseError: true });
  const error = await ctx.run().then(
    () => {
      throw new Error("handler unexpectedly resolved");
    },
    (err) => err,
  );
  assert.match(error.message, /Invalid file contents/);
  assert.ok(!/release failure/.test(error.message), "the release failure must not surface");
  assert.deepEqual(ctx.calls, ["type-check", "owner", "reserve", "fence", "magic-check", "release"]);
});

test("non-profile upload bypasses profile quota reservation [confirms existing behavior]", async () => {
  const ctx = setup({ folder: "payment_proof", fileName: "proof.png" });
  const result = await ctx.run();
  assert.ok(result.key.startsWith(`${OWNER}/payment_proof/`));
  // No reserve and no release: non-profile folders carry no profile quota.
  assert.deepEqual(ctx.calls, ["type-check", "owner", "fence", "magic-check", "sign", "put"]);
});

test("a fenced key refuses the upload and releases the reservation [Finding 5]", async () => {
  // The fence probe is the object-creation safety net: if the generated key is
  // already tombstoned (or the probe is unavailable) nothing is dispatched and
  // the reservation is handed back.
  const ctx = setup({ fenceProbeFails: true });
  await assert.rejects(ctx.run(), /Cannot verify storage key availability/);
  assert.deepEqual(ctx.calls, ["type-check", "owner", "reserve", "fence", "release"]);
  assert.ok(!ctx.calls.includes("put"), "no PUT may be attempted for a fenced key");
  assert.ok(!ctx.calls.includes("magic-check"), "the probe runs before any content validation");
});
