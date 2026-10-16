# SLMM test harnesses

This directory holds the project's test harnesses. They fall into two strictly
separated classes. The separation is enforced by
`test-harness/slmm-harness-safety-tests.mjs` (a static, offline suite) and by
`test-harness/live-guard.mjs` (a runtime gate).

## Offline suites — safe, hermetic, the default

No network, no database, no credentials, no external service. Run all of them
with a single, explicit-allowlist command:

```
npm test            # alias: npm run test:offline
```

`npm test` runs `scripts/run-offline-tests.mjs`, which runs ONLY the suites
listed in `test-harness/harness-registry.mjs` under `OFFLINE_SUITES`. It never
globs the directory, so it cannot pick up a live harness.

## Live harnesses — refused by default, TEST only, production prohibited

| Harness | Services it can touch |
| --- | --- |
| `slmm-comm-test.mjs` | Supabase auth + REST, headless browser → localhost:8080 |
| `slmm-receipt-delivery-test.mjs` | Supabase auth + REST, Cloudflare R2, Resend email |

Both talk to a **live** Supabase project and are **not wired to any npm
script**. They refuse to run unless, and only unless, all three environment
variables are set from the shell and the resolved target is the **TEST**
project.

PowerShell (Windows, this repo's platform) — set the variables for the current
session, run the harness, then clear them:

```powershell
$env:SLMM_TEST_MODE  = "true"
$env:SLMM_LIVE_TESTS = "true"
$env:SLMM_LIVE_TARGET = "test"
$env:SLMM_LIVE_ACK   = "slmm-comm-test.mjs"
node test-harness/slmm-comm-test.mjs

# one-liner equivalent (PowerShell):
#   $env:SLMM_TEST_MODE="true"; $env:SLMM_LIVE_TESTS="true"; $env:SLMM_LIVE_TARGET="test"; $env:SLMM_LIVE_ACK="slmm-comm-test.mjs"; node test-harness/slmm-comm-test.mjs

# clear the opt-in afterwards
Remove-Item Env:SLMM_LIVE_TESTS, Env:SLMM_LIVE_TARGET, Env:SLMM_LIVE_ACK
```

POSIX shell (bash/zsh):

```bash
SLMM_TEST_MODE=true \
SLMM_LIVE_TESTS=true \
SLMM_LIVE_TARGET=test \
SLMM_LIVE_ACK=<exact-harness-filename> \
node test-harness/<exact-harness-filename>
```

* `SLMM_LIVE_TESTS` must equal `true`.
* `SLMM_LIVE_TARGET` must equal `test`.
* `SLMM_LIVE_ACK` must exactly equal the harness filename being run, so a live
  run can only ever start the harness the operator named.
* **Production is unconditionally prohibited.** There is no override flag.
  `live-guard.mjs` refuses the production project ref both before authorization
  and again after the environment file is read (`assertNonProductionTarget`).
* The gate runs **before** any credential load, network call, browser launch,
  or service-client construction.

The comm harness baseline reads (threads, support messages, conversations,
member messages, documents, shortlists, profiles) are **complete, paginated and
validated** before the browser launches or anything is created: each read pages
through the table with an exact row count and validates the full PostgREST
`Content-Range` interval (start offset, end offset and total), rejecting failed
HTTP responses, malformed payloads, missing fields, invalid/duplicate ids,
malformed or inconsistent ranges, truncated reads and ambiguous or
over-reported totals. Any failure aborts the run before the scratch account is
created; the protected-user set is built only from the verified profile
baseline.

`node test-harness/slmm-comm-test.mjs --cleanup-preview` remains available as a
pure offline dry run (it reads the last run's state file and reads no
credentials).

```powershell
# offline cleanup preview - no opt-in triple needed, no credentials read
node test-harness/slmm-comm-test.mjs --cleanup-preview
```

## Adding a harness

Every `test-harness/*.mjs` and `*.sql` file must be classified in
`harness-registry.mjs` (`OFFLINE_SUITES`, `LIVE_HARNESSES`, `HELPER_MODULES`, or
`LIVE_SQL_HARNESSES`). An unclassified file fails `npm test` closed, on purpose.

## Classification is a static contract, not a live guarantee

A green `npm test` proves the *static* safety contracts (gating order,
classification, no live capability in offline suites, pinned refs). It does not
prove that a live migration was applied, that RLS fired, or that a live run
behaves correctly. Live behaviour requires an authorized live run.
