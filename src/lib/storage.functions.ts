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
import { keysSafeToDelete } from "@/lib/screening";
import { assertCanonicalStorageKey, isCanonicalStorageKey, storageObjectUrl } from "@/lib/storage-key";

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
  assertCanonicalStorageKey(key);
  const accountId = process.env["R2_ACCOUNT_ID"];
  const accessKeyId = process.env["R2_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["R2_SECRET_ACCESS_KEY"];
  const bucket = process.env["R2_BUCKET_NAME"];
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("Cloud storage is not configured yet.");
  }
  const url = storageObjectUrl(accountId, bucket, key);
  const { AwsClient } = await import("aws4fetch");
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
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
 * Service-role RPC boundary for the storage-deletion lifecycle.
 *
 * Every claim/confirm/finalize/block/failure transition is gated to
 * `service_role` in SQL and must never be reachable with a member JWT. This is
 * the single server-only seam the lifecycle uses, so the orchestration can be
 * exercised offline by substituting this function.
 */
async function storageDeletionServiceRpc<T = unknown>(
  name: string,
  args: Record<string, unknown>,
): Promise<{ data: T; error: unknown }> {
  const admin = await quotaAdminClient();
  return (admin as unknown as {
    rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: T; error: unknown }>;
  }).rpc(name, args);
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

/**
 * Refuses an upload whose literal key has already been fenced for deletion.
 *
 * uploadFile always mints a fresh `${owner}/${folder}/${Date.now()}-<uuid-v4>`
 * key, so this cannot trigger for a normal upload; it is the object-creation
 * safety net for a reused or caller-supplied key, and it is the only point that
 * could recreate an object at a tombstoned key. Fail closed: an unavailable
 * probe must never let an object be written over a tombstone.
 */
async function assertStorageKeyNotFenced(key: string): Promise<void> {
  const admin = await quotaAdminClient();
  const { data, error } = await admin.rpc("is_storage_key_fenced", { p_storage_key: key });
  if (error || data !== false) {
    throw new Error("Cannot verify storage key availability.");
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

    // Hand the reservation back, best-effort. Only ever reached for outcomes
    // that prove no object was stored; a failed release must not replace the
    // error the member actually needs to see, and the slot is recovered by the
    // next resync.
    const releaseReservation = async () => {
      if (!isProfileFolder) return;
      try {
        await releaseProfileQuota(owner, folder, file.size);
      } catch {
        // Reservation stays held; drifts high, never low.
      }
    };

    // All three run before the PUT is dispatched, so a failure here stored
    // nothing and the reservation can safely be given back.
    let uploadUrl: string;
    try {
      await assertStorageKeyNotFenced(key);
      assertValidMagicBytes(contentType, body);
      uploadUrl = await signR2(key, "PUT", contentType);
    } catch (err) {
      await releaseReservation();
      throw err;
    }

    // The PUT is dispatched outside that guard: once the request may have
    // reached R2 we can no longer prove the object is absent. Neither a lost
    // response nor an explicit non-2xx is trusted to establish that, so the
    // reservation is retained (drift high, never low) rather than released and
    // letting a stored object go uncounted, which would defeat the caps below.
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": contentType },
      body,
    });

    if (!res.ok) {
      // Every non-2xx response retains the reservation: even a 4xx is not
      // trusted to prove the object is absent (an intermediary could have
      // stored it before answering). Only the member-facing error is surfaced;
      // its text is unchanged.
      throw new Error(`Upload failed (${res.status}).`);
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

/** Validate the literal key before authorization or metadata mutations. */
const zStorageKey = z
  .string()
  .min(1)
  .max(300)
  .refine(isCanonicalStorageKey, {
    message: "Invalid key.",
  });

/** Maximum R2 attempts before a durable request is parked as failed. */
const STORAGE_DELETION_MAX_ATTEMPTS = 5;

type DeletionClaim = {
  id: string;
  storage_key: string;
  owner_id: string;
  lease_token: string;
  r2_state: "not_attempted" | "uncertain" | "confirmed_absent";
  finalize_state: string;
  document_row_ids: string[];
  attempt_count: number;
};

/** Reads one durable request row, rejecting any unexpected shape. */
function readDeletionClaim(value: unknown): DeletionClaim | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const r2 = row["r2_state"];
  if (typeof row["id"] !== "string"
    || typeof row["storage_key"] !== "string"
    || typeof row["owner_id"] !== "string"
    || typeof row["lease_token"] !== "string"
    || (r2 !== "not_attempted" && r2 !== "uncertain" && r2 !== "confirmed_absent")
    || typeof row["finalize_state"] !== "string"
    || !Array.isArray(row["document_row_ids"])
    || !(row["document_row_ids"] as unknown[]).every((id) => typeof id === "string")
    || typeof row["attempt_count"] !== "number") {
    return null;
  }
  return {
    id: row["id"] as string,
    storage_key: row["storage_key"] as string,
    owner_id: row["owner_id"] as string,
    lease_token: row["lease_token"] as string,
    r2_state: r2,
    finalize_state: row["finalize_state"] as string,
    document_row_ids: row["document_row_ids"] as string[],
    attempt_count: row["attempt_count"] as number,
  };
}

/** The only outcomes `fence_storage_key_for_deletion` may report. */
const FENCE_OUTCOMES = [
  "fenced",
  "blocked_protected_reference",
  "blocked_document_set_changed",
  "not_claimed",
] as const;
type FenceOutcome = (typeof FENCE_OUTCOMES)[number];

/** Reads the service-role fence outcome, rejecting any unexpected shape. */
function readFenceOutcome(value: unknown): FenceOutcome | null {
  return typeof value === "string" && (FENCE_OUTCOMES as readonly string[]).includes(value)
    ? (value as FenceOutcome)
    : null;
}

/** Reads one outstanding quota-resync record, rejecting any unexpected shape. */
function readQuotaResyncRecord(value: unknown): { id: string; owner_id: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row["id"] !== "string" || row["id"].length === 0
    || typeof row["owner_id"] !== "string" || row["owner_id"].length === 0) {
    return null;
  }
  return { id: row["id"], owner_id: row["owner_id"] };
}

type DeletionPassResult =
  | { status: "deleted" }
  | { status: "blocked"; reason: string }
  | { status: "failed"; r2Status?: number; error?: string };

/** Service-role-only RPC boundary; see `storageDeletionServiceRpc`. */
function deletionRpc<T = unknown>(name: string, args: Record<string, unknown>) {
  return storageDeletionServiceRpc<T>(name, args);
}

async function releaseBlockedLease(requestId: string, leaseToken: string, reason: string): Promise<void> {
  try {
    await deletionRpc<boolean>("block_storage_deletion", {
      p_request_id: requestId,
      p_lease_token: leaseToken,
      p_reason: reason,
    });
  } catch {
    // The lease expires on its own and the request stays reclaimable.
  }
}

/**
 * Executes one already-claimed deletion pass. Service-role only.
 *
 * Ordering is deliberate: a durable per-key fence is committed BEFORE any R2
 * DELETE, and document metadata is removed only AFTER R2 confirms the object is
 * absent. A 2xx or 404 is idempotent success; any other outcome is `uncertain`
 * and leaves the durable request (and all metadata) intact.
 *
 * The fence (Finding 5) is what makes the ordering safe under concurrency: it is
 * written in its own committed transaction under the per-key lock, after an
 * authoritative re-check, and every later reference INSERT/UPDATE for that key
 * is rejected by a database trigger. The R2 DELETE runs only in a later
 * transaction, so a reference can no longer slip in between the last check and
 * the delete. A missing or failed fence blocks the pass rather than deleting.
 */
async function executeStorageDeletion(claim: DeletionClaim): Promise<DeletionPassResult> {
  if (claim.finalize_state === "done") return { status: "deleted" };

  // Establish (or reuse) the durable deletion fence before any R2 DELETE. The
  // RPC takes the per-key lock, re-checks all six reference sources and, only
  // when they are clean, commits a permanent fence row that makes every later
  // reference write to this key fail. It is idempotent, so a retry after a lease
  // expiry, a crash or an R2 failure reuses the committed fence.
  let fence: FenceOutcome | null = null;
  try {
    const result = await deletionRpc<unknown>("fence_storage_key_for_deletion", {
      p_request_id: claim.id,
      p_lease_token: claim.lease_token,
    });
    fence = result.error ? null : readFenceOutcome(result.data);
  } catch {
    fence = null;
  }
  if (fence === null) {
    // A missing or failing fence is a safe stop: no fence means no authorization
    // to delete, so R2 is never touched.
    await releaseBlockedLease(claim.id, claim.lease_token, "reference_check_unavailable");
    return { status: "blocked", reason: "reference_check_unavailable" };
  }
  if (fence === "not_claimed") {
    // The lease was lost between claim and fence; another worker owns it now.
    return { status: "failed", error: "Storage deletion could not be completed and will be retried." };
  }
  if (fence === "blocked_protected_reference" || fence === "blocked_document_set_changed") {
    const reason = fence === "blocked_protected_reference" ? "protected_reference" : "document_set_changed";
    await releaseBlockedLease(claim.id, claim.lease_token, reason);
    return { status: "blocked", reason };
  }

  if (claim.r2_state !== "confirmed_absent") {

    let r2Status: number | null = null;
    let confirmed = false;
    try {
      const deleteUrl = await signR2(claim.storage_key, "DELETE");
      const response = await fetch(deleteUrl, { method: "DELETE" });
      r2Status = response.status;
      confirmed = response.ok || response.status === 404;
    } catch {
      confirmed = false;
    }

    if (!confirmed) {
      try {
        await deletionRpc<unknown>("record_storage_deletion_failure", {
          p_request_id: claim.id,
          p_lease_token: claim.lease_token,
          p_error: r2Status === null ? "Storage deletion failed." : `Storage deletion failed (${r2Status}).`,
          p_max_attempts: STORAGE_DELETION_MAX_ATTEMPTS,
        });
      } catch {
        // The lease expires and the request stays reclaimable for a retry.
      }
      return r2Status === null
        ? { status: "failed", error: "Storage deletion failed." }
        : { status: "failed", r2Status };
    }

    const confirmedResult = await deletionRpc<boolean>("set_r2_confirmed_absent", {
      p_request_id: claim.id,
      p_lease_token: claim.lease_token,
    });
    if (confirmedResult.error || confirmedResult.data !== true) {
      // Stale lease or unavailable RPC: never assume success.
      return { status: "failed", error: "Storage deletion could not be completed and will be retried." };
    }
  }

  // Database-only finalization: deletes ONLY the captured ids, transactionally.
  const finalizeResult = await deletionRpc<boolean>("finalize_storage_deletion", {
    p_request_id: claim.id,
    p_lease_token: claim.lease_token,
  });
  if (finalizeResult.error || finalizeResult.data !== true) {
    // R2 is already absent; metadata stays intact and finalization is retried.
    return { status: "failed", error: "Storage deletion could not be completed and will be retried." };
  }

  // Quota counters are a cache of the bucket; refresh best-effort and record it.
  try {
    await resyncProfileQuota(claim.owner_id);
    await deletionRpc("mark_storage_deletion_quota_resynced", { p_request_id: claim.id });
  } catch {
    // Counter drifts high and self-heals on the next delete/upload/resync.
  }

  return { status: "deleted" };
}

/** Claims one durable request by id and runs a pass. Service-role only. */
async function claimAndRunStorageDeletion(requestId: string): Promise<DeletionPassResult> {
  try {
    const { data, error } = await deletionRpc<unknown[]>("claim_storage_deletion_request", {
      p_request_id: requestId,
    });
    const claim = error ? null : readDeletionClaim(Array.isArray(data) ? data[0] : null);
    if (!claim) {
      return { status: "failed", error: "Storage deletion could not be completed and will be retried." };
    }
    return await executeStorageDeletion(claim);
  } catch {
    return { status: "failed", error: "Storage deletion could not be completed and will be retried." };
  }
}

/**
 * Deletes an owner/admin-authorized file through a durable deletion lifecycle.
 *
 * A durable request is written BEFORE any R2 operation, document metadata is
 * removed only after R2 confirms the object is absent, and any R2 failure or
 * uncertainty leaves the request (and the metadata) intact for retry. Any
 * payment, report, support, receipt or primary-photo reference protects the
 * object, even from admin deletion.
 *
 * Never reports success unless deletion was confirmed; otherwise it throws so
 * callers do not show a false success. The read-then-delete is bounded by the
 * durable fence (Finding 5): reference inserts that race the worker are rejected
 * at the database, so a reference can no longer be inserted after the final
 * check.
 */
export const deleteUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    key: zStorageKey,
    onlyIfUnreferenced: z.boolean().optional().default(false),
  }).parse(input))
  .handler(async ({ data, context }) => {
    let allowed = data.key.startsWith(`${context.userId}/`);
    if (!allowed) {
      const { data: isAdmin, error: roleError } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      allowed = !roleError && isAdmin === true;
    }
    if (!allowed) throw new Error("Not allowed");

    // The RPC sees references hidden by caller RLS. Never fall back to a scoped
    // empty SELECT if the RPC is missing, fails, or returns an uncertain result.
    const referenceState = async () => {
      try {
        const { data: states, error } = await context.supabase.rpc(
          "get_storage_reference_state", { p_storage_key: data.key },
        );
        const state = Array.isArray(states) && states.length === 1 ? states[0] : null;
        if (error || !state || Array.isArray(state)
          || typeof state.has_document_references !== "boolean"
          || typeof state.may_delete_document_references !== "boolean"
          || typeof state.has_protected_references !== "boolean"
          || (!state.has_document_references && !state.may_delete_document_references)) {
          throw new Error("Invalid reference state.");
        }
        return state;
      } catch {
        throw new Error("Cannot verify storage references.");
      }
    };
    const before = await referenceState();
    if (data.onlyIfUnreferenced && (before.has_document_references || before.has_protected_references)) {
      return { ok: true, skipped: true };
    }
    if (before.has_protected_references) throw new Error("File is still in use and cannot be deleted.");
    if (!before.may_delete_document_references) throw new Error("Not allowed");

    // Durable intent FIRST, before any R2 operation. The RPC re-validates and
    // captures exactly the document rows authorized for deletion now.
    let requestId: string;
    try {
      const { data: created, error } = await context.supabase.rpc(
        "request_storage_deletion", { p_storage_key: data.key },
      );
      if (error || typeof created !== "string" || created.length === 0) {
        throw new Error("Invalid deletion request.");
      }
      requestId = created;
    } catch {
      throw new Error("Cannot record storage deletion.");
    }

    const outcome = await claimAndRunStorageDeletion(requestId);
    if (outcome.status === "deleted") return { ok: true };
    if (outcome.status === "blocked") {
      if (data.onlyIfUnreferenced) return { ok: true, skipped: true };
      if (outcome.reason === "reference_check_unavailable") {
        throw new Error("Cannot verify storage references.");
      }
      throw new Error("File is still in use and cannot be deleted.");
    }
    // Not confirmed: the durable request is retained and retried. Never report
    // success for an unconfirmed deletion.
    if (outcome.r2Status !== undefined) {
      throw new Error(`Storage deletion failed (${outcome.r2Status}).`);
    }
    throw new Error(outcome.error ?? "Storage deletion failed.");
  });

/**
 * Recovery pass for completed deletions whose quota re-stamp never ran.
 *
 * `finalize_storage_deletion` and the quota re-measurement are separate calls,
 * so a crash, timeout or lost response between them leaves a `deleted` request
 * with `quota_resynced_at IS NULL` that the claim filters never select again;
 * the counters would stay high indefinitely. This pass only re-runs the
 * idempotent re-measurement and records completion. It never issues an R2
 * DELETE and never finalizes document metadata, so it cannot remove a file or a
 * document row.
 *
 * A failed re-measurement leaves `quota_resynced_at` NULL (the mark is skipped)
 * so a later pass retries; a mark failure only delays the record. Both stay safe
 * because each retry is a fresh R2 measurement, not a decrement. A database
 * error is never mistaken for a successful resync, and a concurrent worker can
 * only ever stamp a row it actually re-measured.
 */
async function recoverStorageDeletionQuotaResyncs(limit: number): Promise<number> {
  let records: Array<{ id: string; owner_id: string }> = [];
  try {
    const result = await storageDeletionServiceRpc<unknown[]>("list_storage_deletion_quota_resyncs", {
      p_limit: limit,
    });
    if (!result.error && Array.isArray(result.data)) {
      records = result.data
        .map(readQuotaResyncRecord)
        .filter((record): record is { id: string; owner_id: string } => record !== null);
    }
  } catch {
    // Listing unavailable: nothing to recover this pass.
    return 0;
  }

  let recovered = 0;
  for (const record of records) {
    try {
      await resyncProfileQuota(record.owner_id);
    } catch {
      // Failed resync keeps quota_resynced_at NULL for a later pass.
      continue;
    }
    try {
      const marked = await deletionRpc("mark_storage_deletion_quota_resynced", { p_request_id: record.id });
      if (!marked.error) recovered++;
    } catch {
      // Mark failure only delays the record; resync is idempotent on retry.
    }
  }
  return recovered;
}

/**
 * Processes queued storage deletions. Service-role only; must run in a server
 * context. No scheduler is wired here — a runtime caller is added separately.
 *
 * Each pass re-checks references and removes document metadata only after R2
 * confirms the object is absent. A crash, timeout or lost response leaves a
 * durable, reclaimable request; finalization is idempotent and lease-guarded.
 * After the claim pass it runs a separate, bounded recovery pass for completed
 * deletions whose quota re-stamp never ran (see below). Neither pass can remove
 * an object or metadata that the other has already finalized.
 * This does NOT prevent a reference inserted after the last check (Finding 5).
 */
export async function processStorageDeletionRequests(
  options: { requestId?: string; limit?: number } = {},
): Promise<{ processed: number; quotaResyncs: number }> {
  const claims: DeletionClaim[] = [];
  try {
    const result = options.requestId
      ? await deletionRpc<unknown[]>("claim_storage_deletion_request", { p_request_id: options.requestId })
      : await deletionRpc<unknown[]>("claim_storage_deletion_requests", { p_limit: options.limit ?? 25 });
    if (!result.error && Array.isArray(result.data)) {
      for (const raw of result.data) {
        const claim = readDeletionClaim(raw);
        if (claim) claims.push(claim);
      }
    }
  } catch {
    // Service-role boundary unavailable; nothing was claimed.
  }

  let processed = 0;
  for (const claim of claims) {
    try {
      await executeStorageDeletion(claim);
    } catch {
      // One failed pass must not stop the others; the lease expires.
    }
    processed++;
  }

  // Separate, bounded recovery pass for completed deletions whose quota
  // re-stamp never ran. Re-measures counters and records completion only --
  // never an R2 DELETE, never a metadata finalize.
  const quotaResyncs = await recoverStorageDeletionQuotaResyncs(options.limit ?? 25);

  return { processed, quotaResyncs };
}

/**
 * Best-effort removal of objects this attempt uploaded but never persisted.
 *
 * Shared by every client flow that uploads first and writes its `documents`
 * rows second (registration and both admin upload dialogs). Ownership and
 * persistence are BOTH verified before deleting: only keys owned by `ownerId`
 * (the member whose prefix the upload used -- for an admin-on-behalf upload that
 * is the CLIENT's id, never the admin's) and that no known storage-reference
 * column references are removed. The server checks all six tables, including
 * rows hidden by RLS, and never detaches protected references to permit cleanup.
 *
 * Reference verification runs server-side through the authoritative RPC, never
 * through a browser-visible absence check. Read-then-delete remains non-atomic:
 * a concurrent insert after the last reference check is not prevented here.
 *
 * Never throws: a cleanup failure must not replace the original error the
 * caller is about to report.
 */
export async function cleanupOrphanedUploads(
  ownerId: string,
  keys: readonly string[],
): Promise<void> {
  if (!ownerId || keys.length === 0) return;
  try {
    // Client-side filtering is only an optimization. The server independently
    // authorizes each key and enforces authoritative orphan-only deletion.
    for (const key of keysSafeToDelete(keys, [], ownerId)) {
      try {
        await deleteUpload({ data: { key, onlyIfUnreferenced: true } });
      } catch {
        /* best-effort: one failed delete must not stop the others */
      }
    }
  } catch {
    /* best-effort: cleanup failure must never change the reported outcome */
  }
}

/** Returns a short-lived view URL. Owners and admins only. */
export const createViewUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ key: zStorageKey }).parse(input))
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
      .object({ keys: z.array(zStorageKey).min(1).max(100) })
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
  .inputValidator((input: unknown) => z.object({ key: zStorageKey }).parse(input))
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
