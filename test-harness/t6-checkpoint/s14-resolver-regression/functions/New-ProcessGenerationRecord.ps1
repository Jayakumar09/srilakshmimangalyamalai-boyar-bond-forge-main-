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