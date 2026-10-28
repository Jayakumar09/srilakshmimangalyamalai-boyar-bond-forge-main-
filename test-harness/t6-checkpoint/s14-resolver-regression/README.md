# S14 isolated PID-reuse resolver regression (limited PASS)

This checkpoint preserves the **exact externally tested harness** and its three
required, unchanged production-function extracts. It is not the lost original
S14 self-test, full S14 validation, or an end-to-end capture test.

## Provenance and recorded result

- Source baseline: `checkpoint/t6-offline-evidence` at
  `736e5e893a02f4f5008bf9dbc269b10f4bc84c30`.
- Protected source: `test-harness/t6-checkpoint/offline-evidence-capture.ps1`,
  SHA-256 `9E780D5ED85DB30B2C7DFC0DDF23B7F6BCD60E7B3F40A1664C3B9F98962DF0D9`.
- Tested external harness:
  `D:\SLMM-T6-TOOLS\S14-HARNESS-CANDIDATES\Run-S14ResolverTest.ps1`.
- Original and checkpoint harness SHA-256:
  `D058E747160FF8178F42CD64F424C486BEEB0CBA03D3C2597D83FECD81DA99FD`.
- One isolated Windows PowerShell **5.1.22000.2538** execution, 2026-10-28:
  **exit 0**, stdout `PASS`, empty stderr. The completed rejection guards and
  immutable script were inspected; printed text alone was not treated as proof.
- External evidence (not bundled):
  `D:\SLMM-T6-EVIDENCE\s14-resolver-runtime-20261028-181225-cdb82edd`.
  `checkpoint-manifest.json` records artifact and evidence hashes, plus direct
  source-AST integrity for all seven original extracts. Only three are needed
  to run this fixture. The earlier external extraction manifest has stale hashes;
  it is not used as the integrity authority.

No runtime test was repeated to create this checkpoint. This directory contains
no credentials, database setup, environment loader, or network requirement.

## Reproduction (separate explicit runtime approval required)

**Do not run these instructions as part of checkpoint review.** Requirements:
Windows, Windows PowerShell 5.1, a writable local `D:` drive, and the exact external
dependency directory below. These machine-specific paths are intentionally
preserved because changing the harness would change the tested artifact.
No installation, real OS PID creation/reuse, SQL, hosted service, or application
test is needed. No `.env` file is read.

From the repository root in Windows PowerShell 5.1, verify the four artifacts
and prepare the three dependency files. Existing mismatched files are refused,
never overwritten. This setup does not invoke the harness or its assertions:

```powershell
$ErrorActionPreference = 'Stop'
$checkpoint = Join-Path (Get-Location).Path 'test-harness\t6-checkpoint\s14-resolver-regression'
$manifest = Get-Content -LiteralPath (Join-Path $checkpoint 'checkpoint-manifest.json') -Raw | ConvertFrom-Json
foreach ($artifact in $manifest.artifacts) {
    $path = Join-Path $checkpoint $artifact.checkpointPath
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $artifact.checkpointSha256) {
        throw ('Checkpoint artifact hash mismatch: ' + $artifact.checkpointPath)
    }
}
$dependencyRoot = 'D:\SLMM-T6-TOOLS\S14-HARNESS'
foreach ($artifact in $manifest.artifacts) {
    if ($artifact.role -ne 'dependency') { continue }
    $destination = Join-Path $dependencyRoot $artifact.fileName
    if (Test-Path -LiteralPath $destination) {
        if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $artifact.checkpointSha256) {
            throw ('Refusing to overwrite mismatched dependency: ' + $artifact.fileName)
        }
    }
}
New-Item -ItemType Directory -Path $dependencyRoot -Force | Out-Null
foreach ($artifact in $manifest.artifacts) {
    if ($artifact.role -ne 'dependency') { continue }
    $destination = Join-Path $dependencyRoot $artifact.fileName
    if (-not (Test-Path -LiteralPath $destination)) {
        Copy-Item -LiteralPath (Join-Path $checkpoint $artifact.checkpointPath) -Destination $destination
    }
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $artifact.checkpointSha256) {
        throw ('Restored dependency hash mismatch: ' + $artifact.fileName)
    }
}
```

Only after separate approval, execute the preserved checkpoint harness once in
an isolated process (the command below is a reproduction command, not another
recorded execution):

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$checkpoint\Run-S14ResolverTest.ps1"
$LASTEXITCODE
```

Expected exit `0`, stdout `PASS`, empty stderr. Capture the real process exit
status and outputs; do not infer success from the text alone. On failure stop;
repair or retry requires separate approval. `.gitattributes` prevents Git newline
conversion of the four PowerShell artifacts so their hashes remain exact.

## What the recorded execution covers

- Parent PID `88888`, creation `2026-10-28T00:00:00Z`, is non-null and registered.
- Two child observations share PID `99999` with T1 `00:05Z` and T2 `00:09Z`.
  Both calls use the same verified parent key, parent PID, and creation time.
- Guards reject colliding generation keys and missing records in the registry.
- The unchanged resolver must classify T2 as `reuse`; the harness does not set
  classification directly or substitute a mock resolver.
- `ReuseSink` must contain exactly one matching event naming the prior key,
  T1/T2, `ordering=later`, depth 1, and parent PID `88888`.

The numeric PID and ordering are fixed fixture inputs (ordering is also checked
in the exact event); they are not separate standalone equality/inequality tests.
Internal objects were not dumped in the recorded runtime. Reported fixture and
event values derive from fixed arguments and successful rejection guards.

## Isolation and NOT COVERED scenarios

The harness loads only `Get-ProcessGenerationKey`, `New-ProcessGenerationRecord`,
and `Resolve-ProcessGeneration`. Its script-local synthetic identity provider
matches PID plus UTC creation timestamp. It accepts only `alive`, `gone`,
`reused`, or `unknown`, with missing/invalid responses returning `unknown`.
The fixture configures only the previous child identity as `reused`.
Neither the production CIM identity provider nor the full capture entry point
is loaded. The other four original extracts are integrity records only, not
bundled runtime dependencies.

**NOT COVERED:** existing-live-generation protection; alive, gone, and unknown
identity scenario assertions; genuine survivor detection; unknown identity not
being treated as confirmed absence; wrong-timestamp/invalid-state negative
scenarios; real OS PID reuse/CIM; full capture integration; S5/S8b/A3/A4 reruns;
application/hosted/production behavior. Helper branches are not scenario passes.
The original lost S14 source remains unrecovered. Any expanded tests, runtime
rerun, integration work, or production change needs separate approval.
