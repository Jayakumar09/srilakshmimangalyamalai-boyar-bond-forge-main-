#Requires -Version 5.1
<#
  External S14 companion. Implementation/static review is not runtime evidence.
  Run only after separate explicit runtime approval, in an isolated PS 5.1 process.
  Imports selected immutable definitions, never the capture script entry point.
  Mocks only Get-PidState and Get-CimInstance; no real process/CIM access.
  Runtime output is JSON on stdout; assertion/import/fixture faults exit 1.
#>
$ErrorActionPreference = 'Stop'
$script:Fixture = $null
$script:Assertions = New-Object System.Collections.ArrayList
$script:CompletedFixtures = New-Object System.Collections.ArrayList
$script:AllFixtureFaults = New-Object System.Collections.ArrayList
$script:Imports = New-Object System.Collections.ArrayList
$script:ProductionBindings = @{}
$script:ProcessIdentitySlackMs = 2000

function Assert-S14 {
    param([string]$Name, [bool]$Condition)
    $caseName = if ($null -eq $script:Fixture) { 'setup' } else { $script:Fixture.Name }
    $entry = [pscustomobject]@{ fixture = $caseName; assertion = $Name; passed = $Condition }
    [void]$script:Assertions.Add($entry)
    if ($null -ne $script:Fixture) { [void]$script:Fixture.Assertions.Add($entry) }
    if (-not $Condition) { throw ('Assertion failed: ' + $caseName + ': ' + $Name) }
}

function Assert-S14State {
    param([string]$Name, [AllowEmptyCollection()][object[]]$Values, [string]$Expected)
    Assert-S14 -Name $Name -Condition ($Values.Count -eq 1 -and $Values[0] -is [string] -and $Values[0] -ceq $Expected)
    [void]$script:Fixture.Observations.Add([pscustomobject]@{ name = $Name; actual = $Values[0]; expected = $Expected })
}

function Assert-S14Boolean {
    param([string]$Name, [AllowEmptyCollection()][object[]]$Values, [bool]$Expected)
    Assert-S14 -Name $Name -Condition ($Values.Count -eq 1 -and $Values[0] -is [bool] -and $Values[0] -eq $Expected)
    [void]$script:Fixture.Observations.Add([pscustomobject]@{ name = $Name; actual = $Values[0]; expected = $Expected; meaning = 'conservative liveness, not proof of existence' })
}

function Get-S14SingleRecord {
    param([string]$Name, [AllowEmptyCollection()][object[]]$Values)
    Assert-S14 -Name ($Name + ': exactly one generation record') -Condition ($Values.Count -eq 1 -and $null -ne $Values[0] -and $null -ne $Values[0].PSObject.Properties['key'])
    return $Values[0]
}

function Add-S14FixtureFault {
    param([string]$Message)
    [void]$script:AllFixtureFaults.Add($Message)
    if ($null -ne $script:Fixture) { [void]$script:Fixture.Faults.Add($Message) }
}

# Only environmental leaves are replaced. Unknown fixture entries never mean gone.
function script:Get-PidState {
    [CmdletBinding()]
    param([Parameter(Mandatory)][int]$Id)
    if ($null -eq $script:Fixture) {
        Add-S14FixtureFault -Message 'PID request outside a fixture'
        return 'unknown'
    }
    [void]$script:Fixture.Calls.Add([pscustomobject]@{ leaf = 'Get-PidState'; pid = $Id })
    if (-not $script:Fixture.World.ContainsKey($Id)) {
        Add-S14FixtureFault -Message ('Unconfigured PID request: ' + $Id)
        return 'unknown'
    }
    $state = $script:Fixture.World[$Id].PidState
    if ($state -isnot [string] -or @('alive', 'gone', 'unknown') -cnotcontains $state) {
        Add-S14FixtureFault -Message ('Invalid synthetic PID state: pid=' + $Id)
        return 'unknown'
    }
    return [string]$state
}

function script:Get-CimInstance {
    [CmdletBinding()]
    param([string]$ClassName, [string]$Filter)
    if ($null -eq $script:Fixture) {
        Add-S14FixtureFault -Message 'CIM substitute request outside a fixture'
        throw 'Synthetic CIM substitute has no active fixture'
    }
    [void]$script:Fixture.Calls.Add([pscustomobject]@{ leaf = 'Get-CimInstance'; className = $ClassName; filter = $Filter })
    if ($ClassName -cne 'Win32_Process' -or $Filter -cnotmatch '^ProcessId=([1-9][0-9]*)$') {
        Add-S14FixtureFault -Message 'Unexpected synthetic CIM class or filter'
        throw 'Synthetic CIM request rejected'
    }
    $queryId = 0
    if (-not [int]::TryParse($Matches[1], [ref]$queryId) -or -not $script:Fixture.World.ContainsKey($queryId)) {
        Add-S14FixtureFault -Message 'Unconfigured or invalid synthetic CIM PID'
        throw 'Synthetic CIM identity missing; never return absence'
    }
    $identity = $script:Fixture.World[$queryId]
    if ($identity.PidState -cne 'alive') {
        Add-S14FixtureFault -Message ('Unexpected CIM query for non-alive PID: ' + $queryId)
        throw 'Synthetic CIM query not permitted for this state'
    }
    if ($identity.CimMode -ceq 'error') { throw 'Programmed synthetic identity-query failure' }
    if ($identity.CimMode -cne 'row' -or $identity.CreationUtc -isnot [DateTime]) {
        Add-S14FixtureFault -Message 'Invalid synthetic CIM row configuration'
        throw 'Synthetic CIM configuration invalid'
    }
    return [pscustomobject]@{ ProcessId = $queryId; CreationDate = $identity.CreationUtc }
}

function Assert-S14Bindings {
    $pidCommand = Get-Command -Name 'Get-PidState' -ErrorAction Stop
    $cimCommand = Get-Command -Name 'Get-CimInstance' -ErrorAction Stop
    Assert-S14 -Name 'PID command resolves to the local leaf substitute' -Condition ($pidCommand.CommandType -eq 'Function' -and [object]::ReferenceEquals($pidCommand.ScriptBlock, $script:PidLeafBinding))
    Assert-S14 -Name 'CIM command resolves to the local leaf substitute' -Condition ($cimCommand.CommandType -eq 'Function' -and [object]::ReferenceEquals($cimCommand.ScriptBlock, $script:CimLeafBinding))
    foreach ($name in $script:ProductionBindings.Keys) {
        $command = Get-Command -Name $name -ErrorAction Stop
        Assert-S14 -Name ('Production function not replaced: ' + $name) -Condition ($command.CommandType -eq 'Function' -and [object]::ReferenceEquals($command.ScriptBlock, $script:ProductionBindings[$name]))
    }
}

function Start-S14Fixture {
    param([string]$Name)
    $script:Fixture = [pscustomobject]@{
        Name = $Name; World = @{}; Registry = @{}; KeysByPid = @{}
        Problems = (New-Object System.Collections.ArrayList)
        Reuse = (New-Object System.Collections.ArrayList)
        Notes = (New-Object System.Collections.ArrayList)
        Faults = (New-Object System.Collections.ArrayList)
        Calls = (New-Object System.Collections.ArrayList)
        Assertions = (New-Object System.Collections.ArrayList)
        Observations = (New-Object System.Collections.ArrayList)
        Parent = $null; Child = $null
    }
    Assert-S14Bindings
}

function Set-S14Identity {
    param([int]$Id, [ValidateSet('alive', 'gone', 'unknown')][string]$PidState,
        [ValidateSet('row', 'error', 'unused')][string]$CimMode, $CreationUtc = $null)
    $script:Fixture.World[$Id] = [pscustomobject]@{ PidState = $PidState; CimMode = $CimMode; CreationUtc = $CreationUtc }
}

function Resolve-S14Observation {
    param([int]$Id, [DateTime]$Born, [int]$Depth, [int]$ParentId,
        $ParentBorn, [string]$ParentKey, [int]$Ordinal)
    $f = $script:Fixture
    $values = @(Resolve-ProcessGeneration -Id $Id -CreationUtc $Born -Depth $Depth -ParentId $ParentId -ParentCreationUtc $ParentBorn -ParentKey $ParentKey -Registry $f.Registry -KeysByPid $f.KeysByPid -ProblemSink $f.Problems -ReuseSink $f.Reuse -NoteSink $f.Notes -SnapshotOrdinal $Ordinal)
    return (Get-S14SingleRecord -Name ('resolve pid=' + $Id + ' ordinal=' + $Ordinal) -Values $values)
}

function Initialize-S14TrackedChild {
    $f = $script:Fixture
    $f.Parent = Resolve-S14Observation -Id 88888 -Born $script:TP -Depth 0 -ParentId 4 -ParentBorn $null -ParentKey '' -Ordinal 0
    $pk = [string]$f.Parent.key
    Assert-S14 -Name 'Parent key is nonempty and registered' -Condition (-not [string]::IsNullOrEmpty($pk) -and $f.Registry.ContainsKey($pk))
    $f.Child = Resolve-S14Observation -Id 99999 -Born $script:T1 -Depth 1 -ParentId 88888 -ParentBorn $script:TP -ParentKey $pk -Ordinal 1
    Assert-S14 -Name 'Initial child belongs to the verified parent' -Condition ($f.Child.parentKey -ceq $pk -and $f.Child.parentPid -eq 88888 -and $f.Child.parentCreationUtc -ceq $script:TP.ToString('o'))
    Assert-S14 -Name 'Initial registry has exactly parent and T1' -Condition ($f.Registry.Count -eq 2 -and $f.KeysByPid[99999].Count -eq 1 -and $f.KeysByPid[99999][0] -ceq $f.Child.key)
    Assert-S14 -Name 'Initial observations do not query identity leaves' -Condition ($f.Calls.Count -eq 0)
}

function Get-S14PidKeySnapshot {
    param([Parameter(Mandatory)]$Map)
    if ($Map -isnot [hashtable] -or $Map.GetType() -ne [hashtable]) { throw 'PID-key snapshot requires an unconverted Hashtable' }
    # JSON object keys must be strings in PS 5.1. Copy typed PID entries into
    # records instead; never convert or mutate the production map's integer keys.
    $pidKeys = @($Map.psbase.Keys)
    foreach ($pidKey in $pidKeys) {
        if ($pidKey -isnot [int]) { throw 'PID-key snapshot requires System.Int32 map keys' }
    }
    $entries = New-Object System.Collections.ArrayList
    $seenGenerationKeys = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($pidKey in @($pidKeys | Sort-Object)) {
        $generationKeys = $Map[$pidKey]
        if ($generationKeys -isnot [System.Collections.ArrayList]) { throw 'PID-key snapshot requires ordered ArrayList values' }
        $keyRecords = New-Object System.Collections.ArrayList
        for ($ordinal = 0; $ordinal -lt $generationKeys.Count; $ordinal++) {
            $generationKey = $generationKeys[$ordinal]
            if ($generationKey -isnot [string] -or [string]::IsNullOrEmpty($generationKey)) { throw 'PID-key snapshot requires nonempty string generation keys' }
            if (-not $seenGenerationKeys.Add($generationKey)) { throw 'Duplicate generation key in PID-key snapshot' }
            [void]$keyRecords.Add([pscustomobject][ordered]@{
                ordinal = $ordinal; valueType = $generationKey.GetType().FullName; value = $generationKey
            })
        }
        [void]$entries.Add([pscustomobject][ordered]@{
            pidType = $pidKey.GetType().FullName; pid = $pidKey
            listType = $generationKeys.GetType().FullName; generationKeyCount = $generationKeys.Count
            generationKeys = $keyRecords.ToArray()
        })
    }
    if ($entries.Count -ne $Map.psbase.Count) { throw 'PID map count changed during snapshot' }
    # PID map enumeration order is not a contract; generation-list order is.
    return [pscustomobject][ordered]@{
        mapType = $Map.GetType().FullName; pidCount = $Map.psbase.Count; entries = $entries.ToArray()
    }
}

function Assert-S14PreservedPair {
    param($Later, [string]$OriginalJson)
    $f = $script:Fixture
    Assert-S14 -Name 'Both distinct child records remain registered' -Condition ($Later.key -cne $f.Child.key -and $f.Registry.Count -eq 3 -and $f.Registry.ContainsKey($f.Child.key) -and $f.Registry.ContainsKey($Later.key))
    Assert-S14 -Name 'Both child keys remain in PID list' -Condition ($f.KeysByPid[99999].Count -eq 2 -and $f.KeysByPid[99999][0] -ceq $f.Child.key -and $f.KeysByPid[99999][1] -ceq $Later.key)
    Assert-S14 -Name 'Both children use the same parent identity' -Condition ($Later.parentKey -ceq $f.Parent.key -and $f.Child.parentKey -ceq $f.Parent.key -and $Later.parentPid -eq 88888 -and $Later.parentCreationUtc -ceq $script:TP.ToString('o'))
    Assert-S14 -Name 'Original T1 record is unchanged' -Condition ((ConvertTo-Json -InputObject $f.Child -Depth 5 -Compress) -ceq $OriginalJson)
}

function Complete-S14Fixture {
    param([int]$ExpectedPidCalls, [int]$ExpectedCimCalls)
    $f = $script:Fixture
    Assert-S14Bindings
    Assert-S14 -Name 'No unexpected leaf requests, even if caught by production' -Condition ($f.Faults.Count -eq 0 -and $script:AllFixtureFaults.Count -eq 0)
    Assert-S14 -Name 'Exact PID leaf call count' -Condition (@($f.Calls | Where-Object { $_.leaf -ceq 'Get-PidState' }).Count -eq $ExpectedPidCalls)
    Assert-S14 -Name 'Exact CIM substitute call count' -Condition (@($f.Calls | Where-Object { $_.leaf -ceq 'Get-CimInstance' }).Count -eq $ExpectedCimCalls)
    Assert-S14 -Name 'No reuse event manufactured' -Condition ($f.Reuse.Count -eq 0)
    Assert-S14 -Name 'ProblemSink remains empty' -Condition ($f.Problems.Count -eq 0)
    $passed = (@($f.Assertions | Where-Object { -not $_.passed }).Count -eq 0 -and $f.Faults.Count -eq 0)
    [void]$script:CompletedFixtures.Add([pscustomobject]@{
        name = $f.Name; passed = $passed; assertions = $f.Assertions.ToArray()
        observations = $f.Observations.ToArray(); calls = $f.Calls.ToArray()
        records = @($f.Registry.Values | Sort-Object key)
        notes = $f.Notes.ToArray(); reuseEvents = $f.Reuse.ToArray(); faults = $f.Faults.ToArray()
    })
}

try {
    if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { throw 'Windows PowerShell 5.1 required' }
    if ($PID -in @(88888, 99999, 99998, 99997)) { throw 'Fixture PID collides with test host; stop without substitution' }
    $sourcePath = 'D:\DevProjects\Working\srilakshmimangalyamalai(boyar-bond-forge-main)\test-harness\t6-checkpoint\offline-evidence-capture.ps1'
    $sourceBytes = [IO.File]::ReadAllBytes($sourcePath)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $sourceHash = [BitConverter]::ToString($sha.ComputeHash($sourceBytes)).Replace('-', '') }
    finally { $sha.Dispose() }
    if ($sourceHash -cne '9E780D5ED85DB30B2C7DFC0DDF23B7F6BCD60E7B3F40A1664C3B9F98962DF0D9') { throw 'Protected source hash mismatch' }
    $sourceText = [Text.Encoding]::UTF8.GetString($sourceBytes).TrimStart([char]0xFEFF)
    $tokens = $null; $parseErrors = $null
    $sourceAst = [Management.Automation.Language.Parser]::ParseInput($sourceText, [ref]$tokens, [ref]$parseErrors)
    if (@($parseErrors).Count -ne 0) { throw 'Protected source parser errors' }
    $approved = [ordered]@{
        'Get-ProcessGenerationKey' = 'BBC3AF5F7C5EE1A308C108BCE05E660E9A6258612EB09C511E104F81BA7E0EB6'
        'New-ProcessGenerationRecord' = '7A99AB98DC2B97A73C5C022ED5919CFDCF4335DB71563E3BA51A061360339E81'
        'Resolve-ProcessGeneration' = 'F55EA8A86DC3E138F67CADB07CBEDF60CED3F7C8B30D49F767C44FEBA8E05E29'
        'Get-PidIdentityState' = 'C6D5D614B4E5FA1A623CBED113DEE62A98DCABE5C0488A8C6C6D3B6BCD7F9293'
        'Test-PidIdentityAlive' = '37F31B1FFC4E0D921E861C3E89717705A41FD6876B8412D9D502DE3B776E64B8'
        'Test-GenerationAlive' = '0B9CA8EBC3ADDF0B3E055D1B0E8B675134345648C5C7CC06A7872239DD51025D'
        'Get-ProcessCreationUtc' = '6FAF2A4C6B84F11C020F4A89BCED9B685AE594DA1BA3E9CB1AD658AF03175CF9'
        'Get-SurvivingGenerations' = '4F330EBEB9CCEB11AE5207CF42652267349C5341F1F28D18E392A616B1A51EFC'
    }
    $definitions = @{}
    foreach ($name in $approved.Keys) {
        $found = @($sourceAst.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] }, $true) | Where-Object { $_.Name -ceq $name })
        if ($found.Count -ne 1) { throw ('Nonunique production function: ' + $name) }
        $definition = [string]$found[0].Extent.Text
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $hash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($definition))).Replace('-', '') }
        finally { $sha.Dispose() }
        if ($hash -cne $approved[$name]) { throw ('Production extent hash mismatch: ' + $name) }
        $tokens = $null; $parseErrors = $null
        $definitionAst = [Management.Automation.Language.Parser]::ParseInput($definition, [ref]$tokens, [ref]$parseErrors)
        if (@($parseErrors).Count -ne 0 -or $definitionAst.EndBlock.Statements.Count -ne 1 -or $definitionAst.EndBlock.Statements[0] -isnot [Management.Automation.Language.FunctionDefinitionAst]) { throw 'Selected extent is not exactly one function definition' }
        $definitions[$name] = $definition
        [void]$script:Imports.Add([pscustomobject]@{ name = $name; sourceExtentSha256 = $hash; startLine = $found[0].Extent.StartLineNumber; endLine = $found[0].Extent.EndLineNumber })
    }
    # All eight extents validated before any are loaded. Never evaluate sourceAst.
    foreach ($name in $approved.Keys) {
        . ([scriptblock]::Create($definitions[$name]))
        $script:ProductionBindings[$name] = (Get-Command -Name $name -ErrorAction Stop).ScriptBlock
    }
    $script:PidLeafBinding = (Get-Command -Name 'Get-PidState' -ErrorAction Stop).ScriptBlock
    $script:CimLeafBinding = (Get-Command -Name 'Get-CimInstance' -ErrorAction Stop).ScriptBlock
    $script:TP = [DateTime]::Parse('2026-10-28T00:00:00.0000000Z', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
    $script:T1 = $script:TP.AddMinutes(5)
    $script:T2 = $script:TP.AddMinutes(9)

    # Fixture 1: alive identity and no false reuse despite a distinct observation.
    Start-S14Fixture -Name '1-alive-and-no-false-reuse'
    Initialize-S14TrackedChild
    $f = $script:Fixture
    Set-S14Identity -Id 99999 -PidState alive -CimMode row -CreationUtc $script:T1
    $originalJson = ConvertTo-Json -InputObject $f.Child -Depth 5 -Compress
    $originalRegistryJson = ConvertTo-Json -InputObject @($f.Registry.Values | Sort-Object key) -Depth 5 -Compress
    $originalPidKeysJson = ConvertTo-Json -InputObject (Get-S14PidKeySnapshot -Map $f.KeysByPid) -Depth 8 -Compress
    $t2Key = Get-ProcessGenerationKey -Id 99999 -CreationUtc $script:T2
    Assert-S14 -Name 'Conflicting observation is beyond slack and not an existing key' -Condition (($script:T2 - $script:T1).TotalMilliseconds -gt $script:ProcessIdentitySlackMs -and -not $f.Registry.ContainsKey($t2Key))
    Assert-S14State -Name 'T1 identity is exactly alive' -Values @(Get-PidIdentityState -Id 99999 -CreationUtc $script:T1) -Expected 'alive'
    Assert-S14Boolean -Name 'T1 identity-aware PID predicate is Boolean true' -Values @(Test-PidIdentityAlive -Id 99999 -CreationUtcById @{ 99999 = $script:T1 }) -Expected $true
    Assert-S14Boolean -Name 'T1 generation predicate is Boolean true' -Values @(Test-GenerationAlive -Generation $f.Child) -Expected $true
    $observed = Resolve-S14Observation -Id 99999 -Born $script:T2 -Depth 1 -ParentId 88888 -ParentBorn $script:TP -ParentKey $f.Parent.key -Ordinal 2
    Assert-S14 -Name 'Resolver returns the original object and key' -Condition ([object]::ReferenceEquals($observed, $f.Child) -and $observed.key -ceq $f.Child.key)
    Assert-S14 -Name 'No T2 record or PID key inserted' -Condition ($f.Registry.Count -eq 2 -and -not $f.Registry.ContainsKey($t2Key) -and $f.KeysByPid.Count -eq 2 -and $f.KeysByPid[99999].Count -eq 1 -and $f.KeysByPid[99999][0] -ceq $f.Child.key)
    Assert-S14 -Name 'Entire registry and PID-key map remain unchanged' -Condition ((ConvertTo-Json -InputObject @($f.Registry.Values | Sort-Object key) -Depth 5 -Compress) -ceq $originalRegistryJson -and (ConvertTo-Json -InputObject (Get-S14PidKeySnapshot -Map $f.KeysByPid) -Depth 8 -Compress) -ceq $originalPidKeysJson)
    Assert-S14 -Name 'Original record and firstObservation classification unchanged' -Condition ($f.Child.classification -ceq 'firstObservation' -and (ConvertTo-Json -InputObject $f.Child -Depth 5 -Compress) -ceq $originalJson)
    $expectedNote = 'creationTimeReread:pid=99999 recorded=' + $script:T1.ToString('o') + ' observed=' + $script:T2.ToString('o') + ' state=alive'
    Assert-S14 -Name 'Exactly the production alive-reread note exists' -Condition ($f.Notes.Count -eq 1 -and $f.Notes[0] -ceq $expectedNote)
    Complete-S14Fixture -ExpectedPidCalls 4 -ExpectedCimCalls 4

    # Fixture 2: confirmed gone is neither confirmed reuse nor uncertainty.
    Start-S14Fixture -Name '2-gone'
    Initialize-S14TrackedChild
    $f = $script:Fixture
    Set-S14Identity -Id 99999 -PidState gone -CimMode unused
    $originalJson = ConvertTo-Json -InputObject $f.Child -Depth 5 -Compress
    Assert-S14State -Name 'T1 identity is exactly gone' -Values @(Get-PidIdentityState -Id 99999 -CreationUtc $script:T1) -Expected 'gone'
    Assert-S14Boolean -Name 'Gone identity-aware PID predicate is Boolean false' -Values @(Test-PidIdentityAlive -Id 99999 -CreationUtcById @{ 99999 = $script:T1 }) -Expected $false
    Assert-S14Boolean -Name 'Gone generation predicate is Boolean false' -Values @(Test-GenerationAlive -Generation $f.Child) -Expected $false
    $survivors = @(Get-SurvivingGenerations -Generations @($f.Child))
    Assert-S14 -Name 'Gone T1 is excluded from survivors' -Condition ($survivors.Count -eq 0)
    $later = Resolve-S14Observation -Id 99999 -Born $script:T2 -Depth 1 -ParentId 88888 -ParentBorn $script:TP -ParentKey $f.Parent.key -Ordinal 2
    Assert-S14 -Name 'Later observation is exitedBeforeQuery, not reuse or unverified' -Condition ($later.classification -ceq 'exitedBeforeQuery' -and $later.classification -cne 'reuse' -and $later.classification -cne 'unverifiedGeneration')
    Assert-S14PreservedPair -Later $later -OriginalJson $originalJson
    Assert-S14 -Name 'Gone path adds no uncertainty or reuse note' -Condition ($f.Notes.Count -eq 0)
    Complete-S14Fixture -ExpectedPidCalls 5 -ExpectedCimCalls 0

    # Fixture 3: query uncertainty and two missing-creation-evidence fallbacks.
    Start-S14Fixture -Name '3-unknown-and-conservative-retention'
    Initialize-S14TrackedChild
    $f = $script:Fixture
    Set-S14Identity -Id 99999 -PidState alive -CimMode error
    $originalJson = ConvertTo-Json -InputObject $f.Child -Depth 5 -Compress
    Assert-S14State -Name 'Programmed query failure yields exactly unknown' -Values @(Get-PidIdentityState -Id 99999 -CreationUtc $script:T1) -Expected 'unknown'
    Assert-S14Boolean -Name 'Unknown identity-aware PID predicate is Boolean true' -Values @(Test-PidIdentityAlive -Id 99999 -CreationUtcById @{ 99999 = $script:T1 }) -Expected $true
    Assert-S14Boolean -Name 'Unknown generation predicate is Boolean true' -Values @(Test-GenerationAlive -Generation $f.Child) -Expected $true
    $survivors = @(Get-SurvivingGenerations -Generations @($f.Child))
    Assert-S14 -Name 'Unknown T1 retained as the same generation, not confirmed absent' -Condition ($survivors.Count -eq 1 -and $survivors[0].key -ceq $f.Child.key -and [object]::ReferenceEquals($survivors[0], $f.Child))
    $later = Resolve-S14Observation -Id 99999 -Born $script:T2 -Depth 1 -ParentId 88888 -ParentBorn $script:TP -ParentKey $f.Parent.key -Ordinal 2
    Assert-S14 -Name 'Unknown observation is unverified, not confirmed gone or reused' -Condition ($later.classification -ceq 'unverifiedGeneration' -and $later.classification -cne 'reuse' -and $later.classification -cne 'exitedBeforeQuery')
    Assert-S14PreservedPair -Later $later -OriginalJson $originalJson
    $expectedNote = 'unverifiedGeneration:pid=99999 observed=' + $script:T2.ToString('o') + ' state=unknown'
    Assert-S14 -Name 'Exactly the production unverified-generation note exists' -Condition ($f.Notes.Count -eq 1 -and $f.Notes[0] -ceq $expectedNote)
    $beforeFallbackCim = @($f.Calls | Where-Object { $_.leaf -ceq 'Get-CimInstance' }).Count
    Assert-S14Boolean -Name 'Missing creation-time map entry remains potentially alive' -Values @(Test-PidIdentityAlive -Id 99999 -CreationUtcById @{}) -Expected $true
    Set-S14Identity -Id 99999 -PidState unknown -CimMode unused
    $unboundGeneration = [pscustomobject]@{ pid = 99999; creationUtcValue = $null }
    Assert-S14Boolean -Name 'Missing usable generation creation plus unknown PID is retained' -Values @(Test-GenerationAlive -Generation $unboundGeneration) -Expected $true
    Assert-S14 -Name 'Both missing-evidence fallbacks avoid CIM queries' -Condition (@($f.Calls | Where-Object { $_.leaf -ceq 'Get-CimInstance' }).Count -eq $beforeFallbackCim)
    Complete-S14Fixture -ExpectedPidCalls 7 -ExpectedCimCalls 5

    # Fixture 4 uses the production constructor, not another resolver-reuse run.
    Start-S14Fixture -Name '4-generation-specific-survivor-selection'
    $f = $script:Fixture
    $f.Parent = Get-S14SingleRecord -Name 'survivor fixture parent' -Values @(New-ProcessGenerationRecord -Id 88888 -CreationUtc $script:TP -Depth 0 -ParentId 4 -ParentCreationUtc $null -ParentKey '' -SnapshotOrdinal 0)
    [void]$f.Registry.Add($f.Parent.key, $f.Parent)
    $specifications = @(
        [pscustomobject]@{ Id = 99999; Born = $script:T1 },
        [pscustomobject]@{ Id = 99999; Born = $script:T2 },
        [pscustomobject]@{ Id = 99998; Born = $script:T1.AddMinutes(1) },
        [pscustomobject]@{ Id = 99997; Born = $script:T1.AddMinutes(2) }
    )
    $candidates = New-Object System.Collections.ArrayList
    foreach ($spec in $specifications) {
        $record = Get-S14SingleRecord -Name ('survivor candidate ' + $spec.Id) -Values @(New-ProcessGenerationRecord -Id $spec.Id -CreationUtc $spec.Born -Depth 1 -ParentId 88888 -ParentCreationUtc $script:TP -ParentKey $f.Parent.key -SnapshotOrdinal 1)
        [void]$candidates.Add($record)
        [void]$f.Registry.Add($record.key, $record)
        if (-not $f.KeysByPid.ContainsKey([int]$spec.Id)) { $f.KeysByPid[[int]$spec.Id] = New-Object System.Collections.ArrayList }
        [void]$f.KeysByPid[[int]$spec.Id].Add($record.key)
    }
    $old = $candidates[0]; $current = $candidates[1]; $gone = $candidates[2]; $uncertain = $candidates[3]
    Set-S14Identity -Id 99999 -PidState alive -CimMode row -CreationUtc $script:T2
    Set-S14Identity -Id 99998 -PidState gone -CimMode unused
    Set-S14Identity -Id 99997 -PidState unknown -CimMode unused
    $beforeRecords = ConvertTo-Json -InputObject @($f.Registry.Values | Sort-Object key) -Depth 5 -Compress
    Assert-S14State -Name 'Old T1 identity is exactly reused' -Values @(Get-PidIdentityState -Id 99999 -CreationUtc $script:T1) -Expected 'reused'
    Assert-S14State -Name 'Current T2 identity is exactly alive' -Values @(Get-PidIdentityState -Id 99999 -CreationUtc $script:T2) -Expected 'alive'
    Assert-S14State -Name 'Uncertain candidate is explicitly unknown, not confirmed alive' -Values @(Get-PidIdentityState -Id 99997 -CreationUtc $uncertain.creationUtcValue) -Expected 'unknown'
    $survivors = @(Get-SurvivingGenerations -Generations $candidates.ToArray())
    $actualKeys = @($survivors | ForEach-Object { [string]$_.key } | Sort-Object)
    $expectedKeys = @([string]$current.key, [string]$uncertain.key) | Sort-Object
    Assert-S14 -Name 'Exact survivor count and generation-key set' -Condition ($survivors.Count -eq 2 -and ($actualKeys -join '|') -ceq ($expectedKeys -join '|'))
    Assert-S14 -Name 'Old T1 and confirmed-gone candidate excluded' -Condition ($actualKeys -cnotcontains [string]$old.key -and $actualKeys -cnotcontains [string]$gone.key)
    $currentMatches = @($survivors | Where-Object { $_.key -ceq $current.key })
    $unknownMatches = @($survivors | Where-Object { $_.key -ceq $uncertain.key })
    Assert-S14 -Name 'Current T2 is the original candidate record' -Condition ($currentMatches.Count -eq 1 -and [object]::ReferenceEquals($currentMatches[0], $current))
    Assert-S14 -Name 'Unknown candidate conservatively retained as original record' -Condition ($unknownMatches.Count -eq 1 -and [object]::ReferenceEquals($unknownMatches[0], $uncertain))
    Assert-S14 -Name 'All candidate records unchanged' -Condition ((ConvertTo-Json -InputObject @($f.Registry.Values | Sort-Object key) -Depth 5 -Compress) -ceq $beforeRecords)
    [void]$f.Observations.Add([pscustomobject]@{ name = 'survivor keys'; actual = $actualKeys; expected = $expectedKeys; confirmedAliveKey = $current.key; conservativelyRetainedKey = $uncertain.key })
    Complete-S14Fixture -ExpectedPidCalls 7 -ExpectedCimCalls 4

    $allPassed = ($script:CompletedFixtures.Count -eq 4 -and $script:AllFixtureFaults.Count -eq 0 -and @($script:Assertions | Where-Object { -not $_.passed }).Count -eq 0)
    if (-not $allPassed) { throw 'Incomplete or failed fixture accounting' }
    $report = [ordered]@{
        status = $(if ($allPassed) { 'PASS' } else { 'FAIL' })
        level = 'Synthetic production-function identity safety only; not full S14 integration'
        sourceSha256 = $sourceHash; sourceFunctions = $script:Imports.ToArray()
        assertionCount = $script:Assertions.Count; fixtures = $script:CompletedFixtures.ToArray()
        limitations = @('No real process existence/survival proof', 'No real CIM', 'No descendant discovery, grace timing, or capture verdict integration', 'Unknown retained is not confirmed alive')
    }
    Write-Output ($report | ConvertTo-Json -Depth 12)
    exit 0
}
catch {
    $failureReport = [ordered]@{
        status = 'FAIL'; error = $_.Exception.Message
        fixture = $(if ($null -eq $script:Fixture) { 'setup' } else { $script:Fixture.Name })
        assertions = $script:Assertions.ToArray(); fixtureFaults = $script:AllFixtureFaults.ToArray()
        completedFixtures = $script:CompletedFixtures.ToArray()
        activeCalls = $(if ($null -eq $script:Fixture) { @() } else { $script:Fixture.Calls.ToArray() })
    }
    Write-Output ($failureReport | ConvertTo-Json -Depth 12)
    exit 1
}
