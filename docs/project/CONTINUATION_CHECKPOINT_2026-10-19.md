# CONTINUATION CHECKPOINT 2026-10-19 — T5 Live-Database Test Phase (Read-Only Reconstruction)

> **ENVIRONMENT:** TEST ONLY (`nqadtfqyurkpmxcodswc`). PRODUCTION access/changes forbidden.  
> **MODE:** Documentation-only recovery and reconstruction. Approved to create only 3 files; no executable SQL, no registry changes, no staging/commit/push.  
> **HONESTY:** Historical T5 offline results (89/89) are known only from prior reports; original artifacts are not present in this repository state. This document reconstructs scope from migration evidence and committed harness patterns — it does **not** claim to have rerun those 89 cases (historical, not newly executed).

## 1. Checkpoint identity
- Repository: `D:\DevProjects\Working\srilakshmimangalyamalai(boyar-bond-forge-main)`
- Branch: `main`
- HEAD: `1ba43516447704364aa37222659e782de15322ad` (checkpoint `1ba4351`) — verified
- Date: 2026-10-19
- Purpose: T5 live-database test phase for storage deletion lifecycle (Findings 4–5)

## 2. Repository state (preserved)
- Modified tracked: 42 (e.g. docs/project/*.md, src components/lib, vite.config.ts, one test-harness contract test)
- Untracked: 69 (temp artifacts, debug SQL, untracked migration files, untracked test harness SQL, assets, etc.)
- Staged/cached: 0
- No deletions staged; no files created/modified by this step

All pre-existing modified/untracked entries remain untouched.

## 3. Constraints (non-negotiable)
- TEST Supabase only: `nqadtfqyurkpmxcodswc`. Never target production.
- No DB passwords, JWTs, secrets or sensitive raw evidence recorded. No T5 execution, TEST DB writes, R2 ops, Cloudflare schedules, migrations applied, deploys, production access.
- Preserve `REPEATABLE READ`, exact synthetic-ID safety guards, mandatory `ROLLBACK`, separate read-only residue query.
- Historical T5 results labeled as historical; do not report them as rerun. Do not invent missing details.
- Fail-closed harness registry (no glob discovery). Any future new `.sql`/`.mjs` under test-harness would need classification (registry not modified by this step).
- No force-push/rebase/amend/squash of pushed history. No staging/commit/push.

## 4. Evidence sources (reviewed)
- Migrations: `supabase/migrations/20261017140000_storage_deletion_lifecycle.sql` (Finding 4), `20261017150000_storage_deletion_fence.sql` (Finding 5), `20261017130000_storage_reference_state.sql` (Finding 3), `20261017120000_document_storage_reference_state.sql` (Finding 2)
- T3/T4: `test-harness/slmm-storage-deletion-t3-live-test.sql`, `slmm-storage-deletion-t4-live-test.sql`, `slmm-storage-deletion-t4-cli-session.sql`, `slmm-storage-deletion-t3-residue.sql`, `slmm-storage-deletion-t4-residue.sql`
- Contracts/safety: `test-harness/slmm-storage-deletion-sql-contract-tests.mjs`, `slmm-storage-fence-sql-contract-tests.mjs`, `slmm-harness-safety-tests.mjs`, `harness-registry.mjs`
- Docs: `docs/project/TEST_VERIFICATION_LEDGER.md`, `PENDING_WORK.md`, `PROJECT_STATUS.md`, `SESSION_HISTORY.md`

## 5. Six-reference-source discrepancy (resolved)
Listed explicitly from migrations (exact tables/columns used):

1. `public.payments.proof_key` (Finding 3 line 41, Finding 4 line 211, Finding 5 line 203)
2. `public.jathagam_requests.report_key` (Finding 3 line 42, Finding 4 line 212, Finding 5 line 204)
3. `public.support_messages.attachment_key` (Finding 3 line 43, Finding 4 line 213, Finding 5 line 205)
4. `public.profiles.photo_url` (Finding 3 line 44, Finding 4 line 214, Finding 5 line 206)
5. `public.payment_events.receipt_key` (Finding 3 line 45, Finding 4 line 215, Finding 5 line 207)
6. `public.documents.storage_key` (+ `documents.id`, `documents.user_id` used in state/finalization; documents is the 6th logical source in the “document references” set; the protected set is the 5 non-document + documents treated separately in may_delete logic — see Finding 3/4/5)

All six are enforced in `get_storage_reference_state` (documents via Finding 2), `check_storage_deletion_references`, and fence recheck/triggers. No additional sources found.

## 6. Harness-registry issue (existing, not modified)
`slmm-harness-safety-tests.mjs` asserts: every `.mjs` and every `.sql` harness is classified in `harness-registry.mjs` (fail-closed). Current state: 16/17 pass, 1 fail — “every test-harness .sql harness is classified” because `slmm-storage-deletion-t3-live-test.sql`, `slmm-storage-deletion-t4-live-test.sql`, `slmm-storage-deletion-t4-cli-session.sql`, `slmm-storage-deletion-t3-residue.sql`, `slmm-storage-deletion-t4-residue.sql` (and others) are not listed in `LIVE_SQL_HARNESSES`. This is a pre-existing condition of committed files; registry remains **unmodified** by this documentation-only step.

## 7. Migration-derived vs fresh TEST-installed evidence
- Migration-derived (static source of truth): function bodies, constraints, grants, triggers, table definitions — read from committed migration files. These define expected behavior.
- Fresh TEST-installed (runtime): actual installed bodies/ACLs/triggers on TEST DB — must be verified via live SQL against `nqadtfqyurkpmxcodswc` (not performed). Pin checks in T3/T4 compare installed prosrc (CRLF→LF) to anchors; same method applies to T5.
- Historical artifacts: previous T5 89/89 offline result exists only as a report; original files/continuation docs are unavailable. No attempt made to reconstruct those files; scope reconstructed from migrations/harnesses.

## 8. Function-body MD5 pins (CRLF→LF normalized)
T3 anchors (verified match against migration text via same method):
- `claim_storage_deletion_request(uuid)`: `ca2d313afeab415ee946dbe6937b7d8b` ✓
- `claim_storage_deletion_requests(integer)`: `367b363648b8fd457fc37adbfad7ac35` ✓

T5 pins (computed from `20261017140000_storage_deletion_lifecycle.sql`):
- `request_storage_deletion(text)`: `901ca9300b271f352a7b363f37e51dcb`
- `cancel_storage_deletion(uuid)`: `c2e48b0f107ac242e191c9bdd2386133`
- `record_storage_deletion_failure(uuid,uuid,text,integer)`: `12a965130212b9698995b4b9f81036f0`
- `check_storage_deletion_references(text)`: `cf3285a4bfc7ba3bbf39125f4a3ef923`
- `block_storage_deletion(uuid,uuid,text)`: `c2f7bddfdcaf151b77def518a00f9fb7`
- `set_r2_confirmed_absent(uuid,uuid)`: `5a63fbd22c45a30be3873192ea7ba623`
- `finalize_storage_deletion(uuid,uuid)`: `b94615e59b820ca251eecd676da95c82`
- `mark_storage_deletion_quota_resynced(uuid)`: `65b6302eb1e8034d2ae78c504525af75`
- `list_storage_deletion_quota_resyncs(integer)`: `693ebf9c15509a5c6c859b69b22724a2`

## 9. Six required runtime-verification groups
1. **Cooldown/blocked timing** — 15m failed cooldown on creation (shared advisory lock with failure); 1h blocked cooldown before reclaim; creation uses per-key advisory xact lock.  
2. **Lease lifecycle + CAS** — 5m lease expiry; lease_token required when leased; CAS on (lease_token, lease_expires_at>now) for all transitions; expired leases reclaimable.  
3. **Reference predicate identity** — 6-source list identical across `check_storage_deletion_references`, fence recheck, and all checks (no drift).  
4. **Finalization safety** — DELETE only captured `document_row_ids` with matching `storage_key`; existence check after DELETE (not strict row-count); abort transaction if any captured still references key; fail-closed.  
5. **Fence semantics** — `fence_storage_key_for_deletion` returns `fenced|blocked_protected_reference|blocked_document_set_changed|not_claimed`; BEFORE triggers on all 6 tables use advisory lock; fence permanent (no DELETE).  
6. **Auth/ACL + hardening** — service_role-only for worker RPCs except request/cancel (authenticated); `SET search_path=pg_catalog,pg_temp`; `SET row_security=off`; `OWNER TO postgres`; trusted-owner visibility + effective DELETE checks on required tables.

## 10. Reconstructed 49-case matrix (with expected behavior, setup, assertions, unresolved)
Owner namespace for T5: `f3b42871-9f60-4d7a-bd70-7c62f13ab3f0` (distinct from T3/T4). All synthetic; rollback-only.

### Group A: Creation + cooldowns (7) — PENDING REVIEW: live window timing
A1 create-ok: no live, no failed<15m → request created (returns id), live-key index blocks dup; assert idempotent reuse path  
A2 reuse-live: existing live exists → returns existing live id (ON CONFLICT/idempotent)  
A3 cooldown-block: failed<15m exists → exception (recent attempt failed; try later)  
A4 cooldown-expired: failed>15m exists → allowed (subject to checks)  
A5 blocked-protected: has_protected_references true → blocked  
A6 blocked-maydelete: may_delete_document_references false → blocked  
A7 snapshot-docids: captures current document_row_ids only (finalization uses snapshot)

### Group B: Claims (single+batch) (8) — PENDING REVIEW: batch order stability
B1 claim-pending→deleting: increments attempt_count (r2 not confirmed), sets lease, status deleting  
B2 claim-pending-confirmed→finalizing: attempt_count unchanged, status finalizing  
B3 claim-active-lease: returns 0, row unchanged  
B4 batch-limit<=0: 0  
B5 batch-oldest-N: returns oldest eligible by created_at (order in result not required to equal input; shared batch token)  
B6 blocked<1h: not claimable  
B7 blocked>=1h: reclaimable if lease expired  
B8 expired-lease: reclaimable

### Group C: Block/fail/confirm (12) — PENDING REVIEW: exact clipping semantics
C1 block-ok: sets blocked, clears lease, clips reason<=200, attempts preserved; returns true  
C2 block-replay: false, unchanged  
C3 block-confirmed: rejected (r2_state confirmed_absent) → false  
C4 fail-below-max: status pending, r2_state uncertain, lease cleared, error clipped<=500, attempt_count not incremented by failure op  
C5 fail>=max/clamp: becomes failed (GREATEST(p_max_attempts,1) semantics; clamp zero/negative to 1)  
C6 fail-replay: returns SQL NULL  
C7 fail-confirmed: rejected → NULL  
C8 confirm-ok: confirmed_absent, finalizing, last_error cleared, preserves attempts/lease context as per CAS  
C9 confirm-replay: true under same live lease  
C10 stale-expired: CAS fails (token/expiry)  
C11 null-token: all ops reject  
C12 wrong-token: all ops reject

### Group D: Finalization + safety (10) — PENDING REVIEW: existence-check fault injection not performed
D1 preconfirm-fail: returns false, docs unchanged  
D2 finalize-ok: deletes only captured ids with matching key; sets done/deleted; clears lease  
D3 finalize-replay: false, unchanged  
D4 selective: captured present deleted; captured moved-key survives; uncaptured same-key survives; missing captured id allowed (already absent)  
D5 stale-cannot: lease/token CAS blocks  
D6 done-protected: confirm/fail/block cannot mutate done state as appropriate  
D7 existence-check-abort: if any captured still references key after DELETE → transaction abort, request never marked done (test via controlled setup) — **PENDING REVIEW** (needs precise hook)  
D8 done-replay: false  
D9 missing-captured-ok: allowed  
D10 scope: only documents deleted

### Group E: Fence interactions (6) — PENDING REVIEW: trigger timing under lock
E1 fence-first: fenced  
E2 fence-idem: fenced if already present  
E3 fence-blocked-protected: blocked_protected_reference if any of 6 sources has key  
E4 fence-blocked-docset: blocked_document_set_changed if doc with key not in captured set  
E5 fence-not-claimed: lease expired/stale or status not live  
E6 triggers-reject: BEFORE INSERT/UPDATE on any of 6 tables setting value to fenced key rejected (advisory lock serialized)

### Group F: Quota/listing/cancel/recreation (6) — PENDING REVIEW: timing boundaries
F1 cancel-ok: pending, not_attempted, attempt_count==0, finalize pending; requester or admin  
F2 cancel-reject: any fails or wrong actor  
F3 quota-resync-mark: only when deleted and null  
F4 quota-resync-list: deleted+done+confirmed_absent, quota_resynced_at NULL, ordered by finalized_at NULLS LAST,id, limited  
F5 recreation: failed>15m allows new; failed<15m blocked (uses shared advisory lock)  
F6 global-eligible-guard: complete predicate (no owner filter, no SKIP LOCKED in eligibility test form) matches exactly

Total: 49 unique case IDs (A1–A7, B1–B8, C1–C12, D1–D10, E1–E6, F1–F6). Uncertain cases marked **PENDING REVIEW** above.

## 11. Tomorrow's restart instructions
1. Verify HEAD `1ba4351`, repo clean of untracked changes? (preserve existing).  
2. Confirm TEST only: `nqadtfqyurkpmxcodswc`. Never production.  
3. Review this checkpoint and the 3 files.  
4. If proceeding to live TEST: set `slmm.t5.target_project='nqadtfqyurkpmxcodswc'` after independent endpoint verification; use `REPEATABLE READ`; run rollback-only; separate residue READ ONLY.  
5. Registry: do **not** change now (existing issue noted). If adding T5 SQL later, classify in `harness-registry.mjs` (fail-closed).  
6. Never invent artifacts; distinguish historical vs fresh results.  
7. Stop before any DB writes/R2/deploys/migrations.

## 12. Approval boundaries
- **Approved now:** create exactly these 3 files only.  
- **Not approved:** executable SQL, registry edits, staging, commits, pushes, T5 execution, TEST DB writes, R2, Cloudflare changes, migrations, deploys, production access.  
- All existing modified/untracked files preserved. No force-push/rebase/amend/squash.