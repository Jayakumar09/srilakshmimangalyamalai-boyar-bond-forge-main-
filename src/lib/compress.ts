/**
 * Client-side image/document compression and validation.
 * Photos and ID scans are validated by their content and converted to
 * high-quality WebP so uploads stay small while remaining crystal clear.
 * PDFs are validated by their magic bytes and passed through untouched —
 * they are NEVER run through image decoding.
 */

export type CompressedFile = {
  file: File;
  originalSize: number;
  finalSize: number;
};

export type UploadFileKind = "jpeg" | "png" | "pdf";

/**
 * Thrown when a file is chosen as an image but its bytes cannot be decoded
 * (corrupt/truncated file, renamed pseudo-image such as HEIC masquerading as
 * PNG, etc.). Callers surface a clear, localized message instead of Chrome's
 * raw "The source image could not be decoded." DOMException.
 */
export class ImageDecodeError extends Error {
  constructor() {
    super("This image could not be read. Please upload a valid JPG or PNG image.");
    this.name = "ImageDecodeError";
  }
}

/** Thrown when the file is not one of the supported types (JPG/PNG/PDF). */
export class UnsupportedFileTypeError extends Error {
  constructor() {
    super("Unsupported file type. Please upload JPG, PNG, or PDF.");
    this.name = "UnsupportedFileTypeError";
  }
}

/** Thrown when a file is chosen as a PDF but is not a valid PDF. */
export class InvalidPdfError extends Error {
  constructor() {
    super("This PDF could not be read. Please upload a valid PDF file.");
    this.name = "InvalidPdfError";
  }
}

/**
 * Server-recognized upload limit codes. The server rejects an upload by
 * throwing one of these strings (or a localized translation of it) and the
 * client maps them back to localized messages via `friendlyUploadError`.
 */
export const UPLOAD_LIMIT_PHOTOS = "UPLOAD_LIMIT_PHOTOS";
export const UPLOAD_LIMIT_DOCS = "UPLOAD_LIMIT_DOCS";
export const UPLOAD_LIMIT_TOTAL = "UPLOAD_LIMIT_TOTAL";
export const UPLOAD_LIMIT_STORAGE = "UPLOAD_LIMIT_STORAGE";
export const FILE_TOO_LARGE_PHOTO = "FILE_TOO_LARGE_PHOTO";
export const FILE_TOO_LARGE_DOC = "FILE_TOO_LARGE_DOC";
export const UTR_DUPLICATE = "UTR_DUPLICATE";
export const UTR_INVALID = "UTR_INVALID";
export const UTR_REQUIRED_BANK_TRANSFER = "UTR_REQUIRED_BANK_TRANSFER";

/** Maximum bytes actually stored for a member's profile files (counts + bytes). */
export const MAX_PHOTOS_PER_PROFILE = 6;
export const MAX_DOCS_PER_PROFILE = 5;
export const MAX_TOTAL_FILES_PER_PROFILE = 11;
export const MAX_PROFILE_STORAGE_BYTES = 20 * 1024 * 1024;
export const MAX_PHOTO_INPUT_BYTES = 3 * 1024 * 1024;
export const MAX_DOC_INPUT_BYTES = 5 * 1024 * 1024;

/** Upper bound for the calibrated photo optimization (kept ~150-500KB). */
const PHOTO_BYTE_TARGET = 500 * 1024;

/** Maps the upload validation errors to localized, user-facing messages. */
export function friendlyUploadError(err: unknown, t: (k: string) => string): string {
  if (err instanceof ImageDecodeError) return t("msg_img_decode_failed");
  if (err instanceof InvalidPdfError) return t("msg_pdf_invalid");
  if (err instanceof UnsupportedFileTypeError) return t("msg_file_unsupported");
  const msg = err instanceof Error ? err.message : String(err);
  switch (msg) {
    case UPLOAD_LIMIT_PHOTOS:
      return t("msg_limit_photos");
    case UPLOAD_LIMIT_DOCS:
      return t("msg_limit_docs");
    case UPLOAD_LIMIT_TOTAL:
      return t("msg_limit_total_files");
    case UPLOAD_LIMIT_STORAGE:
      return t("msg_limit_storage");
    case FILE_TOO_LARGE_PHOTO:
      return t("msg_photo_too_large");
    case FILE_TOO_LARGE_DOC:
      return t("msg_doc_too_large");
    case UTR_DUPLICATE:
      return t("utr_duplicate");
    case UTR_INVALID:
      return t("utr_invalid");
    case UTR_REQUIRED_BANK_TRANSFER:
      return t("utr_required");
    default:
      return msg;
  }
}

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

async function readHeaderBytes(file: File, n = 16): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, n).arrayBuffer());
}

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

/** Detects the real file type from the file's magic bytes, never the extension. */
export function detectFileKind(bytes: Uint8Array): UploadFileKind | null {
  if (startsWith(bytes, PDF_MAGIC)) return "pdf";
  if (startsWith(bytes, PNG_MAGIC)) return "png";
  if (startsWith(bytes, JPEG_MAGIC)) return "jpeg";
  return null;
}

/**
 * Validates a file by its actual content and returns the upload-ready file.
 * - JPG/PNG: signature + MIME checked, then compressed via the image pipeline.
 * - PDF: signature + MIME checked, then passed through unchanged (no image APIs).
 * - Anything else is rejected so renamed files cannot bypass validation.
 */
export async function prepareFileUpload(
  file: File,
  quality = 0.92,
): Promise<CompressedFile & { kind: UploadFileKind }> {
  const declared = file.type.trim();
  const kind = detectFileKind(await readHeaderBytes(file));

  if (kind === "pdf") {
    if (declared && declared !== "application/pdf") throw new UnsupportedFileTypeError();
    const out =
      declared === "application/pdf"
        ? file
        : new File([file], file.name, { type: "application/pdf" });
    return { file: out, kind, originalSize: file.size, finalSize: file.size };
  }

  if (kind === "jpeg" || kind === "png") {
    const allowed =
      kind === "jpeg"
        ? new Set(["image/jpeg", "image/jpg", "image/pjpeg"])
        : new Set(["image/png"]);
    const canonical = kind === "jpeg" ? "image/jpeg" : "image/png";
    if (declared && !allowed.has(declared)) throw new UnsupportedFileTypeError();
    const typed = declared ? file : new File([file], file.name, { type: canonical });
    const out = await compressImage(typed, quality, kind);
    return { ...out, kind };
  }

  if (declared === "application/pdf") throw new InvalidPdfError();
  if (declared.startsWith("image/")) throw new ImageDecodeError();
  throw new UnsupportedFileTypeError();
}

/**
 * Compresses an image to WebP. `kind` is optional for callers that have
 * already validated the file type; otherwise the existing MIME-based
 * pass-through applies. A file that cannot be decoded is rejected.
 *
 * The pipeline is quality-first: it keeps the largest sensible dimension and
 * drops the WebP quality in calibrated steps, stopping as soon as the result
 * fits the ~500KB target. Only the sharpest fitting result is returned, so a
 * crisp photo that already lands in range is NEVER crushed down to a tiny
 * 10-20KB file. If every attempt is larger than the original, the original is
 * kept unchanged to avoid bloat.
 */
export async function compressImage(
  file: File,
  quality = 0.92,
  kind?: UploadFileKind,
): Promise<CompressedFile> {
  if (!kind && !file.type.startsWith("image/")) {
    return { file, originalSize: file.size, finalSize: file.size };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageDecodeError();
  }

  try {
    const longEdge = Math.max(bitmap.width, bitmap.height);

    // Candidate render sizes, largest first so quality wins when it can.
    // The natural size is always tried; larger photos are downscaled in steps.
    const dims: { w: number; h: number }[] = [];
    if (longEdge <= 2000) {
      dims.push({ w: bitmap.width, h: bitmap.height });
    } else {
      for (const edge of [2000, 1600, 1200, 1000]) {
        if (edge >= longEdge) break;
        const scale = edge / longEdge;
        dims.push({
          w: Math.max(1, Math.round(bitmap.width * scale)),
          h: Math.max(1, Math.round(bitmap.height * scale)),
        });
      }
    }

    const qualitySteps = [quality, 0.84, 0.76, 0.68];
    let best: { blob: Blob; size: number } | null = null;

    for (const d of dims) {
      for (const q of qualitySteps) {
        const blob = await renderWebp(bitmap, d.w, d.h, q);
        if (!blob) continue;
        // Never store anything larger than what the user provided.
        if (blob.size >= file.size) continue;
        if (blob.size <= PHOTO_BYTE_TARGET) {
          return toWebpFile(blob, file);
        }
        if (blob.size < file.size && (!best || blob.size < best.size)) {
          best = { blob, size: blob.size };
        }
      }
    }

    if (best) {
      return toWebpFile(best.blob, file);
    }
    return { file, originalSize: file.size, finalSize: file.size };
  } finally {
    bitmap.close?.();
  }
}

function toWebpFile(blob: Blob, original: File): CompressedFile {
  const name = original.name.replace(/\.[^.]+$/, "") + ".webp";
  return {
    file: new File([blob], name, { type: "image/webp" }),
    originalSize: original.size,
    finalSize: blob.size,
  };
}

async function renderWebp(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  quality: number,
): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
  } catch {
    return null;
  }
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
}

const IMAGE_OPTIMIZE_TARGET_BYTES = 1 * 1024 * 1024;
const IMAGE_OPTIMIZE_QUALITIES = [0.92, 0.88, 0.84, 0.8, 0.76, 0.72, 0.68, 0.64, 0.6];
const IMAGE_OPTIMIZE_MIN_EDGE = 640;
const IMAGE_OPTIMIZE_SCALES = [1, 0.9, 0.8, 0.7, 0.6, 0.5];

type OptimizeRenderer = "image/jpeg" | "image/png";

type LadderResult = {
  /** First candidate that fits the 1 MB target and shrinks the input. */
  fit: Blob | null;
  /** First candidate in ladder order (size, then quality) that clears 3 MB. */
  best: Blob | null;
};

/**
 * Pre-upload optimization for oversized images (>1 MB) so the hard per-folder
 * safety gates (3 MB photos / 5 MB documents) always review a fitting input.
 *
 * Quality-first and dimension-conservative: candidates are encoded at the
 * ORIGINAL dimensions at high quality first and only drop in quality step by
 * step; the resolution is reduced proportionally (aspect ratio kept, never
 * stretched) only after the quality floor is reached and the image is still
 * over target. JPEG and photographic PNG input go straight to the
 * high-quality JPEG ladder. Transparent PNGs are never flattened; opaque
 * non-photographic PNGs (flat art, screenshots, scans) first try a lossless
 * PNG ladder so they stay PNG whenever that meets the target, with JPEG only
 * as a last resort. WebP input is optimized into the JPEG this app's
 * validation accepts. The first result that fits ~1 MB is returned as-is.
 * If 1 MB cannot be reached without severe loss, the least-reduced candidate
 * that still clears the existing 3 MB gate (full resolution first, quality
 * next) is kept and that gate decides. PDFs and non-images pass untouched.
 */
export async function optimizeLargeImage(file: File): Promise<File> {
  const header = await readHeaderBytes(file);
  const kind = detectFileKind(header);
  const isWebp = kind === null && isWebpBytes(header);
  if ((kind !== "jpeg" && kind !== "png" && !isWebp) || file.size <= IMAGE_OPTIMIZE_TARGET_BYTES) {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  try {
    if (!bitmap.width || !bitmap.height) return file;

    let pngFallback: Blob | null = null;
    if (kind === "png") {
      const transparent = hasTransparency(bitmap);
      // Alpha must never be flattened, and flat art/text stays lossless for as
      // long as it can meet the target — only photographic content skips this.
      if (transparent || !looksPhotographic(bitmap)) {
        const png = await runOptimizeLadder(bitmap, file, "image/png");
        if (png.fit) return toOptimizedFile(png.fit, file, "image/png");
        if (transparent) {
          return png.best ? toOptimizedFile(png.best, file, "image/png") : file;
        }
        // Opaque and still over target: try JPEG below before giving up.
        pngFallback = png.best;
      }
    }

    const jpeg = await runOptimizeLadder(bitmap, file, "image/jpeg");
    if (jpeg.fit) return toOptimizedFile(jpeg.fit, file, "image/jpeg");
    if (jpeg.best) return toOptimizedFile(jpeg.best, file, "image/jpeg");
    return pngFallback ? toOptimizedFile(pngFallback, file, "image/png") : file;
  } finally {
    bitmap.close?.();
  }
}

/**
 * Walks the quality ladder at each sensible scale (largest first) and stops at
 * the first candidate that fits the 1 MB target. When nothing fits, `best`
 * holds the first candidate the existing 3 MB gate would still accept — the
 * ladder enumerates full size before smaller sizes and high quality before
 * low quality, so the fallback is the least-reduced version that can still be
 * uploaded. Scales only shrink while both edges stay >= 640 px and the full
 * size is always tried first. PNG is lossless, so it renders once per scale.
 */
async function runOptimizeLadder(
  bitmap: ImageBitmap,
  source: File,
  mimeType: OptimizeRenderer,
): Promise<LadderResult> {
  const qualities: (number | null)[] = mimeType === "image/png" ? [null] : IMAGE_OPTIMIZE_QUALITIES;
  let best: Blob | null = null;

  for (const scale of IMAGE_OPTIMIZE_SCALES) {
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    if (scale < 1 && Math.min(width, height) < IMAGE_OPTIMIZE_MIN_EDGE) break;

    for (const quality of qualities) {
      const blob = await renderBlob(bitmap, width, height, mimeType, quality ?? undefined);
      if (!blob) continue;
      if (blob.size <= IMAGE_OPTIMIZE_TARGET_BYTES && blob.size < source.size) {
        return { fit: blob, best: null };
      }
      if (!best && blob.size < source.size && blob.size <= MAX_PHOTO_INPUT_BYTES) {
        best = blob;
      }
    }
  }
  return { fit: null, best };
}

function toOptimizedFile(blob: Blob, original: File, type: OptimizeRenderer): File {
  return new File([blob], original.name, { type });
}

/** Detects WebP by its RIFF/WEBP magic bytes, never by the extension. */
function isWebpBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  );
}

/**
 * Cheap content heuristic on a 128 px sample: photos keep producing new
 * colours as they are sampled down, while flat art, screenshots and scanned
 * text saturate long before half of the sampled pixels are unique colours.
 * Anything ambiguous counts as photographic (the JPEG-only behaviour).
 */
function looksPhotographic(bitmap: ImageBitmap): boolean {
  const sampleEdge = 128;
  const scale = Math.min(1, sampleEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return true;
  ctx.imageSmoothingQuality = "high";
  try {
    ctx.drawImage(bitmap, 0, 0, width, height);
  } catch {
    return true;
  }
  try {
    const { data } = ctx.getImageData(0, 0, width, height);
    const seen = new Set<number>();
    for (let i = 0; i + 3 < data.length; i += 4) {
      const r = data[i] ?? 255;
      const g = data[i + 1] ?? 255;
      const b = data[i + 2] ?? 255;
      seen.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
    }
    const sampled = width * height;
    return seen.size >= 1024 && seen.size * 2 >= sampled;
  } catch {
    return true;
  }
}

/** True when any pixel is fully or partially transparent. */
function hasTransparency(bitmap: ImageBitmap): boolean {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || !bitmap.width || !bitmap.height) return false;
  ctx.drawImage(bitmap, 0, 0);
  try {
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    for (let i = 3; i < data.length; i += 16) {
      if ((data[i] ?? 255) < 255) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function renderBlob(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  mimeType: OptimizeRenderer,
  quality?: number,
): Promise<Blob | null> {
  if (width > 16384 || height > 16384) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
  } catch {
    return null;
  }
  return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
}

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
