import { splitInternationalPhone } from "@/lib/phone";
import { COUNTRY_CODES } from "@/lib/country-codes";

export type Residency = "india" | "abroad" | "unknown";

const KNOWN_ISO = new Set(COUNTRY_CODES.map((c) => c.iso));

/**
 * Residency is derived ONLY from the member's selected/entered phone country.
 * It is NEVER inferred from IP address, browser geolocation, GPS or network
 * location.
 *
 * The country selected in the phone-country selector wins whenever it is a
 * known ISO, even if the typed number is malformed. Otherwise the country is
 * parsed from the number itself, and only when that is reliable: src/lib/phone.ts
 * falls back to DEFAULT_COUNTRY_ISO ("IN") for unparseable input, so an "IN"
 * answer is accepted only when the national part really looks like an Indian
 * mobile number. Anything else is "unknown" - India is never assumed.
 */
export function residencyFromPhone(
  phone: string | null | undefined,
  selectedIso?: string | null,
): Residency {
  const iso = (selectedIso ?? "").trim().toUpperCase();
  if (iso && KNOWN_ISO.has(iso)) return iso === "IN" ? "india" : "abroad";

  const input = (phone ?? "").trim();
  if (!input) return "unknown";

  const parsed = splitInternationalPhone(input);
  if (parsed.iso !== "IN") return "abroad";
  return /^[6-9]\d{9}$/.test(parsed.local) ? "india" : "unknown";
}

/** The single mandatory verification document per residency; null = none (unknown). */
export const MANDATORY_DOCUMENT: Record<Residency, string | null> = {
  india: "Aadhaar",
  abroad: "Passport",
  unknown: null,
};
