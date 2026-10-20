# ARTIFACT MANIFEST — T6

- **Task:** `T6`
- **Baseline HEAD:** `eef9b2e607346f3560af5baf1f170932455a9b44`
- **Recovery checkpoint:** `64dafc9298157890877b87e38e6deb5c9dcfa8da` (2026-10-20)

## 1. Current state (2026-10-20) — RECOVERED, NOT EXECUTED

The original artifacts lived in the **external, ephemeral** directory
`%TEMP%\opencode\t6-prep` and were **not tracked by Git**. On 2026-10-20 the
host rebooted (07:24 IST) and TEMP cleanup destroyed that directory, together
with the disposable laboratory (`%TEMP%\opencode\t6lab`, its data directory,
its `pg.log` and its `T6LAB_OWNER` marker).

**All 11 approved artifacts have been recovered byte-exactly from OpenCode
session history and now live permanently in the repository at
`test-harness/t6-checkpoint/`.** Checksums are in
`test-harness/t6-checkpoint/t6-checksums.txt`.

| # | Original filename | Recovered location | Bytes | SHA-256 (recovered) | Provenance | Recovery confidence | Matches previously approved version |
|---|---|---|---|---|---|---|---|
| 1 | `t6-local-runner.mjs` | `test-harness/t6-checkpoint/t6-local-runner.mjs` | 46751 | `e1719be2ac0d432c903035001fdb0774c93641c0fa308073eefcf55e699aa234` | OpenCode session history (1 write + 10 replayed edits) | **HIGH — byte-exact** | **YES** (approved `e1719be2…`) |
| 2 | `t6-runner.ps1` | `test-harness/t6-checkpoint/t6-runner.ps1` | 16608 | `fac7926d0de1739f89a9298baf1be0198268fb560ef80ddd151cb6b73720894c` | OpenCode session history (2 writes + 8 replayed edits) | **HIGH — byte-exact** | **YES** — the **approved** revision `fac7926d…` (16608 bytes) |
| 3 | `t6-case-matrix.json` | `test-harness/t6-checkpoint/t6-case-matrix.json` | 16655 | `db689dc37b67d1a49bb1c62f0db5e7dc4c43bdea86e476a8be9037ae540a3a69` | OpenCode session history (single write) | **HIGH — byte-exact** | **YES** |
| 4 | `t6-lab-setup.sql` | `test-harness/t6-checkpoint/t6-lab-setup.sql` | 4348 | `1d4ea1f4e5cdbf7ef64da5b5ebdedc0a73f0b86e5bcc199c36eab4ebaa7655ee` | OpenCode session history (1 write + 1 replayed edit) | **HIGH — byte-exact** | **YES** |
| 5 | `t6-lab-residue.sql` | `test-harness/t6-checkpoint/t6-lab-residue.sql` | 3867 | `0ff0682e7c1d981955e513fe30876057eb9bcffbcb17a9d7ca562338e7073898` | OpenCode session history (1 write + 1 replayed edit) | **HIGH — byte-exact** | **YES** |
| 6 | `t6-preflight-lab.sql` | `test-harness/t6-checkpoint/t6-preflight-lab.sql` | 3859 | `3dd5959f6baf3ae2873790f6dd227b8737a836f59cbd75cf21e12937ddbb9766` | OpenCode session history (1 write + 1 replayed edit) | **HIGH — byte-exact** | **YES** |
| 7 | `t6-sync.sql` | `test-harness/t6-checkpoint/t6-sync.sql` | 2000 | `3415b649f8a7dd0fd16b990b096a712602fa10ba78ad85eaf04575347fa2ccc5` | OpenCode session history (1 write + 1 replayed edit) | **HIGH — byte-exact** | **YES** |
| 8 | `slmm-storage-deletion-t6-residue.sql` | `test-harness/t6-checkpoint/slmm-storage-deletion-t6-residue.sql` | 3304 | `66edf661e1d70a935eee793ed0d24e0b245d5af78dc8d36fb81200cf534cd92e` | OpenCode session history (single write) | **HIGH — byte-exact** | **YES** |
| 9 | `T6_PREPARATION_PLAN.md` | `test-harness/t6-checkpoint/T6_PREPARATION_PLAN.md` | 9657 | `d24810f9b0947d74ee35544cf18fe468adb8bef202676b938309b1c265e22a3b` | OpenCode session history (single write) | **HIGH — byte-exact** | **YES** |
| 10 | `T6_LAB_DESIGN.md` | `test-harness/t6-checkpoint/T6_LAB_DESIGN.md` | 13513 | `057ea3fa8e73132061efacb90e2d7c6660d2a8326933d8a572eb5f757a5d7add` | OpenCode session history (single write) | **HIGH — byte-exact** | **YES** |
| 11 | `T6_LAB_IMPLEMENTATION_PLAN.md` | `test-harness/t6-checkpoint/T6_LAB_IMPLEMENTATION_PLAN.md` | 10659 | `945ac2e88cd950ca35f8988440f4b879c0321b25aacd7e78bed8595173718ffe` | OpenCode session history (1 write + 1 replayed edit) | **HIGH — byte-exact** | **YES** |

**Recovery method:** each file was reconstructed by replaying the recorded
`write`/`edit` operations from the OpenCode session database
(`~/.local/share/opencode/opencode.db`) in timestamp order and selecting the
replay state whose SHA-256 equals the previously approved checksum. Every
recovered file reproduces its approved checksum **exactly**.

### Not recovered / MISSING

| Item | Status | Note |
|---|---|---|
| `t6-runner.ps1` variant `abd83227a98a40943666f2c6a3e07a5247d0f7ee8838435ce02b00f2b0c6701b` (17446 bytes) | **NOT adopted** | The later, **unapproved** wrapper revision that was on disk at the time of the loss. It is **not** substituted for the approved `fac7926d…` version. Its delta versus the approved revision is 4 hardening changes: an `Invoke-Native` helper relaxing `$ErrorActionPreference='Stop'` around native executables, all 12 native call sites wrapped with it, `listen_addresses='127.0.0.1'` requoted to `listen_addresses=127.0.0.1`, and a `postmaster.pid` existence check before `pg_ctl stop`. Byte-exact reconstruction is possible, but the file is **deliberately excluded** from the checkpoint. |
| Disposable lab `data/` directory | **MISSING** | Destroyed by TEMP cleanup on 2026-10-20. Not reconstructible. |
| `t6-lab-run.log` | **MISSING** | Never produced — the Node case runner never executed. |
| `t6-lab-results.jsonl` | **MISSING** | Never produced — the Node case runner never executed. |
| Lab `pg.log` (original, 3168 bytes) | **TRANSCRIPT ONLY** | Recovered as a readable transcript at `test-harness/t6-checkpoint/evidence/t6-lab-pg-log-transcript-2026-10-19.txt` (stored at 3145 bytes after LF line-ending normalization; 3172 bytes with CRLF terminators). The normalization changed only the line terminators, not the textual content. **Not byte-exact** — its checksum cannot match the lost original. |
| `T6LAB_OWNER` marker (original, 115 bytes) | **TRANSCRIPT ONLY** | Recovered at `test-harness/t6-checkpoint/evidence/T6LAB_OWNER-transcript-2026-10-19.txt` (stored at 111 bytes after LF line-ending normalization; 115 bytes with CRLF terminators, which matched the observed original size). The normalization changed only the line terminators, not the textual content. The original checksum was never recorded, so byte-exactness **cannot** be verified. |

### Known defect in the recovered approved revision (read before approving execution)

The approved `t6-runner.ps1` revision `fac7926d…` (16608 bytes) is recovered
byte-exactly as requested, but the session history shows it **provably fails at
cluster startup**. Its `pg_ctl start` option string still quotes the listen
address:

```
& $PgCtl start -D $DataDir -l $PgLog -o "-p $Port -c listen_addresses='127.0.0.1' -c logging_collector=off" -w
```

On Windows the single quotes are passed through literally, so the server
rejects the value and `pg_ctl` cannot start. The recorded execution of this
exact revision on 2026-10-19 22:56:54 IST produced:

```
[T6] initdb (...\t6lab\data)
[T6] pg_ctl start on port 15432 (loopback only)
pg_ctl: could not start server
T6 BLOCKED: pg_ctl start failed (1); see ...\t6lab\pg.log
runner_wrapper_exit=2
```

No cluster was started, no database was contacted, and no case ran in that
attempt. The wrapper then removed the disposable lab directory itself
(`lab_root_exists=False` afterwards).

**Wrapper revision lineage (all reconstructible byte-exactly):**

| IST time (2026-10-19) | SHA-256 | Bytes | Change | Outcome |
|---|---|---|---|---|
| 22:54:22 | `fac7926d0de1739f…0894c` | 16608 | quoting defect present | **FAILED at `pg_ctl start`** (this is the approved revision) |
| 22:58:10 | `c87df1c728d1342c…d9a63` | 16606 | quoting defect fixed (`listen_addresses=127.0.0.1`, unquoted) | cluster **started** 22:58:42, later died 23:04:43 with Windows `0xC0000142` |
| 23:07:41 | `abd83227a98a40943…c6701b` | 17446 | + `Invoke-Native` hardening (PS 5.1 native-stderr handling), `postmaster.pid` guard before `pg_ctl stop` | cluster **started** 23:08:13, later died 23:14:13 with Windows `0xC0000142` |

**The approved revision is therefore not executable as-is.** Recovering it is
correct and required, but executing it unchanged would fail closed at startup
with no data loss. Any executable candidate must be one of the two later
revisions — each of which needs its own explicit approval, and the
`abd83227…` revision additionally needs a fresh checksum approval because it
was never approved. **This is a decision for the user; no revision was
promoted, edited or executed by the recovery.**

### Corrected candidate wrapper (2026-10-20) — NOT APPROVED, NOT EXECUTED

| Item | Value |
|---|---|
| File | `test-harness/t6-checkpoint/t6-runner-candidate.ps1` (new file) |
| SHA-256 | `7161bd7d5dc998d566a946621405476cf8b0657a63eca1a468bd88e160eec9cc` |
| Bytes | 48231 |
| Derived from | the approved `t6-runner.ps1` (`fac7926d…`, 16608 bytes) — which is **unmodified** at `test-harness/t6-checkpoint/t6-runner.ps1` |
| Line delta vs. the approved base | 332 → 894 lines (125 removed, 687 added) |
| Static validation | PowerShell AST parse: **0 errors / 5979 tokens** |
| Static self-test | **49/49 checks PASS**, exit 0 (`-SelfTest`; no database, no cluster, no PostgreSQL process) |
| Status | **CANDIDATE — awaiting review and a fresh checksum approval** |

**Corrections applied** (each independently justified in the file header):

| # | Correction | Justification |
|---|---|---|
| C1 | `listen_addresses='127.0.0.1'` → `listen_addresses=127.0.0.1`, passed as one splatted argument, with a cmd-metacharacter guard | On Windows `pg_ctl` hands the `-o` string to cmd.exe, where single quotes are not quoting characters; postgres received the literal value `'127.0.0.1'` and refused to start. This is the recorded failure of the approved revision (`pg_ctl: could not start server`). |
| C2 | All native calls routed through a new `Invoke-Native` helper (`$ErrorActionPreference='Continue'` around the child, stdout/stderr split, real exit code returned) | In Windows PowerShell 5.1 a native program writing to stderr becomes a `NativeCommandError`, promoted to terminating by `$ErrorActionPreference='Stop'`. psql emits server NOTICEs on stderr — including the **success** notices of `t6-preflight-lab.sql` and `t6-lab-residue.sql` — so the approved base could abort a healthy run before any exit code was examined. |
| C3 | Exit code of every native tool captured explicitly; the stale-cluster `pg_ctl stop` exit code is now checked and the data directory is **not** deleted if the stop fails | The approved base never checked that stop's exit code, so a still-running cluster could have had its data directory deleted. |
| C4 | Verdict moved into one pure function `Get-T6Verdict` requiring: all eight native steps exit 0; results file present, parseable, containing **exactly** the 12 Group-L case ids all PASS; runner summary 12 total / 12 pass / 0 fail / 0 blocked / 0 not_run; evidence copy byte-identical and matching the SHA-256 the runner reported | The approved base decided PASS/FAIL from two exit codes only, so a run could be reported PASS with missing or incomplete results. |
| C5 | `Assert-LabPort` (only 15432 may be targeted) and `Assert-NotServiceTarget` (no path inside the PostgreSQL installation tree) | Makes the "never contact or terminate the port-5432 service" rule an enforced invariant rather than an emergent property. |
| C6 | Ownership marker parsed structurally; `postmaster.pid` of a stale data directory is read and refused unless its recorded data directory is ours; a failed stop blocks deletion | The approved base matched the marker with a loose `-like "*slmm-t6-disposable-lab*"` substring test and never inspected `postmaster.pid`. |
| C7 | Evidence written to a uniquely named directory outside the disposable cluster (`<root>/t6-run-<runid>/`): run log, node log, copy of the results file, artifact checksums, structured verdict. `-EvidenceRoot` may redirect it but never into the lab root, never into the repository, never into the PostgreSQL installation | The approved base wrote the run log and results **inside** the lab root, which the teardown then deleted — a passing run could leave no evidence at all. |
| C8 | 49 static negative tests (path injection, port redirection, incorrect ownership, startup-failure verdict mapping, evidence preservation) | Extends the base's 15 self-tests to the new failure modes. |

**Two defects were found by the candidate's own new tests and fixed before
delivery** (both would have been latent in the base):

1. **Trailing space/dot in a laboratory path was normalised away before the
   check ran.** `[IO.Path]::GetFullPath()` strips a trailing `" . "`, so the
   guard never saw it; Windows APIs that do not normalise can address a
   *different* directory with such a name. The raw string is now rejected
   before normalisation.
2. **`postmaster.pid` ownership comparison was one-sided.** Only our own path
   was canonicalised with `GetFullPath()`, which expands 8.3 short names
   (`JAYAKU~1` → `JAYAKUMAR_DELL_SSD`). postgres records the data directory as
   it resolved it at startup, which may be the short form, so the comparison
   would have **wrongly refused a genuinely-owned** cluster. Both sides are now
   canonicalised.

**Not adopted:** the later unapproved revision `abd83227…` (17446 bytes). Its
`Invoke-Native` idea was independently re-derived here with a stronger
contract (exit code returned, stdout/stderr separated and preserved as
evidence) rather than copied.

## 2. Related external state (not files) — 2026-10-20 status

| Item | Location | Note |
|---|---|---|
| Existing local PostgreSQL cluster | `127.0.0.1:15432`, PID 2676 | **GONE.** That process no longer exists; the 2026-10-20 recovery audit found no listener on port 15432. |
| Disposable lab directory | `%TEMP%\opencode\t6lab` | **GONE.** Destroyed by TEMP cleanup on 2026-10-20. Nothing was deleted by this task. |
| PostgreSQL service (unrelated) | `127.0.0.1:5432`, postmaster PID 4828, service `postgresql-x64-18`, data dir `C:\Program Files\PostgreSQL\18\data` | **Not** the T6 laboratory. Out of scope for T6; never contacted, never stopped. T6 must never connect to port 5432. |
| `t6-prep` directory | `%TEMP%\opencode\t6-prep` | **GONE** (recreated empty by the agent runtime). The permanent copies now live in `test-harness/t6-checkpoint/`. |

## 3. Notes

- The recovered artifacts are a **recovery**, not an execution record. Recovering
  them is **not** an approval to run them. T6 remains **BLOCKED** pending
  recovered-artifact safety verification and a fresh, separate execution
  approval.
- These files are **not** run from `test-harness/t6-checkpoint/`. The
  orchestrator resolves its preparation directory as `<TEMP>\opencode\t6-prep`
  and its laboratory root as `<TEMP>\opencode\t6lab`; a future run would copy
  and re-verify them into that namespace, or be re-planned against a new
  namespace.
- **Static-only verification was performed** on 2026-10-20 (JavaScript syntax
  via `node --check`, PowerShell syntax via AST parse, SHA-256 comparison,
  connection-target and path-safety inspection, secret scan). **No recovered
  code was executed, no PostgreSQL was started, and no database was contacted.**
- Nothing here may be deleted or overwritten without separate explicit approval.

## 4. Historical manifest (superseded by §1, retained as the 2026-10-19 record)

> Append-only historical record. The table below is the 2026-10-19 state of the
> external, ephemeral `%TEMP%` artifacts, which were lost on 2026-10-20 (host
> reboot + TEMP cleanup). See §1 for the recovered, repository-resident copies.
> Note that the 2026-10-19 `t6-runner.ps1` row recorded the **later,
> unapproved** `abd83227…` wrapper that was on disk; the recovered checkpoint
> deliberately contains the **approved** `fac7926d…` revision instead.

| # | Source filename | Destination / location | SHA-256 | Committed Git path | Commit | Status | Retention |
|---|---|---|---|---|---|---|---|
| 1 | `t6-local-runner.mjs` | `%TEMP%\opencode\t6-prep\` | `e1719be2ac0d432c903035001fdb0774c93641c0fa308073eefcf55e699aa234` | untracked (external) | — | external-ephemeral | approved runner; preserve until task closes |
| 2 | `t6-runner.ps1` | `%TEMP%\opencode\t6-prep\` | `abd83227a98a40943666f2c6a3e07a5247d0f7ee8838435ce02b00f2b0c6701b` | untracked (external) | — | external-ephemeral | **hash mismatch** — resolve before execution |
| 3 | `t6-case-matrix.json` | `%TEMP%\opencode\t6-prep\` | `db689dc37b67d1a49bb1c62f0db5e7dc4c43bdea86e476a8be9037ae540a3a69` | untracked (external) | — | external-ephemeral | case definitions |
| 4 | `t6-lab-setup.sql` | `%TEMP%\opencode\t6-prep\` | `1d4ea1f4e5cdbf7ef64da5b5ebdedc0a73f0b86e5bcc199c36eab4ebaa7655ee` | untracked (external) | — | external-ephemeral | lab schema |
| 5 | `t6-lab-residue.sql` | `%TEMP%\opencode\t6-prep\` | `0ff0682e7c1d981955e513fe30876057eb9bcffbcb17a9d7ca562338e7073898` | untracked (external) | — | external-ephemeral | residue check |
| 6 | `t6-preflight-lab.sql` | `%TEMP%\opencode\t6-prep\` | `3dd5959f6baf3ae2873790f6dd227b8737a836f59cbd75cf21e12937ddbb9766` | untracked (external) | — | external-ephemeral | preflight |
| 7 | `t6-sync.sql` | `%TEMP%\opencode\t6-prep\` | `3415b649f8a7dd0fd16b990b096a712602fa10ba78ad85eaf04575347fa2ccc5` | untracked (external) | — | external-ephemeral | sync step |
| 8 | `slmm-storage-deletion-t6-residue.sql` | `%TEMP%\opencode\t6-prep\` | `66edf661e1d70a935eee793ed0d24e0b245d5af78dc8d36fb81200cf534cd92e` | untracked (external) | — | external-ephemeral | residue (storage-deletion) |
| 9 | `T6_PREPARATION_PLAN.md` | `%TEMP%\opencode\t6-prep\` | `d24810f9b0947d74ee35544cf18fe468adb8bef202676b938309b1c265e22a3b` | untracked (external) | — | external-ephemeral | design record |
| 10 | `T6_LAB_DESIGN.md` | `%TEMP%\opencode\t6-prep\` | `057ea3fa8e73132061efacb90e2d7c6660d2a8326933d8a572eb5f757a5d7add` | untracked (external) | — | external-ephemeral | design record |
| 11 | `T6_LAB_IMPLEMENTATION_PLAN.md` | `%TEMP%\opencode\t6-prep\` | `945ac2e88cd950ca35f8988440f4b879c0321b25aacd7e78bed8595173718ffe` | untracked (external) | — | external-ephemeral | design record |

## 5. Notes (historical, 2026-10-19)



- Because these files are in ephemeral `%TEMP%`, **preserve them into the task
  folder before task closure** — but only with explicit approval (rule 9/10).
- Nothing here may be deleted or overwritten without separate explicit approval.
