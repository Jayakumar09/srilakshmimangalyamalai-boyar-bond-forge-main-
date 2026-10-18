/**
 * TEST-only storage-deletion scheduler.
 *
 * Invokes the existing `processStorageDeletionRequests` batch processor from a
 * Cloudflare scheduled event. This module contains the schedule and batch
 * policy in exactly one place so both are easy to review and change:
 *
 *   SCHEDULER_CRON        -- the cron trigger this scheduler answers to
 *   SCHEDULER_BATCH_LIMIT -- how many deletions one run may claim
 *
 * ORDERING
 * --------
 * The guard runs FIRST and the batch processor is not called at all when the
 * guard refuses, so a misconfigured or production-pointing environment can
 * never reach a privileged RPC, an R2 DELETE or a quota write. The guard also
 * runs before any log line that could otherwise look like a successful run.
 *
 * FAIL-CLOSED LOGGING
 * -------------------
 * One structured JSON line is emitted per run. It contains only counts, enum
 * codes and stable reason codes -- never a credential value, a storage key, an
 * owner id or an upstream error message.
 *
 * ENVIRONMENT SOURCES
 * -------------------
 * Two projections, one per call path:
 *
 *   collectSchedulerBindings -- the Cloudflare scheduled event: `event.env`
 *                               bindings ONLY, never `process.env`. Missing,
 *                               empty or incomplete bindings project to an
 *                               incomplete view, which the guard refuses.
 *   collectSchedulerEnv      -- direct local/operator runs: bindings when
 *                               given, ambient fallback otherwise.
 *
 * Whichever view is produced is handed to the guard AND to the processor as
 * the same object, so the validated configuration and the operated
 * configuration cannot diverge.
 *
 * SCHEDULER_CRON and SCHEDULER_BATCH_LIMIT are duplicated as literals in
 * `.config/nitro.config.mjs` (which installs the Cloudflare cron trigger) and
 * SCHEDULER_CRON again in `scripts/check-build-target.mjs` (which verifies the
 * built config). An offline suite pins all three so they cannot drift.
 */
import { processStorageDeletionRequests, type StorageDeletionDiagnostics } from "./storage.functions";
import {
  evaluateSchedulerTarget,
  SCHEDULER_ENV_KEYS,
  type SchedulerEnv,
} from "./storage-scheduler-guard";

/** The only cron expression this scheduler acts on. Keep in sync with nitro.config.mjs. */
export const SCHEDULER_CRON = "*/15 * * * *";

/** Maximum number of deletions claimed per run. */
export const SCHEDULER_BATCH_LIMIT = 10;

/** Stable log event name; also the marker pinned by scripts/check-build-target.mjs. */
export const SCHEDULER_LOG_EVENT = "storage-deletion-scheduler";

/** Terminal state of one scheduler run. */
export type SchedulerOutcome = "ok" | "partial" | "refused" | "error";

export type SchedulerRunResult = {
  outcome: SchedulerOutcome;
  cron: string | null;
  processed: number;
  quotaResyncs: number;
  /** Stable reason codes: guard denials, `cron_mismatch`, or `scheduler_error`. */
  reasons: string[];
  /** Counts/codes from the pass, or `null` when the processor never ran. */
  diagnostics: StorageDeletionDiagnostics | null;
};

/** A structured-log sink. Injected so tests can capture lines without a console. */
export type SchedulerLogger = (line: string) => void;

/**
 * Builds the environment view for a DIRECT (local/operator) run.
 *
 * Cloudflare bindings are authoritative when present (they are the runtime's own
 * truth); the ambient `process.env` is only a fallback, which lets the same
 * module be exercised by the operator locally. Nothing is mutated and nothing is
 * persisted, so no credential state outlives the call.
 *
 * This is NOT the scheduled-event path: the Cloudflare `scheduled` handler
 * projects its view with `collectSchedulerBindings`, which never falls back, so
 * a scheduled run can never be supplemented with ambient credentials.
 */
export function collectSchedulerEnv(bindings?: SchedulerEnv): SchedulerEnv {
  const ambient = process.env as SchedulerEnv;
  const view: SchedulerEnv = {};
  for (const key of SCHEDULER_ENV_KEYS) {
    const bound = bindings?.[key];
    if (typeof bound === "string" && bound.length > 0) {
      view[key] = bound;
    } else if (typeof ambient[key] === "string") {
      view[key] = ambient[key];
    }
  }
  return view;
}

/**
 * Projects the environment view for the Cloudflare scheduled-event path.
 *
 * BINDINGS ONLY -- this function never reads `process.env`. A scheduled
 * storage-deletion run must operate on exactly the bindings the runtime handed
 * to the event: an incomplete binding set is a misconfiguration to be REFUSED
 * by the guard, never something to quietly complete with unrelated ambient
 * credentials. Whatever this returns is, by construction, the same view the
 * guard validates and the same view the processor receives as its explicit
 * credential source.
 *
 * Only whitelisted scheduler keys are copied, and only as non-empty strings:
 * an empty binding is indistinguishable from an absent one, so both are
 * dropped and surface to the guard as missing (which refuses). The function is
 * total -- it never throws; when the binding source is unreadable the view
 * necessarily comes back incomplete, and an incomplete view is refused.
 */
export function collectSchedulerBindings(bindings?: SchedulerEnv | null): SchedulerEnv {
  const view: SchedulerEnv = {};
  try {
    const source = bindings && typeof bindings === "object" ? bindings : {};
    for (const key of SCHEDULER_ENV_KEYS) {
      const bound = source[key];
      if (typeof bound === "string" && bound.length > 0) view[key] = bound;
    }
  } catch {
    // A hostile or unreadable binding source projects only what was read
    // before the failure -- necessarily incomplete, so the guard refuses.
  }
  return view;
}

/**
 * Runs one scheduler pass.
 *
 * Never throws: every failure is reported as a result and a log line, because a
 * scheduled handler must not surface an unhandled rejection to the runtime.
 */
export async function runStorageDeletionScheduler(input: {
  cron?: string | null;
  /**
   * The environment view to validate and run with. The scheduled-event path
   * supplies `collectSchedulerBindings(event.env)`; when omitted (direct
   * local invocation only) the ambient projection is used.
   */
  env?: SchedulerEnv;
  logger?: SchedulerLogger;
} = {}): Promise<SchedulerRunResult> {
  const logger = input.logger ?? ((line: string) => console.log(line));
  const cron = typeof input.cron === "string" ? input.cron : null;

  const report = (result: SchedulerRunResult): SchedulerRunResult => {
    logger(JSON.stringify({ event: SCHEDULER_LOG_EVENT, ...result, batchLimit: SCHEDULER_BATCH_LIMIT }));
    return result;
  };

  const refused = (reasons: string[]): SchedulerRunResult =>
    report({ outcome: "refused", cron, processed: 0, quotaResyncs: 0, reasons, diagnostics: null });

  // Only the event this scheduler installed may trigger work. Checked before the
  // guard so an unrelated cron firing can never reach any privileged call.
  if (cron !== SCHEDULER_CRON) return refused(["cron_mismatch"]);

  // The exact view the guard validated is handed to the processor, so the
  // credentials that get used for RPCs and R2 are provably the ones that were
  // checked -- not a separately-read ambient set that could differ.
  // The scheduled-event path always supplies `env` (a bindings-only projection
  // of `event.env`), so the ambient fallback below is reachable only by a
  // direct invocation that passed no env at all.
  const validatedEnv = input.env ?? collectSchedulerEnv();
  const decision = evaluateSchedulerTarget(validatedEnv);
  if (!decision.allowed) return refused(decision.reasons);

  try {
    const pass = await processStorageDeletionRequests({
      limit: SCHEDULER_BATCH_LIMIT,
      credentials: validatedEnv,
    });
    return report({
      outcome: pass.diagnostics.ok ? "ok" : "partial",
      cron,
      processed: pass.processed,
      quotaResyncs: pass.quotaResyncs,
      reasons: [],
      diagnostics: pass.diagnostics,
    });
  } catch {
    // The message is deliberately dropped: it may embed a URL, key or row id.
    return report({
      outcome: "error",
      cron,
      processed: 0,
      quotaResyncs: 0,
      reasons: ["scheduler_error"],
      diagnostics: null,
    });
  }
}
