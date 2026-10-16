import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_GEMINI_MODEL, requestGeminiVerdict } from "@/lib/gemini-screening";
import {
  decideScreenedPair,
  isApprovedMandatoryIdKind,
  isOwnedStorageKey,
  summarizePersistedPair,
  type ScreenedPairStatus,
} from "@/lib/screening";
import { z } from "zod";

const Input = z.object({
  idImage: z.string().min(50),
  photoImage: z.string().min(50),
});

export type PreScreenResult = {
  faceMatch: boolean;
  faceMatchConfidence: number;
  idReadable: boolean;
  photoClear: boolean;
  idType: string;
  notes: string;
};

/**
 * Runs the government-ID / profile-photo verification against Google Gemini
 * (server-side only) and returns the raw model verdict. This surface is
 * deliberately kept pure: it never writes to the database, so the result shown
 * in the wizard is exactly what the model decided and nothing is persisted from
 * the browser.
 *
 * The API key is read from `process.env.GEMINI_API_KEY` on the server only and
 * is never exposed to the browser bundle (no `VITE_` prefix). The authoritative
 * write happens later, inside `submitScreenedPair`, where the model is re-run on
 * the server and ONLY the server-computed result is stored.
 */
async function runIdScreen(idImage: string, photoImage: string): Promise<PreScreenResult> {
  const key = process.env["GEMINI_API_KEY"];
  if (!key) throw new Error("AI verification is not configured.");
  const model = process.env["GEMINI_MODEL"]?.trim() || DEFAULT_GEMINI_MODEL;
  return requestGeminiVerdict({ idImage, photoImage, apiKey: key, model, fetchImpl: fetch });
}

/** AI pre-screening: does the ID photo match the profile photo, and is the ID readable? */
export const preScreenDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<PreScreenResult> => {
    return runIdScreen(data.idImage, data.photoImage);
  });

/**
 * The only id_kind values the server will attach to a persisted verification
 * document, and the decision rule for a screened pair, both live in
 * src/lib/screening.ts so the policy is unit-testable in isolation.
 */

const PairInput = z.object({
  idImage: z.string().min(50),
  photoImage: z.string().min(50),
  photoKey: z.string().min(1).max(300),
  idKey: z.string().min(1).max(300),
  idKind: z.string().min(1).max(40),
  photoFileName: z.string().min(1).max(200),
  idFileName: z.string().min(1).max(200),
  photoMimeType: z.string().min(1).max(100),
  idMimeType: z.string().min(1).max(100),
  photoSizeBytes: z.number().int().nonnegative().max(15_728_640),
  idSizeBytes: z.number().int().nonnegative().max(15_728_640),
});

export type { ScreenedPairStatus };

export type ScreenedPairResult = {
  status: ScreenedPairStatus;
  result: PreScreenResult;
  photoKey: string;
  idKey: string;
  /**
   * True when both rows for these exact storage keys were already on file and
   * screened, so this call read-and-skipped instead of running the model or
   * inserting. The stored rows and any admin `verified` decision are untouched.
   */
  alreadyPersisted: boolean;
};

/**
 * Records the photo and mandatory government-ID documents for a submission,
 * with the AI verification fields set ONLY from results the server's own model
 * call just produced in this handler.
 *
 * This is the intended trusted verification architecture:
 *   * The client never writes ai_check_status / ai_check_notes /
 *     ai_face_match_score, so `documents_client_field_guard` is unchanged and
 *     an AI "pass" cannot be forged from the browser.
 *   * The storage keys are validated here (ownership prefix + path traversal),
 *     not trusted from the client.
 *   * A result whose ID is unreadable or photo is unclear is NEVER persisted and
 *     is reported as "blocked" so the member cannot submit on it.
 *   * A failed face match is persisted truthfully as "review" (the member is
 *     warned and admin approval remains mandatory); an unavailable or
 *     inconclusive model answer is treated as a thrown error, so a "pass" row
 *     can never be produced from anything but a successful model verdict.
 */
export const submitScreenedPair = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PairInput.parse(input))
  .handler(async ({ data, context }): Promise<ScreenedPairResult> => {
    const userId = context.userId;

    if (!isOwnedStorageKey(data.photoKey, userId) || !isOwnedStorageKey(data.idKey, userId)) {
      throw new Error("Invalid storage key.");
    }

    if (!isApprovedMandatoryIdKind(data.idKind)) {
      throw new Error("Invalid document kind.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Retry-safe read-then-skip, step 1: look for rows this member already has
    // at these EXACT storage keys. A row whose ai_check_status is a screening
    // value could only have been written by the trusted service-role path (the
    // client-field guard forces ai_* to NULL on a member insert and forbids
    // changing it), so it is safe to treat as already screened. No row is ever
    // updated here, so `verified` and any admin decision are preserved as-is.
    // This read is not atomic: concurrent double-submits are not prevented.
    const { data: existingRows, error: readError } = await supabaseAdmin
      .from("documents")
      .select("doc_type, storage_key, ai_check_status, ai_check_notes, ai_face_match_score")
      .eq("user_id", userId)
      .in("storage_key", [data.photoKey, data.idKey]);
    if (readError) throw readError;

    const existing = (existingRows ?? []) as {
      doc_type: string;
      storage_key: string;
      ai_check_status: string | null;
      ai_check_notes: string | null;
      ai_face_match_score: number | null;
    }[];
    const photoRow = existing.find(
      (row) => row.storage_key === data.photoKey && row.doc_type === "photo",
    );
    const idRow = existing.find(
      (row) => row.storage_key === data.idKey && row.doc_type === "govt_id",
    );
    const persisted = summarizePersistedPair(photoRow?.ai_check_status, idRow?.ai_check_status);

    if (persisted.alreadyPersisted && persisted.status) {
      // Both rows are already on file and screened: return the stored verdict
      // without re-running the model, re-inserting or touching the rows.
      return {
        status: persisted.status,
        result: {
          faceMatch: persisted.status === "pass",
          faceMatchConfidence: Number(idRow?.ai_face_match_score ?? 0),
          idReadable: true,
          photoClear: true,
          idType: "",
          notes: idRow?.ai_check_notes ?? "",
        },
        photoKey: data.photoKey,
        idKey: data.idKey,
        alreadyPersisted: true,
      };
    }

    const result = await runIdScreen(data.idImage, data.photoImage);

    // Blocked: an ID that cannot be read or a photo that is not clear must
    // never be persisted, and must never let a submission proceed.
    const status = decideScreenedPair(result);
    if (status === "blocked") {
      return {
        status,
        result,
        photoKey: data.photoKey,
        idKey: data.idKey,
        alreadyPersisted: false,
      };
    }

    // Truthful persistence: a row is "pass" only for the aspect that actually
    // passed, otherwise "review" which forces manual admin review. These values
    // come from THIS handler's own model call, never from the client.
    const photoStatus = result.photoClear ? "pass" : "review";
    const idStatus = result.faceMatch && result.idReadable ? "pass" : "review";

    // Read-then-skip, step 2: insert ONLY the keys that do not already have a
    // row, so a partial earlier write cannot be duplicated. Existing rows are
    // never updated, so an already-verified document keeps its state.
    const existingKeys = new Set((existingRows ?? []).map((row) => row.storage_key));
    const toInsert: {
      user_id: string;
      doc_type: string;
      id_kind?: string;
      storage_key: string;
      file_name: string;
      mime_type: string;
      size_bytes: number;
      ai_check_status: string;
      ai_check_notes: string;
      ai_face_match_score: number;
    }[] = [];

    if (!existingKeys.has(data.photoKey)) {
      toInsert.push({
        user_id: userId,
        doc_type: "photo",
        storage_key: data.photoKey,
        file_name: data.photoFileName,
        mime_type: data.photoMimeType,
        size_bytes: data.photoSizeBytes,
        ai_check_status: photoStatus,
        ai_check_notes: result.notes,
        ai_face_match_score: result.faceMatchConfidence,
      });
    }
    if (!existingKeys.has(data.idKey)) {
      toInsert.push({
        user_id: userId,
        doc_type: "govt_id",
        id_kind: data.idKind,
        storage_key: data.idKey,
        file_name: data.idFileName,
        mime_type: data.idMimeType,
        size_bytes: data.idSizeBytes,
        ai_check_status: idStatus,
        ai_check_notes: result.notes,
        ai_face_match_score: result.faceMatchConfidence,
      });
    }

    if (toInsert.length > 0) {
      const { error } = await supabaseAdmin.from("documents").insert(toInsert);
      if (error) {
        // Reject the insert, but do NOT hand the reservations back here.
        //
        // The rows were never persisted, yet the byte amount we would return is
        // the client-supplied `photoSizeBytes` / `idSizeBytes`, while the
        // reservation was taken by `uploadFile` from the server-measured
        // `file.size`. A client-controlled decrement could therefore move the
        // counters BELOW the true reservation -- the one direction ("drift low")
        // the quota design forbids (see release_upload_quota / resync_upload_quota
        // and the `resyncProfileQuota` note: re-measuring R2 is preferred over
        // decrementing by a client figure). Leaving the reservation held drifts
        // high, which is safe and recoverable: the caller's compensation path
        // owns the objects, and deleting them re-measures R2 and reconciles the
        // counters through `resyncProfileQuota`.
        throw error;
      }
    }

    return { status, result, photoKey: data.photoKey, idKey: data.idKey, alreadyPersisted: false };
  });
