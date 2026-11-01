param([Parameter(Mandatory)][string]$Request, [ValidateSet('run','status','clear-stale')][string]$Action='run', [Parameter(Mandatory)][int]$SupervisorPid)
$ErrorActionPreference='Stop'
$r=Get-Content -Raw -LiteralPath $Request | ConvertFrom-Json -AsHashtable
$requestHash=(Get-FileHash -LiteralPath $Request -Algorithm SHA256).Hash.ToLowerInvariant()
$productionLock='Global\agent-plugins-engine-runs'
if($r.version -ne 1 -or $r.kind -ne 'unreal-run/request'){throw 'Invalid request version'}
if($r.purpose -eq 'production'){
    if($r.lock -ne $productionLock -or $r.fault){throw 'Production isolation override refused'}
    if([IO.Path]::GetFullPath($r.state) -ne [IO.Path]::GetFullPath((Join-Path $env:ProgramData 'agent-unreal/engine-runs'))){throw 'Production state override refused'}
} elseif($r.purpose -ne 'fixture' -or $r.lock -notmatch '^Global\\agent-unreal-fixture-[a-f0-9-]{36}$'){throw 'Invalid isolated fixture request'}
function Write-Json([string]$Path,$Value){
    $temporary=$Path+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
    [IO.File]::WriteAllText($temporary,($Value|ConvertTo-Json -Depth 30))
    [IO.File]::Move($temporary,$Path,$true)
}
function Identity($Process){@{pid=$Process.Id;created=$Process.StartTime.ToUniversalTime().Ticks.ToString()}}
function Observe($Expected){
    $live=$null
    try {
        try {$live=[Diagnostics.Process]::GetProcessById([int]$Expected.pid)} catch [ArgumentException] {return 'gone'}
        if($live.StartTime.ToUniversalTime().Ticks.ToString() -ne $Expected.created){return 'reused'}
        if($live.HasExited){return 'gone'}
        return 'live'
    } catch {return 'unknown'} finally {if($live){$live.Dispose()}}
}
function Read-Json([string]$Path){Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json -AsHashtable}
function Wait-Record([string]$Name){
    $deadline=[DateTime]::UtcNow.AddSeconds(15)
    while([DateTime]::UtcNow -lt $deadline){
        Check-Owner
        if($gate.HasExited){throw "Gate exited before $Name"}
        $path=Join-Path $r.evidence $Name
        if(Test-Path -LiteralPath $path){$value=Read-Json $path;if($value.requestHash -ne $requestHash){throw 'Gate record request mismatch'};return $value}
        Start-Sleep -Milliseconds 30
    }
    throw "Gate bounded handshake expired: $Name"
}
function Check-Owner {
    if((Observe $controller) -ne 'live'){$script:cancelled=$true;throw 'Controller process identity is no longer live'}
    $cancelPath=Join-Path $r.evidence 'cancel.json'
    if(Test-Path -LiteralPath $cancelPath){$c=Read-Json $cancelPath;if($c.id -eq $r.id -and $c.requestHash -eq $requestHash){$script:cancelled=$true;throw 'Requested cancellation'}}
}
function Publish-Owner {
    $owner.processes=$processes.ToArray()
    Write-Json $ownerPath $owner
}
function Observe-JobMember([int]$MemberId) {
    # Membership is a snapshot: an exiting process can remain listed briefly
    # after GetProcessById can no longer open it. Reconcile for at most one second;
    # neither disappearance nor this reconciliation is the final Job drain proof.
    $clock=[Diagnostics.Stopwatch]::StartNew();$attempt=0;$lastFailure=$null
    while($true){
        Check-Owner
        if($workWatch.ElapsedMilliseconds -ge $r.timeoutMs){$script:timedOut=$true;throw 'Bounded workload timeout during member observation'}
        $member=$null;$stage='open';$failure=$null;$attempt++
        try {
            if($r.fault -eq 'observation' -or ($r.fault -eq 'observation-once' -and $attempt -eq 1)){throw [IO.IOException]::new('Injected process observation query failure')}
            $member=[Diagnostics.Process]::GetProcessById($MemberId)
            $stage='creation-identity';$value=Identity $member
            $stage='job-membership'
            if(-not $job.Contains($member)){throw 'Observed process is not in the owned Job'}
            if($attempt -gt 1){
                $diagnostic=@{pid=$MemberId;stage=$stage;attempt=$attempt;elapsedMs=$clock.ElapsedMilliseconds;listed=$true;outcome='identity-observed';identity=$value;error=$lastFailure;observed=[DateTime]::UtcNow.ToString('o')}
                [IO.File]::AppendAllText((Join-Path $r.evidence 'member-observations.jsonl'),(($diagnostic|ConvertTo-Json -Depth 10 -Compress)+[Environment]::NewLine))
            }
            return $value
        } catch {
            $failure=@{type=$_.Exception.GetType().FullName;message=$_.Exception.Message;detail=$_.Exception.ToString();stack=$_.ScriptStackTrace}
        } finally {if($member){$member.Dispose()}}
        $lastFailure=$failure
        try {$listed=$MemberId -in $job.ProcessIds()} catch {
            throw ("Job membership recheck failed for PID {0} after {1}: {2}; membership query: {3}" -f $MemberId,$stage,$failure.detail,$_.Exception.ToString())
        }
        $outcome=if(-not $listed){'no-longer-listed'}elseif($clock.ElapsedMilliseconds -ge 1000){'unresolved'}else{'retry'}
        $diagnostic=@{pid=$MemberId;stage=$stage;attempt=$attempt;elapsedMs=$clock.ElapsedMilliseconds;listed=$listed;outcome=$outcome;error=$failure;observed=[DateTime]::UtcNow.ToString('o')}
        [IO.File]::AppendAllText((Join-Path $r.evidence 'member-observations.jsonl'),(($diagnostic|ConvertTo-Json -Depth 10 -Compress)+[Environment]::NewLine))
        if(-not $listed){return $null}
        if($outcome -eq 'unresolved'){throw ("Unobservable live Job member PID {0} after bounded reconciliation at {1}: {2}" -f $MemberId,$stage,$failure.detail)}
        Start-Sleep -Milliseconds 25
    }
}
function External-Engines {
    # Detection only. These processes are NEVER terminated by this helper.
    @(Get-EngineContention -Processes @(Get-CimInstance Win32_Process -ErrorAction Stop) -Node $r.node)
}
. (Join-Path $PSScriptRoot 'contention.ps1')
[IO.Directory]::CreateDirectory($r.state)|Out-Null
$ownerPath=Join-Path $r.state 'owner.json'
$lastPath=Join-Path $r.state 'last.json'
if($Action -eq 'status'){
    $value=@{version=1;kind='unreal-run/status';lock=$r.lock;owner=$null;state='idle'}
    if(Test-Path -LiteralPath $ownerPath){try {$value.owner=Read-Json $ownerPath;$value.state='held-or-quarantined';$value.elapsedSeconds=([DateTime]::UtcNow-[DateTime]::Parse($value.owner.started)).TotalSeconds}catch{$value.state='corrupt';$value.error=$_.Exception.Message}}
    $value|ConvertTo-Json -Depth 30;exit 0
}
$mutex=[Threading.Mutex]::new($false,$r.lock)
$held=$false;$job=$null;$gate=$null;$probe=$null;$controller=$null;$helper=$null;$owner=$null
$processes=[Collections.Generic.List[object]]::new();$errors=[Collections.Generic.List[string]]::new()
$permitIssued=$false;$contained=$false;$probeContained=$false;$cancelled=$false;$timedOut=$false;$exitCode=74;$forced=$false
$drain=@{proved=$false;active=$null;members=$null;requestHash=$requestHash;observed=$null}
$started=[DateTime]::UtcNow.ToString('o');$gateIdentity=$null;$probeIdentity=$null;$permit=$null
try {
    $controllerProcess=[Diagnostics.Process]::GetProcessById([int]$r.controllerPid)
    try {$controller=Identity $controllerProcess;if($controller.created -ne $r.controllerCreated){throw 'Controller creation identity mismatch'}} finally {$controllerProcess.Dispose()}
    $helperProcess=[Diagnostics.Process]::GetCurrentProcess()
    try {$helper=Identity $helperProcess} finally {$helperProcess.Dispose()}
    $supervisorProcess=[Diagnostics.Process]::GetProcessById($SupervisorPid)
    try {$supervisor=Identity $supervisorProcess} finally {$supervisorProcess.Dispose()}
    $watch=[Diagnostics.Stopwatch]::StartNew();$nextHeartbeat=0
    while(-not $held){
        Check-Owner
        try {$held=$mutex.WaitOne([Math]::Min(250,[int]$r.waitMs))}catch [Threading.AbandonedMutexException]{$held=$true}
        if($held){break}
        if($watch.ElapsedMilliseconds -ge $nextHeartbeat){
            $holder=if(Test-Path -LiteralPath $ownerPath){Get-Content -Raw -LiteralPath $ownerPath}else{'legacy holder or ownership evidence unavailable'}
            [Console]::Error.WriteLine("Waiting for $($r.lock); holder: $holder")
            $nextHeartbeat=$watch.ElapsedMilliseconds+5000
        }
        if($watch.ElapsedMilliseconds -ge $r.waitMs){throw 'Bounded lock wait expired'}
    }
    if($Action -eq 'clear-stale'){
        if(-not(Test-Path -LiteralPath $ownerPath)){throw 'Recovery refused: absent ownership evidence'}
        $ownerHash=(Get-FileHash -LiteralPath $ownerPath -Algorithm SHA256).Hash.ToLowerInvariant()
        $old=Read-Json $ownerPath
        $observations=@()
        foreach($p in $old.processes){
            $state=Observe $p;$observations+=@{pid=$p.pid;expectedCreated=$p.created;state=$state}
        }
        # The mutex stays held across observation, shared policy and removal.
        $policyInput=@{ownerPath=$ownerPath;ownerHash=$ownerHash;lock=$r.lock;purpose=$r.purpose;observations=$observations}
        $policyOutput=ConvertTo-Json -InputObject $policyInput -Depth 30 -Compress | & $r.node (Join-Path $PSScriptRoot 'recovery.mjs')
        if($LASTEXITCODE -ne 0){throw 'Recovery refused: policy process failed'}
        $decision=ConvertFrom-Json -InputObject ($policyOutput -join [Environment]::NewLine) -AsHashtable -NoEnumerate
        if($decision -isnot [System.Collections.IDictionary] -or $decision.allowed -isnot [bool] -or $decision.reason -isnot [string] -or -not $decision.reason -or $decision.ownerHash -isnot [string] -or $decision.lock -isnot [string] -or $decision.ownerHash -cne $ownerHash -or $decision.lock -cne $r.lock){throw 'Recovery refused: invalid policy response'}
        if(-not $decision.allowed){throw "Recovery refused: $($decision.reason)"}
        if((Get-FileHash -LiteralPath $ownerPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ownerHash){throw 'Recovery refused: ownership evidence changed'}
        $recovery=@{version=1;kind='unreal-run/recovery';id=$r.id;lock=$r.lock;allowed=$true;owner=$old;ownerHash=$ownerHash;observations=$observations;reason=$decision.reason;observed=[DateTime]::UtcNow.ToString('o')}
        Write-Json (Join-Path $r.evidence 'recovery.json') $recovery
        Remove-Item -LiteralPath $ownerPath
        $recovery|ConvertTo-Json -Depth 30
        exit 0
    }
    if(Test-Path -LiteralPath $ownerPath){throw 'Unresolved ownership blocks launch; inspect status and evidence before clear-stale'}
    $processes.Add($controller);$processes.Add($supervisor);$processes.Add($helper)
    $owner=@{version=1;kind='unreal-run/owner';id=$r.id;requestHash=$requestHash;lock=$r.lock;purpose=$r.purpose;started=$started;command=@($r.executable)+@($r.arguments);controller=$controller;helper=$helper;phase='pre-permit';permitIssued=$false;processes=@();drain=$null;evidence=$r.evidence}
    Publish-Owner
    Add-Type -Path (Join-Path $PSScriptRoot 'native.cs')
    $job=[UnrealRun.EngineJob]::new()
    if($r.purpose -eq 'production'){
        $external=@(External-Engines)
        if($external.Count){Write-Json (Join-Path $r.evidence 'contention.json') @{observed=[DateTime]::UtcNow.ToString('o');processes=$external};throw 'External engine contention; no workload dispatched'}
    }
    if(($job.LimitFlags() -band 0x2000) -eq 0 -or ($job.LimitFlags() -band 0x1800) -ne 0){throw 'Job containment flags invalid'}
    $start=[Diagnostics.ProcessStartInfo]::new($r.node)
    $start.UseShellExecute=$false;$start.CreateNoWindow=$true
    foreach($a in @((Join-Path $PSScriptRoot 'gate.mjs'),$Request)){$start.ArgumentList.Add($a)}
    $gate=[Diagnostics.Process]::Start($start)
    $gateIdentity=Identity $gate;$processes.Add($gateIdentity);Publish-Owner
    if($r.fault -eq 'containment'){throw 'Injected containment refusal before permit'}
    $job.Assign($gate)
    $contained=$job.Contains($gate)
    if(-not $contained){throw 'Gate containment not established'}
    $ready=Wait-Record 'gate-ready.json'
    if($ready.pid -ne $gate.Id){throw 'Gate PID mismatch'}
    $permit=@{requestHash=$requestHash;nonce=$r.nonce;gate=$gateIdentity}
    Write-Json (Join-Path $r.evidence 'probe-permit.json') $permit
    $probeReady=Wait-Record 'probe-ready.json'
    $probe=[Diagnostics.Process]::GetProcessById([int]$probeReady.pid)
    $probeIdentity=Identity $probe;$processes.Add($probeIdentity);Publish-Owner
    $probeContained=$job.Contains($probe)
    if(-not $probeContained -or $probe.HasExited){throw 'Live inert child is outside owned Job'}
    Write-Json (Join-Path $r.evidence 'probe-complete.json') $permit
    $null=Wait-Record 'probe-exited.json'
    Check-Owner
    if($r.purpose -eq 'production' -and @(External-Engines).Count){throw 'External engine contention before workload permit'}
    # Persist intent BEFORE publishing permission. A crash between these writes is conservative.
    $owner.permitIssued=$true;$owner.phase='running';Publish-Owner
    $permitIssued=$true
    Write-Json (Join-Path $r.evidence 'workload-permit.json') $permit
    $workWatch=[Diagnostics.Stopwatch]::StartNew()
    while(-not $gate.HasExited){
        Check-Owner
        if($workWatch.ElapsedMilliseconds -ge $r.timeoutMs){$timedOut=$true;throw 'Bounded workload timeout'}
        foreach($memberId in $job.ProcessIds()){
            $memberIdentity=Observe-JobMember $memberId
            if($null -ne $memberIdentity -and -not @($processes|Where-Object {$_.pid -eq $memberIdentity.pid -and $_.created -eq $memberIdentity.created}).Count){$processes.Add($memberIdentity);Publish-Owner}
        }
        if($r.fault -eq 'accounting' -and $workWatch.ElapsedMilliseconds -gt 400){throw 'Injected ambiguous accounting'}
        Start-Sleep -Milliseconds 50;$gate.Refresh()
    }
    $gate.WaitForExit();$exitCode=$gate.ExitCode
    $result=Read-Json (Join-Path $r.evidence 'workload-result.json')
    if($result.requestHash -ne $requestHash -or $result.exitCode -ne $exitCode -or $result.error){throw 'Missing or contradictory workload result'}
} catch {
    $errors.Add($_.Exception.Message);[Console]::Error.WriteLine($_.Exception.Message)
    if($Action -eq 'clear-stale'){Write-Json (Join-Path $r.evidence 'recovery.json') @{version=1;kind='unreal-run/recovery';id=$r.id;lock=$r.lock;allowed=$false;reason=$_.Exception.Message;observed=[DateTime]::UtcNow.ToString('o')}}
}
finally {
    if($owner){
        try {
            if($job -and $job.ActiveProcesses() -gt 0){$forced=$true;$job.Terminate()}
            # This exact handle is a pre-permit gate, never an arbitrary PID/name.
            if($gate -and -not $permitIssued -and -not $gate.HasExited){$gate.Kill();if(-not $gate.WaitForExit(5000)){throw 'Uncontained inert gate did not exit'}}
            $end=[DateTime]::UtcNow.AddSeconds(10)
            while($job -and $job.ActiveProcesses() -gt 0 -and [DateTime]::UtcNow -lt $end){Start-Sleep -Milliseconds 50}
            if($job){$active=$job.ActiveProcesses();$members=@($job.ProcessIds());$drain=@{proved=($active -eq 0 -and $members.Count -eq 0);active=$active;members=$members;requestHash=$requestHash;observed=[DateTime]::UtcNow.ToString('o')}}
            if($r.fault -eq 'accounting'){$drain.proved=$false;$drain.active=$null;$drain.members=$null}
        } catch {$errors.Add('cleanup: '+$_.Exception.Message)}
        $receipt=@{version=1;kind='unreal-run/lifecycle';id=$r.id;purpose=$r.purpose;operation=$r.operation;requestHash=$requestHash;lock=$r.lock;started=$started;finished=[DateTime]::UtcNow.ToString('o');controller=$controller;helper=$helper;gate=$gateIdentity;probe=$probeIdentity;processes=$processes.ToArray();contained=$contained;probeContained=$probeContained;permitIssued=$permitIssued;permit=if($permitIssued){$permit}else{$null};exitCode=$exitCode;cancelled=$cancelled;timedOut=$timedOut;forcedCleanup=$forced;drain=$drain;errors=$errors.ToArray()}
        try {
            Write-Json (Join-Path $r.evidence 'lifecycle.json') $receipt
            $owner.drain=$drain;$owner.phase=if($drain.proved){'drained'}elseif($permitIssued){'unknown-after-permit'}else{'pre-permit'};Publish-Owner
            Write-Json $lastPath $receipt
            if($drain.proved){Remove-Item -LiteralPath $ownerPath}
            elseif(-not $permitIssued -and -not $gate){Remove-Item -LiteralPath $ownerPath}
        } catch {$errors.Add('receipt: '+$_.Exception.Message);[Console]::Error.WriteLine($_.Exception.Message)}
    }
    elseif($Action -eq 'run'){
        Write-Json (Join-Path $r.evidence 'lifecycle.json') @{version=1;kind='unreal-run/lifecycle';id=$r.id;purpose=$r.purpose;operation=$r.operation;requestHash=$requestHash;lock=$r.lock;started=$started;finished=[DateTime]::UtcNow.ToString('o');controller=$controller;helper=$helper;gate=$null;probe=$null;processes=@($controller,$helper)|Where-Object {$null -ne $_};contained=$false;probeContained=$false;permitIssued=$false;permit=$null;exitCode=74;cancelled=$cancelled;timedOut=$false;drain=$drain;errors=$errors.ToArray()}
    }
    if($probe){$probe.Dispose()};if($gate){$gate.Dispose()};if($job){$job.Dispose()}
    if($held){$mutex.ReleaseMutex()};$mutex.Dispose()
}
if($errors.Count -or ($owner -and -not $drain.proved)){exit 74}
exit $exitCode
