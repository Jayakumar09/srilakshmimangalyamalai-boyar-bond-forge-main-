# PENDING WORK — Sri Lakshmi Mangalya Malai (TEST-ONLY)

> Statuses: `OPEN`, `BLOCKED`, `DONE`. Completed items are marked `DONE` and **not removed** (historical record lives in `SESSION_HISTORY.md`).
> Isolation policy: `docs/project/PROJECT_STATUS.md` §8 (binding). No build, remote operation, merge, commit, push, or deployment is authorized by this document. Do not bypass a failed safety check to complete a build.

_Last updated: 2026-10-17_

## TEST / Production Isolation Policy (record — binding)

1. **Separate TEST configuration.** All TEST-specific configuration, scripts, build outputs, test evidence, and procedures must remain separate from production configuration. Use a dedicated TEST configuration directory where appropriate; **do not overwrite or repurpose production configuration files.**
2. **No automatic merging.** TEST configuration, TEST-only scripts, TEST environment settings, and TEST-generated artifacts must **never** be automatically copied, merged, committed into a production release, or deployed to production.
3. **Production protection.** Preserve the existing production `wrangler.toml`, production Supabase project reference, production Worker name (`slmm-boyar-matrimony`), production R2 bucket, and production environment settings. Do not modify these during TEST work.
4. **TEST targets only.** TEST Supabase = `nqadtfqyurkpmxcodswc`; TEST Worker = `slmm-boyar-matrimony-test`; TEST R2 bucket = `srilakshmimangalyamalai-test`. Verify the target before continuing.
5. **Fail-closed safety checks.** A TEST build referencing production resources, or a production build referencing TEST resources, must fail validation. Never bypass a failed check merely to complete a build.
6. **Separate release approval.** Moving a tested feature from TEST to production requires separate, explicit approval; identify exact application changes and exclude TEST-only configuration, credentials, data, artifacts, and procedures.
7. **No deployment authorization implied.** Approval to create history documents does not authorize a build, remote operation, production modification, merge, commit, push, or deployment.

## Pending / blocked items

1. **[DONE 2026-10-15 12:39] Generate a TEST-named Worker configuration safely.**
   **Resolved** via isolated project Nitro config `.config/nitro.config.mjs` (fail-closed; active only for `npm run build:test` or `SLMM_BUILD_TARGET=test`). Verified: `npm run build:test` exit 0 → `.output/server/wrangler.json` name `slmm-boyar-matrimony-test`; `node scripts/check-build-target.mjs test` exit 0. Evidence: `TEST_EVIDENCE.md` E-004; `SESSION_HISTORY.md` 12:39. Original problem statement retained below.
   `.output/server/wrangler.json` names the production Worker (`slmm-boyar-matrimony`), so `node scripts/check-build-target.mjs test` fails closed. **Blocker:** determine a **safe** way to produce a TEST-named Worker configuration (→ `slmm-boyar-matrimony-test`) **without** modifying production `wrangler.toml` and **without** deploying anything. Do not run a build or deploy to "test" an approach until reviewed and approved.
   - Dependency: the build currently derives the Worker name from `wrangler.toml` (`name = "slmm-boyar-matrimony"`); Nitro emits it into `.output/server/wrangler.json`.
   - Constraint: production protection (policy #3) — do not repurpose production config (isolation policy #1).

2. **[DONE 2026-10-17] Nitro build pointer drift.**
   `node_modules/.nitro/last-build.json` = `../../.output` while the backup `node_modules/.nitro/last-build.json.backup-20261015` = `../../../.output`. Against Nitro's reader (`resolve(lastBuildLink, data.outputDir)` where `lastBuildLink` includes the filename), `../../../.output` is correct; the current value resolves outside `.output` and would break `nitro deploy --prebuilt`. **Not restored in this task** (out of scope). Restore only after confirmation, and only the pointer file.
   - **Update 2026-10-15 12:39:** the approved `npm run build:test` rewrote this file to `{"outputDir":"../../../.output"}` (mtime `2026-10-15 12:34:13`) — the correct value. It was **not** changed manually.
   - **Update 2026-10-17 — CLOSED (explicitly verified):** `node_modules/.nitro/last-build.json` was read directly and contains `{"outputDir":"../../../.output"}`, the correct value for Nitro's reader. No manual edit was made. Evidence: `TEST_EVIDENCE.md` E-005 (isolation update).

3. **[DONE 2026-10-15 12:39] `.output` / artifact inconsistency.**
   `.output` currently contains TEST Supabase refs but a production-named Worker. `.output/server/wrangler.json` was observed modified (`2026-10-15 11:52:02`) outside any recorded tool action. Verify provenance before relying on any artifact.
   - **Update 2026-10-15 12:39:** resolved — the rebuilt `.output` (stamp 12:34:13) contains TEST Supabase refs **and** the TEST Worker name; the earlier out-of-band modification is superseded by this recorded build.

4. **[DONE 2026-10-15 12:39] No dedicated TEST configuration directory.**
   TEST configuration is not yet isolated from production config files (isolation policy #1). Decide the TEST config layout (do not modify production files).
   - **Update 2026-10-15 12:39:** resolved — the project Nitro config now lives in the dedicated `.config/` directory (`.config/nitro.config.mjs`) and does not touch production config files.

5. **[OPEN] Untracked-file backlog (78 → 84 files).**
   Read-only classification recorded in `docs/project/FILE_INVENTORY.md`. **No deletions performed.** Removal requires explicit approval per file; preserve evidence and secrets-free handling.
   - **Update 2026-10-15 12:39:** count is now **84** (78 recorded at 12:16, +5 untracked `docs/project/*` documents, +1 new `.config/nitro.config.mjs`). No file was deleted or moved.
   - **Update 2026-10-17:** the current untracked count is **72** (`git ls-files --others --exclude-standard`). The drop from 84 is **not** deletions: the Phase 5B commit `ff1abb1` tracked several previously-untracked `test-harness/*.mjs` and `scripts/run-offline-tests.mjs`; the six `docs/project/*.md` files are now **staged** (`A`); and five generated artifacts were added to `.gitignore`. `git status` still reports **0 deletions**; nothing was moved or removed. Reconciliation recorded in `FILE_INVENTORY.md` (2026-10-17 addendum).

6. **[DONE 2026-10-17] Focused tests for storage/quota helpers.**
   **Resolved** — offline suites now exist and pass: `slmm-orphan-cleanup-tests.mjs` (9/9, `cleanupOrphanedUploads` authorization/ownership), `slmm-quota-release-tests.mjs` (15/15, reserve/release + ambiguous-PUT control flow), `slmm-screened-pair-quota-tests.mjs` (12/12), `slmm-dashboard-upload-tests.mjs` (12/12, client caps 6/5/11/20 MiB + cleanup only on a failed `documents` INSERT), `slmm-delete-upload-tests.mjs` (11/11). Wired into `npm test` / `npm run test:offline` via `test-harness/harness-registry.mjs` + `scripts/run-offline-tests.mjs`. Fresh run 2026-10-17: **457/457 across 13 suites** (evidence: `TEST_EVIDENCE.md` E-005). Original problem statement retained below.
   > No local unit-test runner for `cleanupOrphanedUploads` / quota-release guard; only manual/offline verification so far.
   - **Boundary:** the Postgres RPC caps (6/5/11/20 MiB) and the advisory (concurrent-reservation) lock live in Postgres and are **not** offline-verifiable; they remain UNVERIFIED until a separately authorized live TEST run.

7. **[OPEN — FUTURE, needs explicit approval] TEST→production release.**
   Requires separate explicit approval; must identify exact application changes and exclude TEST-only config/credentials/data/artifacts (isolation policy #6). Explicitly **NOT** authorized.

## Done (historical — do not remove)

- **[DONE] 2026-10-15** — Strengthened `scripts/check-build-target.mjs` with a Cloudflare Worker-name guard (test/prod). Evidence: `TEST_EVIDENCE.md` E-002; details in `SESSION_HISTORY.md` 12:05.
- **[DONE] 2026-10-15** — Created the five project-history documents and recorded the isolation policy. Evidence: `TEST_EVIDENCE.md` E-003; `SESSION_HISTORY.md` 12:16.
- **[DONE] 2026-10-15 12:39** — Created `.config/nitro.config.mjs` (isolated, fail-closed TEST Worker-name override). Verified: `npm run build:test` exit 0; `.output/server/wrangler.json` name `slmm-boyar-matrimony-test`; `node scripts/check-build-target.mjs test` exit 0; TEST Supabase ref present / production ref absent; override returns `{}` outside TEST mode; production `wrangler.toml` unchanged. Evidence: `TEST_EVIDENCE.md` E-004; `SESSION_HISTORY.md` 12:39.
- **[DONE] 2026-10-15 12:39** — `.output` consistency restored by the rebuild (TEST refs + TEST Worker name) and a dedicated TEST config location established (`.config/`). Resolves former items #3 and #4.
- **[DONE] 2026-10-16** — Phase 0–5A committed locally: `74dca16`, `210b436`, `9e0405d`, `c530cd1`, `fdb34c3`, `bd29300`, `8ca0d5a` (offline SQL security-contract suite added in `8ca0d5a`). Not pushed at that time.
- **[DONE] 2026-10-16** — Phase 5B committed locally as **`ff1abb1`** ("Add Phase 5B live harness safety and offline test runner"): fail-closed runtime gate `test-harness/live-guard.mjs`, single-source registry `harness-registry.mjs`, safe offline runner `scripts/run-offline-tests.mjs`, validated pagination reader `slmm-rest-baseline.mjs`, hardened comm/receipt harnesses, `slmm-harness-safety-tests.mjs`, and a narrowed `.gitignore`. Evidence: `TEST_EVIDENCE.md` E-005; `TEST_VERIFICATION_LEDGER.md`.
- **[DONE] 2026-10-17** — Storage/quota offline verification completed: `npm run test:offline` **457/457** (13 suites, exit 0); `npx tsc --noEmit` exit 0; Nitro build pointer explicitly verified (closes item #2); untracked backlog reconciled to 72 (`FILE_INVENTORY.md`). No live harness run, no remote access, no build/deploy. Evidence: `TEST_EVIDENCE.md` E-005.
- **[PENDING — needs explicit approval] 2026-10-17** — Narrow documentation checkpoint (the six `docs/project/*.md`) prepared but **not committed**; awaiting explicit approval.

---

## Update — 2026-10-17 (later) — offline quota-contract coverage; residual `.env` issue (append-only)

> The items above are retained unchanged. The following are added by this dated update.

8. **[DONE 2026-10-17] Offline static coverage for the Postgres quota RPC caps + advisory lock.**
   Resolved **statically only** via `test-harness/slmm-quota-sql-contract-tests.mjs` (**28/28**): asserts the migration text defines the counter table, the per-owner `pg_advisory_xact_lock`, the `service_role` guard, the exact caps (6 photo / 5 doc / 11 file / 20 MiB), the GREATEST floors, and the REVOKE/GRANT surface. Companion `test-harness/slmm-upload-cap-tests.mjs` (**12/12**) covers the client-side caps. Both registered in `test-harness/harness-registry.mjs`; fresh total **497/497 across 15 suites**, `npx tsc --noEmit` exit 0 (evidence: `TEST_EVIDENCE.md` E-006). **Residual:** this is source-text coverage, **not** runtime DB verification — a live SQL run is still required. This **supersedes** the "not offline-verifiable" wording in item #6's boundary note.

9. **[OPEN — security] Live harnesses still read the repo-root `.env`, not `.env.test`.**
   Phase 5B added the fail-closed gate `test-harness/live-guard.mjs` (good), but the credential file is unchanged: `slmm-receipt-delivery-test.mjs` reads `ROOT + "/.env"`; `slmm-comm-test.mjs` reads `<repo-root>/.env`. Neither reads `.env.test`. **No credentials were read** in this task. Requires remediation (point to `.env.test`, no `.env` fallback) before any authorized live run. Consequently `TEST_VERIFICATION_LEDGER.md` §4 prerequisite #2 ("read `.env.test` only") is only **partially** met.

10. **[OPEN — ops/isolation] `.output` is a PRODUCTION build; `supabase/config.toml` targets production.**
   `.output` (stamp `2026-10-16T14:34:43.764Z`) carries the production Worker name (`slmm-boyar-matrimony`) and the production Supabase ref `sxpkutjkqfekqwpabgrk` in 4 files; `node scripts/check-build-target.mjs test` correctly fails closed, `... prod` passes. `supabase/config.toml` (tracked, **unmodified**) has `project_id = "sxpkutjkqfekqwpabgrk"` (the production project ref recorded in `PROJECT_STATUS.md` §4), so the Supabase CLI would target production. **Do not** deploy `.output` to TEST. Do not run CLI commands against the project until an isolated TEST config is decided. Flagged only; nothing changed. Evidence: `TEST_EVIDENCE.md` E-007.

11. **[BLOCKED — deployment/isolation] TEST `R2_BUCKET_NAME` binding is UNVERIFIED; TEST deployment and live R2 tests are BLOCKED.**
   The Worker does not bind R2 via `wrangler.toml` (no `[[r2_buckets]]` block exists — it contains only the Worker name); R2 is accessed at runtime through `process.env["R2_BUCKET_NAME"]` (`src/lib/storage.functions.ts`, `src/lib/receipts.functions.ts`), whose value is supplied by the runtime environment/secret and is **not** pinned by any committed non-secret configuration. The TEST bucket (`srilakshmimangalyamalai-test`) therefore **cannot be proven** from repository configuration and the binding remains **UNVERIFIED**. **Explicitly blocked:** do **not** deploy to TEST and do **not** run live R2 tests/uploads until the correct TEST bucket (`R2_BUCKET_NAME` = `srilakshmimangalyamalai-test`, never the production bucket `srilakshmimangalyamalai`) is independently verified. This item was accepted as UNVERIFIED for the LOCAL-ONLY documentation/offline-test checkpoint (`2026-10-17`); that acceptance does **not** authorize any TEST or production deployment. Evidence: read-only Cloudflare TEST identity/isolation audit, 2026-10-17.

---

## Update — 2026-10-17 (checkpoint) — local commit `9d810a9` (append-only)

> Items above are retained unchanged. The following corrects the git-state statements.

12. **[DONE 2026-10-17] Narrow documentation checkpoint created locally.**
    Committed as **`9d810a9`** (`test(offline): add quota SQL-contract and upload-cap suites; track build-target gate`): `A` — the six `docs/project/*.md`, `scripts/check-build-target.mjs`, `.config/nitro.config.mjs`, `test-harness/slmm-elite-code-tests.mjs`, `test-harness/slmm-quota-sql-contract-tests.mjs`, `test-harness/slmm-upload-cap-tests.mjs`; `M` — `test-harness/harness-registry.mjs`. **Supersedes** the earlier "[PENDING — needs explicit approval] ... not committed" note and the "untracked backlog = 72" figure in the `[DONE] 2026-10-17` entry above. **Untracked is now 69; 0 staged.** HEAD = `9d810a9`; `origin/main` is **9 behind**; **not pushed**. Evidence: `TEST_EVIDENCE.md` E-006/E-007; `PROJECT_STATUS.md` §12; `FILE_INVENTORY.md` checkpoint addendum.
13. **[DONE — superseded 2026-10-22] Push not authorized.** No push has occurred. Any push of `main` would publish **9** commits (`74dca16` … `9d810a9`), not just this checkpoint. Awaiting explicit approval.
    > **Supersession — 2026-10-22:** approval was subsequently given and the pushes completed. `origin/main` is now **identical to HEAD `1535f9a` (0 ahead / 0 behind)**. The "9 commits" figure is retained as a historical 2026-10-17 count; the original record above is unchanged.
14. **[DONE 2026-10-17] R2 storage-key + reference-integrity security hardening (offline-verified).**
    Commits `0bb3836`, `4e9e1c0`, `92804e0` added `src/lib/storage-key.ts`, two reference-state migrations (`20261017120000_document_storage_reference_state.sql`, `20261017130000_storage_reference_state.sql`), and three offline contract suites (`slmm-storage-key-tests` 5/5, `slmm-document-reference-contract-tests` 6/6, `slmm-storage-reference-contract-tests` 10/10), plus expanded `slmm-delete-upload-tests` (58), `slmm-orphan-cleanup-tests` (10), and `slmm-screened-pair-quota-tests` (13). Fresh total (working tree): **578/578 across 19 suites**, `npx tsc --noEmit` exit 0 (evidence: `TEST_EVIDENCE.md` E-008). **Recount of item #13:** `origin/main` is now **12 behind** HEAD `92804e0` — a push would publish **12** commits. **Not pushed.** An in-progress working-tree change (`harness-registry.mjs` + untracked `test-harness/slmm-storage-deletion-sql-contract-tests.mjs`) is present and **preserved, not committed by this task**.
    > **Supersession — 2026-10-22:** the trailing Git/tracking statements above are superseded; the original record is retained unchanged.
    > - **Git state:** `origin/main` is now **identical to HEAD `1535f9a` (0 ahead / 0 behind)** — the "12 behind / not pushed" gap no longer exists. All commits through `1535f9a` are published.
    > - **Test figure:** **578/578 across 19 suites is a historical 2026-10-17 measurement at checkpoint `92804e0`**, retained via `TEST_EVIDENCE.md` E-008. The registry at HEAD now lists **21** `OFFLINE_SUITES` (two later suites — fence and scheduler — are not covered), and **no fresh complete offline run has been performed** since 2026-10-17.
    > - **Tracking state:** the "in-progress" change (`harness-registry.mjs` + untracked `slmm-storage-deletion-sql-contract-tests.mjs`) is **resolved** — both are tracked and clean (committed in the `11cbfdc9` lineage). The currently preserved uncommitted harness change is a **one-line** edit in `test-harness/slmm-storage-fence-sql-contract-tests.mjs` (NOT committed; preserved).
