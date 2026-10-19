# T5 Checkpoint (Read-Only Reconstruction)

This directory contains documentation-only T5 artifacts reconstructed from migration evidence at checkpoint `1ba4351`. Historical T5 results (89/89) are known only from prior reports; original artifacts are unavailable.

**Constraints (non-negotiable):** TEST ONLY (`nqadtfqyurkpmxcodswc`). `REPEATABLE READ`, synthetic IDs, mandatory `ROLLBACK`, separate read-only residue. No production access. No executable SQL provided in this documentation step.

## Files (documentation only)
- `README.md` — scope, constraints, usage notes
- `t5-case-matrix.json` — machine-readable 49-case matrix, pins, 6 runtime verification groups, unresolved dependencies (marked PENDING REVIEW)

## Usage notes
- Distinguish historical (89/89, lost) from fresh validation. Do not report historical as rerun.
- If proceeding to live TEST later (requires separate approval), use project guard `slmm.t5.target_project='nqadtfqyurkpmxcodswc'`, rollback-only, separate residue READ ONLY.
- Registry not modified by this step; any future executable SQL must be classified (fail-closed).
- No staging/commit/push performed as part of this documentation step.