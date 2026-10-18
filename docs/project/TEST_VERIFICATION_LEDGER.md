# TEST VERIFICATION LEDGER — Sri Lakshmi Mangalya Malai (TEST-ONLY)

> **Isolation policy:** `docs/project/PROJECT_STATUS.md` §8 (binding). **Environment: TEST-ONLY.**
> **Honesty rule:** do not claim a test passed unless the result was observed. Distinguish **local/offline** results from **remote TEST integration** results. Mock/offline passes prove application *logic*, **not** live service behavior.
> **Ledger type:** documentation-only consolidation. Preparing this file ran **no** builds, tests, migrations, deployments, or Git mutations, and made **no** remote calls.

**Compiled from:** `docs/project/PROJECT_STATUS.md`, `docs/project/SESSION_HISTORY.md`, `docs/project/TEST_EVIDENCE.md`, `docs/project/PENDING_WORK.md`, `docs/project/FILE_INVENTORY.md`, and the recorded test reports listed under "Sources".
**Last updated:** 2026-10-17 (documentation-only: fresh offline evidence + Phase 5B status correction).
**Note on sourcing:** the five recovery documents above do **not** record the offline-suite pass counts shown in §2. Those figures are **historical working-session results**, not results observed during this audit. The cited local records are identified inline; the original execution transcripts for suites 1, 2, 3, and 5 are not included among this ledger's cited sources. The safety report only mentions suite 3 as a secondary reference.
**Historical repository HEAD when the ledger was written:** `cdd527965ba18c5e6baf9ef077dd36db926e3461` (branch `main`; nothing staged; 39 modified tracked; 0 deletions).
**Historical untracked-file counts:** **84 before** creation of this ledger (2026-10-15 12:39 recovery snapshot); **85 later**, including the untracked ledger. These are dated records, not measurements made by creating this update.
**Read-only preflight on 2026-10-16:** branch `main`, same HEAD, 39 modified tracked files, 85 untracked files, 0 staged files, 0 deletions. No files were added or removed for this audit.
**Read-only preflight on 2026-10-17 (supersedes the line above):** branch `main`, HEAD `ff1abb1`, **37 modified tracked**, **72 untracked**, **6 staged** (`docs/project/*.md`, index status `A`), 0 deletions; `origin/main` is 8 behind. No files were added or removed.

---

## 1. Scope and safety boundaries

- **TEST-only is an authorization policy, not a harness-configuration guarantee.** The only permitted targets are TEST Supabase `nqadtfqyurkpmxcodswc`, TEST Worker `slmm-boyar-matrimony-test`, and TEST R2 bucket `srilakshmimangalyamalai-test` (`PROJECT_STATUS.md` §3). Inspect each harness before considering a separately authorized run; production-targeting harnesses remain BLOCKED.
- **No production changes.** Production identifiers (ref `sxpkutjkqfekqwpabgrk`, Worker `slmm-boyar-matrimony`, bucket `srilakshmimangalyamalai`, domain `srilakshmimangalyamalai.com`) are recorded for **safety recognition only** and are never targets of this work (`PROJECT_STATUS.md` §4).
- **Credentials policy.** Never load `.env` or `.env.local` in a TEST workflow; use only separately verified TEST credentials from `.env.test` when specifically authorized. No environment files were read for this audit; no passwords, service-role keys, tokens, or R2 secret keys are recorded here.
- **Fail-closed.** A TEST build referencing production resources (or vice versa) must fail validation; a failed check is never bypassed (`PENDING_WORK.md` isolation policy #5).
- **No deployment authorization implied.** Nothing in this ledger authorizes a build, remote operation, merge, commit, push, or deployment.

---

## 2. Working-session results — offline / mock suites (HISTORICAL 266/266; SUPERSEDED by fresh 457/457 on 2026-10-17)

All five suites are **local-only (offline)**. They use pure functions or mocked server modules; the delivery mock suite includes a hard network tripwire. **Level: historical local-only (offline/mock) — not freshly verified and not live integration.**

| # | Suite | File | Recorded command (not run here) | Historical result | Cited evidence |
|---|---|---|---|---|---|
| 1 | Image optimization / upload | `test-harness/image-opt-tests.mjs` | `node test-harness/image-opt-tests.mjs` | **63/63** (reported) | Original execution transcript not among cited sources. |
| 2 | Elite / payment / notify / checkout code | `test-harness/slmm-elite-code-tests.mjs` | `node test-harness/slmm-elite-code-tests.mjs` | **44/44** (reported) | Original execution transcript not among cited sources. |
| 3 | Cleanup safety guard (fail-closed) | `test-harness/slmm-safety-tests.mjs` | `node test-harness/slmm-safety-tests.mjs` | **44/44** (reported) | `payment-review-guard-functional-test-report.txt` line 341 **mentions** `44/44 PASS`; this is a secondary report, not the original suite transcript. |
| 4 | Payment receipt / notification delivery | `test-harness/slmm-delivery-mock-tests.mjs` | `node test-harness/slmm-delivery-mock-tests.mjs` | **108/108** (recorded) | `.tmp-d2-scratch/delivery-run.txt` line 110 contains the suite's `108/108 passed` output. |
| 5 | Office-reply capture resolver (T10 fix) | `test-harness/slmm-capture-tests.mjs` | `node test-harness/slmm-capture-tests.mjs` | **7/7** (reported) | Original execution transcript not among cited sources. |
| | | | **Total** | **266/266 historical, not re-run** | |

> **Qualification (record keeping).** The five recovery documents do **not** contain these pass counts. Of the cited sources, only **suite 4** has a local suite-output transcript; **suite 3** has a secondary report mentioning its count. **Suites 1, 2, 3, and 5 have no original execution transcript among the cited sources.** Their figures remain historical working-session claims, not freshly verified results. Exit status is not established independently for suites without original run evidence. None of these suites was re-run for this correction.

> **Superseded 2026-10-17 (fresh evidence).** The complete offline set is now **457/457 across 13 suites** — `npm run test:offline` **exit 0** (`failing_suites=0`), `npx tsc --noEmit` **exit 0**. The `266/266` table and its sourcing caveats above are retained as history only. Original run evidence for the current tree now exists (see `TEST_EVIDENCE.md` **E-005**). ADDED suites beyond the 266 baseline: `slmm-dashboard-upload-tests.mjs` (12), `slmm-delete-upload-tests.mjs` (11), `slmm-orphan-cleanup-tests.mjs` (9), `slmm-quota-release-tests.mjs` (15), `slmm-screened-pair-quota-tests.mjs` (12), `slmm-sql-contract-tests.mjs` (69), `slmm-harness-safety-tests.mjs` (17), `slmm-rest-baseline-tests.mjs` (46). All 13 suites also passed individually.

**Technique notes (why these are offline, not live):**
- Suite 1 compiles the real `src/lib/compress.ts` + `src/lib/upload.ts`; the R2 `uploadFile` path is **mocked**.
- Suite 2 loads source via Vite `ssrLoadModule` with `@tanstack/react-start`, `auth-middleware`, `client.server`/`supabaseAdmin`, and `send-email` **mocked**; it reads migration/user source as text (so its SQL-text assertions do **not** prove database enforcement).
- Suite 3 injects a **fake** deleter into the pure cleanup guard (`test-harness/slmm-test-safety.mjs`, zero imports).
- Suite 4 replaces `globalThis.fetch` with a **tripwire**; every recorded call hit only the mock host `testacct.r2.cloudflarestorage.com` (fabricated account), and the suite self-asserted **zero** non-mock network.
- Suite 5 is a pure function over in-memory arrays.

**These passes do not constitute runtime verification of the deployed TEST Worker, the TEST database, or R2.**

---

## 3. PASS — local build & TEST-target isolation checks (recorded evidence only)

Previously recorded in `docs/project/TEST_EVIDENCE.md`; **level: historical local-only (offline)**, no remote resources involved. No build or check was re-run for this correction.

| Check | Command | Recorded result | Evidence |
|---|---|---|---|
| TypeScript | `npx tsc --noEmit` | clean | `PROJECT_STATUS.md` §5 |
| Production build | `npm run build` | exit 0 | `PROJECT_STATUS.md` §5 |
| TEST build + isolation gate | `npm run build:test` | exit 0; gate PASS — TEST ref `nqadtfqyurkpmxcodswc` in 4 files, production ref `sxpkutjkqfekqwpabgrk` in 0 files; generated Worker name `slmm-boyar-matrimony-test` | `TEST_EVIDENCE.md` **E-004** (supersedes E-001/E-002) |
| TEST gate (standalone) | `node scripts/check-build-target.mjs test` | exit 0 (PASS) | `TEST_EVIDENCE.md` E-004 |
| Worker-name guard exercised | `node scripts/check-build-target.mjs test` / `prod` | fail-closed correctly (history) | `TEST_EVIDENCE.md` **E-002** |
| Override outside TEST mode | `import('.config/nitro.config.mjs')`, no TEST signal | `{}` (fail-closed) | `TEST_EVIDENCE.md` E-004 |
| Production `wrangler.toml` | `git diff -- wrangler.toml` | unchanged (empty diff) | `TEST_EVIDENCE.md` E-004 |

**Interpretation:** the TEST Worker-name configuration issue recorded in E-002 was **resolved** for the recorded artifact by `.config/nitro.config.mjs` (isolated, fail-closed). These checks confirm **build-target isolation**, not runtime behavior.

---

## 4. BLOCKED — live harnesses (not run; not offline-safe)

The following require live TEST credentials and/or perform remote mutations, and in some cases load `.env` directly. They are **BLOCKED** in the current TEST-only / no-remote workflow.

| Harness | Why BLOCKED |
|---|---|
| `test-harness/slmm-receipt-delivery-test.mjs` | **Loads `.env` directly** (not `.env.test`); performs real Supabase REST writes; creates an auth user; performs R2 `HEAD`/`PUT`/`DELETE` via real `aws4fetch`; **overwrites** the existing `receipt-delivery-select-fix-functional-test-report.txt` at repo root. |
| `test-harness/slmm-comm-test.mjs` | **DO NOT RUN** in this workflow (no live authorization). **Phase 5B correction (`ff1abb1`):** it **no longer hard-codes the production endpoint** and no longer reads `.env` as a fallback. It now requires the explicit opt-in triple (`SLMM_LIVE_TESTS=true`, `SLMM_LIVE_TARGET=test`, `SLMM_LIVE_ACK=slmm-comm-test.mjs`) and must pass `test-harness/live-guard.mjs` **before** any credential load, network call, or client/browser construction; a non-TEST signal or missing/incorrect ack refuses (exit 2). It still performs live REST reads/writes and guard-driven deletes **when separately authorized**. |
| `test-harness/*-verification.sql` (`admin-aadhaar`, `admin-driving-licence`, `admin-pan`, `admin-passport`, `admin-voter-id`, `elite-eligibility`) | SQL verification scripts intended to run against the live TEST database. |
| `.tmp-audit/*` remote-touching scripts | Flagged "do not run" in `FILE_INVENTORY.md`. |

> **Important (updated 2026-10-17):** the "TEST-only" rule in §1 remains the **authorized operational policy**. Phase 5B (`ff1abb1`) removed the hardcoded production endpoint and the `.env` fallback from **both** live harnesses and added a fail-closed runtime gate (`test-harness/live-guard.mjs`) that permits **TEST only** and refuses a production target unconditionally. **Neither live harness may be run in the current workflow** (no live authorization), but they are **no longer configured against production**. See `TEST_EVIDENCE.md` E-005 and `PROJECT_STATUS.md` §8.

**Prerequisites before any live run (all three required):**
1. Valid **TEST-only** credentials supplied in `.env.test` (service-role key + R2 keys), verified without exposing values when a separate live run is authorized. Earlier notes described placeholders; credential status was **not checked** for this documentation-only audit.
2. **Harness remediation** so live harnesses read `.env.test` only and never fall back to `.env`/`.env.local`. — **DONE (Phase 5B, `ff1abb1`).** Both harnesses now require the opt-in triple and pass `live-guard.mjs` before any credential load; a non-TEST/missing ack refuses (exit 2). Residual: runtime confirmation on a real, separately authorized live run.
3. **Explicit authorization** for live TEST database writes, R2 upload/deletion, auth-user creation, and report-file overwrite.

No live harness was run for this audit. **No current live TEST integration success is claimed anywhere in this ledger.**

---

## 5. UNVERIFIED — live behaviors not proven by the offline suites

These remain **UNVERIFIED** and must not be reported as passing:

- **Live database / RLS enforcement** — the offline suites use a mocked Supabase client stub; SQL-text assertions only prove source *contains* guards, not DB enforcement.
- **Real R2 upload** — object creation in `srilakshmimangalyamalai-test` and the stored `documents.storage_key` vs the actual object.
- **TEST `R2_BUCKET_NAME` binding (configuration)** — R2 is selected at runtime via `process.env["R2_BUCKET_NAME"]`; no committed non-secret configuration pins it to the TEST bucket (`[[r2_buckets]]` is absent from `wrangler.toml`). Whether the TEST Worker runtime resolves to `srilakshmimangalyamalai-test` (rather than the production bucket `srilakshmimangalyamalai`) is **UNVERIFIED** from repository configuration; TEST deployment and live R2 tests stay blocked until it is independently verified. (Read-only audit, 2026-10-17.)
- **Real signed-URL retrieval** — 900 s signed GET returning the stored object with matching size/MIME.
- **Live quota counters** — `document_upload_counters` (`photo_count`, `doc_count`, `byte_count`) behavior on live writes.
- **Real email delivery** — actual provider send (offline suites use a send-email stub).
- **Razorpay signature verification** — offline HMAC used a dummy secret; the real gateway signature path is unverified.

---

## 6. Historical quota/storage findings (HISTORICAL — not independently re-verified)

> These findings are **HISTORICAL / ARCHIVE** and were **not** independently re-verified in this workflow. They are reproduced from the recorded reports below. Treat as reported evidence, **not current live TEST verification**. No remote calls were made to confirm them.

**A. TEST R2 upload milestone — `2026-10-14` (reported PASS; read-only verification of one authorized TEST upload).**
Source: `.tmp-d2-scratch/r2-upload-milestone-20261014.md`. Target: TEST bucket `srilakshmimangalyamalai-test`, TEST client `[REDACTED TEST CLIENT ID]`.
- `public.documents.storage_key` = `[REDACTED PRIVATE OBJECT KEY]` — **matches** the R2 object key.
- `size_bytes` **238** = R2 object `Content-Length` **238** (exact match).
- `document_upload_counters`: `photo_count=1`, `doc_count=0`, `byte_count=238`.
- Browser UI evidence (reported): Photo Gallery `1/6`; Storage Used `238 B / 20.0 MB`.
- Cleanup: object/row/counters **intentionally retained**.

**B. Production controlled upload — `2026-10-09` (PRODUCTION; historical, out of scope for TEST).**
Source: `E2E_PRODUCTION_CONTROLLED_UPLOAD_REPORT.md`.
- `size_bytes` **24956** = R2 object size **24956**; storage sum before = after = **165286**; doc/profile/auth deltas 0/0/0.

**C. Upload key template (source inspection, not runtime).**
- Key template: `` `${owner}/${folder}/${Date.now()}-${crypto.randomUUID()}-${sanitize(name)}` ``; retrieval via 900 s signed GET; the DB stores the **key** (not a URL).
- Prior note: an earlier "empty folder" observation was assessed as a **dashboard prefix / bucket-view artifact**, not a code defect (source template matches the observed object path).

`FILE_INVENTORY.md` records the milestone report (line 93) as **ARCHIVE**. Its claim that this was the only repository document naming the TEST Worker is an older inventory note, not a current exclusivity claim.

---

## 7. Wrangler dry-run — DISCREPANCY (recorded evidence vs recovery docs)

- **Recorded dry-run figures (preserved, uncorroborated):** a TEST Wrangler dry-run was recorded in the working-session transcript for this task as **exit 0**, **153 modules**, Total Size ≈ **3,839.40 KiB**, Total Upload ≈ **3,871.62 KiB** (gzip ≈ **851.73 KiB**), with a single binding `env.ASSETS → Assets`.
  - **Provenance caveat:** these figures exist **only** in the working-session transcript. **No on-disk artifact of the run was located** (the available `.tmp-d2-scratch/build-run.txt` is a `npm run build` log, not a Wrangler dry-run), and the figures are **not** recorded in any recovery document. They are therefore **not corroborated**, and this ledger does **not** assert that a dry-run occurred.
- **Documented discrepancy, not proof of a later run:** `docs/project/PROJECT_STATUS.md` §7 (2026-10-15 12:39 note) and `docs/project/SESSION_HISTORY.md` (12:39 entry, item 12) both state **"no dry-run attempted."** Those dated statements must not be rewritten to fit transcript-only figures; the figures do not establish whether or when a later dry-run occurred.
- **No new dry-run was performed** while preparing this ledger or during the consistency audit.
- **Next step (documentation reconciliation):** locate and evaluate an actual run artifact (dated command, target, exit status and output) if one exists; reconcile its timing with the 12:39 recovery entries. Until then, leave the transcript-only figures **UNVERIFIED** and the historical "no dry-run attempted" statements intact. Do **not** infer either that a dry-run occurred or that none ever occurred from the evidence currently cited. Any future TEST dry-run requires separate authorization; none is authorized here.

---

## 8. Remaining work (ordered by priority)

1. **[OPEN — reconciliation]** Reconcile the Wrangler dry-run discrepancy (§7) **only against actual evidence**: if a dated run artifact is found, document its command, TEST target and outcome without altering the earlier 12:39 record. Transcript-only figures remain **UNVERIFIED**; do not assume a run happened or assert that none ever happened without evidence.
2. **[BLOCKED]** Independently verify availability of valid **TEST-only** credentials in `.env.test` (service-role key + R2 keys) before any separately authorized live work. Earlier notes described placeholders; `.env.test` was **not read** for this audit, so current credential validity is unknown. No secrets recorded here.
3. **[BLOCKED — remediation]** Remediate live harnesses that load `.env` directly (`slmm-receipt-delivery-test.mjs`, etc.) to read `.env.test` only, with no `.env` fallback, before any live run.
4. **[OPEN]** Record live TEST integration status as **BLOCKED** with reasons in `PENDING_WORK.md`; add a "Not run / BLOCKED" section to `TEST_EVIDENCE.md`.
5. **[DONE 2026-10-17]** Added offline-suite evidence entry **E-005** (457/457, 13 suites; per-suite counts; `tsc` exit 0) to `TEST_EVIDENCE.md`, superseding the historical 266/266.
6. **[DONE 2026-10-17]** Verified the mapping; the storage/quota helpers **are** covered offline. `PENDING_WORK.md` #6 marked **DONE** (`cleanupOrphanedUploads` → `slmm-orphan-cleanup-tests.mjs`; quota-release guard → `slmm-quota-release-tests.mjs`; screened-pair → `slmm-screened-pair-quota-tests.mjs`). Residual UNVERIFIED: the Postgres RPC caps + advisory lock.
7. **[DONE 2026-10-17]** `node_modules/.nitro/last-build.json` explicitly verified = `{"outputDir":"../../../.output"}`; `PENDING_WORK.md` #2 marked **DONE**.
8. **[OPEN — needs approval]** `FILE_INVENTORY.md` `REMOVE` candidates (`temp.txt`, `src/lib/storage.functions.ts.tmp`) require per-file approval.
9. **[OPEN — future, needs explicit approval]** TEST→production release (isolation policy #6). Explicitly **NOT** authorized.
10. **[INFO]** `r2-upload-milestone-20261014.md` lives at `.tmp-d2-scratch/`, not the repository root; surface it as evidence (its findings are summarised in §6).

---

## Sources

- `docs/project/PROJECT_STATUS.md` (§§2–9)
- `docs/project/SESSION_HISTORY.md` (12:05, 12:16, 12:39 entries; reconstructed morning entry)
- `docs/project/TEST_EVIDENCE.md` (E-001 … E-004; aggregate summary; updates)
- `docs/project/PENDING_WORK.md` (items #1–#7; isolation policy)
- `docs/project/FILE_INVENTORY.md` (KEEP/ARCHIVE/REMOVE classes; addendum)
- `.tmp-d2-scratch/r2-upload-milestone-20261014.md` (historical TEST R2 evidence)
- `E2E_PRODUCTION_CONTROLLED_UPLOAD_REPORT.md` (historical production evidence; out of scope)
- `payment-review-guard-functional-test-report.txt` (pre-existing ARCHIVE; **secondary mention** of `slmm-safety-tests.mjs` **44/44** at line 341, not its original execution transcript)
- `.tmp-d2-scratch/delivery-run.txt` (pre-existing ARCHIVE; records `slmm-delivery-mock-tests.mjs` **108/108** at line 110)

> **Original execution transcripts not among the ledger's cited sources:** `image-opt-tests.mjs` (63/63), `slmm-elite-code-tests.mjs` (44/44), `slmm-safety-tests.mjs` (44/44; secondary mention only), and `slmm-capture-tests.mjs` (7/7). These remain historical figures, not fresh verification.

## Not run in preparing this ledger

- No builds, tests, migrations, or deployments.
- No remote access (Supabase, Cloudflare/R2, email providers, GitHub).
- No reads of `.env` / `.env.local` / `.env.production` / `.env.test`.
- No Git staging, commit, push, stash, reset, discard, or clean.

> **Documentation-only.** This file records previously observed results; it does not itself verify any behavior. Do not present offline/mock passes as live integration success.

---

## Addendum — 2026-10-17 (later) — 497/497; live-harness `.env` correction

> **Append-only.** Supersedes only where explicitly stated.

- **§2 (offline suite totals):** the complete offline set is now **497/497 across 15 suites** — `npm run test:offline` **exit 0** (`failing_suites=0`), `npx tsc --noEmit` **exit 0** (freshly observed 2026-10-17, later; evidence `TEST_EVIDENCE.md` **E-006**). This supersedes the **457/457 across 13 suites** figure recorded in §2's 2026-10-17 superseding note. **Added suites:** `slmm-quota-sql-contract-tests.mjs` (28) and `slmm-upload-cap-tests.mjs` (12), both registered in `harness-registry.mjs` `OFFLINE_SUITES`.
- **§4 prerequisite #2 (live-harness `.env` remediation) — PARTIALLY correct; correction:** it is marked "**DONE**" on the basis that harnesses "read `.env.test` only and never fall back to `.env`". That is **not** what the source does. Phase 5B (`ff1abb1`) added the fail-closed gate `test-harness/live-guard.mjs`, which runs **before** any credential load, but **both live harnesses still read the repo-root `.env`**: `slmm-receipt-delivery-test.mjs` (line 47: `readFileSync(ROOT + "/.env", "utf8")`) and `slmm-comm-test.mjs` (line 76: `path.join(SCRIPT_DIR, "..", ".env")`). **Neither reads `.env.test`.** So the gate is DONE; the `.env.test`-only remediation remains **OPEN**. No credentials were read in this task (read-only source inspection only; no file changed).
- **§5 (UNVERIFIED list) — refinement (not a removal):** the **advisory lock** and the **Postgres RPC caps** are now **statically covered offline** by `slmm-quota-sql-contract-tests.mjs` (source-text assertions over the migration). They remain **UNVERIFIED at runtime** — the static suite explicitly does not prove the lock is taken or that a concurrent reservation is refused at runtime. §5 therefore stands as UNVERIFIED for *live enforcement*, with the new static coverage noted.
- **§8 (remaining work) — updated status:**
  - **[OPEN — security]** Remediate the live harnesses to read `.env.test` only (see the §4 correction above).
  - **[OPEN — ops/isolation]** `.output` is currently a **production** build and `supabase/config.toml` `project_id` is **production** (`sxpkutjkqfekqwpabgrk`); do not deploy `.output` to TEST and do not run CLI commands against production. Evidence: `TEST_EVIDENCE.md` **E-007**.
- **§7 (Wrangler dry-run):** unchanged — still no on-disk artifact located; still UNVERIFIED.
- **Level:** documentation-only for this addendum; the fresh 497/497 and `tsc` results are local-only (offline). No build, live harness, remote access, or `.env` read occurred.

---

## Addendum - 2026-10-18 - T3 live TEST claim-RPC verification PASS

> **Append-only; scope-limited.** Supersedes section 4's "no current live TEST integration success" statement only for T3 claim-RPC verification. All unrelated historical entries and unverified behaviors remain unchanged.

- **Target:** TEST Supabase `nqadtfqyurkpmxcodswc`; explicitly authorized rollback-only execution, not production.
- **Committed scripts:** `test-harness/slmm-storage-deletion-t3-live-test.sql` and `test-harness/slmm-storage-deletion-t3-residue.sql`; checkpoint commit `4f1be4f` (`test(storage): preserve rollback-only T3 lifecycle verification scripts`).
- **Script SHA-256 (live / residue):** `bf53a30c8003cddfed8f9951bea4965a5404d540cbda5f308a728f07d8f59a1c` / `159004c184cb9852cca48cfaeeb3d773560a00a94bdf9c10686c8c6717fa52ca`.
- **Observed JSON results:** `overall_verdict = PASS`; **14/14 cases PASS (C1-C14)**; **11/11 complete-row final-state checks PASS**, independently confirmed by equality of each actual and expected row object; `claim_count = 5`; `fence_difference_count = 0`.
- **Authorization results:** C1/C2 returned expected SQLSTATE `42501` for both claim RPCs; C3-C14 returned `00000`. C1 exercised the authenticated SQL role; positive probes used transaction-local service-role JWT simulation with a privileged SQL caller, not end-to-end service-role transport.
- **Isolation and guards:** existing `REPEATABLE READ` transaction and mandatory final `ROLLBACK` retained. Complete global eligible-ID sets were compared with exact INSERT-returned synthetic IDs before claim operations. JSON reported `safety_guards = Completed without uncaught exception`; no foreign-ID guard or serialization failure was reported and no safeguard was bypassed. A foreign eligible request was not injected as a negative test.
- **Post-rollback residue:** separate read-only query returned `residue_verdict = PASS`, **0 synthetic deletion requests**, **0 synthetic fences**, and empty request/fence residue arrays. T3 and residue CLI exit codes were both **0**; explicit JSON PASS and zero residue, not exit status alone, establish success.
- **Limits:** actual R2 deletion/object absence and parallel-worker contention remain **UNTESTED**. `confirmed_absent` was only a synthetic state-machine fixture. This does not establish end-to-end Worker, R2, quota-finalization or concurrent-worker correctness. T4 was not run.
- **Raw sources reviewed locally:** `%TEMP%/opencode/slmm-t3-live-2026-10-18T15-08-58-396Z-stdout.json` and `%TEMP%/opencode/slmm-t3-residue-2026-10-18T15-09-33-642Z-stdout.json`, plus their corresponding `-execution.json` metadata. Raw outputs remain outside Git; temporary-file retention is not guaranteed.
- **Raw-evidence SHA-256 (T3 / residue):** `4669f86b7286965ad498565c100c213e67e9e8c926c72f19dc4943c1f46bd2fc` / `103bbb9c4969aca3b7decda145121ef93056b1940118d36c16b37e3a6963346c`.
- **Sanitization and scope:** no credentials, JWT values, lease tokens, fixture/person identifiers, object keys or sensitive raw payloads are included. Preparing this entry repeated no tests or remote operations and authorizes no further testing, deployment or Git operations.
