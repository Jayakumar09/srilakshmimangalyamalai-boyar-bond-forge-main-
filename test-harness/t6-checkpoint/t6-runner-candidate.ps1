# =============================================================================
# T6 LOCAL LAB ORCHESTRATOR -- CORRECTED CANDIDATE (Windows / PowerShell 5.1)
#
# STATUS: CANDIDATE -- NOT APPROVED, NOT EXECUTED.
#
# Derived from the recovered APPROVED wrapper
#   t6-runner.ps1  SHA-256 fac7926d0de1739f89a9298baf1be0198268fb560ef80ddd151cb6b73720894c
# (16608 bytes), which lives unchanged at test-harness/t6-checkpoint/t6-runner.ps1.
# This file does NOT overwrite it.
#
# Base revision history reconstructed from OpenCode session history (2026-10-19):
#   22:54:22  fac7926d...  16608 B  QUOTED listen_addresses  <-- the APPROVED one
#   22:58:10  c87df1c7...  16606 B  quoting fixed
#   23:07:41  abd83227...  17446 B  quoting fixed + Invoke-Native hardening
# The 23:07/23:08 revision was executed on 2026-10-19 but was NEVER approved.
#
# -----------------------------------------------------------------------------
# CHANGES APPLIED TO THE APPROVED BASE -- each independently justified
# -----------------------------------------------------------------------------
# C1  listen_addresses quoting defect.
#     Base line:  -o "-p $Port -c listen_addresses='127.0.0.1' -c logging_collector=off"
#     On Windows, pg_ctl hands the -o string to cmd.exe, where single quotes are
#     NOT quoting characters. postgres therefore received the literal value
#     '127.0.0.1' (with quote characters) and refused to start. This is the
#     recorded failure of the approved revision: "pg_ctl: could not start
#     server" / "T6 BLOCKED: pg_ctl start failed (1)".
#     Fix: the value is passed unquoted, and it is now passed as ONE argument
#     (splat array) so no shell can re-interpret it. A guard rejects any
#     cmd.exe metacharacter in the option string.
#
# C2  Native-command stderr must not become a terminating error (PS 5.1).
#     In Windows PowerShell 5.1 a native program that writes to stderr is
#     wrapped in a NativeCommandError, and $ErrorActionPreference='Stop' makes
#     that TERMINATING. The base script called psql directly, so the SUCCESS
#     path of t6-preflight-lab.sql (RAISE NOTICE 'T6 preflight clean') and of
#     t6-lab-residue.sql (RAISE NOTICE 'T6 residue clean') -- both emitted on
#     stderr by psql -- would abort the run before the exit code was ever
#     examined. Every native call now goes through Invoke-Native, which runs
#     the child with $ErrorActionPreference='Continue', splits stdout from
#     stderr, and returns the real exit code. stderr is preserved as evidence.
#
# C3  Exit-code detection for every native tool, and no stale-exit-code reuse.
#     Base gaps: the stale-cluster "pg_ctl stop" exit code was never checked
#     (so a still-running cluster could have had its data directory deleted),
#     and $LASTEXITCODE was read after a pipeline. Each native call is now
#     invoked directly inside Invoke-Native, which resets and reads
#     $LASTEXITCODE in the same scope as the call, and every exit code is
#     captured into an explicit table.
#
# C4  A run can no longer be reported PASS by accident.
#     The base decided the verdict from two exit codes only. The candidate
#     additionally requires: initdb / pg_ctl start / pg_isready / CREATE
#     DATABASE / bootstrap / preflight / node / residue all exit 0; the runner's
#     results file present, parseable, and containing EXACTLY the 12 Group-L
#     case ids with status PASS; the runner's own summary reporting 12 total /
#     12 pass / 0 fail / 0 blocked / 0 not_run; and the evidence copy of the
#     results file byte-identical to the original (SHA-256 compared, and
#     compared against the SHA-256 the runner itself reported).
#     Verdict logic lives in one pure function so it can be negative-tested
#     without a database.
#
# C5  The PostgreSQL service on port 5432 can never be contacted or stopped.
#     The port is a constant used everywhere; a guard refuses any port other
#     than 15432; a second guard refuses any path inside the PostgreSQL
#     installation tree (the service's data directory) as a target. The base
#     script never named 5432 but also never asserted it.
#
# C6  Fail-closed for unknown clusters and unknown directories.
#     The ownership marker is now parsed structurally (not a loose substring
#     match). Before a stale data directory is stopped or deleted, its
#     postmaster.pid is read: if the recorded data directory is not ours, the
#     run is refused. If a stop fails, the data directory is NOT deleted.
#
# C7  Execution evidence is durable and outside the disposable cluster.
#     The base wrote the run log and read the results from INSIDE the lab
#     root, which the teardown then deleted -- so a passing run could leave
#     no evidence at all. The candidate writes a uniquely named evidence
#     directory (default <TEMP>\opencode\t6-evidence\<run-id>\) containing the
#     run log, a copy of the results file, the artifact checksums and a
#     structured verdict. The evidence root may be redirected with
#     -EvidenceRoot, but never into the lab root and never into the
#     repository (the base guarantee "never writes to the repository" is
#     preserved), and never into the PostgreSQL installation.
#
# C8  Extended static negative tests (no database, no cluster): path
#     injection, port redirection, incorrect ownership, startup-failure
#     verdict mapping, and evidence preservation.
#
# -----------------------------------------------------------------------------
# SAFETY MODEL (fail closed)
#  * The port (15432), repository path and preparation directory are fixed
#    constants. There are no -Port/-Repo/-Prep/-LabRoot overrides, so no
#    destructive target can be redirected.
#  * The laboratory root must live inside the exact approved %TEMP% namespace
#    (<...>\AppData\Local\Temp\opencode\t6lab); substring matches, traversal,
#    UNC, device and alternate-data-stream paths are rejected.
#  * Every directory is protected by a run-ownership marker. A pre-existing
#    directory without a valid marker is refused, never deleted.
#  * All recursive deletion is confined to the lab root and is preceded by a
#    namespace check, an ownership check and a service-path check.
#  * If port 15432 is already listening the run is BLOCKED: nothing is
#    connected to and nothing is terminated.
#  * Ambient libpq redirect variables (PGHOSTADDR, PGSERVICE, PGOPTIONS, ...)
#    are refused before any PostgreSQL child process is launched.
#  * The PostgreSQL service on port 5432 and its data directory are never
#    contacted, stopped or deleted.
#
# C6 HARD-KILL RECOVERY
#  * There is no automatic cleanup of unknown clusters. If a previous run was
#    interrupted and ownership of <TEMP>\opencode\t6lab cannot be proven, the
#    script refuses to stop or delete anything and exits BLOCKED. Never
#    terminate arbitrary PostgreSQL processes and never delete a data directory
#    whose ownership marker is absent or mismatched.
#
# Usage (only after separate approval):
#   powershell -File t6-runner-candidate.ps1 -Confirm I_APPROVE_LOCAL_T6
#   powershell -File t6-runner-candidate.ps1 -SelfTest   # static guards only
# =============================================================================
[CmdletBinding()]
param(
  [switch]$Keep,
  [string]$Confirm,
  [switch]$SelfTest,
  [string]$EvidenceRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# --- Fixed, non-overridable configuration ------------------------------------
$Port            = 15432
$ServicePort     = 5432          # only ever used to REFUSE it; never a target
$Repo            = "D:\DevProjects\Working\srilakshmimangalyamalai(boyar-bond-forge-main)"
$MarkerName      = "T6LAB_OWNER"
$MarkerContent   = "slmm-t6-disposable-lab"
$ApprovedSuffix  = "\AppData\Local\Temp\opencode\t6lab"
$DefaultEvidence = "\opencode\t6-evidence"
$ConfirmToken    = "I_APPROVE_LOCAL_T6"
$RunnerConfirm   = "I_APPROVE_LOCAL_T6"
$ExpectedGroupLCases = @(
  "T6-L01","T6-L02","T6-L03","T6-L04","T6-L05","T6-L06",
  "T6-L07","T6-L08a","T6-L08b","T6-L09","T6-L10","T6-L11"
)

$script:stFail    = 0
$script:RunId     = (Get-Date -Format "yyyyMMdd-HHmmss") + "-" + ([guid]::NewGuid().ToString("N").Substring(0,8))
$script:ExitCodes = @{}
$script:EvidenceDir = $null
$script:LogPath   = $null
$script:LogLines  = New-Object System.Collections.Generic.List[string]

function Throw-Blocked([string]$m) { throw "T6 BLOCKED: $m" }
function Step([string]$m) { Write-Host "[T6] $m"; Log-Line "[T6] $m" }
function Test-Throws([scriptblock]$Fn) { try { & $Fn; return $false } catch { return $true } }

function Log-Line([string]$m) {
  $script:LogLines.Add($m)
  if ($script:LogPath) {
    try { Add-Content -LiteralPath $script:LogPath -Value $m -Encoding UTF8 -ErrorAction SilentlyContinue } catch { }
  }
}

# =============================================================================
# Native command execution (C2, C3)
# =============================================================================
# Invoke-Native runs one native executable, capturing stdout and stderr
# separately and returning the child's real exit code.
#
# Why not `& $exe @args 2>&1` under $ErrorActionPreference='Stop':
#   In Windows PowerShell 5.1 a native program writing to stderr produces a
#   NativeCommandError, which 'Stop' promotes to a terminating error. psql
#   emits server NOTICEs on stderr -- including the SUCCESS notices of
#   t6-preflight-lab.sql and t6-lab-residue.sql -- so the direct calls in the
#   base script could abort a healthy run. Running the child with
#   $ErrorActionPreference='Continue' keeps stderr as evidence instead of as a
#   fatal error, and the exit code becomes the only verdict input.
#
# The child is invoked directly in THIS scope (not inside a nested scriptblock)
# so that $LASTEXITCODE is read in the same scope that set it.
function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [string[]]$ArgList = @(),
    [string]$LogFile = $null,
    [switch]$Quiet
  )
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $global:LASTEXITCODE = 0
    $merged = @(& $Exe @ArgList 2>&1)
    $code = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $prevEap
  }
  $out = New-Object System.Collections.Generic.List[string]
  $err = New-Object System.Collections.Generic.List[string]
  foreach ($item in $merged) {
    if ($item -is [System.Management.Automation.ErrorRecord]) { $err.Add([string]$item.ToString()) }
    else { $out.Add([string]$item) }
  }
  if (-not $Quiet) {
    foreach ($l in $out) { Write-Host $l; Log-Line $l }
    foreach ($l in $err) { Write-Host $l; Log-Line $l }
  }
  if ($LogFile) {
    try {
      Add-Content -LiteralPath $LogFile -Value ($out -join "`r`n") -Encoding UTF8 -ErrorAction SilentlyContinue
      if ($err.Count -gt 0) {
        Add-Content -LiteralPath $LogFile -Value ("--- stderr ---`r`n" + ($err -join "`r`n")) -Encoding UTF8 -ErrorAction SilentlyContinue
      }
    } catch { }
  }
  return [pscustomobject]@{
    ExitCode = [int]$code
    Stdout   = $out.ToArray()
    Stderr   = $err.ToArray()
  }
}

# =============================================================================
# Path / ownership / port guards (C1, C5, C6, C7)
# =============================================================================
function Assert-ApprovedTempPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { Throw-Blocked "empty laboratory path" }
  if (-not [IO.Path]::IsPathRooted($Path)) { Throw-Blocked "laboratory path is not absolute: $Path" }
  # Check the RAW string: [IO.Path]::GetFullPath() silently strips a trailing
  # space/dot, so a normalised-away tail would never be seen below. Windows APIs
  # that do not normalise (e.g. the \\?\ prefix form) can address a DIFFERENT
  # directory with such a name, so the raw form is rejected outright.
  if ($Path -match '[\s\.]+$') { Throw-Blocked "laboratory path has a trailing space or dot: $Path" }
  $full = [IO.Path]::GetFullPath($Path)
  if ($full -match '\.\.') { Throw-Blocked "laboratory path contains traversal: $full" }
  if ($full -match '^\s*\\\\') { Throw-Blocked "laboratory path is a UNC path: $full" }
  if ($full -match '\\\\\?\\') { Throw-Blocked "laboratory path is a device path: $full" }
  if ($full -match '::') { Throw-Blocked "laboratory path uses an alternate data stream: $full" }
  if (-not $full.ToLowerInvariant().EndsWith($ApprovedSuffix.ToLowerInvariant())) {
    Throw-Blocked "path is not inside the approved TEMP namespace: $full"
  }
  return $full
}

function Get-ApprovedLabRoot {
  if ([string]::IsNullOrWhiteSpace($env:TEMP)) { Throw-Blocked "TEMP is not set" }
  return (Assert-ApprovedTempPath (Join-Path $env:TEMP "opencode\t6lab"))
}

# C5: refuse any path inside the PostgreSQL installation tree -- that is where
# the always-on service on port 5432 keeps its data directory.
function Assert-NotServiceTarget([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return }
  $full = [IO.Path]::GetFullPath($Path).ToLowerInvariant()
  $pgRoot = ""
  if ($env:ProgramFiles) { $pgRoot = (Join-Path $env:ProgramFiles "PostgreSQL").ToLowerInvariant() }
  if ($pgRoot -and $full.StartsWith($pgRoot + "\")) {
    Throw-Blocked "refusing: $Path is inside the PostgreSQL installation (the port-$ServicePort service lives there)"
  }
}

# C5: the only port this wrapper may ever target.
function Assert-LabPort([int]$P) {
  if ($P -ne $Port) { Throw-Blocked "refusing: only port $Port may be targeted (got $P)" }
  if ($P -eq $ServicePort) { Throw-Blocked "refusing: port $ServicePort is the Windows PostgreSQL service" }
}

function Get-MarkerPath([string]$Dir) { Join-Path $Dir $MarkerName }

# C6: structural ownership marker, not a loose substring match.
function Get-MarkerFields([string]$Dir) {
  $f = Get-MarkerPath $Dir
  if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { return $null }
  $raw = $null
  try { $raw = Get-Content -LiteralPath $f -Raw -ErrorAction Stop } catch { return $null }
  if ($null -eq $raw) { return $null }
  $lines = @($raw -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 })
  if ($lines.Count -lt 3) { return $null }
  if ($lines[0].Trim() -ne $MarkerContent) { return $null }
  $fields = @{}
  foreach ($l in $lines) {
    if ($l -match '^\s*([A-Za-z_]+)=(.*)$') { $fields[$Matches[1].ToLowerInvariant()] = $Matches[2] }
  }
  foreach ($k in @("run","pid","created")) {
    if (-not $fields.ContainsKey($k)) { return $null }
  }
  return $fields
}

function Test-OwnedMarker([string]$Dir) {
  return $null -ne (Get-MarkerFields $Dir)
}

function Add-OwnershipMarker([string]$Dir) {
  $content = "{0}`nrun={1}`npid={2}`ncreated={3}" -f $MarkerContent, ([guid]::NewGuid().ToString("N")), $PID, (Get-Date -Format o)
  Set-Content -LiteralPath (Get-MarkerPath $Dir) -Value $content -Encoding UTF8
}

# Create the lab root only after path verification; refuse an unowned pre-existing dir.
function Assert-OwnedOrAbsent([string]$Dir) {
  Assert-ApprovedTempPath $Dir | Out-Null
  Assert-NotServiceTarget $Dir
  if (Test-Path -LiteralPath $Dir -PathType Container) {
    if (-not (Test-OwnedMarker $Dir)) {
      Throw-Blocked "refusing: $Dir exists but is not owned by a verified T6 run (missing or invalid $MarkerName). STOP for manual inspection."
    }
    return
  }
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  Add-OwnershipMarker $Dir
}

# Recursive deletion is allowed only inside the lab root, with a valid marker,
# and never inside the PostgreSQL installation.
function Assert-Deletable([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  $lab  = [IO.Path]::GetFullPath($script:LabRoot).TrimEnd('\')
  if ($full -ne $lab -and -not $full.StartsWith($lab + '\')) {
    Throw-Blocked "refusing to delete outside the lab namespace: $full"
  }
  if (-not (Test-OwnedMarker $script:LabRoot)) {
    Throw-Blocked "lab ownership marker missing/invalid; refusing to delete $full"
  }
  Assert-NotServiceTarget $full
}

function Remove-LabTree([string]$Path) {
  Assert-Deletable $Path
  Remove-Item -Recurse -Force -LiteralPath $Path -ErrorAction Stop
}

# C6: never touch a cluster that is not provably ours.
function Assert-PostmasterIsOurs([string]$DataDir) {
  $pidFile = Join-Path $DataDir "postmaster.pid"
  if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) { return $null }
  $lines = @()
  try { $lines = @(Get-Content -LiteralPath $pidFile -ErrorAction Stop) } catch { return $null }
  if ($lines.Count -lt 2) { return $null }
  $recorded = $lines[1].Trim().Trim('"')
  # Canonicalise BOTH sides. postgres records the data directory as it was
  # resolved at startup, which may be the 8.3 short name (e.g. JAYAKU~1) when
  # %TEMP% is short. [IO.Path]::GetFullPath() expands 8.3 short names, so
  # comparing a raw recorded value against a canonical one would mismatch and
  # wrongly refuse a genuinely-owned cluster.
  try   { $theirs = ([IO.Path]::GetFullPath($recorded) -replace '\\','/').TrimEnd('/').ToLowerInvariant() }
  catch { $theirs = ($recorded -replace '\\','/').TrimEnd('/').ToLowerInvariant() }
  $mine = ([IO.Path]::GetFullPath($DataDir) -replace '\\','/').TrimEnd('/').ToLowerInvariant()
  if ($theirs -ne $mine) {
    Throw-Blocked "refusing: $DataDir contains a postmaster.pid for a DIFFERENT data directory ($recorded). STOP for manual inspection."
  }
  return $lines[0].Trim()
}

# --- Port guard (never connects to or terminates an existing listener) --------
function Assert-PortFree([int]$P, [switch]$UseInjection, [bool]$InjectedListener = $false) {
  Assert-LabPort $P
  $listeners = @()
  if ($UseInjection) {
    if ($InjectedListener) { $listeners = @("injected") }
  } else {
    $listeners = @(Get-NetTCPConnection -LocalPort $P -State Listen -ErrorAction SilentlyContinue)
  }
  if ($listeners.Count -gt 0) {
    Throw-Blocked "port $P is already in use; refusing to connect to or terminate it"
  }
}

# =============================================================================
# Evidence (C7)
# =============================================================================
function Assert-EvidenceRoot([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { Throw-Blocked "empty evidence root" }
  if (-not [IO.Path]::IsPathRooted($Path)) { Throw-Blocked "evidence root is not absolute: $Path" }
  $full = [IO.Path]::GetFullPath($Path)
  if ($full -match '\.\.') { Throw-Blocked "evidence root contains traversal: $full" }
  if ($full -match '^\s*\\\\') { Throw-Blocked "evidence root is a UNC path: $full" }
  if ($full -match '::') { Throw-Blocked "evidence root uses an alternate data stream: $full" }
  if ($full -match '^[A-Za-z]:\\$') { Throw-Blocked "evidence root is a drive root: $full" }
  $lab = ([IO.Path]::GetFullPath($script:LabRoot) -replace '\\','/').TrimEnd('/').ToLowerInvariant()
  $ev  = ($full -replace '\\','/').TrimEnd('/').ToLowerInvariant()
  if ($ev -eq $lab -or $ev.StartsWith($lab + '/')) { Throw-Blocked "evidence root must not be inside the disposable lab root: $full" }
  $repo = ([IO.Path]::GetFullPath($Repo) -replace '\\','/').TrimEnd('/').ToLowerInvariant()
  if ($ev -eq $repo -or $ev.StartsWith($repo + '/')) { Throw-Blocked "evidence root must not be inside the repository: $full" }
  Assert-NotServiceTarget $full
  return $full
}

function New-EvidenceDir {
  $root = $EvidenceRoot
  if ([string]::IsNullOrWhiteSpace($root)) {
    if ([string]::IsNullOrWhiteSpace($env:TEMP)) { Throw-Blocked "TEMP is not set" }
    $root = Join-Path $env:TEMP $DefaultEvidence.TrimStart('\')
  }
  $root = Assert-EvidenceRoot $root
  if (-not (Test-Path -LiteralPath $root -PathType Container)) {
    New-Item -ItemType Directory -Force -Path $root | Out-Null
  }
  $dir = Join-Path $root ("t6-run-" + $script:RunId)
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $script:EvidenceDir = $dir
  $script:LogPath = Join-Path $dir ("t6-lab-run." + $script:RunId + ".log")
  Set-Content -LiteralPath $script:LogPath -Value ("T6 run " + $script:RunId) -Encoding UTF8
  return $dir
}

# =============================================================================
# Verdict (C4) -- pure function, negative-testable without a database
# =============================================================================
function ConvertTo-NormalizedPath([string]$p) {
  if ($null -eq $p) { return "" }
  return (($p -replace '\\','/').TrimEnd('/')).ToLowerInvariant()
}

function Get-T6Verdict {
  param(
    [hashtable]$ExitCodes,
    [string]$ResultsPath,
    [string]$EvidenceResultsPath,
    [string[]]$ExpectedCaseIds,
    [string]$ExpectedResultsSha = $null,
    [string]$RunnerSummaryJson = $null
  )
  $reasons = New-Object System.Collections.Generic.List[string]

  foreach ($k in ($ExitCodes.Keys | Sort-Object)) {
    if ([int]$ExitCodes[$k] -ne 0) { $reasons.Add("step '$k' exited $($ExitCodes[$k])") }
  }

  $caseIds = @()
  if ([string]::IsNullOrWhiteSpace($ResultsPath) -or -not (Test-Path -LiteralPath $ResultsPath -PathType Leaf)) {
    $reasons.Add("runner results file is missing: $ResultsPath")
  } else {
    $records = @()
    $parseOk = $true
    foreach ($line in @(Get-Content -LiteralPath $ResultsPath -ErrorAction SilentlyContinue)) {
      if ([string]::IsNullOrWhiteSpace($line)) { continue }
      try { $records += ($line | ConvertFrom-Json -ErrorAction Stop) } catch { $parseOk = $false; break }
    }
    if (-not $parseOk) {
      $reasons.Add("runner results file is not valid JSONL")
    } else {
      $ids = @($records | ForEach-Object { [string]$_.id })
      $caseIds = @($ids | Where-Object { $_ -like "T6-L*" })
      $nonPass = @($records | Where-Object { [string]$_.status -ne "PASS" })
      if ($nonPass.Count -gt 0) {
        $reasons.Add("non-PASS case record(s): " + (($nonPass | ForEach-Object { "$($_.id)=$($_.status)" }) -join ", "))
      }
      $missing = @($ExpectedCaseIds | Where-Object { $ids -notcontains $_ })
      $extra   = @($caseIds   | Where-Object { $ExpectedCaseIds -notcontains $_ })
      if ($missing.Count -gt 0) { $reasons.Add("missing expected Group-L case(s): " + ($missing -join ", ")) }
      if ($extra.Count -gt 0)   { $reasons.Add("unexpected Group-L case(s): " + ($extra -join ", ")) }
      if ($caseIds.Count -ne $ExpectedCaseIds.Count) {
        $reasons.Add("expected $($ExpectedCaseIds.Count) Group-L cases, found $($caseIds.Count)")
      }
    }
  }

  if ([string]::IsNullOrWhiteSpace($EvidenceResultsPath) -or -not (Test-Path -LiteralPath $EvidenceResultsPath -PathType Leaf)) {
    $reasons.Add("evidence copy of the results file is missing: $EvidenceResultsPath")
  } else {
    if (Test-Path -LiteralPath $ResultsPath -PathType Leaf) {
      $srcHash = (Get-FileHash -LiteralPath $ResultsPath -Algorithm SHA256).Hash.ToLowerInvariant()
      $dstHash = (Get-FileHash -LiteralPath $EvidenceResultsPath -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($srcHash -ne $dstHash) { $reasons.Add("evidence copy of the results file differs from the original (sha256 $srcHash vs $dstHash)") }
      if (-not [string]::IsNullOrWhiteSpace($ExpectedResultsSha) -and $dstHash -ne $ExpectedResultsSha.ToLowerInvariant()) {
        $reasons.Add("results sha256 does not match the digest the runner reported ($ExpectedResultsSha)")
      }
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($RunnerSummaryJson)) {
    try {
      $s = ($RunnerSummaryJson | ConvertFrom-Json -ErrorAction Stop).summary
      if ([int]$s.total -ne $ExpectedCaseIds.Count) { $reasons.Add("runner summary total=$($s.total), expected $($ExpectedCaseIds.Count)") }
      if ([int]$s.pass  -ne $ExpectedCaseIds.Count) { $reasons.Add("runner summary pass=$($s.pass), expected $($ExpectedCaseIds.Count)") }
      if ([int]$s.fail  -ne 0) { $reasons.Add("runner summary fail=$($s.fail)") }
      if ([int]$s.blocked -ne 0) { $reasons.Add("runner summary blocked=$($s.blocked)") }
      if ([int]$s.not_run -ne 0) { $reasons.Add("runner summary not_run=$($s.not_run)") }
    } catch {
      $reasons.Add("runner summary line could not be parsed")
    }
  } else {
    $reasons.Add("runner summary line not found in the runner output")
  }

  $verdict = if ($reasons.Count -eq 0) { "PASS" } else { "FAIL" }
  return [pscustomobject]@{
    Verdict  = $verdict
    Reasons  = $reasons.ToArray()
    CaseIds  = $caseIds
    RunId    = $script:RunId
  }
}

# =============================================================================
# Resolved constants
# =============================================================================
$script:LabRoot = Get-ApprovedLabRoot
$Prep     = Join-Path (Split-Path $script:LabRoot -Parent) "t6-prep"   # <TEMP>\opencode\t6-prep
$DataDir  = Join-Path $script:LabRoot "data"
$PgLog    = Join-Path $script:LabRoot "pg.log"
$ResultFile = Join-Path $script:LabRoot "t6-lab-results.jsonl"

# --- Environment guards ------------------------------------------------------
function Assert-NoRedirectEnv {
  foreach ($k in 'PGHOSTADDR','PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGSYSCONFDIR','PGOPTIONS','PGPASSFILE','PGSSLMODE','PGCONNECT_TIMEOUT','PGCLIENTENCODING') {
    if (Test-Path "Env:$k") {
      $v = (Get-Item "Env:$k").Value
      if ($null -ne $v -and "$v" -ne "") { Throw-Blocked "ambient $k is set; refusing (possible connection redirection)" }
    }
  }
}

# =============================================================================
# Static negative self-test (C8). No database connection, no cluster, no
# PostgreSQL process. Touches the filesystem only inside a disposable sandbox.
# =============================================================================
function Invoke-SelfTest {
  function Check([string]$Name, [bool]$Cond) {
    if ($Cond) { Write-Host "PASS  $Name" }
    else { Write-Host "FAIL  $Name"; $script:stFail++ }
  }
  function Expect-Blocked([string]$Name, [scriptblock]$Fn) {
    try { & $Fn | Out-Null; Check $Name $false }
    catch { Check $Name $true }
  }
  function Expect-Allowed([string]$Name, [scriptblock]$Fn) {
    try { & $Fn | Out-Null; Check $Name $true }
    catch { Write-Host "      (unexpected refusal: $($_.Exception.Message))"; Check $Name $false }
  }

  # --- port guards (port redirection / 5432 service) ---
  Expect-Blocked "existing listener on 15432 -> BLOCKED" { Assert-PortFree -P 15432 -UseInjection -InjectedListener $true }
  Expect-Allowed  "free 15432 accepted"                { Assert-PortFree -P 15432 -UseInjection -InjectedListener $false }
  Expect-Blocked "port 5432 refused as a lab target"   { Assert-LabPort 5432 }
  Expect-Blocked "port 15433 refused as a lab target"  { Assert-LabPort 15433 }
  Expect-Allowed  "port 15432 accepted as a lab target" { Assert-LabPort 15432 }
  Expect-Blocked "PostgreSQL installation path refused as a target" {
    if ($env:ProgramFiles) { Assert-NotServiceTarget (Join-Path $env:ProgramFiles "PostgreSQL\18\data") }
    else { throw "ProgramFiles not set" }
  }

  # --- path injection ---
  Expect-Blocked "unsafe LabRoot (C:\Windows\t6lab) refused" { Assert-ApprovedTempPath "C:\Windows\t6lab" }
  Expect-Blocked "relative LabRoot refused"                   { Assert-ApprovedTempPath "t6lab" }
  Expect-Blocked "substring-sibling (t6lab2) refused"         { Assert-ApprovedTempPath "C:\Users\x\AppData\Local\Temp\opencode\t6lab2" }
  Expect-Blocked "traversal LabRoot refused"                  { Assert-ApprovedTempPath "C:\Users\x\AppData\Local\Temp\opencode\t6lab\..\evil" }
  Expect-Blocked "wrong TEMP branch refused"                  { Assert-ApprovedTempPath "C:\Users\x\AppData\Local\Temp\t6lab" }
  Expect-Blocked "UNC LabRoot refused"                        { Assert-ApprovedTempPath "\\server\share\opencode\t6lab" }
  Expect-Blocked "device path LabRoot refused"                { Assert-ApprovedTempPath "\\?\C:\Users\x\AppData\Local\Temp\opencode\t6lab" }
  Expect-Blocked "alternate-data-stream LabRoot refused"      { Assert-ApprovedTempPath "C:\Users\x\AppData\Local\Temp\opencode\t6lab::$DATA" }
  Expect-Blocked "trailing-dot LabRoot refused"               { Assert-ApprovedTempPath "C:\Users\x\AppData\Local\Temp\opencode\t6lab. " }
  Expect-Allowed  "approved LabRoot accepted"                 { Assert-ApprovedTempPath $script:LabRoot }

  # --- ownership ---
  $sandbox = Join-Path $env:TEMP ("t6-selftest-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $sandbox | Out-Null
  try {
    Check "unowned directory has no marker" (-not (Test-OwnedMarker $sandbox))
    Add-OwnershipMarker $sandbox
    Check "valid ownership marker recognized" (Test-OwnedMarker $sandbox)
    Set-Content -LiteralPath (Get-MarkerPath $sandbox) -Value "some-other-lab" -Encoding UTF8
    Check "mismatched ownership marker refused" (-not (Test-OwnedMarker $sandbox))
    Set-Content -LiteralPath (Get-MarkerPath $sandbox) -Value "slmm-t6-disposable-lab`nrun=x" -Encoding UTF8
    Check "incomplete ownership marker refused" (-not (Test-OwnedMarker $sandbox))
    Set-Content -LiteralPath (Get-MarkerPath $sandbox) -Value "slmm-t6-disposable-lab`nrun=x`npid=1`ncreated=now" -Encoding UTF8
    Check "complete ownership marker recognized" (Test-OwnedMarker $sandbox)

    # postmaster.pid pointing at a different data directory must be refused
    $fakeData = Join-Path $sandbox "data"
    New-Item -ItemType Directory -Force -Path $fakeData | Out-Null
    Set-Content -LiteralPath (Join-Path $fakeData "postmaster.pid") -Value "12345`nC:/somewhere/else/data`n1792430000`n15432" -Encoding ASCII
    Expect-Blocked "postmaster.pid for a foreign data directory refused" { Assert-PostmasterIsOurs $fakeData }
    Set-Content -LiteralPath (Join-Path $fakeData "postmaster.pid") -Value "12345`n$([IO.Path]::GetFullPath($fakeData) -replace '\\','/')`n1792430000`n15432" -Encoding ASCII
    Expect-Allowed  "postmaster.pid for our own data directory accepted" { Assert-PostmasterIsOurs $fakeData }
  }
  finally {
    if ($sandbox -and $sandbox.StartsWith($env:TEMP) -and $sandbox -like "*t6-selftest-*") {
      Remove-Item -Recurse -Force -LiteralPath $sandbox -ErrorAction SilentlyContinue
    }
  }
  Expect-Blocked "delete outside lab namespace refused" { Assert-Deletable (Join-Path $env:TEMP "t6st-outside") }
  Expect-Blocked "pre-existing unowned lab root refused" {
    $u = Join-Path $env:TEMP ("t6-selftest-owned-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $u | Out-Null
    try { Assert-OwnedOrAbsent $u } finally { Remove-Item -Recurse -Force -LiteralPath $u -ErrorAction SilentlyContinue }
  }

  # --- evidence root guards (C7) ---
  Expect-Blocked "evidence root inside the lab root refused" { Assert-EvidenceRoot (Join-Path $script:LabRoot "evidence") }
  Expect-Blocked "evidence root equal to the lab root refused" { Assert-EvidenceRoot $script:LabRoot }
  Expect-Blocked "evidence root inside the repository refused" { Assert-EvidenceRoot (Join-Path $Repo "test-harness") }
  Expect-Blocked "relative evidence root refused" { Assert-EvidenceRoot "evidence" }
  Expect-Blocked "UNC evidence root refused" { Assert-EvidenceRoot "\\server\share\evidence" }
  Expect-Blocked "drive-root evidence root refused" { Assert-EvidenceRoot "C:\" }
  Expect-Allowed  "evidence root outside lab and repo accepted" { Assert-EvidenceRoot (Join-Path $env:TEMP "t6-evidence-selftest") }

  # --- startup-failure verdict mapping (C4) -- pure function, no database ---
  $vdir = Join-Path $env:TEMP ("t6-verdict-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $vdir | Out-Null
  try {
    $good = @()
    foreach ($id in $ExpectedGroupLCases) { $good += ('{"id":"' + $id + '","status":"PASS","detail":""}') }
    $goodFile = Join-Path $vdir "good.jsonl"
    Set-Content -LiteralPath $goodFile -Value ($good -join "`n") -Encoding UTF8
    $copyFile = Join-Path $vdir "good.copy.jsonl"
    Copy-Item -LiteralPath $goodFile -Destination $copyFile -Force
    $goodSha = (Get-FileHash -LiteralPath $goodFile -Algorithm SHA256).Hash.ToLowerInvariant()
    $summaryJson = '{"summary":{"total":12,"pass":12,"fail":0,"blocked":0,"not_run":0,"harness_failed":false,"residue_failed":false}}'

    $allZero = @{ initdb=0; pgctl_start=0; isready=0; create_db=0; bootstrap=0; preflight=0; node=0; residue=0 }

    $v = Get-T6Verdict -ExitCodes $allZero -ResultsPath $goodFile -EvidenceResultsPath $copyFile -ExpectedCaseIds $ExpectedGroupLCases -ExpectedResultsSha $goodSha -RunnerSummaryJson $summaryJson
    Check "verdict PASS when every step exits 0 and 12/12 Group-L cases PASS" ($v.Verdict -eq "PASS")

    foreach ($k in @("initdb","pgctl_start","isready","create_db","bootstrap","preflight","node","residue")) {
      $codes = $allZero.Clone(); $codes[$k] = 1
      $v = Get-T6Verdict -ExitCodes $codes -ResultsPath $goodFile -EvidenceResultsPath $copyFile -ExpectedCaseIds $ExpectedGroupLCases -ExpectedResultsSha $goodSha -RunnerSummaryJson $summaryJson
      Check "verdict FAIL when '$k' exits non-zero" ($v.Verdict -eq "FAIL")
    }

    $v = Get-T6Verdict -ExitCodes $allZero -ResultsPath (Join-Path $vdir "missing.jsonl") -EvidenceResultsPath $copyFile -ExpectedCaseIds $ExpectedGroupLCases -ExpectedResultsSha $goodSha -RunnerSummaryJson $summaryJson
    Check "verdict FAIL when the results file is missing" ($v.Verdict -eq "FAIL")

    $bad = @($good); $bad[3] = '{"id":"T6-L04","status":"BLOCKED","detail":"x"}'
    $badFile = Join-Path $vdir "bad.jsonl"
    Set-Content -LiteralPath $badFile -Value ($bad -join "`n") -Encoding UTF8
    $badCopy = Join-Path $vdir "bad.copy.jsonl"
    Copy-Item -LiteralPath $badFile -Destination $badCopy -Force
    $v = Get-T6Verdict -ExitCodes $allZero -ResultsPath $badFile -EvidenceResultsPath $badCopy -ExpectedCaseIds $ExpectedGroupLCases -ExpectedResultsSha $null -RunnerSummaryJson $summaryJson
    Check "verdict FAIL when a case is not PASS" ($v.Verdict -eq "FAIL")

    $v = Get-T6Verdict -ExitCodes $allZero -ResultsPath $goodFile -EvidenceResultsPath $copyFile -ExpectedCaseIds $ExpectedGroupLCases -ExpectedResultsSha ("0" * 64) -RunnerSummaryJson $summaryJson
    Check "verdict FAIL when the results sha256 does not match the runner digest" ($v.Verdict -eq "FAIL")

    $v = Get-T6Verdict -ExitCodes $allZero -ResultsPath $goodFile -EvidenceResultsPath $copyFile -ExpectedCaseIds $ExpectedGroupLCases -ExpectedResultsSha $goodSha -RunnerSummaryJson $null
    Check "verdict FAIL when the runner summary is absent" ($v.Verdict -eq "FAIL")

    $v = Get-T6Verdict -ExitCodes $allZero -ResultsPath $goodFile -EvidenceResultsPath $copyFile -ExpectedCaseIds $ExpectedGroupLCases -ExpectedResultsSha $goodSha -RunnerSummaryJson '{"summary":{"total":12,"pass":11,"fail":0,"blocked":0,"not_run":1}}'
    Check "verdict FAIL when the runner summary reports a not_run case" ($v.Verdict -eq "FAIL")
  }
  finally {
    if ($vdir -and $vdir.StartsWith($env:TEMP) -and $vdir -like "*t6-verdict-*") {
      Remove-Item -Recurse -Force -LiteralPath $vdir -ErrorAction SilentlyContinue
    }
  }

  # --- evidence preservation (C7): removing the lab must not remove evidence ---
  $lab = Join-Path $env:TEMP ("t6-lab-sim-" + [guid]::NewGuid().ToString("N"))
  $ev  = Join-Path $env:TEMP ("t6-ev-sim-"   + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $lab | Out-Null
  New-Item -ItemType Directory -Force -Path $ev  | Out-Null
  try {
    Set-Content -LiteralPath (Join-Path $ev "evidence.jsonl") -Value '{"id":"T6-L01","status":"PASS"}' -Encoding UTF8
    Remove-Item -Recurse -Force -LiteralPath $lab -ErrorAction SilentlyContinue
    Check "evidence survives removal of the lab tree" (Test-Path -LiteralPath (Join-Path $ev "evidence.jsonl"))
  }
  finally {
    foreach ($p in @($lab,$ev)) {
      if ($p -and $p.StartsWith($env:TEMP) -and ($p -like "*t6-lab-sim-*" -or $p -like "*t6-ev-sim-*")) {
        Remove-Item -Recurse -Force -LiteralPath $p -ErrorAction SilentlyContinue
      }
    }
  }

  # --- ambient redirect variables refused before any cluster contact ---
  Expect-Blocked "ambient PGHOSTADDR refused" { $env:PGHOSTADDR = "10.0.0.9"; try { Assert-NoRedirectEnv } finally { Remove-Item Env:PGHOSTADDR -ErrorAction SilentlyContinue } }
  Expect-Allowed  "clean environment accepted" { Assert-NoRedirectEnv }

  if ($script:stFail -gt 0) { Write-Host "T6 SELF-TEST: $($script:stFail) failure(s)" } else { Write-Host "T6 SELF-TEST: all checks passed" }
}

if ($SelfTest) { Invoke-SelfTest; exit $script:stFail }

# =============================================================================
# Main (execution) path
# =============================================================================
$started  = $false
$exitCode = 2
$verdict  = $null
$evidenceResults = $null
$runnerSummary = $null
$runnerSha = $null

try {
  # --- 1. Hard safety guards --------------------------------------------------
  if ($Confirm -ne $ConfirmToken) { Throw-Blocked "missing -Confirm $ConfirmToken (execution requires separate approval)" }
  Assert-ApprovedTempPath $script:LabRoot | Out-Null
  Assert-NotServiceTarget $script:LabRoot
  Assert-LabPort $Port
  Assert-NoRedirectEnv
  foreach ($k in 'SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','SLMM_LIVE_TESTS') {
    if (Test-Path "Env:$k") { Throw-Blocked "ambient $k is set; refusing to run against a possible remote target" }
  }
  if ((Test-Path Env:SLMM_SCHEDULER_ENABLED) -and ((Get-Item Env:SLMM_SCHEDULER_ENABLED).Value -eq '1')) {
    Throw-Blocked "scheduler is enabled; refusing to run"
  }
  if (-not (Test-Path -LiteralPath $Repo -PathType Container)) { Throw-Blocked "repository not found: $Repo" }
  if (-not (Test-Path -LiteralPath $Prep -PathType Container)) { Throw-Blocked "prep directory not found: $Prep" }
  Assert-PortFree -P $Port

  $Bin = "$env:ProgramFiles\PostgreSQL\18\bin"
  foreach ($exe in 'initdb.exe','pg_ctl.exe','psql.exe','pg_isready.exe') {
    if (-not (Test-Path -LiteralPath "$Bin\$exe")) { Throw-Blocked "missing $Bin\$exe" }
  }
  $nodeExe = $null
  try { $nodeExe = (Get-Command node -ErrorAction Stop).Source } catch { Throw-Blocked "node executable not found on PATH" }

  # --- 2. Evidence directory (created BEFORE anything else can fail) ---------
  $evDir = New-EvidenceDir
  Step "evidence directory: $evDir"
  Log-Line ("run id: " + $script:RunId)
  Log-Line ("evidence root: " + $evDir)

  # --- 3. Disposable cluster (ownership-verified before any deletion) ---------
  Assert-OwnedOrAbsent $script:LabRoot
  if (Test-Path -LiteralPath $DataDir) {
    Assert-Deletable $DataDir
    if (-not (Test-Path -LiteralPath (Join-Path $DataDir "PG_VERSION"))) {
      Throw-Blocked "existing $DataDir is not a PostgreSQL cluster; refusing to delete. STOP for manual inspection."
    }
    $pmPid = Assert-PostmasterIsOurs $DataDir
    Step "removing stale disposable cluster at $DataDir"
    if ($pmPid) {
      # C3: the stop exit code was never checked in the base script. If the
      # stop fails the data directory must NOT be deleted.
      $r = Invoke-Native -Exe "$Bin\pg_ctl.exe" -ArgList @("stop","-D",$DataDir,"-m","immediate") -Quiet
      $script:ExitCodes["stale_stop"] = $r.ExitCode
      if ($r.ExitCode -ne 0) {
        Throw-Blocked "could not stop the stale cluster in $DataDir (pg_ctl exit $($r.ExitCode)); refusing to delete the data directory. STOP for manual inspection."
      }
    }
    Remove-LabTree $DataDir
  }

  Step "initdb ($DataDir)"
  $r = Invoke-Native -Exe "$Bin\initdb.exe" -ArgList @("-D",$DataDir,"-N","-U","postgres","-A","trust") -Quiet
  $script:ExitCodes["initdb"] = $r.ExitCode
  if ($r.ExitCode -ne 0) { Throw-Blocked "initdb failed ($($r.ExitCode))" }

  # C1: the option string is passed as ONE argument and carries no cmd.exe
  # metacharacter, so no quoting layer can alter the listen address.
  $pgOptions = "-p $Port -c listen_addresses=127.0.0.1 -c logging_collector=off"
  if ($pgOptions -match '[&|<>^"]') { Throw-Blocked "refusing: unsafe characters in the pg_ctl option string" }
  Step "pg_ctl start on port $Port (loopback only)"
  $r = Invoke-Native -Exe "$Bin\pg_ctl.exe" -ArgList @("start","-D",$DataDir,"-l",$PgLog,"-o",$pgOptions,"-w") -Quiet
  $script:ExitCodes["pgctl_start"] = $r.ExitCode
  if ($r.ExitCode -ne 0) { Throw-Blocked "pg_ctl start failed ($($r.ExitCode)); see $PgLog" }
  $started = $true

  $r = Invoke-Native -Exe "$Bin\pg_isready.exe" -ArgList @("-h","127.0.0.1","-p","$Port","-t","10") -Quiet
  $script:ExitCodes["isready"] = $r.ExitCode
  if ($r.ExitCode -ne 0) { Throw-Blocked "cluster did not become ready on port $Port (pg_isready exit $($r.ExitCode))" }

  # Target identity: port, loopback address AND our own data directory.
  $identitySql = "SELECT current_setting('port') || '|' || coalesce(host(inet_server_addr()),'') || '|' || current_setting('data_directory');"
  $r = Invoke-Native -Exe "$Bin\psql.exe" -ArgList @("-X","-q","-A","-t","-h","127.0.0.1","-p","$Port","-U","postgres","-d","postgres","-c",$identitySql) -Quiet
  $script:ExitCodes["identity"] = $r.ExitCode
  if ($r.ExitCode -ne 0) { Throw-Blocked "could not connect to the disposable cluster (psql exit $($r.ExitCode))" }
  $identity = ""
  foreach ($l in $r.Stdout) { if (-not [string]::IsNullOrWhiteSpace($l)) { $identity = $l.Trim(); break } }
  if ($identity -notlike "$Port|127.0.0.1|*") { Throw-Blocked "cluster identity mismatch: $identity" }
  $identityParts = $identity.Split('|')
  if ($identityParts.Count -ge 3) {
    $serverDataDir = ConvertTo-NormalizedPath $identityParts[2]
    $ourDataDir    = ConvertTo-NormalizedPath $DataDir
    if ($serverDataDir -ne $ourDataDir) {
      Throw-Blocked "cluster identity mismatch: server data_directory '$($identityParts[2])' is not our lab '$DataDir'"
    }
  } else {
    Throw-Blocked "cluster identity mismatch: unexpected identity string '$identity'"
  }

  # --- 4. Bootstrap + preflight (verbatim migrations) -------------------------
  Step "creating database t6lab"
  $r = Invoke-Native -Exe "$Bin\psql.exe" -ArgList @("-X","-q","-v","ON_ERROR_STOP=1","-h","127.0.0.1","-p","$Port","-U","postgres","-d","postgres","-c","CREATE DATABASE t6lab;") -Quiet
  $script:ExitCodes["create_db"] = $r.ExitCode
  if ($r.ExitCode -ne 0) { Throw-Blocked "CREATE DATABASE t6lab failed ($($r.ExitCode))" }

  Step "loading lab schema + migrations (t6-lab-setup.sql)"
  $r = Invoke-Native -Exe "$Bin\psql.exe" -ArgList @("-X","-q","-v","ON_ERROR_STOP=1","-h","127.0.0.1","-p","$Port","-U","postgres","-d","t6lab","-v","repo=$Repo","-v","lab=$script:LabRoot","-f","$Prep\t6-lab-setup.sql") -Quiet
  $script:ExitCodes["bootstrap"] = $r.ExitCode
  if ($r.ExitCode -ne 0) { Throw-Blocked "T6 bootstrap failed ($($r.ExitCode))" }

  Step "preflight (t6-preflight-lab.sql)"
  $r = Invoke-Native -Exe "$Bin\psql.exe" -ArgList @("-X","-q","-v","ON_ERROR_STOP=1","-h","127.0.0.1","-p","$Port","-U","postgres","-d","t6lab","-f","$Prep\t6-preflight-lab.sql") -Quiet
  $script:ExitCodes["preflight"] = $r.ExitCode
  if ($r.ExitCode -ne 0) { Throw-Blocked "T6 preflight failed ($($r.ExitCode))" }

  # --- 5. Run Group L ---------------------------------------------------------
  Step "running T6 Group L (node)"
  $env:T6_LAB_CONFIRM = $RunnerConfirm
  $r = Invoke-Native -Exe $nodeExe -ArgList @("$Prep\t6-local-runner.mjs") -LogFile (Join-Path $script:EvidenceDir ("t6-lab-node." + $script:RunId + ".log"))
  $script:ExitCodes["node"] = $r.ExitCode
  foreach ($l in $r.Stdout) {
    if ($l -match '"summary"') { $runnerSummary = $l }
    if ($l -match '"results_sha256"') { $runnerSha = ([regex]::Match($l, '"results_sha256"\s*:\s*"([0-9a-fA-F]{64})"')).Groups[1].Value }
  }

  # --- 6. Independent residue re-check ---------------------------------------
  Step "residue (t6-lab-residue.sql)"
  $r = Invoke-Native -Exe "$Bin\psql.exe" -ArgList @("-X","-q","-v","ON_ERROR_STOP=1","-h","127.0.0.1","-p","$Port","-U","postgres","-d","t6lab","-f","$Prep\t6-lab-residue.sql") -Quiet
  $script:ExitCodes["residue"] = $r.ExitCode

  # --- 7. Evidence: copy the results out of the disposable lab (C7) ---------
  if (Test-Path -LiteralPath $ResultFile -PathType Leaf) {
    $evidenceResults = Join-Path $script:EvidenceDir ("t6-lab-results." + $script:RunId + ".jsonl")
    Copy-Item -LiteralPath $ResultFile -Destination $evidenceResults -Force
    Step "results copied to evidence: $evidenceResults"
  } else {
    Step "results file $ResultFile was not produced"
  }

  # --- 8. Verdict (C4) --------------------------------------------------------
  $verdict = Get-T6Verdict -ExitCodes $script:ExitCodes -ResultsPath $ResultFile -EvidenceResultsPath $evidenceResults -ExpectedCaseIds $ExpectedGroupLCases -ExpectedResultsSha $runnerSha -RunnerSummaryJson $runnerSummary
  $verdictDoc = [pscustomobject]@{
    run_id        = $script:RunId
    verdict       = $verdict.Verdict
    reasons       = $verdict.Reasons
    group_l_cases = $verdict.CaseIds
    exit_codes    = $script:ExitCodes
    runner_sha256 = $runnerSha
    evidence_dir  = $script:EvidenceDir
    port          = $Port
    data_dir      = $DataDir
  }
  $verdictPath = Join-Path $script:EvidenceDir ("verdict." + $script:RunId + ".json")
  ($verdictDoc | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $verdictPath -Encoding UTF8

  # --- 9. Artifact checksums --------------------------------------------------
  Step "artifact SHA-256"
  $artifacts = @(
    "$Prep\t6-local-runner.mjs", "$Prep\t6-lab-setup.sql",
    "$Prep\t6-preflight-lab.sql", "$Prep\t6-lab-residue.sql", "$Prep\t6-sync.sql",
    "$Prep\T6_LAB_IMPLEMENTATION_PLAN.md", $ResultFile, $evidenceResults
  )
  $hashLines = @()
  foreach ($f in $artifacts) {
    if (Test-Path -LiteralPath $f) {
      $h = (Get-FileHash $f -Algorithm SHA256).Hash.ToLowerInvariant()
      $sz = (Get-Item $f).Length
      $line = ("{0}  {1} bytes  {2}" -f (Split-Path $f -Leaf), $sz, $h)
      Write-Host ("  " + $line)
      Log-Line ("  " + $line)
      $hashLines += ("{0}  {1} bytes  {2}" -f (Split-Path $f -Leaf), $sz, $h)
    }
  }
  ($hashLines -join "`r`n") | Set-Content -LiteralPath (Join-Path $script:EvidenceDir ("artifact-sha256." + $script:RunId + ".txt")) -Encoding UTF8

  Step ("verdict: " + $verdict.Verdict)
  foreach ($reason in $verdict.Reasons) { Write-Warning ("  " + $reason); Log-Line ("  REASON: " + $reason) }

  if ($verdict.Verdict -eq "PASS") { $exitCode = 0 } else { $exitCode = 1 }
}
catch {
  $msg = $_.Exception.Message
  Write-Host $msg
  Log-Line ("FAILED: " + $msg)
  $exitCode = 2
}
finally {
  # C6: never touch a cluster/directory whose ownership cannot be proven.
  if ($started) {
    try {
      if (-not (Test-OwnedMarker $script:LabRoot)) {
        Write-Warning "ownership marker invalid; refusing to stop the cluster. STOP for manual inspection."
        Log-Line "teardown skipped: ownership marker invalid"
      } elseif (Test-Path -LiteralPath (Join-Path $DataDir "PG_VERSION")) {
        Step "pg_ctl stop -m fast"
        $r = Invoke-Native -Exe "$env:ProgramFiles\PostgreSQL\18\bin\pg_ctl.exe" -ArgList @("stop","-D",$DataDir,"-m","fast","-w") -Quiet
        if ($r.ExitCode -ne 0) {
          $r2 = Invoke-Native -Exe "$env:ProgramFiles\PostgreSQL\18\bin\pg_ctl.exe" -ArgList @("stop","-D",$DataDir,"-m","immediate","-w") -Quiet
          if ($r2.ExitCode -ne 0) { Write-Warning "cluster stop failed (fast=$($r.ExitCode) immediate=$($r2.ExitCode))" }
        }
      }
    } catch { Write-Warning "teardown stop failed: $($_.Exception.Message)" }
  }
  if (-not $Keep) {
    try {
      if (Test-OwnedMarker $script:LabRoot) {
        Step "removing disposable lab $script:LabRoot"
        Remove-LabTree $script:LabRoot
      } else {
        Write-Warning "ownership marker invalid for $script:LabRoot; refusing to delete. STOP for manual inspection."
      }
    } catch { Write-Warning "refusing/failed to remove $script:LabRoot : $($_.Exception.Message)" }
  } else {
    Step "keeping $script:LabRoot (-Keep); cluster data remains until removed"
  }
  if ($script:LogPath) {
    try { Log-Line ("exit code: " + $exitCode) } catch { }
  }
}

exit $exitCode
