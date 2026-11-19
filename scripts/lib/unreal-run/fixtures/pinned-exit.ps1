param([Parameter(Mandatory)][string]$Node)
$ErrorActionPreference='Stop'
$lib=Split-Path $PSScriptRoot
Add-Type -Path (Join-Path $lib 'native.cs')
. (Join-Path $lib 'pinned-members.ps1')
$job=[UnrealRun.EngineJob]::new();$other=[UnrealRun.EngineJob]::new()
$pi=[Diagnostics.ProcessStartInfo]::new($Node);$pi.UseShellExecute=$false;$pi.CreateNoWindow=$true
$pi.ArgumentList.Add('-e');$pi.ArgumentList.Add('setTimeout(()=>{},1200)')
$p=[Diagnostics.Process]::Start($pi);$pins=@{}
try {
    $job.Assign($p);if(!$job.Contains($p)){throw 'Fixture containment not established'}
    $id=$p.Id;$identity=@{pid=$id;created=$p.StartTime.ToUniversalTime().Ticks.ToString()};$pins[$id]=@{process=$p;identity=$identity}
    if($null -ne (Find-PinnedExit $pins $id $job)){throw 'Live process mistaken for a witnessed exit'}
    if(!$p.WaitForExit(5000)){throw 'Inert child did not exit within the budget'}
    if((Find-PinnedExit $pins $id $job).identity.created -cne $identity.created){throw 'Exact exit not witnessed'}
    if($null -ne (Find-PinnedExit $pins ($id+1) $job)){throw 'Unobserved PID mistaken for a witnessed exit'}
    $rejected=$false;try {$null=Find-PinnedExit $pins $id $other}catch{$rejected=$true}
    if(!$rejected){throw 'Foreign Job accepted the witness'}
    Close-PinsExcept $pins @()
    if($pins.Count -or $null -ne (Find-PinnedExit $pins $id $job)){throw 'Forgotten handle authorized later PID reuse'}
    Write-Output 'pinned-exit verified: exact exit, live, unknown, foreign job, retirement'
} finally {Close-PinsExcept $pins @();$job.Dispose();$other.Dispose();$p.Dispose()}
