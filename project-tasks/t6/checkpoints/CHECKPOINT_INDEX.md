# T6 Checkpoint Index

Date: 2026-10-28
Repo: D:\DevProjects\Working\srilakshmimangalyamalai(boyar-bond-forge-main)
Branch: checkpoint/t6-offline-evidence
Base commit: c4d16eeff9f807a44290e2ee127971dfa6a76fe4
Remote: https://github.com/Jayakumar09/srilakshmimangalyamalai-boyar-bond-forge-main-.git

## Verified script
- test-harness/t6-checkpoint/offline-evidence-capture.ps1
  - SHA256: 9E780D5ED85DB30B2C7DFC0DDF23B7F6BCD60E7B3F40A1664C3B9F98962DF0D9 (validated current)
  - S14: NOT PRESENT / NOT VALIDATED

## Evidence (D:\SLMM-T6-EVIDENCE)
- t6-a3-pid-generation-20261027-215140-5ac3ea9d: A3 latest (15/15 PASS per history)
- s5-pid-generation-20261027-101209-7ca7ea4a: S5 PASS
- s8b-pid-generation-20261027-101810-4988b22d: S8b PASS
- offline-20261027-095423-94bcd08f + t6-a4-runner-20261027-095419-837c2e9d: A4 first FAIL (exit 1), offline suites 734/734 PASS; vectors 2/3 NOT RUN
- s14-selftest-20261028-111519: S14 attempted runs (script SHA 5FF7C4BF... at first run per metadata; later edited; final cleaned to 9E780D5E...). S14 exact source (5FF7C4BF...) NOT RECOVERABLE from inspected locations.

## Pending
- S14: exact source unavailable; requires separate approval to reconstruct
- A4 vectors 2/3: NOT RUN
- Hosted Group-R R01–R08: NOT RUN

## Notes
- No files staged/committed in this operation. Working tree preserved.
- Evidence directories not copied blindly; indexed by reference.

## 2026-10-28: isolated S14 resolver regression checkpoint

- Directory: `test-harness/t6-checkpoint/s14-resolver-regression/`.
- Exact tested harness SHA-256:
  `D058E747160FF8178F42CD64F424C486BEEB0CBA03D3C2597D83FECD81DA99FD`.
- Runtime: one isolated PowerShell 5.1 process, exit **0**, limited resolver
  regression **PASS**. Evidence:
  `D:\SLMM-T6-EVIDENCE\s14-resolver-runtime-20261028-181225-cdb82edd`.
- Three exact required function extracts and a hash/provenance manifest accompany
  the unchanged harness. All seven original extracts match validated source AST
  bytes. The README documents the required external `D:` dependency layout.
- **NOT COVERED:** live-generation protection; alive/gone/unknown identity
  scenarios; genuine survivors; unknown-not-confirmed-absence; full capture
  integration. This does **not** validate the original lost S14 self-test above.
- Checkpoint source baseline: `736e5e893a02f4f5008bf9dbc269b10f4bc84c30`.
  Protected capture script unchanged. No runtime rerun for checkpoint creation.

## 2026-10-28: synthetic S14 identity-safety companion checkpoint

- Directory: `test-harness/t6-checkpoint/s14-identity-safety/`.
- Exact tested companion SHA-256:
  `202D50A03DD6B796F14367FD6B233591948878466D13C1A0DFC002C4CD461170`.
- One invocation of this corrected hash: exit 0, **166/166 assertions PASS**,
  four fixtures PASS, zero fixture faults and unintended ReuseSink events.
- Evidence: `D:\SLMM-T6-EVIDENCE\s14-identity-safety-runtime-20261028-201524-d5579ec7`.
- Eight unchanged production function definitions are imported selectively from
  the already tracked, hash-pinned capture source; no full entry point runs.
  Exact call counts and 80 initial/final binding checks passed. Typed snapshot
  bookkeeping completed successfully. No runtime repeated for checkpointing.
- **PASS at synthetic function level:** alive/no false reuse, gone, unknown and
  conservative retention, both missing-creation fallbacks, exact-generation
  survivor selection. Earlier NOT COVERED entries describe the earlier harness's
  scope and remain historical; this result does not prove real OS survival.
- **NOT COVERED:** real Windows process survival/PID reuse, real CIM, descendant
  discovery, grace timing, full capture/A4 integration, corrupted snapshot-map
  rejection paths. Original lost S14 recovery remains separate.
- Source baseline: `1f7e5d1db982e21e8ed262953eb1d72ff4c57faf`. Protected source and
  successful resolver-regression checkpoint unchanged. See companion README and
  checkpoint-manifest.json for reproducibility, dependency and integrity details.
