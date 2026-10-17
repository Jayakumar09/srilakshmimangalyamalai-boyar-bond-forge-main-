// slmm-upload-cap-tests.mjs
// ---------------------------------------------------------------------------
// Offline boundary tests for the client-side profile upload caps.
//
// The existing slmm-dashboard-upload-tests.mjs proves the *rejection* path for
// the 6-photo and 5-document caps. This suite pins the remaining branches and,
// critically, the exact boundary: a fully-used allowance is ALLOWED and one
// unit over is REFUSED.
//
//   DashboardPage.addPhoto     : photos >= 6, photos+docs >= 11, bytes > 20 MiB
//   DashboardPage.addDocument   : docs  >= 5, docs+photos >= 11, bytes > 20 MiB
//   RegisterWizard submit       : persistedDocs+new > 5, persisted+new+photo > 11
//
// Only the two handler closures and the RegisterWizard cap slice are extracted
// from source and transpiled; every dependency they touch is mocked. The cap
// numbers are read from the real src/lib/compress.ts, so a drift between the
// tests and production constants fails here.
//
// ISOLATION
//   Node built-ins only (node:assert/strict, node:fs, node:vm, node:test) plus
//   the local TypeScript compiler. No network, no database, no environment
//   file, no credentials, no external service.
//
// Run: node --test test-harness/slmm-upload-cap-tests.mjs
// ---------------------------------------------------------------------------
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

// ---- real cap constants (source of truth) ----------------------------------
const compress = readFileSync(new URL("../src/lib/compress.ts", import.meta.url), "utf8");
const constant = (name) => {
  const m = compress.match(new RegExp(`export const ${name} = ([^;]+);`));
  assert.ok(m, `${name} must be exported from compress.ts`);
  // Static, project-owned text; never user input.
  return Function(`"use strict";return (${m[1]});`)();
};

const MAX_PHOTOS = constant("MAX_PHOTOS_PER_PROFILE");
const MAX_DOCS = constant("MAX_DOCS_PER_PROFILE");
const MAX_TOTAL = constant("MAX_TOTAL_FILES_PER_PROFILE");
const MAX_BYTES = constant("MAX_PROFILE_STORAGE_BYTES");

test("C00 production cap constants are 6 / 5 / 11 / 20 MiB", () => {
  assert.equal(MAX_PHOTOS, 6);
  assert.equal(MAX_DOCS, 5);
  assert.equal(MAX_TOTAL, 11);
  assert.equal(MAX_BYTES, 20 * 1024 * 1024);
});

// ---------------------------------------------------------------------------
// DashboardPage.addPhoto / addDocument
// ---------------------------------------------------------------------------
const dashboard = readFileSync(new URL("../src/components/pages/DashboardPage.tsx", import.meta.url), "utf8");
const photoStart = dashboard.indexOf("const addPhoto = async");
const docStart = dashboard.indexOf("const addDocument = async", photoStart);
const removeStart = dashboard.indexOf("const removeFile = async", docStart);
assert.ok(
  photoStart >= 0 && docStart > photoStart && removeStart > docStart,
  "addPhoto/addDocument handlers must be located",
);
const photoSource = dashboard.slice(photoStart, docStart) + "\nexports.addPhoto = addPhoto;\n";
const docSource = dashboard.slice(docStart, removeStart) + "\nexports.addDocument = addDocument;\n";

// Pin the branches this suite is responsible for.
assert.match(photoSource, /photos\.length >= MAX_PHOTOS_PER_PROFILE/);
assert.match(photoSource, /photos\.length \+ docRows\.length >= MAX_TOTAL_FILES_PER_PROFILE/);
assert.match(photoSource, /usedBytes \+ file\.size > MAX_PROFILE_STORAGE_BYTES/);
assert.match(docSource, /docRows\.length >= MAX_DOCS_PER_PROFILE/);
assert.match(docSource, /docRows\.length \+ photos\.length >= MAX_TOTAL_FILES_PER_PROFILE/);
assert.match(docSource, /usedBytes \+ file\.size > MAX_PROFILE_STORAGE_BYTES/);

const KEY = "mock-owner/photo/example.png";

function setupDash(opts = {}) {
  const calls = { upload: [], insert: [], delete: [], toast: [], flags: [] };
  const sandbox = {
    photos: opts.photos ?? [],
    docRows: opts.docRows ?? [],
    usedBytes: opts.usedBytes ?? 0,
    MAX_PHOTOS_PER_PROFILE: MAX_PHOTOS,
    MAX_DOCS_PER_PROFILE: MAX_DOCS,
    MAX_TOTAL_FILES_PER_PROFILE: MAX_TOTAL,
    MAX_PROFILE_STORAGE_BYTES: MAX_BYTES,
    userId: "user-1",
    profile: { id: "user-1" },
    docKind: "Aadhaar",
    t: (key) => key,
    toast: {
      success: (m) => calls.toast.push(["success", m]),
      error: (m) => calls.toast.push(["error", m]),
    },
    setPhotoUploading: (v) => calls.flags.push(["photo", v]),
    setUploading: (v) => calls.flags.push(["doc", v]),
    console: { warn: () => {} },
    friendlyUploadError: (err) => `friendly:${err?.message ?? err}`,
    uploadToR2: async (_file, folder) => {
      calls.upload.push(folder);
      return { key: KEY, fileName: "example.png", mimeType: "image/png", sizeBytes: 1234 };
    },
    deleteUpload: async () => {},
    loadDocs: async () => {},
    supabase: {
      from() {
        return { insert: (row) => { calls.insert.push(row); return Promise.resolve({ error: null }); } };
      },
    },
  };
  const exports = {};
  for (const snippet of [photoSource, docSource]) {
    loadModuleInto(snippet, sandbox, exports);
  }
  assert.equal(typeof exports.addPhoto, "function");
  assert.equal(typeof exports.addDocument, "function");
  return { handlers: exports, calls };
}

function loadModuleInto(source, sandbox, exports) {
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(js, { ...sandbox, exports });
}

const errorKey = (calls) => {
  const err = calls.toast.find(([k]) => k === "error");
  return err ? err[1] : null;
};

const fileOf = (size) => ({ size });

// ---- addPhoto --------------------------------------------------------------
test("C01 addPhoto allows the 5th photo but refuses the 6th", async () => {
  const at = setupDash({ photos: Array.from({ length: MAX_PHOTOS - 1 }, (_, i) => i) });
  await at.handlers.addPhoto(fileOf(1000));
  assert.equal(at.calls.upload.length, 1, "the 5th photo must be allowed");

  const over = setupDash({ photos: Array.from({ length: MAX_PHOTOS }, (_, i) => i) });
  await over.handlers.addPhoto(fileOf(1000));
  assert.deepEqual(over.calls.upload, [], "the 6th photo must not upload");
  assert.equal(errorKey(over.calls), "msg_limit_photos");
});

test("C02 addPhoto allows the 10th total file but refuses the 11th", async () => {
  const at = setupDash({ photos: [], docRows: Array.from({ length: MAX_TOTAL - 1 }, (_, i) => i) });
  await at.handlers.addPhoto(fileOf(1000));
  assert.equal(at.calls.upload.length, 1, "10 existing files + 1 photo must be allowed");

  const over = setupDash({ photos: [], docRows: Array.from({ length: MAX_TOTAL }, (_, i) => i) });
  await over.handlers.addPhoto(fileOf(1000));
  assert.deepEqual(over.calls.upload, []);
  assert.equal(errorKey(over.calls), "msg_limit_total_files");
});

test("C03 addPhoto allows exactly 20 MiB and refuses one byte more", async () => {
  const size = 1000;
  const at = setupDash({ usedBytes: MAX_BYTES - size });
  await at.handlers.addPhoto(fileOf(size));
  assert.equal(at.calls.upload.length, 1, "used + size === cap must be allowed (strict >)");

  const over = setupDash({ usedBytes: MAX_BYTES - size + 1 });
  await over.handlers.addPhoto(fileOf(size));
  assert.deepEqual(over.calls.upload, []);
  assert.equal(errorKey(over.calls), "msg_limit_storage");
});

test("C04 addPhoto checks the photo cap before the total and byte caps", async () => {
  const ctx = setupDash({
    photos: Array.from({ length: MAX_PHOTOS }, (_, i) => i),
    docRows: Array.from({ length: MAX_TOTAL }, (_, i) => i),
    usedBytes: MAX_BYTES,
  });
  await ctx.handlers.addPhoto(fileOf(MAX_BYTES));
  assert.equal(errorKey(ctx.calls), "msg_limit_photos", "the photo-count error must win");
});

// ---- addDocument -----------------------------------------------------------
test("C05 addDocument allows the 4th document but refuses the 5th", async () => {
  const at = setupDash({ docRows: Array.from({ length: MAX_DOCS - 1 }, (_, i) => i) });
  await at.handlers.addDocument(fileOf(1000));
  assert.equal(at.calls.upload.length, 1);

  const over = setupDash({ docRows: Array.from({ length: MAX_DOCS }, (_, i) => i) });
  await over.handlers.addDocument(fileOf(1000));
  assert.deepEqual(over.calls.upload, []);
  assert.equal(errorKey(over.calls), "msg_limit_docs");
});

test("C06 addDocument allows the 10th total file but refuses the 11th", async () => {
  const at = setupDash({ docRows: [], photos: Array.from({ length: MAX_TOTAL - 1 }, (_, i) => i) });
  await at.handlers.addDocument(fileOf(1000));
  assert.equal(at.calls.upload.length, 1);

  const over = setupDash({ docRows: [], photos: Array.from({ length: MAX_TOTAL }, (_, i) => i) });
  await over.handlers.addDocument(fileOf(1000));
  assert.deepEqual(over.calls.upload, []);
  assert.equal(errorKey(over.calls), "msg_limit_total_files");
});

test("C07 addDocument allows exactly 20 MiB and refuses one byte more", async () => {
  const size = 1000;
  const at = setupDash({ usedBytes: MAX_BYTES - size });
  await at.handlers.addDocument(fileOf(size));
  assert.equal(at.calls.upload.length, 1);

  const over = setupDash({ usedBytes: MAX_BYTES - size + 1 });
  await over.handlers.addDocument(fileOf(size));
  assert.deepEqual(over.calls.upload, []);
  assert.equal(errorKey(over.calls), "msg_limit_storage");
});

// ---------------------------------------------------------------------------
// RegisterWizard submit cap slice
// ---------------------------------------------------------------------------
const wizard = readFileSync(new URL("../src/components/pages/RegisterWizard.tsx", import.meta.url), "utf8");
const capStart = wizard.indexOf("const optionalFiles = OPTIONAL_ID_KINDS.map(");
const capEnd = wizard.indexOf("setBusy(true);", capStart);
assert.ok(capStart >= 0 && capEnd > capStart, "RegisterWizard cap slice must be located");
const capSlice = wizard.slice(capStart, capEnd);
assert.match(capSlice, /persistedDocsOnly\.length \+ newDocCount > MAX_DOCS_PER_PROFILE/);
assert.match(capSlice, /persistedDocs\.length \+ newDocCount \+ \(photo \? 1 : 0\) > MAX_TOTAL_FILES_PER_PROFILE/);

const wizardSource = `function checkWizardCaps() {\n${capSlice}\nreturn "ok";\n}\nexports.checkWizardCaps = checkWizardCaps;\n`;

function runWizard(opts = {}) {
  const toast = [];
  const exports = loadModule(wizardSource, {
    OPTIONAL_ID_KINDS: [],
    optionalIds: {},
    idFile: opts.idFile === undefined ? { name: "id.png" } : opts.idFile,
    divorceFile: opts.divorceFile ?? null,
    persistedDocsOnly: opts.persistedDocsOnly ?? [],
    persistedDocs: opts.persistedDocs ?? [],
    photo: opts.photo ?? null,
    MAX_DOCS_PER_PROFILE: MAX_DOCS,
    MAX_TOTAL_FILES_PER_PROFILE: MAX_TOTAL,
    t: (key) => key,
    toast: { error: (m) => toast.push(m) },
  });
  const result = exports.checkWizardCaps();
  return { result, toast };
}

test("C08 RegisterWizard allows a 5th document (exactly 5) but refuses a 6th", () => {
  // idFile set, no optional/divorce files => newDocCount === 1.
  const at = runWizard({ persistedDocsOnly: Array.from({ length: MAX_DOCS - 1 }, (_, i) => i) });
  assert.equal(at.result, "ok", "4 persisted + 1 new === 5 must be allowed (strict >)");

  const over = runWizard({ persistedDocsOnly: Array.from({ length: MAX_DOCS }, (_, i) => i) });
  assert.equal(over.result, undefined);
  assert.deepEqual(over.toast, ["msg_limit_docs"]);
});

test("C09 RegisterWizard allows an 11th total file but refuses a 12th", () => {
  const at = runWizard({ persistedDocs: Array.from({ length: MAX_TOTAL - 1 }, (_, i) => i) });
  assert.equal(at.result, "ok", "10 persisted + 1 new === 11 must be allowed");

  const over = runWizard({ persistedDocs: Array.from({ length: MAX_TOTAL }, (_, i) => i) });
  assert.equal(over.result, undefined);
  assert.deepEqual(over.toast, ["msg_limit_total_files"]);
});

test("C10 RegisterWizard counts a pending photo toward the total cap", () => {
  const over = runWizard({
    persistedDocs: Array.from({ length: MAX_TOTAL - 1 }, (_, i) => i),
    photo: { name: "photo.webp" },
  });
  assert.equal(over.result, undefined, "10 persisted + 1 new + 1 photo === 12 must be refused");
  assert.deepEqual(over.toast, ["msg_limit_total_files"]);
});

test("C11 RegisterWizard checks the document cap before the total cap", () => {
  const both = runWizard({
    persistedDocsOnly: Array.from({ length: MAX_DOCS }, (_, i) => i),
    persistedDocs: Array.from({ length: MAX_TOTAL }, (_, i) => i),
  });
  assert.deepEqual(both.toast, ["msg_limit_docs"], "the document error must win");
});
