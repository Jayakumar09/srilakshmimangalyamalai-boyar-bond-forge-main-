# T6 Recovery Instructions

- Use checkpoint/t6-offline-evidence branch for recovery.
- Base commit: c4d16eeff9f807a44290e2ee127971dfa6a76fe4
- Current validated script: test-harness/t6-checkpoint/offline-evidence-capture.ps1 (SHA 9E780D5E...)
- S14: NOT recoverable as exact file; do not assume. Requires reconstruction with approval.
- Evidence under D:\SLMM-T6-EVIDENCE (external; not copied blindly).
- Preserve working tree; no destructive git operations.
- Follow permanent rules (checkpoint before risky edits, verify hashes, commit/push to checkpoint branch).
