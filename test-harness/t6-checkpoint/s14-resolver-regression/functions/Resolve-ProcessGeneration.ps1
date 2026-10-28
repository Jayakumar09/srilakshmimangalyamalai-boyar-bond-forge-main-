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