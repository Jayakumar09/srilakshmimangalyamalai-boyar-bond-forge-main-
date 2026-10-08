// image-opt-tests.mjs
// Offline tests for the automatic >1 MB image optimization in the upload flow.
// NO network, NO database, NO browser: the R2 server function is mocked, the
// i18n/toast modules are mocked, and the browser image APIs (createImageBitmap,
// canvas) are replaced by a deterministic byte-size model. The modules under
// test (src/lib/compress.ts + src/lib/upload.ts) are compiled for real with tsc.
// Run: node image-opt-tests.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), "slmm-image-opt-"));
const MB = 1024 * 1024;
const TARGET = 1 * MB;
const PHOTO_LIMIT = 3 * MB;

const results = [];
function check(caseNo, label, got, expected, extra = "") {
  const pass =
    Array.isArray(got) && Array.isArray(expected)
      ? JSON.stringify(got) === JSON.stringify(expected)
      : got === expected;
  results.push({ caseNo, pass, label });
  console.log(
    `${pass ? "PASS" : "FAIL"}  CASE ${caseNo} ${label} :: got=${JSON.stringify(got)} expected=${JSON.stringify(expected)} ${extra}`,
  );
}

// ---------------------------------------------------------------------------
// 1. Compile the modules under test. The "@/..." aliases do not resolve for a
//    bare tsc CLI run (TS2307 is expected) — upload.js rewrites them to the
//    mocks below, compress.js has no imports at all.
// ---------------------------------------------------------------------------
const tsc = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");
const tscRun = spawnSync(
  process.execPath,
  [
    tsc,
    "src/lib/upload.ts",
    "src/lib/compress.ts",
    "--outDir",
    BUILD,
    "--target",
    "ES2022",
    "--module",
    "ES2022",
    "--moduleResolution",
    "bundler",
    "--lib",
    "ES2022,DOM,DOM.Iterable",
    "--strict",
    "--skipLibCheck",
  ],
  { cwd: ROOT, encoding: "utf8" },
);
for (const emitted of ["compress.js", "upload.js"]) {
  if (!fs.existsSync(path.join(BUILD, emitted))) {
    console.error(`tsc did not emit ${emitted}\n${tscRun.stdout}\n${tscRun.stderr}`);
    process.exit(1);
  }
}
fs.writeFileSync(path.join(BUILD, "package.json"), '{ "type": "module" }\n');

// ---------------------------------------------------------------------------
// 2. Mocks: the server upload function, i18n and the toast library.
//    The storage mock mirrors the real gates in storage.functions.ts
//    (per-folder originalSize limit + 15 MB hard cap).
// ---------------------------------------------------------------------------
fs.writeFileSync(
  path.join(BUILD, "storage.functions.mock.js"),
  `export const uploads = [];
const PROFILE_FOLDERS = new Set(["photo", "govt_id", "divorce_doc"]);
export async function uploadFile({ data }) {
  const file = data.get("file");
  const folder = String(data.get("folder") ?? "");
  const originalSize = Number(data.get("originalSize") ?? file.size);
  if (PROFILE_FOLDERS.has(folder)) {
    const limit = folder === "photo" ? 3 * 1024 * 1024 : 5 * 1024 * 1024;
    if (originalSize > limit) {
      throw new Error(folder === "photo" ? "FILE_TOO_LARGE_PHOTO" : "FILE_TOO_LARGE_DOC");
    }
  }
  if (file.size > 15 * 1024 * 1024) throw new Error("File is too large (max 15 MB).");
  const record = {
    key: "owner/" + folder + "/1700000000000-00000000-0000-0000-0000-000000000000-" + file.name,
    fileName: String(data.get("originalName") ?? file.name),
    originalName: String(data.get("originalName") ?? file.name),
    originalSize,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
  };
  uploads.push({ folder, file, originalSize, record });
  return record;
}
`,
);
fs.writeFileSync(
  path.join(BUILD, "i18n.mock.js"),
  `export const dict = {
  upl_image_optimized: {
    en: "Image optimized for faster upload.",
    ta: "பதிவேற்றத்திற்காக படம் தானாகவே சுருக்கப்பட்டது.",
  },
};
export function getLocale() {
  return "en";
}
`,
);
fs.writeFileSync(
  path.join(BUILD, "sonner.mock.js"),
  `export const toastCalls = [];
const record = (level) => (message) => { toastCalls.push({ level, message }); };
export const toast = {
  info: record("info"),
  success: record("success"),
  error: record("error"),
  warning: record("warning"),
};
`,
);

// Rewrite the aliases in the compiled upload.js to point at the mocks.
const uploadPath = path.join(BUILD, "upload.js");
let uploadJs = fs.readFileSync(uploadPath, "utf8");
uploadJs = uploadJs
  .replaceAll('"@/lib/compress"', '"./compress.js"')
  .replaceAll('"@/lib/storage.functions"', '"./storage.functions.mock.js"')
  .replaceAll('"@/lib/i18n"', '"./i18n.mock.js"')
  .replaceAll('"sonner"', '"./sonner.mock.js"');
if (uploadJs.includes('"@/lib/') || uploadJs.includes('"sonner"')) {
  console.error("upload.js alias rewrite incomplete:\n" + uploadJs.slice(0, 600));
  process.exit(1);
}
fs.writeFileSync(uploadPath, uploadJs);

// ---------------------------------------------------------------------------
// 3. Fake image files. Bytes 0..15 carry the real magic number (that is all
//    detectFileKind reads); bytes 16..26 carry the mock metadata the fake
//    createImageBitmap/canvas read back:
//      [16..19] width u32be, [20..23] height u32be,
//      [24] flags (bit0 transparent, bit1 corrupt, bit2 flat),
//      [25..26] entropy * 1000 u16be (drives the encoded byte-size model).
// ---------------------------------------------------------------------------
const MAGIC = {
  jpeg: [0xff, 0xd8, 0xff, 0xe0],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  webp: [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d], // "%PDF-"
};
const MIME = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

function makeFile({ kind, width = 0, height = 0, flags = 0, entropy = 1, size, name }) {
  const bytes = new Uint8Array(size);
  bytes.set(MAGIC[kind], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = flags;
  view.setUint16(25, Math.min(65535, Math.round(entropy * 1000)));
  const ext = kind === "jpeg" ? "jpg" : kind;
  return new File([bytes], name ?? `sample-${kind}.${ext}`, { type: MIME[kind] });
}

async function readMeta(source) {
  const buf = new Uint8Array(await source.slice(16, 27).arrayBuffer());
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    width: view.getUint32(0),
    height: view.getUint32(4),
    flags: buf[8],
    entropy: view.getUint16(9) / 1000,
  };
}

// ---------------------------------------------------------------------------
// 4. Browser API mocks.
//    Encoded size model (deterministic):
//      PNG  = w * h * 1.5 * entropy            (lossless, quality-independent)
//      JPEG = w * h * 0.18 * entropy * q^3
//      WebP = JPEG * 0.8
//    Content model for getImageData: "flat" pixels come from a 4-colour
//    palette (screenshots/art), anything else yields unique colours (photos);
//    the transparent flag makes alpha < 255.
// ---------------------------------------------------------------------------
const encodeLog = [];
const decodeLog = { created: 0, decoded: 0 };

globalThis.createImageBitmap = async (source) => {
  decodeLog.created += 1;
  const meta = await readMeta(source);
  if (meta.flags & 2) throw new Error("mock: source image could not be decoded");
  decodeLog.decoded += 1;
  return { width: meta.width, height: meta.height, meta, close() {} };
};

function mockCanvas() {
  let active = null; // meta of the bitmap most recently drawn
  const ctx = {
    imageSmoothingQuality: "low",
    drawImage(bitmap) {
      if (bitmap && bitmap.meta) active = bitmap.meta;
    },
    getImageData(_x, _y, w, h) {
      const width = Math.max(1, Math.min(w, 256));
      const height = Math.max(1, Math.min(h, 256));
      const flat = active ? (active.flags & 4) !== 0 : false;
      const transparent = active ? (active.flags & 1) !== 0 : false;
      const data = new Uint8ClampedArray(width * height * 4);
      const palette = [
        [255, 255, 255],
        [0, 0, 0],
        [220, 40, 40],
        [40, 80, 220],
      ];
      for (let p = 0; p < width * height; p++) {
        const i = p * 4;
        if (flat) {
          const c = palette[p & 3];
          data[i] = c[0];
          data[i + 1] = c[1];
          data[i + 2] = c[2];
        } else {
          data[i] = (p * 13) & 255;
          data[i + 1] = (p * 29) & 255;
          data[i + 2] = (p * 7) & 255;
        }
        data[i + 3] = transparent ? 128 : 255;
      }
      return { data, width, height };
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toBlob(callback, type, quality) {
      const entropy = active ? active.entropy : 1;
      const w = canvas.width;
      const h = canvas.height;
      let size;
      if (type === "image/png") {
        size = Math.round(w * h * 1.5 * entropy);
      } else {
        const q = typeof quality === "number" ? quality : 0.92;
        const webpFactor = type === "image/webp" ? 0.8 : 1;
        size = Math.round(w * h * 0.18 * entropy * q * q * q * webpFactor);
      }
      encodeLog.push({ type, width: w, height: h, quality: quality ?? null, size });
      // The payload must look like a real file of that type so the downstream
      // validation (magic bytes) and any re-decode behave like in the browser.
      const bytes = new Uint8Array(size);
      const kind = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpeg";
      bytes.set(MAGIC[kind], 0);
      const view = new DataView(bytes.buffer);
      view.setUint32(16, w);
      view.setUint32(20, h);
      bytes[24] = 0;
      view.setUint16(25, Math.min(65535, Math.round(entropy * 1000)));
      callback(new Blob([bytes], { type }));
    },
  };
  return canvas;
}
globalThis.document = {
  createElement: (tag) => (tag === "canvas" ? mockCanvas() : null),
};

// ---------------------------------------------------------------------------
// 5. Load the modules under test (after the mocks are installed).
// ---------------------------------------------------------------------------
const { optimizeLargeImage, MAX_PHOTO_INPUT_BYTES } = await import(
  pathToFileURL(path.join(BUILD, "compress.js")).href
);
const { uploadToR2 } = await import(pathToFileURL(uploadPath).href);
const { uploads } = await import(pathToFileURL(path.join(BUILD, "storage.functions.mock.js")).href);
const { toastCalls } = await import(pathToFileURL(path.join(BUILD, "sonner.mock.js")).href);

function encodesSince(mark, predicate) {
  return encodeLog.slice(mark).filter(predicate ?? (() => true));
}
function lastEncode(mark) {
  return encodeLog[encodeLog.length - 1];
}
function resetToast() {
  toastCalls.length = 0;
}
function infoToasts() {
  return toastCalls.filter((c) => c.level === "info").map((c) => c.message);
}
function aspectRatio(w, h) {
  return h / w;
}

// ---- CASE 1: image < 1 MB -> untouched, no recompression, no notice --------
{
  const small = makeFile({ kind: "jpeg", width: 800, height: 600, size: 500 * 1024 });
  const mark = encodeLog.length;
  const out = await optimizeLargeImage(small);
  check(1, "sub-1MB image returned untouched (same object)", out, small);
  check(1, "no re-encode attempted for sub-1MB image", encodeLog.length - mark, 0);

  resetToast();
  const up = await uploadToR2(small, "photo");
  check(1, "sub-1MB upload succeeds", typeof up.key, "string");
  check(1, "no optimization notice for sub-1MB upload", infoToasts().length, 0);
}

// ---- CASE 2: slightly > 1 MB -> optimized below 1 MB, original dimensions --
{
  const img = makeFile({ kind: "jpeg", width: 1600, height: 1200, entropy: 1, size: 1.15 * MB });
  const mark = encodeLog.length;
  const out = await optimizeLargeImage(img);
  check(2, "1.15 MB image optimized to <= 1 MB", out.size <= TARGET, true, `size=${out.size}`);
  check(2, "output stays JPEG", out.type, "image/jpeg");
  check(2, "output smaller than input", out.size < img.size, true);
  const fit = lastEncode(mark);
  check(2, "encoded at the ORIGINAL dimensions", [fit.width, fit.height], [1600, 1200]);
  check(2, "encoded at the HIGHEST quality rung first", fit.quality, 0.92);

  resetToast();
  await uploadToR2(img, "photo");
  check(2, "member sees the optimization notice", infoToasts(), [
    "Image optimized for faster upload.",
  ]);
}

// ---- CASE 3: around 2 MB -> optimized below 1 MB, dimensions preserved -----
{
  const img = makeFile({ kind: "jpeg", width: 4000, height: 3000, entropy: 1, size: 2 * MB });
  const mark = encodeLog.length;
  const out = await optimizeLargeImage(img);
  check(3, "2 MB image optimized to <= 1 MB", out.size <= TARGET, true, `size=${out.size}`);
  const fit = lastEncode(mark);
  check(3, "quality dropped before any dimension change", [fit.width, fit.height], [4000, 3000]);
}

// ---- CASE 4: > 3 MB input -> optimized before the upload -------------------
{
  const img = makeFile({ kind: "jpeg", width: 4000, height: 3000, entropy: 1, size: 3.5 * MB });
  const before = decodeLog.decoded;
  resetToast();
  const up = await uploadToR2(img, "photo");
  check(4, "3.5 MB image decoded for optimization", decodeLog.decoded > before, true);
  check(4, "3.5 MB image uploads successfully after optimization", typeof up.key, "string");
  check(4, "optimization notice shown", infoToasts().length, 1);
  check(4, "stored object <= 1 MB", up.sizeBytes <= TARGET, true, `sizeBytes=${up.sizeBytes}`);
}

// ---- CASE 5: the existing 3 MB safety gate stays intact --------------------
{
  const corrupt = makeFile({
    kind: "jpeg",
    width: 4000,
    height: 3000,
    flags: 2, // undecodable
    size: 3.5 * MB,
  });
  const out = await optimizeLargeImage(corrupt);
  check(5, "undecodable image passes through unchanged", out, corrupt);
  let threw = null;
  try {
    await uploadToR2(corrupt, "photo");
  } catch (err) {
    threw = err.message;
  }
  check(
    5,
    "3 MB photo gate still rejects when optimization cannot help",
    threw,
    "FILE_TOO_LARGE_PHOTO",
  );

  check(5, "client photo limit constant unchanged", MAX_PHOTO_INPUT_BYTES, PHOTO_LIMIT);
  const serverSrc = fs.readFileSync(path.join(ROOT, "src/lib/storage.functions.ts"), "utf8");
  check(
    5,
    "server gate still checks originalSize against folder limit",
    /originalSize > inputLimit/.test(serverSrc),
    true,
  );
  check(
    5,
    "server gate still uses MAX_PHOTO_INPUT_BYTES",
    /MAX_PHOTO_INPUT_BYTES/.test(serverSrc),
    true,
  );
  check(5, "server 15 MB hard cap untouched", /15 \* 1024 \* 1024/.test(serverSrc), true);
  check(
    5,
    "server 3 MB gate not widened anywhere",
    (serverSrc.match(/MAX_PHOTO_INPUT_BYTES/g) ?? []).length >= 1,
    true,
  );
}

// ---- CASE 6: very small image -> no degradation ----------------------------
{
  const tiny = makeFile({ kind: "jpeg", width: 640, height: 480, size: 40 * 1024 });
  const mark = encodeLog.length;
  const out = await optimizeLargeImage(tiny);
  check(6, "tiny image returned untouched (same object)", out, tiny);
  check(6, "tiny image never re-encoded", encodeLog.length - mark, 0);
}

// ---- CASE 7: portrait image -> aspect ratio preserved ----------------------
{
  // Quality floor first: nothing fits at full size, then the ladder downscales
  // by 0.9 and fits at high-quality dimensions that keep the 3:4 ratio.
  const img = makeFile({ kind: "jpeg", width: 3000, height: 4000, entropy: 2.5, size: 4.2 * MB });
  const mark = encodeLog.length;
  const out = await optimizeLargeImage(img);
  const fit = lastEncode(mark);
  check(7, "portrait optimized to <= 1 MB", out.size <= TARGET, true, `size=${out.size}`);
  check(
    7,
    "portrait downscale keeps both edges proportional",
    [fit.width, fit.height],
    [2700, 3600],
  );
  const ratioOk = Math.abs(aspectRatio(fit.width, fit.height) - aspectRatio(3000, 4000)) < 0.005;
  check(7, "portrait aspect ratio unchanged (never stretched)", ratioOk, true);
}

// ---- CASE 8: landscape image -> aspect ratio preserved ---------------------
{
  const img = makeFile({ kind: "jpeg", width: 4000, height: 3000, entropy: 1, size: 2 * MB });
  const mark = encodeLog.length;
  const out = await optimizeLargeImage(img);
  const fit = lastEncode(mark);
  check(8, "landscape optimized to <= 1 MB", out.size <= TARGET, true, `size=${out.size}`);
  const ratioOk = Math.abs(aspectRatio(fit.width, fit.height) - aspectRatio(4000, 3000)) < 0.005;
  check(8, "landscape aspect ratio unchanged (never stretched)", ratioOk, true);
}

// ---- CASE 9: PNG input -> photographic JPEG, flat PNG kept PNG, alpha safe --
{
  const photoPng = makeFile({ kind: "png", width: 4000, height: 3000, entropy: 1, size: 2.5 * MB });
  const photoOut = await optimizeLargeImage(photoPng);
  check(9, "photographic PNG converted to high-quality JPEG", photoOut.type, "image/jpeg");
  check(
    9,
    "photographic PNG result <= 1 MB",
    photoOut.size <= TARGET,
    true,
    `size=${photoOut.size}`,
  );

  const flatPng = makeFile({
    kind: "png",
    width: 4000,
    height: 3000,
    flags: 4, // flat art / screenshot content
    entropy: 0.05,
    size: 4 * MB,
  });
  const flatMark = encodeLog.length;
  const flatOut = await optimizeLargeImage(flatPng);
  check(9, "flat/diagram PNG stays PNG", flatOut.type, "image/png");
  check(
    9,
    "flat/diagram PNG fits via lossless path",
    flatOut.size <= TARGET,
    true,
    `size=${flatOut.size}`,
  );
  const pngEncodes = encodesSince(flatMark, (e) => e.type === "image/png");
  check(
    9,
    "flat/diagram PNG encoded losslessly at full size",
    [pngEncodes[0].width, pngEncodes[0].height],
    [4000, 3000],
  );

  const alphaPng = makeFile({
    kind: "png",
    width: 1600,
    height: 1200,
    flags: 1, // transparency
    entropy: 0.3,
    size: 1.5 * MB,
  });
  const alphaOut = await optimizeLargeImage(alphaPng);
  check(9, "transparent PNG kept as PNG (alpha never flattened)", alphaOut.type, "image/png");
  check(
    9,
    "transparent PNG result <= 1 MB",
    alphaOut.size <= TARGET,
    true,
    `size=${alphaOut.size}`,
  );
}

// ---- CASE 10: government document / PDF is NOT converted to JPEG -----------
{
  const pdf = makeFile({ kind: "pdf", size: 2 * MB, name: "aadhaar.pdf" });
  const createdBefore = decodeLog.created;
  const mark = encodeLog.length;
  const out = await optimizeLargeImage(pdf);
  check(10, "PDF returned untouched (same object)", out, pdf);
  check(10, "PDF never sent through image decoding", decodeLog.created, createdBefore);
  check(10, "PDF never encoded as an image", encodeLog.length - mark, 0);

  const up = await uploadToR2(pdf, "govt_id");
  check(10, "PDF upload succeeds unchanged", up.sizeBytes, 2 * MB);
  const stored = uploads[uploads.length - 1];
  check(10, "stored object still a PDF", stored.file.type, "application/pdf");
}

// ---- CASE 11: the R2 object size matches the optimized upload --------------
{
  const img = makeFile({ kind: "jpeg", width: 4000, height: 3000, entropy: 1, size: 3.5 * MB });
  const up = await uploadToR2(img, "photo");
  const stored = uploads[uploads.length - 1];
  check(11, "PUT object size equals reported sizeBytes", stored.file.size, up.sizeBytes);
  check(
    11,
    "server record sizeBytes equals reported sizeBytes",
    stored.record.sizeBytes,
    up.sizeBytes,
  );
  check(
    11,
    "PUT object is the optimized file, not the 3.5 MB original",
    stored.file.size < img.size,
    true,
  );
  check(11, "PUT object <= 1 MB", stored.file.size <= TARGET, true, `size=${stored.file.size}`);
  check(11, "key reported to the caller is the R2 key", up.key, stored.record.key);
}

// ---- CASE 12: the Supabase document record matches the uploaded object -----
{
  const img = makeFile({ kind: "jpeg", width: 4000, height: 3000, entropy: 1, size: 2.5 * MB });
  const up = await uploadToR2(img, "photo");
  const stored = uploads[uploads.length - 1];
  // Exactly the fields DashboardPage.addPhoto inserts after a successful upload.
  const docRow = {
    doc_type: "photo",
    storage_key: up.key,
    file_name: up.fileName,
    mime_type: up.mimeType,
    size_bytes: up.sizeBytes,
  };
  check(12, "documents.size_bytes matches the stored object", docRow.size_bytes, stored.file.size);
  check(
    12,
    "documents.storage_key matches the stored object",
    docRow.storage_key,
    stored.record.key,
  );
  check(12, "documents.mime_type matches the stored object", docRow.mime_type, stored.file.type);

  const dashSrc = fs.readFileSync(
    path.join(ROOT, "src/components/pages/DashboardPage.tsx"),
    "utf8",
  );
  check(
    12,
    "DashboardPage still writes storage_key from the upload result",
    /storage_key:\s*up\.key/.test(dashSrc),
    true,
  );
  check(
    12,
    "DashboardPage still writes size_bytes from the upload result",
    /size_bytes:\s*up\.sizeBytes/.test(dashSrc),
    true,
  );
  check(
    12,
    "DashboardPage still writes mime_type from the upload result",
    /mime_type:\s*up\.mimeType/.test(dashSrc),
    true,
  );
}

// ---- CASE 13: WebP input -> optimized into the app's accepted JPEG format ---
{
  const webp = makeFile({ kind: "webp", width: 1600, height: 1200, entropy: 1, size: 1.5 * MB });
  const mark = encodeLog.length;
  const out = await optimizeLargeImage(webp);
  check(13, "oversized WebP optimized", out.size < webp.size, true, `size=${out.size}`);
  check(13, "oversized WebP emitted as accepted JPEG", out.type, "image/jpeg");
  check(13, "WebP result <= 1 MB", out.size <= TARGET, true);
  check(
    13,
    "never re-encoded as WebP",
    encodesSince(mark, (e) => e.type === "image/webp").length,
    0,
  );

  const smallWebp = makeFile({ kind: "webp", width: 800, height: 600, size: 500 * 1024 });
  const outSmall = await optimizeLargeImage(smallWebp);
  check(13, "sub-1MB WebP returned untouched", outSmall, smallWebp);
}

// ---- CASE 14: cannot reach 1 MB -> best-quality version, gate decides ------
{
  const img = makeFile({ kind: "jpeg", width: 1000, height: 800, entropy: 55, size: 7 * MB });
  const out = await optimizeLargeImage(img);
  // Expected: the first ladder candidate that is smaller than the input and
  // still clears the 3 MB gate -> full size at quality 0.72 of the model.
  const expectedSize = Math.round(1000 * 800 * 0.18 * 55 * 0.72 * 0.72 * 0.72);
  check(
    14,
    "best-quality fallback keeps the full resolution",
    out.size >= 2.5 * MB,
    true,
    `size=${out.size}`,
  );
  check(
    14,
    "fallback is the first gate-clearing candidate",
    Math.abs(out.size - expectedSize) <= 10,
    true,
    `size=${out.size} expected=${expectedSize}`,
  );
  check(14, "fallback still clears the 3 MB gate", out.size <= PHOTO_LIMIT, true);
  const up = await uploadToR2(img, "photo");
  check(14, "upload still proceeds with the best-quality version", typeof up.key, "string");
}

// ---- extra: the user-facing notice key exists in the real dictionary -------
{
  const i18nSrc = fs.readFileSync(path.join(ROOT, "src/lib/i18n.tsx"), "utf8");
  check(
    "i18n",
    "upl_image_optimized key exists with en + ta entries",
    /upl_image_optimized:\s*\{\s*en:\s*"[^"]+",\s*ta:\s*"[^"]+",\s*\}/.test(i18nSrc),
    true,
  );
}

// ---------------------------------------------------------------------------
// 6. Cleanup + summary.
// ---------------------------------------------------------------------------
const cleanup = () => {
  try {
    fs.rmSync(BUILD, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
};
process.on("exit", cleanup);
cleanup();
const failed = results.filter((x) => !x.pass);
console.log("----------------------------------------");
console.log(`IMAGE OPT TESTS: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
