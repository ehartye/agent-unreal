# Only a previously opened, job-verified OS handle is a witness. Do not reopen by PID.
function Find-PinnedExit($Pins,[int]$MemberId,$Job) {
    if(-not $Pins.ContainsKey($MemberId)){return $null}
    $saved=$Pins[$MemberId]
    # HasExited uses the handle populated by IsProcessInJob when it was live.
    if(-not $saved.process.HasExited){return $null}
    if(-not $Job.Contains($saved.process)){throw 'Pinned exit witness is not in the owned Job'}
    return $saved
}
function Close-PinsExcept($Pins,[int[]]$Listed) {
    foreach($id in @($Pins.Keys)){
        if($id -notin $Listed){$Pins[$id].process.Dispose();$Pins.Remove($id)}
    }
}
