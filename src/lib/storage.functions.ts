import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";
import {
  MAX_DOC_INPUT_BYTES,
  MAX_PHOTO_INPUT_BYTES,
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
 * Authoritative storage usage for an owner prefix, read from R2 itself.
 *
 * Quota must not be summed from `documents.size_bytes` or counted from
 * `documents` rows: those rows are inserted by the client, so a member can
 * report 0 bytes for a real object, or skip the insert entirely, and keep
 * filling the bucket while every cap still reads low. R2 is the only party that
 * knows how many objects exist and how large they really are, so we ask it
 * directly instead of trusting the database.
 *
 * Counts every object under the prefix, including any that has no row yet.
 * Folder comes from the key layout `${owner}/${folder}/${date}...`, and the
 * tally mirrors the old row-based one: only `photo` counts as a photo, anything
 * else counts as a document.
 *
 * Fails closed: if the listing cannot be read we must not fall back to a
 * client-supplied number, so a storage error rejects the upload instead.
 *
 * Note this listing is no longer the quota check. It only seeds an owner's
 * counters the first time they upload; the caps themselves are enforced by
 * `reserveProfileQuota`, which can be made atomic because it writes to Postgres
 * rather than to R2.
 */
async function r2OwnerUsage(owner: string): Promise<{
  totalBytes: number;
  photoCount: number;
  docCount: number;
}> {
  const accountId = process.env["R2_ACCOUNT_ID"];
  const accessKeyId = process.env["R2_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["R2_SECRET_ACCESS_KEY"];
  const bucket = process.env["R2_BUCKET_NAME"];
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("Cloud storage is not configured yet.");
  }
  const { AwsClient } = await import("aws4fetch");
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });

  let totalBytes = 0;
  let photoCount = 0;
  let docCount = 0;
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
    // Parsed per <Contents> so each size is paired with its own key; matching
    // <Size> on its own would work but could not attribute it to a folder.
    for (const entry of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const body = entry[1] ?? "";
      const size = /<Size>(\d+)<\/Size>/.exec(body);
      if (size) totalBytes += Number(size[1]);
      const key = /<Key>([\s\S]*?)<\/Key>/.exec(body)?.[1];
      if (!key) continue;
      // Keys are `${owner}/${folder}/...`; anything outside that shape is not
      // counted rather than guessed at.
      if (!key.startsWith(`${owner}/`)) continue;
      const folder = key.slice(owner.length + 1).split("/")[0] ?? "";
      if (folder === "photo") photoCount++;
      else docCount++;
    }
    token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1];
    if (!token) return { totalBytes, photoCount, docCount };
  }
}

const UPLOAD_LIMIT_CODES = [
  UPLOAD_LIMIT_PHOTOS,
  UPLOAD_LIMIT_DOCS,
  UPLOAD_LIMIT_TOTAL,
  UPLOAD_LIMIT_STORAGE,
] as const;

/**
 * Re-raise a quota rejection carrying only the bare code.
 *
 * The caps are enforced inside `reserve_upload_quota`, and PostgREST wraps a
 * raised exception in its own envelope. Re-throwing the bare code keeps
 * `friendlyUploadError()` on the client matching it exactly as it did when the
 * check lived here.
 */
function throwQuotaError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  for (const code of UPLOAD_LIMIT_CODES) {
    if (message.includes(code)) throw new Error(code);
  }
  throw error;
}

/**
 * Service-role client used only for the quota RPCs.
 *
 * The counters must not be reachable with a member's JWT: their seed values are
 * the server's own measured R2 totals, and a member able to call
 * `reserve_upload_quota` directly could seed them low and launder a bypass. The
 * upload itself is still authorised in `resolveOwnerPrefix`, before any of this
 * runs, so the service role is only widening which *verified* owner may be
 * charged. Imported lazily so this module can never reach a client bundle.
 */
async function quotaAdminClient(): Promise<SupabaseClient<Database>> {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("Server is not configured yet.");
  const { createClient } = await import("@supabase/supabase-js");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Atomically claim one upload's worth of profile quota, before anything is
 * stored.
 *
 * `reserve_upload_quota` takes a per-owner advisory lock inside Postgres, so
 * concurrent reservations for the same owner are serialised: the second one
 * observes the first one's increment and is rejected at the boundary. That is
 * what the previous read-then-act check could never guarantee, and it needs no
 * in-process mutex -- Cloudflare runs several isolates, so a module-level lock
 * would not be shared by the requests that actually race.
 *
 * The measured counts are only a seed, used once to initialise an owner that has
 * no counter row yet so that pre-existing objects are counted. Once the row
 * exists Postgres ignores the seed, so the listing is skipped entirely: without
 * the existence probe below every upload would re-list the whole prefix.
 */
async function reserveProfileQuota(
  owner: string,
  folder: string,
  sizeBytes: number,
): Promise<void> {
  const admin = await quotaAdminClient();
  const { data: existing } = await admin
    .from("document_upload_counters")
    .select("user_id")
    .eq("user_id", owner)
    .maybeSingle();

  // Only measured when the row is absent. If it appears between this probe and
  // the reserve call, the RPC's ON CONFLICT path drops the seed anyway.
  const usage = existing ? null : await r2OwnerUsage(owner);

  const { error } = await admin.rpc("reserve_upload_quota", {
    p_user_id: owner,
    p_folder: folder,
    p_size_bytes: sizeBytes,
    p_seed_photo: usage?.photoCount ?? 0,
    p_seed_doc: usage?.docCount ?? 0,
    p_seed_bytes: usage?.totalBytes ?? 0,
  });
  if (error) throwQuotaError(error);
}

/** Hand a reservation back when the upload it was taken for never completed. */
async function releaseProfileQuota(
  owner: string,
  folder: string,
  sizeBytes: number,
): Promise<void> {
  const admin = await quotaAdminClient();
  const { error } = await admin.rpc("release_upload_quota", {
    p_user_id: owner,
    p_folder: folder,
    p_size_bytes: sizeBytes,
  });
  if (error) throwQuotaError(error);
}

/**
 * Re-stamp the counters from a fresh R2 listing, after a delete freed storage.
 *
 * Measuring R2 again is preferred over decrementing by a known amount: the
 * stored size in `documents` is written by the client, so a decrement would have
 * to trust a number the member controls. Re-measuring also repairs drift, and
 * the delete path stays correct even for an object with no `documents` row.
 */
async function resyncProfileQuota(owner: string): Promise<void> {
  const admin = await quotaAdminClient();
  const usage = await r2OwnerUsage(owner);
  const { error } = await admin.rpc("resync_upload_quota", {
    p_user_id: owner,
    p_photo: usage.photoCount,
    p_doc: usage.docCount,
    p_bytes: usage.totalBytes,
  });
  if (error) throwQuotaError(error);
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

    const isProfileFolder = PROFILE_FOLDERS.has(folder);
    if (isProfileFolder) {
      const inputLimit = folder === "photo" ? MAX_PHOTO_INPUT_BYTES : MAX_DOC_INPUT_BYTES;
      if (originalSize > inputLimit) {
        throw new Error(folder === "photo" ? FILE_TOO_LARGE_PHOTO : FILE_TOO_LARGE_DOC);
      }
    }
    if (file.size > 15 * 1024 * 1024) throw new Error("File is too large (max 15 MB).");

    const body = new Uint8Array(await file.arrayBuffer());

    // Taken after the stateless checks above and before the PUT, so a rejected
    // upload never leaves a reservation behind and a parallel one cannot slip
    // past the boundary. Same limits, same codes, same order of rejection.
    if (isProfileFolder) {
      await reserveProfileQuota(owner, folder, file.size);
    }

    const key = `${owner}/${folder}/${Date.now()}-${crypto.randomUUID()}-${sanitize(file.name || "file")}`;
    try {
      assertValidMagicBytes(contentType, body);
      const uploadUrl = await signR2(key, "PUT", contentType);
      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "content-type": contentType },
        body,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status}).`);
    } catch (err) {
      // Nothing reached the bucket, so give the quota back. Otherwise a
      // transient R2 or validation failure would permanently burn a slot.
      // Best-effort: a failed release must not replace the error the member
      // actually needs to see, and the slot is recovered by the next resync.
      if (isProfileFolder) {
        try {
          await releaseProfileQuota(owner, folder, file.size);
        } catch {
          // Reservation stays held; drifts high, never low.
        }
      }
      throw err;
    }
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

    // The counters are a cache of what is in the bucket, so a delete has to
    // refresh them or the freed slot stays consumed forever. Best-effort: the
    // object is already gone at this point, and failing the delete would be
    // worse than drifting high, which the next delete or upload repairs.
    const owner = data.key.split("/")[0] ?? "";
    if (owner) {
      try {
        await resyncProfileQuota(owner);
      } catch {
        // Quota stays conservative until the next successful resync.
      }
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
