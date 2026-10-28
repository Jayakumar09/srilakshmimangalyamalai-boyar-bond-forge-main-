# S14 synthetic identity-safety companion — limited PASS

This directory preserves the exact tested external companion, without changing
its assertions, fixtures, snapshots, mocks, or production-function imports.
It supplements `../s14-resolver-regression/`; it does not replace that harness
or establish full S14/capture integration validation.

## Recorded verification

- Baseline: `checkpoint/t6-offline-evidence`, commit
  `1f7e5d1db982e21e8ed262953eb1d72ff4c57faf`.
- Original: `D:\SLMM-T6-TOOLS\S14-HARNESS-CANDIDATES\Run-S14IdentitySafetyTests.ps1`.
- Original and checkpoint SHA-256:
  `202D50A03DD6B796F14367FD6B233591948878466D13C1A0DFC002C4CD461170`.
- One authorized invocation of this corrected hash on 2026-10-28 using Windows
  PowerShell 5.1.22000.2538: exit **0**, **166 PASS / 0 FAIL**, four fixtures PASS,
  zero fixture faults, empty stderr, and zero unintended ReuseSink events.
- Evidence: `D:\SLMM-T6-EVIDENCE\s14-identity-safety-runtime-20261028-201524-d5579ec7`.
  Detailed assertions, mock calls, before/after hashes and SHA256.json remain
  outside the repository. Earlier failed-candidate evidence is preserved, not
  reclassified by this successful result.
- Exit status and actual assertion records were checked, not just PASS text.
  No runtime was repeated to create this checkpoint.

| Fixture | Assertions | PID substitute calls | CIM substitute calls |
|---|---:|---:|---:|
| Alive / no false reuse | 41 | 4 | 4 |
| Gone | 42 | 5 | 0 |
| Unknown / conservative retention, including two fallbacks | 45 | 7 | 5 |
| Generation-specific survivor selection | 38 | 7 | 4 |

All expected counts matched. The 166 assertions include 80 initial/final command
binding checks. All eight production definitions matched pinned source extents.
The repaired typed PID-key snapshots and unchanged-map comparison completed.

## Dependency completeness and isolation

The only script-file dependency is the already tracked protected source:
`test-harness/t6-checkpoint/offline-evidence-capture.ps1`, SHA-256
`9E780D5ED85DB30B2C7DFC0DDF23B7F6BCD60E7B3F40A1664C3B9F98962DF0D9`.
Its raw Git blob at the baseline commit has that exact hash. No additional
external extracts, packages, database fixtures, environment files, or secrets
are needed. `checkpoint-manifest.json` records the eight definition hashes.

The companion reads that source as bytes, verifies its hash, parses its AST,
and imports only eight individually hash-verified function definitions. It
never dot-sources or executes the full capture entry point. Actual production
identity/resolver/liveness/survivor functions are used. Only Get-PidState and
Get-CimInstance are local environmental substitutes, with binding checks,
restricted synthetic requests, exact call counts and independent fixture faults.
No substitute forwards to real CIM or native process lookup APIs.

## Reproduction — separate explicit runtime approval required

Requirements: isolated Windows PowerShell 5.1 process and the repository at the
exact location below. That absolute source path is part of the unchanged tested
artifact. On a different machine, arrange a byte-preserving checkout separately;
if Git newline conversion changes the source hash, STOP rather than normalizing
protected source or editing the harness. The local .gitattributes protects only
this companion's exact bytes; it does not alter production-file attributes.

From PowerShell, verify the prerequisites without executing the companion:

```powershell
$ErrorActionPreference = 'Stop'
$repo = 'D:\DevProjects\Working\srilakshmimangalyamalai(boyar-bond-forge-main)'
$source = Join-Path $repo 'test-harness\t6-checkpoint\offline-evidence-capture.ps1'
$companion = Join-Path $repo 'test-harness\t6-checkpoint\s14-identity-safety\Run-S14IdentitySafetyTests.ps1'
if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -cne '9E780D5ED85DB30B2C7DFC0DDF23B7F6BCD60E7B3F40A1664C3B9F98962DF0D9') { throw 'Protected source hash mismatch' }
if ((Get-FileHash -LiteralPath $companion -Algorithm SHA256).Hash -cne '202D50A03DD6B796F14367FD6B233591948878466D13C1A0DFC002C4CD461170') { throw 'Companion hash mismatch' }
```

Only after separate approval, execute once and capture stdout, stderr and the
true exit code (this is a reproduction command, not another recorded execution):

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $companion
$LASTEXITCODE
```

Require exit 0, all four fixtures, 166 passed assertions, correct import/binding
evidence, exact call counts and no fixture faults. On failure stop; repair or
retry requires separate approval. The script writes JSON to stdout and does not
create runtime evidence files itself; the operator must capture them externally.

## Coverage boundaries

**PASS at synthetic function level:** alive and no false reuse, confirmed gone,
unknown identity and conservative retention, both missing-creation fallbacks,
and exact-generation survivor selection. Unknown retained is not confirmed alive.
The survivor result contains current PID 99999/T2 and uncertain PID 99997/00:07Z,
not old PID 99999/T1 or the confirmed-gone candidate.

**NOT COVERED:** real Windows process survival/PID reuse; real CIM behavior;
descendant discovery; grace-period timing; full capture/A4 integration; and
deliberately corrupted snapshot-map rejection paths. Original lost S14 recovery
and other T6 gates remain separate. No claim of full S14 integration validation.
