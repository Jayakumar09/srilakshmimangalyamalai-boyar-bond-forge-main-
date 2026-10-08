import {
  MAX_DOC_INPUT_BYTES,
  MAX_PHOTO_INPUT_BYTES,
  FILE_TOO_LARGE_PHOTO,
  FILE_TOO_LARGE_DOC,
} from "@/lib/compress";
import { prepareFileUpload, optimizeLargeImage } from "@/lib/compress";
import { dict, getLocale } from "@/lib/i18n";
import { uploadFile } from "@/lib/storage.functions";
import { toast } from "sonner";

export type UploadFolder =
  "photo" | "govt_id" | "divorce_doc" | "payment_proof" | "jathagam" | "attachment";

export type UploadResult = {
  key: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  originalSize: number;
};

const PROFILE_UPLOAD_FOLDERS = new Set<UploadFolder>(["photo", "govt_id", "divorce_doc"]);

/**
 * Validate (by content), compress (images -> WebP, PDFs untouched), then upload
 * through our server to Cloudflare R2. `ownerId` lets an admin upload on behalf
 * of a client so the file is keyed under the client's id and the client can
 * open it later. PDFs never pass through image decoding.
 */
export async function uploadToR2(
  file: File,
  folder: UploadFolder,
  ownerId?: string,
): Promise<UploadResult> {
  // Oversized images (>1 MB) are optimized automatically (<= ~1 MB target)
  // before the hard per-folder safety gates, so members never see a raw size
  // rejection for a photo the pipeline can handle. Detection is by content, so
  // PDFs and other documents pass through untouched, and the member only hears
  // about it when the file actually shrank.
  const optimized = await optimizeLargeImage(file);
  if (optimized.size < file.size) {
    file = optimized;
    const notice = dict["upl_image_optimized"];
    if (notice) toast.info(notice[getLocale()]);
  }

  if (PROFILE_UPLOAD_FOLDERS.has(folder)) {
    const limit = folder === "photo" ? MAX_PHOTO_INPUT_BYTES : MAX_DOC_INPUT_BYTES;
    if (file.size > limit) {
      throw new Error(folder === "photo" ? FILE_TOO_LARGE_PHOTO : FILE_TOO_LARGE_DOC);
    }
  }

  const { file: out, originalSize } = await prepareFileUpload(file);

  const form = new FormData();
  form.append("file", out, out.name);
  form.append("folder", folder);
  form.append("originalName", file.name);
  form.append("originalSize", String(file.size));
  if (ownerId) form.append("ownerId", ownerId);

  const result = await uploadFile({ data: form });

  return {
    key: result.key,
    // Keep the member's original filename for display, not the .webp one.
    fileName: result.fileName || file.name,
    mimeType: result.mimeType || out.type,
    sizeBytes: result.sizeBytes ?? out.size,
    originalSize,
  };
}
