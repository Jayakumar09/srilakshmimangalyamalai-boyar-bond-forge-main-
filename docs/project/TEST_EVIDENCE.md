# TEST EVIDENCE — Sri Lakshmi Mangalya Malai (TEST-ONLY)

> Isolation policy: `docs/project/PROJECT_STATUS.md` §8. Do not claim a test passed unless the result was observed. Distinguish **local/offline** tests from **remote TEST integration** tests.

_Last updated: 2026-10-17 (fresh offline regression + storage/quota evidence)_

## E-001 — Build-target gate (Supabase references)

- **Objective:** Confirm a built `.output` targets the expected Supabase project and does not contain the other environment's reference.
- **Prerequisites:** `.output` present from a build; `scripts/check-build-target.mjs`.
- **Commands / outcomes:**
  - `npm run build:test` → **exit 0**; gate printed `PASS: build output matches the target environment.` TEST ref `nqadtfqyurkpmxcodswc` present in 4 files; production ref `sxpkutjkqfekqwpabgrk` absent.
- **Evidence locations:** `.output/nitro.json` (`date 2026-10-15T05:16:49.344Z` = 10:46:49 local); `.output/public/assets/auth-YlDAQYN2.js`, `.output/public/assets/client-dV_gz4yb.js`, `.output/server/_ssr/auth-DiBrN2d5.mjs`, `.output/server/_ssr/client-ALUkG0_p.mjs`.
- **Level:** local-only (offline). No remote resources involved.
- **Result:** PASS at that time.

## E-002 — Build-target gate (Worker-name guard) — NEW

- **Objective:** Verify the strengthened gate rejects a built artifact whose generated Cloudflare Worker name is not the expected one, specifically that a **TEST** check fails when `.output/server/wrangler.json` names the production Worker.
- **Prerequisites:** `.output/server/wrangler.json` exists; `scripts/check-build-target.mjs` (updated 2026-10-15 12:05:51).
- **Subject under test (content at time of test):** `.output/server/wrangler.json` → `"name": "slmm-boyar-matrimony"` (production name).
- **Commands / outcomes:**
  - `node scripts/check-build-target.mjs test` → **exit 1**
    ```
    Build target: test
      expected ref nqadtfqyurkpmxcodswc: present in 4 file(s)      (PASS)
      forbidden ref sxpkutjkqfekqwpabgrk: present in 0 file(s)     (PASS)
      expected Worker name slmm-boyar-matrimony-test
      actual Worker name   slmm-boyar-matrimony
    FAIL: Worker name "slmm-boyar-matrimony" targets the wrong environment for build target "test".
    ```
    → Failure is **specifically** the Worker-name mismatch; Supabase-ref checks passed.
  - `node scripts/check-build-target.mjs prod` → **exit 1**
    ```
    Build target: prod
      expected ref sxpkutjkqfekqwpabgrk: present in 0 file(s)      (FAIL)
      forbidden ref nqadtfqyurkpmxcodswc: present in 4 file(s)     (FAIL)
      expected Worker name slmm-boyar-matrimony
      actual Worker name   slmm-boyar-matrimony                    (no mismatch)
    ```
    → Fails on **Supabase references only**; **no Worker-name mismatch reported** (expected/actual both `slmm-boyar-matrimony`).
  - `git diff -- scripts/check-build-target.mjs` → empty (file untracked); `git status --short` → unchanged baseline (39 modified tracked).
- **Level:** local-only (offline). The checker performs read-only filesystem access; no remote calls.
- **Expected/observed result:** PASS for the guard's intended behavior (fail-closed on the current production-named TEST artifact).
- **Interpretation:** The gate is working **as designed**. It does **not** mean the TEST build is correct — it means the current artifact is (correctly) blocked.

## E-003 — Documentation checkpoint (this task)

- **Objective:** Create the five approved project-history documents and record the isolation policy.
- **Commands / outcomes:** read-only inspection only (`Test-Path`, `Get-ChildItem`, `git status --short --untracked-files=all`, `git rev-parse HEAD`, `git check-ignore`, `Get-Date`). No build, no remote access.
- **Files created:** `docs/project/PROJECT_STATUS.md`, `docs/project/SESSION_HISTORY.md`, `docs/project/TEST_EVIDENCE.md`, `docs/project/PENDING_WORK.md`, `docs/project/FILE_INVENTORY.md`.
- **Level:** local-only (offline).
- **Result:** files created; `docs/` now exists.

## E-004 — TEST Worker configuration via isolated Nitro config (NEW)

- **Objective:** Confirm the TEST build now generates a TEST-named Cloudflare Worker configuration, that the gate passes, and that the override is empty outside TEST mode.
- **Prerequisites:** `.config/nitro.config.mjs` (created 2026-10-15 12:33:33); `.output` from `npm run build:test`.
- **Subject under test:** `.config/nitro.config.mjs`; `.output/server/wrangler.json`.
- **Commands / outcomes:**
  - Static evaluation of `.config/nitro.config.mjs`:
    - default (no TEST signal) → `{}`
    - `npm_lifecycle_event=build` → `{}`
    - `npm_lifecycle_event=build:test` → `{"cloudflare":{"wrangler":{"name":"slmm-boyar-matrimony-test"}}}`
    - `SLMM_BUILD_TARGET=test` → TEST name; `SLMM_BUILD_TARGET=prod` → `{}`
  - `npm run build:test` → **exit 0**:
    ```
    Build target: test
      expected ref nqadtfqyurkpmxcodswc: present in 4 file(s)
      forbidden ref sxpkutjkqfekqwpabgrk: present in 0 file(s)
      expected Worker name slmm-boyar-matrimony-test
      actual Worker name   slmm-boyar-matrimony-test
    PASS: build output matches the target environment.
    ```
  - `.output/server/wrangler.json` → `"name": "slmm-boyar-matrimony-test"` (all other fields preserved: `main`, `assets`, `compatibility_date 2026-10-15`, `compatibility_flags ["nodejs_compat"]`, `no_bundle`, `rules`). Build stamp `.output/nitro.json` `date = 2026-10-15T07:04:13.176Z` (= 12:34:13 local).
  - `node scripts/check-build-target.mjs test` (standalone) → **exit 0** (PASS).
- **Level:** local-only (offline). No remote resources involved.
- **Result:** PASS. The previously blocking Worker-name mismatch (E-002) is resolved for this artifact.
- **Production-override check:** `.config/nitro.config.mjs` returns `{}` when the TEST signal is absent, so a default/production build keeps the production Worker name from the unchanged `wrangler.toml`. (No production build was run for this evidence.)

## Aggregate test/status summary

| Check | Command | Result | Level |
|---|---|---|---|
| TypeScript | `npx tsc --noEmit` | clean | local |
| Production build | `npm run build` | exit 0 | local |
| TEST build | `npm run build:test` | exit 0, gate PASS (at that time) | local |
| TEST gate now | `node scripts/check-build-target.mjs test` | **exit 1** — Worker-name mismatch (expected) | local |
| Prod gate now | `node scripts/check-build-target.mjs prod` | exit 1 — Supabase refs only | local |
| Remote TEST integration | — | **not run** | remote |

## Notes on honesty/limits

- No remote TEST integration test has been run in this workflow. All results above are **local/offline**.
- TEST account type: none used (no synthetic or real accounts were exercised in these checks); no passwords recorded.
- **Remote TEST database / R2 changes:** none.
- **Failed/unresolved checks:** `node scripts/check-build-target.mjs test` intentionally fails against the current artifact; this is a **blocking, unresolved build-configuration problem**, not a defect in the checker (see `PENDING_WORK.md` #1).

## Update — 2026-10-15 12:39 (TEST Worker configuration resolved)

The rows/notes above are retained as history. Superseding results for the current artifact:

| Check | Command | Result | Level |
|---|---|---|---|
| TEST build (12:34) | `npm run build:test` | exit 0, gate PASS; Worker name `slmm-boyar-matrimony-test` | local |
| TEST gate now | `node scripts/check-build-target.mjs test` | **exit 0** — PASS | local |
| Override outside TEST | `import('.config/nitro.config.mjs')` (no TEST signal) | `{}` | local |
| Production `wrangler.toml` | `git diff -- wrangler.toml` | unchanged (empty diff) | local |
| Nitro pointer | `node_modules/.nitro/last-build.json` | `{"outputDir":"../../../.output"}` (rewritten by the build, mtime 12:34:13) — investigation open | local |

- **Resolved:** the blocking Worker-name mismatch recorded in E-002 no longer occurs on the current artifact (see E-004). The "Notes on honesty/limits" bullet above about the gate "intentionally failing" is **superseded**.
- **Not run:** no remote TEST integration test; no production build; no deployment.
- **Side effect (recorded, not a manual edit):** the approved `npm run build:test` rewrote the Nitro build pointer to the correct value; the remaining pointer investigation stays open until explicitly verified (`PENDING_WORK.md` #2).

## E-005 — Fresh offline regression + storage/quota suites (run 2026-10-17)

- **Objective:** Freshly re-run (not a historical figure) the complete offline suite set, the storage/quota-specific suites, and TypeScript validation on the current working tree.
- **Prerequisites:** `scripts/run-offline-tests.mjs` + `test-harness/harness-registry.mjs` (13 offline suites); `npx tsc --noEmit`. Offline only — no network, database, credentials, or `.env` access.
- **Commands / outcomes:**
  - `npm run test:offline` → **exit 0**: `TOTAL tests=457 pass=457 fail=0 skip=0 suites=13 failing_suites=0`.
  - Per suite (all `fail=0 skip=0`): image-opt 63/63; capture 7/7; delivery-mock 108/108; elite-code 44/44; safety 44/44; dashboard-upload 12/12; delete-upload 11/11; orphan-cleanup 9/9; quota-release 15/15; screened-pair 12/12; sql-contract 69/69; harness-safety 17/17; rest-baseline 46/46.
  - `node --test test-harness/slmm-screened-pair-quota-tests.mjs` → **exit 0**, 12/12.
  - `node --test test-harness/slmm-orphan-cleanup-tests.mjs` → **exit 0**, 9/9.
  - `node --test test-harness/slmm-quota-release-tests.mjs` → **exit 0**, 15/15.
  - `npx tsc --noEmit` → **exit 0** (no diagnostics).
- **Level:** local-only (offline). No remote resources involved.
- **Result:** PASS. This **supersedes** the historical `266/266` figure for the current working tree with **457/457 across 13 suites** (see `TEST_VERIFICATION_LEDGER.md` §2).
- **Coverage note — storage/quota scenarios (maps the requested checks to observed coverage):**
  - 6 photo / 5 document / 11 file / 20 MiB caps + advisory lock live in **Postgres RPCs** and are **not** exercised offline. `slmm-dashboard-upload-tests.mjs` pins the client-side constants (`MAX_PHOTOS_PER_PROFILE`, `MAX_DOCS_PER_PROFILE`, `MAX_TOTAL_FILES_PER_PROFILE`, `MAX_PROFILE_STORAGE_BYTES`) via `src/lib/compress.ts`, and the pre-upload limit short-circuit.
  - **Duplicate / failed upload** behaviour: `slmm-dashboard-upload-tests.mjs` (cleanup only on a failed `documents` INSERT, never after a successful INSERT) + `slmm-delete-upload-tests.mjs`.
  - **Ambiguous upload outcomes:** `slmm-quota-release-tests.mjs` (a dispatched PUT retains the reservation for every non-2xx/transport outcome — fail-closed).
  - **Orphan cleanup authorization/ownership:** `slmm-orphan-cleanup-tests.mjs` (9) + the fail-closed guard in `slmm-safety-tests.mjs`.
  - **Quota reconciliation / release safeguards:** `slmm-quota-release-tests.mjs` (15) + `slmm-screened-pair-quota-tests.mjs` (12).
  - **Concurrent reservation safeguards:** the advisory lock is in the Postgres RPC; **not verifiable offline** — remains in the UNVERIFIED set below.

## Update — 2026-10-17 (isolation + Nitro pointer reconfirmation)

- **Production `wrangler.toml`:** `git status --porcelain -- wrangler.toml` → empty (**unchanged**); content is `name = "slmm-boyar-matrimony"`.
- **TEST configuration isolation:** `.config/nitro.config.mjs` is the only TEST-only configuration location; it returns `{}` unless the build is explicitly the TEST build (`npm_lifecycle_event=build:test` or `SLMM_BUILD_TARGET=test`).
- **Nitro build pointer (reconfirmed):** `node_modules/.nitro/last-build.json` = `{"outputDir":"../../../.output"}` — the correct value. This **explicitly verifies** the pointer and **closes** `PENDING_WORK.md` #2.
- **Not run:** no live harness; no remote TEST integration; no production build; no deployment.

> **Honesty note:** the requested **concurrent reservation** safeguard (Postgres advisory lock) and the **Postgres RPC caps** cannot be proven by these offline suites. They stay UNVERIFIED until a separately authorized live TEST run.

---

## E-006 — Offline quota-contract + upload-cap suites added (run 2026-10-17, later)

- **Objective:** Close the remaining offline gaps identified in E-005 by adding *static* coverage for the Postgres quota RPC contract and client-side cap boundaries, then re-run the complete offline regression.
- **Prerequisites:** `test-harness/harness-registry.mjs` (now 15 offline suites); `npx tsc --noEmit`.
- **Files added (TEST-only, offline):**
  - `test-harness/slmm-quota-sql-contract-tests.mjs` (13080 bytes) — static contract over `supabase/migrations/20260926210000_document_upload_quota_reservation.sql` + `src/lib/compress.ts` + `src/lib/storage.functions.ts`.
  - `test-harness/slmm-upload-cap-tests.mjs` (13011 bytes) — DashboardPage / RegisterWizard cap boundaries.
- **Files changed:** `test-harness/harness-registry.mjs` (both added to `OFFLINE_SUITES`). **No** production application code, migration, Supabase config, or deployment config was changed.
- **Commands / outcomes:**
  - `npm run test:offline` -> **exit 0**: `TOTAL tests=497 pass=497 fail=0 skip=0 suites=15 failing_suites=0`.
  - Per suite (all `fail=0 skip=0`): image-opt 63/63; capture 7/7; delivery-mock 108/108; elite-code 44/44; safety 44/44; dashboard-upload 12/12; delete-upload 11/11; orphan-cleanup 9/9; quota-release 15/15; screened-pair 12/12; **upload-cap 12/12**; sql-contract 69/69; **quota-sql-contract 28/28**; harness-safety 17/17; rest-baseline 46/46.
  - `npx tsc --noEmit` -> **exit 0**.
- **Level:** local-only (offline). No network, database, credentials, or `.env` access.
- **Result:** PASS. This **supersedes** the E-005 total of 457/457 across 13 suites with **497/497 across 15 suites**.
- **Limit:** `slmm-quota-sql-contract-tests.mjs` asserts the migration *text*; it does **not** prove the lock is taken or that a concurrent reservation is refused at runtime (see E-007 and `TEST_VERIFICATION_LEDGER.md` §5).

## E-007 — Isolation recheck: `.output` is a production build; gates fail closed (2026-10-17, later)

- **Objective:** Re-verify, read-only, that the current build artifact and Supabase CLI config do not silently target the wrong environment.
- **Commands / observations (read-only; no build, no deploy):**
  - `.output/nitro.json` `date` = `2026-10-16T14:34:43.764Z` (a production-era build, not the 2026-10-15 12:34 TEST build).
  - Production Supabase ref `sxpkutjkqfekqwpabgrk` **present in 4 files**: `.output/public/assets/auth-Bf8dxuBX.js`, `.output/public/assets/client-BRA-u5o0.js`, `.output/server/_ssr/auth-DoOEnCYP.mjs`, `.output/server/_ssr/client-DD7MJSI4.mjs`. TEST ref `nqadtfqyurkpmxcodswc` **absent (0 files)**.
  - `.output/server/wrangler.json` `name` = `slmm-boyar-matrimony` (production Worker).
  - `node scripts/check-build-target.mjs test` -> **exit 1** (fail-closed: expected ref missing, forbidden ref present, Worker-name mismatch).
  - `node scripts/check-build-target.mjs prod` -> **exit 0** (`PASS: build output matches the target environment.`).
  - `supabase/config.toml` (tracked; `git status --porcelain -- supabase/config.toml` empty) -> `project_id = "sxpkutjkqfekqwpabgrk"` (**production**).
  - `wrangler.toml` -> unchanged (empty `git status --porcelain -- wrangler.toml`).
- **Level:** local-only (offline). The checker performs read-only filesystem access; no remote calls.
- **Result / interpretation:** The current `.output` is a **production** artifact and the gate correctly refuses it for `test`. **Do not deploy `.output` to TEST.** `supabase/config.toml` targets production, so any Supabase CLI command against this working tree would point at production until an isolated TEST config is decided. Both are flagged only; **nothing was changed**. Evidence: `PROJECT_STATUS.md` §11; `PENDING_WORK.md` #10.

---

## E-008 — Security hardening: storage-key + reference-integrity suites (run 2026-10-17, later still)

> **Supersession note — 2026-10-22:** this entry is the **original 2026-10-17
> record** made at checkpoint `92804e0`. The bullets below are retained
> unchanged; only their *current-state* wording is superseded, by the dated note
> at the end of this entry. **The measured result (578/578 across 19 suites)
> stands as a historical 2026-10-17 result** — not as the current figure.

- **Context:** three security commits landed after E-007 — `0bb3836` (reject noncanonical R2 storage keys), `4e9e1c0` (verify document references before R2 deletion), `92804e0` (protect non-document R2 references). HEAD is now `92804e0`; `origin/main` is **12 behind**. The regression below was observed on the **current working tree** (HEAD `92804e0` **plus** uncommitted in-progress changes described next).
- **Uncommitted in-progress (NOT mine; preserved):** `test-harness/harness-registry.mjs` (modified) adds `test-harness/slmm-storage-deletion-sql-contract-tests.mjs`, which is **untracked**. So the working tree runs **19** suites, whereas pure HEAD (registry without that entry) would run **18**.
- **Command / outcome:** `npm run test:offline` -> **exit 0**: `TOTAL tests=578 pass=578 fail=0 skip=0 suites=19 failing_suites=0`; `npx tsc --noEmit` -> **exit 0**.
- **Per suite (working tree; all `fail=0 skip=0`):** image-opt 63; capture 7; delivery-mock 108; elite-code 44; safety 44; dashboard-upload 12; delete-upload 58; document-reference-contract 6; storage-reference-contract 10; storage-deletion-sql-contract 11; storage-key 5; orphan-cleanup 10; quota-release 15; screened-pair 13; upload-cap 12; sql-contract 69; quota-sql-contract 28; harness-safety 17; rest-baseline 46.
- **Files added by the three commits (tracked):** `src/lib/storage-key.ts`; `supabase/migrations/20261017120000_document_storage_reference_state.sql`, `supabase/migrations/20261017130000_storage_reference_state.sql`; suites `slmm-storage-key-tests.mjs`, `slmm-document-reference-contract-tests.mjs`, `slmm-storage-reference-contract-tests.mjs`.
- **Level:** local-only (offline). No network, database, credentials, or `.env` access.
- **Result:** PASS. **Supersedes** E-006's 497/497 across 15 suites.
- **Limit:** the reference-integrity suites are static/contract tests over source and migration text; runtime R2/DB behaviour remains UNVERIFIED without an authorized live run.

> **Supersession note — 2026-10-22 (reconciliation to HEAD `1535f9a`).** The
> bullets above are preserved as the original 2026-10-17 record. The following
> supersede only their current-state statements.

- **Git state (supersedes "HEAD is now `92804e0`; `origin/main` is 12 behind"):** `92804e0` is an **ancestor** of the current HEAD `1535f9aa29c5231b5161df9535fbdf7d27c33cbf`; `origin/main` is **identical to HEAD (0 ahead / 0 behind)** — everything through `1535f9a` is pushed. The "12 behind" figure is a historical 2026-10-17 count.
- **578/578 across 19 suites is a HISTORICAL result:** measured **2026-10-17 at checkpoint `92804e0`**. It is retained as evidence of that run and must not be quoted as the current total.
- **Tracking state (supersedes the "Uncommitted in-progress" bullet):** `test-harness/harness-registry.mjs` and `test-harness/slmm-storage-deletion-sql-contract-tests.mjs` are now **tracked and clean** (committed in the `11cbfdc9` lineage). The 19-vs-18-suite distinction described above no longer applies to HEAD.
- **Current registry = 21 suites, but NOT freshly run:** `OFFLINE_SUITES` at HEAD `1535f9a` lists **21** suites. Two later suites are **not covered** by E-008 — `test-harness/slmm-storage-fence-sql-contract-tests.mjs` (added `1a39317`) and `test-harness/slmm-storage-scheduler-tests.mjs` (added `cdff940`). **No fresh complete `npm run test:offline` run has been performed since 2026-10-17**, so neither the current test total nor a current pass/fail verdict is established here.
- **Level unchanged:** local-only (offline). No network, database, credentials, or `.env` access; runtime R2/DB behaviour remains UNVERIFIED.
