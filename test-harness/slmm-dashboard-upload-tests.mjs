// Offline regression for the DashboardPage upload handlers.
//
// Only the `addPhoto` and `addDocument` closures are extracted from the
// component source and transpiled; every dependency they touch (Supabase,
// upload, delete, reload, toasts, quota limits) is mocked. No Vite config,
// environment files, Supabase, R2 or network access.
//
// The behaviour under test: object cleanup must run only when the `documents`
// INSERT itself fails, never when a later operation (for example the reload of
// the document list) fails after a successful insert.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/components/pages/DashboardPage.tsx", import.meta.url),
  "utf8",
);

const photoStart = source.indexOf("const addPhoto = async");
const docStart = source.indexOf("const addDocument = async", photoStart);
const removeStart = source.indexOf("const removeFile = async", docStart);
assert.ok(
  photoStart >= 0 && docStart > photoStart && removeStart > docStart,
  "addPhoto/addDocument handlers must be located",
);

// Only the handler bodies are used; a trailing export makes them addressable.
const photoSource = source.slice(photoStart, docStart) + "\nexports.addPhoto = addPhoto;\n";
const docSource = source.slice(docStart, removeStart) + "\nexports.addDocument = addDocument;\n";

// Guards that the harness is exercising the corrected control flow.
assert.match(photoSource, /persisted = true/);
assert.match(docSource, /persisted = true/);
assert.match(photoSource, /if \(up\?\.key && !persisted\)/);
assert.match(docSource, /if \(up\?\.key && !persisted\)/);

const USER = "user-1";
const KEY = "mock-owner/photo/example.png";
const FACTS = { size: 1000 };
const MAX_PHOTOS = 6;
const MAX_DOCS = 5;
const MAX_TOTAL = 11;
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Builds a fresh set of mocked dependencies, loads both handlers into an
 * isolated VM context and returns them with the recorded calls.
 */
function setup(opts = {}) {
  const calls = {
    upload: [],
    insert: [],
    delete: [],
    loadDocs: [],
    toast: [],
    warn: [],
    friendly: [],
    flags: [],
  };

  const uploadResult = opts.uploadResult ?? {
    key: KEY,
    fileName: "example.png",
    mimeType: "image/png",
    sizeBytes: 1234,
  };
  const insertResult = opts.insertResult ?? { error: null };

  const sandbox = {
    photos: opts.photos ?? [],
    docRows: opts.docRows ?? [],
    usedBytes: opts.usedBytes ?? 0,
    MAX_PHOTOS_PER_PROFILE: MAX_PHOTOS,
    MAX_DOCS_PER_PROFILE: MAX_DOCS,
    MAX_TOTAL_FILES_PER_PROFILE: MAX_TOTAL,
    MAX_PROFILE_STORAGE_BYTES: MAX_BYTES,
    userId: opts.userId === undefined ? USER : opts.userId,
    profile: opts.profile === undefined ? { id: USER } : opts.profile,
    docKind: "Aadhaar",
    t: (key) => key,
    toast: {
      success: (message) => calls.toast.push(["success", message]),
      error: (message) => calls.toast.push(["error", message]),
    },
    setPhotoUploading: (value) => calls.flags.push(["photo", value]),
    setUploading: (value) => calls.flags.push(["doc", value]),
    console: { warn: (...args) => calls.warn.push(args) },
    friendlyUploadError: (err) => {
      calls.friendly.push(err);
      return `friendly:${err?.message ?? err}`;
    },
    uploadToR2: async (_file, folder) => {
      calls.upload.push(folder);
      if (opts.uploadError) throw opts.uploadError;
      return uploadResult;
    },
    deleteUpload: async ({ data: { key } }) => {
      calls.delete.push(key);
      if (opts.cleanupError) throw opts.cleanupError;
    },
    loadDocs: async (id) => {
      calls.loadDocs.push(id);
      if (opts.reloadError) throw opts.reloadError;
    },
    supabase: {
      from(table) {
        assert.equal(table, "documents");
        return {
          insert(row) {
            calls.insert.push(row);
            return Promise.resolve(insertResult);
          },
        };
      },
    },
  };

  const exports = {};
  for (const snippet of [photoSource, docSource]) {
    const js = ts.transpileModule(snippet, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(js, { ...sandbox, exports });
  }
  assert.equal(typeof exports.addPhoto, "function");
  assert.equal(typeof exports.addDocument, "function");
  return { handlers: exports, calls };
}

const hasToast = (calls, kind) => calls.toast.some(([k]) => k === kind);

// Each scenario is exercised against both upload handlers.
const handlers = [
  { name: "addPhoto", folder: "photo" },
  { name: "addDocument", folder: "govt_id" },
];

for (const { name, folder } of handlers) {
  test(`${name}: successful INSERT + failed reload must NOT delete the persisted object`, async () => {
    const reloadError = new Error("reload failed");
    const { handlers: fn, calls } = setup({ reloadError });

    await fn[name]({ ...FACTS });

    assert.equal(calls.upload.length, 1);
    assert.equal(calls.upload[0], folder);
    assert.equal(calls.insert.length, 1);
    assert.deepEqual(calls.delete, []);
    assert.deepEqual(calls.loadDocs, [USER]);
    assert.ok(hasToast(calls, "success"), "a persisted upload still reports success");
    assert.equal(calls.friendly[0], reloadError, "the reload failure is still reported");
  });

  test(`${name}: failed INSERT + successful cleanup deletes the orphaned object`, async () => {
    const insertError = new Error("insert failed");
    const { handlers: fn, calls } = setup({ insertResult: { error: insertError } });

    await fn[name]({ ...FACTS });

    assert.equal(calls.insert.length, 1);
    assert.deepEqual(calls.delete, [KEY]);
    assert.deepEqual(calls.loadDocs, []);
    assert.equal(calls.friendly[0], insertError);
    assert.ok(hasToast(calls, "error"));
  });

  test(`${name}: failed INSERT + failed cleanup preserves the original error`, async () => {
    const insertError = new Error("insert failed");
    const { handlers: fn, calls } = setup({
      insertResult: { error: insertError },
      cleanupError: new Error("cleanup failed"),
    });

    await fn[name]({ ...FACTS });

    assert.deepEqual(calls.delete, [KEY]);
    assert.equal(calls.warn.length, 1, "the cleanup failure is warned about, not rethrown");
    assert.equal(calls.friendly[0], insertError, "the INSERT error is the one surfaced");
    assert.ok(hasToast(calls, "error"));
  });

  test(`${name}: successful INSERT + successful reload deletes nothing`, async () => {
    const { handlers: fn, calls } = setup();

    await fn[name]({ ...FACTS });

    assert.deepEqual(calls.delete, []);
    assert.deepEqual(calls.loadDocs, [USER]);
    assert.ok(hasToast(calls, "success"));
    assert.equal(hasToast(calls, "error"), false);
  });

  test(`${name}: upload failure before INSERT deletes nothing`, async () => {
    const uploadError = new Error("upload failed");
    const { handlers: fn, calls } = setup({ uploadError });

    await fn[name]({ ...FACTS });

    assert.deepEqual(calls.upload, [folder]);
    assert.deepEqual(calls.insert, []);
    assert.deepEqual(calls.delete, []);
    assert.deepEqual(calls.loadDocs, []);
    assert.equal(calls.friendly[0], uploadError);
    assert.ok(hasToast(calls, "error"));
  });

  test(`${name}: pre-upload quota limit is rejected before any upload`, async () => {
    const opts =
      name === "addPhoto"
        ? { photos: Array.from({ length: MAX_PHOTOS }, (_, i) => i) }
        : { docRows: Array.from({ length: MAX_DOCS }, (_, i) => i) };
    const { handlers: fn, calls } = setup(opts);

    await fn[name]({ ...FACTS });

    assert.deepEqual(calls.upload, []);
    assert.deepEqual(calls.insert, []);
    assert.deepEqual(calls.delete, []);
    assert.deepEqual(calls.flags, [], "the uploading flag is never touched on an early return");
    assert.ok(hasToast(calls, "error"));
  });
}
