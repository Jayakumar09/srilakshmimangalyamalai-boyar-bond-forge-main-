import { compressImage } from "@/lib/compress";
import { uploadFile } from "@/lib/storage.functions";

export type UploadFolder = "photo" | "govt_id" | "divorce_doc" | "payment_proof" | "jathagam";

export type UploadResult = {
  key: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  originalSize: number;
};

/**
 * Compress (images -> WebP) then upload through our server to Cloudflare R2.
 * `ownerId` lets an admin upload on behalf of a client so the file is keyed
 * under the client's id and the client can open it later.
 */
export async function uploadToR2(
  file: File,
  folder: UploadFolder,
  ownerId?: string,
): Promise<UploadResult> {
  const { file: out, originalSize } = await compressImage(file);

  const form = new FormData();
  form.append("file", out, out.name);
  form.append("folder", folder);
  if (ownerId) form.append("ownerId", ownerId);

  const result = await uploadFile({ data: form });

  return {
    key: result.key,
    fileName: result.fileName || out.name,
    mimeType: result.mimeType || out.type,
    sizeBytes: result.sizeBytes ?? out.size,
    originalSize,
  };
}
