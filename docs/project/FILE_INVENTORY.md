# FILE INVENTORY — Sri Lakshmi Mangalya Malai (TEST-ONLY)

> **Read-only audit. No file was deleted, moved, or archived by this document.**
> Removal of any `REMOVE` candidate requires **explicit, per-file user approval** (master instruction §6 / §5). Do not bulk-stage or bulk-delete. Never archive secrets into Git.
> Counts below are the **actual** untracked set at 2026-10-15 12:16: **78 untracked files** (the earlier "~117" was an approximation).

## Classification key

- **KEEP** — required source, configuration, tests, migrations, or useful documentation.
- **ARCHIVE** — valuable historical evidence, reports, logs, or one-time test artifacts.
- **IGNORE** — regenerable build output / caches / local-only files that should not be tracked.
- **REMOVE** — confirmed disposable files with no unique work, dependency, or historical value.

## Summary

| Class | Files |
|---|---|
| KEEP | 15 |
| ARCHIVE | 61 |
| IGNORE | 0 |
| REMOVE (candidates, review first) | 2 |
| **Total** | **78** |

> Note: `.output/`, `node_modules/`, `.wrangler/`, `.tanstack/`, `.history/`, and `.env*` are **git-ignored** and therefore do not appear here.

## KEEP

| Path | Bytes | Purpose | Proposed action |
|---|---:|---|---|
| `scripts/check-build-target.mjs` | 3493 | Fail-closed build-target safety gate (Supabase refs + Worker-name). | KEEP (should be tracked after review). |
| `src/assets/sri-lakshmi-logo.png` | 101744 | Application image asset. | KEEP. |
| `src/lib/screening.ts` | 7420 | Screening source module. | KEEP after verifying imports. |
| `src/lib/gemini-screening.ts` | 9257 | Gemini-based screening module. | KEEP after verifying imports. |
| `supabase/migrations/20261010130000_elite_eligibility_verification.sql` | 17836 | Migration. | KEEP — **REVIEW** (confirm TEST-applied; never auto-merge to prod). |
| `supabase/migrations/20261010140000_add_elite_to_membership_plan_only.sql` | 460 | Migration. | KEEP — REVIEW. |
| `supabase/migrations/20261012120000_repair_lookup_tamil_translations.sql` | 5034 | Migration. | KEEP — REVIEW. |
| `supabase/migrations/20261012130000_seed_sub_caste_lookup.sql` | 3879 | Migration. | KEEP — REVIEW. |
| `supabase/migrations/20261012140000_elite_schema_repair.sql` | 15236 | Migration. | KEEP — REVIEW. |
| `test-harness/admin-aadhaar-verification.sql` | 12003 | TEST-only verification harness. | KEEP (TEST-only). |
| `test-harness/admin-driving-licence-verification.sql` | 13118 | TEST-only verification harness. | KEEP (TEST-only). |
| `test-harness/admin-pan-verification.sql` | 12785 | TEST-only verification harness. | KEEP (TEST-only). |
| `test-harness/admin-passport-verification.sql` | 12946 | TEST-only verification harness. | KEEP (TEST-only). |
| `test-harness/admin-voter-id-verification.sql` | 12901 | TEST-only verification harness. | KEEP (TEST-only). |
| `test-harness/elite-eligibility-verification.sql` | 42003 | TEST-only verification harness. | KEEP (TEST-only). |
| `test-harness/slmm-comm-state.json` | 1252 | TEST harness state. | KEEP (TEST-only; review for non-secret content). |
| `test-harness/slmm-elite-code-tests.mjs` | 13258 | TEST-only code tests. | KEEP (TEST-only). |

_(KEEP count above includes the 5 migrations + 8 harness files + 4 src + 1 script; table lists exactly those.)_

## ARCHIVE — historical evidence / one-time artifacts

### `.tmp-audit/` (debugging + evidence)

| Path | Bytes | Purpose | Proposed action |
|---|---:|---|---|
| `.tmp-audit/audit.mjs` | 2835 | One-time audit script. | ARCHIVE. |
| `.tmp-audit/cleanup-probe.mjs` | 2878 | One-time probe (may touch remote — do not run). | ARCHIVE (flagged). |
| `.tmp-audit/dbg-prod-login.mjs` | 1029 | One-time debug (do not run). | ARCHIVE (flagged). |
| `.tmp-audit/debug-hydrate.mjs` | 1578 | One-time debug. | ARCHIVE. |
| `.tmp-audit/debug-login.mjs` | 1441 | One-time debug. | ARCHIVE. |
| `.tmp-audit/del.mjs` | 1030 | One-time delete helper (destructive — do not run). | ARCHIVE (flagged). |
| `.tmp-audit/drive.mjs` | 4353 | One-time automation. | ARCHIVE. |
| `.tmp-audit/live-probe.mjs` | 2119 | One-time live probe (remote — do not run). | ARCHIVE (flagged). |
| `.tmp-audit/out/after_submit.png` | 39819 | Test screenshot (evidence). | ARCHIVE. |
| `.tmp-audit/out/before_submit.png` | 44415 | Test screenshot (evidence). | ARCHIVE. |
| `.tmp-audit/out/dash_after_login.png` | 146683 | Test screenshot (evidence). | ARCHIVE. |
| `.tmp-audit/out/dash_after_upload.png` | 147221 | Test screenshot (evidence). | ARCHIVE. |
| `.tmp-audit/out/error.png` | 76226 | Test screenshot (evidence). | ARCHIVE. |
| `.tmp-audit/out/probe-upload.jpg` | 415 | Test fixture image. | ARCHIVE. |
| `.tmp-audit/out/tiny.jpg` | 415 | Test fixture image. | ARCHIVE. |
| `.tmp-audit/probe-images.mjs` | 2143 | One-time probe. | ARCHIVE. |
| `.tmp-audit/q.mjs` | 1050 | One-time query script. | ARCHIVE. |
| `.tmp-audit/q2.mjs` | 753 | One-time query script. | ARCHIVE. |
| `.tmp-audit/repro-upload.mjs` | 2917 | One-time repro. | ARCHIVE. |
| `.tmp-audit/sanity-final.mjs` | 5438 | One-time sanity script. | ARCHIVE. |
| `.tmp-audit/scratch-audit-raw.json` | 5971 | Raw audit data (evidence). | ARCHIVE. |
| `.tmp-audit/seed.mjs` | 4599 | One-time seed (may touch remote — do not run). | ARCHIVE (flagged). |
| `.tmp-audit/verify-occ.mjs` | 2193 | One-time verify. | ARCHIVE. |
| `.tmp-audit/verify-occ2.mjs` | 1869 | One-time verify. | ARCHIVE. |
| `.tmp-audit/verify-reopen.mjs` | 2135 | One-time verify. | ARCHIVE. |
| `.tmp-audit/verify-select-retired.mjs` | 2167 | One-time verify. | ARCHIVE. |

### `.tmp-d2-scratch/` (Worker/R2 lifecycle evidence)

| Path | Bytes | Purpose | Proposed action |
|---|---:|---|---|
| `.tmp-d2-scratch/README.md` | 1508 | Scratch notes. | ARCHIVE. |
| `.tmp-d2-scratch/build-run.txt` | 107628 | Build/run log. | ARCHIVE. |
| `.tmp-d2-scratch/delivery-run.txt` | 18538 | Delivery run log. | ARCHIVE. |
| `.tmp-d2-scratch/probe-worker.mjs` | 1013 | One-time worker probe. | ARCHIVE. |
| `.tmp-d2-scratch/r2-403-diagnose.mjs` | 4046 | One-time R2 diagnosis. | ARCHIVE. |
| `.tmp-d2-scratch/r2-config.mjs` | 656 | R2 config helper (review for embedded values — do not run). | ARCHIVE (flagged). |
| `.tmp-d2-scratch/r2-upload-milestone-20261014.md` | 4596 | R2 milestone report (**only repo doc naming the TEST Worker**). | ARCHIVE (important evidence). |
| `.tmp-d2-scratch/r2test-20261014.png` | 238 | Test fixture image. | ARCHIVE. |
| `.tmp-d2-scratch/worker-lifecycle-test-report.txt` | 5446 | Worker lifecycle test report. | ARCHIVE. |
| `.tmp-d2-scratch/worker-lifecycle-test.mjs` | 28336 | One-time worker lifecycle test. | ARCHIVE. |

### Root-level SQL / report evidence

| Path | Bytes | Purpose | Proposed action |
|---|---:|---|---|
| `E2E_PRODUCTION_CONTROLLED_UPLOAD_REPORT.md` | 4159 | E2E report. | ARCHIVE. |
| `fix_auth_uid.sql` | 2808 | One-time SQL fix script. | ARCHIVE. |
| `fix_b1_enum_local.sql` | 3647 | One-time local SQL fix. | ARCHIVE. |
| `payment-review-guard-functional-test-report.txt` | 21185 | Functional test report. | ARCHIVE. |
| `payment_b1_atomic.sql` | 6499 | SQL procedure. | ARCHIVE. |
| `payment_b1_atomic_readonly_precheck.sql` | 13711 | Read-only precheck SQL. | ARCHIVE. |
| `payment_b1_atomic_readonly_precheck.txt` | 9025 | Precheck output. | ARCHIVE. |
| `production-rpc-preflight-clean.sql` | 5011 | Preflight SQL. | ARCHIVE (contains "production" naming — do not execute here). |
| `production-rpc-preflight.sql` | 7412 | Preflight SQL. | ARCHIVE (do not execute here). |
| `profile-self-approval-trigger-report.txt` | 15547 | Trigger test report. | ARCHIVE. |
| `query1_migrations_21120000_21120001.sql` | 327 | Ad-hoc query. | ARCHIVE. |
| `query2_can_message_acl.sql` | 855 | Ad-hoc query. | ARCHIVE. |
| `query3_functions_definitions_acl.sql` | 1442 | Ad-hoc query. | ARCHIVE. |
| `query4_profile_audit.sql` | 1529 | Ad-hoc query. | ARCHIVE. |
| `query5_enums_profile_columns.sql` | 1382 | Ad-hoc query. | ARCHIVE. |
| `query6_lookup_tamil_repair_verify.sql` | 11506 | Ad-hoc query. | ARCHIVE. |
| `query7_sub_caste_lookup_verify.sql` | 3987 | Ad-hoc query. | ARCHIVE. |
| `query8_elite_schema_repair_verify.sql` | 9208 | Ad-hoc query. | ARCHIVE. |
| `receipt-delivery-select-fix-functional-test-report.txt` | 6553 | Functional test report. | ARCHIVE. |
| `setup_auth_schema.sql` | 3710 | One-time setup SQL. | ARCHIVE. |
| `setup_roles.sql` | 2798 | One-time setup SQL. | ARCHIVE. |
| `test-debug.sql` | 2238 | Ad-hoc debug SQL. | ARCHIVE. |
| `.tmp-create-test-users.js` | 1545 | One-time TEST user seeding. | ARCHIVE — **review for embedded credentials before retaining; do not run**. |

## IGNORE

- **None.** Build output (`.output/`), dependencies, caches, and `.env*` are already git-ignored and are not part of the untracked set.

## REMOVE — candidates (require explicit approval; review first)

| Path | Bytes | Reason | Proposed action |
|---|---:|---|---|
| `temp.txt` | 38786 | Root-level scratch file of unknown content. | **REMOVE candidate** — inspect content first; confirm no unique work/evidence before deletion. |
| `src/lib/storage.functions.ts.tmp` | 11179 | `.tmp` sibling of `src/lib/storage.functions.ts` (likely a disposable editor/backup copy). | **REMOVE candidate** — first `git diff`/compare against `src/lib/storage.functions.ts`; keep if it contains unique unmerged work. |

## Next steps for this inventory

1. Review the classifications above (especially the flagged files that could touch remote resources or embed credentials).
2. Approve or amend the `REMOVE` candidates individually.
3. Only then perform removals, and re-run `git status --short` to verify the result and record it in `SESSION_HISTORY.md`.

**No action was taken on any file in this inventory.**

---

## Addendum — 2026-10-15 12:39 (TEST Worker configuration task)

The snapshot and tables above are retained unchanged as the **12:16** record. Dated changes since:

- **ADDED (KEEP):** `.config/nitro.config.mjs` — isolated, fail-closed project Nitro config that pins the TEST Worker name (`slmm-boyar-matrimony-test`) **only** for the TEST build; returns `{}` otherwise. Created 2026-10-15 12:33:33. (Fills the `KEEP` class; also the dedicated TEST configuration location.)
- **PREVIOUSLY UNLISTED:** the five `docs/project/*` history documents (untracked) were not included in the 78-file snapshot.
- **Updated untracked total:** **84** (78 + 5 `docs/project/*` + 1 `.config/nitro.config.mjs`). `git status` reports **0 deletions**; no file was moved, archived, or removed.

| Class | 12:16 snapshot | 12:39 update | Files |
|---|---:|---:|---|
| KEEP | 15* | 15* +1 | +`.config/nitro.config.mjs` |
| ARCHIVE | 61* | 61* | — |
| IGNORE | 0 | 0 | — |
| REMOVE (candidates, review first) | 2 | 2 | `temp.txt`, `src/lib/storage.functions.ts.tmp` |
| _unlisted at 12:16_ | — | +5 | `docs/project/*` |
| **Total untracked** | **78** | **84** | |

\* The 12:16 `KEEP`/`ARCHIVE` summary numbers are retained as printed; only the listed rows and the overall total are reconciled here.

> **Read-only addendum. No file was deleted, moved, or archived.**
> `REMOVE` candidates remain **unapproved**: removal of `temp.txt` and `src/lib/storage.functions.ts.tmp` still requires explicit per-file user approval (compare the `.tmp` against `src/lib/storage.functions.ts` first).

---

## Addendum — 2026-10-17 (untracked reconciliation; read-only)

The 12:16 snapshot and 12:39 addendum above are retained as history. Authoritative current state:

- **Untracked count (2026-10-17):** **72** (`git ls-files --others --exclude-standard`), down from 84. `git status` reports **0 deletions**; nothing was moved or archived.
- **Why the count fell (not deletions):**
  - Phase 5B commit `ff1abb1` tracked several previously-untracked files: `scripts/run-offline-tests.mjs`, `test-harness/README.md`, `harness-registry.mjs`, `live-guard.mjs`, `slmm-comm-test.mjs`, `slmm-harness-safety-tests.mjs`, `slmm-receipt-delivery-test.mjs`, `slmm-rest-baseline-tests.mjs`, `slmm-rest-baseline.mjs`.
  - The **six** `docs/project/*.md` documents are now **staged** (`A`), not untracked.
  - Five generated artifacts are now **git-ignored** (`.gitignore` lines 29–34): `test-harness/slmm-comm-state.json`, `receipt-delivery-select-fix-functional-test-report.txt`, `payment-review-guard-functional-test-report.txt`, `profile-self-approval-trigger-report.txt`, `payment_b1_atomic_readonly_precheck.txt`.
- **Still untracked and flagged (KEEP, unchanged):** `scripts/check-build-target.mjs` (referenced by `package.json` `build:test` and by `slmm-harness-safety-tests.mjs`), `test-harness/slmm-elite-code-tests.mjs` (listed in `harness-registry.mjs` `OFFLINE_SUITES`), `.config/nitro.config.mjs`, `src/assets/sri-lakshmi-logo.png`, the five `supabase/migrations/*.sql`, the six `test-harness/*-verification.sql`, the `.tmp-audit/` and `.tmp-d2-scratch/` evidence trees, and the root SQL/report files.
- **REMOVE candidates (unchanged, still unapproved):** `temp.txt`, `src/lib/storage.functions.ts.tmp`.
- **Tracking gap (not a deletion):** because `scripts/check-build-target.mjs` and `test-harness/slmm-elite-code-tests.mjs` remain untracked, a fresh clone would lack them — `npm run build:test` and the `slmm-elite-code-tests.mjs` row of `npm test` would not work until they are tracked. Flagged for the checkpoint decision (see `PENDING_WORK.md` / `TEST_EVIDENCE.md` E-005).

---

## Addendum — 2026-10-17 (later) — new offline suites + production-artifact flag (read-only)

The snapshots and addenda above are retained as history. Dated changes since:

- **ADDED (KEEP, untracked):** `test-harness/slmm-quota-sql-contract-tests.mjs` (13080 bytes) — offline static contract over the quota migration + `src/lib/compress.ts` + `src/lib/storage.functions.ts`; and `test-harness/slmm-upload-cap-tests.mjs` (13011 bytes) — DashboardPage / RegisterWizard cap boundary tests.
- **CHANGED (tracked; the file was already modified in the working tree):** `test-harness/harness-registry.mjs` — both new files added to `OFFLINE_SUITES` (offline suite count 13 -> 15).
- **Untracked total (2026-10-17, later):** **74** (`git ls-files --others --exclude-standard`) — up from 72 by exactly the two new test files above. The six `docs/project/*.md` remain **staged** (`A`). `git status` reports **0 deletions**; nothing was moved or archived; `REMOVE` candidates (`temp.txt`, `src/lib/storage.functions.ts.tmp`) remain **unapproved**.
- **FLAGGED (build artifact; not tracked):** `.output` is currently a **production** build (stamp `2026-10-16T14:34:43.764Z`; Worker name `slmm-boyar-matrimony`; production Supabase ref in 4 files). `.output/` is git-ignored and must **not** be deployed to TEST. Evidence: `TEST_EVIDENCE.md` E-007.
- **FLAGGED (tracked, unmodified):** `supabase/config.toml` `project_id` = production ref `sxpkutjkqfekqwpabgrk` (Supabase CLI isolation gap). **Not changed.**
- **Tracking gap (unchanged):** `scripts/check-build-target.mjs`, `test-harness/slmm-elite-code-tests.mjs`, and the two new suites remain untracked — a fresh clone would lack them.

> **Read-only addendum. No file was deleted, moved, or archived.**
