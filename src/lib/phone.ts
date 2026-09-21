import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { COUNTRY_CODES, DEFAULT_COUNTRY_ISO } from "@/lib/country-codes";

const DIAL_BY_ISO = new Map(COUNTRY_CODES.map((c) => [c.iso, c.code]));

/** National dialling code for an ISO region, e.g. "+91" for "IN". */
function dialForIso(iso: string): string {
  return DIAL_BY_ISO.get(iso.toUpperCase()) ?? "";
}

function digitsOnly(raw: string | number | null | undefined): string {
  return raw == null ? "" : String(raw).replace(/\D/g, "");
}

/**
 * Normalizes a national phone number for the given ISO country to E.164,
 * e.g. ("IN", "8940735144") -> "+918940735144", ("AE", "0501234567") -> "+971501234567".
 *
 * Validation follows libphonenumber-js metadata for the selected country, so the
 * required length varies per country (never a hard-coded 10). A stray country
 * code typed into the number input (e.g. "918940735144" while India is selected)
 * is stripped so the dial code is never stored twice.
 *
 * Returns null when the value cannot match the country's numbering rules.
 */
export function normalizeInternationalPhone(
  iso: string,
  raw: string | number | null | undefined,
): string | null {
  const region = iso.trim().toUpperCase();
  let digits = digitsOnly(raw);
  if (!digits) return null;

  const dial = digitsOnly(dialForIso(region));
  if (dial && digits.length > dial.length && digits.startsWith(dial)) {
    digits = digits.slice(dial.length);
  }

  const pn = parsePhoneNumberFromString(digits, region as CountryCode);
  if (!pn || !pn.isPossible()) return null;
  return pn.number ?? null;
}

/**
 * Splits a stored value into the ISO country and its national part for use with
 * the country-code picker:
 *   "+918940735144" -> { iso: "IN", local: "8940735144" }
 *   "+12025550100"  -> { iso: "US", local: "2025550100" }
 * Unparseable or empty values leave the raw text in `local` and default to the
 * preferred country (no data loss).
 */
export function splitInternationalPhone(
  raw: string | number | null | undefined,
): { iso: string; local: string } {
  const input = raw == null ? "" : String(raw).trim();
  if (!input) return { iso: DEFAULT_COUNTRY_ISO, local: "" };

  const pn = parsePhoneNumberFromString(input);
  if (pn?.country) {
    return { iso: pn.country, local: pn.nationalNumber };
  }

  const digits = digitsOnly(input);
  let local = digits;
  if (digits.length === 12 && digits.startsWith("91")) {
    local = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    local = digits.slice(1);
  }
  return /^[6-9]\d{9}$/.test(local)
    ? { iso: "IN", local }
    : { iso: DEFAULT_COUNTRY_ISO, local: input };
}

/**
 * Human-readable international form via libphonenumber-js, e.g.
 *   "+918940735144" -> "+91 89407 35144"
 *   "+971501234567" -> "+971 50 123 4567"
 *   "+12025550100"  -> "+1 202 555 0100"
 * Values that cannot be parsed (legacy/partial) fall back to a best-effort
 * Indian-friendly formatting and never change the stored data.
 */
export function formatPhoneForDisplay(raw: string | number | null | undefined): string {
  const input = raw == null ? "" : String(raw);
  if (!input.trim()) return "";

  const pn = parsePhoneNumberFromString(input);
  if (pn) return pn.formatInternational();

  const digits = digitsOnly(input);
  let local = digits;
  if (digits.length === 12 && digits.startsWith("91")) {
    local = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    local = digits.slice(1);
  }
  return /^[6-9]\d{9}$/.test(local) ? `+91 ${local}` : input;
}

export interface SplitPhone {
  iso: string;
  local: string;
}

/**
 * Backward-compatible alias kept for consumers that still pass a raw Indian
 * number (with or without "+91"). New code should use normalizeInternationalPhone.
 */
export function normalizeIndianPhone(raw: string | number | null | undefined): string | null {
  return normalizeInternationalPhone("IN", raw);
}

/** Backward-compatible alias for splitInternationalPhone. */
export function splitIndianPhone(raw: string | number | null | undefined): SplitPhone {
  return splitInternationalPhone(raw);
}