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

/**
 * Bytes actually stored under an owner's R2 prefix.
 *
 * Quota must not be summed from `documents.size_bytes`: those rows are inserted
 * by the client, so a member can report 0 for a real 15MB object and keep
 * filling the bucket. R2 is the only party that knows how large an object
 * really is, so we ask it directly instead of trusting the database. Listing by
 * prefix also counts objects that have no row yet, which closes the same hole
 * reached by simply skipping the insert.
 *
 * Fails closed: if the listing cannot be read we must not fall back to a
 * client-supplied number, so a storage error rejects the upload instead.
 */
async function r2OwnerBytes(owner: string): Promise<number> {
  const accountId = process.env["R2_ACCOUNT_ID"];
  const accessKeyId = process.env["R2_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["R2_SECRET_ACCESS_KEY"];
  const bucket = process.env["R2_BUCKET_NAME"];
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("Cloud storage is not configured yet.");
  }
  const { AwsClient } = await import("aws4fetch");
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });

  let total = 0;
  let token: string | undefined;
  // Every page carries its own continuation token, so each one must be signed
  // separately -- appending a token after signing would invalidate the signature.
  for (;;) {
    const url = new URL(`https://${accountId}.r2.cloudflarestorage.com/${bucket}`);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", `${owner}/`);
    url.searchParams.set("X-Amz-Expires", "900");
    if (token) url.searchParams.set("continuation-token", token);
    const signed = await client.sign(new Request(url, { method: "GET" }), {
      aws: { signQuery: true },
    });
    const res = await fetch(signed.url, { method: "GET" });
    if (!res.ok) throw new Error(`Storage listing failed (${res.status}).`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Size>(\d+)<\/Size>/g)) total += Number(m[1]);
    token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1];
    if (!token) return total;
  }
}

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
 * are enforced against the profile limits: at most 6 photos, 5 documents,
 * 11 total files and 20MB of stored bytes. Payment proofs and horoscope
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
        .select("doc_type")
        .eq("user_id", owner);
      let photoCount = 0;
      let docCount = 0;
      for (const row of rows ?? []) {
        if (row.doc_type === "photo") photoCount++;
        else docCount++;
      }
      const totalBytes = await r2OwnerBytes(owner); // server-measured, not client-reported

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

export const createViewUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const parsed = z
      .object({ keys: z.array(z.string().min(1)).min(1).max(100) })
      .parse(input);
    return parsed;
  })
  .handler(async ({ data, context }) => {
    const results: Record<string, string> = {};
    const userId = context.userId;
    const { data: isAdminCheck } = await context.supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    const admin = !!isAdminCheck;

    for (const key of data.keys) {
      let ownsFile = key.startsWith(userId + "/");
      if (!ownsFile) {
        const { data: report } = await context.supabase
          .from("jathagam_requests")
          .select("id")
          .eq("report_key", key)
          .eq("user_id", userId)
          .maybeSingle();
        if (report) ownsFile = true;
      }
      if (!ownsFile && !admin) {
        continue;
      }
      try {
        results[key] = await signR2(key, "GET");
      } catch {
        // skip failing keys to keep batch resilient
      }
    }
    return results;
  });

/**
 * Promotes an already-uploaded gallery photo to be the profile's main photo.
 * The key must resolve to a real `documents` row of type `photo`, which is what
 * stops a client from pointing `photo_url` at an arbitrary string or at another
 * member's key: `photo_url` is a client-writable column, so without this check
 * the profile would advertise a photo that does not exist or is not theirs.
 */
export const setPrimaryPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ key: z.string().min(1).max(300) }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("documents")
      .select("user_id, doc_type")
      .eq("storage_key", data.key)
      .limit(1);
    const row = rows?.[0];

    // Reuse the same message as the other key-authorised helpers so a probe
    // cannot distinguish "no such photo" from "not yours".
    if (!row || row.doc_type !== "photo") throw new Error("Not allowed");

    if (row.user_id !== context.userId) {
      const { data: isAdmin } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      if (!isAdmin) throw new Error("Not allowed");
    }

    const { error } = await context.supabase
      .from("profiles")
      .update({ photo_url: data.key })
      .eq("id", row.user_id);
    if (error) throw error;

    return { ok: true };
  });
