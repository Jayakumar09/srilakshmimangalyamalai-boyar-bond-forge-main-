# T6 Evidence Index

Date: 2026-10-28
Base: c4d16eeff9f807a44290e2ee127971dfa6a76fe4

| Test | Status | Exit | Evidence Dir | Notes |
|------|--------|------|--------------|-------|
| A3 (latest) | PASS | - | D:\SLMM-T6-EVIDENCE\t6-a3-pid-generation-20261027-215140-5ac3ea9d | 15/15 |
| S5 | PASS | - | D:\SLMM-T6-EVIDENCE\s5-pid-generation-20261027-101209-7ca7ea4a | targeted |
| S8b | PASS | - | D:\SLMM-T6-EVIDENCE\s8b-pid-generation-20261027-101810-4988b22d | targeted |
| A4 | FAIL | 1 | D:\SLMM-T6-EVIDENCE\offline-20261027-095423-94bcd08f; D:\SLMM-T6-EVIDENCE\t6-a4-runner-20261027-095419-837c2e9d | vector1 734/734 PASS; vectors 2/3 NOT RUN |
| S14 | NOT VALIDATED | - | D:\SLMM-T6-EVIDENCE\s14-selftest-20261028-111519 | exact source SHA 5FF7C4BF... not recoverable |
| Group-R R01–R08 | NOT RUN | - | - | hosted |

Hashes recorded in CHECKPOINT_INDEX.md

## 2026-10-28 addition: external S14 resolver regression

- **PASS (limited resolver scope)**, one isolated PowerShell 5.1 process, exit 0.
- Evidence: `D:\SLMM-T6-EVIDENCE\s14-resolver-runtime-20261028-181225-cdb82edd`.
- Checkpoint: `test-harness/t6-checkpoint/s14-resolver-regression/`; original and
  copied harness SHA-256:
  `D058E747160FF8178F42CD64F424C486BEEB0CBA03D3C2597D83FECD81DA99FD`.
- **NOT COVERED:** existing-live-generation protection, alive/gone/unknown
  identity scenarios, genuine survivor detection, unknown-not-confirmed-absence,
  and full capture integration. The original S14 row above remains NOT VALIDATED.
- No runtime repeated for this checkpoint. Dependency hashes and seven-extract
  source integrity are recorded in the checkpoint's `checkpoint-manifest.json`.
