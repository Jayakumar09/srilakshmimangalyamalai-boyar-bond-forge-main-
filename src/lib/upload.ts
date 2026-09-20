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

/** Compress (images -> WebP) then upload through our server to Cloudflare R2. */
export async function uploadToR2(file: File, folder: UploadFolder): Promise<UploadResult> {
  const { file: out, originalSize } = await compressImage(file);

  const form = new FormData();
  form.append("file", out, out.name);
  form.append("folder", folder);

  const result = await uploadFile({ data: form });

  return {
    key: result.key,
    fileName: result.fileName || out.name,
    mimeType: result.mimeType || out.type,
    sizeBytes: result.sizeBytes ?? out.size,
    originalSize,
  };
}
