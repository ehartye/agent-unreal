<#
.SYNOPSIS
  Runs the side-by-side comparison scene (Source/AECompare.h) from a packaged game or an editor-launched game and checks what it wrote.

.DESCRIPTION
  Non-live: starts the game off-screen at 1920x1080 on the comparison game mode, waits for it to exit, then checks compare.png and compare-b.png are valid 1920x1080 PNGs, that
  compare.json parses and names this scenario and screenshot, and that every candidate has a stress result with a screenshot. Prints a table of the candidates' frame times.
  Live (-Live): opens the same scene in a window with no time limit and no capture, until you quit it.

  The frame times are wall-clock times between game ticks of the whole process (game thread, render thread and GPU together), on whatever machine ran this. They are not isolated costs.

.PARAMETER Exe
  The game to run: a packaged game's executable, or UnrealEditor.exe (then also pass -ExtraArguments with the project path and -game).
.PARAMETER Set
  The comparison set to run (the name a static FRegistrar registered). The example set is called 'example'.
.PARAMETER OutputDirectory
  Where the artifacts go. Must not exist; it is created. Not needed for -Live (a log is written there if you give one).
.PARAMETER Count
  Copies of each candidate in the stress phase. A candidate may name a smaller number of its own; the receipt records what each was timed at.
.PARAMETER Warmup
  Seconds the showcase runs before the first frame is filmed.
.PARAMETER StressSeconds
  Seconds each candidate is timed alone.
.PARAMETER Live
  Open the scene in a window instead of filming it. Up/Down (D-pad up/down) double/halve the copies, Left/Right (D-pad, left stick) orbit, right stick dollies, Esc/B/Back quit.
.PARAMETER GameMode
  The comparison game mode's class path: /Script/<YourModule>.AECompareGameMode. Replace YourModule with the name of the C++ module that holds AECompare.h.
.PARAMETER Map
  Any map in the project. It is only the level the game mode runs in; the comparison builds its own stage.
.PARAMETER ExtraArguments
  Arguments placed before the map, for example the .uproject path and -game when -Exe is UnrealEditor.exe.
.PARAMETER TimeoutSeconds
  Non-live only: kill the game and fail after this long.

.EXAMPLE
  ./compare.ps1 -Exe D:\Builds\MyGame\Windows\MyGame.exe -Set example -OutputDirectory D:\out\compare-1 -GameMode /Script/MyGame.AECompareGameMode -Map /Game/Maps/Main
#>
param(
    [Parameter(Mandatory)][string]$Exe,
    [string]$Set = 'example',
    [string]$OutputDirectory,
    [ValidateRange(1, 5000)][int]$Count = 332,
    [ValidateRange(0.5, 30)][double]$Warmup = 2.5,
    [ValidateRange(0.5, 30)][double]$StressSeconds = 2,
    [switch]$Live,
    [string]$GameMode = '/Script/YourModule.AECompareGameMode',
    [string]$Map = '/Game/Maps/Main',
    [string[]]$ExtraArguments = @(),
    [ValidateRange(10, 3600)][int]$TimeoutSeconds = 300
)
$ErrorActionPreference = 'Stop'
$invariant = [Globalization.CultureInfo]::InvariantCulture

if (-not (Test-Path -LiteralPath $Exe -PathType Leaf)) { throw "Executable not found: $Exe" }
$Exe = [IO.Path]::GetFullPath($Exe)
if ($GameMode -like '*YourModule*') { Write-Warning "-GameMode is still the placeholder '$GameMode'. Replace YourModule with your C++ module's name, or the game starts its normal game mode and no comparison runs." }

# Start-Process joins an argument array with spaces and no quoting, so quote anything that needs it.
function Format-Argument([string]$Value) { if ($Value -match '[\s"]') { '"' + ($Value -replace '"', '\"') + '"' } else { $Value } }

# "${Map}?game=..." and not "$Map?game=...": PowerShell reads the latter as the variable $Map?game.
$levelUrl = "${Map}?game=${GameMode}"

if ($Live) {
    $liveArguments = @($ExtraArguments) + @($levelUrl, '-windowed', '-ResX=1600', '-ResY=900', '-nosplash', '-notraceserver', "-AECompareSet=$Set", '-AECompareLive')
    if ($OutputDirectory) {
        $OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
        [IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
        $liveArguments += "-abslog=$(Join-Path $OutputDirectory 'live.log')"
    }
    Write-Host "Live comparison '$Set'. Up/Down (D-pad): double/halve the copies. Left/Right (D-pad, left stick): orbit. Right stick: in/out. Esc/B/Back: quit."
    $liveProcess = Start-Process -FilePath $Exe -ArgumentList (($liveArguments | ForEach-Object { Format-Argument $_ }) -join ' ') -PassThru
    $liveProcess.WaitForExit()
    return
}

if (-not $OutputDirectory) { throw '-OutputDirectory is required (it must not exist yet).' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $OutputDirectory) { throw "Output directory already exists; choose a fresh one: $OutputDirectory" }
[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null

$arguments = @($ExtraArguments) + @($levelUrl, '-RenderOffScreen', '-unattended', '-nosplash', '-notraceserver', '-NoGamepad', '-ResX=1920', '-ResY=1080', '-ForceRes',
    "-AECompareSet=$Set", "-AECaptureDir=$OutputDirectory", "-AECompareCount=$Count",
    "-AECompareWarmup=$($Warmup.ToString('R', $invariant))", "-AECompareStress=$($StressSeconds.ToString('R', $invariant))")

Write-Host "Comparing '$Set', $Count copies per candidate in the stress phase (a candidate may cap its own number)..."
$stdoutLog = Join-Path $OutputDirectory 'process-stdout.log'
$stderrLog = Join-Path $OutputDirectory 'process-stderr.log'
$watch = [Diagnostics.Stopwatch]::StartNew()
$process = Start-Process -FilePath $Exe -ArgumentList (($arguments | ForEach-Object { Format-Argument $_ }) -join ' ') -PassThru -NoNewWindow -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    $process.Kill($true)
    $process.WaitForExit()
    throw "The game did not exit within $TimeoutSeconds seconds and was killed. Logs: $stdoutLog"
}
$process.WaitForExit()   # lets redirected output finish flushing
if ($process.ExitCode -ne 0) { throw "The game exited with code $($process.ExitCode). Logs: $stdoutLog" }
Write-Host ("The game ran for {0:N1} s and exited with code 0." -f $watch.Elapsed.TotalSeconds)

# A PNG starts with an 8-byte signature, then the IHDR chunk, whose width and height are big-endian 32-bit numbers at byte 16 and 20.
function Assert-Png([string]$Path, [int]$Width, [int]$Height) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing artifact: $Path" }
    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -lt 33) { throw "PNG is truncated: $Path" }
    $signature = 137, 80, 78, 71, 13, 10, 26, 10
    for ($i = 0; $i -lt 8; $i++) { if ($bytes[$i] -ne $signature[$i]) { throw "Not a PNG (bad signature): $Path" } }
    if ([Text.Encoding]::ASCII.GetString($bytes, 12, 4) -cne 'IHDR') { throw "PNG has no IHDR chunk first: $Path" }
    $w = [int](([uint32]$bytes[16] -shl 24) -bor ([uint32]$bytes[17] -shl 16) -bor ([uint32]$bytes[18] -shl 8) -bor [uint32]$bytes[19])
    $h = [int](([uint32]$bytes[20] -shl 24) -bor ([uint32]$bytes[21] -shl 16) -bor ([uint32]$bytes[22] -shl 8) -bor [uint32]$bytes[23])
    if ($w -ne $Width -or $h -ne $Height) { throw "PNG must be ${Width}x${Height}; got ${w}x${h}: $Path" }
}

$shotA = Join-Path $OutputDirectory 'compare.png'
$shotB = Join-Path $OutputDirectory 'compare-b.png'
$receiptPath = Join-Path $OutputDirectory 'compare.json'
Assert-Png $shotA 1920 1080
Assert-Png $shotB 1920 1080
if (-not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) { throw "Missing receipt: $receiptPath" }
try { $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json } catch { throw "compare.json does not parse: $($_.Exception.Message)" }
if ($receipt.scenario -ne 'compare') { throw "Receipt scenario is '$($receipt.scenario)', not 'compare'" }
if ([IO.Path]::GetFullPath([string]$receipt.screenshot) -ne [IO.Path]::GetFullPath($shotA)) { throw "Receipt screenshot '$($receipt.screenshot)' is not $shotA" }
if ($receipt.set -ne $Set) { throw "Receipt is for set '$($receipt.set)', not '$Set'" }
if (@($receipt.candidates).Count -lt 1) { throw 'Receipt lists no candidates' }
foreach ($candidate in $receipt.candidates) {
    if (-not $candidate.PSObject.Properties['stress']) { throw "Candidate '$($candidate.id)' has no stress result" }
    if ($candidate.stress.frames -lt 10) { throw "Candidate '$($candidate.id)' was timed over only $($candidate.stress.frames) frames" }
    Assert-Png ([string]$candidate.stress.screenshot) 1920 1080
}

Write-Host ''
Write-Host ('{0,-24} {1,8} {2,8} {3,10} {4,10} {5,10} {6,10}' -f 'candidate', 'copies', 'frames', 'mean ms', 'p50 ms', 'p95 ms', 'max ms')
foreach ($candidate in $receipt.candidates) {
    $s = $candidate.stress
    $note = if ($candidate.PSObject.Properties['available'] -and -not $candidate.available) { '  (NOT AVAILABLE: ' + $candidate.problem + ')' } else { '' }
    Write-Host (('{0,-24} {1,8} {2,8} {3,10:N2} {4,10:N2} {5,10:N2} {6,10:N2}' -f $candidate.id, $s.copies, $s.frames, $s.frame_ms_mean, $s.frame_ms_p50, $s.frame_ms_p95, $s.frame_ms_max) + $note)
}
Write-Host ''
Write-Host "engine: $($receipt.engine_version)   adapter: $($receipt.rhi_adapter)"
Write-Host "side by side: $shotA (and $shotB)"
Write-Host "receipt: $receiptPath"
Write-Host 'One run proves little: repeat it, and treat differences within the spread between runs as noise.'
