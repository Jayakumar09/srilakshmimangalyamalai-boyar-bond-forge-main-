# =============================================================================
# T6 LOCAL LAB ORCHESTRATOR -- CORRECTED CANDIDATE v3 (Windows / PowerShell 5.1)
#
# STATUS: CANDIDATE v3 -- NOT EXECUTION-APPROVED, NOT EXECUTED.
#
# Derived from candidate v2
#   t6-runner-candidate-v2.ps1  SHA-256 b5a90be2198b186a009971342155e6e4f5ba54cf5f66455d2e8d4bef9d655bce
# (54620 bytes), which lives unchanged at test-harness/t6-checkpoint/.
# This file does NOT overwrite v1, v2, or the original recovered wrapper
# t6-runner.ps1 (SHA-256 fac7926d...0894c).
#
# -----------------------------------------------------------------------------
# WHAT v3 CHANGES relative to v2
# -----------------------------------------------------------------------------
# C2c  BOUNDED output capture.
#      v2 copied the child's stdout/stderr into an UNBOUNDED MemoryStream
#      (via CopyToAsync into unbounded MemoryStreams).
#      Because a daemonised descendant inherits the write end of the pipe,
#      that copy task stays pending for as long as the descendant lives, and
#      the buffer grew at the descendant's output rate (measured ~1.3 MB/s)
#      with no cap -- an unbounded-allocation path in the wrapper itself.
#      v3 copies into a BOUNDED sink: at most $NativeMaxCaptureBytes are
#      RETAINED per stream, the remainder is DISCARDED (counted), and the
#      child is still drained completely so it can never block on a full pipe.
#      stdout and stderr are bounded INDEPENDENTLY. Truncation is reported
#      explicitly in the result object and in the evidence log. The real
#      native exit code is unchanged.
#
# C2d  Reader cancellation and safe disposal.
#      v2 disposed the MemoryStream while the copy task could still be
#      writing to it, so the write end faulted on the disposed buffer and
#      the exception was UNOBSERVED; bytes read after the snapshot were
#      lost. v3 ends the reader task BEFORE disposing the sink and only then
#      disposes it. If the task still has not finished, the sink is
#      deliberately NOT disposed (disposing it would recreate the v2 defect);
#      it is left to the garbage collector and the condition is reported.
#
#      Ending the reader task is not as simple as closing the stream: a read
#      that is already pending on an INHERITED pipe handle is NOT interrupted
#      by closing, disposing or cancelling the .NET read -- it stays blocked
#      and its copy task never reaches a terminal state (measured on this
#      machine: still WaitingForActivation after 3 s, and the stream was
#      still blocked after the owning Process was disposed).
#      v3 therefore cancels the pending OVERLAPPED operation with
#      CancelIoEx on the pipe handle, which does interrupt it (measured:
#      terminal in 23-53 ms with status Canceled). The stream is closed
#      afterwards so the handle is released. If the cancellation is not
#      available the close still happens, the still-running reader is
#      detected, and the buffer is left undisposed.
#
# C2e  Timeout cleanup for `pg_ctl start`, with positive ownership proof.
#      v2 killed only the DIRECT child on timeout (Process.Kill() does not
#      reach descendants), and the main path set $started = $true only AFTER
#      a successful start, so a timed-out or failed start left any postmaster
#      that had actually come up completely unmanaged -- and the teardown then
#      deleted the lab data directory while that PostgreSQL process could
#      still have been using it.
#      v3 marks the start as ATTEMPTED before issuing it, and the teardown
#      always INSPECTS the disposable laboratory afterwards. A process is
#      stopped ONLY when its ownership is positively proven: the ownership
#      marker must be valid, the postmaster.pid must live in OUR canonical
#      data directory, the recorded port must be 15432, the process must
#      still be alive, and it must be a postgres.exe whose command line
#      names our data directory. A process is NEVER stopped merely because it
#      listens on port 15432, and the port-5432 service is never touched.
#      If ownership cannot be established the evidence is preserved, the run
#      is reported BLOCKED, and the uncertain process is left untouched.
#      The lab data directory is never deleted while a potentially active
#      PostgreSQL process remains.
#
# C2f  A truncated or incomplete capture can never yield PASS.
#      The Group-L runner's stdout carries the `summary` line and the
#      `results_sha256` digest, and BOTH are emitted near the END of the
#      runner's output. A capture that is truncated (because the 4 MB cap was
#      reached) or incomplete (because a reader task had not finished) can
#      therefore silently remove exactly the two values the verdict depends
#      on -- while the native exit code is still 0.
#      v3 makes both conditions HARD FAILURES:
#        * the Node step throws T6 BLOCKED if the capture was truncated on
#          either stream or was incomplete, so no verdict is issued at all;
#        * Get-T6Verdict REQUIRES a non-empty, well-formed 64-hex-digit
#          digest from the runner and requires the evidence copy to match it.
#          A missing or malformed digest is a failure reason, never a skipped
#          check.
#      The evidence byte-identity and checksum comparisons are preserved
#      unchanged and are still evaluated in addition to the digest check.
#
# -----------------------------------------------------------------------------
# WHAT v1 GOT WRONG (observed 2026-10-20) AND WHAT v2 CHANGED -- CARRIED OVER
# -----------------------------------------------------------------------------
# C2b  Native output capture must not wait for EOF from daemonised descendants.
#
#      v1 captured native output with a PowerShell PIPELINE:
#          $merged = @(& $Exe @ArgList 2>&1)
#      A pipeline only completes when the read end sees EOF. On Windows,
#      `pg_ctl start` does not exec the postmaster; it spawns
#
#          pg_ctl.exe  ->  cmd.exe /C "postgres.exe ..."  ->  postgres.exe
#
#      and that long-lived cmd.exe/postgres.exe pair INHERITS pg_ctl's stdout
#      and stderr handles. The write end therefore stays open for the whole
#      life of the cluster, EOF never arrives, and `& $Exe @ArgList 2>&1`
#      blocks FOREVER. This was observed: the disposable cluster came up
#      correctly on 127.0.0.1:15432 and the wrapper sat at 0% CPU with no
#      child processes for 20+ minutes, stuck immediately after
#      "[T6] pg_ctl start on port 15432 (loopback only)".
#
#      v2/v3 run the child through System.Diagnostics.Process with
#      RedirectStandardOutput/RedirectStandardError, which gives the child
#      PIPE handles that are read asynchronously. The parent's wait is on the
#      DIRECT child only, bounded by an explicit timeout, so a descendant that
#      holds the inherited handle can never stall the wrapper.
#
#      Exit-code handling is PRESERVED and made stronger:
#        * the child's real exit code is read from the Process object
#          (PowerShell's $LASTEXITCODE is unreliable for redirected output);
#        * a TIMEOUT is reported as a distinct, non-zero outcome and is
#          NEVER treated as success;
#        * stdout and stderr are still captured separately and preserved as
#          evidence, exactly as v1 did.
#
#      Argument fidelity is preserved: an explicit command line is built
#      using the standard CommandLineToArgvW quoting rules, so an argument
#      containing spaces, quotes or a trailing backslash is passed through as
#      ONE argument, unchanged.
#
# ALL OTHER v1 CORRECTIONS ARE CARRIED OVER UNCHANGED
#   C1  listen_addresses quoting defect (unquoted value, one splatted
#       argument, cmd-metacharacter guard).
#   C3  explicit exit-code capture for every native tool; the stale-cluster
#       stop is checked and the data directory is NOT deleted if it fails.
#   C4  Get-T6Verdict: a PASS requires all eight native steps to exit 0,
#       exactly the 12 Group-L case ids to be recorded PASS, the runner
#       summary to report 12 total / 12 pass / 0 fail / 0 blocked /
#       0 not_run, and the evidence copy to be byte-identical and to match
#       the digest the runner itself reported.
#   C5  Assert-LabPort (only 15432) and Assert-NotServiceTarget (never the
#       PostgreSQL installation tree) make the port-5432 service an
#       unreachable target.
#   C6  structural ownership-marker parsing, postmaster.pid verification,
#       and a failed stop blocking deletion.
#   C7  durable, uniquely named evidence written OUTSIDE the disposable
#       cluster, so teardown cannot erase the results.
#   C8  the static negative self-test suite (extended in v2 and v3).
#
# -----------------------------------------------------------------------------
# SAFETY MODEL (fail closed)
#  * The port (15432), repository path, preparation directory and laboratory
#   root are fixed constants. There are no -Port/-Repo/-Prep/-LabRoot
#   overrides, so no destructive target can be redirected.
#  * The laboratory root must live inside the exact approved %TEMP% namespace
#   (<...>\AppData\Local\Temp\opencode\t6lab); substring matches, traversal,
#   UNC, device and alternate-data-stream paths are rejected.
#  * Every directory is protected by a run-ownership marker (T6LAB_OWNER). A
#   pre-existing directory without a valid marker is refused, never deleted.
#  * All recursive deletion is confined to the lab root and is preceded by a
#   namespace check, an ownership check and a service-path check.
#  * If port 15432 is already listening the run is BLOCKED: nothing is
#   connected to and nothing is terminated.
#  * Ambient libpq redirect variables (PGHOSTADDR, PGSERVICE, PGOPTIONS, ...)
#   are refused before any PostgreSQL child process is launched.
#  * The PostgreSQL service on port 5432 and its data directory are never
#   contacted, stopped or deleted.
#  * Every native child is waited for with a BOUNDED timeout. A timeout is a
#   failure, never a success.
#  * Captured output is BOUNDED per stream; excess is discarded, never buffered.
#  * A PostgreSQL process is stopped ONLY on positively proven ownership. A
#   process is never stopped merely because it listens on port 15432.
#
# C6 HARD-KILL RECOVERY
#  * There is no automatic cleanup of unknown clusters. If a previous run was
#   interrupted (hard kill) and ownership of <TEMP>\opencode\t6lab cannot be
#   proven, the script refuses to stop or delete anything and exits BLOCKED.
#   Never terminate arbitrary PostgreSQL processes and never delete a data
#   directory whose ownership marker is absent or mismatched.
#
# Usage (only after separate approval):
#   powershell -File t6-runner-candidate-v3.ps1 -Confirm I_APPROVE_LOCAL_T6
#   powershell -File t6-runner-candidate-v3.ps1 -SelfTest   # static guards only
# =============================================================================
# -----------------------------------------------------------------------------
# WHAT v1 GOT WRONG (observed 2026-10-20) AND WHAT v2 CHANGES
# -----------------------------------------------------------------------------
# C2b  Native output capture must not wait for EOF from daemonised descendants.
#
#      v1 captured native output with a PowerShell PIPELINE:
#          $merged = @(& $Exe @ArgList 2>&1)
#      A pipeline only completes when the read end sees EOF. On Windows,
#      `pg_ctl start` does not exec the postmaster; it spawns
#
#          pg_ctl.exe  ->  cmd.exe /C "postgres.exe ..."  ->  postgres.exe
#
#      and that long-lived cmd.exe/postgres.exe pair INHERITS pg_ctl's stdout
#      and stderr handles. The write end therefore stays open for the whole
#      life of the cluster, EOF never arrives, and `& $Exe @ArgList 2>&1`
#      blocks FOREVER. This was observed: the disposable cluster came up
#      correctly on 127.0.0.1:15432 and the wrapper sat at 0% CPU with no
#      child processes for 20+ minutes, stuck immediately after
#      "[T6] pg_ctl start on port 15432 (loopback only)".
#
#      v2 runs the child through System.Diagnostics.Process with
#      RedirectStandardOutput/RedirectStandardError, which gives the child
#      PIPE handles that are read asynchronously via CopyToAsync() into
#      unbounded MemoryStreams. The
#      parent's wait is on the DIRECT child only, bounded by an explicit
#      timeout, so a descendant that holds the inherited handle can never
#      stall the wrapper.
#
#      Exit-code handling is PRESERVED and made stronger:
#        * the child's real exit code is read from the Process object
#          (PowerShell's $LASTEXITCODE is unreliable for redirected output);
#        * a TIMEOUT is reported as a distinct, non-zero outcome and is
#          NEVER treated as success;
#        * stdout and stderr are still captured separately and preserved as
#          evidence, exactly as v1 did.
#
#      Argument fidelity is preserved: v2 builds an explicit command line
#      using the standard CommandLineToArgvW quoting rules, so an argument
#      containing spaces, quotes or a trailing backslash is passed through as
#      ONE argument, unchanged.
#
#      A dedicated offline regression test for this exact failure mode lives
#      next to this file: t6-deadlock-repro.ps1 (cmd.exe + ping only; it
#      never touches PostgreSQL, port 15432 or the 5432 service).
#
# ALL OTHER v1 CORRECTIONS ARE CARRIED OVER UNCHANGED
#   C1  listen_addresses quoting defect (unquoted value, one splatted
#       argument, cmd-metacharacter guard).
#   C3  explicit exit-code capture for every native tool; the stale-cluster
#       stop is checked and the data directory is NOT deleted if it fails.
#   C4  Get-T6Verdict: a PASS requires all eight native steps to exit 0,
#       exactly the 12 Group-L case ids to be recorded PASS, the runner
#       summary to report 12/12 with 0 fail / 0 blocked / 0 not_run, and the
#       evidence copy to be byte-identical and to match the digest the
#       runner itself reported.
#   C5  Assert-LabPort (only 15432) and Assert-NotServiceTarget (never the
#       PostgreSQL installation tree) make the port-5432 service an
#       unreachable target.
#   C6  structural ownership-marker parsing, postmaster.pid verification,
#       and a failed stop blocking deletion.
#   C7  durable, uniquely named evidence written OUTSIDE the disposable
#       cluster, so teardown cannot erase the results.
#   C8  the static negative self-test suite (extended in v2, see below).
#
# -----------------------------------------------------------------------------
# SAFETY MODEL (fail closed)
#  * The port (15432), repository path, preparation directory and laboratory
#   root are fixed constants. There are no -Port/-Repo/-Prep/-LabRoot
#   overrides, so no destructive target can be redirected.
#  * The laboratory root must live inside the exact approved %TEMP% namespace
#   (<...>\AppData\Local\Temp\opencode\t6lab); substring matches, traversal,
#   UNC, device and alternate-data-stream paths are rejected.
#  * Every directory is protected by a run-ownership marker (T6LAB_OWNER). A
#   pre-existing directory without a valid marker is refused, never deleted.
#  * All recursive deletion is confined to the lab root and is preceded by a
#   namespace check, an ownership check and a service-path check.
#  * If port 15432 is already listening the run is BLOCKED: nothing is
#   connected to and nothing is terminated.
#  * Ambient libpq redirect variables (PGHOSTADDR, PGSERVICE, PGOPTIONS, ...)
#   are refused before any PostgreSQL child process is launched.
#  * The PostgreSQL service on port 5432 and its data directory are never
#   contacted, stopped or deleted.
#  * Every native child is waited for with a BOUNDED timeout. A timeout is a
#   failure, never a success.
#
# C6 HARD-KILL RECOVERY
#  * There is no automatic cleanup of unknown clusters. If a previous run was
#   interrupted (hard kill) and ownership of <TEMP>\opencode\t6lab cannot be
#   proven, the script refuses to stop or delete anything and exits BLOCKED.
#   Never terminate arbitrary PostgreSQL processes and never delete a data
#   directory whose ownership marker is absent or mismatched.
#
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
$Port            = 15432
$ServicePort     = 5432          # only ever used to REFUSE it; never a target
$Repo            = "D:\DevProjects\Working\srilakshmimangalyamalai(boyar-bond-forge-main)"
$MarkerName      = "T6LAB_OWNER"
$MarkerContent   = "slmm-t6-disposable-lab"
$ApprovedSuffix  = "\AppData\Local\Temp\opencode\t6lab"
$DefaultEvidence = "\opencode\t6-evidence"
$ConfirmToken    = "I_APPROVE_LOCAL_T6"
$RunnerConfirm   = "I_APPROVE_LOCAL_T6"
# C2b: bounded waits. A native child that has not exited within its bound is
# reported as a TIMEOUT (a failure), never as success.
$NativeTimeoutSeconds      = 120
$NativeDrainMillis         = 2000
# C2c: maximum output RETAINED per stream (stdout and stderr are bounded
# independently). Excess output is discarded while still being drained, so the
# child is never blocked and the wrapper's memory use stays bounded.
$NativeMaxCaptureBytes     = 4MB
$ExpectedGroupLCases = @(
  "T6-L01","T6-L02","T6-L03","T6-L04","T6-L05","T6-L06",
  "T6-L07","T6-L08a","T6-L08b","T6-L09","T6-L10","T6-L11"
)

$script:stFail    = 0
$script:RunId     = (Get-Date -Format "yyyyMMdd-HHmmss") + "-" + ([guid]::NewGuid().ToString("N").Substring(0,8))
$script:EvidenceDir = $null
$script:LogPath   = $null
$script:LogLines  = New-Object System.Collections.Generic.List[string]
$script:CaptureReady = $false

function Throw-Blocked([string]$m) { throw "T6 BLOCKED: $m" }
function Step([string]$m) { Write-Host "[T6] $m"; Log-Line "[T6] $m" }
function Test-Throws([scriptblock]$Fn) { try { & $Fn; return $false } catch { return $true } }

function Log-Line([string]$m) {
  $script:LogLines.Add($m)
  if ($script:LogPath) {
    try { Add-Content -LiteralPath $script:LogPath -Value $m -Encoding UTF8 -ErrorAction SilentlyContinue } catch { }
  }
}

# C2d: interrupt a pending read on an inherited pipe handle.
#
# Closing or disposing the stream does NOT cancel a read that is already in
# flight; the read stays blocked and its copy task never completes. CancelIoEx
# cancels the pending OVERLAPPED operation on the handle, which makes the
# reader task reach a terminal state (Canceled) so the capture buffer can be
# disposed safely. If the cancellation is unavailable the stream is still
# closed, and the caller detects the still-running task and refuses to
# dispose the buffer.
function Stop-ReaderPump {
  param([System.IO.Stream]$Stream)
  if ($null -eq $Stream) { return $false }
  $ok = $false
  try {
    $fh = $Stream.SafeFileHandle
    if ($null -ne $fh) {
      $h = $fh.DangerousGetHandle()
      if ($h -ne [IntPtr]::Zero) {
        [void][T6PipeIo]::CancelIoEx($h, [IntPtr]::Zero)
        $ok = $true
      }
    }
  } catch { $ok = $false }
  try { $Stream.Close() } catch { }
  return $ok
}

# =============================================================================
# C2c: bounded capture sink
# =============================================================================
# A Stream that RETAINS at most $limit bytes and DISCARDS the rest while
# still absorbing it, so the child is never blocked on a full pipe and the
# wrapper's memory use stays bounded no matter how chatty a descendant is.
# The discarded byte count is reported so truncation is explicit.
$script:BoundedCaptureSource = @"
using System;
using System.IO;
using System.Runtime.InteropServices;

// CancelIoEx cancels the pending OVERLAPPED read on a pipe handle. Closing a
// stream does NOT interrupt a read that is already pending, so without this
// a reader task can outlive the call that started it.
public static class T6PipeIo {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CancelIoEx(IntPtr hFile, IntPtr lpOverlapped);
}

public class T6BoundedCapture : Stream {
  private readonly long _limit;
  private readonly MemoryStream _buf;
  public long Retained;
  public long Discarded;
  public bool Truncated;
  public T6BoundedCapture(long limit) { _limit = limit; _buf = new MemoryStream(); }
  public override bool CanRead { get { return false; } }
  public override bool CanSeek { get { return false; } }
  public override bool CanWrite { get { return true; } }
  public override long Length { get { return Retained + Discarded; } }
  public override long Position { get { return Length; } set { throw new NotSupportedException(); } }
  public override void Flush() { }
  public override int Read(byte[] b, int o, int c) { throw new NotSupportedException(); }
  public override long Seek(long o, SeekOrigin org) { throw new NotSupportedException(); }
  public override void SetLength(long v) { throw new NotSupportedException(); }
  public override void Write(byte[] b, int o, int c) {
    long room = _limit - Retained;
    if (room > 0) {
      int take = (int)Math.Min(room, c);
      _buf.Write(b, o, take);
      Retained += take;
      o += take;
      c -= take;
    }
    if (c > 0) { Discarded += c; Truncated = true; }
  }
  public byte[] ToArray() { return _buf.ToArray(); }
  protected override void Dispose(bool d) { if (d) { _buf.Dispose(); } base.Dispose(d); }
}
"@

# Compile the bounded sink once. If it cannot be compiled the run is
# REFUSED rather than silently falling back to unbounded capture.
function Initialize-BoundedCapture {
  if ($script:CaptureReady) { return $true }
  if ($null -ne ('T6BoundedCapture' -as [type])) { $script:CaptureReady = $true; return $true }
  try {
    Add-Type -TypeDefinition $script:BoundedCaptureSource -Language CSharp -ErrorAction Stop
    $script:CaptureReady = $true
  } catch {
    Throw-Blocked ("bounded output capture could not be initialised (Add-Type failed: " + $_.Exception.Message + "); refusing to run with unbounded capture")
  }
  return $true
}

# =============================================================================
# Native command execution (C2b, C3)
# =============================================================================
# Build a Windows command line from an argument array using the standard
# CommandLineToArgvW rules, so an argument that contains spaces, quotes or a
# trailing backslash is delivered as exactly ONE argument, byte-for-byte.
function ConvertTo-NativeArgumentString {
  param([string[]]$ArgList)
  $sb = New-Object System.Text.StringBuilder
  foreach ($a in $ArgList) {
    if ($null -eq $a) { $a = "" }
    if ($sb.Length -gt 0) { [void]$sb.Append(" ") }
    if ($a.Length -gt 0 -and $a -notmatch '[\s"]') { [void]$sb.Append($a); continue }
    [void]$sb.Append([char]34)
    $bs = 0
    foreach ($ch in $a.ToCharArray()) {
      if ($ch -eq [char]92) { $bs++; continue }
      if ($ch -eq [char]34) {
        [void]$sb.Append([string]::new([char]92, ($bs * 2) + 1))
        [void]$sb.Append([char]34)
        $bs = 0
        continue
      }
      if ($bs -gt 0) { [void]$sb.Append([string]::new([char]92, $bs)); $bs = 0 }
      [void]$sb.Append($ch)
    }
    if ($bs -gt 0) { [void]$sb.Append([string]::new([char]92, $bs * 2)) }
    [void]$sb.Append([char]34)
  }
  return $sb.ToString()
}

# Invoke-Native runs ONE native executable and returns its real exit code plus
# its stdout and stderr.
#
# WHY NOT `& $Exe @ArgList 2>&1` (the v1 implementation):
#   That form captures the child's output through a PowerShell PIPELINE, which
#   only completes at EOF. On Windows `pg_ctl start` spawns a long-lived
#   cmd.exe/postgres.exe descendant that INHERITS the captured stdout/stderr
#   handles, so EOF never arrives and the call blocks forever. This was the
#   observed 2026-10-20 failure.
#
# HOW v3 AVOIDS IT:
#   The child is started through System.Diagnostics.Process with redirected
#   stdout/stderr. Both streams are drained ASYNCHRONOUSLY into a BOUNDED
#   sink (C2c), and the wait is on the DIRECT child only, bounded by an
#   explicit timeout. A descendant holding an inherited handle therefore
#   cannot stall the wrapper, and a child that overruns its bound is reported
#   as a TIMEOUT -- a hard failure with a non-zero exit code, never a silent
#   success.
#
# C2c BOUNDED CAPTURE:
#   The copy target is a bounded sink that retains at most
#   $NativeMaxCaptureBytes per stream and discards the rest while still
#   absorbing it, so a chatty descendant cannot grow the wrapper's memory
#   without bound and can never block on a full pipe.
#
# C2d READER LIFETIME:
#   The reader task is brought to a terminal state BEFORE the sink is
#   disposed, so no task can write into a disposed buffer (Stop-ReaderPump).
# C2f: is the Group-L runner's captured output TRUSTWORTHY?
#
# The runner emits its `summary` line and its `results_sha256` digest near the
# END of its stdout, and the verdict depends on both. A capture that was
# truncated (the 4 MB cap was reached) or incomplete (a reader task had not
# finished) can therefore remove exactly those two values while the native
# exit code is still 0. Such a capture must never be allowed to produce a
# verdict.
#
# This is a PURE predicate: it inspects the result object and returns $null
# when the capture is trustworthy, or a short fault description when it is
# not. It is exercised directly by the offline self-tests.
function Get-NodeCaptureFault {
  param([object]$Result)
  if ($null -eq $Result) { return "no capture result was returned" }
  $names = @($Result.PSObject.Properties.Name)
  foreach ($p in @("StdoutTruncated","StderrTruncated","CaptureIncomplete")) {
    if (($names -contains $p) -and [bool]$Result.$p) {
      switch ($p) {
        "StdoutTruncated"  { return "stdout was truncated" }
        "StderrTruncated"  { return "stderr was truncated" }
        "CaptureIncomplete" { return "the capture was incomplete" }
      }
    }
  }
  return $null
}

# Assert-NodeCaptureTrustworthy is the HARD FAILURE gate for the Group-L
# runner step: if the capture was truncated on either stream, or was
# incomplete, it throws and no verdict may be issued. It is a separate
# function so the offline self-test can prove the gate actually fires.
function Assert-NodeCaptureTrustworthy {
  param([object]$Result)
  $fault = Get-NodeCaptureFault -Result $Result
  if ($null -ne $fault) {
    Throw-Blocked ("the Group-L runner output capture was truncated or incomplete ($fault); the runner summary and results digest cannot be trusted, so no verdict may be issued. See the node log in the evidence directory.")
  }
}

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [string[]]$ArgList = @(),
    [string]$LogFile = $null,
    [switch]$Quiet,
    [int]$TimeoutSeconds = 0
  )
  if ($TimeoutSeconds -le 0) { $TimeoutSeconds = $NativeTimeoutSeconds }
  Initialize-BoundedCapture | Out-Null

  $out = New-Object System.Collections.Generic.List[string]
  $err = New-Object System.Collections.Generic.List[string]
  $code = -1
  $timedOut = $false
  $outTrunc = $false; $errTrunc = $false
  $outDropped = 0L;   $errDropped = 0L
  $captureIncomplete = $false

  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $proc = $null
  $outSink = $null; $errSink = $null
  $tOut = $null;    $tErr = $null
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Exe
    $psi.Arguments = (ConvertTo-NativeArgumentString -ArgList $ArgList)
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    [void]$proc.Start()

    # C2c: BOUNDED capture, one sink per stream. Each sink retains at most
    # $NativeMaxCaptureBytes and discards the rest, so the buffer cannot grow
    # without bound while the descendant keeps writing. The child is still
    # drained completely, so it is never blocked on a full pipe.
    $outSink = New-Object T6BoundedCapture $NativeMaxCaptureBytes
    $errSink = New-Object T6BoundedCapture $NativeMaxCaptureBytes
    $tOut = $proc.StandardOutput.BaseStream.CopyToAsync($outSink)
    $tErr = $proc.StandardError.BaseStream.CopyToAsync($errSink)

    # Bounded wait on the DIRECT child only.
    $exited = $proc.WaitForExit($TimeoutSeconds * 1000)
    if (-not $exited) {
      $timedOut = $true
      $code = 124
      try { $proc.Kill() } catch { }
      try { [void]$proc.WaitForExit(5000) } catch { }
    }
    else {
      $code = $proc.ExitCode
    }

    # Give the readers a bounded moment to flush what the child wrote.
    try { [void]$tOut.Wait($NativeDrainMillis) } catch { }
    try { [void]$tErr.Wait($NativeDrainMillis) } catch { }

    # C2d: cancel the readers BEFORE disposing the sinks, so no reader task can
    # still be writing into a buffer we are about to dispose.
    #
    # Closing the source stream does NOT interrupt a read that is already
    # pending on an inherited pipe handle: the read stays blocked and the copy
    # task never reaches a terminal state (measured: still WaitingForActivation
    # after 3 s). CancelIoEx DOES interrupt it (measured: terminal in 23-53 ms,
    # status Canceled). The close is still performed afterwards so the handle
    # is released.
    [void](Stop-ReaderPump -Stream $proc.StandardOutput.BaseStream)
    [void](Stop-ReaderPump -Stream $proc.StandardError.BaseStream)
    $outDone = $false; $errDone = $false
    try { $outDone = $tOut.Wait($NativeDrainMillis) } catch { $outDone = $tOut.IsCompleted }
    try { $errDone = $tErr.Wait($NativeDrainMillis) } catch { $errDone = $tErr.IsCompleted }
    if (-not ($outDone -or $tOut.IsCompleted)) { $captureIncomplete = $true }
    if (-not ($errDone -or $tErr.IsCompleted)) { $captureIncomplete = $true }

    $outText = ""; $errText = ""
    try { $outText = [Text.Encoding]::UTF8.GetString($outSink.ToArray()) } catch { }
    try { $errText = [Text.Encoding]::UTF8.GetString($errSink.ToArray()) } catch { }
    try { $outTrunc = [bool]$outSink.Truncated; $outDropped = [long]$outSink.Discarded } catch { }
    try { $errTrunc = [bool]$errSink.Truncated; $errDropped = [long]$errSink.Discarded } catch { }

    # Dispose the sinks ONLY when no reader task can still write into them.
    if ($outDone -or $tOut.IsCompleted) { try { $outSink.Dispose() } catch { } }
    else { $captureIncomplete = $true }
    if ($errDone -or $tErr.IsCompleted) { try { $errSink.Dispose() } catch { } }
    else { $captureIncomplete = $true }

    foreach ($l in ($outText -split "`r?`n")) { if ($l -ne "") { $out.Add($l) } }
    foreach ($l in ($errText -split "`r?`n")) { if ($l -ne "") { $err.Add($l) } }
  }
  catch {
    $code = -1
    $err.Add("Invoke-Native failed to run '$Exe': " + $_.Exception.Message)
  }
  finally {
    $ErrorActionPreference = $prevEap
    if ($proc) { try { $proc.Dispose() } catch { } }
  }

  if ($timedOut) {
    $err.Add("TIMEOUT: '$Exe' did not exit within $TimeoutSeconds second(s); treated as a failure, not success")
  }
  if ($outTrunc) {
    $err.Add("OUTPUT TRUNCATED (stdout): retained at most $NativeMaxCaptureBytes bytes; $outDropped byte(s) discarded")
  }
  if ($errTrunc) {
    $err.Add("OUTPUT TRUNCATED (stderr): retained at most $NativeMaxCaptureBytes bytes; $errDropped byte(s) discarded")
  }
  if ($captureIncomplete) {
    $err.Add("CAPTURE INCOMPLETE: a reader task had not finished; the capture buffer was deliberately NOT disposed")
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
    ExitCode         = [int]$code
    Stdout           = $out.ToArray()
    Stderr           = $err.ToArray()
    TimedOut         = [bool]$timedOut
    StdoutTruncated  = [bool]$outTrunc
    StderrTruncated  = [bool]$errTrunc
    StdoutDiscarded  = [long]$outDropped
    StderrDiscarded  = [long]$errDropped
    CaptureIncomplete = [bool]$captureIncomplete
  }
}

# =============================================================================
# Path / ownership / port guards (C1, C5, C6, C7)
# =============================================================================
function Assert-ApprovedTempPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { Throw-Blocked "empty laboratory path" }
  if (-not [IO.Path]::IsPathRooted($Path)) { Throw-Blocked "laboratory path is not absolute: $Path" }
  # Check the RAW string: [IO.Path]::GetFullPath() silently strips a trailing
  # space/dot, so a normalised-away tail would never be seen below. Windows
  # APIs that do not normalise (e.g. the \\?\ prefix form) can address a
  # DIFFERENT directory with such a name, so the raw form is rejected.
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

# =============================================================================
# C2e: disposable laboratory INSPECTION with positive ownership proof
# =============================================================================
# Get-LabClusterState inspects OUR disposable laboratory and reports what it
# finds. It NEVER stops anything and NEVER touches a process it cannot prove
# it owns.
#
# Ownership is positively proven only when ALL of the following hold:
#   * the run-ownership marker in the lab root is valid;
#   * a postmaster.pid exists in OUR canonical data directory;
#   * the data directory recorded in that file equals ours (canonically);
#   * the recorded port is the lab port 15432 -- never 5432;
#   * that PID is still alive;
#   * it is a postgres.exe process whose command line names our data
#     directory.
#
# A process that merely LISTENS on port 15432 is never treated as ours, and
# the port-5432 Windows service is never a candidate.
function Get-LabClusterState {
  param(
    [string]$LabRootPath,
    [string]$DataDirPath
  )
  $state = [pscustomobject]@{
    State        = "none"        # none | owned | foreign | ambiguous
    Pid          = $null
    Port         = $null
    DataDir      = $null
    Reason       = ""
    Owned        = $false
    ProcessAlive = $false
  }
  if ([string]::IsNullOrWhiteSpace($DataDirPath)) { $state.Reason = "no data directory"; return $state }

  # Canonical form of OUR data directory, used for every comparison below.
  $ours = $null
  try   { $ours = ([IO.Path]::GetFullPath($DataDirPath) -replace '\\','/').TrimEnd('/').ToLowerInvariant() }
  catch { $ours = ($DataDirPath -replace '\\','/').TrimEnd('/').ToLowerInvariant() }

  # Identity evidence: every postgres.exe process whose command line names OUR
  # data directory. A process is NEVER selected because it listens on a port.
  $oursProcs = @()
  try {
    $oursProcs = @(Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" -ErrorAction Stop |
      Where-Object {
        $cl = ""
        try { $cl = [string]$_.CommandLine } catch { $cl = "" }
        $clNorm = ""
        if (-not [string]::IsNullOrWhiteSpace($cl)) { $clNorm = ($cl -replace '\\','/').ToLowerInvariant() }
        $clNorm.Contains($ours)
      })
  } catch { $oursProcs = @() }

  $pidFile = Join-Path $DataDirPath "postmaster.pid"
  if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) {
    if ($oursProcs.Count -gt 0) {
      $state.State  = "ambiguous"
      $state.Pid    = $oursProcs[0].ProcessId
      $state.ProcessAlive = $true
      $state.Reason = "a postgres.exe process names our data directory but there is no postmaster.pid"
      return $state
    }
    $state.Reason = "no postmaster.pid in the lab data directory and no postgres.exe names our data directory"
    return $state
  }

  $lines = @()
  try { $lines = @(Get-Content -LiteralPath $pidFile -ErrorAction Stop) } catch { $state.Reason = "postmaster.pid unreadable"; return $state }
  if ($lines.Count -lt 4) { $state.State = "ambiguous"; $state.Reason = "postmaster.pid is malformed"; return $state }

  $state.Pid     = ($lines[0]).Trim()
  $state.DataDir = ($lines[1]).Trim().Trim('"')
  $state.Port    = ($lines[3]).Trim()

  # The recorded data directory must be OURS (canonicalised on both sides).
  $recorded = $null
  try   { $recorded = ([IO.Path]::GetFullPath($state.DataDir) -replace '\\','/').TrimEnd('/').ToLowerInvariant() }
  catch { $recorded = ($state.DataDir -replace '\\','/').TrimEnd('/').ToLowerInvariant() }
  if ($recorded -ne $ours) {
    $state.State  = "foreign"
    $state.Reason = "postmaster.pid names a different data directory ($($state.DataDir))"
    if ($oursProcs.Count -gt 0) { $state.State = "ambiguous"; $state.Pid = $oursProcs[0].ProcessId; $state.ProcessAlive = $true }
    return $state
  }

  # The recorded port must be the lab port. Never 5432.
  $port = 0
  if (-not [int]::TryParse($state.Port, [ref]$port)) { $state.State = "ambiguous"; $state.Reason = "postmaster.pid has an unreadable port"; return $state }
  if ($port -ne $Port) {
    $state.State  = "foreign"
    $state.Reason = "postmaster.pid records port $port, not the lab port $Port"
    if ($oursProcs.Count -gt 0) { $state.State = "ambiguous"; $state.Pid = $oursProcs[0].ProcessId; $state.ProcessAlive = $true }
    return $state
  }

  # The ownership marker must be valid.
  if (-not (Test-OwnedMarker $LabRootPath)) {
    $state.State  = "ambiguous"
    $state.Reason = "the lab ownership marker is missing or invalid"
    return $state
  }

  # The recorded PID must still be alive.
  $proc = $null
  try { $proc = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $state.Pid) -ErrorAction Stop } catch { $proc = $null }
  if ($null -eq $proc) {
    $state.State  = "none"
    $state.Reason = "the recorded postmaster PID is not running"
    if ($oursProcs.Count -gt 0) {
      $state.State = "ambiguous"; $state.Pid = $oursProcs[0].ProcessId; $state.ProcessAlive = $true
      $state.Reason = "the recorded postmaster PID is not running but another postgres.exe names our data directory"
    }
    return $state
  }
  $state.ProcessAlive = $true
  if ($proc.Name -ne "postgres.exe") {
    $state.State  = "ambiguous"
    $state.Reason = "PID $($state.Pid) is '$($proc.Name)', not postgres.exe"
    return $state
  }
  $cmd = ""
  try { $cmd = [string]$proc.CommandLine } catch { $cmd = "" }
  $cmdNorm = ($cmd -replace '\\','/').ToLowerInvariant()
  if ([string]::IsNullOrWhiteSpace($cmd) -or (-not $cmdNorm.Contains($ours))) {
    $state.State  = "ambiguous"
    $state.Reason = "PID $($state.Pid) does not name our data directory in its command line"
    return $state
  }

  $state.State = "owned"
  $state.Owned  = $true
  $state.Reason = "positively proven: marker valid, postmaster.pid in our data dir, port $Port, postgres.exe naming our data dir"
  return $state
}

# Test-LabDeletionSafe decides whether the disposable laboratory may be
# deleted. It is a PURE decision: it inspects and reports, it never deletes
# and never stops anything.
#
# The laboratory may only be deleted when NOTHING of ours could still be
# using it:
#   * the ownership marker must be valid, and
#   * the laboratory must hold no live cluster of ours (state "none").
# Anything else -- a running cluster, an ambiguous identity, a foreign
# postmaster.pid -- means a potentially active PostgreSQL process may still
# use the data directory, so deletion is refused.
function Test-LabDeletionSafe {
  param(
    [string]$LabRootPath,
    [string]$DataDirPath
  )
  $report = [pscustomobject]@{
    Safe    = $false
    State   = "none"
    Reason  = ""
    CanDelete = $false
  }
  if (-not (Test-OwnedMarker $LabRootPath)) {
    $report.Reason = "the lab ownership marker is missing or invalid; refusing to delete the laboratory"
    return $report
  }
  $state = Get-LabClusterState -LabRootPath $LabRootPath -DataDirPath $DataDirPath
  $report.State = $state.State
  if ($state.State -eq "none") {
    $report.Safe = $true
    $report.CanDelete = $true
    $report.Reason = "no live cluster of ours uses the laboratory; deletion is permitted"
    return $report
  }
  $report.Reason = ("a possibly active PostgreSQL process may still use the laboratory (state=" + $state.State + ": " + $state.Reason + "); refusing to delete")
  return $report
}

# Stop-LabClusterIfOwned stops the disposable cluster ONLY when ownership is
# positively proven. It returns a report; it never stops an unproven process
# and never touches the port-5432 service.
function Stop-LabClusterIfOwned {
  param(
    [string]$LabRootPath,
    [string]$DataDirPath,
    [string]$PgCtlPath
  )
  $report = [pscustomobject]@{
    Attempted = $false
    Stopped   = $false
    State     = "none"
    Reason    = ""
    ExitCode  = $null
  }
  $state = Get-LabClusterState -LabRootPath $LabRootPath -DataDirPath $DataDirPath
  $report.State  = $state.State
  $report.Reason = $state.Reason
  if ($state.State -ne "owned") {
    $report.Reason = "ownership not proven ($($state.State)): $($state.Reason); leaving the process untouched"
    return $report
  }
  $report.Attempted = $true
  $r = Invoke-Native -Exe $PgCtlPath -ArgList @("stop","-D",$DataDirPath,"-m","fast","-w") -Quiet
  $report.ExitCode = $r.ExitCode
  if ($r.ExitCode -ne 0) {
    $r2 = Invoke-Native -Exe $PgCtlPath -ArgList @("stop","-D",$DataDirPath,"-m","immediate","-w") -Quiet
    $report.ExitCode = $r2.ExitCode
    if ($r2.ExitCode -ne 0) {
      $report.Reason = "stop failed (fast=$($r.ExitCode) immediate=$($r2.ExitCode))"
      return $report
    }
  }
  $after = Get-LabClusterState -LabRootPath $LabRootPath -DataDirPath $DataDirPath
  if ($after.State -eq "owned" -and $after.ProcessAlive) {
    $report.Reason = "the cluster is still running after the stop attempt"
    return $report
  }
  $report.Stopped = $true
  $report.Reason = "cluster stopped (ownership was positively proven)"
  return $report
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

  # C2f: the digest the RUNNER reported must be present and well formed. A
  # missing or malformed digest is a FAILURE, never a skipped check, so a
  # capture that dropped the digest line can never yield PASS.
  $expectedDigest = $null
  if ([string]::IsNullOrWhiteSpace($ExpectedResultsSha)) {
    $reasons.Add("the runner did not report a results sha256 digest; the evidence copy cannot be bound to the runner's own output")
  } elseif ($ExpectedResultsSha -notmatch '^[0-9a-fA-F]{64}$') {
    $reasons.Add("the results sha256 reported by the runner is not a valid 64-digit hex digest: $ExpectedResultsSha")
  } else {
    $expectedDigest = $ExpectedResultsSha.ToLowerInvariant()
  }

  if ([string]::IsNullOrWhiteSpace($EvidenceResultsPath) -or -not (Test-Path -LiteralPath $EvidenceResultsPath -PathType Leaf)) {
    $reasons.Add("evidence copy of the results file is missing: $EvidenceResultsPath")
  } else {
    # The evidence byte-identity comparison is preserved unchanged.
    if (Test-Path -LiteralPath $ResultsPath -PathType Leaf) {
      $srcHash = (Get-FileHash -LiteralPath $ResultsPath -Algorithm SHA256).Hash.ToLowerInvariant()
      $dstHash = (Get-FileHash -LiteralPath $EvidenceResultsPath -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($srcHash -ne $dstHash) { $reasons.Add("evidence copy of the results file differs from the original (sha256 $srcHash vs $dstHash)") }
    }
    # C2f: and the evidence copy must match the digest the runner reported.
    if ($null -ne $expectedDigest) {
      $actualDigest = (Get-FileHash -LiteralPath $EvidenceResultsPath -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($actualDigest -ne $expectedDigest) {
        $reasons.Add("results sha256 does not match the digest the runner reported (expected $expectedDigest, evidence copy $actualDigest)")
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
# Resolved constants
# =============================================================================
$script:LabRoot = Get-ApprovedLabRoot
$Prep     = Join-Path (Split-Path $script:LabRoot -Parent) "t6-prep"   # <TEMP>\opencode\t6-prep
$DataDir  = Join-Path $script:LabRoot "data"
$PgLog    = Join-Path $script:LabRoot "pg.log"
$ResultFile = Join-Path $script:LabRoot "t6-lab-results.jsonl"

# =============================================================================
# Static negative self-test (C8). No database connection, no cluster, no
# PostgreSQL process. Touches the filesystem only inside a disposable sandbox
# and spawns only harmless local helper processes.
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

    # C2f: a TRUNCATED capture loses the summary AND the digest (both are
    # emitted near the end of the runner's stdout). Neither one alone can
    # produce PASS.
    $v = Get-T6Verdict -ExitCodes $allZero -ResultsPath $goodFile -EvidenceResultsPath $copyFile -ExpectedCaseIds $ExpectedGroupLCases -ExpectedResultsSha $null -RunnerSummaryJson $null
    Check "verdict FAIL when a truncated capture lost both the summary and the digest" ($v.Verdict -eq "FAIL")
    Check "the lost digest is reported even when the summary is also lost" (@($v.Reasons | Where-Object { $_ -like "*did not report a results sha256*" }).Count -ge 1)

    $v = Get-T6Verdict -ExitCodes $allZero -ResultsPath $goodFile -EvidenceResultsPath $copyFile -ExpectedCaseIds $ExpectedGroupLCases -ExpectedResultsSha $goodSha -RunnerSummaryJson '{"summary":{"total":12,"pass":11,"fail":0,"blocked":0,"not_run":1}}'
    Check "verdict FAIL when the runner summary reports a not_run case" ($v.Verdict -eq "FAIL")

    # --- C2f: a missing or invalid runner digest must never yield PASS -------
    $v = Get-T6Verdict -ExitCodes $allZero -ResultsPath $goodFile -EvidenceResultsPath $copyFile -ExpectedCaseIds $ExpectedGroupLCases -ExpectedResultsSha $null -RunnerSummaryJson $summaryJson
    Check "verdict FAIL when the runner reported NO results digest" ($v.Verdict -eq "FAIL")
    Check "the missing digest is reported as a reason" (@($v.Reasons | Where-Object { $_ -like "*did not report a results sha256*" }).Count -ge 1)

    $v = Get-T6Verdict -ExitCodes $allZero -ResultsPath $goodFile -EvidenceResultsPath $copyFile -ExpectedCaseIds $ExpectedGroupLCases -ExpectedResultsSha "" -RunnerSummaryJson $summaryJson
    Check "verdict FAIL when the runner reported an EMPTY results digest" ($v.Verdict -eq "FAIL")

    $v = Get-T6Verdict -ExitCodes $allZero -ResultsPath $goodFile -EvidenceResultsPath $copyFile -ExpectedCaseIds $ExpectedGroupLCases -ExpectedResultsSha ("zz" * 32) -RunnerSummaryJson $summaryJson
    Check "verdict FAIL when the runner digest is not 64 hex digits" ($v.Verdict -eq "FAIL")
    Check "the malformed digest is reported as a reason" (@($v.Reasons | Where-Object { $_ -like "*not a valid 64-digit hex digest*" }).Count -ge 1)

    $v = Get-T6Verdict -ExitCodes $allZero -ResultsPath $goodFile -EvidenceResultsPath $copyFile -ExpectedCaseIds $ExpectedGroupLCases -ExpectedResultsSha ("0" * 64) -RunnerSummaryJson $summaryJson
    Check "verdict FAIL when the runner digest does not match the evidence copy" ($v.Verdict -eq "FAIL")
    Check "the digest mismatch is reported as a reason" (@($v.Reasons | Where-Object { $_ -like "*does not match the digest the runner reported*" }).Count -ge 1)

    # The positive control still passes: a valid, matching digest is accepted.
    $v = Get-T6Verdict -ExitCodes $allZero -ResultsPath $goodFile -EvidenceResultsPath $copyFile -ExpectedCaseIds $ExpectedGroupLCases -ExpectedResultsSha $goodSha -RunnerSummaryJson $summaryJson
    Check "verdict still PASS when the runner digest is present, valid and matches" ($v.Verdict -eq "PASS")

    # The EVIDENCE BYTE-IDENTITY comparison, isolated: the evidence copy is
    # given a digest that matches ITSELF (so the digest check passes) but it
    # differs in bytes from the original, so ONLY the byte-identity
    # comparison can catch it. The extra record deliberately does NOT use a
    # T6-L id, so the case-set checks cannot catch it either.
    $tampered = Join-Path $vdir "tampered.copy.jsonl"
    Set-Content -LiteralPath $tampered -Value (($good -join "`n") + "`n" + '{"id":"T6-N01","status":"PASS","detail":""}') -Encoding UTF8
    $tamperedSha = (Get-FileHash -LiteralPath $tampered -Algorithm SHA256).Hash.ToLowerInvariant()
    $v = Get-T6Verdict -ExitCodes $allZero -ResultsPath $goodFile -EvidenceResultsPath $tampered -ExpectedCaseIds $ExpectedGroupLCases -ExpectedResultsSha $tamperedSha -RunnerSummaryJson $summaryJson
    Check "verdict FAIL when the evidence copy differs in bytes from the original" ($v.Verdict -eq "FAIL")
    Check "the byte-identity difference is reported as a reason" (@($v.Reasons | Where-Object { $_ -like "*differs from the original*" }).Count -ge 1)
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

  # ===========================================================================
  # C2b REGRESSION: native process handling (harmless local helpers only).
  # These reproduce the exact 2026-10-20 deadlock shape -- a direct child that
  # exits while a long-lived DESCENDANT keeps the inherited stdout/stderr
  # handles open -- and prove the wrapper no longer waits for EOF.
  # No PostgreSQL process, no port 15432, no 5432 service is involved.
  # ===========================================================================
  Write-Host "--- C2b native process-handling regression (cmd.exe only)"

  # 1. Exit code is reported faithfully.
  $r = Invoke-Native -Exe "cmd.exe" -ArgList @("/c", "exit 7") -Quiet
  Check "native exit code is reported faithfully (7)" ($r.ExitCode -eq 7)

  # 2. stdout is captured.
  $r = Invoke-Native -Exe "cmd.exe" -ArgList @("/c", "echo t6-stdout-probe") -Quiet
  Check "native stdout is captured" (($r.Stdout -join " ") -like "*t6-stdout-probe*")

  # 3. stderr is captured and kept separate from stdout.
  $r = Invoke-Native -Exe "cmd.exe" -ArgList @("/c", "echo t6-stderr-probe 1>&2") -Quiet
  Check "native stderr is captured" (($r.Stderr -join " ") -like "*t6-stderr-probe*")
  Check "native stderr is not merged into stdout" (-not (($r.Stdout -join " ") -like "*t6-stderr-probe*"))

  # 4. THE DEADLOCK REGRESSION: the direct child exits while a descendant
  #    holds the inherited handles. v1 blocked here forever.
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $r = Invoke-Native -Exe "cmd.exe" -ArgList @("/c", "start /b ping -n 30 127.0.0.1") -Quiet
  $sw.Stop()
  Check "descendant holding the inherited handles does not stall the wrapper" ($r.ExitCode -eq 0)
  Check "wrapper returned promptly despite the lingering descendant" ($sw.Elapsed.TotalSeconds -lt 20)
  $pingAlive = @(Get-Process -Name ping -ErrorAction SilentlyContinue).Count
  Check "the descendant was still alive when the wrapper returned" ($pingAlive -ge 1)
  Get-Process -Name ping -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

  # 5. A timeout is reported as a failure, never as success.
  $r = Invoke-Native -Exe "cmd.exe" -ArgList @("/c", "ping -n 30 127.0.0.1 > nul") -Quiet -TimeoutSeconds 2
  Check "a bounded timeout is reported as a timeout" ($r.TimedOut -eq $true)
  Check "a timeout is never reported as success" ($r.ExitCode -ne 0)

  # 6. Argument fidelity: an argument with spaces, quotes and a trailing
  #    backslash must arrive as exactly ONE argument, unchanged.
  #    node is the echo target because it parses argv with the standard
  #    CommandLineToArgvW rules and does NOT re-parse its own command line
  #    (powershell.exe -File would re-parse, which would test the TARGET's
  #    quoting rather than ours).
  $nodeExe = $null
  try { $nodeExe = (Get-Command node -ErrorAction Stop).Source } catch { $nodeExe = $null }
  if ($null -eq $nodeExe) {
    Check "argument fidelity test could not run (node not on PATH)" $false
  }
  else {
    $r = Invoke-Native -Exe $nodeExe `
         -ArgList @("-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
                    "plain", "has space", 'has"quote', "trailing\") `
         -Quiet
    $echoed = (($r.Stdout -join "") -replace "`r","").Trim()
    Check "argument with spaces survives intact"            ($echoed -like '*has space*')
    Check "the quoted argument keeps its quote character"  ($echoed -like '*has\"quote*')
    Check "the trailing-backslash argument survives intact" ($echoed -like '*trailing\*')
    Check "the argument list is not split apart"           ($echoed.StartsWith('["plain","has space"'))
  }

  # ===========================================================================
  # C2c / C2d / C2e REGRESSION (offline; harmless simulated processes only).
  # No PostgreSQL process, no database connection, no port 15432 and no
  # contact with the port-5432 service is involved anywhere below.
  # ===========================================================================
  Write-Host "--- C2c bounded output capture (simulated processes only)"

  # (a) The bounded sink itself retains at most its limit and discards the
  #     rest, so the wrapper's memory use cannot grow with the child's output.
  Initialize-BoundedCapture | Out-Null
  $sink = New-Object T6BoundedCapture 65536
  $chunk = New-Object byte[] 65536
  for ($i = 0; $i -lt $chunk.Length; $i++) { $chunk[$i] = 65 }
  for ($i = 0; $i -lt 160; $i++) { $sink.Write($chunk, 0, $chunk.Length) }
  Check "bounded sink retains at most its limit" ($sink.Retained -eq 65536)
  Check "bounded sink discards the excess instead of buffering it" ($sink.Discarded -gt 0)
  Check "bounded sink reports truncation" ($sink.Truncated -eq $true)
  Check "bounded sink memory stays bounded under sustained output" ($sink.Retained -le 65536)
  $sink.Dispose()

  # (b) High-volume stdout AND stderr through the real capture path: the
  #     retained output stays bounded, the excess is drained (the child is
  #     never blocked) and the truncation is reported explicitly.
  $savedCap = $script:NativeMaxCaptureBytes
  $script:NativeMaxCaptureBytes = 65536
  try {
    $floodCmd = "for /L %i in (1,1,5000) do @echo PADPADPADPADPADPADPADPADPADPADPADPADPADPADPADPADPADPADPADPADPADPADPADPAD"
    $r = Invoke-Native -Exe "cmd.exe" -ArgList @("/c", $floodCmd) -Quiet -TimeoutSeconds 120
    Check "high-volume stdout completes without blocking the child" ($r.ExitCode -eq 0)
    Check "high-volume stdout is reported as truncated" ($r.StdoutTruncated -eq $true)
    Check "the discarded stdout byte count is reported" ($r.StdoutDiscarded -gt 0)
    Check "stdout truncation is stated explicitly in the result" (($r.Stderr -join " ") -like "*OUTPUT TRUNCATED*stdout*")
    $kept = (($r.Stdout -join "`n")).Length
    Check "the retained stdout stays within the cap" ($kept -le 65536)
    Check "the native exit code is preserved despite truncation" ($r.ExitCode -eq 0)

    $r = Invoke-Native -Exe "cmd.exe" -ArgList @("/c", $floodCmd + " 1>&2") -Quiet -TimeoutSeconds 120
    Check "high-volume stderr is reported as truncated" ($r.StderrTruncated -eq $true)
    Check "the discarded stderr byte count is reported" ($r.StderrDiscarded -gt 0)
    Check "stderr truncation is stated explicitly in the result" (($r.Stderr -join " ") -like "*OUTPUT TRUNCATED*stderr*")
    Check "the native exit code is preserved despite stderr truncation" ($r.ExitCode -eq 0)

    # stdout and stderr are bounded INDEPENDENTLY.
    $r = Invoke-Native -Exe "cmd.exe" -ArgList @("/c", "echo SMALL-STDOUT-MARKER") -Quiet
    Check "a small stdout is not reported as truncated" ($r.StdoutTruncated -eq $false)
    Check "a small stdout is not reported as incomplete" ($r.CaptureIncomplete -eq $false)
  }
  finally { $script:NativeMaxCaptureBytes = $savedCap }

  # (c) A descendant that keeps the inherited stdout/stderr handles open must
  #     not stall the wrapper, and the reader must be cancelled rather than
  #     left writing into a disposed buffer.
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $r = Invoke-Native -Exe "cmd.exe" -ArgList @("/c", "start /b ping -n 30 127.0.0.1") -Quiet
  $sw.Stop()
  Check "a descendant holding the pipe handles does not stall the wrapper" ($r.ExitCode -eq 0)
  Check "the wrapper returned promptly while the descendant held the handles" ($sw.Elapsed.TotalSeconds -lt 20)
  Check "the capture completed (no reader left running against a disposed buffer)" ($r.CaptureIncomplete -eq $false)
  Check "the capture sink was released (the reader cannot write into a disposed buffer)" ($r.CaptureIncomplete -eq $false)
  $stillAlive = @(Get-Process -Name ping -ErrorAction SilentlyContinue).Count
  Check "the descendant was still alive when the wrapper returned" ($stillAlive -ge 1)
  Get-Process -Name ping -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

  # (d) Reader cancellation and safe disposal, exercised directly: closing the
  #     SOURCE ends the pending read, the copy task finishes, and only then is
  #     the sink safe to dispose.
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "cmd.exe"
  $psi.Arguments = "/c start /b ping -n 30 127.0.0.1"
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  $s2 = New-Object T6BoundedCapture 65536
  [void]$p.Start()
  $task = $p.StandardOutput.BaseStream.CopyToAsync($s2)
  $null = $p.WaitForExit(5000)
  Check "the reader task is still pending while a descendant holds the handle" (-not $task.IsCompleted)
  $closed = $true
  try { $p.StandardOutput.BaseStream.Close() } catch { $closed = $false }
  Check "the source stream can be closed to cancel the reader" $closed
  try { [void]$task.Wait(5000) } catch { }
  Check "the reader task finishes after the source is closed" ($task.IsCompleted -eq $true)
  $disposed = $true
  try { $s2.Dispose() } catch { $disposed = $false }
  Check "the sink can be disposed once the reader has finished" $disposed
  try { $p.Dispose() } catch { }
  Get-Process -Name ping -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

  # (e) A timeout with SURVIVING descendants is a failure, never a success,
  #     and the wrapper still returns in bounded time.
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $r = Invoke-Native -Exe "cmd.exe" -ArgList @("/c", "start /b ping -n 30 127.0.0.1 & ping -n 30 127.0.0.1 > nul") -Quiet -TimeoutSeconds 3
  $sw.Stop()
  Check "a timeout with surviving descendants is reported as a timeout" ($r.TimedOut -eq $true)
  Check "a timeout with surviving descendants is never reported as success" ($r.ExitCode -ne 0)
  Check "the timed-out call returned in bounded time" ($sw.Elapsed.TotalSeconds -lt 30)
  Get-Process -Name ping -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

  # ===========================================================================
  # C2f REGRESSION: a truncated or incomplete runner capture can never yield
  # PASS. Pure predicate -- no node, no database, no process is started.
  # ===========================================================================
  Write-Host "--- C2f capture-trust regression (pure predicate)"

  $okResult = [pscustomobject]@{
    ExitCode = 0; Stdout = @(); Stderr = @(); TimedOut = $false
    StdoutTruncated = $false; StderrTruncated = $false
    StdoutDiscarded = 0; StderrDiscarded = 0; CaptureIncomplete = $false
  }
  Check "a clean capture is trusted (no fault reported)" ($null -eq (Get-NodeCaptureFault -Result $okResult))

  $truncOut = $okResult.PSObject.Copy(); $truncOut.StdoutTruncated = $true
  Check "a truncated stdout is rejected" ($null -ne (Get-NodeCaptureFault -Result $truncOut))
  $truncErr = $okResult.PSObject.Copy(); $truncErr.StderrTruncated = $true
  Check "a truncated stderr is rejected" ($null -ne (Get-NodeCaptureFault -Result $truncErr))
  $incomplete = $okResult.PSObject.Copy(); $incomplete.CaptureIncomplete = $true
  Check "an incomplete capture is rejected" ($null -ne (Get-NodeCaptureFault -Result $incomplete))
  Check "a missing result is rejected" ($null -ne (Get-NodeCaptureFault -Result $null))

  # The HARD FAILURE gate itself: it must throw for every untrustworthy
  # capture and must NOT throw for a clean one.
  Expect-Blocked "a truncated stdout makes the Node step a hard failure" {
    Assert-NodeCaptureTrustworthy -Result $truncOut
  }
  Expect-Blocked "a truncated stderr makes the Node step a hard failure" {
    Assert-NodeCaptureTrustworthy -Result $truncErr
  }
  Expect-Blocked "an incomplete capture makes the Node step a hard failure" {
    Assert-NodeCaptureTrustworthy -Result $incomplete
  }
  Expect-Allowed  "a clean capture passes the Node-step trust gate" {
    Assert-NodeCaptureTrustworthy -Result $okResult
  }

  # The gate must also be WIRED into the main path, otherwise the function
  # above would be correct but never called. The main path cannot be executed
  # offline (it would start PostgreSQL), so the wiring is verified STATICALLY
  # against this script's own parsed syntax tree.
  #
  # The AST is used rather than a text search so that the check cannot match
  # its own source text: the guard call is located as a real COMMAND, and it
  # must lie OUTSIDE the Invoke-SelfTest function (i.e. in the main path).
  $selfSource = $null
  try { if ($PSCommandPath) { $selfSource = [IO.File]::ReadAllText($PSCommandPath) } } catch { $selfSource = $null }
  if ([string]::IsNullOrWhiteSpace($selfSource)) {
    Check "the Node-step trust gate is wired into the main path" $false
    Check "the Node-step trust gate runs before the summary and digest are parsed" $false
  } else {
    $selfTokens = $null
    $selfErrors = $null
    $selfAst = [System.Management.Automation.Language.Parser]::ParseInput($selfSource, [ref]$selfTokens, [ref]$selfErrors)

    # The self-test function's own extent: anything inside it is test code.
    $selfTestFn = @($selfAst.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq "Invoke-SelfTest" }, $true))
    $selfTestEnd = -1
    if ($selfTestFn.Count -gt 0) { $selfTestEnd = $selfTestFn[0].Extent.EndOffset }

    # Every real call to the guard.
    $guardCalls = @($selfAst.FindAll({
      param($n)
      ($n -is [System.Management.Automation.Language.CommandAst]) -and
      ($n.GetCommandName() -eq "Assert-NodeCaptureTrustworthy")
    }, $true))

    # A call that is in the MAIN path (outside the self-test function).
    $mainPathCalls = @($guardCalls | Where-Object { $_.Extent.StartOffset -gt $selfTestEnd })
    Check "the Node-step trust gate is wired into the main path" ($mainPathCalls.Count -ge 1)

    # It must run BEFORE the summary/digest are parsed out of stdout. The
    # parse site is identified by its STRING LITERAL, not by an enclosing
    # statement, so that an ancestor block cannot be mistaken for the parse.
    $parseNodes = @($selfAst.FindAll({
      param($n)
      ($n -is [System.Management.Automation.Language.StringConstantExpressionAst]) -and
      ([string]$n.Value -like '*results_sha256*')
    }, $true) | Where-Object { $_.Extent.StartOffset -gt $selfTestEnd })
    $ordered = $false
    if ($mainPathCalls.Count -ge 1 -and $parseNodes.Count -ge 1) {
      $earliestParse = [int]::MaxValue
      foreach ($pn in $parseNodes) {
        if ($pn.Extent.StartOffset -lt $earliestParse) { $earliestParse = $pn.Extent.StartOffset }
      }
      $ordered = ($mainPathCalls[0].Extent.StartOffset -lt $earliestParse)
    }
    Check "the Node-step trust gate runs before the summary and digest are parsed" $ordered
  }

  # ===========================================================================
  # C2e REGRESSION: refusal to clean up unowned or ambiguous processes.
  # A simulated lab is built in a disposable sandbox. No PostgreSQL process is
  # created or stopped; the recorded PID is a harmless cmd.exe, which must be
  # treated as ambiguous rather than as ours.
  # ===========================================================================
  Write-Host "--- C2e ownership proof and refusal to clean up ambiguous processes"

  $osbx = Join-Path $env:TEMP ("t6-ownsbx-" + [guid]::NewGuid().ToString("N"))
  $odata = Join-Path $osbx "data"
  New-Item -ItemType Directory -Force -Path $odata | Out-Null
  $sim = $null
  try {
    Add-OwnershipMarker $osbx

    # A live, harmless, non-postgres process stands in for the postmaster.
    $sim = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", "ping -n 30 127.0.0.1 > nul") -NoNewWindow -PassThru
    $simPid = $sim.Id
    $dataNorm = ([IO.Path]::GetFullPath($odata) -replace '\\','/')

    # A postmaster.pid naming OUR data dir and our lab port, but whose PID is
    # not a postgres.exe -> ownership is NOT proven.
    Set-Content -LiteralPath (Join-Path $odata "postmaster.pid") -Value ("{0}`n{1}`n1792430000`n15432" -f $simPid, $dataNorm) -Encoding ASCII
    $st = Get-LabClusterState -LabRootPath $osbx -DataDirPath $odata
    Check "a non-postgres PID in postmaster.pid is not treated as owned" ($st.Owned -eq $false)
    Check "a non-postgres PID in postmaster.pid is reported as ambiguous" ($st.State -eq "ambiguous")

    $rep = Stop-LabClusterIfOwned -LabRootPath $osbx -DataDirPath $odata -PgCtlPath "cmd.exe"
    Check "an ambiguous process is never stopped" ($rep.Stopped -eq $false)
    Check "an ambiguous process is not even targeted for stopping" ($rep.Attempted -eq $false)
    Check "the refusal to clean up is explained" (($rep.Reason -like "*ownership not proven*"))
    $stillThere = $null -ne (Get-Process -Id $simPid -ErrorAction SilentlyContinue)
    Check "the uncertain process is left untouched" $stillThere

    # A postmaster.pid naming a DIFFERENT data directory is foreign, never ours.
    Set-Content -LiteralPath (Join-Path $odata "postmaster.pid") -Value ("{0}`nC:/somewhere/else/data`n1792430000`n15432" -f $simPid) -Encoding ASCII
    $st = Get-LabClusterState -LabRootPath $osbx -DataDirPath $odata
    Check "a foreign data directory is not treated as owned" ($st.Owned -eq $false)
    Check "a foreign data directory is reported as foreign" ($st.State -eq "foreign")

    # A postmaster.pid on the 5432 service port is foreign: the service is
    # never a candidate.
    Set-Content -LiteralPath (Join-Path $odata "postmaster.pid") -Value ("{0}`n{1}`n1792430000`n5432" -f $simPid, $dataNorm) -Encoding ASCII
    $st = Get-LabClusterState -LabRootPath $osbx -DataDirPath $odata
    Check "a postmaster.pid on port 5432 is never treated as ours" ($st.Owned -eq $false)

    # Without a valid ownership marker the laboratory is ambiguous.
    Remove-Item -LiteralPath (Get-MarkerPath $osbx) -Force -ErrorAction SilentlyContinue
    Set-Content -LiteralPath (Join-Path $odata "postmaster.pid") -Value ("{0}`n{1}`n1792430000`n15432" -f $simPid, $dataNorm) -Encoding ASCII
    $st = Get-LabClusterState -LabRootPath $osbx -DataDirPath $odata
    Check "a lab without a valid ownership marker is ambiguous" ($st.State -eq "ambiguous")
    Check "a lab without a valid ownership marker is not owned" ($st.Owned -eq $false)

    # The refusal is reported for the deletion path as well.
    Add-OwnershipMarker $osbx
    $st = Get-LabClusterState -LabRootPath $osbx -DataDirPath $odata
    Check "the simulated lab state is still ambiguous" ($st.State -eq "ambiguous")

    # The deletion decision is refused while a possibly active process may
    # still use the laboratory.
    $del = Test-LabDeletionSafe -LabRootPath $osbx -DataDirPath $odata
    Check "deletion is refused while the laboratory state is ambiguous" ($del.CanDelete -eq $false)
    Check "the refusal to delete is explained" (($del.Reason -like "*possibly active PostgreSQL process*"))

    # With no postmaster.pid and no postgres.exe naming our data directory,
    # the laboratory is safe to delete.
    Remove-Item -LiteralPath (Join-Path $odata "postmaster.pid") -Force -ErrorAction SilentlyContinue
    $del = Test-LabDeletionSafe -LabRootPath $osbx -DataDirPath $odata
    Check "deletion is permitted when no live cluster uses the laboratory" ($del.CanDelete -eq $true)

    # An invalid ownership marker blocks deletion outright.
    Remove-Item -LiteralPath (Get-MarkerPath $osbx) -Force -ErrorAction SilentlyContinue
    $del = Test-LabDeletionSafe -LabRootPath $osbx -DataDirPath $odata
    Check "deletion is refused without a valid ownership marker" ($del.CanDelete -eq $false)
    Check "the marker refusal is explained" (($del.Reason -like "*ownership marker*"))
  }
  finally {
    if ($sim) { try { Stop-Process -Id $sim.Id -Force -ErrorAction SilentlyContinue } catch { } }
    if ($osbx -and $osbx.StartsWith($env:TEMP) -and $osbx -like "*t6-ownsbx-*") {
      Remove-Item -Recurse -Force -LiteralPath $osbx -ErrorAction SilentlyContinue
    }
  }

  if ($script:stFail -gt 0) { Write-Host "T6 SELF-TEST: $($script:stFail) failure(s)" } else { Write-Host "T6 SELF-TEST: all checks passed" }
}

if ($SelfTest) { Invoke-SelfTest; exit $script:stFail }

# =============================================================================
# Main (execution) path
# =============================================================================
$started  = $false
$startAttempted = $false
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
    # C2e: a stale cluster from an interrupted earlier run is stopped ONLY on
    # positive ownership proof -- the same proof used everywhere else. A
    # process is never stopped merely because it holds our data directory.
    $pmPid = Assert-PostmasterIsOurs $DataDir
    $stale = Get-LabClusterState -LabRootPath $script:LabRoot -DataDirPath $DataDir
    Log-Line ("stale-cluster inspection: state=" + $stale.State + " (" + $stale.Reason + ")")
    if ($stale.State -eq "owned") {
      Step "removing stale disposable cluster at $DataDir (ownership positively proven)"
      $stopRep = Stop-LabClusterIfOwned -LabRootPath $script:LabRoot -DataDirPath $DataDir -PgCtlPath "$Bin\pg_ctl.exe"
      $script:ExitCodes["stale_stop"] = $(if ($null -eq $stopRep.ExitCode) { 1 } else { $stopRep.ExitCode })
      Log-Line ("stale-cluster stop: " + $stopRep.Reason)
      if (-not $stopRep.Stopped) {
        Throw-Blocked "could not stop the stale cluster in $DataDir ($($stopRep.Reason)); refusing to delete the data directory. STOP for manual inspection."
      }
    } elseif ($stale.State -eq "none") {
      if ($pmPid) {
        Log-Line "stale-cluster inspection: postmaster.pid present but no live cluster of ours; nothing to stop"
      }
    } else {
      # ambiguous / foreign: preserve everything and stop.
      Throw-Blocked "a process in $DataDir could not be positively identified as ours (state=$($stale.State): $($stale.Reason)); refusing to stop it and refusing to delete the data directory. STOP for manual inspection."
    }
    # C2e: the data directory is deleted only when nothing of ours can still
    # be using it.
    $staleDel = Test-LabDeletionSafe -LabRootPath $script:LabRoot -DataDirPath $DataDir
    if (-not $staleDel.CanDelete) {
      Throw-Blocked "refusing to delete $DataDir -- $($staleDel.Reason). STOP for manual inspection."
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
  # C2b: bounded wait on the DIRECT child only. The postmaster descendant
  # inherits the std handles but cannot stall the wrapper.
  # C2e: mark the start as ATTEMPTED *before* issuing it. A postmaster may
  # have come up even when pg_ctl itself failed or timed out, so the teardown
  # must inspect the laboratory either way.
  $startAttempted = $true
  $r = Invoke-Native -Exe "$Bin\pg_ctl.exe" -ArgList @("start","-D",$DataDir,"-l",$PgLog,"-o",$pgOptions,"-w") -Quiet
  $script:ExitCodes["pgctl_start"] = $r.ExitCode
  if ($r.TimedOut) {
    # C2e: inspect the disposable laboratory before giving up. If a postmaster
    # came up despite the timeout, it is ours (positive ownership proof) and
    # is stopped. If ownership cannot be proven, leave it untouched.
    $inspect = Get-LabClusterState -LabRootPath $script:LabRoot -DataDirPath $DataDir
    Log-Line ("pg_ctl start timed out; laboratory state = " + $inspect.State + " (" + $inspect.Reason + ")")
    if ($inspect.State -eq "owned") {
      $stopRep = Stop-LabClusterIfOwned -LabRootPath $script:LabRoot -DataDirPath $DataDir -PgCtlPath "$Bin\pg_ctl.exe"
      Log-Line ("post-timeout cleanup: " + $stopRep.Reason)
    } else {
      Log-Line ("post-timeout cleanup: ownership not proven; the process is left untouched")
    }
    Throw-Blocked "pg_ctl start timed out; see $PgLog"
  }
  if ($r.ExitCode -ne 0) {
    $inspect = Get-LabClusterState -LabRootPath $script:LabRoot -DataDirPath $DataDir
    Log-Line ("pg_ctl start failed; laboratory state = " + $inspect.State + " (" + $inspect.Reason + ")")
    if ($inspect.State -eq "owned") {
      $stopRep = Stop-LabClusterIfOwned -LabRootPath $script:LabRoot -DataDirPath $DataDir -PgCtlPath "$Bin\pg_ctl.exe"
      Log-Line ("post-failure cleanup: " + $stopRep.Reason)
    } else {
      Log-Line ("post-failure cleanup: ownership not proven; the process is left untouched")
    }
    Throw-Blocked "pg_ctl start failed ($($r.ExitCode)); see $PgLog"
  }
  $started = $true

  $r = Invoke-Native -Exe "$Bin\pg_isready.exe" -ArgList @("-h","127.0.0.1","-p","$Port","-t","10") -Quiet
  $script:ExitCodes["isready"] = $r.ExitCode
  if ($r.TimedOut) { Throw-Blocked "pg_isready timed out on port $Port" }
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
  # C2f: the runner's stdout carries the summary line and the results digest,
  # and BOTH are emitted near the END of the runner's output. A truncated or
  # incomplete capture therefore silently removes exactly the two values the
  # verdict depends on. Any of these three conditions is a HARD FAILURE: the
  # capture is not trustworthy, so the run must not be able to report PASS.
  Assert-NodeCaptureTrustworthy -Result $r
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
  # C6 + C2e: never touch a cluster/directory whose ownership cannot be proven.
  # The laboratory is INSPECTED whenever a start was attempted -- not only when
  # a start succeeded -- because a postmaster can come up even when pg_ctl
  # itself failed or timed out.
  $labState = $null
  if ($started -or $startAttempted) {
    try {
      $labState = Get-LabClusterState -LabRootPath $script:LabRoot -DataDirPath $DataDir
      Log-Line ("teardown: laboratory state = " + $labState.State + " (" + $labState.Reason + ")")
      if ($labState.State -eq "owned") {
        # Ownership is positively proven, so the cluster IS ours and may be
        # stopped. Stop-LabClusterIfOwned re-proves ownership and verifies
        # that the cluster actually stopped.
        Step "pg_ctl stop -m fast (ownership positively proven)"
        $stopRep = Stop-LabClusterIfOwned -LabRootPath $script:LabRoot -DataDirPath $DataDir -PgCtlPath "$env:ProgramFiles\PostgreSQL\18\bin\pg_ctl.exe"
        Log-Line ("teardown: stop result = " + $stopRep.Reason)
        if (-not $stopRep.Stopped) {
          Write-Warning "teardown: the cluster could not be confirmed stopped ($($stopRep.Reason)); the laboratory will NOT be deleted. STOP for manual inspection."
          $exitCode = 2
        }
      } elseif ($labState.State -eq "none") {
        Log-Line "teardown: no live cluster for our laboratory; nothing to stop"
      } else {
        # ambiguous / foreign: preserve evidence, leave the process alone.
        Write-Warning "teardown: ownership of the laboratory could not be proven ($($labState.State)); the process is left untouched. STOP for manual inspection."
        Log-Line ("teardown: ownership not proven; process left untouched: " + $labState.Reason)
        $exitCode = 2
      }
    } catch { Write-Warning "teardown stop failed: $($_.Exception.Message)"; $exitCode = 2 }
  }
  if (-not $Keep) {
    try {
      # C2e: the laboratory is deleted ONLY when the CURRENT state proves that
      # no live cluster of ours can still be using it. The decision is taken
      # AFTER any stop attempt, so a successfully stopped cluster does not
      # block the cleanup.
      $del = Test-LabDeletionSafe -LabRootPath $script:LabRoot -DataDirPath $DataDir
      Log-Line ("teardown: deletion check = " + $del.Reason)
      if ($del.CanDelete) {
        Step "removing disposable lab $script:LabRoot"
        Remove-LabTree $script:LabRoot
      } else {
        Write-Warning "teardown: refusing to delete $script:LabRoot -- $($del.Reason). Evidence preserved."
        Log-Line "teardown: laboratory NOT deleted"
        $exitCode = 2
      }
    } catch { Write-Warning "refusing/failed to remove $script:LabRoot : $($_.Exception.Message)"; $exitCode = 2 }
  } else {
    Step "keeping $script:LabRoot (-Keep); cluster data remains until removed"
  }
  if ($script:LogPath) {
    try { Log-Line ("exit code: " + $exitCode) } catch { }
  }
}

exit $exitCode
