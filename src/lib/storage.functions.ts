import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";
import {
  MAX_DOC_INPUT_BYTES,
  MAX_DOCS_PER_PROFILE,
  MAX_PHOTO_INPUT_BYTES,
  MAX_PHOTOS_PER_PROFILE,
  MAX_PROFILE_STORAGE_BYTES,
  MAX_TOTAL_FILES_PER_PROFILE,
  FILE_TOO_LARGE_PHOTO,
  FILE_TOO_LARGE_DOC,
  UPLOAD_LIMIT_PHOTOS,
  UPLOAD_LIMIT_DOCS,
  UPLOAD_LIMIT_TOTAL,
  UPLOAD_LIMIT_STORAGE,
} from "@/lib/compress";

const UploadInput = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.string().min(1).max(120),
  folder: z.enum(["photo", "govt_id", "divorce_doc", "payment_proof", "jathagam", "attachment"]),
  ownerId: z.string().uuid().optional(),
});

/**
 * Files belong to whoever owns them so the member can always open their own
 * documents later. When an admin uploads on behalf of a client they pass
 * `ownerId` (the client's profile id); we require admin rights and that the
 * target profile actually exists so no one can stash files under an arbitrary id.
 */
async function resolveOwnerPrefix(
  context: { userId: string; supabase: SupabaseClient<Database> },
  ownerId?: string,
): Promise<string> {
  if (!ownerId) return context.userId;
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Not allowed");
  const { data: profile } = await context.supabase
    .from("profiles")
    .select("id")
    .eq("id", ownerId)
    .maybeSingle();
  if (!profile) throw new Error("Target profile does not exist.");
  return ownerId;
}

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

/** Only photos/scans and PDFs are permitted; rejects scripts/executables. */
const ACCEPTED_TYPE_PREFIXES = ["image/", "application/pdf"] as const;

function assertAllowedType(contentType: string) {
  if (!ACCEPTED_TYPE_PREFIXES.some((prefix) => contentType.startsWith(prefix))) {
    throw new Error("Unsupported file type.");
  }
}

/** Magic bytes for the raster formats the app actually stores (incl. WebP from compression). */
const IMAGE_MAGICS = [
  [0xff, 0xd8, 0xff], // jpeg
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], // png
  [0x52, 0x49, 0x46, 0x46], // RIFF (webp)
  [0x47, 0x49, 0x46], // gif
  [0x42, 0x4d], // bmp
] as const;

/** "%PDF-" */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;

function startsWithBytes(buf: Uint8Array, magic: readonly number[]): boolean {
  if (buf.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buf[i] !== magic[i]) return false;
  }
  return true;
}

/** Rejects uploads whose declared content type does not match the actual bytes. */
function assertValidMagicBytes(contentType: string, buf: Uint8Array) {
  if (contentType === "application/pdf") {
    if (!startsWithBytes(buf, PDF_MAGIC)) throw new Error("Invalid file contents.");
    return;
  }
  if (contentType.startsWith("image/") && !IMAGE_MAGICS.some((m) => startsWithBytes(buf, m))) {
    throw new Error("Invalid file contents.");
  }
}

async function signR2(key: string, method: "PUT" | "GET" | "DELETE", contentType?: string) {
  const accountId = process.env["R2_ACCOUNT_ID"];
  const accessKeyId = process.env["R2_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["R2_SECRET_ACCESS_KEY"];
  const bucket = process.env["R2_BUCKET_NAME"];
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("Cloud storage is not configured yet.");
  }
  const { AwsClient } = await import("aws4fetch");
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
  const url = new URL(
    `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}?X-Amz-Expires=900`,
  );
  const signed = await client.sign(
    new Request(url, { method, headers: contentType ? { "content-type": contentType } : {} }),
    { aws: { signQuery: true } },
  );
  return signed.url;
}

/** Returns a short-lived direct upload URL for Cloudflare R2. */
export const createUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UploadInput.parse(input))
  .handler(async ({ data, context }) => {
    assertAllowedType(data.contentType);
    const key = `${await resolveOwnerPrefix(context, data.ownerId)}/${data.folder}/${Date.now()}-${sanitize(data.fileName)}`;
    const uploadUrl = await signR2(key, "PUT", data.contentType);
    return { key, uploadUrl };
  });

const FOLDERS = [
  "photo",
  "govt_id",
  "divorce_doc",
  "payment_proof",
  "jathagam",
  "attachment",
] as const;
const PROFILE_FOLDERS = new Set(["photo", "govt_id", "divorce_doc"]);

/**
 * Uploads a file through the server to Cloudflare R2.
 * Used instead of a direct browser PUT so the bucket needs no CORS rules.
 *
 * Files tied to a member's profile (photos / identity / divorce documents)
 * are enforced against the profile limits: at most 6 photos, 4 documents,
 * 10 total files and 20MB of stored bytes. Payment proofs and horoscope
 * reports keep the generic 15MB cap since they are not part of the profile.
 */
export const uploadFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    if (!(input instanceof FormData)) throw new Error("Invalid upload request.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const file = data.get("file");
    const folder = String(data.get("folder") ?? "");
    const ownerId = String(data.get("ownerId") ?? "") || undefined;
    if (!(file instanceof File)) throw new Error("No file received.");
    if (!(FOLDERS as readonly string[]).includes(folder)) throw new Error("Invalid folder.");
    if (ownerId !== undefined && !/^[0-9a-fA-F-]{36}$/.test(ownerId)) {
      throw new Error("Invalid owner.");
    }

    const contentType = file.type || "application/octet-stream";
    assertAllowedType(contentType);

    const owner = await resolveOwnerPrefix(context, ownerId);
    const originalSize = Number(data.get("originalSize") ?? file.size);
    const originalName = String(data.get("originalName") ?? file.name ?? "file").slice(0, 200);

    if (PROFILE_FOLDERS.has(folder)) {
      const inputLimit = folder === "photo" ? MAX_PHOTO_INPUT_BYTES : MAX_DOC_INPUT_BYTES;
      if (originalSize > inputLimit) {
        throw new Error(folder === "photo" ? FILE_TOO_LARGE_PHOTO : FILE_TOO_LARGE_DOC);
      }

      const { data: rows } = await context.supabase
        .from("documents")
        .select("doc_type, size_bytes")
        .eq("user_id", owner);
      let photoCount = 0;
      let docCount = 0;
      let totalBytes = 0;
      for (const row of rows ?? []) {
        if (row.doc_type === "photo") photoCount++;
        else docCount++;
        totalBytes += row.size_bytes ?? 0;
      }

      if (folder === "photo" && photoCount >= MAX_PHOTOS_PER_PROFILE) {
        throw new Error(UPLOAD_LIMIT_PHOTOS);
      }
      if (folder !== "photo" && docCount >= MAX_DOCS_PER_PROFILE) {
        throw new Error(UPLOAD_LIMIT_DOCS);
      }
      if (photoCount + docCount >= MAX_TOTAL_FILES_PER_PROFILE) {
        throw new Error(UPLOAD_LIMIT_TOTAL);
      }
      if (totalBytes + file.size > MAX_PROFILE_STORAGE_BYTES) {
        throw new Error(UPLOAD_LIMIT_STORAGE);
      }
    }
    if (file.size > 15 * 1024 * 1024) throw new Error("File is too large (max 15 MB).");

    const body = new Uint8Array(await file.arrayBuffer());
    assertValidMagicBytes(contentType, body);
    const key = `${owner}/${folder}/${Date.now()}-${sanitize(file.name || "file")}`;
    const uploadUrl = await signR2(key, "PUT", contentType);
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": contentType },
      body,
    });
    if (!res.ok) throw new Error(`Upload failed (${res.status}).`);
    return {
      key,
      fileName: originalName,
      originalName,
      originalSize,
      mimeType: contentType,
      sizeBytes: file.size,
    };
  });

/**
 * Deletes a stored file: removes the R2 object, the `documents` row and the
 * profile photo pointer if the deleted file was the primary photo. Owners can
 * delete their own files; admins can delete any file. Counts and stored bytes
 * therefore decrease so a member can free up quota.
 */
export const deleteUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ key: z.string().min(1).max(300) }).parse(input))
  .handler(async ({ data, context }) => {
    let allowed = data.key.startsWith(`${context.userId}/`);
    if (!allowed) {
      const { data: isAdmin } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      allowed = !!isAdmin;
    }
    if (!allowed) throw new Error("Not allowed");

    const { data: rows } = await context.supabase
      .from("documents")
      .select("user_id, doc_type")
      .eq("storage_key", data.key);
    const row = rows?.[0];

    if (row) {
      const { error: delError } = await context.supabase
        .from("documents")
        .delete()
        .eq("storage_key", data.key);
      if (delError) throw delError;

      if (row.doc_type === "photo") {
        const { data: profile } = await context.supabase
          .from("profiles")
          .select("photo_url")
          .eq("id", row.user_id)
          .maybeSingle();
        if (profile?.photo_url === data.key) {
          await context.supabase.from("profiles").update({ photo_url: null }).eq("id", row.user_id);
        }
      }
    }

    // Best-effort removal of the R2 object so storage is freed.
    try {
      const delUrl = await signR2(data.key, "DELETE");
      await fetch(delUrl, { method: "DELETE" });
    } catch {
      // The metadata row is already gone; R2 cleanup is retried on next delete.
    }

    return { ok: true };
  });

/** Returns a short-lived view URL. Owners and admins only. */
export const createViewUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ key: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    let ownsFile = data.key.startsWith(`${context.userId}/`);
    if (!ownsFile) {
      // Horoscope reports are uploaded by the admin but belong to the member who ordered them.
      const { data: report } = await context.supabase
        .from("jathagam_requests")
        .select("id")
        .eq("report_key", data.key)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (report) ownsFile = true;
    }
    if (!ownsFile) {
      const { data: isAdmin } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      if (!isAdmin) throw new Error("Not allowed");
    }
    return { url: await signR2(data.key, "GET") };
  });
