param([Parameter(Mandatory)][int]$ProcessId,[Parameter(Mandatory)][string]$Created)
$ErrorActionPreference='Stop'
# Native fault injection only: retain the matched process handle before killing.
$owned=[Diagnostics.Process]::GetProcessById($ProcessId)
try {
    if($owned.StartTime.ToUniversalTime().Ticks.ToString() -ne $Created){throw 'Fixture process creation identity mismatch'}
    $owned.Kill()
    if(-not $owned.WaitForExit(5000)){throw 'Fixture owned process did not exit'}
} finally {$owned.Dispose()}
