# =============================================================================
# T6 LOCAL LAB ORCHESTRATOR (Windows / PowerShell)  --  NOT EXECUTED.
# Brings up the disposable PostgreSQL 18 cluster on the isolated loopback port,
# loads the lab schema + the four committed migrations verbatim, runs the
# Group-L concurrency runner, checks residue, then guarantees cluster shutdown.
#
# Execution is gated:  -Confirm I_APPROVE_LOCAL_T6
# It never references port 5432, Supabase, Cloudflare, R2 or production, and it
# never writes to the repository.
#
# SAFETY MODEL (fail closed)
#  * The port (15432), repository path, preparation directory and laboratory root
#    are fixed constants. There are no -Port/-Repo/-Prep/-LabRoot overrides, so
#    the destructive targets cannot be redirected.
#  * The laboratory root must live inside the exact approved %TEMP% namespace
#    (<...>\AppData\Local\Temp\opencode\t6lab); substring matches are rejected.
#  * Every directory is protected by a run-ownership marker (T6LAB_OWNER). A
#    pre-existing directory without a valid marker is refused, never deleted.
#  * All recursive deletion is confined to the lab root and is preceded by both
#    a namespace check and an ownership-marker check.
#  * If port 15432 is already listening, the run is BLOCKED: nothing is connected
#    to or terminated.
#  * Ambient libpq redirect variables (PGHOSTADDR, PGSERVICE, PGOPTIONS, ...) are
#    refused before any PostgreSQL child process is launched.
#
# C6 HARD-KILL RECOVERY
#  * There is no automatic cleanup of unknown clusters. If a previous run was
#    interrupted (hard kill) and ownership of <TEMP>\opencode\t6lab cannot be
#    proven, this script refuses to stop or delete anything and exits BLOCKED.
#    STOP and inspect manually. Never terminate arbitrary PostgreSQL processes
#    and never delete a data directory whose ownership marker is absent or
#    mismatched.
#
# Usage (only after separate approval):
#   powershell -File t6-runner.ps1 -Confirm I_APPROVE_LOCAL_T6
#   powershell -File t6-runner.ps1 -SelfTest        # static guards, no cluster
# =============================================================================
[CmdletBinding()]
param(
  [switch]$Keep,
  [string]$Confirm,
  [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# --- Fixed, non-overridable configuration ------------------------------------
$Port = 15432
$Repo = "D:\DevProjects\Working\srilakshmimangalyamalai(boyar-bond-forge-main)"
$MarkerName = "T6LAB_OWNER"
$MarkerContent = "slmm-t6-disposable-lab"
$ApprovedSuffix = "\AppData\Local\Temp\opencode\t6lab"

$script:stFail = 0

function Throw-Blocked([string]$m) { throw "T6 BLOCKED: $m" }
function Step([string]$m) { Write-Host "[T6] $m" }
function Test-Throws([scriptblock]$Fn) { try { & $Fn; return $false } catch { return $true } }

# --- Path / ownership guards (C3, C4) ----------------------------------------
function Assert-ApprovedTempPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { Throw-Blocked "empty laboratory path" }
  if (-not [IO.Path]::IsPathRooted($Path)) { Throw-Blocked "laboratory path is not absolute: $Path" }
  $full = [IO.Path]::GetFullPath($Path)
  if ($full -match '\.\.') { Throw-Blocked "laboratory path contains traversal: $full" }
  if (-not $full.ToLowerInvariant().EndsWith($ApprovedSuffix.ToLowerInvariant())) {
    Throw-Blocked "path is not inside the approved TEMP namespace: $full"
  }
  return $full
}

function Get-ApprovedLabRoot {
  if ([string]::IsNullOrWhiteSpace($env:TEMP)) { Throw-Blocked "TEMP is not set" }
  return (Assert-ApprovedTempPath (Join-Path $env:TEMP "opencode\t6lab"))
}

function Get-MarkerPath([string]$Dir) { Join-Path $Dir $MarkerName }

function Test-OwnedMarker([string]$Dir) {
  $f = Get-MarkerPath $Dir
  if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { return $false }
  try { return ((Get-Content -LiteralPath $f -Raw -ErrorAction Stop) -like "*$MarkerContent*") }
  catch { return $false }
}

function Add-OwnershipMarker([string]$Dir) {
  $content = "{0}`nrun={1}`npid={2}`ncreated={3}" -f $MarkerContent, ([guid]::NewGuid().ToString("N")), $PID, (Get-Date -Format o)
  Set-Content -LiteralPath (Get-MarkerPath $Dir) -Value $content -Encoding UTF8
}

# Create the lab root only after path verification; refuse an unowned pre-existing dir.
function Assert-OwnedOrAbsent([string]$Dir) {
  Assert-ApprovedTempPath $Dir | Out-Null
  if (Test-Path -LiteralPath $Dir -PathType Container) {
    if (-not (Test-OwnedMarker $Dir)) {
      Throw-Blocked "refusing: $Dir exists but is not owned by a verified T6 run (missing/invalid $MarkerName). STOP for manual inspection."
    }
    return
  }
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  Add-OwnershipMarker $Dir
}

# Recursive deletion is allowed only inside the lab root with a valid marker.
function Assert-Deletable([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  $lab = [IO.Path]::GetFullPath($script:LabRoot).TrimEnd('\')
  if ($full -ne $lab -and -not $full.StartsWith($lab + '\')) {
    Throw-Blocked "refusing to delete outside the lab namespace: $full"
  }
  if (-not (Test-OwnedMarker $script:LabRoot)) {
    Throw-Blocked "lab ownership marker missing/invalid; refusing to delete $full"
  }
}

function Remove-LabTree([string]$Path) {
  Assert-Deletable $Path
  Remove-Item -Recurse -Force -LiteralPath $Path -ErrorAction Stop
}

# --- Port guard (never connects to or terminates the existing listener) ------
function Assert-PortFree([int]$P, [switch]$UseInjection, [bool]$InjectedListener = $false) {
  $listeners = @()
  if ($UseInjection) {
    if ($InjectedListener) { $listeners = @("injected") }
  } else {
    $listeners = @(Get-NetTCPConnection -LocalPort $P -ErrorAction SilentlyContinue)
  }
  if ($listeners.Count -gt 0) {
    Throw-Blocked "port $P is already in use; refusing to connect to or terminate it"
  }
}

# --- Resolved constants -------------------------------------------------------
$script:LabRoot = Get-ApprovedLabRoot
$Prep = Join-Path (Split-Path $script:LabRoot -Parent) "t6-prep"   # <TEMP>\opencode\t6-prep
$DataDir = Join-Path $script:LabRoot "data"
$PgLog = Join-Path $script:LabRoot "pg.log"
$ResultFile = Join-Path $script:LabRoot "t6-lab-results.jsonl"

# =============================================================================
# Static negative self-test (point 10). Creates no database connection, starts
# no cluster and touches the filesystem only inside a disposable temp sandbox.
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

  # Existing listener on port 15432 -> BLOCKED (injected probe).
  Expect-Blocked "existing listener on 15432 -> BLOCKED" { Assert-PortFree -P 15432 -UseInjection -InjectedListener $true }
  Expect-Allowed "free 15432 accepted" { Assert-PortFree -P 15432 -UseInjection -InjectedListener $false }

  # Unsafe LabRoot / path overrides.
  Expect-Blocked "unsafe LabRoot (C:\Windows\t6lab) refused" { Assert-ApprovedTempPath "C:\Windows\t6lab" }
  Expect-Blocked "relative LabRoot refused" { Assert-ApprovedTempPath "t6lab" }
  Expect-Blocked "substring-sibling (t6lab2) refused" { Assert-ApprovedTempPath "C:\Users\x\AppData\Local\Temp\opencode\t6lab2" }
  Expect-Blocked "traversal LabRoot refused" { Assert-ApprovedTempPath "C:\Users\x\AppData\Local\Temp\opencode\t6lab\..\evil" }
  Expect-Blocked "wrong TEMP branch refused" { Assert-ApprovedTempPath "C:\Users\x\AppData\Local\Temp\t6lab" }
  Expect-Allowed "approved LabRoot accepted" { Assert-ApprovedTempPath $script:LabRoot }

  # Ownership marker: missing / mismatched refused; valid recognized.
  $tmp = Join-Path $env:TEMP ("t6st-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  try {
    Check "unowned directory has no marker" (-not (Test-OwnedMarker $tmp))
    Add-OwnershipMarker $tmp
    Check "valid ownership marker recognized" (Test-OwnedMarker $tmp)
    Set-Content -LiteralPath (Get-MarkerPath $tmp) -Value "some-other-lab" -Encoding UTF8
    Check "mismatched ownership marker refused" (-not (Test-OwnedMarker $tmp))
  } finally {
    Remove-Item -Recurse -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
  }
  Expect-Blocked "delete outside lab namespace refused" { Assert-Deletable (Join-Path $env:TEMP "t6st-outside") }
  Expect-Blocked "pre-existing unowned lab root refused" {
    $u = Join-Path $env:TEMP ("t6st-owned-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $u | Out-Null
    try { Assert-OwnedOrAbsent $u } finally { Remove-Item -Recurse -Force -LiteralPath $u -ErrorAction SilentlyContinue }
  }

  # Ambient redirect variables refused before any cluster contact.
  Expect-Blocked "ambient PGHOSTADDR refused" { $env:PGHOSTADDR = "10.0.0.9"; try { Assert-NoRedirectEnv } finally { Remove-Item Env:PGHOSTADDR -ErrorAction SilentlyContinue } }
  Expect-Allowed "clean environment accepted" { Assert-NoRedirectEnv }

  if ($script:stFail -gt 0) { Write-Host "T6 SELF-TEST: $($script:stFail) failure(s)" } else { Write-Host "T6 SELF-TEST: all checks passed" }
}

function Assert-NoRedirectEnv {
  foreach ($k in 'PGHOSTADDR','PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGSYSCONFDIR','PGOPTIONS','PGPASSFILE','PGSSLMODE','PGCONNECT_TIMEOUT','PGCLIENTENCODING') {
    if (Test-Path "Env:$k") {
      $v = (Get-Item "Env:$k").Value
      if ($null -ne $v -and "$v" -ne "") { Throw-Blocked "ambient $k is set; refusing (possible connection redirection)" }
    }
  }
}

if ($SelfTest) { Invoke-SelfTest; exit $script:stFail }

# =============================================================================
# Main (execution) path.
# =============================================================================
$started = $false
try {
  # --- 1. Hard safety guards --------------------------------------------------
  if ($Confirm -ne "I_APPROVE_LOCAL_T6") { Throw-Blocked "missing -Confirm I_APPROVE_LOCAL_T6 (execution requires separate approval)" }
  Assert-ApprovedTempPath $script:LabRoot | Out-Null
  Assert-NoRedirectEnv
  foreach ($k in 'SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','SLMM_LIVE_TESTS') {
    if (Test-Path "Env:$k") { Throw-Blocked "ambient $k is set; refusing to run against a possible remote target" }
  }
  if ($env:SLMM_SCHEDULER_ENABLED -eq '1') { Throw-Blocked "scheduler is enabled; refusing to run" }
  if (-not (Test-Path -LiteralPath $Repo)) { Throw-Blocked "repository not found: $Repo" }
  if (-not (Test-Path -LiteralPath $Prep)) { Throw-Blocked "prep directory not found: $Prep" }
  Assert-PortFree -P $Port

  $Bin = "$env:ProgramFiles\PostgreSQL\18\bin"
  foreach ($exe in 'initdb.exe','pg_ctl.exe','psql.exe','pg_isready.exe') {
    if (-not (Test-Path -LiteralPath "$Bin\$exe")) { Throw-Blocked "missing $Bin\$exe" }
  }
  $Psql = "$Bin\psql.exe"; $PgCtl = "$Bin\pg_ctl.exe"; $InitDb = "$Bin\initdb.exe"; $IsReady = "$Bin\pg_isready.exe"

  # --- 2. Disposable cluster (ownership-verified before any deletion) ---------
  Assert-OwnedOrAbsent $script:LabRoot
  if (Test-Path -LiteralPath $DataDir) {
    Assert-Deletable $DataDir
    if (-not (Test-Path -LiteralPath (Join-Path $DataDir "PG_VERSION"))) {
      Throw-Blocked "existing $DataDir is not a PostgreSQL cluster; refusing to delete. STOP for manual inspection."
    }
    Step "removing stale disposable cluster at $DataDir"
    & $PgCtl stop -D $DataDir -m immediate 2>$null | Out-Null
    Remove-LabTree $DataDir
  }

  Step "initdb ($DataDir)"
  & $InitDb -D $DataDir -N -U postgres -A trust | Out-Null
  if ($LASTEXITCODE -ne 0) { Throw-Blocked "initdb failed ($LASTEXITCODE)" }

  Step "pg_ctl start on port $Port (loopback only)"
  & $PgCtl start -D $DataDir -l $PgLog -o "-p $Port -c listen_addresses='127.0.0.1' -c logging_collector=off" -w | Out-Null
  if ($LASTEXITCODE -ne 0) { Throw-Blocked "pg_ctl start failed ($LASTEXITCODE); see $PgLog" }
  $started = $true

  & $IsReady -h 127.0.0.1 -p $Port -t 10 | Out-Null
  if ($LASTEXITCODE -ne 0) { Throw-Blocked "cluster did not become ready on port $Port" }

  # Sanity: the disposable cluster answers on 15432 as the expected server.
  $srv = & $Psql -X -q -A -t -h 127.0.0.1 -p $Port -U postgres -d postgres -c "SELECT current_setting('port') || '|' || coalesce(host(inet_server_addr()),'') || '|' || current_setting('data_directory');"
  if ($LASTEXITCODE -ne 0) { Throw-Blocked "could not connect to the disposable cluster" }
  if (("$srv").Trim() -notlike "$Port|127.0.0.1|*") { Throw-Blocked "cluster identity mismatch: $srv" }

  # --- 3. Bootstrap + preflight (verbatim migrations) -------------------------
  Step "creating database t6lab"
  & $Psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $Port -U postgres -d postgres -c "CREATE DATABASE t6lab;" | Out-Null
  if ($LASTEXITCODE -ne 0) { Throw-Blocked "CREATE DATABASE t6lab failed" }

  Step "loading lab schema + migrations (t6-lab-setup.sql)"
  & $Psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $Port -U postgres -d t6lab -v repo="$Repo" -v lab="$script:LabRoot" -f "$Prep\t6-lab-setup.sql"
  if ($LASTEXITCODE -ne 0) { Throw-Blocked "T6 bootstrap failed ($LASTEXITCODE)" }

  Step "preflight (t6-preflight-lab.sql)"
  & $Psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $Port -U postgres -d t6lab -f "$Prep\t6-preflight-lab.sql"
  if ($LASTEXITCODE -ne 0) { Throw-Blocked "T6 preflight failed ($LASTEXITCODE)" }

  # --- 4. Run Group L ---------------------------------------------------------
  Step "running T6 Group L (node)"
  $env:T6_LAB_CONFIRM = "I_APPROVE_LOCAL_T6"
  & node "$Prep\t6-local-runner.mjs" 2>&1 | Tee-Object -FilePath "$script:LabRoot\t6-lab-run.log"
  $runExit = $LASTEXITCODE

  # --- 5. Independent residue re-check ---------------------------------------
  Step "residue (t6-lab-residue.sql)"
  & $Psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $Port -U postgres -d t6lab -f "$Prep\t6-lab-residue.sql"
  $resExit = $LASTEXITCODE

  # --- 6. Hashes --------------------------------------------------------------
  Step "artifact SHA-256"
  $artifacts = @(
    "$Prep\t6-local-runner.mjs", "$Prep\t6-runner.ps1", "$Prep\t6-lab-setup.sql",
    "$Prep\t6-preflight-lab.sql", "$Prep\t6-lab-residue.sql", "$Prep\t6-sync.sql",
    "$Prep\T6_LAB_IMPLEMENTATION_PLAN.md", $ResultFile
  )
  foreach ($f in $artifacts) {
    if (Test-Path -LiteralPath $f) {
      $h = (Get-FileHash $f -Algorithm SHA256).Hash.ToLower()
      Write-Host ("  {0}  {1} bytes  {2}" -f (Split-Path $f -Leaf), (Get-Item $f).Length, $h)
    }
  }

  if ($runExit -ne 0) { Write-Warning "T6 runner reported failures (exit $runExit)" }
  if ($resExit -ne 0) { Write-Warning "T6 residue reported residual state (exit $resExit)" }
  if ($runExit -ne 0 -or $resExit -ne 0) { exit 1 }
}
catch {
  Write-Host $_.Exception.Message
  exit 2
}
finally {
  # C6: never touch a cluster/directory whose ownership cannot be proven.
  if ($started) {
    try {
      if (-not (Test-OwnedMarker $script:LabRoot)) {
        Write-Warning "ownership marker invalid; refusing to stop the cluster. STOP for manual inspection."
      } elseif (Test-Path -LiteralPath (Join-Path $DataDir "PG_VERSION")) {
        Step "pg_ctl stop -m fast"
        & $PgCtl stop -D $DataDir -m fast -w 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { & $PgCtl stop -D $DataDir -m immediate 2>$null | Out-Null }
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
}
