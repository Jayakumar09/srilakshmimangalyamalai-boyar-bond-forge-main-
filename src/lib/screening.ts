/**
 * Pure registration-screening policy: the approved mandatory government-ID
 * kinds and the photo/ID screening decision. Deliberately free of React,
 * Supabase, network and env imports so it can be exercised in isolation.
 */

export type Residency = "india" | "abroad" | "unknown";

/**
 * The government ID kinds a member may use as their mandatory verification
 * document. India accepts any ONE of these; abroad the Passport-only rule is
 * preserved by the wizard.
 */
export const APPROVED_MANDATORY_ID_KINDS = [
  "Aadhaar",
  "PAN",
  "Voter ID",
  "Driving Licence",
  "Passport",
] as const;

export function isApprovedMandatoryIdKind(kind: string): boolean {
  return (APPROVED_MANDATORY_ID_KINDS as readonly string[]).includes(kind);
}

/**
 * Approved mandatory ID kinds per residency. India accepts any one of the five
 * (never Aadhaar alone); abroad keeps Passport only; "unknown" = none until the
 * phone country is determinable.
 */
export const MANDATORY_DOCUMENT_KINDS: Record<Residency, readonly string[] | null> = {
  india: [...APPROVED_MANDATORY_ID_KINDS],
  abroad: ["Passport"],
  unknown: null,
};

export type ScreenedPairStatus = "pass" | "review" | "blocked";

/** The subset of a model verdict that drives the persistence decision. */
export type ScreeningVerdict = {
  faceMatch: boolean;
  idReadable: boolean;
  photoClear: boolean;
};

/**
 * The single decision rule for a screened photo + ID pair:
 *   * unreadable ID or unclear photo -> "blocked" (never persisted)
 *   * readable + clear, faces matched -> "pass"
 *   * readable + clear, faces NOT matched -> "review" (admin review required)
 *
 * An unavailable or inconclusive verdict is handled by the caller as a thrown
 * error, so this function can never yield "pass" from a missing answer.
 */
export function decideScreenedPair(result: ScreeningVerdict): ScreenedPairStatus {
  if (!result.idReadable || !result.photoClear) return "blocked";
  return result.faceMatch ? "pass" : "review";
}

/**
 * Percent-decodes a stored-key candidate, or returns null when the encoding is
 * malformed. A key with no "%" is already decoded. Genuine keys are written by
 * the upload helper's `sanitize` (only `[a-zA-Z0-9._-]`), so no real key
 * contains "%" and refusing broken escapes costs nothing.
 */
function decodeStorageKey(key: string): string | null {
  if (!key.includes("%")) return key;
  try {
    return decodeURIComponent(key);
  } catch {
    return null;
  }
}

/**
 * True when `key` is owned by `userId` and cannot escape that owner's prefix.
 *
 * The owner test is a string prefix, but URL parsing collapses dot segments, so
 * `<me>/../<them>/photo/x.jpg` would satisfy `startsWith("<me>/")` and then
 * resolve to another member's object. URL parsing also recognises dot segments
 * after decoding, so `%2e%2e`, `%2E%2E`, `%2e.` and `.%2e` are checked on the
 * DECODED form. Only a segment that is entirely "." or ".." is refused, so
 * filenames that merely contain dots (`report..final.pdf`) stay valid.
 */
export function isOwnedStorageKey(key: string, userId: string): boolean {
  if (!key || !userId) return false;
  const decoded = decodeStorageKey(key);
  if (decoded === null) return false;
  if (!decoded.startsWith(`${userId}/`)) return false;
  return decoded.split("/").every((segment) => segment !== "." && segment !== "..");
}

/**
 * The inputs a screened photo/ID pair depends on: the selected photo file, the
 * mandatory ID file and its kind. Compared by reference because the wizard
 * holds the same File objects until the member picks new ones.
 */
export type ScreenedPairInputs = {
  photo: unknown;
  idFile: unknown;
  idKind: string;
};

/**
 * True when a cached screening still describes the CURRENT inputs. Any change
 * to the photo, the mandatory ID file or its kind must invalidate the cached
 * pair so it is re-uploaded and re-screened rather than reused.
 */
export function inputsMatchScreened(
  cached: ScreenedPairInputs | null,
  current: ScreenedPairInputs,
): boolean {
  if (!cached) return false;
  return (
    cached.photo === current.photo &&
    cached.idFile === current.idFile &&
    cached.idKind === current.idKind
  );
}

/**
 * True for the ai_check_status values the trusted screening write produces. The
 * client guard forces ai_check_status to NULL on a member INSERT and forbids
 * changing it on UPDATE, so these values can only come from the service-role
 * screening path (or a trusted admin), never from the browser.
 */
export function isScreenedPairStatus(value: string | null | undefined): boolean {
  return value === "pass" || value === "review";
}

export type PersistedPairSummary = {
  alreadyPersisted: boolean;
  status: ScreenedPairStatus | null;
};

/**
 * Summarises an already-persisted photo/ID pair from the stored ai_check_status
 * of its two rows, so a retry can skip re-screening without losing truth:
 *   * `alreadyPersisted` is true only when BOTH rows carry a screening status,
 *     which the client guard guarantees can only have been written by the
 *     trusted path.
 *   * the summary is never "blocked" -- a blocked pair is never persisted.
 *   * the summary can be "pass" only when BOTH stored rows are "pass", so a
 *     replay can never upgrade an earlier "review" to a "pass".
 */
export function summarizePersistedPair(
  photoStatus: string | null | undefined,
  idStatus: string | null | undefined,
): { alreadyPersisted: boolean; status: ScreenedPairStatus | null } {
  const photoScreened = isScreenedPairStatus(photoStatus);
  const idScreened = isScreenedPairStatus(idStatus);
  if (!photoScreened || !idScreened) {
    return { alreadyPersisted: false, status: null };
  }
  return {
    alreadyPersisted: true,
    status: photoStatus === "pass" && idStatus === "pass" ? "pass" : "review",
  };
}

/** A neutral document row, identified for retry-skip by type and id kind. */
export type NeutralDocKey = { doc_type: string; id_kind: string | null };

function neutralDocIdentity(doc: NeutralDocKey): string {
  return `${doc.doc_type}\u0000${doc.id_kind ?? ""}`;
}

/**
 * The wanted neutral documents (optional IDs and the divorce document) that are
 * not already on file, so a retry inserts only what is still missing instead of
 * duplicating rows that a previous attempt already wrote.
 */
export function missingNeutralDocs<T extends NeutralDocKey>(
  existing: readonly NeutralDocKey[],
  wanted: readonly T[],
): T[] {
  const present = new Set(existing.map(neutralDocIdentity));
  return wanted.filter((doc) => !present.has(neutralDocIdentity(doc)));
}

/**
 * The subset of `keys` that is safe to delete after a failed operation: keys
 * the member owns and that no stored document row references. This is what
 * stops cleanup from ever deleting an object that a persisted document points
 * at (for example the screened pair that a retry is about to reuse) or another
 * member's object. Read-then-skip is not atomic.
 */
export function keysSafeToDelete(
  keys: readonly string[],
  referencedKeys: Iterable<string>,
  userId: string,
): string[] {
  const referenced = new Set(referencedKeys);
  const seen = new Set<string>();
  const safe: string[] = [];
  for (const key of keys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!isOwnedStorageKey(key, userId)) continue;
    if (referenced.has(key)) continue;
    safe.push(key);
  }
  return safe;
}
