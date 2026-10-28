# T6 Pending Tasks

- [ ] Recover/reconstruct S14 (separate approval) - exact source SHA 5FF7C4BF... unavailable
- [ ] Complete A4 vectors 2 and 3
- [ ] Run hosted Group-R R01–R08 (separate approval)
- [ ] Verify full reproducibility of checkpoint artifacts
- [ ] Consider adding script to tracking if needed (currently untracked) with review

## S14 resolver-only checkpoint (2026-10-28)

- [x] Preserve exact tested external resolver harness, its three required
  dependencies, provenance hashes and reproducibility instructions under
  `test-harness/t6-checkpoint/s14-resolver-regression/`. Recorded isolated runtime:
  exit 0, limited resolver regression PASS; not complete S14 validation.
- [ ] Separately approve any coverage expansion: live-generation protection,
  alive/gone/unknown identities, genuine survivors, and unknown-not-confirmed-
  absence remain **NOT COVERED**. Full capture integration remains unverified.
- Original S14 recovery and other pending gates above are unchanged. Do not
  rerun or expand tests merely to create this checkpoint.

## S14 synthetic identity-safety companion (2026-10-28)

- [x] Verify the scoped companion: alive/no false reuse, gone, unknown and
  conservative retention, both missing-creation fallbacks, generation-specific
  survivor selection. One corrected-hash invocation, exit 0, 166/166 PASS.
- [x] Preserve the exact tested companion, source-dependency hashes and limited
  evidence under `test-harness/t6-checkpoint/s14-identity-safety/`.
- This closes only the synthetic function-level portion of the earlier coverage
  expansion item; it does not close original S14 recovery or full integration.
- [ ] Separately approve real Windows survival/PID-reuse/CIM validation,
  descendant discovery, grace timing and full capture/A4 integration.
- [ ] Separately approve any corrupted snapshot-map rejection scenarios.
- Do not rerun tests as part of checkpointing. Existing A4 and hosted gates above
  remain unchanged and require their own approvals.
