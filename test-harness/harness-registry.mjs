// test-harness/harness-registry.mjs
// ---------------------------------------------------------------------------
// Phase 5B - single source of truth for test-harness classification.
//
// There is NO discovery by glob anywhere in the tooling: a harness must be
// listed here, or the offline safety suite FAILS CLOSED. Adding a new file
// without classifying it therefore breaks the build instead of silently
// joining (or escaping) a test run.
//
//   OFFLINE_SUITES       run by `npm test` via scripts/run-offline-tests.mjs.
//                        Must never access a network, database or credential.
//   LIVE_HARNESSES       talk to a live Supabase project. Never wired to any
//                        npm script; each must pass live-guard.mjs first.
//   HELPER_MODULES       imported libraries with no side effects of their own.
//   LIVE_SQL_HARNESSES   .sql scripts that require an operator-supplied psql
//                        session. Not executable from Node at all.
// ---------------------------------------------------------------------------

// note: image-opt-tests.mjs spawns the LOCAL TypeScript compiler to build a
// fixture bundle; that is a local toolchain call, not a service call.
export const OFFLINE_SUITES = Object.freeze([
  { file: "image-opt-tests.mjs", runner: "node", note: "spawns local tsc only" },
  { file: "slmm-capture-tests.mjs", runner: "node" },
  { file: "slmm-delivery-mock-tests.mjs", runner: "node" },
  { file: "slmm-elite-code-tests.mjs", runner: "node" },
  { file: "slmm-safety-tests.mjs", runner: "node" },
  { file: "slmm-dashboard-upload-tests.mjs", runner: "node-test" },
  { file: "slmm-delete-upload-tests.mjs", runner: "node-test" },
  { file: "slmm-document-reference-contract-tests.mjs", runner: "node-test" },
  { file: "slmm-storage-key-tests.mjs", runner: "node-test" },
  { file: "slmm-orphan-cleanup-tests.mjs", runner: "node-test" },
  { file: "slmm-quota-release-tests.mjs", runner: "node-test" },
  { file: "slmm-screened-pair-quota-tests.mjs", runner: "node-test" },
  { file: "slmm-upload-cap-tests.mjs", runner: "node-test" },
  { file: "slmm-sql-contract-tests.mjs", runner: "node-test" },
  { file: "slmm-quota-sql-contract-tests.mjs", runner: "node-test" },
  { file: "slmm-harness-safety-tests.mjs", runner: "node-test" },
  { file: "slmm-rest-baseline-tests.mjs", runner: "node-test" },
]);

export const LIVE_HARNESSES = Object.freeze([
  {
    file: "slmm-comm-test.mjs",
    services: ["supabase-auth", "supabase-rest", "playwright->localhost:8080"],
  },
  {
    file: "slmm-receipt-delivery-test.mjs",
    services: ["supabase-auth", "supabase-rest", "cloudflare-r2", "resend-email"],
  },
]);

export const HELPER_MODULES = Object.freeze([
  "slmm-test-safety.mjs",
  "slmm-comm-capture.mjs",
  "live-guard.mjs",
  "harness-registry.mjs",
  "slmm-rest-baseline.mjs",
]);

export const LIVE_SQL_HARNESSES = Object.freeze([
  "admin-aadhaar-verification.sql",
  "admin-driving-licence-verification.sql",
  "admin-pan-verification.sql",
  "admin-passport-verification.sql",
  "admin-profile-approval-rpc.sql",
  "admin-voter-id-verification.sql",
  "consolidated-document-security.sql",
  "document-client-verification-guard.sql",
  "elite-eligibility-verification.sql",
  "payment-b1-rpc-regression.sql",
  "payment-verify-rpc-privileges.sql",
  "profile-admin-identity-plan-guard.sql",
  "profile-admin-self-approval-guard.sql",
  "profile-admin-self-approval-insert-guard.sql",
]);

export const offlineSuiteFiles = () => OFFLINE_SUITES.map((s) => s.file);
export const liveHarnessFiles = () => LIVE_HARNESSES.map((h) => h.file);
export const helperFiles = () => [...HELPER_MODULES];
export const classifiedMjsFiles = () => [...offlineSuiteFiles(), ...liveHarnessFiles(), ...helperFiles()];
export const classifiedSqlFiles = () => [...LIVE_SQL_HARNESSES];
