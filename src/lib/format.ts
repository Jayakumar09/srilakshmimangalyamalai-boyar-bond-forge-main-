function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function to12Hour(h: number, m: number): string {
  const suffix = h < 12 ? "AM" : "PM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${pad2(hh)}:${pad2(m)} ${suffix}`;
}

const TIME_24 = /^\s*(\d{1,2}):([0-5]\d)(?::\d{1,2})?\s*(am|pm)?\s*$/i;
const TIME_12_TEXT = /^\s*(\d{1,2})\s*(am|pm)\s*$/i;
const TIME_HHMM = /^\s*([01]?\d|2[0-3])([0-5]\d)\s*$/;
const BARE_HOUR = /^\s*(\d{1,2})\s*$/;
const STRICT_TIME_12 = /^(0[1-9]|1[0-2]):[0-5]\d (AM|PM)$/;

/**
 * Strict "HH:MM AM/PM" check used at input time. HH 01-12, MM 00-59, the
 * separator is exactly ":", and the period is exactly "AM"/"PM". Rejects
 * "6.30", "6-30", "6am" or "123" - only canonical forms are accepted.
 */
export function isValidBirthTimeStrict(raw: string | number | null | undefined): boolean {
  const s = raw == null ? "" : String(raw).trim().toUpperCase();
  return STRICT_TIME_12.test(s);
}

/**
 * Returns the canonical "HH:MM AM/PM" storage form when the value is strictly
 * valid, otherwise null (callers treat null as an input error).
 */
export function canonicalBirthTime(raw: string | number | null | undefined): string | null {
  const s = raw == null ? "" : String(raw).trim().toUpperCase();
  return STRICT_TIME_12.test(s) ? s : null;
}

export type BirthTimeSource = "time24" | "time12text" | "hhmm" | "bare_hour";

export interface ParsedBirthTime {
  h: number;
  m: number;
  hasPeriod: boolean;
  source: BirthTimeSource;
}

/**
 * Parses a birth time into hours/minutes without guessing.
 * "1145"/"1445" (legacy HHMM with no colon) are read as explicit hour+minute.
 * A bare hour ("11") yields source "bare_hour" so callers can avoid guessing AM/PM.
 * Returns null for unparseable input.
 */
export function parseBirthTime(raw: string | number | null | undefined): ParsedBirthTime | null {
  const input = raw == null ? "" : String(raw);
  const s = input.trim();
  if (!s) return null;

  let m = TIME_24.exec(s);
  if (m) {
    let h = Number(m[1]!);
    const minute = Number(m[2]!);
    if (h > 23) return null;
    const ampm = m[3]?.toLowerCase();
    if (ampm === "am" && h === 12) h = 0;
    else if (ampm === "pm" && h < 12) h += 12;
    return { h, m: minute, hasPeriod: ampm === "am" || ampm === "pm", source: "time24" };
  }

  m = TIME_12_TEXT.exec(s);
  if (m) {
    let h = Number(m[1]);
    if (h < 1 || h > 12) return null;
    const ampm = m[2]!.toLowerCase();
    if (ampm === "am" && h === 12) h = 0;
    else if (ampm === "pm" && h < 12) h += 12;
    return { h, m: 0, hasPeriod: true, source: "time12text" };
  }

  m = TIME_HHMM.exec(s);
  if (m) {
    return { h: Number(m[1]!), m: Number(m[2]!), hasPeriod: false, source: "hhmm" };
  }

  m = BARE_HOUR.exec(s);
  if (m) {
    const h = Number(m[1]!);
    if (h < 1 || h > 24) return null;
    return { h: h === 24 ? 0 : h, m: 0, hasPeriod: false, source: "bare_hour" };
  }

  return null;
}

/**
 * Normalizes a birth time to its canonical storage/display form "HH:MM AM/PM":
 *   "06:30"    -> "06:30 AM"
 *   "14:45"    -> "02:45 PM"
 *   "1145"     -> "11:45 AM"  (legacy HHMM)
 *   "06:30 AM" -> "06:30 AM"
 *   "02:45 PM" -> "02:45 PM"
 *   "12am"     -> "12:00 AM"
 *   "11"       -> "11:00"     (bare hour, period not guessed)
 * Returns null for unparseable input.
 */
export function normalizeBirthTime(raw: string | number | null | undefined): string | null {
  const parsed = parseBirthTime(raw);
  if (!parsed) return null;
  if (parsed.source === "bare_hour") return `${pad2(parsed.h)}:00`;
  return to12Hour(parsed.h, parsed.m);
}

/**
 * Display form of a stored birth time. Returns the normalized "HH:MM AM/PM"
 * when parseable, otherwise the raw legacy value as stored ("12am", "11", etc.).
 */
export function formatBirthTime(raw: string | number | null | undefined): string {
  const input = raw == null ? "" : String(raw);
  const n = normalizeBirthTime(input);
  return n ?? input.trim();
}

/**
 * Value for a native <input type="time"> (24-hour "HH:MM"):
 *   "1145"  -> "11:45"
 *   "12am"  -> "00:00"
 *   "11"    -> "11:00"
 *   ""      -> ""
 */
export function birthTimeToInputValue(raw: string | number | null | undefined): string {
  const parsed = parseBirthTime(raw);
  if (!parsed) return "";
  return `${pad2(parsed.h)}:${pad2(parsed.m)}`;
}