function Get-ProcessGenerationKey {
    param(
        [Parameter(Mandatory)][int]$Id,
        [Parameter(Mandatory)][DateTime]$CreationUtc
    )
    return ('pid=' + $Id + ';born=' + ([DateTime]$CreationUtc).ToUniversalTime().ToString('o'))
}