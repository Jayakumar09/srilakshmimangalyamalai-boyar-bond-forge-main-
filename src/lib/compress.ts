/**
 * Client-side image/document compression.
 * Photos and ID scans are converted to high-quality WebP so uploads stay small
 * while remaining crystal clear. Non-image files (PDF) are passed through.
 */

export type CompressedFile = {
  file: File;
  originalSize: number;
  finalSize: number;
};

const MAX_EDGE = 2000;

export async function compressImage(file: File, quality = 0.92): Promise<CompressedFile> {
  if (!file.type.startsWith("image/")) {
    return { file, originalSize: file.size, finalSize: file.size };
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { file, originalSize: file.size, finalSize: file.size };
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", quality),
  );
  if (!blob || blob.size >= file.size) {
    return { file, originalSize: file.size, finalSize: file.size };
  }

  const name = file.name.replace(/\.[^.]+$/, "") + ".webp";
  return {
    file: new File([blob], name, { type: "image/webp" }),
    originalSize: file.size,
    finalSize: blob.size,
  };
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
