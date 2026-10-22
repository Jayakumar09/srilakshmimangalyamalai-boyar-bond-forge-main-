# ARTIFACT MANIFEST — T6

- **Task:** `T6`
- **Baseline HEAD:** `eef9b2e607346f3560af5baf1f170932455a9b44`
- **Recovery checkpoint:** `64dafc9298157890877b87e38e6deb5c9dcfa8da` (2026-10-20)

## 1. Current state (2026-10-21) § RECOVERED; FIVE EXECUTION ATTEMPTS; GROUP-L VERIFIED PASS (see §2)

> **Correction (2026-10-22):** the heading above counted only the **five**
> attempts known on 2026-10-20. Two more Group-L attempts followed — 2026-10-21
> 09:01 IST (**FAIL**, exit 1) and 10:06 IST (**PASS**, exit 0) — and **three
> Group-R preflight-only rehearsals** were later attempted (2026-10-21 22:42,
> 2026-10-22 09:42 and 10:10 IST), all **BLOCKED**. The Group-L PASS record is
> the "Execution record (2026-10-21 ~10:06 IST)" **in this section**, not §2;
> §2 is "Related external state". The heading and the earlier sections are
> retained unchanged as history.

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

### Corrected candidate v2 (2026-10-20) — NOT EXECUTION-APPROVED, NOT EXECUTED

| Item | Value |
|---|---|
| File | `test-harness/t6-checkpoint/t6-runner-candidate-v2.ps1` (new file) |
| SHA-256 | `b5a90be2198b186a009971342155e6e4f5ba54cf5f66455d2e8d4bef9d655bce` |
| Bytes | 54620 (1040 lines) |
| Derived from | candidate v1 `t6-runner-candidate.ps1` (`7161bd7d…eec9cc`, 48231 bytes) — **unmodified**; the original recovered `t6-runner.ps1` (`fac7926d…0894c`) is also **unmodified** |
| Line delta vs. v1 | 894 → 1040 lines (132 removed, 278 added) |
| Static validation | PowerShell AST parse: **0 errors / 7057 tokens**; `-SelfTest`: **62/62 PASS, exit 0** (49 v1 safety tests preserved + 13 process-handling tests) |
| Status | **CANDIDATE v2 — awaiting review and a fresh checksum approval** |

**The single correction: C2b — native output capture must not wait for EOF
from daemonised descendants.**

v1 captured native output with a PowerShell pipeline
(`$merged = @(& $Exe @ArgList 2>&1)`). A pipeline completes only at EOF. On
Windows `pg_ctl start` does not exec the postmaster; it spawns

```
pg_ctl.exe  ->  cmd.exe /C "postgres.exe ..."  ->  postgres.exe
```

and that long-lived `cmd.exe`/`postgres.exe` pair **inherits pg_ctl's stdout
and stderr handles**, so the write end stays open for the life of the cluster
and EOF never arrives. On 2026-10-20 the wrapper therefore blocked inside
`Invoke-Native` at the `pg_ctl start` step for 20 minutes with 0% CPU and no
child processes, after the cluster had started correctly on 127.0.0.1:15432.

v2 runs the child through `System.Diagnostics.Process` with
`RedirectStandardOutput`/`RedirectStandardError`, drains both streams with
`CopyToAsync()` into **unbounded `MemoryStream`s**, and waits on the
**direct child only**, bounded by an
explicit timeout. A descendant that inherits the handles therefore cannot
stall the wrapper.

| Property | v1 | v2 |
|---|---|---|
| Output capture | pipeline `2>&1` (blocks at EOF) | `Process` + `CopyToAsync()` into unbounded `MemoryStream`s (never blocks on EOF) |
| Wait target | the pipeline, i.e. all inheriting descendants | the **direct child only** |
| Wait bound | **none** | explicit timeout (`$NativeTimeoutSeconds`, default 120 s) |
| Timeout outcome | n/a | **non-zero exit code + `TimedOut` flag — never success** |
| Exit code source | `$LASTEXITCODE` (unreliable with redirection) | `Process.ExitCode` (reliable) |
| stdout / stderr | captured separately | captured separately (**preserved**) |
| Argument fidelity | PowerShell native quoting | explicit `CommandLineToArgvW` quoting (spaces / quotes / trailing backslash survive as ONE argument) |

**All other v1 corrections are carried over unchanged:** C1 (unquoted
`listen_addresses`, one splatted argument, cmd-metacharacter guard), C3
(explicit exit-code capture for every native tool; a failed stale-cluster stop
blocks data-directory deletion), C4 (`Get-T6Verdict` — PASS requires all
eight native steps to exit 0, exactly the 12 Group-L ids recorded PASS, the
runner summary 12/12 with 0 fail / 0 blocked / 0 not_run, and the evidence
copy byte-identical and matching the runner's own digest), C5
(`Assert-LabPort` / `Assert-NotServiceTarget` keep the port-5432 service
unreachable), C6 (structural ownership-marker parsing, `postmaster.pid`
verification, failed stop blocks deletion), C7 (durable, uniquely named
evidence written outside the disposable cluster).

**No PostgreSQL setting was changed.** `autovacuum`, `checkpoint_timeout`,
`fsync` and every other server parameter are untouched; the lab still uses
initdb/pg_ctl defaults.

**New offline regression artifact**

| Item | Value |
|---|---|
| File | `test-harness/t6-checkpoint/t6-deadlock-repro.ps1` (new file) |
| SHA-256 | `865f3abc0e9e75cd1212dab9e5f3292a1b8760a9d9cc5f631473f73f70c1d88c` |
| Bytes | 6153 |
| Purpose | Reproduces the exact 2026-10-20 deadlock shape with `cmd.exe` + `ping` only — **no PostgreSQL, no port 15432, no 5432 service** — and asserts (a) the v1 pipeline pattern blocks while a descendant holds the pipe, (b) the v2 file-redirect pattern returns promptly, (c) a short deadline is reported as a TIMEOUT rather than as success |

### Corrected candidate v3 (2026-10-20) § APPROVED, COMMITTED, PUSHED, EXECUTED ONCE (verdict FAIL)

| Item | Value |
|---|---|
| File | `test-harness/t6-checkpoint/t6-runner-candidate-v3.ps1` (new file) |
| **Current (final) SHA-256** | `30e31c1d2c1f14f04bdff78cfd42fa466cb613efa923f099157a347a649ba97c` |
| **Current bytes / lines** | **139325 bytes / 2520 lines** |
| Historical v3 revision SHA-256 (a) | `5faae6ebc0a1e422b465b369ab37da8b3049f88190c81eb2f2a00794da21457a` (95610 bytes / 1809 lines) -- superseded, retained here for provenance |
| Historical v3 revision SHA-256 (b) | `deb84e0f09b56133e8b282adaae6f40e6f82e58b7f2becc6601b5a9a04228e8b` (108466 bytes / 2016 lines) -- superseded, retained here for provenance |
| Historical v3 revision SHA-256 (c) | `f4e10f765448811979bf9bbbc3d563b3b48d2d79dad08037e2e49308fde334e1` (119524 bytes / 2189 lines) -- superseded, retained here for provenance |
| Historical v3 revision SHA-256 (d) | `c3b8151575d377f68cf64b7719b2c0807c7aeeedcd84c7f8fc8f36853b37d017` (135905 bytes / 2469 lines) -- superseded, retained here for provenance |
| Derived from | candidate v2 `t6-runner-candidate-v2.ps1` (`b5a90be2…55bce`, 54620 bytes) — **unmodified**; candidate v1 (`7161bd7d…eec9cc`) and the original recovered `t6-runner.ps1` (`fac7926d…0894c`) are also **unmodified** |
| Line delta vs. v2 -- historical v3 revision | 1040 → 1809 lines (59 removed, 828 added) |
| Line delta vs. v2 -- current final revision | 1040 → 2520 lines (66 removed, 1546 added) |
| Static validation | PowerShell AST parse: **0 errors / 15442 tokens**; `-SelfTest`: **196/196 PASS, exit 0** (the 62 v2 checks preserved + 68 new C2c/C2d/C2e/C2f checks + 34 new C2g parameter-binding checks + 32 new C2h main-path-initialisation and parameter-binding checks) |
| Mutation testing | 8/8 mutants **killed** (digest presence, digest validity, digest-vs-evidence, evidence byte-identity, capture-trust predicate, Node-step gate removal, Node-step gate always-throws, gate ordering), plus 4/4 C2h mutants **killed** (initialisation removed, initialisation moved after the main path, initialisation made conditional, initialisation given the wrong type) |
| Status | **CANDIDATE v3 — awaiting review and a fresh checksum approval** |

> **Correction (2026-10-22):** the `Status` row above was accurate when written.
> Candidate v3 was subsequently **approved, committed and pushed at `84d9e145`**,
> and the wrapper was executed **three** times: 2026-10-20 22:28 IST (**FAIL**,
> exit 1; original runner `e1719be2…`), 2026-10-21 09:01 IST (**FAIL**, exit 1;
> C9 runner `0595bda3…`) and 2026-10-21 10:06 IST (**PASS**, exit 0; C10 runner
> `9f06b1c3…`). The subsection heading's "EXECUTED ONCE" was accurate on
> 2026-10-20 only; the row is retained as history.

**Three corrections.** The first two are the defects found by the final
offline safety review of candidate v2; the third was found while validating
v3. None had been executed; all were latent.

#### C2c — bounded output capture

| Property | v2 | v3 |
|---|---|---|
| Capture target | unbounded `MemoryStream` | `T6BoundedCapture`, a bounded `Stream` subclass |
| Retained bytes | unlimited (measured ~1.3 MB/s growth) | **at most `$NativeMaxCaptureBytes` = 4 MB per stream** |
| stdout / stderr bounds | shared | **independent** |
| Excess output | buffered forever | **discarded and counted**, while still being drained so the child is never blocked |
| Truncation reporting | none | `StdoutTruncated` / `StderrTruncated` + discarded byte counts + an explicit `OUTPUT TRUNCATED (stdout\|stderr)` line in the output and in the evidence log |
| Native exit code | preserved | **preserved (unchanged)** |
| If the bounded sink cannot be compiled | n/a | **refuses to run** (no silent fallback to unbounded capture) |

#### C2e — timeout cleanup for `pg_ctl start`, with positive ownership proof

- The start is marked **attempted before it is issued**, so the teardown
  **always inspects the disposable laboratory** — not only when a start
  succeeded. A timed-out or failed start can no longer leave a postmaster
  unmanaged.
- A process is stopped **only** when ownership is positively proven:
  the ownership marker is valid **and** `postmaster.pid` lives in **our**
  canonical data directory **and** the recorded port is **15432** **and** the
  PID is still alive **and** it is a `postgres.exe` whose command line names
  **our** data directory.
- A process is **never** stopped merely because it listens on port 15432. The
  port-5432 Windows service is never a candidate (a `postmaster.pid`
  recording port 5432 is classified *foreign*).
- If ownership cannot be established the evidence is preserved, the run is
  reported **BLOCKED**, and the uncertain process is **left untouched**.
- The lab data directory is **never deleted while a potentially active
  PostgreSQL process remains**. The decision is a pure function
  (`Test-LabDeletionSafe`) evaluated on the **post-stop** state, so a
  successfully stopped cluster does not block cleanup and an unproven one
  does.

#### C2d — reader cancellation and safe disposal

- **Measured (offline).** A read already pending on an **inherited pipe
  handle** is **not** interrupted by closing the stream, disposing it,
  cancelling the .NET read, or disposing the owning `Process` — it stays
  blocked and its copy task never reaches a terminal state (still
  `WaitingForActivation` after 3 s). `CancelIoEx` on the pipe handle **does**
  interrupt it (terminal in **23–53 ms**, status `Canceled`).
- v3 cancels the pending overlapped operation with `CancelIoEx`, closes the
  stream, waits (bounded) for the reader task to reach a terminal state and
  **only then disposes the sink**. If the task still has not finished the
  sink is **deliberately not disposed** and `CaptureIncomplete` is reported.

**New offline regression coverage** (all with harmless simulated processes —
`cmd.exe` and `ping` only; no PostgreSQL, no port 15432, no 5432 service):
high-volume stdout and stderr; bounded memory under sustained output;
explicit output-truncation reporting; descendants holding the pipe handles
open; reader cancellation and disposal; timeout with surviving descendants;
and refusal to clean up unowned, foreign or ambiguous processes.

#### C2f -- a truncated or incomplete capture can never yield PASS

Added in the final revision after the offline safety review found that a
truncated capture could remove exactly the two values the verdict depends on.

The Group-L runner emits its `summary` line and its `results_sha256` digest
near the **end** of its stdout. A capture that is truncated (the 4 MB cap was
reached) or incomplete (a reader task had not finished) can therefore remove
both of them while the native exit code is still 0. Two changes close this:

| # | Change | Effect |
|---|---|---|
| C2f-1 | The Node step calls `Assert-NodeCaptureTrustworthy`, which **throws** `T6 BLOCKED` if `StdoutTruncated`, `StderrTruncated` or `CaptureIncomplete` is set | A truncated or incomplete runner capture is a **hard failure**; no verdict is issued at all |
| C2f-2 | `Get-T6Verdict` now **requires** `ExpectedResultsSha` to be present and to be a well-formed 64-hex-digit value, and requires the evidence copy to match it | A missing or malformed digest is a **failure reason**, never a skipped check |

The **evidence byte-identity comparison and both checksum comparisons are
preserved unchanged** and are still evaluated in addition to the digest check.
**No other process, database or cleanup behaviour was changed.**

#### C2g -- parameter-binding correctness, and the failed launch it explains

Added after the one-shot execution attempt of 2026-10-20 19:16 IST **failed
with launcher exit code 1**: the approved invocation passed `-EvidenceRoot`,
but the candidate's `param()` block did not declare it, so PowerShell failed
at parameter binding **before the script body ran**. No evidence directory was
created, **no PostgreSQL was started**, port 15432 was never bound, and **all
12 Group-L cases were NOT RUN**. Evidence retained under
`D:\SLMM-T6-EVIDENCE\launcher-20261020-191622-a1e6bf5c\`.

| # | Correction | Effect |
|---|---|---|
| C2g-1 | `[string]$EvidenceRoot` added to the `param()` block | The approved invocation binds. This restores exactly the shape candidate **v1** had (committed in `ed5e2121`); the declaration was lost in v2 and inherited by v3. It is the **only functional change** to the candidate. |
| C2g-2 | A 34-assertion offline regression block | Proves the script's own `param()` block declares exactly `Keep`, `Confirm`, `SelfTest`, `EvidenceRoot`; the effective surface exposes all four; the designed default for an omitted `-EvidenceRoot` is intact; the candidate accepts `-EvidenceRoot` with no binding error; an omitted `-EvidenceRoot` yields **only the designed default, never an undefined-variable failure**; and a harmless binding probe **cannot enter the PostgreSQL execution path**. |

Seven defects in the new test code were found and corrected -- the candidate's
behaviour was never at fault: an over-strict parameter assertion that
collected every FUNCTION parameter instead of the script's own `param()`
block; a text-search cut point that also matched the same marker inside the
C2g block itself, cutting the file mid-`try/finally` and leaving an
unbalanced brace (the extracted prefix is now **AST-verified balanced**); and
two path expectations compared against the **8.3 short form** of `%TEMP%`
while the candidate canonicalises with `GetFullPath` (both sides are now
canonicalised). **No assertion was removed or skipped.**

#### C2h -- main-path initialisation, and the BLOCKED execution it explains

The one-shot execution attempt of 2026-10-20 20:15 IST **ended with wrapper
exit code 2 (BLOCKED)**. The `-EvidenceRoot` repair worked -- the invocation
bound and the candidate created its evidence directory under
`D:\SLMM-T6-EVIDENCE\t6-run-20261020-201516-88ef8d45\` -- but the run then
aborted at the **first** step with `FAILED: The variable '$script:ExitCodes'
cannot be retrieved because it has not been set.`

`$script:ExitCodes` was **never initialised**; under
`Set-StrictMode -Version Latest` the main path's first assignment raised a
terminating error, so the run stopped **before `pg_ctl start`**. **No
PostgreSQL cluster was ever started**, port 15432 was never bound and **all 12
Group-L cases remained NOT RUN**. The candidate's ownership-verified teardown
removed only its own disposable lab tree. Evidence preserved under
`D:\SLMM-T6-EVIDENCE\launcher-20261020-201457-c2476264\` and
`D:\SLMM-T6-EVIDENCE\t6-run-20261020-201516-88ef8d45\`.

| # | Correction | Effect |
|---|---|---|
| C2h-1 | `$script:ExitCodes = @{}` added to the script-scope initialisation block, beside `$script:stFail`, `$script:RunId`, `$script:EvidenceDir`, `$script:LogPath`, `$script:LogLines` and `$script:CaptureReady` | The main path can index the exit-code table. This is the **only functional change** to the candidate; every other edit is inside the C2h self-test block. |
| C2h-2 | An **AST-based** assertion that every script-scope variable **read** in the main execution path is **initialised before that read** | A textual assignment somewhere in the file is **not** accepted as proof: the initialisation must be an **unconditional, top-level assignment whose position precedes the first read**. A variable assigned **inside a function** (deliberately assigned during execution) is accepted only because the mocked dry run proves it is set before it is read; a **conditional** initialisation is reported as unreliable. |
| C2h-3 | A **mocked main-path dry run** | The candidate is copied to a scratch file whose `Invoke-Native`, `Assert-PortFree`, `Get-LabClusterState`, `Stop-LabClusterIfOwned` and `Remove-LabTree` are mocked, and the child runs with `TEMP` redirected into a sandbox. It exercises **parameter binding and the whole main path** -- `initdb`, `pg_ctl start`, `pg_isready`, the identity check, bootstrap, preflight, the Node step, the residue re-check, the evidence copy, the verdict and the teardown -- while **initdb, pg_ctl, psql, Node and every database operation are never invoked** and no real process is started. It asserts the Node step was reached, the verdict was **PASS**, only port **15432** was ever requested (**5432 never**), the teardown touched only the sandbox laboratory, and no `postgres.exe` appeared. |

| C2h-4 | An explicit **binding proof for every externally supported parameter** | `-Confirm` is proven by a mocked run that is **refused** when the token is omitted; `-Keep` is proven by a mocked run that **keeps** the laboratory instead of tearing it down; `-EvidenceRoot` is proven by the dry run honouring it; `-SelfTest` is proven by the fact that the self-test is itself entered through it and by the C2g parameter-surface assertions. **All four bind correctly.** |

An **exhaustive audit** for other main-path-only defects classified every
script-scope variable read in the main path (`EvidenceDir`, `LabRoot`,
`LogPath`, `RunId`, `ExitCodes`) and scanned **every function** in the file for
a local variable read before assignment. **No unresolved main-path-only defect
was found.**

**No PostgreSQL setting was changed** and the option string is unchanged.

### Corrected Group-L runner (2026-10-20) - EXECUTED ONCE on 2026-10-21 (verdict FAIL, observer self-classification)

The one-shot execution of 2026-10-20 22:28 IST was the **first** run that
reached the Group-L runner. It returned **wrapper exit code 1** with verdict
**FAIL**. **Every bootstrap and preflight step PASSED** (`initdb`, `pg_ctl start`,
`pg_isready`, identity, `CREATE DATABASE`, bootstrap, preflight and residue all
exited 0); only the `node` step exited 1.

**Case outcomes:** T6-L01 = **FAIL**; T6-L02, T6-L03, T6-L04, T6-L05, T6-L06,
T6-L07, T6-L08a, T6-L08b, T6-L09, T6-L10 and T6-L11 = **NOT RUN**. **No
Group-L case has ever reported PASS.**

**T6-L01 failed because of the runner's per-case survivor logic, not because of
a demonstrated product RPC failure.** **No product RPC failure has been demonstrated.** Its recorded detail is byte-for-byte the
runner's own success return string for T6-L01 followed only by
` | force-terminated 2 surviving T6 backend(s)`, so every assertion inside the
case passed. The per-case check treated the runner's own two long-lived,
intentionally reused A/B sessions as leaks.

| Item | Value |
|---|---|
| File | `test-harness/t6-checkpoint/t6-local-runner.mjs` (existing file, corrected) |
| **Corrected SHA-256** | `0595bda3562d76056541106a33941638156340ce009a891c6746156922de8fc6` |
| **Corrected bytes / lines** | **62766 bytes / 1203 lines** |
| Previous revision SHA-256 | `e1719be2ac0d432c903035001fdb0774c93641c0fa308073eefcf55e699aa234` (46751 bytes / 875 lines) -- the revision that was executed |
| Static validation | `node --check` **0 errors**; `node t6-local-runner.mjs --self-test` **30/30 PASS, exit 0** (the 21 original checks preserved + 10 new C9 checks) |
| Mutation testing | **9/9 C9 mutants killed** (expected-session classification, open-transaction check, advisory-lock check, foreign-session classification, case gate, missing-session check, ambiguous-identity check, cleanup-failure reason, unexpected-backend detection reason) |
| Preserved | All 12 case bodies byte-identical, the case IDs, the synthetic identities, the digest reporting and the mandatory residue checks |
| Execution status | **EXECUTED ONCE on 2026-10-21** -- see §"Execution record (2026-10-21)" below |

| # | Correction | Effect |
|---|---|---|
| C9-1 | The per-case survivor check is replaced by a **session audit keyed on the runner's own backend pids** | Sessions A and B are created once and intentionally reused across cases; a healthy idle transaction-free A/B session is **expected and reusable**, not a leak. The previous check counted them as survivors, force-terminated them and failed the first case, which aborted the remaining eleven. |
| C9-2 | **Detection is preserved and strengthened** | The case still fails for an **unexpected** T6 backend, an expected session that is **not transaction-clean** (open transaction, non-idle state, or a held advisory lock), a **missing** expected session, an **ambiguous** session identity, or a **failed cleanup**. Every case still ends with `ROLLBACK` on every session. |
| C9-3 | Cleanup stays **bounded and restricted** | At most 8 unexpected backends are terminated per case, with a 5-second bound, and only for backends **positively identified as T6-owned** and not one of the runner's own live sessions. A **foreign session is never a termination target**. The audit **fails closed** when the session identity or the observation cannot be established. |

### Execution record (2026-10-21) - the C9 runner was executed once and returned FAIL

One launcher attempt occurred at 09:01:07 IST. The run was launched through a
**detached launcher with a waiting parent**; the launcher's stdout/stderr
capture ordering was **corrected** so the candidate process is started *before*
the asynchronous stream reads begin.

| # | Window (IST) | Outcome | Detail |
|---|---|---|---|
| Q | Candidate v3 one-shot execution (2026-10-21 09:01 IST) | **FAIL (wrapper exit 1)** | The whole main path executed in 20.7 s. `initdb`, `pg_ctl start`, `pg_isready`, identity, `CREATE DATABASE t6lab`, bootstrap, preflight and residue all exited **0**; only `node` exited **1**. The verdict is **FAIL** -- the wrapper correctly refused to report PASS. **T6-L01 = FAIL; the other eleven = NOT RUN.** Evidence: `D:\SLMM-T6-EVIDENCE\t6-run-20261021-090109-a3e53a67\` (run log, node log, results JSONL, verdict JSON, artifact checksums) and `D:\SLMM-T6-EVIDENCE\launcher-20261021-090107-6e3008ba\` (stdout, stderr, exit code, timestamps, child pid, preflight/postrun state, process snapshot, launcher script). The results digest `5c77320964920c7a52ec75673256ecc115752f21d2a03057eb5c71e9cb94c200` matches the evidence copy byte-for-byte; the residue verdict is `{"synthetic_rows":0,"other_t6_backends":0,"t6_advisory_locks":0}`. Teardown proved ownership before stopping; post-run `port15432_listeners=0`, `t6lab_exists=False`; the port-5432 service was untouched (`Running`, 2 listeners, 10 `postgres.exe`). |

**The C9 correction did change the failure mode.** The previous run's
`force-terminated 2 surviving T6 backend(s)` is gone -- the A/B sessions are no
longer misclassified as leaks. The new T6-L01 detail is:

```
commit release -> loser 0 rows, attempt=1 committed once; rollback release -> observed waiter won with attempt=1, both rolled back, row unchanged | obs session is not healthy (open transaction, state=active)
```

The first part is byte-for-byte the runner's own **success** string for T6-L01,
so **every assertion inside the case passed**. **No product RPC failure has been
demonstrated.**

**The new defect: the audit observer classified itself.** `AUDIT_BACKENDS`
selected every `slmm-t6-%` backend on the database **without excluding the
observing connection's own pid**, unlike `OBS_T6_BACKENDS` and
`OBS_T6_ADVISORY`, which both carry `pid <> pg_backend_pid()`. The audit query
is executed *by* the observer, so while it runs the observer's own backend is
necessarily `state=active` with an open transaction. The audit therefore judged
its own observer as an expected-but-unhealthy session and failed the case.
**This is a harness defect, not a concurrency finding.** The offline self-tests
could not see it, because the C9 self-test modelled the observer as
`state="idle"` with no open transaction -- never in the state it is actually in
while running the audit.

### Corrected Group-L runner (2026-10-21) - C10 observer self-exclusion - EXECUTED ONCE, VERDICT PASS

| Item | Value |
|---|---|
| File | `test-harness/t6-checkpoint/t6-local-runner.mjs` (existing file, corrected again) |
| **New SHA-256** | `9f06b1c396e3634fc86eeab4d73878ce7345d7e7e5bffb0d1fea458d7f76b008` |
| **New bytes / lines** | **71700 bytes / 1350 lines** |
| Previous revision SHA-256 | `0595bda3562d76056541106a33941638156340ce009a891c6746156922de8fc6` (62766 bytes / 1203 lines) -- the revision that was executed on 2026-10-21 at 09:01 IST and returned FAIL |
| Static validation | `node --check` **0 errors**; `node t6-local-runner.mjs --self-test` **35/35 PASS, exit 0** (the 30 checks of the previous revision plus 5 new C9 checks; the C9 block now holds 15 named checks) |
| Mutation testing | **17/17 mutants killed** -- the 9 pre-existing C9 mutants plus 8 new ones covering the observer self-exclusion defect (SQL clause dropped; SQL clause replaced by a tautology; observer classified as an unexpected backend; observer misjudged as an unhealthy expected session; observer-identity fail-closed check removed; observer made a termination target; inspected-count constant broken; preflight allowance drifting from the audit expectation) |
| Preserved | All 12 case bodies byte-identical, the case IDs, the synthetic identities, the digest reporting, the mandatory residue checks, the ownership limits, the bounded cleanup (`MAX_T6_CLEANUP = 8`) and the fail-closed behaviour of the ambiguous-identity, missing-session, unclosed-transaction, advisory-lock and cleanup-failure checks |
| Status | **EXECUTED ONCE on 2026-10-21 at approximately 10:06 IST -- WRAPPER EXIT 0, VERDICT PASS, 12/12 Group-L cases PASS.** GitHub baseline at execution: `84d9e145e852dc9046ffa02c75bbee067aab508d`. See the execution record below. |

| # | Correction | Effect |
|---|---|---|
| C10-1 | The inspection query excludes the observing connection: `AND s.pid <> pg_backend_pid()` | Exactly one backend is excluded -- the observer's. Every other T6-namespace backend, including a stale predecessor or an extra helper connection, is still inspected. This is the direct fix for the 2026-10-21 09:01 IST failure. |
| C10-2 | The observing session is **distinguished from the inspected sessions** | `classifyT6Backends` and `decideSessionHealth` take an explicit `observerPid`. The observer is never judged, never reported and is NEVER a termination target. The **INSPECTED** set is now `{ setup, a, b }` -- the other three sessions the runner owns; the observer is the fourth. |
| C10-3 | The observer's identity is **fail-closed** | If the observer's own pid cannot be established, the audit cannot exclude the observer, so the verdict fails closed (`the observing session's identity could not be established`) rather than risking the observer being classified as a leak. |
| C10-4 | The preflight and the audit are **reconciled through one constant** | `MAX_T6_INSPECTED_BACKENDS = 3` is used by **both** the preflight's backend-count allowance and the audit's expected-session count, so the two checks can never drift apart. A source-level self-test asserts the preflight compares against that constant and never against a hard-coded number. |

**This correction has since been live-tested.** It was committed and pushed at
`84d9e145e852dc9046ffa02c75bbee067aab508d` and then **executed exactly once**,
returning **wrapper exit 0 / verdict PASS** (see the execution record below).

**Repository follow-ups - COMPLETE and offline-verified (2026-10-21):**
- `test-harness/t6-checkpoint/t6-checksums.txt` now pins `t6-local-runner.mjs`
  to `9f06b1c396e3634fc86eeab4d73878ce7345d7e7e5bffb0d1fea458d7f76b008`. All
  **15** manifest entries were re-verified against the repository artifacts
  (15 OK, 0 mismatch, 0 missing); the other 14 entries and their order are
  unchanged.
- `TASK.md`'s `t6-local-runner.mjs` acceptance criterion now names the same
  checksum and is **ticked**, with the evidence that satisfies it recorded
  alongside.
- The preparation copy at `%TEMP%\opencode\t6-prep\t6-local-runner.mjs` was
  refreshed to the C10 revision (byte-identical to the committed file) before
  the run.

**Remaining gates (each needs its own approval and its own target):**
- Group-R (`T6-R01`-`T6-R08`): TEST Supabase, two concurrent psql sessions,
  **ZERO-COMMIT rollback-only**. Not executed.
- **Group-R update (2026-10-22):** the harness is **implemented, committed and
  pushed** (`a11a118`→`1535f9a`; see the "Group-R harness (2026-10-21/22)"
  subsection below) and remains **NOT EXECUTED**. Three preflight-only
  rehearsals against TEST `nqadtfqyurkpmxcodswc` were **BLOCKED** (psql exit
  2/2/3, classification `unknown`), each with 8 BLOCKED / 0 executed and the
  fingerprint never computed. **Not PASS, not FAIL.**
- Group-C (`T6-C01`-`T6-C03`): TEST Supabase, committed synthetic fixtures +
  explicit cleanup + residue proof -- still **BLOCKED** pending separate
  operator approval. Not executed.
- R2 / object-storage and scheduler integration: separate pending gates; no
  R2, Cloudflare or Worker operation has been performed.
- Supabase TEST / production behaviour remains **NOT VERIFIED**.
- The candidate wrapper `t6-runner-candidate-v3.ps1` hardcodes **no** artifact
  checksum; it hashes the prep artifacts at run time, so the wrapper itself
  needs no change.

### Execution record (2026-10-21 ~10:06 IST) - the C10 runner was executed once and returned **PASS**

One launcher attempt occurred at approximately 10:06:44 IST
(`D:\SLMM-T6-EVIDENCE\launcher-20261021-100642-9c43b8d4\`), finishing at
10:07:07 IST (elapsed 23.5 s, child pid 10228). The GitHub baseline at
execution was `84d9e145e852dc9046ffa02c75bbee067aab508d`.

| # | Window (IST) | Outcome | Detail |
|---|---|---|---|
| P | C10 one-shot execution (2026-10-21 ~10:06 IST) | **PASS (wrapper exit 0, verdict PASS)** | The **third** run to reach the Group-L runner and the **first** in which the whole suite completed with every case passing. All nine native steps exited **0**: `initdb`, `pgctl_start`, `isready`, `identity`, `create_db`, `bootstrap`, `preflight`, `node`, `residue`. The verdict block records **zero** failure reasons. Server identity confirmed by the runner's own preflight: `{"preflight":"ok","database":"t6lab","port":15432,"server_addr":"127.0.0.1","isolation":"read committed","listen_addresses":"127.0.0.1","namespace_rows":0}`. **12 PASS, 0 FAIL, 0 BLOCKED, 0 NOT RUN** across T6-L01..T6-L11 incl. `L08a` and `L08b`, each present exactly once with no duplicates; runner summary `{"total":12,"pass":12,"fail":0,"blocked":0,"not_run":0,"harness_failed":false,"residue_failed":false}`. The results digest `3489610fbf2105868c8aa2ab6bd60681ac0788446a816980c5cbfd424b187b0c` was verified three ways (independent recalculation of the evidence copy, the verdict's `runner_sha256`, and the run's `artifact-sha256` manifest), and additionally re-derived from the JSONL content alone. Residue `{"synthetic_rows":0,"other_t6_backends":0,"t6_advisory_locks":0}` -- clean, and `other_t6_backends: 0` is the runtime confirmation that the reusable A/B sessions were no longer misclassified as leaks. Teardown **proved ownership before acting** (`marker valid, postmaster.pid in our data dir, port 15432, postgres.exe naming our data dir`), stopped with `pg_ctl stop -m fast`, confirmed no live cluster of ours used the laboratory, and only then removed the lab tree. Post-run `port15432_listeners=0`, `t6lab_exists=False`; the port-5432 service was untouched (`Running`, 2 listeners, 10 `postgres.exe`, pid 5148 -- identical to the pre-run baseline) and no `postgres.exe` had the lab data directory in its command line. PostgreSQL defaults unchanged. Evidence: `D:\SLMM-T6-EVIDENCE\t6-run-20261021-100645-9d2f02f9\` (run log, node log, results JSONL, verdict JSON, artifact checksums) and `D:\SLMM-T6-EVIDENCE\launcher-20261021-100642-9c43b8d4\` (stdout, stderr, exit code, timestamps, child pid, preflight/postrun state, process snapshot, launcher script). |

**The executed wrapper was the approved candidate v3**
(`test-harness/t6-checkpoint/t6-runner-candidate-v3.ps1`, SHA-256
`30e31c1d2c1f14f04bdff78cfd42fa466cb613efa923f099157a347a649ba97c`), invoked
with `-Confirm I_APPROVE_LOCAL_T6 -EvidenceRoot D:\SLMM-T6-EVIDENCE`. The
**original recovered `t6-runner.ps1`** (`fac7926d...`) was **never** copied to the
preparation directory and was **never executed**; it remains a preserved artifact
only, and its own checksum is unchanged.

**Scope of this PASS:** a **local disposable PostgreSQL 18 lab** result
(`127.0.0.1:15432`, database `t6lab`). It proves the 12 Group-L concurrency
cases in that lab only. It does **not** prove any Supabase TEST or production
behaviour, and the **overall T6 program remains INCOMPLETE** (the matrix
defines 23 cases; 8 R-cases and 3 C-cases are unexecuted). The earlier **FAIL**
outcomes recorded in the sections below are retained as history and are **not**
relabelled.

### Group-R harness (2026-10-21/22) — DELIVERED, COMMITTED, PUSHED; **NOT EXECUTED**

Eight commits `a11a118` → `1535f9a` delivered the hosted Group-R harness.
`git diff --shortstat a11a118^..1535f9a` = **4 files changed, 7,009
insertions(+), 0 deletions**. Each hash below was recomputed from the working
tree on 2026-10-22.

| # | File | Bytes | **Total lines** | SHA-256 |
|---|---|---|---|---|
| 1 | `test-harness/t6-checkpoint/t6-group-r-runner.mjs` | 121,465 | **2,772** | `b4184ac78e32c19d5496f2afaa4625662b55c9c4d8a2ed167bb76755075665cd` |
| 2 | `test-harness/t6-checkpoint/t6-group-r-runner-tests.mjs` | 157,505 | **3,194** | `df811af43924efb2d3facb9edba01a1fd6b0e7df00eaf543dcdc72e38fb23af8` |
| 3 | `test-harness/t6-checkpoint/t6-group-r-harness.sql` | 51,860 | **1,035** | `6de5323d87b8c7a104365393bfc0fa5c9af98482a0701465a122ef704276507e` |
| 4 | `test-harness/harness-registry.mjs` (modified, **+8 lines**) | 4,816 | 98 | `c0fc498a586f03f21af138eee7efdd5695d3a61aa3964dfb83ed85d2b8c47c7a` |

- **Line counts are total** lines including blanks — they are **not** the
  non-blank counts (2,591 / 2,971 / 963) quoted in some earlier summaries. They
  sum to 7,001, and +8 registry lines gives the +7,009 total.
- **Registry:** the runner is registered in `LIVE_HARNESSES` (`services:
  ["supabase-test-postgres"]`) and the SQL in `LIVE_SQL_HARNESSES`. **Neither is
  referenced by any npm script.** A Node run first passes through
  `test-harness/live-guard.mjs` (`requireLiveAuthorization`,
  `assertNonProductionTarget`), which refuses an unauthorized run and any target
  that is not the TEST project (production is always refused). The **port**
  guards live in the runner itself: `TRANSACTION_POOLER_PORT = 6543` (no session
  semantics) and `LOCAL_LAB_PORT = 15432` (the disposable local lab) are both
  refused, per `t6-group-r-runner.mjs` lines 108-109 and 314.
- **Case matrix:** the eight `env: "R"` rows (`T6-R01`–`T6-R08`) in
  `t6-case-matrix.json` **predate this delivery** — the matrix was last changed
  at `ed5e212` and its blob is byte-identical at HEAD — so they define the
  Group-R cases but are **not** part of the +7,009.
- **Status: NOT EXECUTED.** `T6-R01`–`T6-R08` have **never run**.

**Preflight-only rehearsals — three attempts, all BLOCKED (explicitly not
PASS).** Each manifest's `evidenceSha256` was recomputed on 2026-10-22 and
**matches** its `t6-group-r-results.jsonl`:

| # | runId (UTC) | Bundle | psql exit | Evidence SHA-256 (verified) |
|---|---|---|---|---|
| 1 | `2026-10-21T17:12:52.849Z` | `D:\SLMM-T6-EVIDENCE\t6-group-r-preflight-20261021-224201\` | `2` | `160bce1ff6f76f89fc14f106175144a0e74b62a9ba395fdc917c7cb4a3348646` |
| 2 | `2026-10-22T04:12:29.623Z` | `D:\SLMM-T6-EVIDENCE\t6-group-r-preflight-20261022-094207\` | `2` | `ba9115919e20e72ab18da22da028eff4372e09961ccb561270043049116bbe94` |
| 3 | `2026-10-22T04:40:28.669Z` | `D:\SLMM-T6-EVIDENCE\t6-group-r-preflight-20261022-101004\` | `3` | `efe58ce2c6f0de1c7daee4a3b39a357b73830a05de9ac982e77920b206ceb24d` |

- **Outcome, identical in all three:** `caseOutcomes` **PASS 0 / FAIL 0 /
  BLOCKED 8 / NOT RUN 0** (all 8 records `verdict: "BLOCKED"` for
  `T6-R01`–`T6-R08`); `preflight.ok: false`; `residueGate: "NOT RUN"`;
  `statementsIssued: 1`; `forbiddenStatements: 0`.
- **Reason:** `the preflight session failed: pf: psql exited (2)` (attempt 1, no
  classifier); `pf: psql exited (2) (unknown)` (attempt 2);
  `pf: psql exited (3) (unknown)` (attempt 3). Attempts 2 and 3 therefore
  classify the failure as **`unknown`**; attempt 1 records no classifier, and the
  cause is **unresolved** in all three.
- **Fingerprint never validated:** contract `t6-group-r-fingerprint/v2`,
  `expected a85fea6468487830a4ca9afc268d9aef`, `computed: null`,
  `functionCount: null`, `serverVersion: null`, `baselineServerVersion: 17.11`.
- **Credentials:** `credentialSource: "operator-variable"`,
  `ambientPasswordIgnored: false`; no production target was contacted.
- **Build attribution is inferred, not evidenced:** the manifests record the
  harness path and `runId` but **no runner commit and no runner SHA-256**, so
  attribution to `67109f4` / `18c2406` / `d2a34e3` rests on the timestamps alone.
- **Runner unit tests: `169/169` reported — UNVERIFIED.** 169 is a static
  top-level `test()` count in the runner-tests file (0 `describe`, 0 skip/todo).
  **No execution artifact** (TAP, log or report) exists in the repository or
  under `D:\SLMM-T6-EVIDENCE`, so no pass is claimed.

**Evidence gaps recorded for these artifacts (not fixed here):**
`test-harness/t6-checkpoint/t6-checksums.txt` still holds **15** entries and
**does not pin** any of the three Group-R files, `t6-runner-candidate-v3.ps1`
(the wrapper that produced the Group-L PASS) or `t6-runner-candidate-v2.ps1`;
and `t6-deadlock-repro.ps1` and `t6-runner-candidate-v2.ps1` are documented but
remain **untracked** in Git.

### Execution record (2026-10-20) - candidate v3 was executed once and returned FAIL

One launcher attempt occurred at 22:28:34 IST
(`D:\SLMM-T6-EVIDENCE\launcher-20261020-222834-2248bb69\`).

| # | Window (IST) | Outcome | Detail |
|---|---|---|---|
| P | Candidate v3 one-shot execution (2026-10-20 22:28 IST) | **FAIL (wrapper exit 1)** | The approved invocation passed `-Confirm I_APPROVE_LOCAL_T6 -EvidenceRoot D:\SLMM-T6-EVIDENCE`. The whole main path ran in 42 s. `initdb`, `pg_ctl start`, `pg_isready`, identity, `CREATE DATABASE t6lab`, bootstrap, preflight and residue all exited **0**; only `node` exited **1**. The verdict is **FAIL**. Evidence: `D:\SLMM-T6-EVIDENCE\t6-run-20261020-222837-8ec45d7e\` (run log, node log, results jsonl, verdict.json, artifact-sha256.txt). The results digest `d9cdd1c82ec859ef7600306702d7b5604ce42ec9403bff9780d35602cd9058c8` matches the evidence copy byte-for-byte; the residue verdict is `{"synthetic_rows":0,"other_t6_backends":0,"t6_advisory_locks":0}`. Teardown proved ownership before stopping. Post-run: `port15432_listeners=0`, `t6lab_exists=False`; the port-5432 service was untouched (`Running`, 2 listeners, 10 `postgres.exe`). |

### Execution record (2026-10-20) — candidate v1 was executed and returned BLOCKED

Two launcher attempts occurred.

| # | Window (IST) | Outcome | Detail |
|---|---|---|---|
| 1 | 11:15 – 11:33 | **INTERRUPTED** | The agent-side waiting parent was killed by a harness tool-call abort during the `pg_ctl start` step. The wrapper died, the disposable postmaster was orphaned, and it later failed with the Windows `0xC0000142` (`STATUS_DLL_INIT_FAILED`) fault in the autovacuum worker and the startup process at 11:33:21. |
| 2 | 11:38 – 12:13 | **EXIT CODE 2 (BLOCKED)** | Detached launcher, so an agent-side interrupt could not kill the run. **PostgreSQL started correctly** on `127.0.0.1:15432` and **survived its first 5-minute checkpoint (11:58:03) with no fault — no `0xC0000142` in this attempt.** The wrapper then blocked inside `Invoke-Native` for 20 minutes (0% CPU, no children) until the disposable cluster was stopped, and failed closed with `T6 BLOCKED: cluster did not become ready on port 15432 (pg_isready exit 2)` and exit code 2. Its own teardown removed `%TEMP%\opencode\t6lab`. |

**All 12 Group-L cases remained NOT RUN in this attempt.** No `t6-lab-results.jsonl`, no node
log and no verdict file were ever produced, and no case is labelled PASS. The
port-5432 service was never touched (PID 4828, unchanged start time and
listeners).

Durable evidence: `D:\SLMM-T6-EVIDENCE\launcher-20261020-111559-41599433\`
(attempt 1) and `D:\SLMM-T6-EVIDENCE\launcher-20261020-113741-b4d0aac5\`
(attempt 2: `stdout.log`, `exitcode.txt` = `exitcode=2`, `finished.txt`,
`preflight-state.txt`, `postrun-state.txt`, `lab-pg.log.PRE-INTERVENTION`,
`candidate-run-log.WEDGED.log`, `process-snapshot.WEDGED.txt`), plus the two
candidate evidence directories `t6-run-20261020-111611-35af3ca5` and
`t6-run-20261020-115251-73f019ca` under `D:\SLMM-T6-EVIDENCE\`.

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
  - **Correction (2026-10-22):** the paragraph above was true on 2026-10-20 and
    is **superseded**. Recovered-artifact safety verification was completed, and
    approved candidates were subsequently executed: the C10 runner returned
    **PASS 12/12** in a **local disposable PostgreSQL 18 lab** on 2026-10-21 at
    approximately 10:06 IST (see the execution record in §1). **T6 is ACTIVE /
    INCOMPLETE, not BLOCKED** — Group-L is **closed**; Group-R is **implemented
    but NOT EXECUTED** (`T6-R01`–`T6-R08` NOT RUN; three preflight-only
    rehearsals BLOCKED); Group-C, R2 and scheduler integration remain separate
    pending gates. **Hosted Supabase TEST and production behaviour remain NOT
    VERIFIED.**
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
