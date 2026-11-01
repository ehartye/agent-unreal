function Get-EngineContention([object[]]$Processes, [string]$Node) {
    # Fixed, engine-free classifier. Its errors must never become an empty scan.
    $snapshot=@($Processes | ForEach-Object {
        @{pid=$_.ProcessId;created=if($_.CreationDate){$_.CreationDate.ToUniversalTime().Ticks.ToString()}else{$null};name=$_.Name;commandLine=$_.CommandLine}
    })
    $classifiedOutput=ConvertTo-Json -InputObject $snapshot -Depth 4 -Compress | & $Node (Join-Path $PSScriptRoot 'contention.mjs')
    if($LASTEXITCODE -ne 0){throw 'External engine classification failed; dispatch refused'}
    $classified=ConvertFrom-Json -InputObject ($classifiedOutput -join [Environment]::NewLine) -AsHashtable -NoEnumerate
    if($classified -isnot [array]){throw 'External engine classification returned an invalid snapshot; dispatch refused'}
    @($classified)
}
