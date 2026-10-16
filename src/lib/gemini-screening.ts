/**
 * Pure, dependency-free helpers for the server-side Google Gemini ID/photo
 * screen. Deliberately free of React, Supabase, env and direct network access so
 * the image decoding, request shaping, response parsing and failure mapping can
 * be exercised in isolation. The API key and the actual network call belong to
 * the server-only caller (src/lib/verify.functions.ts).
 *
 * Safety contract: every failure mode (missing key, malformed data URL,
 * network/timeout error, HTTP error, blocked candidate, non-JSON or
 * wrong-typed verdict) throws. Nothing here can fabricate a passing result, and
 * nothing logs the API key or the image bytes.
 */

/** The exact verdict shape this screen must produce, matching PreScreenResult. */
export type GeminiVerdict = {
  faceMatch: boolean;
  faceMatchConfidence: number;
  idReadable: boolean;
  photoClear: boolean;
  idType: string;
  notes: string;
};

/** A decoded inline image ready for the Gemini `inlineData` part. */
export type InlineImage = { mimeType: string; data: string };

/** A minimal fetch signature, so the network call can be injected in tests. */
export type GeminiFetch = (url: string, init: RequestInit) => Promise<Response>;

export const GEMINI_MODEL_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Default model: image-capable and available to this API key. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

export const GEMINI_TIMEOUT_MS = 30_000;

/**
 * Server-side system instruction describing the exact JSON verdict. Kept here
 * (not in the browser) so the schema and policy travel together.
 */
export const GEMINI_SYSTEM_INSTRUCTION = [
  "You verify matrimonial registrations in India.",
  "Image 1 is a government ID card scan (Aadhaar, PAN, Voter ID, Driving Licence or Passport).",
  "Image 2 is a profile photo.",
  "Judge whether the faces plausibly belong to the same person, whether the ID is readable and looks like a genuine format, and whether the profile photo is a clear single-person face photo.",
  "If the ID is unreadable or the photo is not a clear single-person face, set the matching flag to false; never guess a match.",
  "Reply with JSON only, using exactly these keys:",
  "faceMatch (boolean), faceMatchConfidence (number between 0 and 1), idReadable (boolean), photoClear (boolean), idType (string), notes (string).",
].join(" ");

const DATA_URL_PATTERN = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Decodes an image data URL (`data:image/jpeg;base64,....`) into the base64 and
 * MIME type Gemini expects. Throws for anything that is not a base64 image data
 * URL, so an unexpected client payload is rejected up front rather than being
 * sent or silently ignored.
 */
export function parseInlineImage(dataUrl: unknown): InlineImage {
  if (typeof dataUrl !== "string") throw new Error("Image payload was not a string.");
  const match = DATA_URL_PATTERN.exec(dataUrl);
  if (!match) throw new Error("Image payload was not a data URL.");
  const mimeType = (match[1] ?? "").toLowerCase();
  const isBase64 = match[2] === ";base64";
  const data = match[3] ?? "";
  if (!mimeType.startsWith("image/")) throw new Error("Image payload was not an image.");
  if (!isBase64) throw new Error("Image payload was not base64 encoded.");
  if (data === "" || !BASE64_PATTERN.test(data))
    throw new Error("Image payload was not valid base64.");
  return { mimeType, data };
}

/**
 * Builds the Gemini `generateContent` request body for a photo/ID pair. Pure so
 * tests can assert the exact image parts and JSON-mode configuration without a
 * network call.
 */
export function buildGeminiRequest(id: InlineImage, photo: InlineImage): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: GEMINI_SYSTEM_INSTRUCTION }] },
    contents: [
      {
        role: "user",
        parts: [
          { text: "Image 1 = government ID. Image 2 = profile photo." },
          { inlineData: { mimeType: id.mimeType, data: id.data } },
          { inlineData: { mimeType: photo.mimeType, data: photo.data } },
        ],
      },
    ],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  };
}

/**
 * Pulls the JSON text out of a Gemini `generateContent` response. Throws for a
 * missing/empty candidate or empty text (for example a safety block), so an
 * unreadable answer can never be treated as a verdict.
 */
export function extractGeminiText(response: unknown): string {
  if (typeof response !== "object" || response === null) {
    throw new Error("Model response was not an object.");
  }
  const candidates = (response as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("Model returned no candidates.");
  }
  const first = candidates[0] as { content?: { parts?: unknown } } | undefined;
  const parts = first?.content?.parts;
  if (!Array.isArray(parts)) throw new Error("Model returned no content.");
  const text = parts
    .map((part) =>
      part && typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .join("")
    .trim();
  if (text === "") throw new Error("Model returned no text.");
  return text;
}

/**
 * Parses and strictly validates the model's JSON verdict into `GeminiVerdict`.
 * Any missing field, wrong type, non-finite number or malformed JSON throws, so
 * a partial or unexpected answer is never coerced into a decision.
 */
export function parseGeminiVerdict(text: unknown): GeminiVerdict {
  if (typeof text !== "string" || text.trim() === "") throw new Error("Model returned no verdict.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Model verdict was not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Model verdict was not an object.");
  }
  const o = parsed as Record<string, unknown>;
  if (typeof o["faceMatch"] !== "boolean") throw new Error("Model verdict missing faceMatch.");
  if (typeof o["faceMatchConfidence"] !== "number" || !Number.isFinite(o["faceMatchConfidence"])) {
    throw new Error("Model verdict missing faceMatchConfidence.");
  }
  if (typeof o["idReadable"] !== "boolean") throw new Error("Model verdict missing idReadable.");
  if (typeof o["photoClear"] !== "boolean") throw new Error("Model verdict missing photoClear.");
  if (typeof o["idType"] !== "string") throw new Error("Model verdict missing idType.");
  if (typeof o["notes"] !== "string") throw new Error("Model verdict missing notes.");
  return {
    faceMatch: o["faceMatch"],
    faceMatchConfidence: o["faceMatchConfidence"],
    idReadable: o["idReadable"],
    photoClear: o["photoClear"],
    idType: o["idType"],
    notes: o["notes"],
  };
}

/**
 * Maps a Gemini HTTP status to a user-safe failure message, or null when the
 * status is a success. Keeps every provider error on the safe path (a thrown
 * error) rather than a fabricated verdict.
 */
export function geminiErrorForStatus(status: number): string | null {
  if (status >= 200 && status < 300) return null;
  if (status === 429) return "Too many checks right now. Please try again shortly.";
  if (status === 401 || status === 403) return "AI verification is not configured.";
  return "AI verification failed.";
}

/**
 * Runs one server-side Gemini screen for a photo/ID pair and returns the parsed,
 * strictly-validated verdict. The API key and fetch implementation are injected
 * by the server-only caller so this can be unit-tested without a network call.
 *
 * Fails safely on a missing/invalid payload, network error, timeout, non-2xx
 * status, unreadable body or schema-invalid verdict: it only ever resolves with
 * a genuinely parsed verdict, never a fabricated one.
 */
export async function requestGeminiVerdict(params: {
  idImage: string;
  photoImage: string;
  apiKey: string;
  model: string;
  fetchImpl: GeminiFetch;
  timeoutMs?: number;
}): Promise<GeminiVerdict> {
  if (!params.apiKey) throw new Error("AI verification is not configured.");
  const id = parseInlineImage(params.idImage);
  const photo = parseInlineImage(params.photoImage);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? GEMINI_TIMEOUT_MS);

  let response: Response;
  try {
    response = await params.fetchImpl(`${GEMINI_MODEL_ENDPOINT}/${params.model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": params.apiKey },
      body: JSON.stringify(buildGeminiRequest(id, photo)),
      signal: controller.signal,
    });
  } catch {
    throw new Error(
      controller.signal.aborted ? "AI verification timed out." : "AI verification is unavailable.",
    );
  } finally {
    clearTimeout(timer);
  }

  const failure = geminiErrorForStatus(response.status);
  if (failure) throw new Error(failure);

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new Error("AI verification returned an unreadable response.");
  }

  return parseGeminiVerdict(extractGeminiText(json));
}
