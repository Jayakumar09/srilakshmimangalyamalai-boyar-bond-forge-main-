#Requires -Version 5.1
<#
  SLMM T6 offline evidence capture (v3.1 - Gate A1 artifact).

  Captures evidence for exactly three approved offline commands. Offline only:
  no network, no database client, no credentials, no deployment.

  Approved capture vectors (the only three):
    1. node scripts/run-offline-tests.mjs
    2. node --test test-harness/t6-checkpoint/t6-group-r-runner-tests.mjs
    3. node node_modules/typescript/bin/tsc --noEmit

  Fail-closed design:
    - the default verdict is FAIL and the default exit code is 1
    - a PASS manifest exists only after all three steps completed, every check
      passed, and the manifest was validated before atomic publication
    - exit code 3 invalidates any manifest, including a PASS one
    - process relationships are bound to (pid, creation time), so a recycled
      PID is never reported as a descendant or a survivor

  Exit codes:
    0   PASS published and verified
    1   FAIL, or aborted during capture
    2   refused before capture (no directory created)
    3   publication or verification failure (ignore any manifest)
    5   self-test case could not run honestly
    6   self-test case failed
    10  plan-only: preconditions passed (nothing created)
    11  plan-only: preconditions failed (nothing created)

  Exit code 0 is reserved for a published, verified PASS capture. A self-test
  run that passes every case exits 7, so 0 can never be confused with it.

  Inert at parse time. Nothing executes until the file is invoked.
#>
[CmdletBinding()]
param(
    [string]$RepoRoot = 'D:\DevProjects\Working\srilakshmimangalyamalai(boyar-bond-forge-main)',
    [string]$EvidenceRoot = 'D:\SLMM-T6-EVIDENCE',
    [string]$ApprovalRef = '',
    [string]$ExpectedHead = '',
    [switch]$PlanOnly,
    [switch]$AcknowledgeTestsRun,
    [switch]$SelfTest,
    [string]$SelfTestRoot = '',
    [string]$SelfTestCase = '',
    [switch]$SelfTestFakeSteps,
    [string]$FaultPoint = '',
    [string]$RunIdOverride = ''
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Run state
# ---------------------------------------------------------------------------
$script:Reasons = New-Object System.Collections.ArrayList
$script:Warnings = New-Object System.Collections.ArrayList
$script:RunLog = New-Object System.Collections.ArrayList
$script:StepRecords = New-Object System.Collections.ArrayList
$script:EvidenceDir = $null
$script:RunId = $null
$script:StatePath = $null
$script:Verdict = 'FAIL'
$script:ExitCode = 1
$script:LastBundle = $null
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Reset-RunState {
    $script:Reasons = New-Object System.Collections.ArrayList
    $script:Warnings = New-Object System.Collections.ArrayList
    $script:RunLog = New-Object System.Collections.ArrayList
    $script:StepRecords = New-Object System.Collections.ArrayList
    $script:EvidenceDir = $null
    $script:RunId = $null
    $script:StatePath = $null
    $script:Verdict = 'FAIL'
    $script:ExitCode = 1
    $script:LastBundle = $null
}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
$script:SchemaVersion = 3

$script:ApprovedSpecs = @(
    [pscustomobject]@{
        id = '01-offline-suites'
        vector = 'node scripts/run-offline-tests.mjs'
        args = @('scripts/run-offline-tests.mjs')
        timeoutMs = 1800000
        kind = 'suites'
    }
    [pscustomobject]@{
        id = '02-group-r-unit'
        vector = 'node --test test-harness/t6-checkpoint/t6-group-r-runner-tests.mjs'
        args = @('--test', 'test-harness/t6-checkpoint/t6-group-r-runner-tests.mjs')
        timeoutMs = 900000
        kind = 'tap'
    }
    [pscustomobject]@{
        id = '03-tsc-noemit'
        vector = 'node node_modules/typescript/bin/tsc --noEmit'
        args = @('node_modules/typescript/bin/tsc', '--noEmit')
        timeoutMs = 900000
        kind = 'tsc'
    }
)

$script:ApprovedVectors = @($script:ApprovedSpecs | ForEach-Object { [string]$_.vector })

# Self-test fixtures. Never reachable outside -SelfTest; never a repo command.
$script:FixtureSpecs = @(
    [pscustomobject]@{ id = '01-offline-suites'; vector = 'selftest:fixture-pass-a'; args = @('-e', 'process.exit(0)'); timeoutMs = 30000; kind = 'generic' }
    [pscustomobject]@{ id = '02-group-r-unit'; vector = 'selftest:fixture-pass-b'; args = @('-e', 'console.log(11)'); timeoutMs = 30000; kind = 'generic' }
    [pscustomobject]@{ id = '03-tsc-noemit'; vector = 'selftest:fixture-pass-c'; args = @('-e', 'console.log(22)'); timeoutMs = 30000; kind = 'generic' }
)

$script:ExpectedSuiteCount = 21
$script:ExpectedGroupRTests = 169
$script:ExpectedStepCount = 3
$script:ExpectedPinCount = 19
$script:ExpectedPinFileSha256 = 'd3052d32aa8b339f9a45f35c412ac4a9cd38890df95e9afa5497c3dcc5f66461'
$script:ExpectedBaselineModified = 37
$script:ExpectedBaselineUntracked = 65

$script:ExitPass = 0
$script:ExitFail = 1
$script:ExitRefused = 2
$script:ExitPublication = 3
$script:ExitSelfTestUnrunnable = 5
$script:ExitSelfTestFailed = 6
$script:ExitSelfTestPassed = 7
$script:ExitPlanOk = 10
$script:ExitPlanRefused = 11

$script:BlockedEnvPrefixes = @('SLMM_LIVE', 'T6R_', 'SUPABASE_SERVICE_ROLE', 'R2_SECRET', 'CF_API_', 'CLOUDFLARE_')
$script:BlockedEnvNames = @(
    'PGPASSWORD'
    'PGUSER'
    'NODE_OPTIONS'
    'NODE_PATH'
    'NODE_V8_COVERAGE'
    'AWS_SECRET_ACCESS_KEY'
    'DATABASE_URL'
    'SUPABASE_DB_URL'
    'PSQLRC'
    'PGSERVICEFILE'
)
$script:BlockedEnvSuffixes = @('_SECRET', '_PASSWORD', '_TOKEN', '_API_KEY')

$script:BookkeepingNames = @(
    '00-run-state.txt'
    'manifest.json'
    'manifest.json.tmp'
    'manifest.aborted.json'
    'MANIFEST.sha256'
    'SHA256SUMS.txt'
    '00-CONTRADICTION.txt'
)

$script:InputBaseline = @(
    'package.json'
    'tsconfig.json'
    'scripts/run-offline-tests.mjs'
    'test-harness/harness-registry.mjs'
    'test-harness/t6-checkpoint/t6-checksums.txt'
    'test-harness/t6-checkpoint/t6-group-r-runner-tests.mjs'
    'test-harness/t6-checkpoint/t6-group-r-runner.mjs'
    'node_modules/typescript/bin/tsc'
)

$script:PublishedPhases = @('published', 'publication-failed', 'publication-unverified')
$script:PublishableName = 'MANIFEST.sha256'

# ---------------------------------------------------------------------------
# Logging and check helpers
# ---------------------------------------------------------------------------
function Add-Reason {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Text)
    if (-not [string]::IsNullOrWhiteSpace($Text)) {
        [void]$script:Reasons.Add([string]$Text)
    }
}

function Add-Warning {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Text)
    if (-not [string]::IsNullOrWhiteSpace($Text)) {
        [void]$script:Warnings.Add([string]$Text)
    }
}

function Write-Log {
    param([AllowEmptyString()][string]$Text = '')
    [void]$script:RunLog.Add([string]$Text)
    Write-Host ([string]$Text)
}

function Add-Check {
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][System.Collections.ArrayList]$List,
        [Parameter(Mandatory)][string]$Id,
        [Parameter(Mandatory)][AllowNull()]$Ok,
        [AllowNull()][AllowEmptyString()][string]$Detail = ''
    )
    $obj = [pscustomobject]@{
        id = [string]$Id
        ok = [bool]$Ok
        detail = [string]$Detail
    }
    [void]$List.Add($obj)
    return $obj
}

function Add-CheckCount {
    param(
        [AllowEmptyCollection()][object[]]$Checks = @(),
        [AllowEmptyCollection()][string[]]$Expected = @()
    )
    $list = New-Object System.Collections.ArrayList
    $missing = New-Object System.Collections.ArrayList
    $seen = New-Object System.Collections.ArrayList
    foreach ($c in $Checks) {
        if ($null -eq $c) { continue }
        [void]$seen.Add([string]$c.id)
    }
    foreach ($e in $Expected) {
        if (-not ($seen -contains [string]$e)) {
            [void]$missing.Add([string]$e)
            [void](Add-Check -List $list -Id ('check.present.' + [string]$e) -Ok $false -Detail 'required check was never evaluated')
        }
    }
    $total = 0
    $failed = 0
    foreach ($c in $Checks) {
        if ($null -eq $c) { continue }
        $total = $total + 1
        if (-not [bool]$c.ok) { $failed = $failed + 1 }
    }
    [void](Add-Check -List $list -Id 'checkCount' -Ok ($total -gt 0) -Detail ('evaluated=' + $total + ' required=' + $Expected.Count + ' failed=' + $failed))
    return @($list)
}

# ---------------------------------------------------------------------------
# Path and fingerprint helpers
# ---------------------------------------------------------------------------
function Get-NormalizedPath {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return '' }
    $full = [System.IO.Path]::GetFullPath($Path)
    if ($full.Length -gt 3) { $full = $full.TrimEnd([char]'\') }
    return $full
}

function Test-PathUnder {
    param(
        [AllowNull()][string]$Child,
        [AllowNull()][string]$Parent
    )
    if ([string]::IsNullOrWhiteSpace($Child) -or [string]::IsNullOrWhiteSpace($Parent)) { return $false }
    if ([string]::Equals($Child, $Parent, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
    $prefix = $Parent
    if (-not $prefix.EndsWith('\')) { $prefix = $prefix + '\' }
    return $Child.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-Sha256OfText {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
        return ([System.BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-', '').ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
    }
}

function Get-FileFingerprint {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Path)
    $fp = [pscustomobject]@{
        path = [string]$Path
        exists = $false
        bytes = 0
        sha256 = ''
    }
    if ([string]::IsNullOrWhiteSpace($Path)) { return $fp }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $fp }
    $fp.exists = $true
    $raw = [System.IO.File]::ReadAllBytes($Path)
    $fp.bytes = [int]$raw.Length
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $fp.sha256 = ([System.BitConverter]::ToString($sha.ComputeHash($raw)) -replace '-', '').ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
    }
    return $fp
}

function Read-TextFile {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return '' }
    return [string]([System.IO.File]::ReadAllText($Path))
}

function Write-TextFile {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$Path,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Text
    )
    [System.IO.File]::WriteAllText($Path, $Text, $script:Utf8NoBom)
}

# ---------------------------------------------------------------------------
# Process control
# ---------------------------------------------------------------------------
# A PID is not a process identity. Windows recycles PIDs, and
# Win32_Process.ParentProcessId records only the *historical* creator PID, so a
# recycled PID makes unrelated processes look like children of a newly started
# process. The 2026-10-24 S8b evidence shows the effect: a fake Node step that
# had already exited normally (exit code 0, empty stdout) was credited with 150
# descendants and 132 survivors, none of which it created. Every relationship
# used below is therefore bound to (pid, creation time), and a link is accepted
# only when the child was created after the parent and before the parent could
# have stopped creating children.
#
# WMI CreationDate and Process.StartTime agree to sub-millisecond precision on
# this platform (measured 2026-10-27: delta 0 ms for two live processes), but
# some systems round WMI creation times to the whole second, so a small slack
# absorbs that rounding. The slack is orders of magnitude smaller than the
# PID-reuse windows this check rejects.
$script:ProcessIdentitySlackMs = 2000

function Get-ProcessCreationUtc {
    param([AllowNull()]$ProcessRow)
    if ($null -eq $ProcessRow) { return $null }
    $created = $null
    try { $created = $ProcessRow.CreationDate } catch { return $null }
    if ($null -eq $created) { return $null }
    try { return ([DateTime]$created).ToUniversalTime() }
    catch { return $null }
}

# Liveness only, by PID. It answers "is some process using this number now",
# never "is this the process we started" -- that question is answered by
# Get-PidIdentityState, which binds the PID to a creation time.
function Get-PidState {
    param([Parameter(Mandatory)][int]$Id)
    if ($Id -le 0) { return 'gone' }
    $target = $null
    try {
        $target = [System.Diagnostics.Process]::GetProcessById($Id)
    }
    catch [System.ArgumentException] {
        return 'gone'
    }
    catch {
        return 'unknown'
    }
    try {
        if ($target.Handle -eq [System.IntPtr]::Zero) { return 'unknown' }
    }
    catch {
        return 'unknown'
    }
    try {
        if ($target.HasExited) { return 'gone' }
        return 'alive'
    }
    catch {
        return 'unknown'
    }
}

# One Win32_Process snapshot per observation. Reading the whole table once keeps
# every parent/child link inside an observation mutually consistent; a filtered
# query per level would mix instants.
function Get-ProcessSnapshot {
    param([switch]$Strict)
    try {
        $rows = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
    }
    catch {
        $message = [string]$_.Exception.Message
        if ($Strict) { throw ('process identity snapshot failed: ' + $message) }
        return [pscustomobject]@{ ok = $false; error = $message; byPid = @{}; duplicates = @() }
    }
    $byPid = @{}
    $duplicates = New-Object System.Collections.ArrayList
    foreach ($row in $rows) {
        $rowId = [int]$row.ProcessId
        if ($rowId -le 0) { continue }
        if ($byPid.ContainsKey($rowId)) {
            [void]$duplicates.Add($rowId)
            continue
        }
        $byPid[$rowId] = $row
    }
    return [pscustomobject]@{ ok = $true; error = ''; byPid = $byPid; duplicates = @($duplicates) }
}

# Descendants of a *specific* process instance, tracked as process
# *generations*. A generation is one observed process, identified by the
# composite key (pid, CIM CreationDate UTC). A bare PID is never an identity:
# Windows recycles PIDs, and a parent that spawns many short-lived children can
# hand the same number to several successive siblings. The registry below is
# step-scoped: every generation ever observed is kept, oldest first, and an old
# generation is never overwritten by a later process that reuses its PID.
#
# Each link must satisfy: same ParentProcessId, child created after the parent,
# and (depth 0) child not created after the captured parent's last possible
# spawn instant. A snapshot row whose creation time contradicts the bound
# parent generation means the parent PID has been recycled, so every link in
# that snapshot belongs to a different process and is rejected as stale.
#
# Missing or contradictory identity evidence -- no creation time, duplicate
# rows for one PID, a failed CIM snapshot -- is reported to ProblemSink and, in
# Strict mode, thrown. It is never treated as "no descendants". A later
# observation of the same PID with a different, independently verified creation
# time is a new generation (a reuse event), not a contradiction.
function Get-ProcessGenerationKey {
    param(
        [Parameter(Mandatory)][int]$Id,
        [Parameter(Mandatory)][DateTime]$CreationUtc
    )
    return ('pid=' + $Id + ';born=' + ([DateTime]$CreationUtc).ToUniversalTime().ToString('o'))
}

# Creation times read from different sources (process handle vs CIM) or from a
# system that rounds CIM timestamps can differ by a fraction of a second for
# the same process. The slack absorbs that rounding. It is never used on its
# own to merge two generations: a differing reading is resolved by asking which
# generation currently holds the PID (see Resolve-ProcessGeneration).
function Test-SameProcessGeneration {
    param(
        [Parameter(Mandatory)][DateTime]$A,
        [Parameter(Mandatory)][DateTime]$B
    )
    $deltaMs = [math]::Abs((($A.ToUniversalTime()) - ($B.ToUniversalTime())).TotalMilliseconds)
    return ($deltaMs -le [double]$script:ProcessIdentitySlackMs)
}

function New-ProcessGenerationRecord {
    param(
        [Parameter(Mandatory)][int]$Id,
        [Parameter(Mandatory)][DateTime]$CreationUtc,
        [Parameter(Mandatory)][int]$Depth,
        [Parameter(Mandatory)][int]$ParentId,
        [AllowNull()]$ParentCreationUtc = $null,
        [AllowNull()][string]$ParentKey = '',
        [int]$SnapshotOrdinal = 0,
        [AllowEmptyString()][string]$Classification = 'firstObservation'
    )
    $bornUtc = ([DateTime]$CreationUtc).ToUniversalTime()
    return [pscustomobject]@{
        key = Get-ProcessGenerationKey -Id $Id -CreationUtc $bornUtc
        pid = [int]$Id
        creationUtc = $bornUtc.ToString('o')
        creationUtcValue = $bornUtc
        depth = [int]$Depth
        parentPid = [int]$ParentId
        parentCreationUtc = $(if ($null -eq $ParentCreationUtc) { '' } else { ([DateTime]$ParentCreationUtc).ToUniversalTime().ToString('o') })
        parentKey = [string]$ParentKey
        firstSeenSnapshot = [int]$SnapshotOrdinal
        classification = [string]$Classification
    }
}

# Resolve one observation (pid, creation time) against the step-scoped registry.
#
# The registry keeps every generation, so the safe answer is always available:
# a PID with a new creation time adds a generation instead of replacing one.
# Only an *identical* composite key is the same generation. When the observed
# creation time differs from every recorded generation for that PID, the
# identity query decides what happened:
#   alive    -> the process now holding the PID is a recorded generation, so the
#               differing reading is a re-read of that same process; keep it.
#   reused   -> the PID now belongs to a different process; the observation is a
#               new generation (a genuine reuse event).
#   gone     -> the observed process already exited; keep it as its own
#               generation so the observation is preserved.
#   unknown  -> cannot be decided; keep it as a new generation. Unknown identity
#               is never dropped, and liveness treats it as still alive.
# A creation time that runs backwards is recorded as a note, never silently
# merged: a rounded earlier reading can legitimately do that, and the union of
# generations still answers liveness in the unsafe direction.
function Resolve-ProcessGeneration {
    param(
        [Parameter(Mandatory)][int]$Id,
        [Parameter(Mandatory)][DateTime]$CreationUtc,
        [Parameter(Mandatory)][int]$Depth,
        [Parameter(Mandatory)][int]$ParentId,
        [AllowNull()]$ParentCreationUtc = $null,
        [AllowNull()][string]$ParentKey = '',
        [Parameter(Mandatory)]$Registry,
        [Parameter(Mandatory)]$KeysByPid,
        [AllowNull()][System.Collections.ArrayList]$ProblemSink = $null,
        [AllowNull()][System.Collections.ArrayList]$ReuseSink = $null,
        [AllowNull()][System.Collections.ArrayList]$NoteSink = $null,
        [int]$SnapshotOrdinal = 0
    )
    $bornUtc = ([DateTime]$CreationUtc).ToUniversalTime()
    $key = Get-ProcessGenerationKey -Id $Id -CreationUtc $bornUtc
    if ($Registry.Contains($key)) { return $Registry[$key] }

    $existing = @()
    if ($KeysByPid.ContainsKey($Id)) { $existing = @($KeysByPid[$Id]) }
    if ($existing.Count -eq 0) {
        $record = New-ProcessGenerationRecord -Id $Id -CreationUtc $bornUtc -Depth $Depth -ParentId $ParentId -ParentCreationUtc $ParentCreationUtc -ParentKey $ParentKey -SnapshotOrdinal $SnapshotOrdinal -Classification 'firstObservation'
        [void]$Registry.Add($record.key, $record)
        if (-not $KeysByPid.ContainsKey($Id)) { $KeysByPid[$Id] = New-Object System.Collections.ArrayList }
        [void]$KeysByPid[$Id].Add($record.key)
        return $record
    }

    $latestKey = [string]$existing[$existing.Count - 1]
    $latest = $Registry[$latestKey]
    $closest = $latest
    $closestDelta = [math]::Abs(($bornUtc - ([DateTime]$latest.creationUtcValue)).TotalMilliseconds)
    foreach ($existingKey in $existing) {
        $candidate = $Registry[[string]$existingKey]
        $delta = [math]::Abs(($bornUtc - ([DateTime]$candidate.creationUtcValue)).TotalMilliseconds)
        if ($delta -lt $closestDelta) {
            $closestDelta = $delta
            $closest = $candidate
        }
    }

    $state = 'unknown'
    try { $state = Get-PidIdentityState -Id $Id -CreationUtc ([DateTime]$closest.creationUtcValue) } catch { $state = 'unknown' }

    if ($state -eq 'alive') {
        if ($null -ne $NoteSink) {
            [void]$NoteSink.Add('creationTimeReread:pid=' + $Id + ' recorded=' + ([DateTime]$closest.creationUtcValue).ToString('o') + ' observed=' + $bornUtc.ToString('o') + ' state=alive')
        }
        return $closest
    }

    $deltaToLatestMs = ($bornUtc - ([DateTime]$latest.creationUtcValue)).TotalMilliseconds
    $ordering = 'ambiguous'
    if ($deltaToLatestMs -gt [double]$script:ProcessIdentitySlackMs) { $ordering = 'later' }
    elseif ($deltaToLatestMs -lt (-1 * [double]$script:ProcessIdentitySlackMs)) { $ordering = 'earlier' }

    $classification = 'unverifiedGeneration'
    if ($state -eq 'reused') { $classification = 'reuse' }
    elseif ($state -eq 'gone') { $classification = 'exitedBeforeQuery' }

    if ($ordering -eq 'earlier') {
        if ($null -ne $NoteSink) {
            [void]$NoteSink.Add('creationTimeRegression:pid=' + $Id + ' latest=' + ([DateTime]$latest.creationUtcValue).ToString('o') + ' observed=' + $bornUtc.ToString('o') + ' state=' + $state)
        }
    }
    if ($classification -eq 'reuse') {
        if ($null -ne $ReuseSink) {
            [void]$ReuseSink.Add('reuse:pid=' + $Id + ' previousGeneration=' + $latestKey + ' previousBorn=' + ([DateTime]$latest.creationUtcValue).ToString('o') + ' newBorn=' + $bornUtc.ToString('o') + ' ordering=' + $ordering + ' depth=' + $Depth + ' parentPid=' + $ParentId)
        }
    }
    if ($classification -eq 'unverifiedGeneration') {
        if ($null -ne $NoteSink) {
            [void]$NoteSink.Add('unverifiedGeneration:pid=' + $Id + ' observed=' + $bornUtc.ToString('o') + ' state=' + $state)
        }
    }

    $record = New-ProcessGenerationRecord -Id $Id -CreationUtc $bornUtc -Depth $Depth -ParentId $ParentId -ParentCreationUtc $ParentCreationUtc -ParentKey $ParentKey -SnapshotOrdinal $SnapshotOrdinal -Classification $classification
    [void]$Registry.Add($record.key, $record)
    [void]$KeysByPid[$Id].Add($record.key)
    return $record
}

function Get-DescendantGenerations {
    param(
        [Parameter(Mandatory)][int]$ParentId,
        [AllowNull()]$ParentCreationUtc = $null,
        [int]$Depth = 0,
        [switch]$Strict,
        [AllowNull()]$Snapshot = $null,
        [AllowNull()][System.Collections.ArrayList]$ProblemSink = $null,
        [AllowNull()][System.Collections.ArrayList]$RejectedSink = $null,
        [AllowNull()]$DirectChildCreatedNotAfterUtc = $null,
        [AllowNull()]$GenerationRegistry = $null,
        [AllowNull()]$GenerationKeysByPid = $null,
        [AllowNull()][System.Collections.ArrayList]$ReuseSink = $null,
        [AllowNull()][System.Collections.ArrayList]$NoteSink = $null,
        [AllowNull()][string]$ParentGenerationKey = '',
        [int]$SnapshotOrdinal = 0
    )
    if ($Depth -gt 6) { return @() }
    $problems = $ProblemSink
    if ($null -eq $problems) { $problems = New-Object System.Collections.ArrayList }
    $rejected = $RejectedSink
    if ($null -eq $rejected) { $rejected = New-Object System.Collections.ArrayList }
    $snap = $Snapshot
    if ($null -eq $snap) { $snap = Get-ProcessSnapshot -Strict:$Strict }
    if (-not [bool]$snap.ok) {
        $message = 'process identity snapshot failed: ' + [string]$snap.error
        [void]$problems.Add($message)
        if ($Strict) { throw $message }
        return @()
    }
    if (@($snap.duplicates).Count -gt 0) {
        # Two live rows for one PID inside one snapshot: the identity evidence is
        # contradictory and cannot be resolved by ordering. Always fail closed.
        $message = 'conflicting process identity evidence: duplicate snapshot rows for pid ' + ((@($snap.duplicates) | Sort-Object -Unique) -join ',')
        [void]$problems.Add($message)
        if ($Strict) { throw $message }
        return @()
    }
    $parentBorn = $null
    if ($null -ne $ParentCreationUtc) { $parentBorn = [DateTime]$ParentCreationUtc }
    else {
        $parentRow = $null
        if ($snap.byPid.ContainsKey($ParentId)) { $parentRow = $snap.byPid[$ParentId] }
        $parentBorn = Get-ProcessCreationUtc -ProcessRow $parentRow
    }
    if ($null -eq $parentBorn) {
        $message = 'missing process identity evidence: creation time unavailable for parent pid ' + [string]$ParentId
        [void]$problems.Add($message)
        if ($Strict) { throw $message }
        return @()
    }
    $parentBornUtc = ([DateTime]$parentBorn).ToUniversalTime()
    if ($snap.byPid.ContainsKey($ParentId)) {
        # The parent row is present in this snapshot. If it carries a different
        # creation time, the parent PID has already been recycled and every link
        # below belongs to that other process: reject the whole observation as
        # stale instead of attributing foreign children to the captured parent.
        $parentRowBorn = Get-ProcessCreationUtc -ProcessRow $snap.byPid[$ParentId]
        if ($null -eq $parentRowBorn) {
            $message = 'missing process identity evidence: creation time unavailable for parent pid ' + [string]$ParentId + ' in snapshot'
            [void]$problems.Add($message)
            if ($Strict) { throw $message }
            return @()
        }
        if (-not (Test-SameProcessGeneration -A ([DateTime]$parentRowBorn) -B $parentBornUtc)) {
            [void]$rejected.Add('staleParentGeneration pid=' + [string]$ParentId + ' expectedBorn=' + $parentBornUtc.ToString('o') + ' snapshotBorn=' + ([DateTime]$parentRowBorn).ToUniversalTime().ToString('o'))
            if ($null -ne $ReuseSink) {
                [void]$ReuseSink.Add('parentReuse:pid=' + [string]$ParentId + ' previousBorn=' + $parentBornUtc.ToString('o') + ' currentBorn=' + ([DateTime]$parentRowBorn).ToUniversalTime().ToString('o') + ' depth=' + $Depth)
            }
            return @()
        }
    }
    $generations = New-Object System.Collections.ArrayList
    $seenKeys = @{}
    foreach ($key in @($snap.byPid.Keys)) {
        $row = $snap.byPid[$key]
        if ([int]$row.ParentProcessId -ne $ParentId) { continue }
        $childId = [int]$row.ProcessId
        if ($childId -le 0) { continue }
        if ($childId -eq $ParentId) {
            [void]$rejected.Add('selfParent pid=' + [string]$childId)
            continue
        }
        $childBorn = Get-ProcessCreationUtc -ProcessRow $row
        if ($null -eq $childBorn) {
            $message = 'missing process identity evidence: creation time unavailable for child pid ' + [string]$childId + ' of parent pid ' + [string]$ParentId
            [void]$problems.Add($message)
            if ($Strict) { throw $message }
            continue
        }
        $childBornUtc = ([DateTime]$childBorn).ToUniversalTime()
        if ($childBornUtc -lt $parentBornUtc.AddMilliseconds(-$script:ProcessIdentitySlackMs)) {
            # The child existed before the parent was created, so it belongs to
            # an earlier process that once held the parent's PID. Reject the link.
            [void]$rejected.Add('staleChildBeforeParent pid=' + [string]$childId + ' parent=' + [string]$ParentId)
            continue
        }
        if (($Depth -eq 0) -and ($null -ne $DirectChildCreatedNotAfterUtc)) {
            $boundUtc = ([DateTime]$DirectChildCreatedNotAfterUtc).ToUniversalTime()
            if ($childBornUtc -gt $boundUtc.AddMilliseconds($script:ProcessIdentitySlackMs)) {
                # The captured parent had already exited, so it cannot have
                # created this child; the PID was recycled after exit.
                [void]$rejected.Add('staleChildAfterParentExit pid=' + [string]$childId + ' parent=' + [string]$ParentId)
                continue
            }
        }
        $generation = $null
        if ($null -eq $GenerationRegistry) {
            $generation = New-ProcessGenerationRecord -Id $childId -CreationUtc $childBornUtc -Depth $Depth -ParentId $ParentId -ParentCreationUtc $parentBornUtc -ParentKey $ParentGenerationKey -SnapshotOrdinal $SnapshotOrdinal -Classification 'unregisteredObservation'
        }
        else {
            $generation = Resolve-ProcessGeneration -Id $childId -CreationUtc $childBornUtc -Depth $Depth -ParentId $ParentId -ParentCreationUtc $parentBornUtc -ParentKey $ParentGenerationKey -Registry $GenerationRegistry -KeysByPid $GenerationKeysByPid -ProblemSink $problems -ReuseSink $ReuseSink -NoteSink $NoteSink -SnapshotOrdinal $SnapshotOrdinal
        }
        if ($null -eq $generation) { continue }
        $generationKey = [string]$generation.key
        if ($seenKeys.ContainsKey($generationKey)) { continue }
        $seenKeys[$generationKey] = $true
        [void]$generations.Add($generation)
        $nested = @(Get-DescendantGenerations -ParentId $childId -ParentCreationUtc ([DateTime]$generation.creationUtcValue) -Depth ($Depth + 1) -Strict:$Strict -Snapshot $snap -ProblemSink $problems -RejectedSink $rejected -GenerationRegistry $GenerationRegistry -GenerationKeysByPid $GenerationKeysByPid -ReuseSink $ReuseSink -NoteSink $NoteSink -ParentGenerationKey $generationKey -SnapshotOrdinal $SnapshotOrdinal)
        foreach ($n in $nested) {
            $nestedKey = [string]$n.key
            if (-not $seenKeys.ContainsKey($nestedKey)) {
                $seenKeys[$nestedKey] = $true
                [void]$generations.Add($n)
            }
        }
    }
    return @($generations)
}

# Backward-compatible PID view of a descendant walk. PID lists are reporting
# only; callers that make survival decisions must use Get-DescendantGenerations.
# The first observed generation for each PID wins in CreationUtcByPidSink; a
# later generation with the same PID never overwrites it.
function Get-DescendantPids {
    param(
        [Parameter(Mandatory)][int]$ParentId,
        [AllowNull()]$ParentCreationUtc = $null,
        [int]$Depth = 0,
        [switch]$Strict,
        [AllowNull()]$Snapshot = $null,
        [AllowNull()][System.Collections.ArrayList]$ProblemSink = $null,
        [AllowNull()][System.Collections.ArrayList]$RejectedSink = $null,
        [AllowNull()]$DirectChildCreatedNotAfterUtc = $null,
        [AllowNull()]$CreationUtcByPidSink = $null
    )
    $generations = @(Get-DescendantGenerations -ParentId $ParentId -ParentCreationUtc $ParentCreationUtc -Depth $Depth -Strict:$Strict -Snapshot $Snapshot -ProblemSink $ProblemSink -RejectedSink $RejectedSink -DirectChildCreatedNotAfterUtc $DirectChildCreatedNotAfterUtc)
    $pids = New-Object System.Collections.ArrayList
    foreach ($generation in $generations) {
        $generationPid = [int]$generation.pid
        if ($generationPid -le 0) { continue }
        if (-not $pids.Contains($generationPid)) { [void]$pids.Add($generationPid) }
        if ($null -ne $CreationUtcByPidSink) {
            if (-not $CreationUtcByPidSink.ContainsKey($generationPid)) {
                $CreationUtcByPidSink[$generationPid] = [DateTime]$generation.creationUtcValue
            }
        }
    }
    return @($pids | Sort-Object)
}

# State of a *specific* process identity, not of a PID. 'reused' means the PID
# now belongs to a different process, so the tracked process is gone. 'unknown'
# is never treated as gone by the callers below: an unanswerable or unbound
# identity keeps a gate closed.
function Get-PidIdentityState {
    param(
        [Parameter(Mandatory)][int]$Id,
        [AllowNull()]$CreationUtc = $null
    )
    if ($Id -le 0) { return 'gone' }
    $state = Get-PidState -Id $Id
    if ($state -ne 'alive') { return $state }
    if ($null -eq $CreationUtc) { return 'unknown' }
    $rows = @()
    try { $rows = @(Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId=' + $Id) -ErrorAction Stop) }
    catch { return 'unknown' }
    if (@($rows).Count -eq 0) { return 'gone' }
    if (@($rows).Count -gt 1) { return 'unknown' }
    $born = Get-ProcessCreationUtc -ProcessRow $rows[0]
    if ($null -eq $born) { return 'unknown' }
    if (([DateTime]$born).ToUniversalTime() -ne ([DateTime]$CreationUtc).ToUniversalTime()) { return 'reused' }
    return 'alive'
}

# Identity-aware liveness used by every poll. Without CreationUtcById this is
# plain PID liveness (callers that have no identity evidence to offer).
function Test-PidIdentityAlive {
    param(
        [Parameter(Mandatory)][int]$Id,
        [AllowNull()]$CreationUtcById = $null
    )
    if ($null -eq $CreationUtcById) {
        return ((Get-PidState -Id $Id) -ne 'gone')
    }
    $born = $null
    if ($CreationUtcById.ContainsKey($Id)) { $born = $CreationUtcById[$Id] }
    $state = Get-PidIdentityState -Id $Id -CreationUtc $born
    return (($state -ne 'gone') -and ($state -ne 'reused'))
}

function Get-SurvivingPids {
    param(
        [AllowEmptyCollection()][int[]]$Candidate = @(),
        [AllowNull()]$CreationUtcById = $null
    )
    $alive = New-Object System.Collections.ArrayList
    foreach ($c in $Candidate) {
        $candidateId = [int]$c
        if ($candidateId -le 0) { continue }
        if ($candidateId -eq $PID) { continue }
        if (Test-PidIdentityAlive -Id $candidateId -CreationUtcById $CreationUtcById) { [void]$alive.Add($candidateId) }
    }
    return @($alive)
}

function Wait-ForPidsGone {
    param(
        [AllowEmptyCollection()][int[]]$Ids = @(),
        [Parameter(Mandatory)][int]$TimeoutMilliseconds,
        [Parameter(Mandatory)][int]$PollMilliseconds,
        [AllowNull()]$CreationUtcById = $null
    )
    $targets = @($Ids | Where-Object { [int]$_ -gt 0 } | Sort-Object -Unique)
    if ($targets.Count -eq 0) { return @() }
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    while ($true) {
        $alive = New-Object System.Collections.ArrayList
        foreach ($t in $targets) {
            if (Test-PidIdentityAlive -Id ([int]$t) -CreationUtcById $CreationUtcById) { [void]$alive.Add([int]$t) }
        }
        if ($alive.Count -eq 0) { return @() }
        if ($watch.ElapsedMilliseconds -ge $TimeoutMilliseconds) { break }
        Start-Sleep -Milliseconds $PollMilliseconds
    }
    $stillAlive = New-Object System.Collections.ArrayList
    foreach ($t in $targets) {
        if (Test-PidIdentityAlive -Id ([int]$t) -CreationUtcById $CreationUtcById) { [void]$stillAlive.Add([int]$t) }
    }
    return @($stillAlive)
}

# Identity of one recorded generation. 'unknown' (a failed or unbound query) is
# treated as alive: an unanswerable identity must never be reported as safe
# absence. A generation whose PID now belongs to a different process is
# 'reused', which means the tracked process is gone.
function Test-GenerationAlive {
    param([AllowNull()]$Generation = $null)
    if ($null -eq $Generation) { return $false }
    $generationPid = 0
    try { $generationPid = [int]$Generation.pid } catch { return $true }
    if ($generationPid -le 0) { return $false }
    if ($generationPid -eq $PID) { return $false }
    $born = $null
    try {
        $property = $Generation.PSObject.Properties['creationUtcValue']
        if ($null -ne $property) { $born = [DateTime]$property.Value }
    }
    catch { $born = $null }
    if ($null -eq $born) {
        # A generation without a usable creation time cannot be proven gone.
        $state = Get-PidState -Id $generationPid
        return ($state -ne 'gone')
    }
    $state = Get-PidIdentityState -Id $generationPid -CreationUtc $born
    return (($state -eq 'alive') -or ($state -eq 'unknown'))
}

# Generation-aware replacement for Wait-ForPidsGone. Each recorded generation is
# checked against its own creation time, so a later process that reuses a PID
# neither counts as the original still running nor hides a verified descendant
# that is genuinely alive. Returns the generation records still alive.
function Wait-ForGenerationsGone {
    param(
        [AllowEmptyCollection()][object[]]$Generations = @(),
        [Parameter(Mandatory)][int]$TimeoutMilliseconds,
        [Parameter(Mandatory)][int]$PollMilliseconds
    )
    $targets = @($Generations | Where-Object { $null -ne $_ })
    if ($targets.Count -eq 0) { return @() }
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    while ($true) {
        $alive = New-Object System.Collections.ArrayList
        foreach ($generation in $targets) {
            if (Test-GenerationAlive -Generation $generation) { [void]$alive.Add($generation) }
        }
        if ($alive.Count -eq 0) { return @() }
        if ($watch.ElapsedMilliseconds -ge $TimeoutMilliseconds) { break }
        Start-Sleep -Milliseconds $PollMilliseconds
    }
    $stillAlive = New-Object System.Collections.ArrayList
    foreach ($generation in $targets) {
        if (Test-GenerationAlive -Generation $generation) { [void]$stillAlive.Add($generation) }
    }
    return @($stillAlive)
}

# Generation-aware final-survivor decision. Used after the grace wait, so a
# descendant that was alive then is re-checked against its own creation time.
function Get-SurvivingGenerations {
    param([AllowEmptyCollection()][object[]]$Generations = @())
    $alive = New-Object System.Collections.ArrayList
    foreach ($generation in $Generations) {
        if ($null -eq $generation) { continue }
        if (Test-GenerationAlive -Generation $generation) { [void]$alive.Add($generation) }
    }
    return @($alive)
}

function Assert-NoWhitespaceArgs {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$Vector,
        [AllowEmptyCollection()][string[]]$ArgumentList = @()
    )
    foreach ($a in $ArgumentList) {
        if ([string]::IsNullOrEmpty($a)) {
            throw ('refused: empty argument in vector ' + $Vector)
        }
        if ($a -match '[\s"]') {
            throw ('refused: argument requires shell quoting in vector ' + $Vector)
        }
    }
}

function Assert-ApprovedVector {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$Vector,
        [AllowEmptyCollection()][string[]]$ArgumentList = @()
    )
    $match = $null
    foreach ($spec in $script:ApprovedSpecs) {
        if ([string]$spec.vector -ceq $Vector) { $match = $spec; break }
    }
    if ($null -eq $match) {
        throw ('refused: vector is not one of the three approved offline commands: ' + $Vector)
    }
    $expected = @($match.args)
    $actual = @($ArgumentList)
    if ($expected.Count -ne $actual.Count) {
        throw ('refused: argument count mismatch for ' + $Vector)
    }
    for ($i = 0; $i -lt $expected.Count; $i++) {
        if ([string]$expected[$i] -cne [string]$actual[$i]) {
            throw ('refused: argument mismatch at index ' + $i + ' for ' + $Vector)
        }
    }
    Assert-NoWhitespaceArgs -Vector $Vector -ArgumentList $actual
    return $match
}

function New-StepRecord {
    param(
        [Parameter(Mandatory)][string]$Id,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Vector,
        [Parameter(Mandatory)][ValidateSet('pending', 'passed', 'failed', 'notRun')][string]$State
    )
    return [pscustomobject]@{
        id = [string]$Id
        vector = [string]$Vector
        state = [string]$State
        started = $false
        pid = 0
        exited = $false
        exitCode = -1
        exitCodeObserved = $false
        terminated = $false
        timedOut = $false
        spawnError = ''
        terminationError = ''
        stdoutPath = ''
        stderrPath = ''
        stdoutBytes = 0
        stderrBytes = 0
        stdoutSha256 = ''
        stderrSha256 = ''
        exit0 = $false
        descendantsSpawnedObserved = 0
        descendantGenerationsObserved = 0
        descendantGenerations = @()
        descendantReuseCount = 0
        descendantReuseEvents = @()
        descendantIdentityNotes = @()
        descendantsAliveAfterGrace = @()
        descendantsAliveAfterGraceGenerationKeys = @()
        descendantsAliveAtVerdict = @()
        descendantsAliveAtVerdictGenerationKeys = @()
        noSurvivors = $false
        checks = @()
        failedChecks = @()
        checkCount = 0
        completed = $false
        observed = $null
    }
}

function Set-StepGate {
    param(
        [Parameter(Mandatory)]$Record,
        [Parameter(Mandatory)]$ProcessResult,
        [AllowEmptyCollection()][object[]]$Checks = @(),
        [AllowEmptyCollection()][int[]]$DescendantsAliveAtVerdict = @(),
        [AllowEmptyCollection()][string[]]$DescendantsAliveAtVerdictGenerationKeys = @()
    )
    $Record.started = [bool]$ProcessResult.started
    $Record.pid = [int]$ProcessResult.pid
    $Record.exited = [bool]$ProcessResult.exited
    $Record.exitCode = [int]$ProcessResult.exitCode
    $Record.exitCodeObserved = [bool]$ProcessResult.exitCodeObserved
    $Record.terminated = [bool]$ProcessResult.terminationConfirmed
    $Record.timedOut = [bool]$ProcessResult.timedOut
    $Record.spawnError = [string]$ProcessResult.spawnError
    $Record.terminationError = [string]$ProcessResult.terminationError
    $Record.stdoutPath = [string]$ProcessResult.stdoutPath
    $Record.stderrPath = [string]$ProcessResult.stderrPath
    $Record.stdoutBytes = [int]$ProcessResult.stdoutBytes
    $Record.stderrBytes = [int]$ProcessResult.stderrBytes
    $Record.stdoutSha256 = [string]$ProcessResult.stdoutSha256
    $Record.stderrSha256 = [string]$ProcessResult.stderrSha256
    $Record.descendantsSpawnedObserved = [int]$ProcessResult.descendantsSpawnedObserved
    # Generation-aware identity evidence is additive: the PID-list fields above
    # keep their historical shape, and these fields carry the authoritative
    # (pid, creation time) generations plus the reuse history behind them.
    $Record.descendantGenerationsObserved = [int]$ProcessResult.descendantGenerationsObserved
    $Record.descendantGenerations = @(@($ProcessResult.descendantGenerations) | Where-Object { $null -ne $_ })
    $Record.descendantReuseEvents = @(@($ProcessResult.descendantReuseEvents) | Where-Object { $null -ne $_ })
    $Record.descendantReuseCount = $Record.descendantReuseEvents.Count
    $Record.descendantIdentityNotes = @(@($ProcessResult.descendantIdentityNotes) | Where-Object { $null -ne $_ })
    $Record.descendantsAliveAfterGrace = @($ProcessResult.descendantsAliveAfterGrace)
    $Record.descendantsAliveAfterGraceGenerationKeys = @(@($ProcessResult.descendantsAliveAfterGraceGenerationKeys) | Where-Object { $null -ne $_ })
    $Record.descendantsAliveAtVerdict = @($DescendantsAliveAtVerdict)
    $Record.descendantsAliveAtVerdictGenerationKeys = @(@($DescendantsAliveAtVerdictGenerationKeys) | Where-Object { $null -ne $_ })
    $Record.checks = @($Checks)
    $failed = New-Object System.Collections.ArrayList
    foreach ($c in $Checks) {
        if ($null -eq $c) { continue }
        if (-not [bool]$c.ok) { [void]$failed.Add([string]$c.id) }
    }
    $Record.failedChecks = @($failed)
    $Record.checkCount = @($Checks).Count
    $Record.exit0 = ([bool]$ProcessResult.exitCodeObserved -and ([int]$ProcessResult.exitCode -eq 0))
    $Record.noSurvivors = (@($DescendantsAliveAtVerdict).Count -eq 0)
    # terminationError covers an incomplete output drain, a faulted stream copy, a
    # failed output write and an unanswerable descendant query. A step that cannot
    # prove its own evidence is not a completed step.
    $ok = (
        $Record.started -and
        $Record.terminated -and
        $Record.exitCodeObserved -and
        $Record.exit0 -and
        (-not $Record.timedOut) -and
        ($Record.spawnError -eq '') -and
        ($Record.terminationError -eq '') -and
        $Record.noSurvivors -and
        ($Record.checkCount -gt 0) -and
        (@($failed).Count -eq 0)
    )
    if ($ok) { $Record.state = 'passed' } else { $Record.state = 'failed' }
    $Record.completed = [bool]$ok
    return $Record
}

# Append a capture-integrity note to a process result. Every note lands in
# terminationError, and Set-StepGate now refuses to complete a step whose
# terminationError is non-empty, so a capture that cannot be drained or written
# completely can never be reported as a completed step.
function Add-CaptureError {
    param(
        [Parameter(Mandatory)]$Result,
        [AllowEmptyString()][string]$Note = ''
    )
    if ([string]::IsNullOrWhiteSpace($Note)) { return }
    if ([string]$Result.terminationError -eq '') { $Result.terminationError = [string]$Note }
    else { $Result.terminationError = [string]$Result.terminationError + '; ' + [string]$Note }
}

# Snapshot a capture buffer that may still be receiving bytes. The drain is
# bounded, so a descendant that inherited the pipe can still hold it open when
# the deadline expires. MemoryStream.ToArray() copies the internal array while
# reading its length more than once; a concurrent append can make those reads
# disagree, so retry a bounded number of times instead of letting that transient
# error escape the capture.
#
# The unary comma stops PowerShell from enumerating the array into the pipeline.
# An enumerated byte array arrives as $null when empty, as a scalar Byte when it
# holds one element, and as Object[] otherwise; all three shapes break
# File.WriteAllBytes, which is exactly how a zero-byte fixture once produced no
# evidence file at all. If the snapshot keeps failing this throws, so the caller
# records a capture failure instead of writing a silent fallback.
function Get-BufferSnapshot {
    param([Parameter(Mandatory)]$Buffer)
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        try { return ,([byte[]]$Buffer.ToArray()) }
        catch { Start-Sleep -Milliseconds 10 }
    }
    return ,([byte[]]$Buffer.ToArray())
}

# S5 observability helpers (diagnostics-only, added for the S5 child-lifecycle
# investigation). Every call is a no-op unless a DiagnosticPath or
# DiagnosticSink is supplied, so real evidence-capture runs (which pass
# neither) execute identical capture logic with identical results. Trace lines
# are single-line ASCII-safe `utc=.. src=.. rel=.. phase=.. event=..` records;
# the file write is best-effort and can never fail or alter a capture.
function Get-TraceUtc {
    return (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
}

function ConvertTo-PidSetText {
    param([AllowEmptyCollection()][int[]]$Ids = @())
    $v = @($Ids | Where-Object { [int]$_ -gt 0 } | Sort-Object -Unique)
    if ($v.Count -eq 0) { return 'none' }
    return (@($v) -join '|')
}

function Add-S5DiagnosticEvent {
    param(
        [AllowEmptyString()][string]$Path = '',
        [AllowEmptyCollection()][System.Collections.ArrayList]$Sink = $null,
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Text,
        [long]$RelMs = -1
    )
    $core = [string]$Text
    if ($RelMs -ge 0) { $core = ('rel=' + [string]$RelMs + ' ' + $core) }
    $line = ('utc=' + (Get-TraceUtc) + ' src=' + [string]$Source + ' ' + $core)
    if (-not [string]::IsNullOrWhiteSpace($Path)) {
        try {
            [System.IO.File]::AppendAllText($Path, $line + "`n", (New-Object System.Text.UTF8Encoding($false)))
        }
        catch { }
    }
    if ($null -ne $Sink) { [void]$Sink.Add($line) }
}

function Invoke-CapturedProcess {
    param(
        [Parameter(Mandatory)][string]$Exe,
        [AllowEmptyCollection()][string[]]$Arguments = @(),
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [Parameter(Mandatory)][string]$StdoutPath,
        [Parameter(Mandatory)][string]$StderrPath,
        [Parameter(Mandatory)][int]$TimeoutMilliseconds,
        [int]$KillGraceMilliseconds = 10000,
        [int]$PollMilliseconds = 250,
        [AllowEmptyString()][string]$DiagnosticPath = '',
        [AllowEmptyCollection()][System.Collections.ArrayList]$DiagnosticSink = $null
    )
    $result = [pscustomobject]@{
        started = $false
        pid = 0
        exited = $false
        exitCode = -1
        exitCodeObserved = $false
        terminationConfirmed = $false
        timedOut = $false
        spawnError = ''
        terminationError = ''
        stdoutPath = [string]$StdoutPath
        stderrPath = [string]$StderrPath
        stdoutBytes = 0
        stderrBytes = 0
        stdoutSha256 = ''
        stderrSha256 = ''
        durationMs = 0
        descendantsSpawnedObserved = 0
        descendantQueryFailures = 0
        descendantsAliveAfterGrace = @()
        rootCreationUtc = ''
        descendantCreationUtcById = @{}
        descendantStaleLinksRejected = 0
        descendantIdentityProblems = @()
        descendantGenerationsObserved = 0
        descendantGenerations = @()
        descendantReuseEvents = @()
        descendantIdentityNotes = @()
        descendantsAliveAfterGraceGenerations = @()
        descendantsAliveAfterGraceGenerationKeys = @()
    }

    # The child is started through ProcessStartInfo rather than Start-Process.
    # Windows PowerShell 5.1's Start-Process -PassThru returns a process object
    # whose ExitCode reads 0 for a child that really exited nonzero (the same
    # fixture returned 0 through Start-Process and 7 through ProcessStartInfo).
    # Output is copied asynchronously into two buffers, so a descendant that
    # inherits the pipe cannot block the capture; the buffers are written to the
    # evidence files only after the bounded drain, so the hashes below describe
    # exactly the bytes that were written.
    $proc = $null
    $stdoutBuffer = $null
    $stderrBuffer = $null
    $stdoutTask = $null
    $stderrTask = $null
    try {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $Exe
        # Same command line Start-Process built for an -ArgumentList array:
        # elements joined with single spaces, no extra quoting.
        $psi.Arguments = (@($Arguments) -join ' ')
        if (-not [string]::IsNullOrWhiteSpace($WorkingDirectory)) { $psi.WorkingDirectory = $WorkingDirectory }
        $psi.UseShellExecute = $false
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.CreateNoWindow = $true
        $proc = New-Object System.Diagnostics.Process
        $proc.StartInfo = $psi
        [void]$proc.Start()
        $stdoutBuffer = New-Object System.IO.MemoryStream
        $stderrBuffer = New-Object System.IO.MemoryStream
        $stdoutTask = $proc.StandardOutput.BaseStream.CopyToAsync($stdoutBuffer)
        $stderrTask = $proc.StandardError.BaseStream.CopyToAsync($stderrBuffer)
    }
    catch {
        $result.spawnError = [string]$_.Exception.Message
        # Never leave a half-started child behind.
        if ($null -ne $proc) {
            try { if (-not $proc.HasExited) { $proc.Kill() } } catch { }
            try { $proc.Dispose() } catch { }
        }
        return $result
    }

    $result.started = $true
    $result.pid = [int]$proc.Id
    # Bind the captured process to its creation time while its handle is still
    # open. Without this binding the descendant walk cannot tell this process
    # from a later process that recycles the same PID.
    $rootCreationUtc = $null
    try { $rootCreationUtc = $proc.StartTime.ToUniversalTime() } catch { $rootCreationUtc = $null }
    $identityProblems = New-Object System.Collections.ArrayList
    $staleLinks = New-Object System.Collections.ArrayList
    # Step-scoped generation registry: every process generation observed during
    # this step, kept for the whole step and never overwritten. A PID alone is
    # never used as an identity.
    $generationRegistry = New-Object System.Collections.Specialized.OrderedDictionary
    $generationKeysByPid = @{}
    $reuseEvents = New-Object System.Collections.ArrayList
    $identityNotes = New-Object System.Collections.ArrayList
    $snapshotOrdinal = 0
    if ($null -eq $rootCreationUtc) {
        Add-CaptureError -Result $result -Note 'missing process identity evidence: creation time of the captured process could not be read'
    }
    else { $result.rootCreationUtc = ([DateTime]$rootCreationUtc).ToString('o') }
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $descendants = New-Object System.Collections.ArrayList
    $descendantGenerations = New-Object System.Collections.ArrayList
    $seenGenerationKeys = @{}
    $diagOn = ((-not [string]::IsNullOrWhiteSpace($DiagnosticPath)) -or ($null -ne $DiagnosticSink))
    Add-S5DiagnosticEvent -Path $DiagnosticPath -Sink $DiagnosticSink -Source 'capture' -RelMs 0 -Text ('phase=start pid=' + [string][int]$proc.Id + ' createdUtc=' + $(if ($null -eq $rootCreationUtc) { 'unavailable' } else { ([DateTime]$rootCreationUtc).ToString('o') }) + ' timeoutMs=' + [string]$TimeoutMilliseconds + ' killGraceMs=' + [string]$KillGraceMilliseconds + ' pollMs=' + [string]$PollMilliseconds)

    while (-not $proc.HasExited) {
        $queryWatch = [System.Diagnostics.Stopwatch]::StartNew()
        $snapshotOrdinal = $snapshotOrdinal + 1
        $loopGenerations = @(Get-DescendantGenerations -ParentId ([int]$proc.Id) -ParentCreationUtc $rootCreationUtc -ProblemSink $identityProblems -RejectedSink $staleLinks -GenerationRegistry $generationRegistry -GenerationKeysByPid $generationKeysByPid -ReuseSink $reuseEvents -NoteSink $identityNotes -SnapshotOrdinal $snapshotOrdinal)
        $loopPids = @($loopGenerations | ForEach-Object { [int]$_.pid } | Sort-Object -Unique)
        Add-S5DiagnosticEvent -Path $DiagnosticPath -Sink $DiagnosticSink -Source 'capture' -RelMs $watch.ElapsedMilliseconds -Text ('phase=mainloop event=query ms=' + [string]$queryWatch.ElapsedMilliseconds + ' pids=' + (ConvertTo-PidSetText -Ids $loopPids) + ' generations=' + [string](@($loopGenerations).Count) + ' staleRejected=' + [string]@($staleLinks).Count + ' reuse=' + [string]@($reuseEvents).Count + ' identityProblems=' + [string]@($identityProblems).Count)
        foreach ($loopGeneration in $loopGenerations) {
            $loopGenerationKey = [string]$loopGeneration.key
            if ($seenGenerationKeys.ContainsKey($loopGenerationKey)) { continue }
            $seenGenerationKeys[$loopGenerationKey] = $true
            [void]$descendantGenerations.Add($loopGeneration)
            if (-not $descendants.Contains([int]$loopGeneration.pid)) {
                [void]$descendants.Add([int]$loopGeneration.pid)
            }
            Add-S5DiagnosticEvent -Path $DiagnosticPath -Sink $DiagnosticSink -Source 'capture' -RelMs $watch.ElapsedMilliseconds -Text ('phase=mainloop event=firstseen pid=' + [string][int]$loopGeneration.pid + ' born=' + [string]$loopGeneration.creationUtc + ' generation=' + [string]$loopGeneration.classification + ' depth=' + [string][int]$loopGeneration.depth)
        }
        if ($watch.ElapsedMilliseconds -ge $TimeoutMilliseconds) {
            $result.timedOut = $true
            try { $proc.Kill() } catch { $result.terminationError = [string]$_.Exception.Message }
            break
        }
        Start-Sleep -Milliseconds $PollMilliseconds
    }
    Add-S5DiagnosticEvent -Path $DiagnosticPath -Sink $DiagnosticSink -Source 'capture' -RelMs $watch.ElapsedMilliseconds -Text ('phase=parent event=loopbreak exited=' + [string][bool]$proc.HasExited + ' timedOut=' + [string]$result.timedOut)

    try {
        if ($proc.WaitForExit($KillGraceMilliseconds)) {
            # Read ExitCode from the process we started and waited for. Do not
            # re-resolve or refresh it: the exit state must come from this handle.
            $result.exitCode = [int]$proc.ExitCode
            $result.exited = $true
            $result.exitCodeObserved = $true
        }
    }
    catch {
        $result.terminationError = [string]$_.Exception.Message
    }
    # Upper bound for a genuine direct child: the parent cannot have created a
    # child after it stopped. The bound is taken now, which is at or after the
    # real exit, so it can admit a late child but never reject one.
    $parentExitBoundUtc = [DateTime]::UtcNow

    # Bounded post-exit observation: a descendant created just before the parent exited can appear in
    # WMI slightly late, and a transient query error must not be mistaken for confirmed absence.
    # Descendants are never terminated here; the grace/drain policy below is unchanged.
    $settleWatch = [System.Diagnostics.Stopwatch]::StartNew()
    $descendantQueryError = ''
    $descendantQueryFailures = 0
    while ($true) {
        $settleQueryWatch = [System.Diagnostics.Stopwatch]::StartNew()
        $settleGenerations = @()
        try {
            $snapshotOrdinal = $snapshotOrdinal + 1
            $settleGenerations = @(Get-DescendantGenerations -ParentId ([int]$proc.Id) -ParentCreationUtc $rootCreationUtc -Strict -ProblemSink $identityProblems -RejectedSink $staleLinks -DirectChildCreatedNotAfterUtc $parentExitBoundUtc -GenerationRegistry $generationRegistry -GenerationKeysByPid $generationKeysByPid -ReuseSink $reuseEvents -NoteSink $identityNotes -SnapshotOrdinal $snapshotOrdinal)
            foreach ($settleGeneration in $settleGenerations) {
                $settleGenerationKey = [string]$settleGeneration.key
                if ($seenGenerationKeys.ContainsKey($settleGenerationKey)) { continue }
                $seenGenerationKeys[$settleGenerationKey] = $true
                [void]$descendantGenerations.Add($settleGeneration)
                if (-not $descendants.Contains([int]$settleGeneration.pid)) {
                    [void]$descendants.Add([int]$settleGeneration.pid)
                }
                Add-S5DiagnosticEvent -Path $DiagnosticPath -Sink $DiagnosticSink -Source 'capture' -RelMs $watch.ElapsedMilliseconds -Text ('phase=settle event=firstseen pid=' + [string][int]$settleGeneration.pid + ' born=' + [string]$settleGeneration.creationUtc + ' generation=' + [string]$settleGeneration.classification + ' depth=' + [string][int]$settleGeneration.depth)
            }
            $descendantQueryError = ''
            Add-S5DiagnosticEvent -Path $DiagnosticPath -Sink $DiagnosticSink -Source 'capture' -RelMs $watch.ElapsedMilliseconds -Text ('phase=settle event=query ms=' + [string]$settleQueryWatch.ElapsedMilliseconds + ' pids=' + (ConvertTo-PidSetText -Ids @($settleGenerations | ForEach-Object { [int]$_.pid } | Sort-Object -Unique)) + ' generations=' + [string](@($settleGenerations).Count) + ' failures=' + [string]$descendantQueryFailures)
        }
        catch {
            $descendantQueryFailures = $descendantQueryFailures + 1
            if ($descendantQueryError -eq '') { $descendantQueryError = [string]$_.Exception.Message }
            Add-S5DiagnosticEvent -Path $DiagnosticPath -Sink $DiagnosticSink -Source 'capture' -RelMs $watch.ElapsedMilliseconds -Text ('phase=settle event=queryerror ms=' + [string]$settleQueryWatch.ElapsedMilliseconds + ' failures=' + [string]$descendantQueryFailures + ' msg=' + (($descendantQueryError) -replace '\s+', '_'))
        }
        if ($descendants.Count -gt 0) { break }
        if ($settleWatch.ElapsedMilliseconds -ge 3000) { break }
        Start-Sleep -Milliseconds 200
    }
    Add-S5DiagnosticEvent -Path $DiagnosticPath -Sink $DiagnosticSink -Source 'capture' -RelMs $watch.ElapsedMilliseconds -Text ('phase=settle event=done count=' + [string]$descendants.Count + ' pids=' + (ConvertTo-PidSetText -Ids @($descendants)) + ' ms=' + [string]$settleWatch.ElapsedMilliseconds)
    if (($descendants.Count -eq 0) -and ($descendantQueryError -ne '')) {
        $result.terminationError = ('descendant query failed: ' + $descendantQueryError)
    }
    # Missing or conflicting identity evidence is never "nothing to do": every
    # problem is recorded as a capture error so the step cannot complete. A
    # verified sequential PID reuse is not a problem: it is recorded as its own
    # event, and every generation keeps its original creation time.
    $result.descendantIdentityProblems = @($identityProblems)
    $result.descendantStaleLinksRejected = @($staleLinks).Count
    $result.descendantGenerationsObserved = @($descendantGenerations).Count
    $result.descendantGenerations = @($descendantGenerations)
    $result.descendantReuseEvents = @($reuseEvents)
    $result.descendantIdentityNotes = @($identityNotes)
    # Backward-compatible PID-keyed map: the first generation recorded for each
    # PID wins, and a later generation never overwrites it. This map is reporting
    # only; grace and survivor decisions use the generation records above.
    $firstGenerationByPid = @{}
    foreach ($generation in @($descendantGenerations)) {
        if (-not $firstGenerationByPid.ContainsKey([int]$generation.pid)) {
            $firstGenerationByPid[[int]$generation.pid] = [DateTime]$generation.creationUtcValue
        }
    }
    $result.descendantCreationUtcById = $firstGenerationByPid
    if (@($identityProblems).Count -gt 0) {
        $firstProblems = @(@($identityProblems) | Select-Object -First 3)
        Add-CaptureError -Result $result -Note ('process identity evidence missing or conflicting: ' + (($firstProblems) -join '; '))
    }
    Add-S5DiagnosticEvent -Path $DiagnosticPath -Sink $DiagnosticSink -Source 'capture' -RelMs $watch.ElapsedMilliseconds -Text ('phase=identity event=summary rootUtc=' + $(if ($null -eq $rootCreationUtc) { 'unavailable' } else { ([DateTime]$rootCreationUtc).ToString('o') }) + ' descendants=' + [string]$descendants.Count + ' generations=' + [string](@($descendantGenerations).Count) + ' reuse=' + [string](@($reuseEvents).Count) + ' notes=' + [string](@($identityNotes).Count) + ' staleRejected=' + [string]@($staleLinks).Count + ' problems=' + [string]@($identityProblems).Count + ' bound=' + $parentExitBoundUtc.ToString('o'))
    $result.descendantQueryFailures = [int]$descendantQueryFailures
    $result.descendantsSpawnedObserved = $descendants.Count
    $graceWatch = [System.Diagnostics.Stopwatch]::StartNew()
    # Survivor detection is generation-bound: a PID that is alive but belongs to
    # a different process is not a survivor of this capture, and a PID reused by
    # a later verified descendant never hides that descendant.
    $graceAliveGenerations = @(Wait-ForGenerationsGone -Generations @($descendantGenerations) -TimeoutMilliseconds $KillGraceMilliseconds -PollMilliseconds $PollMilliseconds)
    $result.descendantsAliveAfterGraceGenerations = @($graceAliveGenerations)
    $result.descendantsAliveAfterGraceGenerationKeys = @($graceAliveGenerations | ForEach-Object { [string]$_.key })
    $result.descendantsAliveAfterGrace = @($graceAliveGenerations | ForEach-Object { [int]$_.pid } | Sort-Object -Unique)
    Add-S5DiagnosticEvent -Path $DiagnosticPath -Sink $DiagnosticSink -Source 'capture' -RelMs $watch.ElapsedMilliseconds -Text ('phase=grace event=done ms=' + [string]$graceWatch.ElapsedMilliseconds + ' survivors=' + [string](@($result.descendantsAliveAfterGrace).Count) + ' survivorGenerations=' + [string](@($graceAliveGenerations).Count) + ' pids=' + (ConvertTo-PidSetText -Ids @($result.descendantsAliveAfterGrace)))
    if ($diagOn) {
        # Diagnostic-only snapshot: one state query per observed generation, taken
        # immediately after the grace wait returns. It reads state; it never kills,
        # and it does not feed the grace result or any assertion.
        foreach ($generation in @($descendantGenerations)) {
            $graceState = 'unknown'
            try { $graceState = Get-PidIdentityState -Id ([int]$generation.pid) -CreationUtc ([DateTime]$generation.creationUtcValue) } catch { $graceState = 'queryerror' }
            Add-S5DiagnosticEvent -Path $DiagnosticPath -Sink $DiagnosticSink -Source 'capture' -RelMs $watch.ElapsedMilliseconds -Text ('phase=graceBoundary event=state pid=' + [string][int]$generation.pid + ' born=' + [string]$generation.creationUtc + ' state=' + $graceState)
        }
    }
    $result.durationMs = [int]$watch.ElapsedMilliseconds

    # The captured process counts as terminated when its own exit code was
    # observed and its identity is gone: absent, or the PID now belongs to a
    # different process. 'unknown' keeps the gate closed.
    $rootState = 'unknown'
    if ($null -eq $rootCreationUtc) { $rootState = Get-PidState -Id ([int]$proc.Id) }
    else { $rootState = Get-PidIdentityState -Id ([int]$proc.Id) -CreationUtc $rootCreationUtc }
    $result.terminationConfirmed = ($result.exitCodeObserved -and (($rootState -eq 'gone') -or ($rootState -eq 'reused')))

    # Bounded drain. The process has exited, but a descendant that inherited the
    # stdout/stderr pipes can keep them open indefinitely -- the exact shape that
    # deadlocked the v1 runner (see t6-deadlock-repro.ps1). We never wait for EOF
    # without a bound: whatever bytes arrived within the kill grace are the
    # captured evidence, and a truncated capture is recorded, never hidden.
    $drainWatch = [System.Diagnostics.Stopwatch]::StartNew()
    $drainTimedOut = $false
    while (-not ($stdoutTask.IsCompleted -and $stderrTask.IsCompleted)) {
        if ($drainWatch.ElapsedMilliseconds -ge $KillGraceMilliseconds) { $drainTimedOut = $true; break }
        Start-Sleep -Milliseconds 25
    }
    if ($drainTimedOut) {
        Add-CaptureError -Result $result -Note ('output drain timed out after ' + [string]$KillGraceMilliseconds + ' ms; captured bytes may be truncated')
        # Stop the asynchronous copies before snapshotting so the buffers are stable.
        try { $proc.StandardOutput.Dispose() } catch { }
        try { $proc.StandardError.Dispose() } catch { }
        Start-Sleep -Milliseconds 25
    }
    else {
        # A copy can complete with a failure (for example a broken pipe) without
        # ever tripping the drain deadline; that is still an incomplete capture.
        if ($stdoutTask.IsFaulted) { Add-CaptureError -Result $result -Note ('stdout capture faulted: ' + [string]$stdoutTask.Exception.GetBaseException().Message) }
        if ($stderrTask.IsFaulted) { Add-CaptureError -Result $result -Note ('stderr capture faulted: ' + [string]$stderrTask.Exception.GetBaseException().Message) }
    }

    # The two streams are written independently: a failure on one stream must never
    # discard the other stream's evidence.
    try {
        [System.IO.File]::WriteAllBytes($StdoutPath, (Get-BufferSnapshot -Buffer $stdoutBuffer))
    }
    catch {
        Add-CaptureError -Result $result -Note ('stdout capture write failed: ' + [string]$_.Exception.Message)
    }
    try {
        [System.IO.File]::WriteAllBytes($StderrPath, (Get-BufferSnapshot -Buffer $stderrBuffer))
    }
    catch {
        Add-CaptureError -Result $result -Note ('stderr capture write failed: ' + [string]$_.Exception.Message)
    }
    try { $stdoutBuffer.Dispose() } catch { }
    try { $stderrBuffer.Dispose() } catch { }
    try { $proc.Dispose() } catch { }

    # Hashes are computed from the files after capture has completed.
    $stdoutFp = Get-FileFingerprint -Path $StdoutPath
    $stderrFp = Get-FileFingerprint -Path $StderrPath
    $result.stdoutBytes = [int]$stdoutFp.bytes
    $result.stderrBytes = [int]$stderrFp.bytes
    $result.stdoutSha256 = [string]$stdoutFp.sha256
    $result.stderrSha256 = [string]$stderrFp.sha256
    return $result
}

# ---------------------------------------------------------------------------
# stderr policy and output validators
# ---------------------------------------------------------------------------
function Get-StderrChecks {
    param(
        [Parameter(Mandatory)][string]$Variant,
        [Parameter(Mandatory)][string]$StderrPath,
        [AllowEmptyCollection()][string[]]$AllowPatterns = @()
    )
    $checks = New-Object System.Collections.ArrayList
    $exists = Test-Path -LiteralPath $StderrPath -PathType Leaf
    $fp = Get-FileFingerprint -Path $StderrPath
    [void](Add-Check -List $checks -Id ($Variant + '.stderr.file') -Ok $exists -Detail $StderrPath)
    [void](Add-Check -List $checks -Id ($Variant + '.stderr.empty') -Ok ($exists -and ([int]$fp.bytes -eq 0)) -Detail ('bytes=' + [int]$fp.bytes))
    $text = Read-TextFile -Path $StderrPath
    $unmatched = New-Object System.Collections.ArrayList
    foreach ($line in @($text -split "`r?`n")) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $hit = $false
        foreach ($p in $AllowPatterns) {
            if ($line -match $p) { $hit = $true; break }
        }
        if (-not $hit) { [void]$unmatched.Add([string]$line) }
    }
    [void](Add-Check -List $checks -Id ($Variant + '.stderr.noUnexpectedLines') -Ok (@($unmatched).Count -eq 0) -Detail ('unexpected=' + @($unmatched).Count + ' allowlist=' + $AllowPatterns.Count))
    return @($checks)
}

function Get-TapReport {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$Path,
        [Parameter(Mandatory)][int]$ExpectedTests
    )
    $report = [pscustomobject]@{
        exists = $false
        hasVersion = $false
        counts = @{}
        okLines = 0
        notOkLines = 0
        numberingOk = $false
        skipDirectives = 0
        todoDirectives = 0
        issues = @()
    }
    $report.exists = Test-Path -LiteralPath $Path -PathType Leaf
    if (-not $report.exists) { return $report }
    $text = Read-TextFile -Path $Path
    $report.hasVersion = [regex]::IsMatch($text, '(?m)^TAP version 13\s*$')

    $points = [regex]::Matches($text, '(?m)^(ok|not ok) ([0-9]+)(?: - .*)?$')
    $sequence = New-Object System.Collections.ArrayList
    foreach ($m in $points) {
        if ([string]$m.Groups[1].Value -eq 'ok') { $report.okLines = $report.okLines + 1 }
        else { $report.notOkLines = $report.notOkLines + 1 }
        [void]$sequence.Add([int]$m.Groups[2].Value)
    }
    $report.skipDirectives = [regex]::Matches($text, '(?m)^ok [0-9]+ #[Ss][Kk][Ii][Pp]').Count
    $report.todoDirectives = [regex]::Matches($text, '(?m)^ok [0-9]+ #[Tt][Oo][Dd][Oo]').Count

    $ordered = @($sequence | Sort-Object -Unique)
    $expectedSequence = New-Object System.Collections.ArrayList
    for ($i = 1; $i -le $ExpectedTests; $i++) { [void]$expectedSequence.Add($i) }
    $report.numberingOk = (
        ($sequence.Count -eq $ExpectedTests) -and
        ($ordered.Count -eq $ExpectedTests) -and
        (($ordered -join ',') -eq ($expectedSequence -join ','))
    )

    foreach ($key in @('tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo', 'duration_ms')) {
        $pattern = '(?m)^# ' + [regex]::Escape($key) + ' ([0-9]+(?:\.[0-9]+)?)\s*$'
        $m = [regex]::Match($text, $pattern)
        if ($m.Success) { $report.counts[$key] = [string]$m.Groups[1].Value }
    }
    $issues = New-Object System.Collections.ArrayList
    if (-not $report.hasVersion) { [void]$issues.Add('missing TAP version line') }
    if (-not $report.numberingOk) { [void]$issues.Add('test point numbering is not a complete 1..' + $ExpectedTests + ' sequence') }
    foreach ($required in @('tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo', 'duration_ms')) {
        if (-not $report.counts.ContainsKey($required)) { [void]$issues.Add('missing summary line: ' + $required) }
    }
    if ($report.counts.ContainsKey('tests')) {
        if ([int]$report.counts['tests'] -ne $ExpectedTests) { [void]$issues.Add('tests count is not ' + $ExpectedTests) }
    }
    if ($report.counts.ContainsKey('pass')) {
        if ([int]$report.counts['pass'] -ne $ExpectedTests) { [void]$issues.Add('pass count is not ' + $ExpectedTests) }
    }
    if ($report.counts.ContainsKey('fail')) {
        if ([int]$report.counts['fail'] -ne 0) { [void]$issues.Add('fail count is not 0') }
    }
    if ($report.counts.ContainsKey('cancelled')) {
        if ([int]$report.counts['cancelled'] -ne 0) { [void]$issues.Add('cancelled count is not 0') }
    }
    if ($report.counts.ContainsKey('skipped')) {
        if ([int]$report.counts['skipped'] -ne 0) { [void]$issues.Add('skipped count is not 0') }
    }
    if ($report.counts.ContainsKey('todo')) {
        if ([int]$report.counts['todo'] -ne 0) { [void]$issues.Add('todo count is not 0') }
    }
    if ($report.counts.ContainsKey('suites')) {
        if ([int]$report.counts['suites'] -ne 0) { [void]$issues.Add('suites count is not 0') }
    }
    if ($report.okLines -ne $ExpectedTests) { [void]$issues.Add('ok lines are not ' + $ExpectedTests) }
    if ($report.notOkLines -ne 0) { [void]$issues.Add('not ok lines present') }
    if ($report.skipDirectives -ne 0) { [void]$issues.Add('skip directive present') }
    if ($report.todoDirectives -ne 0) { [void]$issues.Add('todo directive present') }
    $report.issues = @($issues)
    return $report
}

function Get-SuitesChecks {
    param(
        [Parameter(Mandatory)][string]$StdoutPath,
        [Parameter(Mandatory)][string]$StderrPath
    )
    $checks = New-Object System.Collections.ArrayList
    $exists = Test-Path -LiteralPath $StdoutPath -PathType Leaf
    $text = Read-TextFile -Path $StdoutPath
    [void](Add-Check -List $checks -Id 'suites.stdout.file' -Ok $exists -Detail $StdoutPath)
    [void](Add-Check -List $checks -Id 'suites.stdout.nonempty' -Ok (-not [string]::IsNullOrWhiteSpace($text)) -Detail ('chars=' + $text.Length))
    [void](Add-Check -List $checks -Id 'suites.header' -Ok ([regex]::IsMatch($text, '(?m)^SLMM OFFLINE TEST SUITES \(no network, no database, no credentials\)$')) -Detail 'offline banner present')

    $suitePattern = '(?m)^>>> (.+): (OK|FAIL) \(tests=([0-9]+) pass=([0-9]+) fail=([0-9]+) skip=([0-9]+) exit=(-?[0-9]+)\)\s*$'
    $suiteMatches = [regex]::Matches($text, $suitePattern)
    $names = New-Object System.Collections.ArrayList
    foreach ($m in $suiteMatches) { [void]$names.Add([string]$m.Groups[1].Value) }
    $uniqueNames = @($names | Sort-Object -Unique)
    [void](Add-Check -List $checks -Id 'suites.count' -Ok ($suiteMatches.Count -eq $script:ExpectedSuiteCount) -Detail ('observed=' + $suiteMatches.Count + ' expected=' + $script:ExpectedSuiteCount))
    [void](Add-Check -List $checks -Id 'suites.unique' -Ok ($uniqueNames.Count -eq $suiteMatches.Count) -Detail ('unique=' + $uniqueNames.Count))

    $badStatus = 0
    $badExit = 0
    $badMath = 0
    $nonzeroFail = 0
    $totalTests = 0
    $totalPass = 0
    $totalFail = 0
    $totalSkip = 0
    foreach ($m in $suiteMatches) {
        if ([string]$m.Groups[2].Value -ne 'OK') { $badStatus = $badStatus + 1 }
        if ([int]$m.Groups[7].Value -ne 0) { $badExit = $badExit + 1 }
        $t = [int]$m.Groups[3].Value
        $p = [int]$m.Groups[4].Value
        $f = [int]$m.Groups[5].Value
        $s = [int]$m.Groups[6].Value
        if ($f -ne 0) { $nonzeroFail = $nonzeroFail + 1 }
        if (($p + $f + $s) -ne $t) { $badMath = $badMath + 1 }
        $totalTests = $totalTests + $t
        $totalPass = $totalPass + $p
        $totalFail = $totalFail + $f
        $totalSkip = $totalSkip + $s
    }
    [void](Add-Check -List $checks -Id 'suites.allOk' -Ok ($badStatus -eq 0) -Detail ('notOk=' + $badStatus))
    [void](Add-Check -List $checks -Id 'suites.allExitZero' -Ok ($badExit -eq 0) -Detail ('nonzeroExit=' + $badExit))
    [void](Add-Check -List $checks -Id 'suites.allFailZero' -Ok ($nonzeroFail -eq 0) -Detail ('suitesWithFail=' + $nonzeroFail))
    [void](Add-Check -List $checks -Id 'suites.mathConsistent' -Ok ($badMath -eq 0) -Detail ('inconsistent=' + $badMath))

    $totalPattern = '(?m)^\s+TOTAL tests=([0-9]+) pass=([0-9]+) fail=([0-9]+) skip=([0-9]+) suites=([0-9]+) failing_suites=([0-9]+)\s*$'
    $totalMatch = [regex]::Match($text, $totalPattern)
    [void](Add-Check -List $checks -Id 'suites.total.present' -Ok $totalMatch.Success -Detail 'single TOTAL line')
    $totalSuites = -1
    $totalFailing = -1
    if ($totalMatch.Success) {
        $reportedTests = [int]$totalMatch.Groups[1].Value
        $reportedPass = [int]$totalMatch.Groups[2].Value
        $reportedFail = [int]$totalMatch.Groups[3].Value
        $reportedSkip = [int]$totalMatch.Groups[4].Value
        $totalSuites = [int]$totalMatch.Groups[5].Value
        $totalFailing = [int]$totalMatch.Groups[6].Value
        [void](Add-Check -List $checks -Id 'suites.total.matchesSum' -Ok (($reportedTests -eq $totalTests) -and ($reportedPass -eq $totalPass) -and ($reportedFail -eq $totalFail) -and ($reportedSkip -eq $totalSkip)) -Detail ('reported=' + $reportedTests + '/' + $reportedPass + '/' + $reportedFail + '/' + $reportedSkip + ' summed=' + $totalTests + '/' + $totalPass + '/' + $totalFail + '/' + $totalSkip))
        [void](Add-Check -List $checks -Id 'suites.total.failZero' -Ok ($reportedFail -eq 0) -Detail ('fail=' + $reportedFail))
    }
    else {
        [void](Add-Check -List $checks -Id 'suites.total.matchesSum' -Ok $false -Detail 'TOTAL line missing')
        [void](Add-Check -List $checks -Id 'suites.total.failZero' -Ok $false -Detail 'TOTAL line missing')
    }
    [void](Add-Check -List $checks -Id 'suites.total.suiteCount' -Ok ($totalSuites -eq $script:ExpectedSuiteCount) -Detail ('suites=' + $totalSuites + ' expected=' + $script:ExpectedSuiteCount))
    [void](Add-Check -List $checks -Id 'suites.total.failingZero' -Ok ($totalFailing -eq 0) -Detail ('failing_suites=' + $totalFailing))
    [void](Add-Check -List $checks -Id 'suites.stdout.noFailureMarkers' -Ok (-not [regex]::IsMatch($text, '(?mi)^\s*(failing_suites=[1-9]|FAIL\b)')) -Detail 'no failure markers')

    foreach ($c in @(Get-StderrChecks -Variant 'suites' -StderrPath $StderrPath)) { [void]$checks.Add($c) }

    $observed = [pscustomobject]@{
        suiteLines = $suiteMatches.Count
        uniqueSuites = $uniqueNames.Count
        totals = [pscustomobject]@{ tests = $totalTests; pass = $totalPass; fail = $totalFail; skip = $totalSkip; suites = $totalSuites; failingSuites = $totalFailing }
        suiteNames = @($uniqueNames)
    }
    return [pscustomobject]@{ checks = @($checks); observed = $observed }
}

function Get-TapChecks {
    param(
        [Parameter(Mandatory)][string]$StdoutPath,
        [Parameter(Mandatory)][string]$StderrPath,
        [Parameter(Mandatory)][int]$ExpectedTests,
        [Parameter(Mandatory)][string]$Variant
    )
    $checks = New-Object System.Collections.ArrayList
    $exists = Test-Path -LiteralPath $StdoutPath -PathType Leaf
    [void](Add-Check -List $checks -Id ($Variant + '.stdout.file') -Ok $exists -Detail $StdoutPath)
    $report = Get-TapReport -Path $StdoutPath -ExpectedTests $ExpectedTests
    [void](Add-Check -List $checks -Id ($Variant + '.tap.version') -Ok $report.hasVersion -Detail 'TAP version 13')
    [void](Add-Check -List $checks -Id ($Variant + '.tap.numbering') -Ok $report.numberingOk -Detail ('complete 1..' + $ExpectedTests))
    [void](Add-Check -List $checks -Id ($Variant + '.tap.countsComplete') -Ok ((@($report.issues | Where-Object { $_ -like 'missing summary line:*' }).Count -eq 0)) -Detail 'all six counters plus duration present')
    foreach ($key in @('tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo')) {
        $value = -1
        if ($report.counts.ContainsKey($key)) { $value = [int]$report.counts[$key] }
        $expectedValue = 0
        if ($key -eq 'tests') { $expectedValue = $ExpectedTests }
        if ($key -eq 'pass') { $expectedValue = $ExpectedTests }
        [void](Add-Check -List $checks -Id ($Variant + '.tap.' + $key) -Ok ($value -eq $expectedValue) -Detail ('observed=' + $value + ' expected=' + $expectedValue))
    }
    $suiteValue = 0
    if ($report.counts.ContainsKey('suites')) { $suiteValue = [int]$report.counts['suites'] }
    [void](Add-Check -List $checks -Id ($Variant + '.tap.suites') -Ok ($suiteValue -eq 0) -Detail ('observed=' + $suiteValue))
    [void](Add-Check -List $checks -Id ($Variant + '.tap.okLines') -Ok ($report.okLines -eq $ExpectedTests) -Detail ('okLines=' + $report.okLines))
    [void](Add-Check -List $checks -Id ($Variant + '.tap.notOkLines') -Ok ($report.notOkLines -eq 0) -Detail ('notOkLines=' + $report.notOkLines))
    [void](Add-Check -List $checks -Id ($Variant + '.tap.noDirectives') -Ok (($report.skipDirectives -eq 0) -and ($report.todoDirectives -eq 0)) -Detail ('skip=' + $report.skipDirectives + ' todo=' + $report.todoDirectives))
    $text = Read-TextFile -Path $StdoutPath
    [void](Add-Check -List $checks -Id ($Variant + '.stdout.noErrorMarkers') -Ok (-not [regex]::IsMatch($text, '(?mi)^(not ok|# fail [1-9])')) -Detail 'no failure markers')
    [void](Add-Check -List $checks -Id ($Variant + '.summary.issues') -Ok (@($report.issues).Count -eq 0) -Detail (@($report.issues) -join '; '))

    foreach ($c in @(Get-StderrChecks -Variant $Variant -StderrPath $StderrPath)) { [void]$checks.Add($c) }

    $observed = [pscustomobject]@{
        okLines = $report.okLines
        notOkLines = $report.notOkLines
        numberingOk = $report.numberingOk
        hasVersion = $report.hasVersion
        counts = $report.counts
        issues = @($report.issues)
    }
    return [pscustomobject]@{ checks = @($checks); observed = $observed }
}

function Get-TscChecks {
    param(
        [Parameter(Mandatory)][string]$StdoutPath,
        [Parameter(Mandatory)][string]$StderrPath
    )
    $checks = New-Object System.Collections.ArrayList
    $exists = Test-Path -LiteralPath $StdoutPath -PathType Leaf
    $text = Read-TextFile -Path $StdoutPath
    [void](Add-Check -List $checks -Id 'tsc.stdout.file' -Ok $exists -Detail $StdoutPath)
    $diagnostics = [regex]::Matches($text, '(?m)^.+\([0-9]+,[0-9]+\): error TS[0-9]+:')
    [void](Add-Check -List $checks -Id 'tsc.diagnostics.zero' -Ok ($diagnostics.Count -eq 0) -Detail ('diagnostics=' + $diagnostics.Count))
    $errorWord = [regex]::Matches($text, '(?i)\berror\b')
    [void](Add-Check -List $checks -Id 'tsc.stdout.noErrorWord' -Ok ($errorWord.Count -eq 0) -Detail ('errorMentions=' + $errorWord.Count))
    $nonBlank = @($text -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    [void](Add-Check -List $checks -Id 'tsc.stdout.noUnexpectedText' -Ok (@($nonBlank).Count -eq 0) -Detail ('nonBlankLines=' + @($nonBlank).Count))
    foreach ($c in @(Get-StderrChecks -Variant 'tsc' -StderrPath $StderrPath)) { [void]$checks.Add($c) }
    $observed = [pscustomobject]@{
        diagnostics = $diagnostics.Count
        errorMentions = $errorWord.Count
        nonBlankLines = @($nonBlank).Count
    }
    return [pscustomobject]@{ checks = @($checks); observed = $observed }
}

function Get-GenericChecks {
    param(
        [Parameter(Mandatory)][string]$StdoutPath,
        [Parameter(Mandatory)][string]$StderrPath,
        [Parameter(Mandatory)][string]$Variant
    )
    $checks = New-Object System.Collections.ArrayList
    [void](Add-Check -List $checks -Id ($Variant + '.stdout.file') -Ok (Test-Path -LiteralPath $StdoutPath -PathType Leaf) -Detail $StdoutPath)
    foreach ($c in @(Get-StderrChecks -Variant $Variant -StderrPath $StderrPath)) { [void]$checks.Add($c) }
    $observed = [pscustomobject]@{ kind = 'generic' }
    return [pscustomobject]@{ checks = @($checks); observed = $observed }
}

function Get-StepOutputChecks {
    param(
        [Parameter(Mandatory)][string]$Kind,
        [Parameter(Mandatory)][string]$Variant,
        [Parameter(Mandatory)][string]$StdoutPath,
        [Parameter(Mandatory)][string]$StderrPath
    )
    if ($Kind -eq 'suites') { return Get-SuitesChecks -StdoutPath $StdoutPath -StderrPath $StderrPath }
    if ($Kind -eq 'tap') { return Get-TapChecks -StdoutPath $StdoutPath -StderrPath $StderrPath -ExpectedTests $script:ExpectedGroupRTests -Variant $Variant }
    if ($Kind -eq 'tsc') { return Get-TscChecks -StdoutPath $StdoutPath -StderrPath $StderrPath }
    return Get-GenericChecks -StdoutPath $StdoutPath -StderrPath $StderrPath -Variant $Variant
}

# ---------------------------------------------------------------------------
# Git provenance (metadata only; never a gate on test results)
# ---------------------------------------------------------------------------
function Get-GitText {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$GitWorkingDirectory,
        [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$GitArgs
    )
    $result = [pscustomobject]@{
        exitCode = 1
        ok = $false
        lines = @()
        text = ''
    }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $raw = @(& git -C $GitWorkingDirectory --no-optional-locks @GitArgs 2>$null)
        $code = $LASTEXITCODE
        $strings = New-Object System.Collections.ArrayList
        foreach ($item in $raw) {
            if ($null -eq $item) { continue }
            [void]$strings.Add([string]$item)
        }
        $result.lines = @($strings)
        $result.text = (@($strings) -join "`n")
        $result.exitCode = [int]$code
        $result.ok = ([int]$code -eq 0)
    }
    catch {
        $result.exitCode = 1
        $result.ok = $false
        Add-Warning ('git failed: ' + (@($GitArgs) -join ' ') + ' :: ' + [string]$_.Exception.Message)
    }
    finally {
        $ErrorActionPreference = $previous
    }
    return $result
}

# ---------------------------------------------------------------------------
# Self-inspection (genuine checks, not assertions)
# ---------------------------------------------------------------------------
function Get-ScriptAst {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$ScriptPath)
    $result = [pscustomobject]@{ ast = $null; ok = $false; detail = '' }
    if ([string]::IsNullOrWhiteSpace($ScriptPath)) { $result.detail = 'script path unavailable'; return $result }
    if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) { $result.detail = 'script file not found'; return $result }
    $parseTokens = $null
    $parseErrors = $null
    try {
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($ScriptPath, [ref]$parseTokens, [ref]$parseErrors)
    }
    catch {
        $result.detail = 'parse threw: ' + [string]$_.Exception.Message
        return $result
    }
    if (@($parseErrors).Count -gt 0) {
        $result.detail = 'script has ' + [string](@($parseErrors).Count) + ' parse error(s)'
        return $result
    }
    $result.ast = $ast
    $result.ok = $true
    $result.detail = 'parsed'
    return $result
}

function Test-NoDestructiveCommands {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$ScriptPath)
    $scan = [pscustomobject]@{ ok = $false; found = @(); detail = '' }
    $parsed = Get-ScriptAst -ScriptPath $ScriptPath
    if (-not [bool]$parsed.ok) { $scan.detail = [string]$parsed.detail; return $scan }
    $forbidden = @('Remove-Item', 'Remove-ItemProperty', 'Clear-Content', 'Clear-Item', 'Stop-Process', 'Remove-Variable', 'rmdir', 'rd', 'del', 'erase', 'Recycle')
    $found = New-Object System.Collections.ArrayList
    $commands = @($parsed.ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true))
    foreach ($command in $commands) {
        $name = [string]$command.GetCommandName()
        if ([string]::IsNullOrWhiteSpace($name)) { continue }
        if ($forbidden -contains $name) { [void]$found.Add('command:' + $name) }
    }
    $invocations = @($parsed.ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.InvokeMemberExpressionAst] }, $true))
    foreach ($invocation in $invocations) {
        $memberName = [string]$invocation.Member.Value
        if (($memberName -eq 'Delete') -or ($memberName -eq 'DeleteDirectory') -or ($memberName -eq 'DeleteFile')) {
            [void]$found.Add('member:' + $memberName)
        }
    }
    $scan.found = @($found)
    $scan.ok = (@($found).Count -eq 0)
    if ($scan.ok) { $scan.detail = 'no destructive command or delete call found in this script' }
    else { $scan.detail = 'destructive operations found: ' + ((@($found)) -join ',') }
    return $scan
}

function Test-NoEnvironmentValueReads {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$ScriptPath)
    $scan = [pscustomobject]@{ ok = $false; found = @(); detail = '' }
    $parsed = Get-ScriptAst -ScriptPath $ScriptPath
    if (-not [bool]$parsed.ok) { $scan.detail = [string]$parsed.detail; return $scan }
    $found = New-Object System.Collections.ArrayList
    $variables = @($parsed.ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.VariableExpressionAst] }, $true))
    foreach ($variable in $variables) {
        $variablePath = [string]$variable.VariablePath.UserPath
        if ($variablePath.StartsWith('env:', [System.StringComparison]::OrdinalIgnoreCase)) {
            [void]$found.Add('$' + $variablePath)
        }
    }
    $invocations = @($parsed.ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.InvokeMemberExpressionAst] }, $true))
    foreach ($invocation in $invocations) {
        $memberName = [string]$invocation.Member.Value
        if (($memberName -eq 'GetEnvironmentVariable') -or ($memberName -eq 'ExpandEnvironmentVariables')) {
            [void]$found.Add('member:' + $memberName)
        }
    }
    $scan.found = @($found)
    $scan.ok = (@($found).Count -eq 0)
    if ($scan.ok) { $scan.detail = 'no environment variable value is read anywhere in this script' }
    else { $scan.detail = 'environment value reads found: ' + ((@($found)) -join ',') }
    return $scan
}

function Get-ApprovedVectorScan {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$ScriptPath)
    $scan = [pscustomobject]@{ ok = $false; count = 0; vectors = @(); extra = @(); detail = '' }
    $parsed = Get-ScriptAst -ScriptPath $ScriptPath
    if (-not [bool]$parsed.ok) { $scan.detail = [string]$parsed.detail; return $scan }
    $strings = @($parsed.ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.StringConstantExpressionAst] }, $true))
    $commandLike = New-Object System.Collections.ArrayList
    foreach ($s in $strings) {
        $value = [string]$s.Value
        if ($value -match '^node\s') { [void]$commandLike.Add($value) }
    }
    $scan.vectors = @($commandLike | Sort-Object -Unique)
    $scan.count = @($scan.vectors).Count
    $extra = New-Object System.Collections.ArrayList
    foreach ($v in @($scan.vectors)) {
        if (-not ($script:ApprovedVectors -contains [string]$v)) { [void]$extra.Add([string]$v) }
    }
    $scan.extra = @($extra)
    $scan.ok = (($scan.count -eq 3) -and (@($extra).Count -eq 0))
    if ($scan.ok) { $scan.detail = 'exactly three approved offline command strings, no extras' }
    else { $scan.detail = 'capture command strings=' + [string]$scan.count + ' unapproved=' + ((@($extra)) -join ',') }
    return $scan
}

# ---------------------------------------------------------------------------
# Preconditions (read-only)
# ---------------------------------------------------------------------------
function Get-Preconditions {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$RepoRootPath,
        [Parameter(Mandatory)][AllowEmptyString()][string]$EvidenceRootPath,
        [AllowEmptyString()][string]$ExpectedHeadValue = '',
        [bool]$Acknowledged = $false,
        [AllowEmptyString()][string]$ApprovalReference = '',
        [bool]$SelfTestMode = $false
    )
    $checks = New-Object System.Collections.ArrayList
    $repoFull = Get-NormalizedPath -Path $RepoRootPath
    $evidenceFull = Get-NormalizedPath -Path $EvidenceRootPath

    # --- repository identity ------------------------------------------------
    $repoIsDir = $false
    if (-not [string]::IsNullOrWhiteSpace($repoFull)) {
        $repoIsDir = (Test-Path -LiteralPath $repoFull -PathType Container)
    }
    [void](Add-Check -List $checks -Id 'repo.exists' -Ok $repoIsDir -Detail $repoFull)
    $gitDirExists = $false
    if ($repoIsDir) { $gitDirExists = (Test-Path -LiteralPath (Join-Path $repoFull '.git')) }
    [void](Add-Check -List $checks -Id 'repo.git.present' -Ok $gitDirExists -Detail 'git metadata directory')

    $branch = ''
    $head = ''
    $originMain = ''
    $aheadBehind = ''
    $statusLines = @()
    if ($repoIsDir -and $gitDirExists) {
        $branchResult = Get-GitText -GitWorkingDirectory $repoFull -GitArgs @('rev-parse', '--abbrev-ref', 'HEAD')
        if ($branchResult.ok -and (@($branchResult.lines).Count -ge 1)) {
            $branch = ([string](@($branchResult.lines)[0])).Trim()
        }
        $headResult = Get-GitText -GitWorkingDirectory $repoFull -GitArgs @('rev-parse', 'HEAD')
        if ($headResult.ok -and (@($headResult.lines).Count -ge 1)) {
            $head = ([string](@($headResult.lines)[0])).Trim()
        }
        $originResult = Get-GitText -GitWorkingDirectory $repoFull -GitArgs @('rev-parse', 'origin/main')
        if ($originResult.ok -and (@($originResult.lines).Count -ge 1)) {
            $originMain = ([string](@($originResult.lines)[0])).Trim()
        }
        $countResult = Get-GitText -GitWorkingDirectory $repoFull -GitArgs @('rev-list', '--left-right', '--count', 'origin/main...HEAD')
        if ($countResult.ok -and (@($countResult.lines).Count -ge 1)) {
            $aheadBehind = ([string](@($countResult.lines)[0])).Trim()
        }
        $statusResult = Get-GitText -GitWorkingDirectory $repoFull -GitArgs @('status', '--porcelain=v1', '-uall')
        [void](Add-Check -List $checks -Id 'git.status.readable' -Ok $statusResult.ok -Detail ('exit=' + $statusResult.exitCode))
        if ($statusResult.ok) { $statusLines = @($statusResult.lines) }
    }
    [void](Add-Check -List $checks -Id 'git.branch.main' -Ok ($branch -eq 'main') -Detail ('branch=' + $branch))
    $headPinned = [regex]::IsMatch($head, '^[0-9a-f]{40}$')
    [void](Add-Check -List $checks -Id 'git.head.pinned' -Ok $headPinned -Detail ('head=' + $head))
    $expectedNormalized = ''
    if (-not [string]::IsNullOrWhiteSpace($ExpectedHeadValue)) { $expectedNormalized = $ExpectedHeadValue.Trim().ToLowerInvariant() }
    [void](Add-Check -List $checks -Id 'git.head.expectedProvided' -Ok ([regex]::IsMatch($expectedNormalized, '^[0-9a-f]{40}$')) -Detail 'operator must pin the expected HEAD')
    [void](Add-Check -List $checks -Id 'git.head.matchesExpected' -Ok (($expectedNormalized -ne '') -and ($head -ne '') -and [string]::Equals($head, $expectedNormalized, [System.StringComparison]::Ordinal)) -Detail ('head=' + $head + ' expected=' + $expectedNormalized))
    [void](Add-Check -List $checks -Id 'git.originMain.matchesHead' -Ok (($originMain -ne '') -and ($head -ne '') -and [string]::Equals($originMain, $head, [System.StringComparison]::Ordinal)) -Detail ('origin/main=' + $originMain))

    $modifiedCount = 0
    $untrackedCount = 0
    $stagedCount = 0
    $deletedCount = 0
    foreach ($line in $statusLines) {
        $lineText = [string]$line
        if ($lineText.Length -lt 2) { continue }
        $code = $lineText.Substring(0, 2)
        if ($code.StartsWith('??')) { $untrackedCount = $untrackedCount + 1; continue }
        if ($code -match '^[MADRC]') { $stagedCount = $stagedCount + 1 }
        if ($code -match 'D') { $deletedCount = $deletedCount + 1 }
        if ($code -match 'M') { $modifiedCount = $modifiedCount + 1 }
    }
    [void](Add-Check -List $checks -Id 'git.index.noStagedChanges' -Ok ($stagedCount -eq 0) -Detail ('staged=' + $stagedCount))
    [void](Add-Check -List $checks -Id 'git.worktree.noDeletions' -Ok ($deletedCount -eq 0) -Detail ('deleted=' + $deletedCount))
    $newScriptName = 'offline-evidence-capture.ps1'
    $newScriptCount = 0
    foreach ($shapeLine in $statusLines) {
        $shapeText = [string]$shapeLine
        if (-not $shapeText.StartsWith('?? ')) { continue }
        if ([string]::Equals([System.IO.Path]::GetFileName($shapeText.Substring(3).Trim()), $newScriptName, [System.StringComparison]::OrdinalIgnoreCase)) { $newScriptCount = $newScriptCount + 1 }
    }
    $originalUntrackedCount = $untrackedCount - $newScriptCount
    $worktreeBaselineOk = ($modifiedCount -eq [int]$script:ExpectedBaselineModified) -and ($originalUntrackedCount -eq [int]$script:ExpectedBaselineUntracked) -and ($newScriptCount -eq 1) -and ($stagedCount -eq 0) -and ($deletedCount -eq 0)
    [void](Add-Check -List $checks -Id 'git.worktree.baselinePreserved' -Ok $worktreeBaselineOk -Detail ('modified=' + $modifiedCount + '/' + $script:ExpectedBaselineModified + ' untrackedOriginal=' + $originalUntrackedCount + '/' + $script:ExpectedBaselineUntracked + ' newScript=' + $newScriptCount + '/1 staged=' + $stagedCount + ' deleted=' + $deletedCount))

    # --- toolchain ---------------------------------------------------------
    $nodeExe = ''
    $programFiles = [System.Environment]::GetFolderPath('ProgramFiles')
    if (-not [string]::IsNullOrWhiteSpace($programFiles)) {
        $candidate = [System.IO.Path]::Combine($programFiles, 'nodejs', 'node.exe')
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $nodeExe = $candidate }
    }
    [void](Add-Check -List $checks -Id 'tool.node.present' -Ok ($nodeExe -ne '') -Detail $nodeExe)
    $nodeVersion = ''
    if ($nodeExe -ne '') {
        $nodeVersion = [string]([System.Diagnostics.FileVersionInfo]::GetVersionInfo($nodeExe).ProductVersion)
    }
    [void](Add-Check -List $checks -Id 'tool.node.version' -Ok ($nodeVersion -ne '') -Detail $nodeVersion)
    $psMajor = [int]$PSVersionTable.PSVersion.Major
    [void](Add-Check -List $checks -Id 'tool.powershell.version' -Ok ($psMajor -ge 5) -Detail ([string]$PSVersionTable.PSVersion))

    $cimOk = $false
    $cimDetail = 'unavailable'
    try {
        $probe = @(Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId=' + $PID) -ErrorAction Stop)
        if (@($probe).Count -eq 1) { $cimOk = $true; $cimDetail = 'ok' }
        else { $cimDetail = 'probe returned ' + @($probe).Count }
    }
    catch {
        $cimDetail = [string]$_.Exception.Message
    }
    [void](Add-Check -List $checks -Id 'tool.cim.available' -Ok $cimOk -Detail $cimDetail)

    # --- evidence destination ---------------------------------------------
    $evidenceIsDir = $false
    if (-not [string]::IsNullOrWhiteSpace($evidenceFull)) {
        $evidenceIsDir = (Test-Path -LiteralPath $evidenceFull -PathType Container)
    }
    [void](Add-Check -List $checks -Id 'path.evidence.exists' -Ok $evidenceIsDir -Detail $evidenceFull)
    $outsideRepo = $false
    if (($evidenceFull -ne '') -and ($repoFull -ne '')) {
        $outsideRepo = -not (Test-PathUnder -Child $evidenceFull -Parent $repoFull)
    }
    [void](Add-Check -List $checks -Id 'path.evidence.outsideRepo' -Ok $outsideRepo -Detail ('evidence=' + $evidenceFull + ' repo=' + $repoFull))
    $freeGb = -1
    if ($evidenceFull -ne '') {
        try {
            $rootPath = [System.IO.Path]::GetPathRoot($evidenceFull)
            $drive = New-Object System.IO.DriveInfo -ArgumentList $rootPath
            $freeGb = [math]::Round(([double]$drive.AvailableFreeSpace / 1GB), 2)
        }
        catch {
            $freeGb = -1
        }
    }
    [void](Add-Check -List $checks -Id 'path.evidence.freeSpace' -Ok ($freeGb -ge 0.25) -Detail ('freeGb=' + $freeGb))

    # --- environment blockers (names only, never values) -------------------
    $blockedEnv = New-Object System.Collections.ArrayList
    $envEnumerable = $false
    try {
        $envNames = @([System.Environment]::GetEnvironmentVariables([System.EnvironmentVariableTarget]::Process).Keys)
        $envEnumerable = $true
        foreach ($name in $envNames) {
            $n = [string]$name
            if ([string]::IsNullOrWhiteSpace($n)) { continue }
            $hit = $false
            foreach ($p in $script:BlockedEnvPrefixes) {
                if ($n.StartsWith([string]$p, [System.StringComparison]::OrdinalIgnoreCase)) { $hit = $true; break }
            }
            if (-not $hit) {
                foreach ($s in $script:BlockedEnvSuffixes) {
                    if ($n.EndsWith([string]$s, [System.StringComparison]::OrdinalIgnoreCase)) { $hit = $true; break }
                }
            }
            if (-not $hit) {
                foreach ($exact in $script:BlockedEnvNames) {
                    if ([string]::Equals($n, [string]$exact, [System.StringComparison]::OrdinalIgnoreCase)) { $hit = $true; break }
                }
            }
            if ($hit) { [void]$blockedEnv.Add($n) }
        }
    }
    catch {
        $envEnumerable = $false
    }
    [void](Add-Check -List $checks -Id 'env.enumerable' -Ok $envEnumerable -Detail 'names-only enumeration')
    [void](Add-Check -List $checks -Id 'env.noBlockers' -Ok (@($blockedEnv).Count -eq 0) -Detail ('blockers=' + @($blockedEnv).Count + ' names=' + ((@($blockedEnv) | Sort-Object) -join ',')))

    # --- operator authorization -------------------------------------------
    $approvalOk = ((-not [string]::IsNullOrWhiteSpace($ApprovalReference)) -and ($ApprovalReference.Trim().Length -ge 8))
    if ($SelfTestMode) {
        [void](Add-Check -List $checks -Id 'auth.approvalReference' -Ok $true -Detail 'self-test: operator text not required')
        [void](Add-Check -List $checks -Id 'auth.acknowledgeSwitch' -Ok $true -Detail 'self-test: acknowledgement not required')
    }
    else {
        [void](Add-Check -List $checks -Id 'auth.approvalReference' -Ok $approvalOk -Detail 'operator must supply a written approval reference')
        [void](Add-Check -List $checks -Id 'auth.acknowledgeSwitch' -Ok ([bool]$Acknowledged) -Detail 'operator must pass -AcknowledgeTestsRun')
    }
    $envReadScan = Test-NoEnvironmentValueReads -ScriptPath ([string]$PSCommandPath)
    [void](Add-Check -List $checks -Id 'env.noValueReads' -Ok ([bool]$envReadScan.ok) -Detail ([string]$envReadScan.detail))

    # --- checksum pins -----------------------------------------------------
    $pinDir = [System.IO.Path]::Combine($repoFull, 'test-harness', 't6-checkpoint')
    $pinFile = [System.IO.Path]::Combine($pinDir, 't6-checksums.txt')
    $pinEntries = New-Object System.Collections.ArrayList
    $pinProblems = New-Object System.Collections.ArrayList
    $pinFileSha = ''
    if (Test-Path -LiteralPath $pinFile -PathType Leaf) {
        $pinFp = Get-FileFingerprint -Path $pinFile
        $pinFileSha = [string]$pinFp.sha256
        if (-not [string]::Equals($pinFileSha, $script:ExpectedPinFileSha256, [System.StringComparison]::OrdinalIgnoreCase)) {
            [void]$pinProblems.Add('checksum manifest content changed')
        }
        foreach ($line in @(Get-Content -LiteralPath $pinFile)) {
            $t = ([string]$line).Trim()
            if ($t.Length -eq 0) { continue }
            if ($t.StartsWith([string]'#')) { continue }
            $m = [regex]::Match($t, '^([0-9a-fA-F]{64})\s{1,2}(.+?)\s*$')
            if (-not $m.Success) {
                [void]$pinProblems.Add('unparseable pin line')
                continue
            }
            $expectedSha = ([string]$m.Groups[1].Value).ToLowerInvariant()
            $rel = ([string]$m.Groups[2].Value).Replace('/', '\')
            $fullPin = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($pinDir, $rel))
            if (-not (Test-PathUnder -Child $fullPin -Parent $pinDir)) {
                [void]$pinProblems.Add('pin escapes checkpoint directory: ' + $rel)
                continue
            }
            $fp = Get-FileFingerprint -Path $fullPin
            $entry = [pscustomobject]@{
                path = [string]$rel
                exists = [bool]$fp.exists
                bytes = [int]$fp.bytes
                expectedSha256 = [string]$expectedSha
                actualSha256 = [string]$fp.sha256
                ok = $false
            }
            if ($fp.exists -and [string]::Equals([string]$fp.sha256, $expectedSha, [System.StringComparison]::OrdinalIgnoreCase)) {
                $entry.ok = $true
            }
            else {
                [void]$pinProblems.Add('pin mismatch: ' + $rel)
            }
            [void]$pinEntries.Add($entry)
        }
    }
    else {
        [void]$pinProblems.Add('checksum manifest missing')
    }
    $pinOk = ((@($pinEntries).Count -eq $script:ExpectedPinCount) -and (@($pinProblems).Count -eq 0))
    [void](Add-Check -List $checks -Id 'pins.manifest.present' -Ok (Test-Path -LiteralPath $pinFile -PathType Leaf) -Detail $pinFile)
    [void](Add-Check -List $checks -Id 'pins.manifest.sha256' -Ok ([string]::Equals($pinFileSha, $script:ExpectedPinFileSha256, [System.StringComparison]::OrdinalIgnoreCase)) -Detail ('observed=' + $pinFileSha))
    [void](Add-Check -List $checks -Id 'pins.count' -Ok (@($pinEntries).Count -eq $script:ExpectedPinCount) -Detail ('observed=' + @($pinEntries).Count + ' expected=' + $script:ExpectedPinCount))
    [void](Add-Check -List $checks -Id 'pins.allMatch' -Ok $pinOk -Detail ((@($pinProblems) | Select-Object -First 3) -join '; '))

    # --- input identity baseline ------------------------------------------
    $inputEntries = New-Object System.Collections.ArrayList
    $inputsMissing = New-Object System.Collections.ArrayList
    foreach ($rel in $script:InputBaseline) {
        $fullInput = [System.IO.Path]::Combine($repoFull, ([string]$rel).Replace('/', '\'))
        $fp = Get-FileFingerprint -Path $fullInput
        $entry = [pscustomobject]@{
            path = [string]$rel
            exists = [bool]$fp.exists
            bytes = [int]$fp.bytes
            sha256 = [string]$fp.sha256
            baselineSha256 = [string]$fp.sha256
        }
        if (-not $fp.exists) { [void]$inputsMissing.Add([string]$rel) }
        [void]$inputEntries.Add($entry)
    }
    [void](Add-Check -List $checks -Id 'inputs.allPresent' -Ok (@($inputsMissing).Count -eq 0) -Detail ('missing=' + (@($inputsMissing) -join ',')))

    # --- aggregate ---------------------------------------------------------
    $failed = New-Object System.Collections.ArrayList
    foreach ($c in $checks) {
        if (-not [bool]$c.ok) { [void]$failed.Add([string]$c.id) }
    }
    return [pscustomobject]@{
        ok = (@($failed).Count -eq 0)
        checks = @($checks)
        failed = @($failed)
        repoFull = [string]$repoFull
        evidenceRootFull = [string]$evidenceFull
        nodeExe = [string]$nodeExe
        head = [string]$head
        branch = [string]$branch
        originMain = [string]$originMain
        aheadBehind = [string]$aheadBehind
        statusBefore = @($statusLines)
        counts = [pscustomobject]@{
            modified = $modifiedCount
            untracked = $untrackedCount
            staged = $stagedCount
            deleted = $deletedCount
        }
        inputs = @($inputEntries)
        pins = [pscustomobject]@{
            pinFileSha256 = [string]$pinFileSha
            count = @($pinEntries).Count
            ok = [bool]$pinOk
            problems = @($pinProblems)
        }
        blockedEnv = @($blockedEnv)
        freeGb = [double]$freeGb
        nodeVersion = [string]$nodeVersion
        powershellVersion = [string]$PSVersionTable.PSVersion.ToString()
        osVersion = [string]([System.Environment]::OSVersion.VersionString)
    }
}

# ---------------------------------------------------------------------------
# Run state file
# ---------------------------------------------------------------------------
function Set-RunStateFile {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$RunIdValue,
        [Parameter(Mandatory)][string]$Phase
    )
    $lines = @(
        ('runId=' + $RunIdValue)
        ('phase=' + $Phase)
        ('schemaVersion=' + [string]$script:SchemaVersion)
        ('updatedUtc=' + (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))
    )
    Write-TextFile -Path $Path -Text ((@($lines) -join [Environment]::NewLine) + [Environment]::NewLine)
}

function Get-RunStatePhase {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Path)
    $text = Read-TextFile -Path $Path
    $m = [regex]::Match($text, '(?m)^phase=([a-z\-]+)\s*$')
    if ($m.Success) { return [string]$m.Groups[1].Value }
    return ''
}

# ---------------------------------------------------------------------------
# Artifact inventory and checksum manifest
# ---------------------------------------------------------------------------
function Get-ArtifactInventory {
    param(
        [Parameter(Mandatory)][string]$Dir,
        [AllowEmptyCollection()][string[]]$ExpectedRelative = @()
    )
    $expected = @($ExpectedRelative | Sort-Object -Unique)
    $observed = New-Object System.Collections.ArrayList
    $missing = New-Object System.Collections.ArrayList
    $unexpected = New-Object System.Collections.ArrayList
    $unhashable = New-Object System.Collections.ArrayList
    $entries = New-Object System.Collections.ArrayList
    if (Test-Path -LiteralPath $Dir -PathType Container) {
        foreach ($item in @(Get-ChildItem -LiteralPath $Dir -Recurse -Force)) {
            $rel = $item.FullName.Substring($Dir.Length).TrimStart([char]'\')
            [void]$observed.Add([string]$rel)
            if ($item.PSIsContainer) { continue }
            $fp = Get-FileFingerprint -Path $item.FullName
            $entry = [pscustomobject]@{
                path = [string]$rel
                bytes = [int]$fp.bytes
                sha256 = [string]$fp.sha256
                ok = [bool]$fp.exists
            }
            [void]$entries.Add($entry)
            if ((-not $fp.exists) -or [string]::IsNullOrWhiteSpace([string]$fp.sha256)) {
                [void]$unhashable.Add([string]$rel)
            }
        }
    }
    foreach ($e in $expected) {
        if (-not ($observed -contains $e)) { [void]$missing.Add([string]$e) }
    }
    foreach ($o in $observed) {
        if ((-not ($expected -contains $o)) -and (-not ($script:BookkeepingNames -contains $o))) {
            [void]$unexpected.Add([string]$o)
        }
    }
    $ok = ((@($missing).Count -eq 0) -and (@($unexpected).Count -eq 0) -and (@($unhashable).Count -eq 0))
    return [pscustomobject]@{
        expected = @($expected)
        observed = @($observed | Sort-Object)
        missing = @($missing)
        unexpected = @($unexpected)
        unhashable = @($unhashable)
        entries = @($entries)
        ok = [bool]$ok
    }
}

function Write-EvidenceSums {
    param(
        [Parameter(Mandatory)][string]$Dir,
        [AllowEmptyCollection()][string[]]$RelativePaths = @()
    )
    $entries = New-Object System.Collections.ArrayList
    $lines = New-Object System.Collections.ArrayList
    $missing = New-Object System.Collections.ArrayList
    foreach ($rel in @($RelativePaths | Sort-Object)) {
        $full = [System.IO.Path]::Combine($Dir, [string]$rel)
        $fp = Get-FileFingerprint -Path $full
        $entry = [pscustomobject]@{
            path = [string]$rel
            exists = [bool]$fp.exists
            bytes = [int]$fp.bytes
            sha256 = [string]$fp.sha256
        }
        [void]$entries.Add($entry)
        if ($fp.exists -and (-not [string]::IsNullOrWhiteSpace([string]$fp.sha256))) {
            [void]$lines.Add(([string]$fp.sha256 + '  ' + [string]$rel))
        }
        else {
            [void]$missing.Add([string]$rel)
        }
    }
    $sumsPath = [System.IO.Path]::Combine($Dir, 'SHA256SUMS.txt')
    Write-TextFile -Path $sumsPath -Text ((@($lines) -join "`n") + "`n")
    $sumsFp = Get-FileFingerprint -Path $sumsPath
    return [pscustomobject]@{
        entries = @($entries)
        lines = @($lines)
        missing = @($missing)
        sumsPath = [string]$sumsPath
        sumsBytes = [int]$sumsFp.bytes
        sumsSha256 = [string]$sumsFp.sha256
        ok = (@($missing).Count -eq 0)
    }
}

# ---------------------------------------------------------------------------
# Verdict (fail closed; completion invariant is a count, never arithmetic)
# ---------------------------------------------------------------------------
function Get-FinalVerdict {
    param(
        [Parameter(Mandatory)]$Preconditions,
        [Parameter(Mandatory)]$Inventory,
        [Parameter(Mandatory)]$Sums,
        [AllowEmptyCollection()][string[]]$PostProblems = @()
    )
    $conditions = [ordered]@{}
    $steps = @($script:StepRecords)

    $conditions['completion.stepCountEq3'] = (@($steps).Count -eq $script:ExpectedStepCount)
    $notRunCount = @($steps | Where-Object { [string]$_.state -eq 'notRun' }).Count
    $conditions['completion.noNotRun'] = ($notRunCount -eq 0)
    $notPassedCount = @($steps | Where-Object { [string]$_.state -ne 'passed' }).Count
    $conditions['completion.allPassed'] = (($notPassedCount -eq 0) -and (@($steps).Count -eq $script:ExpectedStepCount))

    $notStarted = New-Object System.Collections.ArrayList
    $notTerminated = New-Object System.Collections.ArrayList
    $timedOut = New-Object System.Collections.ArrayList
    $spawnError = New-Object System.Collections.ArrayList
    $survivors = New-Object System.Collections.ArrayList
    $exitNotObserved = New-Object System.Collections.ArrayList
    $exitNonZero = New-Object System.Collections.ArrayList
    $zeroChecks = New-Object System.Collections.ArrayList
    $failedCheckIds = New-Object System.Collections.ArrayList

    foreach ($s in $steps) {
        $sid = [string]$s.id
        if (-not [bool]$s.started) { [void]$notStarted.Add($sid) }
        if (-not [bool]$s.terminated) { [void]$notTerminated.Add($sid) }
        if ([bool]$s.timedOut) { [void]$timedOut.Add($sid) }
        if ([string]$s.spawnError -ne '') { [void]$spawnError.Add($sid) }
        if (@($s.descendantsAliveAtVerdict).Count -gt 0) {
            [void]$survivors.Add($sid + '=' + ((@($s.descendantsAliveAtVerdict)) -join '|'))
        }
        if (-not [bool]$s.exitCodeObserved) { [void]$exitNotObserved.Add($sid) }
        elseif ([int]$s.exitCode -ne 0) { [void]$exitNonZero.Add($sid + '=' + [int]$s.exitCode) }
        if ([int]$s.checkCount -le 0) { [void]$zeroChecks.Add($sid) }
        foreach ($f in @($s.failedChecks)) { [void]$failedCheckIds.Add($sid + ':' + [string]$f) }
    }

    $conditions['process.allStarted'] = (@($notStarted).Count -eq 0)
    $conditions['process.allTerminated'] = (@($notTerminated).Count -eq 0)
    $conditions['process.noTimeout'] = (@($timedOut).Count -eq 0)
    $conditions['process.noSpawnError'] = (@($spawnError).Count -eq 0)
    $conditions['process.noSurvivors'] = (@($survivors).Count -eq 0)
    $conditions['exit.allObserved'] = (@($exitNotObserved).Count -eq 0)
    $conditions['exit.allZero'] = ((@($exitNonZero).Count -eq 0) -and (@($exitNotObserved).Count -eq 0))
    $conditions['checks.everyStepEvaluated'] = (@($zeroChecks).Count -eq 0)
    $conditions['checks.noneFailed'] = (@($failedCheckIds).Count -eq 0)

    $conditions['preconditions.allPassed'] = (@($Preconditions.failed).Count -eq 0)
    $conditions['tree.noPostProblems'] = (@($PostProblems).Count -eq 0)
    $conditions['artifacts.allExpectedPresent'] = (@($Inventory.missing).Count -eq 0)
    $conditions['artifacts.noUnexpected'] = (@($Inventory.unexpected).Count -eq 0)
    $conditions['artifacts.allHashable'] = (@($Inventory.unhashable).Count -eq 0)
    $conditions['sums.complete'] = [bool]$Sums.ok

    $failedConditions = New-Object System.Collections.ArrayList
    foreach ($key in $conditions.Keys) {
        if (-not $conditions[$key]) { [void]$failedConditions.Add([string]$key) }
    }
    $result = 'FAIL'
    if (@($failedConditions).Count -eq 0) { $result = 'PASS' }
    $exitCode = $script:ExitFail
    if ($result -eq 'PASS') { $exitCode = $script:ExitPass }
    return [pscustomobject]@{
        result = [string]$result
        conditions = $conditions
        failedConditions = @($failedConditions)
        exitCode = [int]$exitCode
        detail = [pscustomobject]@{
            notStarted = @($notStarted)
            notTerminated = @($notTerminated)
            timedOut = @($timedOut)
            spawnError = @($spawnError)
            survivors = @($survivors)
            exitNotObserved = @($exitNotObserved)
            exitNonZero = @($exitNonZero)
            zeroChecks = @($zeroChecks)
            failedChecks = @($failedCheckIds)
            postProblems = @($PostProblems)
        }
    }
}

# ---------------------------------------------------------------------------
# PASS eligibility contract (used by self-test and by any later verifier)
# ---------------------------------------------------------------------------
function Test-BundlePublishable {
    param([Parameter(Mandatory)][string]$Dir)
    $manifestPath = [System.IO.Path]::Combine($Dir, 'manifest.json')
    $sumsPath = [System.IO.Path]::Combine($Dir, 'MANIFEST.sha256')
    $statePath = [System.IO.Path]::Combine($Dir, '00-run-state.txt')
    $reasons = New-Object System.Collections.ArrayList
    $report = [pscustomobject]@{
        publishable = $false
        reasons = @()
        manifestExists = $false
        sumsExists = $false
        stateExists = $false
        statePhase = ''
        digestMatch = $false
        verdictResult = ''
    }
    $report.manifestExists = Test-Path -LiteralPath $manifestPath -PathType Leaf
    $report.sumsExists = Test-Path -LiteralPath $sumsPath -PathType Leaf
    $report.stateExists = Test-Path -LiteralPath $statePath -PathType Leaf
    if (-not $report.manifestExists) { [void]$reasons.Add('manifest.json missing') }
    if (-not $report.sumsExists) { [void]$reasons.Add('MANIFEST.sha256 missing') }
    if (-not $report.stateExists) { [void]$reasons.Add('00-run-state.txt missing') }
    if ($report.manifestExists) {
        try {
            $parsed = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
            $report.verdictResult = [string]$parsed.verdict.result
        }
        catch {
            [void]$reasons.Add('manifest.json unreadable')
        }
        if ($report.sumsExists) {
            $firstLine = [string](@(Get-Content -LiteralPath $sumsPath -TotalCount 1)[0])
            $m = [regex]::Match($firstLine, '^([0-9a-f]{64})  manifest\.json\s*$')
            if ($m.Success) {
                $fp = Get-FileFingerprint -Path $manifestPath
                $report.digestMatch = [string]::Equals([string]$fp.sha256, [string]$m.Groups[1].Value, [System.StringComparison]::OrdinalIgnoreCase)
            }
            if (-not $report.digestMatch) { [void]$reasons.Add('MANIFEST.sha256 digest mismatch') }
        }
    }
    if ($report.stateExists) {
        $report.statePhase = Get-RunStatePhase -Path $statePath
        if ($report.statePhase -ne 'complete') { [void]$reasons.Add('state phase is not complete') }
    }
    if ($report.manifestExists -and ($report.verdictResult -ne 'PASS')) { [void]$reasons.Add('verdict is not PASS') }
    $report.reasons = @($reasons)
    $report.publishable = (@($reasons).Count -eq 0)
    return $report
}

# ---------------------------------------------------------------------------
# Publication
# ---------------------------------------------------------------------------
function Test-ManifestShape {
    param([Parameter(Mandatory)]$Manifest)
    foreach ($name in @('schemaVersion', 'runId', 'mode', 'phase', 'steps', 'invariants', 'verdict', 'files', 'artifacts', 'preconditions', 'publication')) {
        if ($null -eq $Manifest.PSObject.Properties[$name]) { return $false }
    }
    if (@($Manifest.steps).Count -ne $script:ExpectedStepCount) { return $false }
    if (@($Manifest.invariants).Count -eq 0) { return $false }
    if (@($Manifest.files).Count -eq 0) { return $false }
    if ([int]$Manifest.verdict.exitCode -eq $script:ExitPass) {
        if ([string]$Manifest.verdict.result -ne 'PASS') { return $false }
        if ([string]$Manifest.phase -ne 'complete') { return $false }
        if (@($Manifest.verdict.failedConditions).Count -ne 0) { return $false }
        foreach ($p in $Manifest.verdict.conditions.PSObject.Properties) {
            if (-not [bool]$p.Value) { return $false }
        }
    }
    return $true
}

function Publish-Evidence {
    param(
        [Parameter(Mandatory)][string]$Dir,
        [Parameter(Mandatory)]$Manifest,
        [Parameter(Mandatory)][string]$ExpectedPhase,
        [Parameter(Mandatory)][string]$RunIdValue,
        [Parameter(Mandatory)][int]$PlannedExit
    )
    $result = [pscustomobject]@{
        ok = $false
        exitCode = [int]$script:ExitPublication
        why = ''
        manifestPath = ''
        sumsPath = ''
        digest = ''
    }
    $tmpPath = [System.IO.Path]::Combine($Dir, 'manifest.json.tmp')
    $finalPath = [System.IO.Path]::Combine($Dir, 'manifest.json')
    $sumsPath = [System.IO.Path]::Combine($Dir, $script:PublishableName)
    try {
        Write-TextFile -Path $tmpPath -Text ([string]($Manifest | ConvertTo-Json -Depth 12))
    }
    catch {
        $result.why = 'manifest serialization failed: ' + [string]$_.Exception.Message
        return $result
    }
    $shapeOk = $false
    try {
        $parsed = Get-Content -Raw -LiteralPath $tmpPath | ConvertFrom-Json
        $shapeOk = Test-ManifestShape -Manifest $parsed
    }
    catch {
        $result.why = 'manifest unreadable after write: ' + [string]$_.Exception.Message
        return $result
    }
    if (-not $shapeOk) {
        $result.why = 'manifest shape invalid; refusing to publish'
        return $result
    }
    $tmpFp = Get-FileFingerprint -Path $tmpPath
    $digest = [string]$tmpFp.sha256
    if ([regex]::IsMatch($digest, '^[0-9a-f]{64}$') -eq $false) {
        $result.why = 'manifest digest unavailable'
        return $result
    }
    try {
        Move-Item -LiteralPath $tmpPath -Destination $finalPath -ErrorAction Stop
    }
    catch {
        $result.why = 'atomic move failed: ' + [string]$_.Exception.Message
        return $result
    }
    $finalFp = Get-FileFingerprint -Path $finalPath
    if (-not [string]::Equals([string]$finalFp.sha256, $digest, [System.StringComparison]::OrdinalIgnoreCase)) {
        $result.why = 'post-move digest mismatch'
        return $result
    }
    try {
        Write-TextFile -Path $sumsPath -Text ($digest + '  manifest.json' + "`n")
    }
    catch {
        $result.why = 'MANIFEST.sha256 write failed: ' + [string]$_.Exception.Message
        return $result
    }
    if ((@($Manifest.steps).Count -ne $script:ExpectedStepCount) -or ([int]$Manifest.verdict.exitCode -ne $PlannedExit)) {
        $result.why = 'manifest disagrees with the planned exit code'
        return $result
    }
    Set-RunStateFile -Path ([System.IO.Path]::Combine($Dir, '00-run-state.txt')) -RunIdValue $RunIdValue -Phase $ExpectedPhase
    $observedPhase = Get-RunStatePhase -Path ([System.IO.Path]::Combine($Dir, '00-run-state.txt'))
    if ($observedPhase -ne $ExpectedPhase) {
        $result.why = 'run-state file was not finalized'
        return $result
    }
    $result.ok = $true
    $result.exitCode = [int]$PlannedExit
    $result.manifestPath = [string]$finalPath
    $result.sumsPath = [string]$sumsPath
    $result.digest = [string]$digest
    return $result
}

# ---------------------------------------------------------------------------
# Fault injection (self-test only; throws out of the capture frame)
# ---------------------------------------------------------------------------
function Invoke-FaultPoint {
    param(
        [Parameter(Mandatory)][string]$Current,
        [AllowEmptyString()][string]$Requested = ''
    )
    if ((-not [string]::IsNullOrWhiteSpace($Requested)) -and ([string]$Requested -eq $Current)) {
        throw ('INJECTED_FAULT at checkpoint ' + $Current)
    }
}

# ---------------------------------------------------------------------------
# Post-flight (worktree and input identity must be unchanged)
# ---------------------------------------------------------------------------
function Get-PostFlight {
    param(
        [Parameter(Mandatory)]$Preconditions,
        [Parameter(Mandatory)][AllowEmptyString()][string]$RepoFull
    )
    $checks = New-Object System.Collections.ArrayList
    $problems = New-Object System.Collections.ArrayList
    $statusAfter = @()
    $statusResult = Get-GitText -GitWorkingDirectory $RepoFull -GitArgs @('status', '--porcelain=v1', '-uall')
    if ($statusResult.ok) { $statusAfter = @($statusResult.lines) }
    [void](Add-Check -List $checks -Id 'post.git.status.readable' -Ok $statusResult.ok -Detail ('exit=' + $statusResult.exitCode))
    $beforeSorted = @(@($Preconditions.statusBefore) | Sort-Object)
    $afterSorted = @($statusAfter | Sort-Object)
    $unchanged = (($beforeSorted -join "`n") -eq ($afterSorted -join "`n"))
    [void](Add-Check -List $checks -Id 'post.worktree.unchanged' -Ok $unchanged -Detail ('before=' + $beforeSorted.Count + ' after=' + $afterSorted.Count))
    if (-not $unchanged) { [void]$problems.Add('worktree status changed during capture') }

    $inputChanges = New-Object System.Collections.ArrayList
    foreach ($entry in @($Preconditions.inputs)) {
        $full = [System.IO.Path]::Combine($RepoFull, ([string]$entry.path).Replace('/', '\'))
        $fp = Get-FileFingerprint -Path $full
        if (-not [string]::Equals([string]$fp.sha256, [string]$entry.baselineSha256, [System.StringComparison]::OrdinalIgnoreCase)) {
            [void]$inputChanges.Add([string]$entry.path)
        }
    }
    [void](Add-Check -List $checks -Id 'post.inputs.unchanged' -Ok (@($inputChanges).Count -eq 0) -Detail ('changed=' + (@($inputChanges) -join ',')))
    if (@($inputChanges).Count -gt 0) { [void]$problems.Add('input identity changed: ' + (@($inputChanges) -join ',')) }

    return [pscustomobject]@{
        checks = @($checks)
        problems = @($problems)
        statusAfter = @($statusAfter)
    }
}

# ---------------------------------------------------------------------------
# Capture
# ---------------------------------------------------------------------------
function Invoke-Capture {
    param(
        [Parameter(Mandatory)]$Pre,
        [bool]$SelfTestMode = $false,
        [AllowEmptyString()][string]$FaultAt = '',
        [AllowEmptyString()][string]$RunIdOverrideValue = '',
        [bool]$UseFakeSteps = $false
    )
    Reset-RunState
    $repo = [string]$Pre.repoFull
    $evidenceRoot = [string]$Pre.evidenceRootFull
    $nodeExe = [string]$Pre.nodeExe

    $specs = @()
    if ($UseFakeSteps) { $specs = @($script:FixtureSpecs) }
    else { $specs = @($script:ApprovedSpecs) }

    # Vector allowlist is enforced before anything is created.
    foreach ($spec in $specs) {
        if ($UseFakeSteps) {
            Assert-NoWhitespaceArgs -Vector ([string]$spec.vector) -ArgumentList @($spec.args)
        }
        else {
            $null = Assert-ApprovedVector -Vector ([string]$spec.vector) -ArgumentList @($spec.args)
        }
    }
    if (-not $UseFakeSteps) {
        if (@($script:ApprovedVectors).Count -ne 3) {
            Add-Reason 'approved vector table is not exactly three commands'
            return $script:ExitRefused
        }
        if (@($specs).Count -ne $script:ExpectedStepCount) {
            Add-Reason 'step table is not exactly three steps'
            return $script:ExitRefused
        }
    }

    $runId = [string]$RunIdOverrideValue
    if ([string]::IsNullOrWhiteSpace($runId)) {
        $runId = 'offline-' + (Get-Date).ToString('yyyyMMdd-HHmmss') + '-' + ([guid]::NewGuid().ToString('N').Substring(0, 8))
    }
    $dir = [System.IO.Path]::Combine($evidenceRoot, $runId)
    $script:LastBundle = [string]$dir

    $historicalBefore = 0
    if (Test-Path -LiteralPath $evidenceRoot -PathType Container) {
        $historicalBefore = @(Get-ChildItem -LiteralPath $evidenceRoot -Directory -Force | Where-Object { $_.Name.StartsWith('offline-') }).Count
    }

    if (Test-Path -LiteralPath $dir) {
        Add-Reason 'evidence directory already exists; refusing to reuse or overwrite a historical bundle'
        return $script:ExitRefused
    }
    try {
        $null = New-Item -ItemType Directory -Path $dir -ErrorAction Stop
    }
    catch {
        Add-Reason ('evidence directory could not be created: ' + [string]$_.Exception.Message)
        return $script:ExitRefused
    }
    $existing = @(Get-ChildItem -LiteralPath $dir -Force)
    $dirWasEmpty = ($existing.Count -eq 0)
    if (-not $dirWasEmpty) {
        Add-Reason 'new evidence directory is not empty; refusing to continue'
        return $script:ExitRefused
    }

    $script:EvidenceDir = [string]$dir
    $script:RunId = [string]$runId
    $statePath = [System.IO.Path]::Combine($dir, '00-run-state.txt')
    $script:StatePath = [string]$statePath
    Set-RunStateFile -Path $statePath -RunIdValue $runId -Phase 'running'
    $phaseBeforeSteps = Get-RunStatePhase -Path $statePath

    Invoke-FaultPoint -Current 'after-dir' -Requested $FaultAt

    $mode = 'capture'
    if ($UseFakeSteps) { $mode = 'selftest-capture' }

    # --- plan and provenance before the first spawn ------------------------
    $planLines = New-Object System.Collections.ArrayList
    [void]$planLines.Add('slmm-t6 offline evidence capture')
    [void]$planLines.Add('schemaVersion=' + [string]$script:SchemaVersion)
    [void]$planLines.Add('runId=' + [string]$runId)
    [void]$planLines.Add('mode=' + [string]$mode)
    [void]$planLines.Add('repo=' + [string]$repo)
    [void]$planLines.Add('evidenceDir=' + [string]$dir)
    [void]$planLines.Add('head=' + [string]$Pre.head)
    [void]$planLines.Add('approvedVectorCount=' + [string]@($script:ApprovedVectors).Count)
    foreach ($spec in $specs) { [void]$planLines.Add('vector=' + [string]$spec.vector) }
    Write-TextFile -Path ([System.IO.Path]::Combine($dir, 'plan.txt')) -Text ((@($planLines) -join "`n") + "`n")

    $headLines = @(
        ('head=' + [string]$Pre.head)
        ('branch=' + [string]$Pre.branch)
        ('origin/main=' + [string]$Pre.originMain)
        ('ahead_behind=' + [string]$Pre.aheadBehind)
        ('capturedUtc=' + (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))
    )
    Write-TextFile -Path ([System.IO.Path]::Combine($dir, '10-git-head.txt')) -Text ((@($headLines) -join "`n") + "`n")
    Write-TextFile -Path ([System.IO.Path]::Combine($dir, '10-git-status-before.txt')) -Text (((@($Pre.statusBefore)) -join "`n") + "`n")
    Write-TextFile -Path ([System.IO.Path]::Combine($dir, '11-inputs.json')) -Text ([string]([pscustomobject]@{ baseline = @($Pre.inputs) } | ConvertTo-Json -Depth 6))
    Write-TextFile -Path ([System.IO.Path]::Combine($dir, '12-preconditions.json')) -Text ([string]([pscustomobject]@{ ok = [bool]$Pre.ok; failed = @($Pre.failed); checks = @($Pre.checks) } | ConvertTo-Json -Depth 6))

    # --- steps -------------------------------------------------------------
    $abortIndex = -1
    for ($i = 0; $i -lt @($specs).Count; $i++) {
        $spec = $specs[$i]
        $stepId = [string]$spec.id
        $stdoutPath = [System.IO.Path]::Combine($dir, ($stepId + '.stdout.txt'))
        $stderrPath = [System.IO.Path]::Combine($dir, ($stepId + '.stderr.txt'))
        Write-Log ('[step] ' + $stepId + ' :: ' + [string]$spec.vector)

        $processResult = Invoke-CapturedProcess -Exe $nodeExe -Arguments @($spec.args) -WorkingDirectory $repo -StdoutPath $stdoutPath -StderrPath $stderrPath -TimeoutMilliseconds ([int]$spec.timeoutMs)

        $outputChecks = @()
        $observed = $null
        if ($processResult.started -and (-not $processResult.timedOut) -and $processResult.terminationConfirmed -and $processResult.exitCodeObserved) {
            $evaluated = Get-StepOutputChecks -Kind ([string]$spec.kind) -Variant $stepId -StdoutPath $stdoutPath -StderrPath $stderrPath
            $outputChecks = @($evaluated.checks)
            $observed = $evaluated.observed
        }
        else {
            $reason = 'step did not produce a reviewable process record'
            if ($processResult.spawnError -ne '') { $reason = 'spawn failed: ' + [string]$processResult.spawnError }
            elseif ($processResult.timedOut) { $reason = 'timed out' }
            elseif (-not $processResult.terminationConfirmed) { $reason = 'termination not independently confirmed' }
            $gateChecks = New-Object System.Collections.ArrayList
            [void](Add-Check -List $gateChecks -Id ($stepId + '.output.reviewable') -Ok $false -Detail $reason)
            $outputChecks = @($gateChecks)
        }

        # Final survivor decision is generation-aware. The PID list is kept for
        # reporting, but the decision uses each generation's own creation time, so
        # a reused PID can neither stand in for a dead descendant nor hide a live
        # one. The PID-keyed path is only a fallback for a result that carries no
        # generation evidence at all.
        $survivorGenerations = @()
        $graceGenerations = @(@($processResult.descendantsAliveAfterGraceGenerations) | Where-Object { $null -ne $_ })
        if ($graceGenerations.Count -gt 0) {
            $survivorGenerations = @(Get-SurvivingGenerations -Generations @($graceGenerations))
            $survivors = @($survivorGenerations | ForEach-Object { [int]$_.pid } | Sort-Object -Unique)
        }
        else {
            $survivors = @(Get-SurvivingPids -Candidate @($processResult.descendantsAliveAfterGrace) -CreationUtcById $processResult.descendantCreationUtcById)
        }
        $survivorGenerationKeys = @($survivorGenerations | ForEach-Object { [string]$_.key })
        $record = New-StepRecord -Id $stepId -Vector ([string]$spec.vector) -State 'pending'
        $record.observed = $observed
        $null = Set-StepGate -Record $record -ProcessResult $processResult -Checks $outputChecks -DescendantsAliveAtVerdict $survivors -DescendantsAliveAtVerdictGenerationKeys $survivorGenerationKeys
        [void]$script:StepRecords.Add($record)
        Write-TextFile -Path ([System.IO.Path]::Combine($dir, ($stepId + '.meta.json'))) -Text ([string]($record | ConvertTo-Json -Depth 8))

        if ($i -eq 0) { Invoke-FaultPoint -Current 'after-step-1' -Requested $FaultAt }

        if (-not $record.completed) {
            $why = 'step failed'
            if (-not $record.started) { $why = 'spawn failed' }
            elseif ($record.timedOut) { $why = 'timed out' }
            elseif (-not $record.terminated) { $why = 'termination not confirmed' }
            elseif (@($record.failedChecks).Count -gt 0) { $why = 'check failed: ' + [string](@($record.failedChecks)[0]) }
            elseif (@($record.descendantsAliveAtVerdict).Count -gt 0) { $why = 'surviving descendant process' }
            Add-Reason ('aborted after ' + $stepId + ' (' + $why + ')')
            $abortIndex = $i
            break
        }
    }

    $attempted = @($script:StepRecords | ForEach-Object { [string]$_.id })
    for ($j = 0; $j -lt @($specs).Count; $j++) {
        $spec = $specs[$j]
        if (-not ($attempted -contains [string]$spec.id)) {
            $record = New-StepRecord -Id ([string]$spec.id) -Vector ([string]$spec.vector) -State 'notRun'
            [void]$script:StepRecords.Add($record)
        }
    }

    # --- post-flight -------------------------------------------------------
    $post = Get-PostFlight -Preconditions $Pre -RepoFull $repo
    Write-TextFile -Path ([System.IO.Path]::Combine($dir, '10-git-status-after.txt')) -Text (((@($post.statusAfter)) -join "`n") + "`n")

    $invariants = New-Object System.Collections.ArrayList
    $notRunCount = @($script:StepRecords | Where-Object { [string]$_.state -eq 'notRun' }).Count
    [void](Add-Check -List $invariants -Id 'invariant.stepRecordCount' -Ok (@($script:StepRecords).Count -eq $script:ExpectedStepCount) -Detail ('count=' + @($script:StepRecords).Count + ' required=' + $script:ExpectedStepCount))
    [void](Add-Check -List $invariants -Id 'invariant.completionIsCountNotSubtraction' -Ok ((@($script:StepRecords).Count -eq $script:ExpectedStepCount) -and ($notRunCount -eq 0)) -Detail ('notRun=' + $notRunCount))
    [void](Add-Check -List $invariants -Id 'invariant.exclusiveNewDirectory' -Ok ([bool]$dirWasEmpty) -Detail 'New-Item on a non-existent path, verified empty before use')
    [void](Add-Check -List $invariants -Id 'invariant.stateWrittenBeforeFirstSpawn' -Ok ([string]$phaseBeforeSteps -eq 'running') -Detail ('phase=' + [string]$phaseBeforeSteps))
    $historicalAfter = 0
    if (Test-Path -LiteralPath $evidenceRoot -PathType Container) {
        $historicalAfter = @(Get-ChildItem -LiteralPath $evidenceRoot -Directory -Force | Where-Object { $_.Name.StartsWith('offline-') -and $_.Name -ne $runId }).Count
    }
    [void](Add-Check -List $invariants -Id 'invariant.historicalBundlesUntouched' -Ok ($historicalAfter -eq $historicalBefore) -Detail ('before=' + $historicalBefore + ' after=' + $historicalAfter))
    $deleteScan = Test-NoDestructiveCommands -ScriptPath ([string]$PSCommandPath)
    [void](Add-Check -List $invariants -Id 'invariant.noDestructiveCommands' -Ok ([bool]$deleteScan.ok) -Detail ([string]$deleteScan.detail))
    $vectorScan = Get-ApprovedVectorScan -ScriptPath ([string]$PSCommandPath)
    [void](Add-Check -List $invariants -Id 'invariant.threeApprovedVectorsOnly' -Ok ([bool]$vectorScan.ok) -Detail ([string]$vectorScan.detail))
    foreach ($c in @($post.checks)) { [void]$invariants.Add($c) }

    # --- checksum manifest and inventory ----------------------------------
    $evidenceRel = New-Object System.Collections.ArrayList
    [void]$evidenceRel.Add('plan.txt')
    [void]$evidenceRel.Add('10-git-head.txt')
    [void]$evidenceRel.Add('10-git-status-before.txt')
    [void]$evidenceRel.Add('10-git-status-after.txt')
    [void]$evidenceRel.Add('11-inputs.json')
    [void]$evidenceRel.Add('12-preconditions.json')
    foreach ($r in @($script:StepRecords)) {
        if ([string]$r.state -eq 'notRun') { continue }
        [void]$evidenceRel.Add([string]$r.id + '.stdout.txt')
        [void]$evidenceRel.Add([string]$r.id + '.stderr.txt')
        [void]$evidenceRel.Add([string]$r.id + '.meta.json')
    }
    $sums = Write-EvidenceSums -Dir $dir -RelativePaths @($evidenceRel)
    $inventory = Get-ArtifactInventory -Dir $dir -ExpectedRelative @($evidenceRel)

    $verdict = Get-FinalVerdict -Preconditions $Pre -Inventory $inventory -Sums $sums -PostProblems @($post.problems)

    Invoke-FaultPoint -Current 'before-manifest' -Requested $FaultAt

    # --- reconciliation against the 2026-10-22 claims ---------------------
    $suiteObserved = $null
    $tapObserved = $null
    $tscObserved = $null
    foreach ($r in @($script:StepRecords)) {
        if ([string]$r.id -eq '01-offline-suites') { $suiteObserved = $r.observed }
        if ([string]$r.id -eq '02-group-r-unit') { $tapObserved = $r.observed }
        if ([string]$r.id -eq '03-tsc-noemit') { $tscObserved = $r.observed }
    }
    $observedSuites = -1
    $observedTotalTests = -1
    $observedGroupRPass = -1
    $observedTscDiagnostics = -1
    # Fake-step observations are generic (no totals/counts/diagnostics). Skipping the read there
    # must not weaken real-mode validation, so a missing property is only tolerated in fake mode;
    # in real mode the dereference below still throws exactly as before.
    $fakeObservation = [bool]$UseFakeSteps
    if ($null -ne $suiteObserved) {
        $hasTotals = ($null -ne $suiteObserved.PSObject.Properties['totals'])
        if ($hasTotals -or (-not $fakeObservation)) {
            $observedSuites = [int]$suiteObserved.totals.suites
            $observedTotalTests = [int]$suiteObserved.totals.tests
        }
    }
    if ($null -ne $tapObserved) {
        $hasCounts = ($null -ne $tapObserved.PSObject.Properties['counts'])
        if ($hasCounts -or (-not $fakeObservation)) {
            if ($tapObserved.counts.ContainsKey('pass')) { $observedGroupRPass = [int]$tapObserved.counts['pass'] }
        }
    }
    if ($null -ne $tscObserved) {
        $hasDiagnostics = ($null -ne $tscObserved.PSObject.Properties['diagnostics'])
        if ($hasDiagnostics -or (-not $fakeObservation)) {
            $observedTscDiagnostics = [int]$tscObserved.diagnostics
        }
    }
    $reconMatch = (($observedSuites -eq 21) -and ($observedTotalTests -eq 734) -and ($observedGroupRPass -eq 169) -and ($observedTscDiagnostics -eq 0))

    $phaseForState = 'failed'
    if ([string]$verdict.result -eq 'PASS') { $phaseForState = 'complete' }

    $fileEntries = New-Object System.Collections.ArrayList
    foreach ($e in @($sums.entries)) { [void]$fileEntries.Add($e) }
    [void]$fileEntries.Add([pscustomobject]@{ path = 'SHA256SUMS.txt'; exists = $true; bytes = [int]$sums.sumsBytes; sha256 = [string]$sums.sumsSha256 })

    # Additive identity summary. Per-step generation records carry the detail;
    # this block makes the model and the reuse counts visible at the top level
    # without changing any existing field.
    $totalGenerationsObserved = 0
    $totalReuseEvents = 0
    $totalIdentityNotes = 0
    foreach ($stepRecord in @($script:StepRecords)) {
        $totalGenerationsObserved = $totalGenerationsObserved + [int]$stepRecord.descendantGenerationsObserved
        $totalReuseEvents = $totalReuseEvents + [int]$stepRecord.descendantReuseCount
        $totalIdentityNotes = $totalIdentityNotes + @($stepRecord.descendantIdentityNotes).Count
    }

    $manifest = [pscustomobject]@{
        schemaVersion = [int]$script:SchemaVersion
        runId = [string]$runId
        mode = [string]$mode
        phase = [string]$phaseForState
        generatedUtc = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        generatedLocal = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
        host = [pscustomobject]@{
            computerName = [string][System.Environment]::MachineName
            osVersion = [string]([System.Environment]::OSVersion.VersionString)
            powershellVersion = [string]$PSVersionTable.PSVersion.ToString()
            is64BitOS = [bool][System.Environment]::Is64BitOperatingSystem
            timeZone = [string][System.TimeZoneInfo]::Local.Id
        }
        toolchain = [pscustomobject]@{
            node = [string]$nodeExe
            nodeVersion = [string]$Pre.nodeVersion
            runner = 'node'
            offlineSuiteEntry = 'scripts/run-offline-tests.mjs'
            groupRUnit = 'test-harness/t6-checkpoint/t6-group-r-runner-tests.mjs'
            tsc = 'node_modules/typescript/bin/tsc'
        }
        approval = [pscustomobject]@{
            operatorReference = [string]$ApprovalRef
            acknowledgeSwitch = [bool]$AcknowledgeTestsRun
            enforced = $false
            note = 'Operator approval is supplied by the caller and is not cryptographically enforced by this script.'
        }
        authorization = [pscustomobject]@{
            approvedVectors = @($script:ApprovedVectors)
            approvedVectorCount = @($script:ApprovedVectors).Count
            blockedEnvNames = @($Pre.blockedEnv)
            environmentCanAuthorize = $false
            note = 'No environment variable value is read; only names are checked for blockers.'
        }
        expectations = [pscustomobject]@{
            steps = [int]$script:ExpectedStepCount
            suites = [int]$script:ExpectedSuiteCount
            groupRTests = [int]$script:ExpectedGroupRTests
            tscDiagnostics = 0
            stderrBytes = 0
        }
        preconditions = @($Pre.checks)
        processIdentity = [pscustomobject]@{
            model = 'A generation is (pid, CIM CreationDate UTC). The registry is step-scoped and never overwritten; PID lists are reporting only.'
            generationAwareGraceAndVerdict = $true
            sequentialReuseIsAnEventNotAConflict = $true
            withinSnapshotContradictionFailsClosed = $true
            unknownIdentityIsNeverAbsence = $true
            totalGenerationsObserved = [int]$totalGenerationsObserved
            totalReuseEvents = [int]$totalReuseEvents
            totalIdentityNotes = [int]$totalIdentityNotes
        }
        steps = @($script:StepRecords)
        invariants = @($invariants)
        artifacts = $inventory
        files = @($fileEntries)
        warnings = @($script:Warnings)
        reconciliation = [pscustomobject]@{
            baseline = [pscustomobject]@{
                claimDate = '2026-10-22'
                claimGroupRUnit = '169/169'
                claimOfflineSuite = '734/734 across 21 suites'
                claimTsc = 'clean'
                status = 'UNVERIFIED: the original logs no longer exist'
            }
            observed = [pscustomobject]@{
                suites = [int]$observedSuites
                suiteTests = [int]$observedTotalTests
                groupRPass = [int]$observedGroupRPass
                tscDiagnostics = [int]$observedTscDiagnostics
            }
            match = [bool]$reconMatch
            note = 'Computed at run time. false means this run does not reproduce the 2026-10-22 figures.'
        }
        publication = [pscustomobject]@{
            contract = 'PASS is publishable only if exit 0, MANIFEST.sha256 matches manifest.json, and 00-run-state.txt contains phase=complete'
            expectedPhase = [string]$phaseForState
            manifestSha256 = ''
            sumsSha256 = [string]$sums.sumsSha256
            note = 'manifestSha256 is empty by construction; the external MANIFEST.sha256 supplies it.'
        }
        verdict = [pscustomobject]@{
            result = [string]$verdict.result
            exitCode = [int]$verdict.exitCode
            failedConditions = @($verdict.failedConditions)
            conditions = $verdict.conditions
            detail = $verdict.detail
            reasons = @($script:Reasons)
            scope = 'Execution integrity only. This run does not verify any previously reported test count.'
        }
    }

    Write-Log ('[verdict] ' + [string]$verdict.result + ' exit=' + [int]$verdict.exitCode)
    foreach ($f in @($verdict.failedConditions)) { Write-Log ('[failed] ' + [string]$f) }

    $publication = Publish-Evidence -Dir $dir -Manifest $manifest -ExpectedPhase $phaseForState -RunIdValue $runId -PlannedExit ([int]$verdict.exitCode)
    if (-not $publication.ok) {
        Add-Reason ('publication failed: ' + [string]$publication.why)
        $null = Set-AbortState -Dir $dir -RunIdValue $runId -Reason ('publication verification failed: ' + [string]$publication.why)
        return $script:ExitPublication
    }

    $script:Verdict = [string]$verdict.result
    Invoke-FaultPoint -Current 'after-publish' -Requested $FaultAt
    return [int]$publication.exitCode
}

# ---------------------------------------------------------------------------
# Plan-only (read-only; creates nothing)
# ---------------------------------------------------------------------------
function Invoke-PlanOnly {
    param([Parameter(Mandatory)]$Pre)
    Write-Log 'SLMM T6 offline evidence capture - PLAN ONLY (nothing will be created)'
    Write-Log ('repo=' + [string]$Pre.repoFull)
    Write-Log ('head=' + [string]$Pre.head)
    Write-Log ('branch=' + [string]$Pre.branch)
    Write-Log ('origin/main=' + [string]$Pre.originMain)
    Write-Log ('ahead_behind=' + [string]$Pre.aheadBehind)
    Write-Log ('worktree modified=' + [string]$Pre.counts.modified + ' untracked=' + [string]$Pre.counts.untracked + ' staged=' + [string]$Pre.counts.staged + ' deleted=' + [string]$Pre.counts.deleted)
    Write-Log ('evidenceRoot=' + [string]$Pre.evidenceRootFull + ' freeGb=' + [string]$Pre.freeGb)
    Write-Log ('node=' + [string]$Pre.nodeExe + ' productVersion=' + [string]$Pre.nodeVersion)
    Write-Log ('pins=' + [string]$Pre.pins.count + ' allMatch=' + [string]$Pre.pins.ok)
    Write-Log ('approvedVectors=' + [string](@($script:ApprovedVectors).Count))
    foreach ($v in @($script:ApprovedVectors)) { Write-Log ('  vector: ' + [string]$v) }
    Write-Log 'preconditions:'
    foreach ($c in @($Pre.checks)) {
        $mark = 'FAIL'
        if ([bool]$c.ok) { $mark = 'PASS' }
        Write-Log ('  [' + $mark + '] ' + [string]$c.id + ' :: ' + [string]$c.detail)
    }
    if (-not [bool]$Pre.ok) {
        Write-Log ('plan-only: REFUSED, ' + [string](@($Pre.failed).Count) + ' precondition(s) failed')
        foreach ($f in @($Pre.failed)) { Write-Log ('  failed: ' + [string]$f) }
        return $script:ExitPlanRefused
    }
    Write-Log 'plan-only: all preconditions satisfied; no directory was created'
    return $script:ExitPlanOk
}

# ---------------------------------------------------------------------------
# Self-test support helpers
# ---------------------------------------------------------------------------
function New-SelfTestCaseResult {
    param(
        [Parameter(Mandatory)][string]$Id,
        [Parameter(Mandatory)][string]$State,
        [AllowEmptyString()][string]$Detail = ''
    )
    return [pscustomobject]@{
        id = [string]$Id
        state = [string]$State
        ok = ([string]$State -eq 'pass')
        detail = [string]$Detail
    }
}

function New-TempDir {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][string]$Name
    )
    $path = [System.IO.Path]::Combine($Root, ($Name + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)))
    $null = New-Item -ItemType Directory -Path $path -ErrorAction Stop
    return [string]$path
}

function New-FakeStepRecord {
    param(
        [Parameter(Mandatory)][string]$Id,
        [string]$StateValue = 'passed',
        [bool]$Started = $true,
        [bool]$Terminated = $true,
        [int]$ExitCodeValue = 0,
        [bool]$ExitObserved = $true,
        [int]$CheckCount = 1,
        [AllowEmptyCollection()][string[]]$FailedChecks = @(),
        [AllowEmptyCollection()][int[]]$Survivors = @(),
        [bool]$TimedOut = $false,
        [AllowEmptyString()][string]$SpawnErrorText = ''
    )
    $record = New-StepRecord -Id $Id -Vector 'selftest:vector' -State $StateValue
    $record.started = $Started
    $record.terminated = $Terminated
    $record.exitCode = $ExitCodeValue
    $record.exitCodeObserved = $ExitObserved
    $record.checkCount = $CheckCount
    $record.failedChecks = @($FailedChecks)
    $record.descendantsAliveAtVerdict = @($Survivors)
    $record.timedOut = $TimedOut
    $record.spawnError = $SpawnErrorText
    return $record
}

function Get-SelfTestNodeExe {
    $programFiles = [System.Environment]::GetFolderPath('ProgramFiles')
    if (-not [string]::IsNullOrWhiteSpace($programFiles)) {
        $candidate = [System.IO.Path]::Combine($programFiles, 'nodejs', 'node.exe')
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return [string]$candidate }
    }
    return ''
}

# ---------------------------------------------------------------------------
# Self-test cases S1-S5: process control
# ---------------------------------------------------------------------------
function Invoke-SelfTestS1 {
    param([Parameter(Mandatory)][string]$NodeExe, [Parameter(Mandatory)][string]$Root)
    $dir = New-TempDir -Root $Root -Name 's1'
    $r = Invoke-CapturedProcess -Exe $NodeExe -Arguments @('-e', 'process.exit(0)') -WorkingDirectory $Root -StdoutPath ([System.IO.Path]::Combine($dir, 'out.txt')) -StderrPath ([System.IO.Path]::Combine($dir, 'err.txt')) -TimeoutMilliseconds 60000
    $checks = New-Object System.Collections.ArrayList
    [void](Add-Check -List $checks -Id 's1.output.reviewable' -Ok $true -Detail 'fixture produced reviewable output')
    $record = New-StepRecord -Id 'selftest-s1' -Vector 'selftest:fixture-pass-a' -State 'pending'
    $null = Set-StepGate -Record $record -ProcessResult $r -Checks @($checks) -DescendantsAliveAtVerdict @()
    $ok = ($record.completed -and [bool]$r.exitCodeObserved -and ([int]$r.exitCode -eq 0))
    return New-SelfTestCaseResult -Id 'S1' -State $(if ($ok) { 'pass' } else { 'fail' }) -Detail ('exit=' + [string]$r.exitCode + ' observed=' + [string]$r.exitCodeObserved + ' terminated=' + [string]$r.terminationConfirmed)
}

function Invoke-SelfTestS2 {
    param([Parameter(Mandatory)][string]$NodeExe, [Parameter(Mandatory)][string]$Root)
    $dir = New-TempDir -Root $Root -Name 's2'
    $r = Invoke-CapturedProcess -Exe $NodeExe -Arguments @('-e', 'process.exit(7)') -WorkingDirectory $Root -StdoutPath ([System.IO.Path]::Combine($dir, 'out.txt')) -StderrPath ([System.IO.Path]::Combine($dir, 'err.txt')) -TimeoutMilliseconds 60000
    $checks = New-Object System.Collections.ArrayList
    [void](Add-Check -List $checks -Id 's2.output.reviewable' -Ok $true -Detail 'fixture produced reviewable output')
    $record = New-StepRecord -Id 'selftest-s2' -Vector 'selftest:fixture-exit7' -State 'pending'
    $null = Set-StepGate -Record $record -ProcessResult $r -Checks @($checks) -DescendantsAliveAtVerdict @()
    $ok = ((-not $record.completed) -and ([int]$r.exitCode -eq 7))
    $s2Error = [string]$r.spawnError
    if ($s2Error -eq '') { $s2Error = [string]$r.terminationError }
    if ($s2Error -eq '') { $s2Error = '<none>' }
    $s2Error = ($s2Error -replace "`r", ' ' -replace "`n", ' ')
    return New-SelfTestCaseResult -Id 'S2' -State $(if ($ok) { 'pass' } else { 'fail' }) -Detail ('exit=' + [string]$r.exitCode + ' completed=' + [string]$record.completed + ' failedCheck=' + ((@($record.failedChecks)) -join ',') + ' pid=' + [string][int]$r.pid + ' exitObserved=' + [string][bool]$r.exitCodeObserved + ' terminated=' + [string][bool]$r.terminationConfirmed + ' procError=' + $s2Error)
}

function Invoke-SelfTestS3 {
    param([Parameter(Mandatory)][string]$NodeExe, [Parameter(Mandatory)][string]$Root)
    $dir = New-TempDir -Root $Root -Name 's3'
    $r = Invoke-CapturedProcess -Exe $NodeExe -Arguments @('-e', 'setTimeout(()=>{},120000)') -WorkingDirectory $Root -StdoutPath ([System.IO.Path]::Combine($dir, 'out.txt')) -StderrPath ([System.IO.Path]::Combine($dir, 'err.txt')) -TimeoutMilliseconds 2000 -KillGraceMilliseconds 5000 -PollMilliseconds 200
    $checks = New-Object System.Collections.ArrayList
    [void](Add-Check -List $checks -Id 's3.output.reviewable' -Ok $false -Detail 'timeout must never be reviewable')
    $record = New-StepRecord -Id 'selftest-s3' -Vector 'selftest:fixture-sleep' -State 'pending'
    $null = Set-StepGate -Record $record -ProcessResult $r -Checks @($checks) -DescendantsAliveAtVerdict @()
    $pidGone = ((Get-PidState -Id ([int]$r.pid)) -eq 'gone')
    $ok = ([bool]$r.timedOut -and (-not $record.completed) -and $pidGone)
    return New-SelfTestCaseResult -Id 'S3' -State $(if ($ok) { 'pass' } else { 'fail' }) -Detail ('timedOut=' + [string]$r.timedOut + ' completed=' + [string]$record.completed + ' pidGone=' + [string]$pidGone)
}

function Invoke-SelfTestS4 {
    param([Parameter(Mandatory)][string]$Root)
    $dir = New-TempDir -Root $Root -Name 's4'
    $missingExe = [System.IO.Path]::Combine($dir, 'missing-executable-that-does-not-exist.exe')
    $r = Invoke-CapturedProcess -Exe $missingExe -Arguments @('-e', 'process.exit(0)') -WorkingDirectory $Root -StdoutPath ([System.IO.Path]::Combine($dir, 'out.txt')) -StderrPath ([System.IO.Path]::Combine($dir, 'err.txt')) -TimeoutMilliseconds 15000
    $checks = New-Object System.Collections.ArrayList
    [void](Add-Check -List $checks -Id 's4.output.reviewable' -Ok $false -Detail 'spawn failure must never be reviewable')
    $record = New-StepRecord -Id 'selftest-s4' -Vector 'selftest:fixture-missing-exe' -State 'pending'
    $null = Set-StepGate -Record $record -ProcessResult $r -Checks @($checks) -DescendantsAliveAtVerdict @()
    $ok = ((-not [bool]$r.started) -and ([string]$r.spawnError -ne '') -and (-not $record.completed))
    return New-SelfTestCaseResult -Id 'S4' -State $(if ($ok) { 'pass' } else { 'fail' }) -Detail ('started=' + [string]$r.started + ' spawnErrorLength=' + [string]([string]$r.spawnError).Length)
}

function Invoke-SelfTestS5 {
    param([Parameter(Mandatory)][string]$NodeExe, [Parameter(Mandatory)][string]$Root)
    $dir = New-TempDir -Root $Root -Name 's5'
    # The parent still leaks a grandchild -- that is what S5 asserts -- but it now
    # waits one tick for the spawn result and records it in the case directory so
    # the failure can be classified instead of guessed at:
    #   spawned|<pid>            child exists and Node received a pid for it
    #   error|<code>|<message>   spawn failed, no child was created
    #   timeout|<pid>            neither event fired within 1500 ms (safety net)
    # The script text must stay free of spaces because arguments are joined with
    # single spaces for CreateProcess (see Invoke-CapturedProcess); '|' separates
    # report fields for the same reason. The report path is embedded as a
    # forward-slash literal instead of being read from process.argv, because -e
    # argument indexing differs between Node versions.
    # Handshake: the child writes child-ready.txt as the first statement of its
    # own -e script, so the parent only records 'spawned|<pid>' after the child's
    # code has provably started (polling, not a CPU busy-wait). The parent exits
    # only after that handshake, or it writes timeout|<pid> within bounded time.
    $reportDir = ($dir -replace '\\', '/')
    $reportPath = $reportDir + '/spawn-report.txt'
    $readyPath = $reportDir + '/child-ready.txt'
    $childErrPath = $reportDir + '/child-stderr.txt'
    $childLifePath = $reportDir + '/child-lifecycle.txt'
    $diagPath = [System.IO.Path]::Combine($dir, 's5-diagnostics.txt')
    $diagSink = New-Object System.Collections.ArrayList
    Add-S5DiagnosticEvent -Path $diagPath -Sink $diagSink -Source 's5' -Text ('phase=s5 event=start caseDir=' + ($dir -replace '\\', '/'))
    # Child lifecycle trace (bounded writes, epoch-ms timestamps). The child still
    # writes child-ready.txt first and still ends its event loop at ~8 s via the
    # empty 8000 ms timer, so the natural-exit timing is preserved. heartbeats
    # (hb|, every 500 ms) stop at 15 writes so they cannot extend that lifetime:
    # a truncated hb series with no exit line means the child was terminated
    # externally; crash| then exit code 97 means a JS exception; exit|0 on the
    # natural path. Child stderr goes to a file descriptor in the stdio array
    # (never a pipe back to this harness), so the child cannot hold the parent's
    # redirected streams open and the bounded drain semantics are unchanged.
    $childJs = 'require(`fs`).writeFileSync(`' + $readyPath + '`,`ready`);require(`fs`).appendFileSync(`' + $childLifePath + '`,`boot|`+Date.now()+String.fromCharCode(10));process.on(`uncaughtException`,e=>{try{require(`fs`).appendFileSync(`' + $childLifePath + '`,`crash|`+Date.now()+`|`+String(e&&e.stack||e).split(String.fromCharCode(13)).join(`~`).split(String.fromCharCode(10)).join(`~`)+String.fromCharCode(10))}catch(x){}process.exit(97)});process.on(`exit`,c=>{try{require(`fs`).appendFileSync(`' + $childLifePath + '`,`exit|`+Date.now()+`|`+c+String.fromCharCode(10))}catch(x){}});global.h=0;global.hb=setInterval(()=>{try{require(`fs`).appendFileSync(`' + $childLifePath + '`,`hb|`+Date.now()+String.fromCharCode(10))}catch(x){}global.h++;if(global.h>=15){clearInterval(global.hb)}},500);setTimeout(()=>{},8000)'
    # Request an independent Windows child process group when the Node parent exits
    # immediately after readiness; survival is not established until a runtime run.
    # windowsHide avoids a visible child console.
    # The stdio array, readiness handshake and immediate parent exit are unchanged.
    $js = 'global.f=''' + $reportPath + ''',global.rf=''' + $readyPath + ''',global.cp=require(''child_process''),global.fs=require(''fs''),global.ep=''' + $childErrPath + ''',global.ef=(function(){try{return(global.fs.openSync(global.ep,''a''))}catch(e){return''ignore''}})(),global.c=global.cp.spawn(process.execPath,[''-e'',''' + $childJs + '''],{stdio:[''ignore'',''ignore'',global.ef],detached:true,windowsHide:true});global.c.on(''spawn'',()=>{global.n=0;global.t=setInterval(()=>{global.n++;try{if(global.fs.readFileSync(global.rf,''utf8'')===''ready''){clearInterval(global.t);global.fs.writeFileSync(global.f,''spawned|''+global.c.pid);process.exit(0);}}catch(e){}if(global.n>=40){clearInterval(global.t);global.fs.writeFileSync(global.f,''timeout|''+global.c.pid);process.exit(0);}},25)});global.c.on(''error'',e=>{global.fs.writeFileSync(global.f,''error|''+e.code+''|''+e.message);process.exit(0)});setTimeout(()=>{clearInterval(global.t);global.fs.writeFileSync(global.f,''timeout|''+global.c.pid);process.exit(0)},1500)'
    $fixtureStartUtc = [DateTime]::UtcNow
    $r = Invoke-CapturedProcess -Exe $NodeExe -Arguments @('-e', $js) -WorkingDirectory $Root -StdoutPath ([System.IO.Path]::Combine($dir, 'out.txt')) -StderrPath ([System.IO.Path]::Combine($dir, 'err.txt')) -TimeoutMilliseconds 30000 -KillGraceMilliseconds 2000 -PollMilliseconds 200 -DiagnosticPath $diagPath -DiagnosticSink $diagSink
    $spawnReportPath = [System.IO.Path]::Combine($dir, 'spawn-report.txt')
    $spawnReport = 'missing'
    $spawnedPid = 0
    $spawnedPidValid = $false
    if (Test-Path -LiteralPath $spawnReportPath -PathType Leaf) {
        $spawnReport = (Read-TextFile -Path $spawnReportPath).Trim()
        $spawnReport = ($spawnReport -replace "`r", ' ' -replace "`n", ' ')
        if ($spawnReport -eq '') { $spawnReport = 'empty' }
        if ($spawnReport -match '^spawned\|([0-9]+)$') {
            $spawnedPid = [int]$matches[1]
            if ($spawnedPid -gt 0) {
                $spawnedPidValid = $true
            }
        }
    }
    $checks = New-Object System.Collections.ArrayList
    [void](Add-Check -List $checks -Id 's5.output.reviewable' -Ok $true -Detail 'parent exited cleanly but leaked a child')
    $record = New-StepRecord -Id 'selftest-s5' -Vector 'selftest:fixture-leak' -State 'pending'
    $candidatePids = @($r.descendantsAliveAfterGrace)
    if ($spawnedPidValid) {
        $candidatePids = @(@($candidatePids) + @($spawnedPid) | Sort-Object -Unique)
    }
    $survivors = @(Get-SurvivingPids -Candidate @($candidatePids))
    $null = Set-StepGate -Record $record -ProcessResult $r -Checks @($checks) -DescendantsAliveAtVerdict $survivors
    $spawnedAliveAfterParentExit = $false
    $spawnedPostExitQueryError = ''
    $spawnedPostExitSamples = 0
    $childIdentityProblems = New-Object System.Collections.ArrayList
    $childCreationUtc = $null
    $childExecutableName = ''
    $childExecutablePath = ''
    if ($spawnedPidValid -and [bool]$r.terminationConfirmed) {
        Add-S5DiagnosticEvent -Path $diagPath -Sink $diagSink -Source 's5' -Text ('phase=postExit event=start pid=' + [string]$spawnedPid + ' parentGoneAt=' + (Get-TraceUtc))
        $postExitWatch = [System.Diagnostics.Stopwatch]::StartNew()
        while ($postExitWatch.ElapsedMilliseconds -lt 1500) {
            $sampleState = 'gone'
            try {
                $childRows = @(Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId=' + $spawnedPid) -ErrorAction Stop)
                if ($childRows.Count -gt 1) {
                    $sampleState = 'ambiguous'
                    [void]$childIdentityProblems.Add('multiple CIM rows for spawned pid')
                }
                elseif ($childRows.Count -eq 1) {
                    $childRow = $childRows[0]
                    $sampleState = 'identityMismatch'
                    $born = $null
                    if ($null -ne $childRow.CreationDate) {
                        try { $born = ([DateTime]$childRow.CreationDate).ToUniversalTime() } catch { }
                    }
                    $exeName = [string]$childRow.Name
                    $exePath = [string]$childRow.ExecutablePath
                    $expectedName = [System.IO.Path]::GetFileName($NodeExe)
                    if ($null -eq $born) { [void]$childIdentityProblems.Add('CIM creation time unavailable') }
                    elseif ($born -lt $fixtureStartUtc) { [void]$childIdentityProblems.Add('CIM creation time precedes fixture start') }
                    elseif (($null -ne $childCreationUtc) -and ($born -ne $childCreationUtc)) { [void]$childIdentityProblems.Add('CIM creation time changed for spawned pid') }
                    elseif ([int]$childRow.ParentProcessId -ne [int]$r.pid) { [void]$childIdentityProblems.Add('CIM parent pid does not match captured parent') }
                    elseif ($exeName -ine $expectedName) { [void]$childIdentityProblems.Add('CIM executable name does not match Node') }
                    elseif (($exePath -ne '') -and ([System.IO.Path]::GetFullPath($exePath) -ine [System.IO.Path]::GetFullPath($NodeExe))) { [void]$childIdentityProblems.Add('CIM executable path does not match Node') }
                    elseif (($childExecutablePath -ne '') -and ($exePath -ne '') -and ($exePath -ine $childExecutablePath)) { [void]$childIdentityProblems.Add('CIM executable path changed for spawned pid') }
                    else {
                        $sampleState = Get-PidState -Id $spawnedPid
                        if ($sampleState -eq 'alive') {
                            $childCreationUtc = $born
                            $childExecutableName = $exeName
                            if ($exePath -ne '') { $childExecutablePath = $exePath }
                        }
                        elseif ($sampleState -eq 'unknown') { [void]$childIdentityProblems.Add('pid liveness query returned unknown') }
                        else { [void]$childIdentityProblems.Add('CIM reported child but pid liveness reported gone') }
                    }
                }
            }
            catch {
                $sampleState = 'queryerror'
                $queryError = [string]$_.Exception.Message
                if ($spawnedPostExitQueryError -eq '') { $spawnedPostExitQueryError = $queryError }
                [void]$childIdentityProblems.Add('post-exit CIM/identity query: ' + $queryError)
            }
            $spawnedPostExitSamples = $spawnedPostExitSamples + 1
            Add-S5DiagnosticEvent -Path $diagPath -Sink $diagSink -Source 's5' -RelMs $postExitWatch.ElapsedMilliseconds -Text ('phase=postExit event=sample pid=' + [string]$spawnedPid + ' state=' + $sampleState + ' parentPid=' + [string][int]$r.pid + ' createdUtc=' + $(if ($null -eq $childCreationUtc) { 'unavailable' } else { $childCreationUtc.ToString('o') }) + ' executable=' + $(if ($childExecutableName -eq '') { 'unavailable' } else { $childExecutableName }) + ' path=' + $(if ($childExecutablePath -eq '') { 'unavailable' } else { $childExecutablePath }))
            if ($sampleState -eq 'alive') {
                $spawnedAliveAfterParentExit = $true
                break
            }
            Start-Sleep -Milliseconds 200
        }
        Add-S5DiagnosticEvent -Path $diagPath -Sink $diagSink -Source 's5' -RelMs $postExitWatch.ElapsedMilliseconds -Text ('phase=postExit event=done pid=' + [string]$spawnedPid + ' samples=' + [string]$spawnedPostExitSamples + ' alive=' + [string]$spawnedAliveAfterParentExit + ' queryErrors=' + [string]@($childIdentityProblems | Where-Object { $_ -like '*query*' }).Count)
    }
    else {
        Add-S5DiagnosticEvent -Path $diagPath -Sink $diagSink -Source 's5' -Text ('phase=postExit event=skipped valid=' + [string]$spawnedPidValid + ' termConfirmed=' + [string][bool]$r.terminationConfirmed)
    }
    $descendantsIncludeSpawned = $false
    if ($spawnedPidValid) {
        foreach ($d in @($r.descendantsAliveAfterGrace)) {
            if ([int]$d -eq $spawnedPid) {
                $descendantsIncludeSpawned = $true
                break
            }
        }
    }
    # A different survivor cannot stand in for the reported child. Require the
    # direct parent's real exit and this CIM-discovered, creation-time-bound pid.
    $detected = ($spawnedPidValid -and [bool]$r.terminationConfirmed -and [bool]$r.exitCodeObserved -and ([int]$r.exitCode -eq 0) -and (-not [bool]$r.timedOut) -and ([string]$r.spawnError -eq '') -and ([string]$r.terminationError -eq '') -and ([int]$r.descendantQueryFailures -eq 0) -and $spawnedAliveAfterParentExit -and ($null -ne $childCreationUtc) -and (@($childIdentityProblems).Count -eq 0) -and $descendantsIncludeSpawned -and (@($survivors | Where-Object { [int]$_ -eq $spawnedPid }).Count -gt 0) -and (-not $record.completed))
    # let the fixture child exit on its own; never kill it
    $drainTargets = @($survivors)
    if ($spawnedPidValid) {
        $drainTargets = @(@($drainTargets) + @($spawnedPid) | Sort-Object -Unique)
    }
    $drained = @(Wait-ForPidsGone -Ids @($drainTargets) -TimeoutMilliseconds 20000 -PollMilliseconds 500)
    Add-S5DiagnosticEvent -Path $diagPath -Sink $diagSink -Source 's5' -Text ('phase=drain20 event=done gone=' + [string](@($drained).Count) + ' pids=' + (ConvertTo-PidSetText -Ids @($drained)))
    # The reported child must be gone after the bounded drain. A pid reused by
    # another process, an unknown state or an unanswerable CIM query is not proof
    # that the child completed normally; no fixture child is ever killed here.
    $childGone = $false
    if ($spawnedPidValid -and ($null -ne $childCreationUtc)) {
        try {
            $finalRows = @(Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId=' + $spawnedPid) -ErrorAction Stop)
            $finalState = Get-PidState -Id $spawnedPid
            if (($finalRows.Count -eq 0) -and ($finalState -eq 'gone')) {
                $childGone = $true
            }
            elseif ($finalRows.Count -eq 1) {
                $finalBorn = $null
                if ($null -ne $finalRows[0].CreationDate) {
                    try { $finalBorn = ([DateTime]$finalRows[0].CreationDate).ToUniversalTime() } catch { }
                }
                if ($null -eq $finalBorn) { [void]$childIdentityProblems.Add('final CIM creation time unavailable') }
                elseif ($finalBorn -ne $childCreationUtc) { [void]$childIdentityProblems.Add('spawned pid was reused before final observation') }
                else { [void]$childIdentityProblems.Add('specific child still exists after bounded drain') }
            }
            else { [void]$childIdentityProblems.Add('final CIM/pid state ambiguous: rows=' + $finalRows.Count + ' state=' + $finalState) }
            Add-S5DiagnosticEvent -Path $diagPath -Sink $diagSink -Source 's5' -Text ('phase=childFinal pid=' + [string]$spawnedPid + ' createdUtc=' + $childCreationUtc.ToString('o') + ' rows=' + $finalRows.Count + ' state=' + $finalState + ' gone=' + [string]$childGone)
        }
        catch {
            $queryError = [string]$_.Exception.Message
            if ($spawnedPostExitQueryError -eq '') { $spawnedPostExitQueryError = $queryError }
            [void]$childIdentityProblems.Add('final CIM/identity query: ' + $queryError)
            Add-S5DiagnosticEvent -Path $diagPath -Sink $diagSink -Source 's5' -Text ('phase=childFinal event=queryerror pid=' + [string]$spawnedPid + ' msg=' + ($queryError -replace '\s+', '_'))
        }
    }
    # The child's own lifecycle is a separate, mandatory natural-exit proof.
    # Boot-to-exit 7500..10000 ms allows 500 ms early timestamp jitter and up
    # to 2000 ms Windows scheduling delay around the intended 8000 ms timer.
    # This does not extend any process or drain timeout.
    $childExitRecorded = 'missing'
    $childExitCodeText = ''
    $childCrashRecorded = 'missing'
    $childHbCount = -1
    $childErrBytes = -1
    $bootMs = -1L; $exitMs = -1L; $lastEventMs = -1L
    $childLifeProblems = New-Object System.Collections.ArrayList
    $childLifePathPs = [System.IO.Path]::Combine($dir, 'child-lifecycle.txt')
    $childErrPathPs = [System.IO.Path]::Combine($dir, 'child-stderr.txt')
    if (Test-Path -LiteralPath $childLifePathPs -PathType Leaf) {
        $childExitRecorded = 'False'
        $childCrashRecorded = 'False'
        $childHbCount = 0
        $lifeLines = @()
        try { $lifeLines = @((Read-TextFile -Path $childLifePathPs) -split "`n") }
        catch { [void]$childLifeProblems.Add('lifecycle read failed: ' + [string]$_.Exception.Message) }
        for ($i = 0; $i -lt $lifeLines.Count; $i++) {
            $lineText = ([string]$lifeLines[$i]).TrimEnd([char]13)
            if (($i -eq ($lifeLines.Count - 1)) -and ($lineText -eq '')) { continue }
            if ($lineText -match '^boot\|([0-9]{13})$') {
                $stamp = [long]$matches[1]
                if (($i -ne 0) -or ($bootMs -ge 0)) { [void]$childLifeProblems.Add('boot not first or repeated') }
                else { $bootMs = $stamp; $lastEventMs = $stamp }
            }
            elseif ($lineText -match '^hb\|([0-9]{13})$') {
                $stamp = [long]$matches[1]
                $childHbCount++
                if (($bootMs -lt 0) -or ($exitMs -ge 0) -or ($stamp -le $lastEventMs)) { [void]$childLifeProblems.Add('heartbeat out of order or outside lifetime') }
                $lastEventMs = $stamp
            }
            elseif ($lineText -match '^exit\|([0-9]{13})\|([0-9]+)$') {
                $stamp = [long]$matches[1]
                if (($bootMs -lt 0) -or ($exitMs -ge 0) -or ($stamp -le $lastEventMs) -or ($i -ne ($lifeLines.Count - 2))) { [void]$childLifeProblems.Add('exit out of order, repeated or not final') }
                $childExitRecorded = 'True'
                $childExitCodeText = $matches[2]
                $exitMs = $stamp
                $lastEventMs = $stamp
            }
            elseif ($lineText -match '^crash\|') {
                $childCrashRecorded = 'True'
                [void]$childLifeProblems.Add('child recorded crash')
            }
            else { [void]$childLifeProblems.Add('malformed or unexpected lifecycle record at line ' + ($i + 1)) }
        }
        if ($bootMs -lt 0) { [void]$childLifeProblems.Add('boot missing') }
        if (($childHbCount -lt 1) -or ($childHbCount -gt 15)) { [void]$childLifeProblems.Add('heartbeat count outside 1..15') }
        if (($exitMs -lt 0) -or ($childExitCodeText -ne '0')) { [void]$childLifeProblems.Add('natural exit code 0 missing') }
        if (($bootMs -ge 0) -and ($exitMs -ge 0) -and ((($exitMs - $bootMs) -lt 7500) -or (($exitMs - $bootMs) -gt 10000))) { [void]$childLifeProblems.Add('boot-to-exit lifetime outside 7500..10000 ms') }
    }
    else { [void]$childLifeProblems.Add('lifecycle file missing') }
    if (Test-Path -LiteralPath $childErrPathPs -PathType Leaf) {
        try { $childErrBytes = [int](Get-Item -LiteralPath $childErrPathPs).Length } catch { [void]$childLifeProblems.Add('child stderr unreadable') }
    }
    if ($childErrBytes -ne 0) { [void]$childLifeProblems.Add('child stderr missing or nonempty') }
    try { if ((Read-TextFile -Path $readyPath) -ne 'ready') { [void]$childLifeProblems.Add('child readiness contents invalid') } }
    catch { [void]$childLifeProblems.Add('child readiness file missing or unreadable') }
    Add-S5DiagnosticEvent -Path $diagPath -Sink $diagSink -Source 's5' -Text ('phase=childLifecycle event=summary exit=' + $childExitRecorded + ' exitCode=' + $childExitCodeText + ' crash=' + $childCrashRecorded + ' hbCount=' + [string]$childHbCount + ' stderrBytes=' + [string]$childErrBytes + ' lifetimeMs=' + $(if (($bootMs -ge 0) -and ($exitMs -ge 0)) { [string]($exitMs - $bootMs) } else { 'unavailable' }) + ' problems=' + [string]@($childLifeProblems).Count)
    $ok = ($detected -and $childGone -and (@($drained).Count -eq 0) -and (@($childIdentityProblems).Count -eq 0) -and (@($childLifeProblems).Count -eq 0))
    $s5Problems = New-Object System.Collections.ArrayList
    if (-not $spawnedPidValid) { [void]$s5Problems.Add('spawnReportInvalid=' + $spawnReport) }
    if ($spawnedPidValid -and [bool]$r.terminationConfirmed -and (-not $spawnedAliveAfterParentExit)) { [void]$s5Problems.Add('spawnedPidNotAliveAfterParentExit=' + [string]$spawnedPid) }
    if ($spawnedPidValid -and (-not $descendantsIncludeSpawned) -and (@($r.descendantsAliveAfterGrace | Where-Object { [int]$_ -eq $spawnedPid }).Count -eq 0)) { [void]$s5Problems.Add('spawnedPidNotInDescendants=' + [string]$spawnedPid) }
    if ($spawnedPostExitQueryError -ne '') { [void]$s5Problems.Add('spawnedPidQueryError=' + $spawnedPostExitQueryError) }
    if ($spawnedPidValid -and (-not $childGone)) { [void]$s5Problems.Add('specific child natural disappearance not verified') }
    foreach ($identityProblem in @($childIdentityProblems)) { [void]$s5Problems.Add('childIdentity=' + [string]$identityProblem) }
    foreach ($lifeProblem in @($childLifeProblems)) { [void]$s5Problems.Add('childLifecycle=' + [string]$lifeProblem) }
    if ([string]$r.spawnError -ne '') { [void]$s5Problems.Add('spawn=' + [string]$r.spawnError) }
    if ([string]$r.terminationError -ne '') { [void]$s5Problems.Add('term=' + [string]$r.terminationError) }
    if ([int]$r.descendantQueryFailures -gt 0) { [void]$s5Problems.Add('childQueryErrors=' + [string][int]$r.descendantQueryFailures) }
    # Diagnostic fields for the case-detail line: the CIM-discovered identities
    # (recorded separately from the spawn-report pid) and each observed pid's
    # state at the grace boundary, both lifted from the in-memory trace sink.
    $observedPidList = New-Object System.Collections.ArrayList
    foreach ($sinkLine in @($diagSink)) {
        if ([string]$sinkLine -match 'event=firstseen pid=([0-9]+)$') {
            if (-not $observedPidList.Contains($matches[1])) { [void]$observedPidList.Add($matches[1]) }
        }
    }
    $observedPidsText = 'none'
    if (@($observedPidList).Count -gt 0) { $observedPidsText = (@($observedPidList) -join '|') }
    $spawnedInObserved = $false
    if ($spawnedPidValid) {
        foreach ($op in @($observedPidList)) {
            if ([int]$op -eq $spawnedPid) { $spawnedInObserved = $true; break }
        }
    }
    Add-S5DiagnosticEvent -Path $diagPath -Sink $diagSink -Source 's5' -Text ('phase=s5 event=spawnedVsObserved spawnedPid=' + [string]$spawnedPid + ' inObserved=' + [string]$spawnedInObserved + ' observedPids=' + $observedPidsText)
    $graceStateList = New-Object System.Collections.ArrayList
    foreach ($sinkLine in @($diagSink)) {
        if ([string]$sinkLine -match 'event=state pid=([0-9]+) state=([a-z]+)$') {
            [void]$graceStateList.Add($matches[1] + ':' + $matches[2])
        }
    }
    $graceStatesText = 'none'
    if (@($graceStateList).Count -gt 0) { $graceStatesText = (@($graceStateList) -join '|') }
    $s5ProblemText = '<none>'
    if (@($s5Problems).Count -gt 0) { $s5ProblemText = ((@($s5Problems)) -join '; ') -replace "`r", ' ' -replace "`n", ' ' }
    return New-SelfTestCaseResult -Id 'S5' -State $(if ($ok) { 'pass' } else { 'fail' }) -Detail ('spawnedPid=' + [string]$spawnedPid + ' spawnedAliveAfterParentExit=' + [string]$spawnedAliveAfterParentExit + ' inDescendants=' + [string]$descendantsIncludeSpawned + ' aliveAfterGrace=' + [string](@($r.descendantsAliveAfterGrace).Count) + ' survivors=' + [string](@($survivors).Count) + ' observed=' + [string][int]$r.descendantsSpawnedObserved + ' staleLinks=' + [string][int]$r.descendantStaleLinksRejected + ' completed=' + [string]$record.completed + ' drained=' + [string](@($drained).Count) + ' pid=' + [string][int]$r.pid + ' termConfirmed=' + [string][bool]$r.terminationConfirmed + ' spawnReport=' + $spawnReport + ' procError=' + $s5ProblemText + ' observedPids=' + $observedPidsText + ' graceStates=' + $graceStatesText + ' childExit=' + $childExitRecorded + ' childExitCode=' + $childExitCodeText + ' childCrash=' + $childCrashRecorded + ' childHb=' + [string]$childHbCount + ' childStderrBytes=' + [string]$childErrBytes + ' diag=' + ($diagPath -replace '\\', '/'))
}

# ---------------------------------------------------------------------------
# Abort policy (one implementation, used by the entry handler and self-test)
# ---------------------------------------------------------------------------
function Set-AbortState {
    param(
        [Parameter(Mandatory)][string]$Dir,
        [AllowEmptyString()][string]$RunIdValue = '',
        [AllowEmptyString()][string]$Reason = ''
    )
    $manifestPath = [System.IO.Path]::Combine($Dir, 'manifest.json')
    if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
        $lines = @(
            'ABORTED DURING CAPTURE'
            ('reason=' + [string]$Reason)
            'IGNORE ANY manifest.json IN THIS DIRECTORY.'
            ('runId=' + [string]$RunIdValue)
            ('utc=' + (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))
        )
        Write-TextFile -Path ([System.IO.Path]::Combine($Dir, '00-CONTRADICTION.txt')) -Text (((@($lines)) -join "`n") + "`n")
        Set-RunStateFile -Path ([System.IO.Path]::Combine($Dir, '00-run-state.txt')) -RunIdValue $RunIdValue -Phase 'invalid'
        return $script:ExitPublication
    }
    Set-RunStateFile -Path ([System.IO.Path]::Combine($Dir, '00-run-state.txt')) -RunIdValue $RunIdValue -Phase 'failed'
    return $script:ExitFail
}

function New-SelfTestPreconditions {
    param(
        [Parameter(Mandatory)][string]$RepoFull,
        [Parameter(Mandatory)][string]$EvidenceDir
    )
    $head = ''
    $headResult = Get-GitText -GitWorkingDirectory $RepoFull -GitArgs @('rev-parse', 'HEAD')
    if ($headResult.ok -and (@($headResult.lines).Count -ge 1)) {
        $head = ([string](@($headResult.lines)[0])).Trim()
    }
    return Get-Preconditions -RepoRootPath $RepoFull -EvidenceRootPath $EvidenceDir -ExpectedHeadValue $head -Acknowledged $true -ApprovalReference 'selftest-approval-reference' -SelfTestMode $true
}

# ---------------------------------------------------------------------------
# Self-test S6: TAP summary validation
# ---------------------------------------------------------------------------
function Invoke-SelfTestS6 {
    param([Parameter(Mandatory)][string]$Root)
    $dir = New-TempDir -Root $Root -Name 's6'
    $nl = "`n"
    $problems = New-Object System.Collections.ArrayList

    $good = @(
        'TAP version 13'
        'ok 1 - alpha'
        'ok 2 - beta'
        'ok 3 - gamma'
        '# tests 3'
        '# suites 0'
        '# pass 3'
        '# fail 0'
        '# cancelled 0'
        '# skipped 0'
        '# todo 0'
        '# duration_ms 12.5'
    ) -join $nl
    $pathA = [System.IO.Path]::Combine($dir, 's6a.tap')
    Write-TextFile -Path $pathA -Text ($good + $nl)
    $repA = Get-TapReport -Path $pathA -ExpectedTests 3
    if (-not (($repA.numberingOk) -and (@($repA.issues).Count -eq 0))) {
        [void]$problems.Add('S6a: ' + (@($repA.issues) -join '; '))
    }

    $gap = @(
        'TAP version 13'
        'ok 1 - alpha'
        'ok 2 - beta'
        'ok 4 - gamma'
        '# tests 3'
        '# pass 3'
        '# fail 0'
        '# cancelled 0'
        '# skipped 0'
        '# todo 0'
        '# duration_ms 12.5'
    ) -join $nl
    $pathB = [System.IO.Path]::Combine($dir, 's6b.tap')
    Write-TextFile -Path $pathB -Text ($gap + $nl)
    $repB = Get-TapReport -Path $pathB -ExpectedTests 3
    if ([bool]$repB.numberingOk) { [void]$problems.Add('S6b: numbering gap was accepted') }

    $dup = @(
        'TAP version 13'
        'ok 1 - alpha'
        'ok 1 - beta'
        'ok 2 - gamma'
        '# tests 3'
        '# pass 3'
        '# fail 0'
        '# cancelled 0'
        '# skipped 0'
        '# todo 0'
        '# duration_ms 12.5'
    ) -join $nl
    $pathC = [System.IO.Path]::Combine($dir, 's6c.tap')
    Write-TextFile -Path $pathC -Text ($dup + $nl)
    $repC = Get-TapReport -Path $pathC -ExpectedTests 3
    if ([bool]$repC.numberingOk) { [void]$problems.Add('S6c: duplicate numbering was accepted') }

    $bad = @(
        'TAP version 13'
        'ok 1 - alpha'
        'not ok 2 - beta'
        'ok 3 - gamma'
        '# tests 3'
        '# pass 2'
        '# fail 1'
        '# cancelled 0'
        '# skipped 0'
        '# todo 0'
        '# duration_ms 12.5'
    ) -join $nl
    $pathD = [System.IO.Path]::Combine($dir, 's6d.tap')
    Write-TextFile -Path $pathD -Text ($bad + $nl)
    $repD = Get-TapReport -Path $pathD -ExpectedTests 3
    if (@($repD.issues | Where-Object { [string]$_ -like '*not ok lines present*' }).Count -eq 0) {
        [void]$problems.Add('S6d: not ok line was not rejected')
    }

    $short = @(
        'TAP version 13'
        'ok 1 - alpha'
        'ok 2 - beta'
        'ok 3 - gamma'
        '# tests 3'
        '# pass 3'
        '# fail 0'
        '# cancelled 0'
        '# skipped 0'
        '# duration_ms 12.5'
    ) -join $nl
    $pathE = [System.IO.Path]::Combine($dir, 's6e.tap')
    Write-TextFile -Path $pathE -Text ($short + $nl)
    $repE = Get-TapReport -Path $pathE -ExpectedTests 3
    if (@($repE.issues | Where-Object { [string]$_ -like 'missing summary line: todo' }).Count -eq 0) {
        [void]$problems.Add('S6e: missing todo counter was accepted')
    }

    if (@($problems).Count -eq 0) {
        return New-SelfTestCaseResult -Id 'S6' -State 'pass' -Detail 'S6a..S6e: 5 TAP vectors behaved correctly'
    }
    return New-SelfTestCaseResult -Id 'S6' -State 'fail' -Detail ((@($problems)) -join ' | ')
}

# ---------------------------------------------------------------------------
# Self-test S7: stderr policy is independent of exit code
# ---------------------------------------------------------------------------
function Invoke-SelfTestS7 {
    param([Parameter(Mandatory)][string]$NodeExe, [Parameter(Mandatory)][string]$Root)
    $dir = New-TempDir -Root $Root -Name 's7'
    $js = 'console.error(String.fromCharCode(98,111,111,109));process.exit(0)'
    $stderrPath = [System.IO.Path]::Combine($dir, 'err.txt')
    $r = Invoke-CapturedProcess -Exe $NodeExe -Arguments @('-e', $js) -WorkingDirectory $Root -StdoutPath ([System.IO.Path]::Combine($dir, 'out.txt')) -StderrPath $stderrPath -TimeoutMilliseconds 60000
    $checks = @(Get-StderrChecks -Variant 's7' -StderrPath $stderrPath)
    $record = New-StepRecord -Id 'selftest-s7' -Vector 'selftest:fixture-stderr' -State 'pending'
    $null = Set-StepGate -Record $record -ProcessResult $r -Checks $checks -DescendantsAliveAtVerdict @()
    $emptyCheck = @($checks | Where-Object { [string]$_.id -eq 's7.stderr.empty' })
    $emptyRejected = ((@($emptyCheck).Count -eq 1) -and (-not [bool](@($emptyCheck)[0].ok)))
    $ok = (([int]$r.exitCode -eq 0) -and $emptyRejected -and (-not $record.completed))
    return New-SelfTestCaseResult -Id 'S7' -State $(if ($ok) { 'pass' } else { 'fail' }) -Detail ('exit=' + [string]$r.exitCode + ' stderrBytes=' + [string]$r.stderrBytes + ' stderrRejected=' + [string]$emptyRejected + ' completed=' + [string]$record.completed)
}

# ---------------------------------------------------------------------------
# Self-test S8: interrupted runs never publish
# ---------------------------------------------------------------------------
function Get-BundleSnapshot {
    param([Parameter(Mandatory)][string]$Bundle)
    $manifestPath = [System.IO.Path]::Combine($Bundle, 'manifest.json')
    $statePath = [System.IO.Path]::Combine($Bundle, '00-run-state.txt')
    $phase = ''
    if (Test-Path -LiteralPath $statePath -PathType Leaf) { $phase = Get-RunStatePhase -Path $statePath }
    $publishable = Test-BundlePublishable -Dir $Bundle
    return [pscustomobject]@{
        hasManifest = (Test-Path -LiteralPath $manifestPath -PathType Leaf)
        phase = [string]$phase
        publishable = [bool]$publishable.publishable
        reasons = @($publishable.reasons)
        fileCount = @(Get-ChildItem -LiteralPath $Bundle -Force).Count
    }
}

function Invoke-SelfTestS8a {
    param([Parameter(Mandatory)][string]$RepoFull, [Parameter(Mandatory)][string]$Root)
    $dir = New-TempDir -Root $Root -Name 's8a'
    $pre = New-SelfTestPreconditions -RepoFull $RepoFull -EvidenceDir $dir
    $threw = $false
    try {
        $null = Invoke-Capture -Pre $pre -SelfTestMode $true -FaultAt 'after-dir' -UseFakeSteps $true
    }
    catch {
        $threw = $true
    }
    $snap = Get-BundleSnapshot -Bundle ([string]$script:LastBundle)
    $ok = ($threw -and (-not $snap.hasManifest) -and ($snap.phase -eq 'running') -and (-not $snap.publishable))
    return New-SelfTestCaseResult -Id 'S8a' -State $(if ($ok) { 'pass' } else { 'fail' }) -Detail ('threw=' + [string]$threw + ' manifest=' + [string]$snap.hasManifest + ' phase=' + [string]$snap.phase + ' publishable=' + [string]$snap.publishable)
}

function Invoke-SelfTestS8b {
    param([Parameter(Mandatory)][string]$RepoFull, [Parameter(Mandatory)][string]$Root)
    $dir = New-TempDir -Root $Root -Name 's8b'
    $pre = New-SelfTestPreconditions -RepoFull $RepoFull -EvidenceDir $dir
    $threw = $false
    try {
        $null = Invoke-Capture -Pre $pre -SelfTestMode $true -FaultAt 'before-manifest' -UseFakeSteps $true
    }
    catch {
        $threw = $true
    }
    $snap = Get-BundleSnapshot -Bundle ([string]$script:LastBundle)
    $stepArtifacts = @(Get-ChildItem -LiteralPath ([string]$script:LastBundle) -Filter '*.meta.json' -Force)
    $ok = ($threw -and (-not $snap.hasManifest) -and ($snap.phase -eq 'running') -and (-not $snap.publishable) -and (@($stepArtifacts).Count -eq 3))
    return New-SelfTestCaseResult -Id 'S8b' -State $(if ($ok) { 'pass' } else { 'fail' }) -Detail ('threw=' + [string]$threw + ' manifest=' + [string]$snap.hasManifest + ' phase=' + [string]$snap.phase + ' stepArtifacts=' + [string](@($stepArtifacts).Count))
}

function Invoke-SelfTestS8c {
    param([Parameter(Mandatory)][string]$RepoFull, [Parameter(Mandatory)][string]$Root)
    $dir = New-TempDir -Root $Root -Name 's8c'
    $pre = New-SelfTestPreconditions -RepoFull $RepoFull -EvidenceDir $dir
    $threw = $false
    try {
        $null = Invoke-Capture -Pre $pre -SelfTestMode $true -FaultAt 'after-publish' -UseFakeSteps $true
    }
    catch {
        $threw = $true
    }
    $bundle = [string]$script:LastBundle
    $beforeAbort = Get-BundleSnapshot -Bundle $bundle
    $abortExit = Set-AbortState -Dir $bundle -RunIdValue ([string]$script:RunId) -Reason 'injected fault after publication'
    $afterAbort = Get-BundleSnapshot -Bundle $bundle
    $contradiction = Test-Path -LiteralPath ([System.IO.Path]::Combine($bundle, '00-CONTRADICTION.txt')) -PathType Leaf
    $ok = (
        $threw -and
        $beforeAbort.hasManifest -and
        $beforeAbort.publishable -and
        ($afterAbort.phase -eq 'invalid') -and
        (-not $afterAbort.publishable) -and
        $contradiction -and
        ($abortExit -eq $script:ExitPublication)
    )
    return New-SelfTestCaseResult -Id 'S8c' -State $(if ($ok) { 'pass' } else { 'fail' }) -Detail ('threw=' + [string]$threw + ' manifestBefore=' + [string]$beforeAbort.hasManifest + ' publishableBefore=' + [string]$beforeAbort.publishable + ' phaseAfter=' + [string]$afterAbort.phase + ' publishableAfter=' + [string]$afterAbort.publishable + ' contradiction=' + [string]$contradiction + ' exit=' + [string]$abortExit)
}

# ---------------------------------------------------------------------------
# Self-test S9: existing bundle is refused, never overwritten
# ---------------------------------------------------------------------------
function Invoke-SelfTestS9 {
    param([Parameter(Mandatory)][string]$RepoFull, [Parameter(Mandatory)][string]$Root)
    $dir = New-TempDir -Root $Root -Name 's9'
    $runId = 'offline-selftest-conflict-00000000'
    $victim = [System.IO.Path]::Combine($dir, $runId)
    $null = New-Item -ItemType Directory -Path $victim -ErrorAction Stop
    $sentinel = [System.IO.Path]::Combine($victim, 'keep.txt')
    Write-TextFile -Path $sentinel -Text 'sentinel content that must survive'
    $beforeSha = [string](Get-FileFingerprint -Path $sentinel).sha256
    $pre = New-SelfTestPreconditions -RepoFull $RepoFull -EvidenceDir $dir
    $exitCode = [int](Invoke-Capture -Pre $pre -SelfTestMode $true -RunIdOverrideValue $runId -UseFakeSteps $true)
    $afterSha = [string](Get-FileFingerprint -Path $sentinel).sha256
    $entries = @(Get-ChildItem -LiteralPath $victim -Force)
    $ok = (($exitCode -eq $script:ExitRefused) -and ($beforeSha -eq $afterSha) -and (@($entries).Count -eq 1) -and ($beforeSha -ne ''))
    return New-SelfTestCaseResult -Id 'S9' -State $(if ($ok) { 'pass' } else { 'fail' }) -Detail ('exit=' + [string]$exitCode + ' shaSame=' + [string]($beforeSha -eq $afterSha) + ' entries=' + [string](@($entries).Count))
}

# ---------------------------------------------------------------------------
# Self-test S10: complete fake-steps capture publishes a verifiable PASS
# ---------------------------------------------------------------------------
function Invoke-SelfTestS10 {
    param([Parameter(Mandatory)][string]$RepoFull, [Parameter(Mandatory)][string]$Root)
    $dir = New-TempDir -Root $Root -Name 's10'
    $pre = New-SelfTestPreconditions -RepoFull $RepoFull -EvidenceDir $dir
    $exitCode = [int](Invoke-Capture -Pre $pre -SelfTestMode $true -UseFakeSteps $true)
    $bundle = [string]$script:LastBundle
    $publishable = Test-BundlePublishable -Dir $bundle
    $sumsPath = [System.IO.Path]::Combine($bundle, 'SHA256SUMS.txt')
    $lineCount = 0
    $sumsOk = $false
    if (Test-Path -LiteralPath $sumsPath -PathType Leaf) {
        $sumsOk = $true
        foreach ($line in @(Get-Content -LiteralPath $sumsPath)) {
            $t = ([string]$line).Trim()
            if ($t.Length -eq 0) { continue }
            $lineCount = $lineCount + 1
            $m = [regex]::Match($t, '^([0-9a-f]{64})  (.+)$')
            if (-not $m.Success) { $sumsOk = $false; continue }
            $fp = Get-FileFingerprint -Path ([System.IO.Path]::Combine($bundle, ([string]$m.Groups[2].Value).Replace('/', '\')))
            if (-not [string]::Equals([string]$fp.sha256, [string]$m.Groups[1].Value, [System.StringComparison]::OrdinalIgnoreCase)) { $sumsOk = $false }
        }
    }
    $stepsRecorded = -1
    $manifestPath = [System.IO.Path]::Combine($bundle, 'manifest.json')
    if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
        try {
            $parsed = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
            $stepsRecorded = @($parsed.steps).Count
        }
        catch {
            $stepsRecorded = -2
        }
    }
    $ok = (($exitCode -eq $script:ExitPass) -and [bool]$publishable.publishable -and $sumsOk -and ($lineCount -gt 0) -and ($stepsRecorded -eq 3))
    return New-SelfTestCaseResult -Id 'S10' -State $(if ($ok) { 'pass' } else { 'fail' }) -Detail ('exit=' + [string]$exitCode + ' publishable=' + [string]$publishable.publishable + ' sumsOk=' + [string]$sumsOk + ' sumsLines=' + [string]$lineCount + ' manifestSteps=' + [string]$stepsRecorded + ' publishReasons=' + ((@($publishable.reasons)) -join '; '))
}

# ---------------------------------------------------------------------------
# Self-test S11: environment variable values can never authorize a run
# ---------------------------------------------------------------------------
function Invoke-SelfTestS11 {
    param([Parameter(Mandatory)][string]$RepoFull, [Parameter(Mandatory)][string]$Root)
    $dir = New-TempDir -Root $Root -Name 's11'
    $name = 'SLMM_LIVE_TESTS'
    $processScope = [System.EnvironmentVariableTarget]::Process
    $namesBefore = @([System.Environment]::GetEnvironmentVariables($processScope).Keys)
    if ($namesBefore -contains $name) {
        return New-SelfTestCaseResult -Id 'S11' -State 'unrunnable' -Detail 'process already defines SLMM_LIVE_TESTS; refusing to clobber it'
    }
    $preClean = New-SelfTestPreconditions -RepoFull $RepoFull -EvidenceDir $dir
    $cleanBlocked = @($preClean.blockedEnv)
    $detected = $false
    $authStillFails = $false
    [System.Environment]::SetEnvironmentVariable($name, 'placeholder-value', $processScope)
    try {
        $preDirty = New-SelfTestPreconditions -RepoFull $RepoFull -EvidenceDir $dir
        $detected = (@($preDirty.blockedEnv) -contains $name)
        $preNoAuth = Get-Preconditions -RepoRootPath $RepoFull -EvidenceRootPath $dir -ExpectedHeadValue ([string]$preDirty.head) -Acknowledged $false -ApprovalReference '' -SelfTestMode $false
        $authCheck = @($preNoAuth.checks | Where-Object { [string]$_.id -eq 'auth.approvalReference' })
        if ((@($authCheck).Count -eq 1) -and (-not [bool](@($authCheck)[0].ok))) { $authStillFails = $true }
    }
    finally {
        [System.Environment]::SetEnvironmentVariable($name, $null, $processScope)
    }
    $cleared = -not (@([System.Environment]::GetEnvironmentVariables($processScope).Keys) -contains $name)
    $ok = ($detected -and $authStillFails -and $cleared -and (-not ($cleanBlocked -contains $name)))
    return New-SelfTestCaseResult -Id 'S11' -State $(if ($ok) { 'pass' } else { 'fail' }) -Detail ('blockerDetected=' + [string]$detected + ' authStillFails=' + [string]$authStillFails + ' nameCleared=' + [string]$cleared)
}

# ---------------------------------------------------------------------------
# Self-test S12: verdict vectors
# ---------------------------------------------------------------------------
function Test-VerdictVector {
    param(
        [Parameter(Mandatory)][string]$Name,
        [AllowEmptyCollection()][object[]]$Steps = @(),
        [Parameter(Mandatory)]$Pre,
        [Parameter(Mandatory)]$Inventory,
        [Parameter(Mandatory)]$Sums,
        [AllowEmptyCollection()][string[]]$PostProblems = @(),
        [Parameter(Mandatory)][string]$Expected
    )
    $script:StepRecords = New-Object System.Collections.ArrayList
    foreach ($s in $Steps) { [void]$script:StepRecords.Add($s) }
    $verdict = Get-FinalVerdict -Preconditions $Pre -Inventory $Inventory -Sums $Sums -PostProblems $PostProblems
    return [pscustomobject]@{
        name = [string]$Name
        expected = [string]$Expected
        actual = [string]$verdict.result
        failed = @($verdict.failedConditions)
    }
}

function Invoke-SelfTestS12 {
    param([Parameter(Mandatory)][string]$Root)
    $preOk = [pscustomobject]@{ failed = @(); ok = $true }
    $preBad = [pscustomobject]@{ failed = @('git.head.matchesExpected'); ok = $false }
    $invOk = [pscustomobject]@{ missing = @(); unexpected = @(); unhashable = @(); ok = $true }
    $invBad = [pscustomobject]@{ missing = @('plan.txt'); unexpected = @(); unhashable = @(); ok = $false }
    $sumsOk = [pscustomobject]@{ ok = $true }
    $sumsBad = [pscustomobject]@{ ok = $false }

    $allGood = @(
        (New-FakeStepRecord -Id 'a'),
        (New-FakeStepRecord -Id 'b'),
        (New-FakeStepRecord -Id 'c')
    )
    $vectors = New-Object System.Collections.ArrayList
    [void]$vectors.Add((Test-VerdictVector -Name 'all-good' -Steps $allGood -Pre $preOk -Inventory $invOk -Sums $sumsOk -Expected 'PASS'))
    [void]$vectors.Add((Test-VerdictVector -Name 'zero-records' -Steps @() -Pre $preOk -Inventory $invOk -Sums $sumsOk -Expected 'FAIL'))
    [void]$vectors.Add((Test-VerdictVector -Name 'one-notRun' -Steps @((New-FakeStepRecord -Id 'a'), (New-FakeStepRecord -Id 'b' -StateValue 'notRun'), (New-FakeStepRecord -Id 'c')) -Pre $preOk -Inventory $invOk -Sums $sumsOk -Expected 'FAIL'))
    [void]$vectors.Add((Test-VerdictVector -Name 'exit-nonzero' -Steps @((New-FakeStepRecord -Id 'a'), (New-FakeStepRecord -Id 'b' -ExitCodeValue 3 -StateValue 'failed'), (New-FakeStepRecord -Id 'c')) -Pre $preOk -Inventory $invOk -Sums $sumsOk -Expected 'FAIL'))
    [void]$vectors.Add((Test-VerdictVector -Name 'exit-unobserved' -Steps @((New-FakeStepRecord -Id 'a'), (New-FakeStepRecord -Id 'b' -ExitObserved $false -StateValue 'failed'), (New-FakeStepRecord -Id 'c')) -Pre $preOk -Inventory $invOk -Sums $sumsOk -Expected 'FAIL'))
    [void]$vectors.Add((Test-VerdictVector -Name 'zero-checks' -Steps @((New-FakeStepRecord -Id 'a'), (New-FakeStepRecord -Id 'b' -CheckCount 0 -StateValue 'failed'), (New-FakeStepRecord -Id 'c')) -Pre $preOk -Inventory $invOk -Sums $sumsOk -Expected 'FAIL'))
    [void]$vectors.Add((Test-VerdictVector -Name 'failed-check' -Steps @((New-FakeStepRecord -Id 'a'), (New-FakeStepRecord -Id 'b' -FailedChecks @('b.stderr.empty') -StateValue 'failed'), (New-FakeStepRecord -Id 'c')) -Pre $preOk -Inventory $invOk -Sums $sumsOk -Expected 'FAIL'))
    [void]$vectors.Add((Test-VerdictVector -Name 'surviving-descendant' -Steps @((New-FakeStepRecord -Id 'a'), (New-FakeStepRecord -Id 'b' -Survivors @(1234) -StateValue 'failed'), (New-FakeStepRecord -Id 'c')) -Pre $preOk -Inventory $invOk -Sums $sumsOk -Expected 'FAIL'))
    [void]$vectors.Add((Test-VerdictVector -Name 'timeout' -Steps @((New-FakeStepRecord -Id 'a'), (New-FakeStepRecord -Id 'b' -TimedOut $true -StateValue 'failed'), (New-FakeStepRecord -Id 'c')) -Pre $preOk -Inventory $invOk -Sums $sumsOk -Expected 'FAIL'))
    [void]$vectors.Add((Test-VerdictVector -Name 'spawn-error' -Steps @((New-FakeStepRecord -Id 'a'), (New-FakeStepRecord -Id 'b' -Started $false -SpawnErrorText 'boom' -StateValue 'failed'), (New-FakeStepRecord -Id 'c')) -Pre $preOk -Inventory $invOk -Sums $sumsOk -Expected 'FAIL'))
    [void]$vectors.Add((Test-VerdictVector -Name 'failed-precondition' -Steps $allGood -Pre $preBad -Inventory $invOk -Sums $sumsOk -Expected 'FAIL'))
    [void]$vectors.Add((Test-VerdictVector -Name 'missing-artifact' -Steps $allGood -Pre $preOk -Inventory $invBad -Sums $sumsBad -Expected 'FAIL'))
    [void]$vectors.Add((Test-VerdictVector -Name 'post-flight-problem' -Steps $allGood -Pre $preOk -Inventory $invOk -Sums $sumsOk -PostProblems @('worktree changed during capture') -Expected 'FAIL'))

    $mismatches = New-Object System.Collections.ArrayList
    foreach ($v in $vectors) {
        if ([string]$v.actual -ne [string]$v.expected) {
            [void]$mismatches.Add([string]$v.name + ' expected=' + [string]$v.expected + ' actual=' + [string]$v.actual + ' failed=' + ((@($v.failed)) -join ','))
        }
    }
    $ok = (@($mismatches).Count -eq 0)
    return New-SelfTestCaseResult -Id 'S12' -State $(if ($ok) { 'pass' } else { 'fail' }) -Detail ('vectors=' + [string](@($vectors).Count) + ' mismatches=' + ((@($mismatches)) -join ' | '))
}

# ---------------------------------------------------------------------------
# Self-test S13: manifest shape validator rejects tampering
# ---------------------------------------------------------------------------
function Invoke-SelfTestS13 {
    param([Parameter(Mandatory)][string]$Root)
    $steps = @(
        (New-StepRecord -Id 'a' -Vector 'selftest:vector' -State 'passed'),
        (New-StepRecord -Id 'b' -Vector 'selftest:vector' -State 'passed'),
        (New-StepRecord -Id 'c' -Vector 'selftest:vector' -State 'passed')
    )
    $base = [pscustomobject]@{
        schemaVersion = 3
        runId = 'selftest-run'
        mode = 'selftest'
        phase = 'complete'
        preconditions = @([pscustomobject]@{ id = 'p'; ok = $true })
        invariants = @([pscustomobject]@{ id = 'i'; ok = $true })
        files = @([pscustomobject]@{ path = 'plan.txt'; sha256 = 'deadbeef' })
        artifacts = [pscustomobject]@{ expected = @(); observed = @(); missing = @(); unexpected = @(); unhashable = @(); ok = $true }
        publication = [pscustomobject]@{ expectedPhase = 'complete' }
        steps = @($steps)
        verdict = [pscustomobject]@{
            result = 'PASS'
            exitCode = 0
            failedConditions = @()
            conditions = [pscustomobject]@{ 'completion.stepCountEq3' = $true; 'checks.noneFailed' = $true }
        }
    }
    $json = [string]($base | ConvertTo-Json -Depth 10)

    $parsedBase = $json | ConvertFrom-Json
    $validBase = [bool](Test-ManifestShape -Manifest $parsedBase)

    $tamperCondition = $json | ConvertFrom-Json
    $tamperCondition.verdict.conditions.'checks.noneFailed' = $false
    $validCondition = [bool](Test-ManifestShape -Manifest $tamperCondition)

    $tamperPhase = $json | ConvertFrom-Json
    $tamperPhase.phase = 'failed'
    $validPhase = [bool](Test-ManifestShape -Manifest $tamperPhase)

    $tamperSteps = $json | ConvertFrom-Json
    $tamperSteps.steps = @(@($tamperSteps.steps)[0])
    $validSteps = [bool](Test-ManifestShape -Manifest $tamperSteps)

    $tamperFailed = $json | ConvertFrom-Json
    $tamperFailed.verdict.failedConditions = @('completion.allPassed')
    $validFailed = [bool](Test-ManifestShape -Manifest $tamperFailed)

    $tamperResult = $json | ConvertFrom-Json
    $tamperResult.verdict.result = 'FAIL'
    $validResult = [bool](Test-ManifestShape -Manifest $tamperResult)

    $ok = (
        $validBase -and
        (-not $validCondition) -and
        (-not $validPhase) -and
        (-not $validSteps) -and
        (-not $validFailed) -and
        (-not $validResult)
    )
    return New-SelfTestCaseResult -Id 'S13' -State $(if ($ok) { 'pass' } else { 'fail' }) -Detail ('base=' + [string]$validBase + ' condition=' + [string]$validCondition + ' phase=' + [string]$validPhase + ' steps=' + [string]$validSteps + ' failedConditions=' + [string]$validFailed + ' result=' + [string]$validResult)
}

# ---------------------------------------------------------------------------
# Self-test dispatcher and suite
# ---------------------------------------------------------------------------
function Invoke-SelfTestCase {
    param(
        [Parameter(Mandatory)][string]$Id,
        [AllowEmptyString()][string]$NodeExe = '',
        [Parameter(Mandatory)][string]$RepoFull,
        [Parameter(Mandatory)][string]$Root
    )
    if (@('S1', 'S2', 'S3', 'S5', 'S7') -contains $Id) {
        if ([string]::IsNullOrWhiteSpace($NodeExe)) {
            return New-SelfTestCaseResult -Id $Id -State 'unrunnable' -Detail 'node.exe not found under ProgramFiles'
        }
    }
    if ($Id -eq 'S1') { return Invoke-SelfTestS1 -NodeExe $NodeExe -Root $Root }
    if ($Id -eq 'S2') { return Invoke-SelfTestS2 -NodeExe $NodeExe -Root $Root }
    if ($Id -eq 'S3') { return Invoke-SelfTestS3 -NodeExe $NodeExe -Root $Root }
    if ($Id -eq 'S4') { return Invoke-SelfTestS4 -Root $Root }
    if ($Id -eq 'S5') { return Invoke-SelfTestS5 -NodeExe $NodeExe -Root $Root }
    if ($Id -eq 'S6') { return Invoke-SelfTestS6 -Root $Root }
    if ($Id -eq 'S7') { return Invoke-SelfTestS7 -NodeExe $NodeExe -Root $Root }
    if ($Id -eq 'S8a') { return Invoke-SelfTestS8a -RepoFull $RepoFull -Root $Root }
    if ($Id -eq 'S8b') { return Invoke-SelfTestS8b -RepoFull $RepoFull -Root $Root }
    if ($Id -eq 'S8c') { return Invoke-SelfTestS8c -RepoFull $RepoFull -Root $Root }
    if ($Id -eq 'S9') { return Invoke-SelfTestS9 -RepoFull $RepoFull -Root $Root }
    if ($Id -eq 'S10') { return Invoke-SelfTestS10 -RepoFull $RepoFull -Root $Root }
    if ($Id -eq 'S11') { return Invoke-SelfTestS11 -RepoFull $RepoFull -Root $Root }
    if ($Id -eq 'S12') { return Invoke-SelfTestS12 -Root $Root }
    if ($Id -eq 'S13') { return Invoke-SelfTestS13 -Root $Root }
    throw ('unknown self-test case: ' + $Id)
}

function Invoke-SelfTestSuite {
    param(
        [AllowEmptyString()][string]$Root = '',
        [AllowEmptyString()][string]$Only = ''
    )
    $tempPath = Get-NormalizedPath -Path ([System.IO.Path]::GetTempPath())
    $rootPath = [string]$Root
    if ([string]::IsNullOrWhiteSpace($rootPath)) {
        $rootPath = [System.IO.Path]::Combine($tempPath, ('slmm-capture-selftest-' + [guid]::NewGuid().ToString('N').Substring(0, 8)))
    }
    $rootFull = Get-NormalizedPath -Path $rootPath
    if (-not (Test-PathUnder -Child $rootFull -Parent $tempPath)) {
        Write-Log 'self-test refused: root must live under the system temp directory'
        $script:ExitCode = $script:ExitSelfTestUnrunnable
        return
    }
    if (-not (Test-Path -LiteralPath $rootFull -PathType Container)) {
        try {
            $null = New-Item -ItemType Directory -Path $rootFull -ErrorAction Stop
        }
        catch {
            Write-Log ('self-test refused: could not create root: ' + [string]$_.Exception.Message)
            $script:ExitCode = $script:ExitSelfTestUnrunnable
            return
        }
    }
    $repoFull = Get-NormalizedPath -Path $RepoRoot
    $nodeExe = Get-SelfTestNodeExe
    $ids = @('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8a', 'S8b', 'S8c', 'S9', 'S10', 'S11', 'S12', 'S13')
    if (-not [string]::IsNullOrWhiteSpace($Only)) {
        if (-not ($ids -contains $Only)) {
            Write-Log ('self-test refused: unknown case ' + $Only)
            $script:ExitCode = $script:ExitSelfTestUnrunnable
            return
        }
        $ids = @($Only)
    }
    $results = New-Object System.Collections.ArrayList
    foreach ($id in $ids) {
        $result = $null
        try {
            $result = Invoke-SelfTestCase -Id ([string]$id) -NodeExe $nodeExe -RepoFull $repoFull -Root $rootFull
        }
        catch {
            $result = New-SelfTestCaseResult -Id ([string]$id) -State 'unrunnable' -Detail ('exception: ' + [string]$_.Exception.Message)
        }
        [void]$results.Add($result)
        Write-Log ('[selftest] ' + [string]$result.id + ' ' + [string]$result.state + ' :: ' + [string]$result.detail)
    }
    $passed = @($results | Where-Object { [string]$_.state -eq 'pass' })
    $failed = @($results | Where-Object { [string]$_.state -eq 'fail' })
    $unrunnable = @($results | Where-Object { [string]$_.state -eq 'unrunnable' })
    Write-Log ('self-test summary: cases=' + [string](@($results).Count) + ' pass=' + [string](@($passed).Count) + ' fail=' + [string](@($failed).Count) + ' unrunnable=' + [string](@($unrunnable).Count))
    Write-Log ('self-test root: ' + [string]$rootFull)
    if (@($unrunnable).Count -gt 0) {
        $script:ExitCode = $script:ExitSelfTestUnrunnable
        return
    }
    if (@($failed).Count -gt 0) {
        $script:ExitCode = $script:ExitSelfTestFailed
        return
    }
    $script:ExitCode = $script:ExitSelfTestPassed
}

# ===========================================================================
# Entry
# ===========================================================================
$script:ExitCode = $script:ExitFail
try {
    $injectionUsed = ((-not [string]::IsNullOrWhiteSpace($FaultPoint)) -or (-not [string]::IsNullOrWhiteSpace($RunIdOverride)) -or ([bool]$SelfTestFakeSteps))
    if ($SelfTest) {
        Invoke-SelfTestSuite -Root $SelfTestRoot -Only $SelfTestCase
    }
    elseif ($PlanOnly) {
        if ($injectionUsed) { throw 'refused: injection parameters require -SelfTest' }
        $pre = Get-Preconditions -RepoRootPath $RepoRoot -EvidenceRootPath $EvidenceRoot -ExpectedHeadValue $ExpectedHead -Acknowledged ([bool]$AcknowledgeTestsRun) -ApprovalReference $ApprovalRef -SelfTestMode $false
        $script:ExitCode = [int](Invoke-PlanOnly -Pre $pre)
    }
    else {
        if ($injectionUsed) { throw 'refused: injection parameters require -SelfTest' }
        $pre = Get-Preconditions -RepoRootPath $RepoRoot -EvidenceRootPath $EvidenceRoot -ExpectedHeadValue $ExpectedHead -Acknowledged ([bool]$AcknowledgeTestsRun) -ApprovalReference $ApprovalRef -SelfTestMode $false
        if (-not [bool]$pre.ok) {
            Add-Reason ('refused before capture: ' + [string](@($pre.failed).Count) + ' precondition(s) failed')
            foreach ($f in @($pre.failed)) { Add-Reason ('precondition failed: ' + [string]$f) }
            $script:ExitCode = $script:ExitRefused
        }
        else {
            $script:ExitCode = [int](Invoke-Capture -Pre $pre -SelfTestMode $false -FaultAt '' -RunIdOverrideValue '' -UseFakeSteps $false)
        }
    }
}
catch {
    $err = $_
    Add-Reason ('UNHANDLED ' + [string]$err.Exception.GetType().Name + ': ' + [string]$err.Exception.Message)
    Write-Log ('[fatal] ' + [string]$err.Exception.Message)
    $abortApplied = $false
    if ((-not [string]::IsNullOrWhiteSpace([string]$script:EvidenceDir)) -and (Test-Path -LiteralPath ([string]$script:EvidenceDir) -PathType Container)) {
        try {
            $script:ExitCode = [int](Set-AbortState -Dir ([string]$script:EvidenceDir) -RunIdValue ([string]$script:RunId) -Reason ([string]$err.Exception.Message))
            $abortApplied = $true
        }
        catch {
            $abortApplied = $false
        }
    }
    if (-not $abortApplied) { $script:ExitCode = $script:ExitFail }
}
finally {
    # Publication failure is only a real-capture contract; a successful self-test must keep exit 7.
    if (($script:Verdict -eq 'PASS') -and ([int]$script:ExitCode -ne 0) -and (-not $SelfTest)) {
        $script:ExitCode = $script:ExitPublication
    }
}
foreach ($r in @($script:Reasons)) { Write-Log ('[reason] ' + [string]$r) }
Write-Log ('[exit] ' + [string]$script:ExitCode)
exit ([int]$script:ExitCode)
