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
