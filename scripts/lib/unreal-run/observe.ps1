param([ValidateSet('process','file')][string]$Kind,[int]$ProcessId,[string]$Path)
$ErrorActionPreference='Stop'
if($Kind -eq 'process'){
    $observed=[Diagnostics.Process]::GetProcessById($ProcessId)
    try {$observed.StartTime.ToUniversalTime().Ticks.ToString()} finally {$observed.Dispose()}
} else {[Diagnostics.FileVersionInfo]::GetVersionInfo($Path).FileVersion}
