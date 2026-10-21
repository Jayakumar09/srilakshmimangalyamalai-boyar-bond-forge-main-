# SQL harness recovery — 21 October 2026

Scope: user-approved recovery of six originals and classification of five existing T3/T4 SQL harnesses only.
Baseline HEAD: 61cc1a4efe420f432f229c427cab6966a451007f.
Source archive: SLMM_ASTRA_AUDIT_20261021(1).zip.
Archive SHA-256: 5c93902f4d05217ae77294f8b121938d1f6eb7b490bfb67620de36b72f53f96e.

## Exact recovery verification

Each destination was absent before recovery. Files were written as raw bytes,
without decoding or newline normalization, then independently hashed from disk.

| Recovered file (under test-harness/) | Bytes | Snapshot and destination SHA-256 | Result |
|---|---:|---|---|
| admin-aadhaar-verification.sql | 12003 | `14cdeb1307111844ea50273771f4f2076e74a323f98140415afcc171cb356915` | MATCH |
| admin-driving-licence-verification.sql | 13118 | `aebf666c88a45754786a3a5538d00e6f46d2f21256cbef1b61a629918c5a072b` | MATCH |
| admin-pan-verification.sql | 12785 | `12a2cc339270fe3b5f9c2a88d782a5e9e8d273f40e045c95a82b63746ccf7171` | MATCH |
| admin-passport-verification.sql | 12946 | `73df82ddbfaef78ed405214f9f81c61865f9f90596732de15cce7cc0342d310d` | MATCH |
| admin-voter-id-verification.sql | 12901 | `14e51a4e6d45bb1db997e694dc7742edecddd8825bdef40e7ff41bbec3b0c124` | MATCH |
| elite-eligibility-verification.sql | 42003 | `b1d06edd75f2e3a6a0fe7c47d3d3528fb6e167eeca47bce2a9ebde97339492ea` | MATCH |

## Registry change

Added only these entries to LIVE_SQL_HARNESSES in test-harness/harness-registry.mjs:

- slmm-storage-deletion-t3-live-test.sql
- slmm-storage-deletion-t3-residue.sql
- slmm-storage-deletion-t4-cli-session.sql
- slmm-storage-deletion-t4-live-test.sql
- slmm-storage-deletion-t4-residue.sql

The five SQL files themselves are byte-identical to their pre-operation copies.
OFFLINE_SUITES and all assertions are unchanged. The six recovered names were
already registered as live SQL harnesses; no duplicate entries were added.

## Validation

`node --test --test-reporter=tap test-harness/slmm-harness-safety-tests.mjs`
returned exit 0: 17 tests, 17 PASS, 0 FAIL, 0 skipped, 0 cancelled.
This is offline harness-safety validation, not SQL execution or database verification.

`git diff --check`: PASS (exit 0). This checks tracked diffs; recovered
untracked originals were verified byte-for-byte, without reformatting.

A pre/post SHA-256 comparison of every pre-existing tracked file found only
harness-registry.mjs changed in this operation. Earlier edits to the runner,
handover, task index and session history were preserved, not included in this task.

Changed-file allowlist: six recovered SQL files, harness-registry.mjs,
this report, and BUSINESS_RULE_REVIEW_AADHAAR_PASSPORT.md.

No SQL, live harness, build, database operation, credential access, infrastructure
change, UI/business-logic edit, commit, push or deployment performed.
The full offline suite was not rerun; unrelated failures remain unresolved.
Stop after validation for user review.

## Git checkpoint preparation — 21 October 2026

The user subsequently authorized checkpointing successful work to GitHub.
After staging the recovered originals, `git diff --cached --check` returns 2:
pre-existing trailing whitespace in the byte-exact SQL originals is now visible.
The earlier unstaged PASS did not inspect these then-untracked files. No original
is reformatted: preserving exact snapshot contents takes precedence. The registry
and documentation diff pass their scoped whitespace check. SQL semantics and all
assertions are unchanged; the 17/17 safety result remains the validation basis.
