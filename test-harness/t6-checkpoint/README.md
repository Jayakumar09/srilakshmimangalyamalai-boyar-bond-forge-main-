# T6 Checkpoint (Recovered Source Artifacts)

Source artifacts for the **T6 Group-L concurrency runner** and its disposable
**local PostgreSQL 18** laboratory, recovered from OpenCode session history
after the original ephemeral copies in `%TEMP%\opencode\t6-prep` were lost
(host reboot + TEMP cleanup on 2026-10-20).

This directory is a **permanent, repository-resident** copy so these artifacts
cannot disappear again. It is a **recovery**, not an execution record.

**Constraints (non-negotiable):** LOCAL loopback PostgreSQL 18 only
(`127.0.0.1:15432`, database `t6lab`). Never connect to the PostgreSQL service
on port 5432. Never connect to Supabase TEST (`nqadtfqyurkpmxcodswc`) or
production (`sxpkutjkqfekqwpabgrk`). No R2, Cloudflare, Worker or deployment
access. No production access. Not connected to Lovable.

## Status

- **T6 is BLOCKED.** Recovering the files is not an approval to run them.
- **No verified Group-L concurrency case results exist.** No case has ever been
  executed to completion; there is no PASS to report.
- The recovered `t6-runner.ps1` is the **approved** revision
  (`fac7926d…894c`), **not** the later unapproved `abd83227…c6701b` variant
  that was on disk at the time of the loss.
- Before any execution, the artifacts must be re-verified against
  `t6-checksums.txt` and re-approved in a separate, explicit approval step.

> **Correction - 2026-10-22 (supersedes the "Status" bullets above; the original
> text is retained as history):**
>
> - **Group-L local concurrency is VERIFIED PASS 12/12** (2026-10-21 10:06 IST,
>   wrapper exit 0, `T6-L01`-`T6-L11` including `L08a`/`L08b`, zero residue;
>   evidence `D:\SLMM-T6-EVIDENCE\t6-run-20261021-100645-9d2f02f9\`, recorded as
>   `TEST_EVIDENCE.md` E-010). **Local lab only** - it does not verify any
>   Supabase TEST or production behaviour.
> - **T6 is ACTIVE / INCOMPLETE, not BLOCKED.** Group-R (`T6-R01`–`T6-R08`) is
>   implemented, but all three preflight-only rehearsals were **BLOCKED** (never
>   PASS, never FAIL). **`T6-R01`–`T6-R08` remain NOT RUN.** Group-C, R2 and
>   scheduler gates remain separate pending gates.
> - **`t6-checksums.txt` pins recovered *and* later verified artifacts** - the
>   original recovered set plus the three Group-R files and
>   `t6-runner-candidate-v3.ps1` (19 entries). **A checksum records byte identity
>   only - never execution, approval or PASS.**
> - This directory remains **not an execution record**, and nothing in it is
>   approved to run.

## Files

| File | Purpose | Status |
|---|---|---|
| `t6-local-runner.mjs` | Node Group-L case runner (12 Group-L cases) | recovered, byte-exact |
| `t6-runner.ps1` | PowerShell orchestrator (cluster provision, preflight, run, residue, teardown) | recovered, byte-exact, **approved revision** |
| `t6-case-matrix.json` | Machine-readable case matrix (23 cases: 12 Group-L, 8 R, 3 C) | recovered, byte-exact |
| `t6-lab-setup.sql` | Disposable lab bootstrap schema + migrations | recovered, byte-exact |
| `t6-preflight-lab.sql` | Preflight assertions (port, RC isolation, namespace) | recovered, byte-exact |
| `t6-lab-residue.sql` | Residue verification | recovered, byte-exact |
| `t6-sync.sql` | Sync step | recovered, byte-exact |
| `slmm-storage-deletion-t6-residue.sql` | Storage-deletion residue check | recovered, byte-exact |
| `T6_PREPARATION_PLAN.md` | Design record | recovered, byte-exact |
| `T6_LAB_DESIGN.md` | Design record | recovered, byte-exact |
| `T6_LAB_IMPLEMENTATION_PLAN.md` | Design record | recovered, byte-exact |
| `t6-checksums.txt` | SHA-256 of every recovered file | generated at recovery |
| `evidence/` | Transcript evidence from the 2026-10-19 attempted startups | transcript, see notes |

## Usage notes

- These files are **not** run from this directory. The orchestrator resolves
  its preparation directory as `<TEMP>\opencode\t6-prep` and its laboratory
  root as `<TEMP>\opencode\t6lab`; a future run would copy (and re-verify) the
  files from here into that namespace, or be re-planned against a new
  namespace. **Do not run anything in this directory.**
- The runner's connection target is **non-overridable** (`127.0.0.1:15432`).
  The SQL files additionally raise an exception if `current_setting('port')`
  is not `15432`.
- Distinguish **historical** (attempted startups, no case results) from
  **fresh** validation. Never report the historical attempt as a pass.
- The case matrix's own rules apply unchanged: *"A case that was not executed
  is 'NOT RUN' — never PASS."*
- A local-lab pass, if ever obtained, would still **not** prove any Supabase
  TEST or production behaviour.

## Evidence notes

- `evidence/t6-lab-pg-log-transcript-2026-10-19.txt` — transcript of the
  disposable cluster's `pg.log` as read during the 2026-10-19 attempt. It
  records **two** clean startups on `127.0.0.1:15432` (22:58:42 and 23:08:13
  IST), each followed ~5–6 minutes later by a Windows `0xC0000142`
  (`STATUS_DLL_INIT_FAILED`) termination of the autovacuum/startup process.
  The original file was 3168 bytes; this reconstruction is stored at 3145
  bytes after LF line-ending normalization (it was 3172 bytes with CRLF
  terminators). The normalization changed only the line terminators, not the
  textual content, so the SHA-256 still **does not** match the lost original.
  It is a **transcript, not a byte-exact recovery**.
- `evidence/T6LAB_OWNER-transcript-2026-10-19.txt` — content of the run
  ownership marker (`slmm-t6-disposable-lab`, `run=3717dbce…`, `pid=5480`).
  Reconstructed at 111 bytes after LF line-ending normalization (it was 115
  bytes with CRLF terminators, which matched the observed original size). The
  normalization changed only the line terminators, not the textual content.
  The original's SHA-256 was never recorded, so it **cannot** be verified
  byte-exactly.
- Neither file proves any Group-L case result. No `t6-lab-run.log` and no
  `t6-lab-results.jsonl` was ever produced — the Node stage never ran.
