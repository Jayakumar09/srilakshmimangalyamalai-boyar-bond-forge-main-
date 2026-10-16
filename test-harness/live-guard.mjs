// test-harness/live-guard.mjs
// ---------------------------------------------------------------------------
// Phase 5B - fail-closed authorization gate for LIVE test harnesses.
//
// Guarantees:
//  * Default is REFUSE. A live harness does nothing unless the operator opts in
//    explicitly, from the shell, with a per-harness acknowledgement.
//  * PRODUCTION IS UNCONDITIONALLY PROHIBITED. There is no override flag: a
//    production project ref is always refused, both at authorization time and
//    again after the environment file is read.
//  * Dependency-free and performs NO I/O, so a harness can (and must) call the
//    gate BEFORE loading credentials, launching a browser, constructing a
//    service client, or making any network request.
//  * Never prints credential values. Only environment variable NAMES and the
//    public (non-secret) Supabase project refs are ever emitted.
//
// Intended use from a live harness (as the first active statements):
//   requireLiveAuthorization({ harness: "slmm-x-test.mjs", services: ["supabase-rest"] });
//   // ...only after the gate may the harness load credentials...
//   const url = ENV.SUPABASE_URL;
//   assertNonProductionTarget(url, { harness: "slmm-x-test.mjs" });
// ---------------------------------------------------------------------------

// The only place in test-harness/ that may name the production project.
// `scripts/check-build-target.mjs` pins the same two refs; the offline safety
// suite asserts they still agree so the guard cannot silently drift.
export const SUPABASE_PROJECT_REFS = Object.freeze({
  test: "nqadtfqyurkpmxcodswc",
  prod: "sxpkutjkqfekqwpabgrk",
});

const REQUIRED_LIVE_TESTS = "true";
const REQUIRED_LIVE_TARGET = "test";

// Extract the Supabase project ref from a URL and classify it.
//   kind: "test" | "prod" | "unknown" | "invalid"
export function projectRefOf(url) {
  if (typeof url !== "string" || url.trim() === "") return { ref: null, kind: "invalid", host: null };
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return { ref: null, kind: "invalid", host: null };
  }
  const m = /^([a-z0-9]{20})\.supabase\.co$/i.exec(host);
  const ref = m ? m[1].toLowerCase() : null;
  if (!ref) return { ref: null, kind: "unknown", host };
  if (ref === SUPABASE_PROJECT_REFS.prod) return { ref, kind: "prod", host };
  if (ref === SUPABASE_PROJECT_REFS.test) return { ref, kind: "test", host };
  return { ref, kind: "unknown", host };
}

// Pure decision function (no side effects) so it can be unit-tested offline.
// Returns { allowed, harness, services, reasons, checks }.
export function evaluateLiveAuthorization(env = {}, { harness = "", services = [] } = {}) {
  const reasons = [];
  const checks = [];
  const record = (name, ok, detail) => {
    checks.push({ name, ok, detail: detail ?? null });
    if (!ok) reasons.push(detail || name);
  };

  record(
    "harness declared",
    typeof harness === "string" && harness.length > 0,
    "no harness name was supplied to the live authorization gate",
  );

  record(
    "SLMM_LIVE_TESTS=true",
    env.SLMM_LIVE_TESTS === REQUIRED_LIVE_TESTS,
    "SLMM_LIVE_TESTS must equal 'true' to authorize a live run (the default is refuse)",
  );

  record(
    "SLMM_LIVE_TARGET=test",
    env.SLMM_LIVE_TARGET === REQUIRED_LIVE_TARGET,
    env.SLMM_LIVE_TARGET === "prod"
      ? "SLMM_LIVE_TARGET=prod: production is unconditionally prohibited"
      : "SLMM_LIVE_TARGET must equal 'test' (production is unconditionally prohibited)",
  );

  record(
    "per-harness acknowledgement",
    env.SLMM_LIVE_ACK === harness,
    `SLMM_LIVE_ACK must exactly equal the harness name '${harness}'`,
  );

  // If the ambient environment already names a Supabase URL, refuse outright
  // when it resolves to production. (A harness that reads its own environment
  // file is additionally guarded by assertNonProductionTarget after the read.)
  const ambient = projectRefOf(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "");
  record(
    "ambient target is not production",
    ambient.kind !== "prod",
    "SUPABASE_URL points at the PRODUCTION project: production is unconditionally prohibited",
  );

  return { allowed: reasons.length === 0, harness, services, reasons, checks };
}

// Throwing gate for harnesses. Refuses (exit code 2) unless every check passes.
export function requireLiveAuthorization({ harness, services = [] } = {}) {
  const decision = evaluateLiveAuthorization(process.env, { harness, services });
  if (!decision.allowed) {
    console.error("");
    console.error("REFUSED: live test harness is not authorized to run.");
    console.error(`  harness : ${harness || "(none)"}`);
    console.error("  This harness talks to a live Supabase project and is OFF by default.");
    console.error("  To authorize an explicitly intended TEST run, set all three, e.g.:");
    console.error(
      `    SLMM_LIVE_TESTS=true SLMM_LIVE_TARGET=test SLMM_LIVE_ACK=${harness || "<harness>"} ` +
        `node test-harness/${harness || "<harness>"}`,
    );
    console.error("  Reasons it was refused:");
    for (const r of decision.reasons) console.error(`    - ${r}`);
    console.error("  Production is unconditionally prohibited; there is no override.");
    console.error("");
    process.exit(2);
  }
  const svcList = decision.services.length ? decision.services.join(", ") : "n/a";
  console.log(`live authorization GRANTED for ${harness} (target=test, services=${svcList})`);
  return decision;
}

// Post-load target check: called AFTER the environment file is read, with the
// resolved URL. Throws (aborting the run before anything is created) unless the
// URL is the TEST project. Production is always refused.
export function assertNonProductionTarget(url, { harness = "harness" } = {}) {
  const parsed = projectRefOf(url);
  if (parsed.kind === "prod") {
    throw new Error(
      `refusing to run ${harness}: SUPABASE_URL targets the PRODUCTION project (${parsed.ref}); ` +
        "production is unconditionally prohibited",
    );
  }
  if (parsed.kind !== "test") {
    throw new Error(
      `refusing to run ${harness}: SUPABASE_URL is not the TEST project ` +
        `(got ${parsed.ref ?? "unparseable"}); only ${SUPABASE_PROJECT_REFS.test} is permitted`,
    );
  }
  return parsed;
}
