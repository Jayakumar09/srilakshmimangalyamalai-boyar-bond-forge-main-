# T5 Preparation Report — storage-deletion lifecycle + fence (Findings 4–5)

Prepared: 2026-10-19
Status: **PREPARATION COMPLETE — awaiting approval. Nothing has been run against TEST.**
Recommendation: **GO for a human-approved TEST execution** of the live test, with the
preflight run first and the residue check after (see "GO/BLOCKED").

> Scope discipline: this session performed **no** TEST database connection, no writes,
> no R2/Cloudflare/Scheduler operations, no migrations, no Worker deploys, and no
> production access. No repository file was created, staged, committed or pushed.
> All artifacts live in the temporary working directory. The only execution performed
> was against a **local throwaway PostgreSQL 18.3 lab** on `127.0.0.1:55432`, which is
> explicitly **not** the TEST project and is not a live test.

---

## 1. Artifacts (temporary working directory)

Directory: `C:\Users\JAYAKUMAR_DELL_SSD\AppData\Local\Temp\opencode\t5-prep\`

| File | Bytes | SHA-256 |
|---|---|---|
| `slmm-storage-deletion-t5-live-test.sql` | 81686 | `bd1a8b6526fdae0d33956b1bf74d39e0442af9b695ea9ed85c65fd6ffba29635` |
| `slmm-storage-deletion-t5-preflight.sql` | 11974 | `88c21491cc1954a5b7b93fadb78bc82b7bc705220919c24a40b7c84a4e666acb` |
| `slmm-storage-deletion-t5-residue.sql` | 2547 | `d3efdbe0fecc58856c0a40dd6d04be258a1b3ec55bdd7dda33a23c51cf4861a2` |
| `t5-validate-static.mjs` | 8771 | `ced684cd88e166bff8d806d857ac6d4d76cc0eed1658d763c1fbcb6c5575fab3` |
| `lab\lab-schema.sql` | 5472 | `b0145a956ddff3e8e268e2678672e64cda7d882ee7340fc5affb9988e93550af` |
| `t5-live-test.lab-run.txt` | 65090 | `cb2d26c419b0c04d98be1ecbf70417ff4e8c3bf6be5672e8b595f78928d993d0` |

> Full SHA-256 values are also in `t5-checksums.txt`. `T5_PREPARATION_REPORT.md` is itself
> listed there (its hash is taken over the finished file, so it is not shown inside this table).

Role of each artifact:
- **live-test.sql** — the 49-case, rollback-only T5 live test (Sections A–F) to be executed on TEST.
- **preflight.sql** — READ ONLY pre-execution identity + installed-function fingerprint check; must be run and pass first.
- **residue.sql** — READ ONLY post-execution check that ROLLBACK left zero synthetic rows in ten relations.
- **t5-validate-static.mjs** — offline, read-only structural validator over the SQL text (no DB).
- **lab-schema.sql** — the throwaway local-lab stub schema (not for TEST; evidence only).
- **t5-live-test.lab-run.txt** — captured stdout of the full harness on the local lab.

## 2. What was validated, and how (and what it does NOT mean)

There are **three distinct tiers** of evidence. They must not be conflated:

1. **Offline static validation** — `t5-validate-static.mjs`, no database. 41/41 checks PASS.
   Proves textual invariants: correct transaction framing (`BEGIN ISOLATION LEVEL REPEATABLE READ;` …
   single final `ROLLBACK;`, no `COMMIT`), read-only preflight/residue, all 14 function-body pins
  present, 49 case call sites, D7 recorded as BLOCKED (not simulated), no persistent DDL, correct
  TEST project ref and no production ref, global eligible-ID guard and complete-row assertions present.
2. **Lab execution (offline, NOT TEST)** — the harness was run to completion against a throwaway
  local PostgreSQL 18.3 cluster that had the committed lifecycle/fence migrations applied verbatim.
  Result: `overall_verdict = PASS`, **48/48 EXECUTABLE cases passed, D7 BLOCKED**, 91 guard checks,
  1 fence. All 14 function-body pins matched the offline values, confirming the offline pin method
  is faithful. This is strong evidence the SQL is internally correct and fail-closed, but it is a
  **local lab**, not the TEST project.
3. **Live TEST execution** — **NOT PERFORMED.** No connection to `nqadtfqyurkpmxcodswc` was made.

Explicitly: **no T5 live PASS is claimed.** The historical "89/89" T5 result exists only in prior
reports; no T5 artifacts exist in the repo or git history, and it was **not** rerun or reproduced here.

## 2b. Offline static validation — 41/41 PASS

All checks pass, including: correct REPEATABLE READ open / single ROLLBACK close / no COMMIT;
14/14 function pins embedded; 49 `PERFORM pg_temp.t5_case(...)` call sites; D7 recorded BLOCKED with
NULL pass; global eligible-ID predicate and `IS DISTINCT FROM to_jsonb(...)` complete-row assertions
present; no persistent DDL in the harness; preflight and residue are READ-ONLY with no write/DDL
statements and cover all ten touched relations.

## 3. Defects found and fixed **during preparation** (before any TEST use)

These were found by running the harness against the lab and are all fixed in the current artifact:

1. **`UNIQUE` on the harness `storage_key` column was wrong.** A key may legitimately carry a terminal
   `failed` row plus a recreated live row (a demonstrated product behavior). Constraint removed.
2. **Nested `DECLARE` scope errors** (Group A/B helpers) — variables hoisted to the DO-block level.
3. **Group B oracle derivation compared an unordered list to an ordered pair** — the two-oldest
   derivation is now explicitly sorted by id on both sides.
4. **Group B counted rows from a shared accumulator table**, which conflated earlier single claims
   with the batch result — the batch result is now captured from a single aggregate call.
5. **`document_row_ids` expected-state was built as a JSON scalar** (`jsonb_build_object('document_row_ids', v_doc)`)
   instead of an array; fixed to `ARRAY[v_doc]` in D2/D10.
6. **`jsonb_object_keys_count()` does not exist** in the preflight summary — replaced with
   `(SELECT count(*) FROM jsonb_object_keys(v_pins))`.
7. **Static-validator false positives** (comment/string-literal matches, helper-definition counting) —
   checks made statement-anchored.

## 4. Fail-closed negative tests executed on the lab

- Harness without the `slmm.t5.target_project` acknowledgement → aborts at the contract (identity/scope guard).
- Preflight with a foreign eligible deletion request present → aborts (the exact global eligible-ID
  guard could not distinguish it from fixtures).
3. Residue check with a synthetic-namespace row present → raises with per-relation counts; and passes
   clean (all-ten-zero) when the rollback worked.

## 5. What the live test actually asserts (49 cases, groups A–F)

- **A (1–7)** request: create, live-reuse, recent-failure cooldown (22023), expired-failure recreation,
   protected-reference rejection (22023), cross-owner reference rejection (42501), exact ordered captured-id snapshot.
- **B (8–15)** claim: pending→deleting, confirmed→finalizing, active lease not reclaimable, batch limit
   0/-2, two-oldest batch with a shared lease token, blocked cooldown, expired-lease reclaim.
- **C (16–27)** block / failure / confirmation, including error clipping (240→200, 650→500), attempt
   clamping (>=max, 0, negative, NULL), replay no-ops, and rejection of expired/NULL/wrong tokens.
- **D (28–37)** finalization: pre-confirmation refusal, full confirm→finalize, selective scoping to
   captured same-key document rows, stale/wrong-token rejection, done-row protection, missing-id
   tolerance, and documents-only mutation (a protected `profiles` row survives). **D7 is BLOCKED** (see §5b).
- **E (38–43)** fence establishment idempotency; `blocked_protected_reference`; `blocked_document_set_changed`;
   `not_claimed` on expired lease; BEFORE-trigger rejection of the fenced key on **all six** reference
   tables, plus UPDATE rejection on documents and profiles.
- **F (44–49)** cancel by requester and admin and rejection matrix; quota-resync mark and list(limit);
   recreation after a >15-minute failure vs. <15-minute cooldown; the exact, non-vacuous global
   eligible-ID guard.

### §5b D7 — BLOCKED (not simulated)
D7 requires the `public.documents` existence-check-abort path, which needs fault injection (a
`BEFORE DELETE` trigger returning NULL, or a `DO INSTEAD` rule) on a **shared** table — i.e. DDL on
`public.documents`. That is out of scope for a rollback-only harness and was **not** simulated. It is
recorded as `BLOCKED` with a NULL pass so it can never be counted as a PASS.

## 6. Unresolved risks / genuinely unverified

1. **Nothing has been run against TEST.** The 48/48 result is a faithful local lab, not the managed
   project. Managed-project schema drift, extensions, roles/ACLs, or pre-existing data could differ.
2. **Project identity is not cryptographically proven in-SQL.** The preflight/harness verify the
   `slmm.t5.target_project` GUC acknowledgement plus the installed-function fingerprint; they cannot
   prove the server endpoint is TEST. The operator must independently confirm the connection targets
   `nqadtfqyurkpmxcodswc` (same accepted limitation as T3/T4).
3. **Exact-shape inserts into shared tables** (`documents`, `profiles`, `payments`, `jathagam_requests`,
   `support_threads`, `support_messages`, `payment_events`, `user_roles`) were verified against the
   committed migrations and reproduced in the lab, but the live TEST schema is authoritative. Any
   NOT NULL/type/enum drift will surface as an error (fail-closed), not a false pass.
4. **Pre-existing data in TEST** must satisfy the preflight: no foreign eligible deletion work, and a
   clean synthetic namespace. If TEST already holds eligible rows, the run is BLOCKED until resolved.
5. **Concurrency and external R2 behavior are out of scope.** No case exercises true concurrent
   workers or real R2 DELETE; the fence/lease logic is validated single-transaction only.
6. **Harness registry classification gap (pre-existing).** `test-harness/harness-registry.mjs`
   fail-closed classification does not list the T3/T4 SQL files, nor any T5 file. This is
   **pre-existing** and was deliberately **left unmodified**. Recommended smallest safe change:
   add the new T5 filenames to that registry's classification list so a future safety suite does not
   flag an executable harness as unclassified — a one-line data addition, no logic change.

## 7. Recommendation: GO (conditional)

**GO** to proceed to a human-approved, TEST-only execution, provided the operator:
1. Independently confirms the connection targets TEST (`nqadtfqyurkpmxcodswc`) and no production endpoint.
2. Runs **`slmm-storage-deletion-t5-preflight.sql`** first and requires it to print
   `T5 preflight OK` (fail-closed on any drift).
3. Runs **`slmm-storage-deletion-t5-live-test.sql`** as `postgres`, with
   `PGOPTIONS=-c slmm.t5.target_project=nqadtfqyurkpmxcodswc`, expecting
   `overall_verdict = PASS`, 48/48 executable, D7 BLOCKED, then a mandatory `ROLLBACK`.
4. Runs **`slmm-storage-deletion-t5-residue.sql`** to confirm zero residue.
5. Reports back with the emitted JSON report.

**BLOCKED** from claiming any live PASS until those steps are actually executed on TEST and their
output is captured.

## 8. Constraints honored (attestation)

- TEST project `nqadtfqyurkpmxcodswc` only; **production forbidden and never contacted**.
- **No DB connection to TEST, no writes, no R2 operations, no Cloudflare scheduler changes, no
  migrations, no Worker deployment.**
- **No repository files created, staged, committed or pushed.** HEAD remains `2dd6aa7`; working tree
  unchanged (42 modified / 69 untracked / 0 staged, verified with `git status --porcelain -uall`).
- All artifacts live under
  `%TEMP%\opencode\t5-prep\` only; the local PostgreSQL lab is a throwaway cluster.
- `test-harness/harness-registry.mjs` inspected only; recommendation recorded; **not modified**.
