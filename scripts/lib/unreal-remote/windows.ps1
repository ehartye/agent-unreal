param([Parameter(Mandatory)][ValidateSet('Launch','Identity')][string]$Action,[Parameter(Mandatory)][string]$Message)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$m=Get-Content -Raw -LiteralPath $Message | ConvertFrom-Json
if($m.version -ne 1){throw 'Unsupported Windows boundary message'}
if($Action -eq 'Identity'){
    try {$p=[Diagnostics.Process]::GetProcessById([int]$m.pid)} catch [ArgumentException] {@{pid=[int]$m.pid;absent=$true}|ConvertTo-Json -Compress;exit}
    try {@{pid=[int]$p.Id;created=$p.StartTime.ToUniversalTime().Ticks.ToString()} | ConvertTo-Json -Compress} finally {$p.Dispose()}
    exit
}
# CIM is the sole SSH-session boundary. Creation is not readiness or engine containment.
# The Node worker must complete an identity-bound ready/permit handshake and then uses the shared launcher.
foreach($s in @($m.node,$m.worker,$m.job)){
    if($s -isnot [string] -or -not [IO.Path]::IsPathFullyQualified($s) -or $s -match '["\x00-\x1f]'){throw 'Invalid worker launch path'}
}
$startup=New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]0}
$command='"'+$m.node+'" "'+$m.worker+'" "'+$m.job+'"'
$result=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=$command;CurrentDirectory=$m.job;ProcessStartupInformation=$startup}
if($result.ReturnValue -ne 0 -or $result.ProcessId -le 0){throw ('Detached worker creation failed: '+$result.ReturnValue+'; inspect CIM permission and installed Node/PowerShell paths; no workload permit was issued')}
@{pid=[int]$result.ProcessId} | ConvertTo-Json -Compress
