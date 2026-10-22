# PROJECT STATUS — Sri Lakshmi Mangalya Malai (Boyar Matrimony) PWA

> **Environment: TEST-ONLY.** All work in this repository is against the TEST
> environment until the user explicitly changes that policy in a separate
> written instruction. See "TEST / Production Isolation Policy" and
> "Session Recovery Instructions" below.

_Last updated: 2026-10-22 (local) — see **§14** for the current state; **§1–§13 are
retained as dated history** and are not rewritten._

## 1. Project identity

- **Name:** Sri Lakshmi Mangalya Malai (Boyar Matrimony) — self-hosted PWA.
- **Repository location:** `D:\DevProjects\Working\srilakshmimangalyamalai(boyar-bond-forge-main)`
- **Not connected to Lovable.** Do not reconnect Lovable; do not use it for builds, previews, publishing, or deployment.
- **Toolchain:** Vite + TanStack Start, Nitro (`cloudflare-module` preset), Cloudflare Workers output. `npx wrangler` (global v4.76.0) is used indirectly via Nitro scripts.

## 2. Git state

- **Branch:** `main`
- **HEAD commit:** `ff1abb1` (`ff1abb13d082e817715bffdc5102e304374ccbb4`) — `Add Phase 5B live harness safety and offline test runner`.
- **Commits since `cdd5279` (all local; authored 2026-10-16; not pushed):** `74dca16`, `210b436`, `9e0405d`, `c530cd1`, `fdb34c3`, `bd29300`, `8ca0d5a`, `ff1abb1`. `origin/main` is **8 behind** HEAD.
- **Working tree (2026-10-17):** **37 modified tracked** files (unrelated in-progress feature work — preserve); **72 untracked** files (preserve); **6 staged** files (`docs/project/*.md`, index status `A`). `git status` reports **0 deletions**.
- Working tree changes are **all uncommitted**. Preserve them; never reset/clean/force-push.
- **Update 2026-10-15 12:39 (historical):** untracked files were **84** (78 recorded at 12:16, +5 pre-existing untracked `docs/project/*` documents, +1 new `.config/nitro.config.mjs`); modified tracked **39**; nothing staged; no commits.
- **Update 2026-10-17:** HEAD advanced to `ff1abb1` via Phases 0–5B; **6** `docs/project/*.md` are staged; untracked is now **72** (see `FILE_INVENTORY.md` 2026-10-17 addendum). No push has occurred.

## 3. TEST identifiers (the only permitted targets)

- **TEST Supabase project ref:** `nqadtfqyurkpmxcodswc`
- **TEST Worker name:** `slmm-boyar-matrimony-test`
- **TEST Worker URL:** `https://slmm-boyar-matrimony-test.srilakshmimangalyamalai.workers.dev`
- **TEST R2 bucket:** `srilakshmimangalyamalai-test`

## 4. Production identifiers (for safety recognition ONLY — never a target here)

- **Production Supabase project ref:** `sxpkutjkqfekqwpabgrk`
- **Production Worker name:** `slmm-boyar-matrimony`
- **Production domain:** `https://srilakshmimangalyamalai.com`
- **Production R2 bucket:** `srilakshmimangalyamalai`

> No passwords, API keys, service-role keys, tokens, or R2 secret keys are recorded in this document, by policy.

## 5. Current successful build & test results

- `npx tsc --noEmit` — clean (last run before the safety-guard task).
- `npm run build` — exit 0 (earlier session).
- `npm run build:test` — exit 0; gate `PASS` (TEST Supabase ref present in 4 output files, production ref absent). Build artifact timestamp `2026-10-15T10:46:49Z`.
- `scripts/check-build-target.mjs` — **strengthened** to also validate the generated Cloudflare Worker name (see `SESSION_HISTORY.md`, 2026-10-15 12:05).
- **Current expected state:** running `node scripts/check-build-target.mjs test` against the current `.output` **fails closed** because `.output/server/wrangler.json` still names the production Worker (`slmm-boyar-matrimony`) instead of `slmm-boyar-matrimony-test`.
- **Update 2026-10-15 12:39 — TEST Worker configuration resolved (supersedes the line above):** `npm run build:test` → **exit 0**; generated `.output/server/wrangler.json` name = `slmm-boyar-matrimony-test`; gate `PASS` (TEST Supabase ref `nqadtfqyurkpmxcodswc` present in 4 files, production ref `sxpkutjkqfekqwpabgrk` absent in 0 files). `node scripts/check-build-target.mjs test` → **exit 0** (PASS). Build stamp `.output/nitro.json` `date = 2026-10-15T07:04:13.176Z` (= 12:34:13 local). Evidence: `TEST_EVIDENCE.md` E-004; `SESSION_HISTORY.md` 12:39.
- **Update 2026-10-17 — current offline results (freshly run):** `npm run test:offline` → **exit 0**, `TOTAL tests=457 pass=457 fail=0 skip=0 suites=13 failing_suites=0`; `npx tsc --noEmit` → **exit 0**. No live harness run, no remote access, no build, no deploy. Evidence: `TEST_EVIDENCE.md` E-005.

## 6. Known issues & risks

1. **TEST Worker name not generated.** The build embeds the production Worker name in `.output/server/wrangler.json`; the `test` safety check now correctly rejects it. Root cause not yet resolved (see `PENDING_WORK.md` #1).
2. **`.output` is inconsistent:** TEST Supabase refs but a production-named Worker.
3. **Nitro build pointer drift (out-of-band).** `node_modules/.nitro/last-build.json` currently holds `../../.output` while its backup `last-build.json.backup-20261015` holds `../../../.output`. Resolved against Nitro's reader, `../../../.output` is the correct value; the current value resolves outside `.output` and would break `nitro deploy`. Also, `.output/server/wrangler.json` was observed modified at a time outside any recorded tool action. **Not yet changed** (deferred; see `PENDING_WORK.md`).
4. **No dedicated TEST configuration directory.** TEST-specific configuration is not yet isolated from production configuration files.
5. **Untracked-file backlog.** 78 untracked files require review; classification recorded in `FILE_INVENTORY.md` (no deletions performed).
6. **Focused tests limited.** No local unit-test runner for some storage/quota helpers.

- **Update 2026-10-15 12:39 (status of the issues above):**
  1. **RESOLVED** — issue #1 (TEST Worker name not generated): an isolated project Nitro config `.config/nitro.config.mjs` now pins `cloudflare.wrangler.name = "slmm-boyar-matrimony-test"` **only** for the TEST build (`npm run build:test` / `SLMM_BUILD_TARGET=test`); it returns `{}` otherwise (fail-closed). Production `wrangler.toml` is **unchanged**. Evidence: `TEST_EVIDENCE.md` E-004.
  2. **RESOLVED** — issue #4 (no dedicated TEST configuration directory): the project Nitro config lives in a dedicated `.config/` directory and does not touch production config files.
  3. **ADDRESSED** — issue #3 (`.output` inconsistency): the rebuilt `.output` now contains TEST Supabase refs **and** the TEST Worker name; the earlier out-of-band modification is superseded by this recorded build.
  4. **UPDATE** — issue #2 (Nitro build pointer): the build process rewrote `node_modules/.nitro/last-build.json` to `{"outputDir":"../../../.output"}` (mtime `2026-10-15 12:34:13`), which is the correct value. Not changed manually; the remaining investigation stays **open** until explicitly verified (see `PENDING_WORK.md` #2).
  5. **UPDATE** — issue #5 (untracked backlog): count is now 84 (see §2 update).
- **Update 2026-10-17 (status of the issues above):**
  6. **RESOLVED** — issue #6 (focused tests limited): offline suites now cover the storage/quota helpers; `npm test` runs **457/457** across 13 suites (see `PENDING_WORK.md` #6; `TEST_EVIDENCE.md` E-005).
  7. **CLOSED** — issue #2 (Nitro build pointer): `node_modules/.nitro/last-build.json` explicitly verified = `{"outputDir":"../../../.output"}` (see `PENDING_WORK.md` #2). Issue #5 (untracked backlog): reconciled to **72** (`FILE_INVENTORY.md` 2026-10-17 addendum).

## 7. Current task & next action

- **Current task:** Create/record the five project-history documents and the TEST/Production isolation policy (2026-10-15 12:16).
- **Next action:** Determine a **safe** way to generate a TEST-named Worker configuration (`.output/server/wrangler.json` → `slmm-boyar-matrimony-test`) **without** modifying production `wrangler.toml` and **without** deploying anything. Do not run a build or deploy until that approach is reviewed and approved.
- **Update 2026-10-15 12:39 — task complete:** created `.config/nitro.config.mjs` (isolated, fail-closed TEST Worker-name override). Verified: `npm run build:test` exit 0; `.output/server/wrangler.json` name `slmm-boyar-matrimony-test`; `node scripts/check-build-target.mjs test` exit 0; TEST Supabase ref present and production ref absent; the override returns `{}` outside TEST mode; production `wrangler.toml` unchanged. **No** deployment, remote access, database writes, R2 operations, staging, commit, or push occurred.
- **Next action (from 2026-10-15 12:39):** (a) explicitly verify the Nitro pointer before closing `PENDING_WORK.md` #2; (b) review the `FILE_INVENTORY.md` `REMOVE` candidates (`temp.txt`, `src/lib/storage.functions.ts.tmp`) for per-file approval; (c) any deployment remains separately gated (no dry-run attempted).

## 8. TEST / Production Isolation Policy (binding)

> **Clarification (2026-10-16, documentation only):** TEST-only is the authorized operational policy, **not** a guarantee that every existing harness is configured for TEST. `test-harness/slmm-comm-test.mjs` reads `.env` and hardcodes the production Supabase endpoint; `test-harness/slmm-receipt-delivery-test.mjs` reads `.env` and can touch live Supabase/R2. Both remain **BLOCKED — DO NOT RUN** in this workflow. See `TEST_VERIFICATION_LEDGER.md` §4. This clarification does not change the 2026-10-15 history above.
>
> **Correction (2026-10-17) — supersedes the 2026-10-16 clarification:** Phase 5B (`ff1abb1`) removed the hardcoded production endpoint and the `.env` fallback from both live harnesses. Each now requires the explicit opt-in triple (`SLMM_LIVE_TESTS=true`, `SLMM_LIVE_TARGET=test`, `SLMM_LIVE_ACK=<exact harness filename>`) and must pass `test-harness/live-guard.mjs` **before** any credential load, network call, or client construction; a missing/non-TEST signal or missing ack refuses (exit 2). They **remain BLOCKED — DO NOT RUN** here (no live authorization). See `TEST_VERIFICATION_LEDGER.md` §4.

1. **Separate TEST configuration.** All TEST-specific configuration, scripts, build outputs, test evidence, and procedures must remain separate from production configuration. Use a dedicated TEST configuration directory where appropriate; **do not overwrite or repurpose production configuration files.**
2. **No automatic merging.** TEST configuration, TEST-only scripts, TEST environment settings, and TEST-generated artifacts must **never** be automatically copied, merged, committed into a production release, or deployed to production.
3. **Production protection.** Preserve the existing production `wrangler.toml`, production Supabase project reference, production Cloudflare Worker name (`slmm-boyar-matrimony`), production R2 bucket, and production environment settings. Do not modify these during TEST work.
4. **TEST targets only.** TEST Supabase = `nqadtfqyurkpmxcodswc`; TEST Worker = `slmm-boyar-matrimony-test`; TEST R2 bucket = `srilakshmimangalyamalai-test`. Any TEST build or procedure must verify its target before continuing.
5. **Fail-closed safety checks.** If a TEST build references production resources, or a production build references TEST resources, validation must fail. **Never bypass a failed check merely to complete a build.**
6. **Separate release approval.** Moving a tested feature from TEST to production requires a separate, explicit approval. Before any such release, identify the exact application changes intended for release and exclude TEST-only configuration, credentials, data, artifacts, and procedures.
7. **No deployment authorization implied.** Approval to create project history documents does **not** authorize a build, remote operation, production modification, merge, commit, push, or deployment.

## 9. Session Recovery Instructions (follow at the start of EVERY new session)

Before editing any file:

1. Read `docs/project/CURRENT_HANDOVER.md` (front-door state) and `docs/project/TASK_INDEX.md` (authoritative task list + statuses), then this instruction and this `PROJECT_STATUS.md` (including §8 Isolation Policy, which is binding).
2. Read the latest entries of `docs/project/SESSION_HISTORY.md`.
3. Read `docs/project/TEST_EVIDENCE.md`.
4. Read `docs/project/PENDING_WORK.md`.
5. Read `docs/project/FILE_INVENTORY.md`.
6. Inspect Git state without changing it: `git status --short`, `git branch --show-current`, `git log -5 --oneline`.
7. Verify the current TEST configuration **without displaying secret values**.
8. Identify the last confirmed successful task and the next unfinished task.
9. Summarize the recovered state and propose **one** next action.

Do not restart completed work. Do not assume a previously successful test still passes if code/config changed. If a history file is missing or incomplete, reconstruct from Git history/reports/logs and label reconstructed facts as such. If the previous session stopped unexpectedly, preserve the working tree and resume from the last verified checkpoint.

**Mandatory:** every successfully completed task must be recorded immediately (Section 4 of the master instruction) and verified; every fresh session must recover its state from these documents before proceeding.

## 10. Last history entry date

- **2026-10-22** — latest entry is the appended T6 correction in
  `docs/project/SESSION_HISTORY.md` (`2026-10-22 (later)`).
- **2026-10-17** (previous; see `docs/project/SESSION_HISTORY.md`).

---

## 11. Update — 2026-10-17 (later) — offline suites added; fresh 497/497

> **Append-only superseding note.** The counts in sections 2, 5, and 6 above (457/457 across 13 suites; untracked 72; "37 modified tracked") are retained as the earlier 2026-10-17 record. The freshly measured current state is below.

- **Offline regression (freshly observed 2026-10-17, later):** `npm run test:offline` -> **exit 0**, `TOTAL tests=497 pass=497 fail=0 skip=0 suites=15 failing_suites=0`; `npx tsc --noEmit` -> **exit 0**.
- **Two suites added since the earlier 2026-10-17 snapshot** (both registered in `test-harness/harness-registry.mjs` `OFFLINE_SUITES`):
  - `test-harness/slmm-quota-sql-contract-tests.mjs` — **28/28**. Offline *static* contract over `supabase/migrations/20260926210000_document_upload_quota_reservation.sql` (counter table shape, per-owner advisory lock, `service_role` guard, cap comparisons 6/5/11/20971520, GREATEST floors, REVOKE/GRANT surface) plus `src/lib/compress.ts` caps and `src/lib/storage.functions.ts` RPC wiring.
  - `test-harness/slmm-upload-cap-tests.mjs` — **12/12**. Client-side boundary tests for the DashboardPage / RegisterWizard photo/document/file/storage caps.
- **Correction (supersedes the issue #6 boundary wording):** the Postgres RPC caps (6/5/11/20 MiB) and the advisory lock are now **statically covered offline** — the migration *text* is asserted — but they remain **NOT runtime-verified**; a live SQL run is still required (see `TEST_VERIFICATION_LEDGER.md` §5).
- **Correction (supersedes the `.env.test` "DONE" claim):** Phase 5B added the fail-closed gate `test-harness/live-guard.mjs`, which runs **before** any credential load. However, **both live harnesses still read the repo-root `.env`** (`slmm-receipt-delivery-test.mjs` line 47 `readFileSync(ROOT + "/.env")`; `slmm-comm-test.mjs` line 76 `path.join(SCRIPT_DIR, "..", ".env")`), **not** `.env.test`. Reading `.env.test` is **not** implemented. Recorded as a residual security issue; no credentials were read.
- **Current `.output` is a PRODUCTION build** (stamp `2026-10-16T14:34:43.764Z`): Worker name `slmm-boyar-matrimony`; production Supabase ref `sxpkutjkqfekqwpabgrk` present in 4 files; TEST ref absent. `node scripts/check-build-target.mjs test` -> **exit 1** (correctly fail-closed); `node scripts/check-build-target.mjs prod` -> **exit 0**. This artifact **must not** be deployed to TEST.
- **`supabase/config.toml` (tracked, unmodified) has `project_id = "sxpkutjkqfekqwpabgrk"` (production)** — a Supabase CLI isolation gap (the CLI would target production). Flagged only; **not changed**.
- **Not run:** no live harness, no remote access, no build, no deploy, no commit/push.

---

## 12. Update — 2026-10-17 (later still) — local checkpoint `9d810a9`

> **Append-only superseding note.** §11 ended with "no commit/push"; a **local** commit has since been created. Nothing has been pushed.

- **HEAD is now `9d810a9`** (`test(offline): add quota SQL-contract and upload-cap suites; track build-target gate`), one commit on top of `ff1abb1`; `origin/main` is **9 behind** HEAD.
- **Tracked by `9d810a9`** (previously untracked or staged): `scripts/check-build-target.mjs`, `.config/nitro.config.mjs`, `test-harness/slmm-elite-code-tests.mjs`, `test-harness/slmm-quota-sql-contract-tests.mjs`, `test-harness/slmm-upload-cap-tests.mjs`, and the **six** `docs/project/*.md`; `test-harness/harness-registry.mjs` modified (`M`). The tracking gap noted in §11 is **resolved**.
- **Working tree now:** **0 staged**, **37 modified tracked**, **69 untracked** (was 72), **0 deletions**. Preserve the modified/untracked set; never reset/clean/force-push.
- **Offline regression (freshly re-confirmed after `9d810a9`):** `npm run test:offline` -> **exit 0**, `TOTAL tests=497 pass=497 fail=0 skip=0 suites=15 failing_suites=0`; `npx tsc --noEmit` -> **exit 0**.
- **Not run:** no live harness, no remote access, no build, no deploy; **no push**.

---

## 13. Update — 2026-10-17 (later still) — security hardening; fresh 578/578

> **Append-only superseding note.** §12 recorded HEAD `9d810a9` / 497 tests / 69 untracked. The current state follows.

- **HEAD is now `92804e0`** (`Security: protect non-document R2 references`); `origin/main` is **12 behind**. Three security commits since `9d810a9`: `0bb3836`, `4e9e1c0`, `92804e0`.
- **Offline regression (freshly observed 2026-10-17, on the current working tree):** `npm run test:offline` -> **exit 0**, `TOTAL tests=578 pass=578 fail=0 skip=0 suites=19 failing_suites=0`; `npx tsc --noEmit` -> **exit 0**. Evidence: `TEST_EVIDENCE.md` E-008. (The 19-suite count includes one uncommitted registry entry; pure HEAD would be 18 suites.)
- **Working tree now:** **0 staged**, **44 modified tracked** (the 4 corrected docs + in-progress feature/security/test work), **71 untracked**, **0 deletions**. Preserve all of it; never reset/clean/force-push.
- **Not run:** no live harness, no remote access, no build, no deploy; **no push**.

---

## 14. Update — 2026-10-22 — T6 reconciliation: Group-L PASS, Group-R delivered / not executed

> **Append-only superseding note.** §2 (HEAD `ff1abb1`, "8 behind", 37 modified /
> 72 untracked / 6 staged), §5 and §6 (457/457 across 13 suites) and §7 (the
> 2026-10-15/17 task and next action) are **retained as their dated 2026-10-17
> record** — they were correct when written and are not rewritten. The current
> state follows.

- **Git state:** HEAD `4cad12b16494e1a9ae2a50249eaefc64dd546b60`
  (`docs(t6): reconcile Group-R preflight evidence and Group-L verification`) =
  `origin/main`, **0 ahead / 0 behind** (GitHub `main` verified equal via
  `git ls-remote`). Working tree: **37 modified tracked**, **65 untracked**,
  **0 staged**, **0 deletions** — preserve all of it; never reset/clean/force-push.
- **Offline regression:** **no new run in this pass.** The last measured result
  remains **578/578 pass, 0 fail, 0 skip, 19 suites** (2026-10-17, HEAD
  `92804e0`; `TEST_EVIDENCE.md` E-008) and is **historical**. The registry
  `test-harness/harness-registry.mjs` now lists **21** `OFFLINE_SUITES`, so 19 is
  no longer the suite count and **no current complete test total is claimed**.
- **T6 program — ACTIVE / INCOMPLETE:**
  - **Group-L: VERIFIED PASS 12/12** — a **local disposable PostgreSQL 18
    laboratory only** (`127.0.0.1:15432`, database `t6lab`), executed once on
    2026-10-21 at approximately 10:06 IST: wrapper exit 0, verdict PASS, all nine
    native steps exit 0, zero residue, results digest
    `3489610fbf2105868c8aa2ab6bd60681ac0788446a816980c5cbfd424b187b0c`.
    Evidence: `TEST_EVIDENCE.md` E-010.
  - **Group-R: harness implemented, committed and pushed — NOT EXECUTED.**
    Eight commits `a11a118` → `1535f9a`, **4 files, +7,009/−0**:
    `t6-checkpoint/t6-group-r-runner.mjs` (121,465 B / **2,772** lines /
    `b4184ac78e32c19d5496f2afaa4625662b55c9c4d8a2ed167bb76755075665cd`),
    `t6-checkpoint/t6-group-r-runner-tests.mjs` (157,505 B / **3,194** lines /
    `df811af43924efb2d3facb9edba01a1fd6b0e7df00eaf543dcdc72e38fb23af8`),
    `t6-checkpoint/t6-group-r-harness.sql` (51,860 B / **1,035** lines /
    `6de5323d87b8c7a104365393bfc0fa5c9af98482a0701465a122ef704276507e`) and
    `test-harness/harness-registry.mjs` (**+8 lines**: one `LIVE_HARNESSES`
    entry and one `LIVE_SQL_HARNESSES` entry). **No npm script references
    either artifact.** The eight `env: "R"` matrix rows predate this delivery
    (matrix last changed at `ed5e212`, byte-identical at HEAD).
  - **`T6-R01`–`T6-R08`: NOT RUN.** Three `mode: "preflight-only"` rehearsals
    against Supabase **TEST** `nqadtfqyurkpmxcodswc` all aborted at the
    preflight — psql exit **2**, **2**, **3** (the latter two classified
    **`unknown`**; the first records no classifier) — each **8 BLOCKED / 0 cases
    executed**, `residueGate: "NOT RUN"`, and the v2
    fingerprint **never computed** (`expected a85fea6468487830a4ca9afc268d9aef`,
    `computed: null`). Evidence: `TEST_EVIDENCE.md` E-009. **Not PASS, not FAIL.**
  - **Reported `169/169` Group-R runner unit tests: UNVERIFIED** — 169 is a
    static top-level `test()` count; **no execution artifact** (TAP, log or
    report) exists in the repository or under `D:\SLMM-T6-EVIDENCE`.
  - **Group-C** (`T6-C01`–`T6-C03`) and **R2 / object-storage and scheduler
    integration**: separate pending gates, each needing its own approval and its
    own target.
- **Hosted Supabase TEST and production behaviour remain NOT VERIFIED.** A
  local-lab PASS is not remote proof, and a preflight-only rehearsal is not a
  test run.
- **Not run in this pass:** no test, no SQL, no PostgreSQL, no Supabase, no R2,
  no Cloudflare, no build, no deploy, no commit, no push.
