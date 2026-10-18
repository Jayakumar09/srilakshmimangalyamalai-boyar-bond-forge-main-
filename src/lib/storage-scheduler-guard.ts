/**
 * Fail-closed target guard for the storage-deletion scheduler.
 *
 * The scheduler can irreversibly delete R2 objects and document metadata, so it
 * must never run against anything but the TEST environment, and it must never
 * run at all unless an operator has explicitly turned it on. This module is the
 * single decision point for that; it is pure (no I/O, no side effects, no
 * logging), so it can be exercised offline and read in one screen.
 *
 * ORDER OF DEFENCE
 * ----------------
 *  1. `SLMM_SCHEDULER_ENABLED` must be exactly "1"  -- off unless turned on.
 *  2. `SLMM_SCHEDULER_TARGET`  must be exactly "test" -- production is refused
 *     by omission: a PRODUCTION allow-list entry does not exist here, so any
 *     non-TEST target is rejected rather than specifically matched.
 *  3. `SUPABASE_URL` must parse to the exact TEST project host -- compared as
 *     an equal hostname, never by substring, so `test.supabase.co.evil.tld`
 *     and `xtest...supabase.co` both fail.
 *  4. `R2_BUCKET_NAME` must equal the exact TEST bucket -- likewise no prefix
 *     or substring match.
 *  5. Every credential the run needs must be present (presence only, never a
 *     value, and never a length or hash).
 *
 * DENIAL REPORTING
 * ----------------
 * A refusal returns stable reason codes plus per-check names. No environment
 * value, length or hash is ever included, so the result is safe to log.
 *
 * This file intentionally names only the TEST project host and TEST bucket. It
 * must not reference the production project or bucket, so that a PRODUCTION
 * build (which never bundles this module) and the TEST build-target check can
 * both verify that the production identifiers are absent from TEST output.
 */

/** The only Supabase project host this scheduler may ever touch. */
const TEST_SUPABASE_HOST = "nqadtfqyurkpmxcodswc.supabase.co";

/** The only R2 bucket this scheduler may ever touch. */
const TEST_R2_BUCKET = "srilakshmimangalyamalai-test";

/** Literal opt-in value required for the operator switch to be "on". */
const REQUIRED_ENABLED = "1";

/** Literal target value required for the target switch to select TEST. */
const REQUIRED_TARGET = "test";

/** Credentials (and the endpoint) the run cannot proceed without. */
export const SCHEDULER_CREDENTIAL_KEYS = Object.freeze([
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
]);

/** Every environment key this guard reads; used to project a bindings view. */
export const SCHEDULER_ENV_KEYS = Object.freeze([
  "SLMM_SCHEDULER_ENABLED",
  "SLMM_SCHEDULER_TARGET",
  "R2_BUCKET_NAME",
  ...SCHEDULER_CREDENTIAL_KEYS,
]);

/** A string-keyed environment view (Cloudflare bindings, `process.env`, or a test double). */
export type SchedulerEnv = Record<string, string | undefined>;

export type SchedulerGuardCheck = {
  name: string;
  ok: boolean;
  detail: string | null;
};

export type SchedulerGuardDecision = {
  allowed: boolean;
  /** Stable machine-readable denial codes; empty when allowed. */
  reasons: string[];
  checks: SchedulerGuardCheck[];
};

/** Reads a non-empty string, or `null` for anything else (including non-strings). */
function readValue(env: SchedulerEnv, key: string): string | null {
  const value = env[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Parses an https URL with no port/credentials; returns its lowercased host or null. */
function readHttpsHost(url: string | null): string | null {
  if (url === null) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    if (parsed.port !== "") return null;
    if (parsed.username !== "" || parsed.password !== "") return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Decides whether the scheduler may touch the configured environment.
 *
 * Pure and total: never throws, never logs, never reads anything but `env`.
 */
export function evaluateSchedulerTarget(env: SchedulerEnv): SchedulerGuardDecision {
  // Hostile or absent input is treated as an empty environment, so the guard is
  // total: it always answers, and it always refuses when it cannot verify.
  const view: SchedulerEnv = env && typeof env === "object" ? env : {};
  const checks: SchedulerGuardCheck[] = [];
  const reasons: string[] = [];
  const record = (name: string, ok: boolean, reason: string, detail: string | null = null) => {
    checks.push({ name, ok, detail });
    if (!ok) reasons.push(reason);
  };

  record(
    "SLMM_SCHEDULER_ENABLED=1",
    readValue(view, "SLMM_SCHEDULER_ENABLED") === REQUIRED_ENABLED,
    "scheduler_disabled",
    "set SLMM_SCHEDULER_ENABLED=1 to arm the scheduler (the default is off)",
  );

  record(
    "SLMM_SCHEDULER_TARGET=test",
    readValue(view, "SLMM_SCHEDULER_TARGET") === REQUIRED_TARGET,
    "target_not_test",
    "set SLMM_SCHEDULER_TARGET=test; only the TEST target is accepted",
  );

  record(
    "SUPABASE_URL is the TEST project",
    readHttpsHost(readValue(view, "SUPABASE_URL")) === TEST_SUPABASE_HOST,
    "supabase_host_not_test",
    "SUPABASE_URL must be exactly the TEST project URL (https, no port)",
  );

  record(
    "R2_BUCKET_NAME is the TEST bucket",
    readValue(view, "R2_BUCKET_NAME") === TEST_R2_BUCKET,
    "bucket_not_test",
    "R2_BUCKET_NAME must exactly equal the TEST bucket",
  );

  const missing = SCHEDULER_CREDENTIAL_KEYS.filter((key) => readValue(view, key) === null);
  record(
    "required credentials are present",
    missing.length === 0,
    "credentials_missing",
    missing.length === 0 ? null : `missing (names only): ${missing.join(", ")}`,
  );

  return { allowed: reasons.length === 0, reasons, checks };
}
