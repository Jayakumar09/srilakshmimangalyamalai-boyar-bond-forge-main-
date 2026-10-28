$ErrorActionPreference = 'Stop'
$script:ProcessIdentitySlackMs = 1000
$script:TestMap = @{}
. 'D:\SLMM-T6-TOOLS\S14-HARNESS\Get-ProcessGenerationKey.ps1'
. 'D:\SLMM-T6-TOOLS\S14-HARNESS\New-ProcessGenerationRecord.ps1'
. 'D:\SLMM-T6-TOOLS\S14-HARNESS\Resolve-ProcessGeneration.ps1'

# Synthetic identities only; never load the CIM-capable production provider.
function script:Get-PidIdentityState {
    param([int]$Id, $CreationUtc = $null)
    if ($Id -le 0) { return 'gone' }
    if ($null -eq $CreationUtc) { return 'unknown' }
    try { $k = Get-ProcessGenerationKey -Id $Id -CreationUtc ([DateTime]$CreationUtc) }
    catch { return 'unknown' }
    if (-not $script:TestMap.ContainsKey($k)) { return 'unknown' }
    $state = $script:TestMap[$k]
    if ($state -isnot [string] -or @('alive', 'gone', 'reused', 'unknown') -cnotcontains $state) {
        return 'unknown'
    }
    return [string]$state
}

$tp = [DateTime]::Parse('2026-10-28T00:00:00.0000000Z', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
$t1 = $tp.AddMinutes(5)
$t2 = $tp.AddMinutes(9)

$reg = @{}
$keysByPid = @{}
$reuseSink = New-Object System.Collections.ArrayList
$noteSink = New-Object System.Collections.ArrayList
$probSink = New-Object System.Collections.ArrayList

$genP = Resolve-ProcessGeneration -Id 88888 -CreationUtc $tp -Depth 0 -ParentId 4 -ParentCreationUtc $null -ParentKey '' -Registry $reg -KeysByPid $keysByPid -ProblemSink $probSink -ReuseSink $reuseSink -NoteSink $noteSink -SnapshotOrdinal 0
if ($null -eq $genP) { throw 'genP null' }
$pk = [string]$genP.key
if ([string]::IsNullOrEmpty($pk) -or -not $reg.ContainsKey($pk)) { throw 'parent generation not registered' }

$gen1 = Resolve-ProcessGeneration -Id 99999 -CreationUtc $t1 -Depth 1 -ParentId 88888 -ParentCreationUtc $tp -ParentKey $pk -Registry $reg -KeysByPid $keysByPid -ProblemSink $probSink -ReuseSink $reuseSink -NoteSink $noteSink -SnapshotOrdinal 1
if ($null -eq $gen1) { throw 'gen1 null' }

$script:TestMap[(Get-ProcessGenerationKey -Id 99999 -CreationUtc $t1)] = 'reused'
$gen2 = Resolve-ProcessGeneration -Id 99999 -CreationUtc $t2 -Depth 1 -ParentId 88888 -ParentCreationUtc $tp -ParentKey $pk -Registry $reg -KeysByPid $keysByPid -ProblemSink $probSink -ReuseSink $reuseSink -NoteSink $noteSink -SnapshotOrdinal 2
if ($null -eq $gen2) { throw 'gen2 null' }

if ([string]$gen1.key -eq [string]$gen2.key) { throw 'keys collided' }
if ([string]$gen1.parentKey -cne $pk -or [string]$gen2.parentKey -cne $pk) { throw 'child parent-generation key mismatch' }
if ($gen1.parentPid -ne 88888 -or $gen2.parentPid -ne 88888 -or $gen1.parentCreationUtc -cne $tp.ToString('o') -or $gen2.parentCreationUtc -cne $tp.ToString('o')) { throw 'child parent identity mismatch' }
if ([string]$gen2.classification -ne "reuse") { throw "gen2 not reuse" }
if ($reuseSink.Count -eq 0) { throw 'reuseSink empty' }
if ($reuseSink.Count -ne 1 -or [string]$reuseSink[0] -cne ('reuse:pid=99999 previousGeneration=' + [string]$gen1.key + ' previousBorn=' + $t1.ToString('o') + ' newBorn=' + $t2.ToString('o') + ' ordering=later depth=1 parentPid=88888')) { throw 'reuse event identity mismatch' }
if (-not $reg.ContainsKey([string]$gen1.key)) { throw 'gen1 not in registry' }
if (-not $reg.ContainsKey([string]$gen2.key)) { throw 'gen2 not in registry' }

Write-Host 'PASS'
exit 0
