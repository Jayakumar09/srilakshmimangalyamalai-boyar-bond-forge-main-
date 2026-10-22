# PROGRESS — T6

> Append-only. Correct mistakes with a new dated line.

- **Latest approved Git checkpoint:** `84d9e145e852dc9046ffa02c75bbee067aab508d` (pushed)
- **Current blocker:** none for Group-L. **Group-L local concurrency: VERIFIED PASS** (2026-10-21 10:06 IST, 12/12). The overall T6 program is **INCOMPLETE** — Group-R, Group-C, R2 and scheduler integration are separate pending gates, and Supabase TEST/production behaviour is **NOT VERIFIED**.
- **Exact next action:** commit and push this documentation update, then decide the next gate (Group-R rollback-only TEST, or Group-C after operator approval) with a fresh, separate approval.

> **Superseding status — 2026-10-22 (latest):** the lines above and the two
> blocks below describe earlier states and are **retained as history**; they are
> not rewritten. The **latest published checkpoint is
> `4cad12b16494e1a9ae2a50249eaefc64dd546b60`** (`84d9e145…` remains the correct
> GitHub baseline for the Group-L execution). The "exact next action" above
> (commit and push the PASS documentation) is **DONE**. **T6 is ACTIVE /
> INCOMPLETE, not BLOCKED**: Group-L is **VERIFIED PASS 12/12** (local lab
> only); Group-R is **implemented but NOT EXECUTED** — three preflight-only
> rehearsals were **BLOCKED**, and `T6-R01`–`T6-R08` remain **NOT RUN**. See the
> appended 2026-10-22 section at the end of this file.

> **Superseding status — 2026-10-21 (10:06 IST execution):** the two earlier
> status blocks below describe the state as of 2026-10-19 and 2026-10-20 and
> are **retained as history**. The current state is:
>
> - **Latest approved Git checkpoint:** `84d9e145e852dc9046ffa02c75bbee067aab508d` (pushed to GitHub, verified with `git ls-remote`).
> - **Current state:** the C10 runner `9f06b1c3...b008` was **executed exactly once** and returned **wrapper exit 0 / verdict PASS / 12 PASS, 0 FAIL, 0 BLOCKED, 0 NOT RUN**, with zero residue and an ownership-safe cleanup. The GitHub baseline for that run was the same commit `84d9e145...`.
> - **Current blocker:** none for Group-L. The **overall T6 program remains INCOMPLETE** — 8 R-cases and 3 C-cases are unexecuted, Supabase TEST/production behaviour is **NOT VERIFIED**, and R2/scheduler integration are separate pending gates.
> - **Exact next action:** commit and push the documentation update for this PASS, then obtain a fresh, separate approval for the next gate.
>
> **Correction to the 2026-10-19 record below:** it states "Nothing was
> executed. No cluster was started." That is **inaccurate**. A local disposable
> cluster **was** started on 2026-10-19; the wrapper that was executed was
> **not** the approved hash; no Group-L case result was ever produced; and the
> cluster and all temporary artifacts were subsequently lost to a host reboot
> plus TEMP cleanup. The 2026-10-20 entry at the end of this file records the
> accurate history.

## Steps completed

| # | Date | Step | Result |
|---|---|---|---|
| 1 | 2026-10-19 | Receive one-shot approval; verify repository checkpoint `eef9b2e6…` | HEAD verified |
| 2 | 2026-10-19 | Prereq 1 — verify runner hashes | **FAIL** (`t6-runner.ps1` mismatch) |
| 3 | 2026-10-19 | Prereq 3 — verify port 15432 has no listener | **FAIL** (listener present, PID 2676) |
| 4 | 2026-10-19 | Prereq 4 — verify disposable lab dir absent | **FAIL** (pre-existing, owner PID mismatch) |
| 5 | 2026-10-19 | Prereq 5 — PostgreSQL redirect env vars | PASS (none) |
| 6 | 2026-10-19 | Prereq 6 — HEAD + preserve 42 modified / 69 untracked | PASS |
| 7 | 2026-10-19 | **STOP** per instruction — no cluster started | stopped |
| 8 | 2026-10-19 | Re-verify state while bootstrapping this task system | unchanged (still blocked) |
| 9 | 2026-10-19 | Earlier attempted wrapper startup — a **local disposable cluster WAS started** on `127.0.0.1:15432` | cluster started; see 2026-10-20 entry |
| 10 | 2026-10-19 | Earlier attempted wrapper startup — **executed wrapper hash was NOT the approved hash** (`abd83227…` vs approved `fac7926d…`) | mismatch confirmed |
| 11 | 2026-10-19 | Node Group-L stage | **NOT RUN** — no `t6-lab-run.log`, no `t6-lab-results.jsonl`; no verified case results |
| 12 | 2026-10-20 | Host reboot (07:24 IST) + TEMP cleanup | **Disposable cluster and ALL temporary artifacts lost** |
| 13 | 2026-10-20 | Read-only recovery audit | **Port 15432 now free**; PID 2676 gone; only the unrelated 5432 service remains |
| 14 | 2026-10-20 | **Recover 11 approved artifacts from OpenCode session history** | **SUCCESS — byte-exact**, all approved SHA-256 reproduced; now at `test-harness/t6-checkpoint/` |
| 15 | 2026-10-20 | Static-only verification of the recovered artifacts | PASS — no code executed, no database contacted |
| 16 | 2026-10-20 | Update `ARTIFACT_MANIFEST.md` + `PROGRESS.md` | DONE (documentation only) |

## Verification status

- Nothing was executed. No cluster was started. PID 2676 and
  `%TEMP%\opencode\t6lab` were left untouched.

## Blocker detail (as of 2026-10-19)

1. **Hash mismatch** — `t6-runner.ps1` actual `abd83227a98a40943666f2c6a3e07a5247d0f7ee8838435ce02b00f2b0c6701b`
   ≠ approved `fac7926d0de1739f89a9298baf1be0198268fb560ef80ddd151cb6b73720894c`.
   Its mtime (`23:07:43`) is later than `t6-local-runner.mjs` (`22:55:00`) —
   likely an uncommitted post-fix edit.
2. **Port 15432 busy** — `127.0.0.1:15432` LISTEN, PID 2676
   (`C:\Program Files\PostgreSQL\18\bin\postgres.exe -D …\t6lab\data -p 15432`).
3. **Lab dir pre-exists** — `%TEMP%\opencode\t6lab` present; `T6LAB_OWNER` marker
   `run=3717dbce…`, `pid=5480`, `created=2026-10-19T22:58:35+05:30`; marker PID
   (`5480`) ≠ live PID (`2676`) → ownership uncertain.

## Next action (single, concrete)

Ask the user to (a) confirm/replace the `t6-runner.ps1` hash, and (b) decide
whether to stop PID 2676 and delete `%TEMP%\opencode\t6lab`; then re-approve.


---

## 2026-10-20 — Artifact-loss recovery: 11 approved artifacts recovered, T6 still BLOCKED

### 1. Accurate history of the earlier attempted wrapper startups

1. A **local disposable PostgreSQL 18 cluster was started** on
   `127.0.0.1:15432` (loopback only; data dir
   `%TEMP%\opencode\t6lab\data`). The preserved `pg.log` transcript shows
   **two** clean startups — 22:58:42 and 23:08:13 IST on 2026-10-19 — each
   followed about 5–6 minutes later by a Windows `0xC0000142`
   (`STATUS_DLL_INIT_FAILED`) termination of the autovacuum/startup process,
   ending with `aborting startup due to startup process failure`.
2. **The wrapper that was executed was NOT the approved artifact.** The
   executed `t6-runner.ps1` hashed to
   `abd83227a98a40943666f2c6a3e07a5247d0f7ee8838435ce02b00f2b0c6701b`
   (17446 bytes); the approved revision is
   `fac7926d0de1739f89a9298baf1be0198268fb560ef80ddd151cb6b73720894c`
   (16608 bytes). This is precisely the mismatch recorded as blocker 1 below.
3. **No verified Group-L concurrency case results exist.** The Node stage never
   produced `t6-lab-run.log` or `t6-lab-results.jsonl`, so no case ran and no
   result was recorded. The 12 Group-L cases are **NOT RUN**. Nothing about
   concurrency correctness is proven.
4. **The disposable cluster and all temporary artifacts were subsequently
   lost.** The host rebooted on 2026-10-20 (07:24 IST) and TEMP cleanup
   removed `%TEMP%\opencode\t6lab` (data dir, `pg.log`, `T6LAB_OWNER`) and
   `%TEMP%\opencode\t6-prep` (all 11 preparation artifacts). Nothing was
   deleted by this task.
5. **Port 15432 is now free**, per the 2026-10-20 read-only recovery audit
   (`Get-NetTCPConnection` and `netstat` both report no listener; PID 2676 no
   longer exists). The only PostgreSQL running is the unrelated Windows service
   `postgresql-x64-18` on port 5432, data dir
   `C:\Program Files\PostgreSQL\18\data` — **not** the T6 laboratory, and
   never contacted or stopped.
6. **T6 remains BLOCKED** pending recovered-artifact safety verification and a
   fresh, separate execution approval.

### 2. Recovery performed (2026-10-20, local file recovery only)

- All **11 approved artifacts** were recovered **byte-exactly** from OpenCode
  session history and now live permanently at `test-harness/t6-checkpoint/`.
  Every recovered file reproduces its previously approved SHA-256 **exactly**;
  checksums are recorded in `test-harness/t6-checkpoint/t6-checksums.txt`.
- The recovered `t6-runner.ps1` is the **approved** revision
  `fac7926d…` (16608 bytes). The later **unapproved** `abd83227…` variant was
  **not** substituted; its delta is documented in `ARTIFACT_MANIFEST.md` §1.
- Recovered copy of the approved wrapper is also retained at
  `%TEMP%\recon_approved_t6-runner.ps1`; the unapproved variant at
  `%TEMP%\recon_t6-runner.ps1`. No original recovery artifact was deleted.
- **Static-only verification** was performed (JavaScript syntax, PowerShell
  AST, SHA-256 comparison, path and connection-target safety, secret scan).
  **No recovered code was executed, no PostgreSQL was started, and no database
  was contacted.**
- Repository state preserved: HEAD `64dafc9…` = `origin/main`, **0 staged**,
  **0 deletions**; the 40 pre-existing modified tracked and 69 pre-existing
  untracked entries were preserved unchanged, plus **2** modified tracked
  documents (this file and `ARTIFACT_MANIFEST.md`) and **15** new untracked
  checkpoint files.

### 3. Material finding — the recovered approved wrapper is not executable as-is

The recovered approved `t6-runner.ps1` (`fac7926d…`, 16608 bytes) reproduces
its approved checksum exactly, but the session history shows it **provably
fails at cluster startup**: its `pg_ctl start` option string still quotes the
listen address (`-c listen_addresses='127.0.0.1'`), which Windows passes
through literally. The recorded execution of that exact revision on
2026-10-19 22:56:54 IST ended with `pg_ctl: could not start server` /
`T6 BLOCKED: pg_ctl start failed (1)` and `runner_wrapper_exit=2` — **no
cluster started, no database contacted, no case run**. The wrapper removed its
own disposable lab directory afterwards.

Two later revisions fixed this and are also byte-exactly reconstructible:
`c87df1c7…` (16606 bytes, quoting fixed) and `abd83227…` (17446 bytes,
quoting fixed + `Invoke-Native` hardening). Both of those **did** start the
cluster on 2026-10-19 (22:58:42 and 23:08:13 IST) before the detached
postmaster later died with the Windows `0xC0000142` fault.

**Consequence for the next decision:** the approved revision is recovered and
verified but **not executable unchanged**. Any executable candidate must be
one of the two later revisions, and each requires its own explicit approval
(including a fresh checksum approval for `abd83227…`, which was never
approved). **No revision was promoted, edited or executed by this recovery.**

### 4. Corrected candidate wrapper prepared (2026-10-20) — NOT APPROVED, NOT EXECUTED

- **New file:** `test-harness/t6-checkpoint/t6-runner-candidate.ps1`
  (SHA-256 `7161bd7d5dc998d566a946621405476cf8b0657a63eca1a468bd88e160eec9cc`,
  48231 bytes). The recovered approved `t6-runner.ps1` (`fac7926d…`) is
  **unmodified** and remains the approved artifact.
- Derived from the approved base (332 → 894 lines) with **eight** corrections,
  each independently justified: (C1) the `listen_addresses` quoting defect
  that provably broke `pg_ctl start`; (C2) Windows PowerShell 5.1
  native-stderr handling, which could abort a healthy run at the psql NOTICE
  that `t6-preflight-lab.sql` and `t6-lab-residue.sql` emit on **success**;
  (C3) explicit exit-code capture for every native tool, including the
  previously unchecked stale-cluster stop; (C4) a verdict that cannot be PASS
  unless all eight steps exit 0 **and** exactly the 12 Group-L cases are
  recorded as PASS **and** the evidence copy matches the runner's own digest;
  (C5) enforced refusal of port 5432 and of the PostgreSQL installation tree;
  (C6) structural ownership-marker parsing and `postmaster.pid` verification;
  (C7) durable, uniquely named evidence written **outside** the disposable
  cluster, so teardown can no longer erase the results; (C8) 49 static
  negative tests.
- **Static validation only:** PowerShell AST parse 0 errors / 5979 tokens; the
  candidate's own `-SelfTest` mode reports **49/49 PASS, exit 0**. No
  PostgreSQL was started, no database was contacted, the runner was not
  executed, and the port-5432 service was untouched (its PID set is
  unchanged).
- **Two defects were found by the candidate's own new tests and fixed before
  delivery:** a trailing space/dot in a laboratory path was normalised away
  before the check could see it, and the `postmaster.pid` ownership
  comparison canonicalised only one side (so an 8.3 short-name path would
  have wrongly refused a genuinely-owned cluster).
- The later unapproved revision `abd83227…` was **not** adopted; its
  `Invoke-Native` idea was independently re-derived with a stronger contract.
- **T6 remains BLOCKED.** The candidate needs (a) review, (b) a fresh
  explicit checksum approval, and (c) a separate one-shot execution approval
  before anything is run.

### 5. First one-shot execution attempt (2026-10-20) — BLOCKED, 0 of 12 cases ran

Two launcher attempts occurred.

1. **First attempt (11:15–11:33 IST) — INTERRUPTED.** The agent-side waiting
   parent was killed by a harness tool-call abort while the wrapper was inside
   the `pg_ctl start` step. The wrapper died, the disposable postmaster was
   orphaned, and it subsequently failed with the Windows `0xC0000142`
   (`STATUS_DLL_INIT_FAILED`) fault in the autovacuum worker and the startup
   process at 11:33:21. Evidence: `D:\SLMM-T6-EVIDENCE\launcher-20261020-111559-41599433\`
   (`stdout.log`, `pg.log.INTERRUPTED-ATTEMPT`, `T6LAB_OWNER.INTERRUPTED-ATTEMPT`).
2. **Second attempt (11:38–12:13 IST) — COMPLETED WITH EXIT CODE 2.** The
   launcher was detached so an agent-side interrupt could not kill the run.
   **PostgreSQL started correctly** on `127.0.0.1:15432` (`pg.log`:
   `listening on IPv4 address "127.0.0.1", port 15432`, `database system is
   ready to accept connections`) and **survived its first 5-minute
   time-based checkpoint at 11:58:03 with no fault** — no `0xC0000142` occurred
   in this attempt. The wrapper then **blocked inside `Invoke-Native`** at the
   `pg_ctl start` step for 20 minutes with **0% CPU and no child processes**,
   and was released only when the disposable cluster was stopped. It then
   failed closed with **exit code 2**:
   `T6 BLOCKED: cluster did not become ready on port 15432 (pg_isready exit 2)`,
   followed by its own teardown (`pg_ctl stop -m fast`,
   `removing disposable lab ...`). Evidence:
   `D:\SLMM-T6-EVIDENCE\launcher-20261020-113741-b4d0aac5\` (`stdout.log`,
   `exitcode.txt` = `exitcode=2`, `lab-pg.log.PRE-INTERVENTION`,
   `candidate-run-log.WEDGED.log`, `process-snapshot.WEDGED.txt`).

**Root cause of the block (C2b).** `Invoke-Native` captured native output with
a PowerShell **pipeline** (`& $Exe @ArgList 2>&1`), which completes only at
EOF. On Windows `pg_ctl start` does not exec the postmaster; it spawns
`pg_ctl.exe -> cmd.exe /C "postgres.exe ..." -> postgres.exe`, and that
long-lived `cmd.exe`/`postgres.exe` pair **inherits pg_ctl's stdout and stderr
handles**, so the write end stays open for the life of the cluster and EOF
never arrives. The saved `process-snapshot.WEDGED.txt` shows exactly that
shape: `cmd.exe` (6200) as the parent of `postgres.exe` (9544), with `pg_ctl`
already exited.

**Outcome.** The disposable cluster was cleaned up (the candidate removed
`%TEMP%\opencode\t6lab` itself). **All 12 Group-L cases remain NOT RUN** —
no `t6-lab-results.jsonl`, no node log, no verdict file was ever produced, and
no case is labelled PASS. The port-5432 service was never touched (PID 4828,
same start time, same listeners). **Candidate v1 was executed and returned
BLOCKED.**

### 6. Preserved constraints (unchanged by the recovery)

- **Approval boundaries.** Execution requires a fresh, explicit one-shot
  approval (`-Confirm I_APPROVE_LOCAL_T6`). Approval to *recover files* is
  **not** approval to *run* them. Staging, commit, push and GitHub push each
  require their own separate approval.
- **Case matrix.** The recovered `t6-case-matrix.json` is authoritative — 23
  cases: **12 Group-L** (`T6-L01`…`T6-L11` incl. `L08a`/`L08b`), 8 R-cases,
  3 C-cases, with the same namespaces, pins and collision rule. Its rules
  stand unchanged: *"A case that was not executed is 'NOT RUN' — never PASS."*
  and *"BLOCKED is a terminal recorded outcome with a reason, not a failure and
  not a pass."*
- **Test limitations.** Group-L is a **local disposable PostgreSQL 18 lab**
  only. A local-lab pass, if ever obtained, would still not prove any Supabase
  TEST or production behaviour. R-cases require rollback-only TEST execution;
  C-cases are **BLOCKED** pending separate operator approval. The
  `0xC0000142` Windows fault observed twice on 2026-10-19 is an
  environment-level risk that any future report must record.
- **Isolation.** Never connect to the PostgreSQL service on port 5432; never
  contact Supabase TEST (`nqadtfqyurkpmxcodswc`) or production
  (`sxpkutjkqfekqwpabgrk`), R2, Cloudflare or Workers; no production access.

### 7. Corrected candidate v2 prepared (2026-10-20) — NOT EXECUTION-APPROVED

- **New file:** `test-harness/t6-checkpoint/t6-runner-candidate-v2.ps1`
  (SHA-256 `b5a90be2198b186a009971342155e6e4f5ba54cf5f66455d2e8d4bef9d655bce`,
  54620 bytes, 1040 lines). **Candidate v1 (`7161bd7d…eec9cc`, 48231 bytes) is
  UNMODIFIED**, and so is the original recovered wrapper `t6-runner.ps1`
  (`fac7926d…0894c`).
- **The single correction is C2b.** `Invoke-Native` now runs the child through
  `System.Diagnostics.Process` with `RedirectStandardOutput`/
  `RedirectStandardError` and drains both streams with `CopyToAsync()` into
  **unbounded `MemoryStream`s**. The
  wait is on the **direct child only**, bounded by an explicit timeout, so a
  daemonised descendant that inherits the std handles can no longer stall the
  wrapper.
  - Exit-code handling is **preserved and strengthened**: the real exit code
    is read from the `Process` object (PowerShell's `$LASTEXITCODE` is
    unreliable with redirected output), and a **timeout is reported as a
    distinct, non-zero outcome and is never treated as success**.
  - stdout and stderr are still captured **separately** and preserved as
    evidence, exactly as v1 did.
  - Argument fidelity is preserved: the command line is built with the
    standard `CommandLineToArgvW` quoting rules, so an argument containing
    spaces, quotes or a trailing backslash arrives as exactly ONE argument.
- **All other v1 corrections are carried over unchanged**: C1 (unquoted
  `listen_addresses`, one splatted argument, cmd-metacharacter guard), C3
  (explicit exit-code capture for every native tool; the stale-cluster stop is
  checked and blocks deletion on failure), C4 (`Get-T6Verdict` — PASS requires
  all eight native steps to exit 0, exactly the 12 Group-L ids recorded PASS,
  the runner summary 12/12 with 0 fail / 0 blocked / 0 not_run, and the
  evidence copy byte-identical and matching the runner's own digest), C5
  (`Assert-LabPort` / `Assert-NotServiceTarget` keep the port-5432 service
  unreachable), C6 (structural ownership-marker parsing, `postmaster.pid`
  verification, failed stop blocks deletion), C7 (durable, uniquely named
  evidence outside the disposable cluster).
- **No PostgreSQL setting was changed** — `autovacuum`, `checkpoint_timeout`,
  `fsync` and every other server parameter are untouched; the lab still uses
  initdb/pg_ctl defaults.
- **Offline regression test for the deadlock itself:**
  `test-harness/t6-checkpoint/t6-deadlock-repro.ps1` (SHA-256
  `865f3abc0e9e75cd1212dab9e5f3292a1b8760a9d9cc5f631473f73f70c1d88c`).
  It reproduces the exact failure shape with `cmd.exe` + `ping` only — it never
  starts PostgreSQL, never touches port 15432 and never touches the 5432
  service — and asserts that (a) the v1 pipeline pattern blocks while a
  descendant holds the pipe, (b) the v2 file-redirect pattern returns
  promptly, and (c) a short deadline is reported as a TIMEOUT rather than as
  success.
- **Static validation only:** PowerShell AST parse **0 errors / 7057 tokens**;
  the candidate's own `-SelfTest` mode reports **62/62 PASS, exit 0** (the 49
  v1 safety tests preserved and extended with 13 process-handling tests). No
  PostgreSQL was started, no database was contacted, the runner was not
  executed, and the port-5432 service was untouched.
- **Two defects were found by the candidate's own new tests and fixed before
  delivery:** the resolved-constants block had been placed after the
  self-test, so `$script:LabRoot` was unset during `-SelfTest`; and the
  argument-fidelity test had used `powershell.exe -File`, which re-parses its
  own command line and mangles a trailing backslash — that tested the target's
  quoting rather than ours, so the test now uses `node`, which parses argv
  with the standard rules.
- **T6 remains BLOCKED.** Candidate v2 needs (a) review, (b) a fresh explicit
  checksum approval, and (c) a separate one-shot execution approval. **All 12
  Group-L cases remain NOT RUN.**

### 8. Corrected candidate v3 prepared (2026-10-20) \1 SUPERSEDED BY 8c (approved, pushed, executed once -- verdict FAIL)

- **New file:** `test-harness/t6-checkpoint/t6-runner-candidate-v3.ps1`.
  **Current (final) revision: SHA-256 `30e31c1d2c1f14f04bdff78cfd42fa466cb613efa923f099157a347a649ba97c`, 139325 bytes, 2520 lines.**
  The earlier v3 revisions (SHA-256 `5faae6ebc0a1e422b465b369ab37da8b3049f88190c81eb2f2a00794da21457a`, 95610 bytes / 1809 lines, and SHA-256
  `deb84e0f09b56133e8b282adaae6f40e6f82e58b7f2becc6601b5a9a04228e8b`, 108466 bytes / 2016 lines, and SHA-256
  `f4e10f765448811979bf9bbbc3d563b3b48d2d79dad08037e2e49308fde334e1`, 119524 bytes / 2189 lines, and SHA-256
  `c3b8151575d377f68cf64b7719b2c0807c7aeeedcd84c7f8fc8f36853b37d017`, 135905 bytes / 2469 lines) are superseded and are recorded in
  `ARTIFACT_MANIFEST.md` for provenance. Candidate **v1**
  (`7161bd7d…eec9cc`, 48231 bytes), candidate **v2**
  (`b5a90be2…55bce`, 54620 bytes) and the original recovered wrapper
  `t6-runner.ps1` (`fac7926d…0894c`) are all **UNMODIFIED** and were
  re-verified by checksum after the v3 work.
- **Two defects were found in candidate v2 by the final offline safety
  review and are corrected here.** Neither had been executed; both were
  latent in v2.

#### Defect 1 — unbounded output capture (memory)

- **What was wrong.** v2 copied the child's stdout and stderr into an
  **unbounded `MemoryStream`**. Because a daemonised descendant inherits the
  write end of the pipe, that copy task stays pending for the whole life of
  the descendant and the buffer grows at the descendant's output rate —
  **measured ~1.3 MB/s** (3.8 MB → 22.8 MB over 18 s in a direct
  reproduction). The wrapper itself therefore had an unbounded-allocation
  path, independent of any child.
- **Correction (C2c).** The copy target is now a **bounded sink**
  (`T6BoundedCapture`, a `System.IO.Stream` subclass compiled once at
  startup). It **retains at most `$NativeMaxCaptureBytes` (4 MB) per stream**,
  **discards** the remainder while still **absorbing** it, and counts the
  discarded bytes. stdout and stderr are bounded **independently**. Because
  the sink always absorbs the data, the child is **still drained completely
  and is never blocked** on a full pipe. Truncation is **reported
  explicitly** (`StdoutTruncated` / `StderrTruncated`, the discarded byte
  counts, and an `OUTPUT TRUNCATED (stdout|stderr)` line in the captured
  output and in the evidence log). **The real native exit code is
  unchanged.**
- **Fail-closed:** if the bounded sink cannot be compiled the wrapper
  **refuses to run** rather than silently falling back to unbounded capture.

#### Defect 2 — a timed-out start left the laboratory unmanaged

- **What was wrong.** v2 set `$started = $true` only **after** a successful
  `pg_ctl start`. A start that **timed out or failed** therefore skipped the
  teardown entirely, even though a postmaster may have come up. On timeout
  v2 also killed only the **direct** child (`Process.Kill()` does not reach
  descendants), so a postmaster could survive unmanaged on 15432 — and the
  teardown could then **delete the lab data directory while that PostgreSQL
  process could still have been using it**.
- **Correction (C2e).** The start is now marked **attempted before it is
  issued**, and the teardown **always inspects the disposable laboratory**
  whenever a start was attempted — not only when a start succeeded. A
  process is stopped **only on positively proven ownership**, using the
  existing ownership marker, a canonical data-directory comparison and the
  available identity evidence (`postmaster.pid` in *our* data directory,
  recorded port `15432`, the PID still alive, a `postgres.exe` whose command
  line names *our* data directory). A process is **never stopped merely
  because it listens on port 15432**, and the port-5432 service is never a
  candidate. If ownership cannot be established, the evidence is preserved,
  the run is reported **BLOCKED**, and the uncertain process is **left
  untouched**. The lab data directory is **never deleted while a potentially
  active PostgreSQL process remains**; the decision is a pure function
  (`Test-LabDeletionSafe`) taken on the **post-stop** state.

#### Additional correction found while validating v3 (C2d — reader lifetime)

- **What was wrong.** v2 disposed the capture buffer while the copy task
  could still be writing into it, so the write end faulted on the disposed
  buffer and the exception was **unobserved**; bytes read after the snapshot
  were lost.
- **Investigation (measured, offline).** Ending the reader task is not as
  simple as closing the stream. A read that is **already pending** on an
  **inherited pipe handle** is **not** interrupted by closing the stream, by
  disposing it, by cancelling the .NET read, or by disposing the owning
  `Process` — the read stays blocked and its copy task never reaches a
  terminal state (measured: still `WaitingForActivation` after 3 s).
  `CancelIoEx` on the pipe handle **does** interrupt it (measured: terminal
  in **23–53 ms**, status `Canceled`).
- **Correction.** v3 cancels the pending overlapped operation with
  `CancelIoEx`, then closes the stream, then waits (bounded) for the reader
  task to reach a terminal state, and **only then disposes the sink**. If the
  task still has not finished the sink is **deliberately not disposed** and
  the condition is reported (`CaptureIncomplete`).

#### Additional correction (C2f) -- a truncated or incomplete capture can never yield PASS

Found by the **final offline safety review** of the first v3 revision and
corrected in the final revision.

- **What was wrong.** The Group-L runner emits its `summary` line and its
  `results_sha256` digest near the **end** of its stdout. A capture that was
  truncated (the 4 MB cap was reached) or incomplete (a reader task had not
  finished) could therefore remove **both** of them while the native exit
  code was still 0. `Get-T6Verdict` also **skipped** the digest comparison
  entirely when no digest was supplied, so a truncated capture could not be
  distinguished from a complete one.
- **Correction.** Two changes, nothing else:
  1. The Node step now calls `Assert-NodeCaptureTrustworthy`, which **throws**
     `T6 BLOCKED` when `StdoutTruncated`, `StderrTruncated` or
     `CaptureIncomplete` is set. A truncated or incomplete runner capture is a
     **hard failure** and no verdict is issued.
  2. `Get-T6Verdict` now **requires** `ExpectedResultsSha` to be present and
     to be a well-formed 64-hex-digit value, and requires the evidence copy
     to match it. A missing or malformed digest is now a **failure reason**,
     never a skipped check.
  The evidence byte-identity comparison and both checksum comparisons are
  **preserved unchanged** and are still evaluated in addition to the digest
  check. **No other process, database or cleanup behaviour was changed.**
- **New offline negative tests** (all with harmless simulated objects -- no
  process, no database): a missing digest, an empty digest, a malformed digest,
  a mismatched digest, a truncated capture that lost both the summary and the
  digest, the capture-trust predicate for each of the three conditions, the
  Node-step hard-failure gate for each of the three conditions, and the
  positive control that a present, valid, matching digest still passes.
- **Mutation testing:** 8 mutants (digest presence, digest validity,
  digest-vs-evidence, evidence byte-identity, capture-trust predicate,
  Node-step gate removal, Node-step gate always-throws, gate ordering) were
  each **killed** by the new tests, proving they are load-bearing rather than
  vacuous.
- **Corrected counts** in this record: candidate v2 is **1040** lines (not
  1034); v1->v2 is **132 removed / 278 added**; the historical v3 revision was
  **59 removed / 828 added**; the final v3 revision is **65 removed / 1041
  added**. v2 drained the streams with **`CopyToAsync()` into unbounded
  `MemoryStream`s** -- not `ReadToEndAsync()`, which appeared only in v2's
  own comments. The 45 runtime invocations added by the first v3 revision
  correspond to **44 new assertion names** (one name was reused).

- **All v2 and v1 corrections are carried over unchanged**, including the
  C2b direct-child-only bounded wait and the explicit `CommandLineToArgvW`
  argument quoting, C1 (unquoted `listen_addresses`, one splatted argument,
  cmd-metacharacter guard), C3, C4 (`Get-T6Verdict` — PASS requires all
  eight native steps to exit 0, exactly the 12 Group-L ids recorded PASS, the
  runner summary 12/12 with 0 fail / 0 blocked / 0 not_run, and the evidence
  copy byte-identical and matching the runner's own digest), C5
  (`Assert-LabPort` / `Assert-NotServiceTarget` keep the port-5432 service
  unreachable), C6 and C7 (durable, uniquely named evidence outside the
  disposable cluster).
- **No PostgreSQL setting was changed** — `autovacuum`, `checkpoint_timeout`,
  `fsync` and every other server parameter are untouched; the lab still uses
  initdb/pg_ctl defaults, and the option string is still exactly
  `"-p $Port -c listen_addresses=127.0.0.1 -c logging_collector=off"`.
- **Static validation only:** PowerShell AST parse **0 errors / 15442
  tokens**; the candidate's own `-SelfTest` mode reports **196/196 PASS, exit
  0** (the 62 v2 checks preserved + 68 new C2c/C2d/C2e/C2f checks + 34 new C2g
  parameter-binding checks + 32 new C2h main-path-initialisation and parameter-binding checks).
  **No PostgreSQL was started, no database was contacted, the runner was not
  executed, port 15432 was never bound and the port-5432 service was
  untouched.**
- **New offline regression coverage (all with harmless simulated processes —
  `cmd.exe` and `ping` only):** high-volume stdout **and** stderr; bounded
  memory under sustained output; explicit output-truncation reporting;
  descendants holding the pipe handles open; reader cancellation and safe
  disposal; timeout with surviving descendants; and refusal to clean up
  unowned, foreign or ambiguous processes (including a `postmaster.pid` that
  names a foreign data directory, one that records port 5432, and one with
  no valid ownership marker).
- **T6 remained BLOCKED as of this section (2026-10-20, preparation time).**
  Candidate v3 needed (a) review, (b) a fresh explicit checksum approval, and (c) a
  separate one-shot execution approval. At this point all 12 Group-L cases were still
  NOT RUN. **Section 8c supersedes this status.**

### 8a. Parameter-binding repair and the C2g regression block (2026-10-20)

- **The one-shot execution attempt (2026-10-20, 19:16 IST) FAILED with
  launcher exit code 1.** The approved invocation was
  `powershell -File <candidate> -Confirm I_APPROVE_LOCAL_T6 -EvidenceRoot D:\SLMM-T6-EVIDENCE`.
  The candidate **never ran**: `t6-runner-candidate-v3.ps1` did not declare an
  `-EvidenceRoot` parameter, so PowerShell failed at **parameter binding, before
  the script body**. Elapsed 1.4 s, empty stdout/stderr, **no evidence
  directory created, no PostgreSQL started, port 15432 never bound, and all 12
  Group-L cases NOT RUN**. Evidence retained under
  `D:\SLMM-T6-EVIDENCE\launcher-20261020-191622-a1e6bf5c\` (including
  `DIAGNOSIS.txt`).
- **Root cause.** The `param()` block lacked `[string]$EvidenceRoot` while
  `New-EvidenceDir` reads `$EvidenceRoot` under `Set-StrictMode -Version
  Latest`. The declaration was present in candidate **v1** (committed in
  `ed5e2121`), **lost in v2**, and inherited by v3.
- **Correction.** `[string]$EvidenceRoot` was added to the `param()` block --
  restoring exactly the v1 shape. This is the ONLY functional change; every
  other edit is inside the C2g self-test block.
- **C2g REGRESSION BLOCK (34 new offline assertions).** The new block proves:
  the script's own `param()` block declares exactly `Keep`, `Confirm`,
  `SelfTest` and `EvidenceRoot`; the effective parameter surface exposes all
  four; the designed default for an omitted `-EvidenceRoot` is intact; the
  candidate **accepts `-EvidenceRoot`** with no parameter-binding error; the
  omitted case yields **only the designed default, never an undefined-variable
  failure**; and a harmless binding probe **cannot enter the PostgreSQL
  execution path** (the real candidate's `-SelfTest` path exits before the
  main path, and a scratch copy with the main path AST-removed is used for
  the remaining probes).
- **Seven defects in the new test code were found and corrected** (the
  candidate's behaviour was never at fault):
  1. the parameter assertion was over-strict -- it collected every FUNCTION
     parameter (59 names) instead of the script's own `param()` block;
  2. the scratch-copy cut used a text search that also matched the same
     marker inside the C2g block itself, cutting the file mid-`try/finally`
     and leaving an unbalanced brace;
  3. the extracted prefix is now **AST-verified to be syntactically balanced**
     before the probe is built;
  4. two path expectations compared against the **8.3 short form** of
     `%TEMP%` while the candidate canonicalises with `GetFullPath`; both
     sides are now canonicalised before comparison;
  5. the remaining failures were consequences of the above and cleared with
     them.
- **No assertion was removed or skipped.** All 34 C2g assertions pass.
- **The self-test total is now 196/196 PASS, exit 0** (62 v2 checks
  preserved + 68 C2c/C2d/C2e/C2f + 34 C2g + 32 C2h). AST: **0 errors / 15442 tokens**.

### 8b. Main-path initialisation repair and the C2h regression block (2026-10-20)

- **The one-shot execution attempt of 2026-10-20 20:15 IST ended with wrapper
  exit code 2 (BLOCKED).** The `-EvidenceRoot` repair worked: the invocation
  bound, the candidate body ran, and it created its evidence directory under
  `D:\SLMM-T6-EVIDENCE\t6-run-20261020-201516-88ef8d45\`. The run then
  aborted at the **first** step with
  `FAILED: The variable '$script:ExitCodes' cannot be retrieved because it has
  not been set.`
- **Root cause.** `$script:ExitCodes` was **never initialised**. Under
  `Set-StrictMode -Version Latest` the main path's first assignment
  (`$script:ExitCodes["initdb"] = ...`) raised a terminating error, so the run
  stopped **before `pg_ctl start`**. **No PostgreSQL cluster was ever started**,
  port 15432 was never bound, and **all 12 Group-L cases remained NOT RUN**.
  The candidate's ownership-verified teardown removed only its own disposable
  lab tree. Evidence preserved under
  `D:\SLMM-T6-EVIDENCE\launcher-20261020-201457-c2476264\` and
  `D:\SLMM-T6-EVIDENCE\t6-run-20261020-201516-88ef8d45\`.
- **Correction.** `$script:ExitCodes = @{}` was added to the script-scope
  initialisation block, alongside `$script:stFail`, `$script:RunId`,
  `$script:EvidenceDir`, `$script:LogPath`, `$script:LogLines` and
  `$script:CaptureReady`. This is the **only functional change** to the
  candidate; every other edit is inside the C2h self-test block.
- **C2h REGRESSION BLOCK (new offline assertions).**
  1. **An AST-based check** that every script-scope variable **read** in the
     main execution path is **initialised before that read**. The proof
     required is not a textual assignment somewhere in the file: an
     initialisation counts only if it is an **unconditional, top-level
     assignment whose position precedes the first read**. A variable assigned
     **inside a function** (deliberately assigned during execution) is
     accepted only because the mocked dry run below proves it is set before
     it is read; a **conditional** initialisation is reported as unreliable.
  2. **A mocked main-path dry run.** The candidate is copied to a scratch file
     whose `Invoke-Native`, `Assert-PortFree`, `Get-LabClusterState`,
     `Stop-LabClusterIfOwned` and `Remove-LabTree` are replaced by mocks, and
     the child runs with `TEMP` redirected into a sandbox. The run therefore
     exercises **parameter binding and the whole main path** -- including
     `initdb`, `pg_ctl start`, `pg_isready`, the identity check, bootstrap,
     preflight, the Node step, the residue re-check, the evidence copy, the
     verdict and the teardown -- while **initdb, pg_ctl, psql, Node and every
     database operation are never invoked** and no real process is started.
     The dry run asserts that the main path reached the Node runner, that the
     verdict was **PASS**, that only port **15432** was ever asked about
     (**5432 was never requested**), that the teardown touched only the
     sandbox laboratory, and that no `postgres.exe` process appeared.
  3. **An explicit binding proof for every externally supported parameter.**
     `-Confirm` is proven by a mocked run that is **refused** when the token is
     omitted; `-Keep` is proven by a mocked run that **keeps** the laboratory
     instead of tearing it down; `-EvidenceRoot` is proven by the dry run
     honouring it; `-SelfTest` is proven by the fact that the self-test is
     itself entered through it, and by the C2g parameter-surface assertions.
     **All four parameters bind correctly.**
- **Exhaustive audit for other main-path-only defects.** Every script-scope
  variable read in the main path was classified: `EvidenceDir`, `LabRoot`,
  `LogPath` and `RunId` are initialised at script scope before their first
  read, and `ExitCodes` now is too. A per-scope scan of **every function** in
  the file found **no local variable read before assignment**. **No unresolved
  main-path-only defect was found.**
- **All previously passing C2b-C2g assertions are preserved**, together with
  the bounded capture, timeout, ownership, port, digest and evidence
  protections.

### 8c. First successful main-path execution and the Group-L runner session-lifecycle defect (2026-10-20 22:28 IST)

- **The one-shot execution of 2026-10-20 22:28 IST returned wrapper exit code `1`.**
  This is the **first** run that reached the Group-L runner. The whole main path
  executed in 42 seconds: `initdb`, `pg_ctl start`, `pg_isready`, the identity
  check, `CREATE DATABASE t6lab`, the bootstrap, the preflight, the Node step,
  the residue re-check, the evidence copy, the verdict and the teardown.
- **Every bootstrap and preflight step PASSED.** The candidate's own exit-code
  table records `initdb=0`, `pgctl_start=0`, `isready=0`, `identity=0`,
  `create_db=0`, `bootstrap=0`, `preflight=0` and `residue=0`. **Only `node`
  exited non-zero (`node=1`).** The verdict is `FAIL` and the wrapper correctly
  refused to report PASS.
- **Case outcomes: T6-L01 = FAIL; T6-L02, T6-L03, T6-L04, T6-L05, T6-L06,
  T6-L07, T6-L08a, T6-L08b, T6-L09, T6-L10 and T6-L11 = NOT RUN** (the runner
  aborts the suite after the first non-PASS case). **No Group-L case has ever
  reported PASS.**
- **T6-L01 failed because of the runner's per-case survivor check, not because
  of a demonstrated product RPC failure.** The recorded detail is byte-for-byte
  the runner's own *success* return string for T6-L01
  (`commit release -> loser 0 rows, attempt=1 committed once; rollback release
  -> observed waiter won with attempt=1, both rolled back, row unchanged`),
  followed only by the suffix ` | force-terminated 2 surviving T6 backend(s)`.
  Every assertion inside T6-L01 therefore passed. **No product RPC failure has
  been demonstrated.**
- **The defect.** The per-case cleanup counted *any* backend whose
  `application_name` was `slmm-t6-a` or `slmm-t6-b` as a leak. Sessions A and B
  are created once and **intentionally reused across every case**: they are
  rolled back at the end of a case but stay connected for the next one. The
  check therefore counted the runner's own two healthy sessions, force-
  terminated them and marked the case FAIL, which aborted the remaining eleven.
  The runner's own `preflight()` already models this correctly (it allows the
  three expected concurrent backends).
- **Evidence digests and residue are verified.** The runner reported
  `results_sha256 = d9cdd1c82ec859ef7600306702d7b5604ce42ec9403bff9780d35602cd9058c8`; the evidence copy in
  `D:\SLMM-T6-EVIDENCE\t6-run-20261020-222837-8ec45d7e\` has exactly that SHA-256; the artifact
  manifest shows the original results file and the evidence copy with the same
  digest; and the runner's residue verdict is
  `{"synthetic_rows":0,"other_t6_backends":0,"t6_advisory_locks":0}`. The
  teardown proved ownership before stopping, and post-run state is
  `port15432_listeners=0`, `t6lab_exists=False`, with the port-5432 service
  unchanged (`Running`, 2 listeners, 10 `postgres.exe`).
- **Correction applied (C9) to `test-harness/t6-checkpoint/t6-local-runner.mjs`.**
  The per-case survivor check is replaced by a session audit that identifies the
  runner's own sessions by their **backend pids**, treats a healthy idle
  transaction-free A/B session as **expected and reusable**, and fails the case
  only for an **unexpected** T6 backend, an expected session that is not
  transaction-clean, an ambiguous session identity, or a failed cleanup. The
  cleanup stays **bounded** and is restricted to positively identified
  T6-owned backends; a **foreign session is never a termination target**; the
  fail-closed behaviour is preserved. All 12 case bodies, the case IDs, the
  synthetic identities, the digest reporting and the mandatory residue checks
  are **byte-identical** to the previous revision.
- **Offline validation of the correction:** `node --check` exit 0; the runner's
  own `--self-test` is **30/30 PASS, exit 0** (the 21 original checks preserved
  plus 10 new C9 checks); **9/9 C9 mutants killed**. The corrected runner is
  **SHA-256 `0595bda3562d76056541106a33941638156340ce009a891c6746156922de8fc6`, 62766 bytes, 1203 lines** (was `e1719be2ac0d432c903035001fdb0774c93641c0fa308073eefcf55e699aa234`, 46751 bytes, 875 lines).
- **This source correction is NOT EXECUTION-APPROVED.** No run was performed
  with it, and the preparation step that would let the wrapper use it (refreshing
  the prep copy and the committed checksum manifest) has **not** been performed
  and needs separate approval.
  - **Superseded note (2026-10-21):** the statement above is the 2026-10-20
    state and is retained as history. The **committed checksum manifest** was
    subsequently reconciled (it now pins the C10 checksum; see §8e and the
    repository follow-ups recorded there) and the C9 revision **was** executed
    once on 2026-10-21 (see §8d). The **preparation copy** has still not been
    refreshed — it remains the outstanding follow-up in §9.

### 8d. Second execution attempt (2026-10-21 09:01 IST) — the corrected C9 runner executed; verdict FAIL on an observer self-classification defect

- **The one-shot execution of 2026-10-21 09:01 IST returned wrapper exit code `1`.**
  This was the **first** run of the corrected C9 runner (`0595bda3...8fc6`).
  The whole main path executed in 20.7 seconds: `initdb`, `pg_ctl start`,
  `pg_isready`, the identity check, `CREATE DATABASE t6lab`, the bootstrap, the
  preflight, the Node step, the residue re-check, the evidence copy, the
  verdict and the teardown. The run was launched through a **detached launcher
  with a waiting parent**; the launcher's stdout/stderr capture ordering was
  **corrected** so the child process is started *before* the asynchronous stream
  reads begin.
- **Every bootstrap and preflight step PASSED.** The candidate's own exit-code
  table records `initdb=0`, `pgctl_start=0`, `isready=0`, `identity=0`,
  `create_db=0`, `bootstrap=0`, `preflight=0` and `residue=0`. **Only `node`
  exited non-zero (`node=1`).** The verdict is `FAIL` and the wrapper correctly
  refused to report PASS.
- **Case outcomes: T6-L01 = FAIL; T6-L02 … T6-L11 (the remaining eleven) =
  NOT RUN.** The runner aborts the suite after the first non-PASS case.
  **No Group-L case has ever reported PASS.**
- **The C9 correction did change the failure mode — the previous run's
  "force-terminated 2 surviving T6 backend(s)" is gone.** The A/B sessions are
  no longer misclassified as leaks. The new failure detail is:
  `commit release -> loser 0 rows, attempt=1 committed once; rollback release ->
  observed waiter won with attempt=1, both rolled back, row unchanged | obs
  session is not healthy (open transaction, state=active)`.
  The first part is byte-for-byte the runner's own **success** string for
  T6-L01, so **every assertion inside the case passed**. **No product RPC
  failure has been demonstrated.**
- **The new defect: the audit observer classified itself.** `AUDIT_BACKENDS`
  selected every `slmm-t6-%` backend on the database **without excluding the
  observing connection's own pid**, unlike `OBS_T6_BACKENDS` and
  `OBS_T6_ADVISORY`, which both carry `pid <> pg_backend_pid()`. The audit
  query is executed *by* the observer, so while it runs the observer's own
  backend is necessarily `state=active` with an open transaction. The audit
  therefore judged its own observer as an expected-but-unhealthy session and
  failed the case. This is a **harness defect**, not a concurrency finding.
- **The offline self-tests could not see it:** the C9 self-test modelled the
  observer with `bk(101, "slmm-t6-obs")` hard-coded as `state="idle"` and
  `xact_open=false`, so the observer was never observed in the state it is
  actually in while running the audit. A regression check now models the
  observer as active with an open transaction.
- **Evidence digests and residue are verified.** The runner reported
  `results_sha256 = 5c77320964920c7a52ec75673256ecc115752f21d2a03057eb5c71e9cb94c200`;
  the evidence copy in `D:\SLMM-T6-EVIDENCE\t6-run-20261021-090109-a3e53a67\`
  has exactly that SHA-256, and the artifact manifest lists the original
  results file and the evidence copy with the same digest. The runner's residue
  verdict is `{"synthetic_rows":0,"other_t6_backends":0,"t6_advisory_locks":0}`.
- **The disposable laboratory was cleaned up safely.** The teardown proved
  ownership before stopping (`marker valid, postmaster.pid in our data dir,
  port 15432, postgres.exe naming our data dir`), then `pg_ctl stop -m fast`,
  then the lab tree was removed. Post-run: `port15432_listeners=0`,
  `t6lab_exists=False`; the port-5432 service was untouched (`Running`, 2
  listeners, 10 `postgres.exe`).
- **Evidence preserved:** `D:\SLMM-T6-EVIDENCE\t6-run-20261021-090109-a3e53a67\`
  (run log, node log, results JSONL, verdict JSON, artifact checksums) and
  `D:\SLMM-T6-EVIDENCE\launcher-20261021-090107-6e3008ba\` (stdout, stderr,
  exit code, timestamps, child pid, preflight/postrun state, process snapshot,
  and the launcher script itself). All four historical run directories and both
  historical launcher scripts are intact.

### 8e. C10 — observer self-exclusion correction (2026-10-21, OFFLINE ONLY, NOT LIVE-TESTED)

- **Corrected file:** `test-harness/t6-checkpoint/t6-local-runner.mjs`.
  **New SHA-256 `9f06b1c396e3634fc86eeab4d73878ce7345d7e7e5bffb0d1fea458d7f76b008`,
  71700 bytes, 1350 lines** (was `0595bda3562d76056541106a33941638156340ce009a891c6746156922de8fc6`,
  62766 bytes, 1203 lines).
- **C10-1 — the inspection query excludes the observing connection.**
  `AUDIT_BACKENDS` now carries `AND s.pid <> pg_backend_pid()`, the server's own
  identifier for the connection running the statement. Exactly one backend is
  excluded — the observer's. Every other T6-namespace backend, including a stale
  predecessor or an extra helper connection, is still inspected.
- **C10-2 — the observing session is distinguished from the inspected
  sessions.** `classifyT6Backends` and `decideSessionHealth` take an explicit
  `observerPid`. The observer is never judged, never reported and is NEVER a
  termination target. The **INSPECTED** set is now `{ setup, a, b }` — the
  other three sessions the runner owns — and the observer is the fourth.
- **C10-3 — the observer's identity is fail-closed.** If the observer's own pid
  cannot be established, the audit cannot exclude the observer, so the verdict
  **fails closed** (`the observing session's identity could not be established`)
  rather than risking the observer being classified as a leak.
- **C10-4 — the preflight and the audit are reconciled through one constant.**
  `MAX_T6_INSPECTED_BACKENDS = 3` is now used by **both** the preflight's
  backend-count allowance and the audit's expected-session count, so the two
  checks can never drift apart. A source-level self-test asserts the preflight
  compares against that constant and never against a hard-coded number.
- **Preserved unchanged:** all 12 case bodies, the case IDs, the synthetic
  identities, the digest reporting (`results_sha256`), the mandatory residue
  checks (`T6-RESIDUE`), the ownership limits, the bounded cleanup
  (`MAX_T6_CLEANUP = 8`) and the fail-closed behaviour of the ambiguous-identity,
  missing-session, unclosed-transaction, advisory-lock and cleanup-failure
  checks. The detection of unexpected T6-owned sessions and the rule that a
  foreign session is never a termination target are both preserved.
- **Offline validation:** `node --check` exit 0; the runner's own `--self-test`
  is **35/35 PASS, exit 0** (the 30 checks of the previous revision — 19
  original plus 10 C9 plus 1 child-process check — plus 5 new C9 checks). The
  C9 block now holds **15** named checks.
- **Mutation testing: 17/17 mutants killed** — the 9 pre-existing C9 mutants
  plus 8 new ones covering the observer self-exclusion defect: the SQL clause
  dropped, the SQL clause replaced by a tautology, the observer classified as
  an unexpected backend, the observer misjudged as an unhealthy expected
  session, the observer-identity fail-closed check removed, the observer made a
  termination target, the inspected-count constant broken, and the preflight
  allowance drifting from the audit expectation.
- **This correction was NOT EXECUTION-APPROVED at the time of writing (§8e,
  2026-10-20/21).** It was subsequently approved, committed, pushed and
  **executed once on 2026-10-21 at approximately 10:06 IST — see §8f, which
  supersedes this line.** No run had been performed with it when §8e was
  written. The **repository** follow-ups were **COMPLETE and offline-verified**
  before the run: the committed checksum manifest
  (`test-harness/t6-checkpoint/t6-checksums.txt`) pins the C10 checksum
  `9f06b1c396e3634fc86eeab4d73878ce7345d7e7e5bffb0d1fea458d7f76b008` for
  `t6-local-runner.mjs` (all 15 manifest entries verified against the
  repository artifacts), and `TASK.md`'s `t6-local-runner.mjs` acceptance
  criterion names the same checksum. The **preparation copy** was then
  refreshed to the C10 revision before the run.

### 8f. Third execution attempt (2026-10-21 10:06 IST) — the C10 runner executed once; **VERDICT PASS, 12/12 Group-L cases**

- **The one-shot execution of 2026-10-21 at approximately 10:06 IST returned
  wrapper exit code `0` with verdict `PASS`.** This is the **first** run in
  which the Group-L runner reached the end of the suite with every case
  passing. The launcher started at 10:06:44 IST and finished at 10:07:07 IST
  (elapsed 23.5 s, child pid 10228). The run used the **detached launcher with
  a waiting parent** and the **corrected** stdout/stderr capture ordering (the
  child process is started *before* the asynchronous stream reads begin).
- **The approved GitHub baseline at execution was
  `84d9e145e852dc9046ffa02c75bbee067aab508d`** — the commit that carries the
  C10 runner, the reconciled checksum manifest and the corrected task records.
- **All nine native steps exited 0:** `initdb=0`, `pgctl_start=0`,
  `isready=0`, `identity=0`, `create_db=0`, `bootstrap=0`, `preflight=0`,
  `node=0`, `residue=0`. The verdict block records **zero** failure reasons.
  The server identity was confirmed by the runner's own preflight:
  `{"preflight":"ok","database":"t6lab","port":15432,"server_addr":"127.0.0.1","isolation":"read committed","listen_addresses":"127.0.0.1","namespace_rows":0}`.
- **All twelve Group-L cases PASSED: 12 PASS, 0 FAIL, 0 BLOCKED, 0 NOT RUN.**
  The runner summary is
  `{"total":12,"pass":12,"fail":0,"blocked":0,"not_run":0,"harness_failed":false,"residue_failed":false}`,
  and all twelve expected case ids — `T6-L01`, `T6-L02`, `T6-L03`, `T6-L04`,
  `T6-L05`, `T6-L06`, `T6-L07`, **`T6-L08a`**, **`T6-L08b`**, `T6-L09`,
  `T6-L10`, `T6-L11` — are present exactly once, with no duplicates and no
  extra ids. **This is the first time any Group-L case has reported PASS.**
- **The C10 correction did exactly what it was designed to do.** The two
  harness defects that caused the 2026-10-20 22:28 and 2026-10-21 09:01
  failures — the per-case survivor check counting the runner's own reusable A/B
  sessions as leaks, and the audit judging its own observer as an unhealthy
  session — are both absent from this run. The residue verdict's
  `other_t6_backends: 0` independently confirms the first defect is gone: no
  A/B session was force-terminated as a false leak.
- **Results digest verified three ways.** The runner reported
  `results_sha256 = 3489610fbf2105868c8aa2ab6bd60681ac0788446a816980c5cbfd424b187b0c`;
  an **independent recalculation** of the evidence copy's SHA-256 produced the
  same value, and it matches both the verdict's `runner_sha256` and the run's
  `artifact-sha256` manifest. The digest was also re-derived from the JSONL
  *content* alone (rebuilding the text and hashing it, with no file hashing)
  and produced the same value.
- **Zero residue:** `{"synthetic_rows":0,"other_t6_backends":0,"t6_advisory_locks":0}`
  — no synthetic row, no unexpected T6 backend and no advisory lock survived.
- **The disposable laboratory was cleaned up safely.** The teardown proved
  ownership before acting (`marker valid, postmaster.pid in our data dir, port
  15432, postgres.exe naming our data dir`), stopped the cluster with
  `pg_ctl stop -m fast`, confirmed that no live cluster of ours used the
  laboratory, and only then removed the lab tree. Post-run:
  `port15432_listeners=0`, `t6lab_exists=False`. The **port-5432 service was
  untouched** (`Running`, 2 listeners, 10 `postgres.exe`, pid 5148 — identical
  to the pre-run baseline) and **no** `postgres.exe` had the lab data
  directory in its command line.
- **Evidence preserved:** `D:\SLMM-T6-EVIDENCE\t6-run-20261021-100645-9d2f02f9\`
  (run log, node log, results JSONL, verdict JSON, artifact checksums) and
  `D:\SLMM-T6-EVIDENCE\launcher-20261021-100642-9c43b8d4\` (stdout, stderr,
  exit code, started/finished timestamps, child pid, preflight and postrun
  state, process snapshot and the launcher script itself). All four earlier
  run directories, all earlier launcher directories and both historical
  launcher scripts are **intact and unmodified** — the earlier **FAIL**
  outcomes are **not** relabelled.
- **The executed wrapper was the approved candidate v3**
  (`test-harness/t6-checkpoint/t6-runner-candidate-v3.ps1`, SHA-256
  `30e31c1d2c1f14f04bdff78cfd42fa466cb613efa923f099157a347a649ba97c`),
  invoked with `-Confirm I_APPROVE_LOCAL_T6 -EvidenceRoot D:\SLMM-T6-EVIDENCE`.
  The **original recovered `t6-runner.ps1`** (`fac7926d...`) was **never**
  copied to the preparation directory and was **never executed**; it remains a
  preserved artifact only.
- **PostgreSQL defaults were preserved:** the lab used `initdb`/`pg_ctl`
  defaults and the only option string was
  `-p $Port -c listen_addresses=127.0.0.1 -c logging_collector=off`. No
  service configuration was modified, and the scheduler was never activated.
- **Scope of this PASS (do not over-read it).** This is a **local disposable
  PostgreSQL 18 lab** result. It proves the 12 Group-L concurrency cases only.
  It does **not** prove any Supabase TEST or production behaviour, and it
  says nothing about the hosted PostgreSQL's versions, `pg_locks` /
  `pg_stat_activity` semantics, timing or infrastructure. The **overall T6
  program remains INCOMPLETE**: 8 R-cases and 3 C-cases are unexecuted, and
  R2 and scheduler integration are separate pending gates. The Windows
  `0xC0000142` fault observed on 2026-10-19 did **not** recur.

### 9. Next action (single, concrete)

Commit and push this documentation update for the 2026-10-21 10:06 IST PASS
(the C10 runner, the reconciled checksum manifest and the corrected task
records are already committed and pushed at `84d9e145`). Then decide the
**next gate** with a fresh, separate approval. The Group-L local-lab gate is
**closed**; the remaining gates are independent and each needs its own
approval and its own target:

| Gate | Target | State | Needs |
|---|---|---|---|
| Group-L | local disposable PostgreSQL 18 lab, `127.0.0.1:15432` | **VERIFIED PASS** (2026-10-21 10:06 IST) | — closed |
| Group-R (`T6-R01`–`T6-R08`) | TEST Supabase, two concurrent psql sessions, **ZERO-COMMIT rollback-only** | not executed | fresh approval + a TEST target |
| Group-C (`T6-C01`–`T6-C03`) | TEST Supabase, committed synthetic fixtures + explicit cleanup + residue proof | not executed | **separate operator approval** (still BLOCKED) |
| R2 / object-storage and scheduler integration | — | not exercised | separate approval; no R2/Cloudflare/Worker operation has been performed |

Supabase TEST/production behaviour remains **NOT VERIFIED**.
Until then T6 stays **BLOCKED** and the corrected C10 runner has not been
live-tested.

Notes for the reviewer:
- The **approved** `t6-runner.ps1` revision `fac7926d…` is recovered and
  verified but is **not executable unchanged** (it fails at `pg_ctl start` for
  the quoting reason recorded in §3).
- **Candidate v1 was executed and returned BLOCKED** (exit 2) because of the
  C2b pipe-inheritance defect recorded in §5. **All 12 Group-L cases remain
  NOT RUN**; no case result exists.
- **Candidate v2** corrects C2b but carries the two defects recorded in §8.
  **Candidate v3** corrects those two defects plus the reader-lifetime
  defect found during v3 validation, and has been validated offline against
  reproductions of the exact failure shapes with 107 self-tests.
- The Windows `0xC0000142` fault observed on 2026-10-19 and in the first
  interrupted attempt on 2026-10-20 did **not** occur in the second attempt,
  which ran the cluster healthily for 16 minutes including a completed
  checkpoint. It remains an environment-level risk to record in any future
  report, and it is the reason the first attempt must be run detached.

---

## 2026-10-22 — Correction: Group-R delivery record; stale BLOCKED / self-test claims corrected

> **Append-only correction.** Per the rule at the top of this file, the earlier
> text is **not edited**. This section corrects four statements that are now
> wrong and adds the Group-R delivery record.

### 1. Corrections to earlier lines

1. **The §9 closing line "Until then T6 stays BLOCKED and the corrected C10
   runner has not been live-tested" is superseded.** The C10 runner **was**
   live-tested and **passed**: executed exactly once on 2026-10-21 at
   approximately 10:06 IST with wrapper exit 0 / verdict PASS / **12/12**
   Group-L cases (§8f above). **T6 is ACTIVE / INCOMPLETE, not BLOCKED.** That
   line was correct before the run and is retained as history.
2. **The reviewer note "107 self-tests" is superseded by the already-documented
   196/196.** The final v3 wrapper's `-SelfTest` total is **196/196 PASS,
   exit 0** (62 v2 checks + 68 C2c/C2d/C2e/C2f + 34 C2g + 32 C2h), as recorded
   in §8 and §8a of this file and in `ARTIFACT_MANIFEST.md`. "107" was an
   intermediate count. **This is not a new test execution** — it restates the
   result already recorded.
3. **The "Latest approved Git checkpoint `84d9e145…`" line is superseded.** The
   published checkpoint is **`4cad12b16494e1a9ae2a50249eaefc64dd546b60`**
   (`docs(t6): reconcile Group-R preflight evidence and Group-L verification`),
   equal to `origin/main`, **0 ahead / 0 behind**. `84d9e145…` remains the
   correct **GitHub baseline for the Group-L execution**.
4. **The "Exact next action" line is DONE.** The PASS documentation was
   committed and pushed (`61cc1a4`, then `7c1d525`, `029bf0f`, `4cad12b`).

### 2. Group-R harness — delivered, committed, pushed; NOT EXECUTED

- **Eight commits** `a11a118` → `1535f9a`; **4 files, +7,009/−0**:
  - `test-harness/t6-checkpoint/t6-group-r-runner.mjs` — **121,465 B / 2,772
    lines** — `b4184ac78e32c19d5496f2afaa4625662b55c9c4d8a2ed167bb76755075665cd`
  - `test-harness/t6-checkpoint/t6-group-r-runner-tests.mjs` — **157,505 B /
    3,194 lines** —
    `df811af43924efb2d3facb9edba01a1fd6b0e7df00eaf543dcdc72e38fb23af8`
  - `test-harness/t6-checkpoint/t6-group-r-harness.sql` — **51,860 B / 1,035
    lines** — `6de5323d87b8c7a104365393bfc0fa5c9af98482a0701465a122ef704276507e`
  - `test-harness/harness-registry.mjs` — **+8 lines** (one `LIVE_HARNESSES`
    entry and one `LIVE_SQL_HARNESSES` entry) —
    `c0fc498a586f03f21af138eee7efdd5695d3a61aa3964dfb83ed85d2b8c47c7a`
- Line counts are **total** lines including blanks; they sum to 7,001, plus 8
  registry lines = the 7,009 total.
- **No npm script references either artifact.** A Node run first passes through
  `test-harness/live-guard.mjs` (`requireLiveAuthorization`,
  `assertNonProductionTarget`), which refuses an unauthorized run and any target
  that is not the TEST project (production is always refused). The **port**
  guards live in the runner: `TRANSACTION_POOLER_PORT = 6543` and
  `LOCAL_LAB_PORT = 15432` are both refused.
- The eight `env: "R"` matrix rows (`T6-R01`–`T6-R08`) **predate** this delivery
  (matrix last changed at `ed5e212`, byte-identical at HEAD) and are **not**
  part of the +7,009.
- **`T6-R01`–`T6-R08` have never been executed. Status: NOT RUN.**

### 3. Group-R preflight-only rehearsals — three attempts, all BLOCKED

Each manifest's `evidenceSha256` was recomputed on 2026-10-22 and **matches**
its `t6-group-r-results.jsonl`:

| # | runId (UTC) | Bundle | psql exit | Evidence SHA-256 (verified) |
|---|---|---|---|---|
| 1 | `2026-10-21T17:12:52.849Z` | `t6-group-r-preflight-20261021-224201` | `2` | `160bce1ff6f76f89fc14f106175144a0e74b62a9ba395fdc917c7cb4a3348646` |
| 2 | `2026-10-22T04:12:29.623Z` | `t6-group-r-preflight-20261022-094207` | `2` | `ba9115919e20e72ab18da22da028eff4372e09961ccb561270043049116bbe94` |
| 3 | `2026-10-22T04:40:28.669Z` | `t6-group-r-preflight-20261022-101004` | `3` | `efe58ce2c6f0de1c7daee4a3b39a357b73830a05de9ac982e77920b206ceb24d` |

- Each: **PASS 0 / FAIL 0 / BLOCKED 8 / NOT RUN 0**, `preflight.ok: false`,
  `residueGate: "NOT RUN"`, `statementsIssued: 1`, `forbiddenStatements: 0`, and
  the v2 fingerprint **never computed** (`expected a85fea64…9aef`,
  `computed: null`).
- Classification: attempts 2 and 3 record **`unknown`**; attempt 1 records no
  classifier. The cause is **unresolved** in all three. The manifests
  record **no runner commit/SHA**, so build attribution is **inferred from
  timestamps only**.
- Bundles live under `D:\SLMM-T6-EVIDENCE\`; the evidence files are retained and
  were **not** modified.

### 4. Runner unit tests: 169/169 reported — UNVERIFIED

169 is a **static** top-level `test()` count in
`t6-group-r-runner-tests.mjs` (0 `describe`, 0 skip/todo). **No execution
artifact** (TAP, log or report) exists in the repository or under
`D:\SLMM-T6-EVIDENCE`, so **no pass is claimed**.

### 5. Evidence gaps recorded

- `test-harness/t6-checkpoint/t6-checksums.txt` has **15** entries and **does
  not pin** the three Group-R artifacts, `t6-runner-candidate-v3.ps1` (the
  wrapper that produced the Group-L PASS) or `t6-runner-candidate-v2.ps1`.
- `t6-deadlock-repro.ps1` and `t6-runner-candidate-v2.ps1` are documented in
  `ARTIFACT_MANIFEST.md` but remain **untracked** in Git.
- No offline regression has been run since 2026-10-17; **578/578 across 19
  suites is historical**, and the registry's **21** suites have **no verified
  complete total**.

### 6. Not run in this pass

No test, SQL, PostgreSQL, Supabase, R2, Cloudflare, build or deploy operation;
no commit or push. Documentation correction only.

---

> **Correction - 2026-10-22 (later): supersedes the first bullet of
> "### 5. Evidence gaps recorded" above.** `t6-checksums.txt` now holds **19**
> entries and pins four files added at commit `ee4ea19`: the three Group-R
> artifacts (`t6-group-r-runner.mjs` `b4184ac7.65cd`,
> `t6-group-r-runner-tests.mjs` `df811af4.3af8`, `t6-group-r-harness.sql`
> `6de5323d.507e`) and `t6-runner-candidate-v3.ps1` (`30e31c1d.b97c`). Those
> pins record **byte identity only** - they imply no execution, approval or
> PASS. `t6-runner-candidate-v2.ps1` (`b5a90be2.5bce`) and
> `t6-deadlock-repro.ps1` (`865f3abc.d88c`) remain **untracked and unpinned**;
> the second bullet above therefore still stands. **Group-R `T6-R01`–`T6-R08`
> remain NOT RUN**; the three preflight-only rehearsals were **BLOCKED**, never
> PASS. This entry is appended; no historical line was rewritten.
