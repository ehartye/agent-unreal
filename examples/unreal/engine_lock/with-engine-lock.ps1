# Serialises Unreal Editor, UnrealBuildTool, importer and GPU runs across concurrent agents.
# Usage: pwsh -NoProfile -File with-engine-lock.ps1 [--no-lock] <command> [args...]
# The lock is a named OS mutex, not a file: it cannot be deleted by mistake and is released if the holder dies.
# ENGINE_LOCK_TIMEOUT_MIN (default 240) bounds the wait. ENGINE_LOCK_NAME overrides the mutex name (tests use it).
# --no-lock runs the command without taking the lock, for a read-only scan that starts no engine process.
# Exit codes: 2 usage, 3 lock not acquired, otherwise the command's.
# While it waits it prints the holder's command and start time, then a line every minute.
# From Git Bash pass drive paths through a .ps1 wrapper or set MSYS_NO_PATHCONV=1 for the call: the shell rewrites
# an argument such as -script=C:/x before PowerShell sees it.
$ErrorActionPreference = 'Stop'
$PSNativeCommandArgumentPassing = 'Standard'

$argv = @($args)
$noLock = $false
if ($argv.Count -gt 0 -and $argv[0] -eq '--no-lock') {
  $noLock = $true
  $argv = @($argv | Select-Object -Skip 1)
}
if ($argv.Count -eq 0) { [Console]::Error.WriteLine('usage: with-engine-lock.ps1 [--no-lock] <command> [args...]'); exit 2 }

$command = $argv[0]
$rest = @($argv | Select-Object -Skip 1)

# `bash` under PowerShell on Windows can be the WSL launcher in System32, which does not run Git Bash scripts.
if ($command -eq 'bash') {
  $found = Get-Command bash -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found -and $found.Source -match '(?i)[\\/]system32[\\/]bash\.exe$') {
    [Console]::Error.WriteLine("'bash' resolves to the WSL launcher ($($found.Source)); pass the full path of Git Bash's bash.exe instead")
    exit 2
  }
}

$script:wrappedCode = 0
function Invoke-Wrapped {
  & $command @rest
  $script:wrappedCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
}

if ($noLock) { Invoke-Wrapped; exit $script:wrappedCode }

$timeout = if ($env:ENGINE_LOCK_TIMEOUT_MIN) { [double]$env:ENGINE_LOCK_TIMEOUT_MIN } else { 240 }
$name = if ($env:ENGINE_LOCK_NAME) { $env:ENGINE_LOCK_NAME } else { 'agent-plugins-engine-runs' }
$sliceSeconds = if ($env:ENGINE_LOCK_HEARTBEAT_SECONDS) { [double]$env:ENGINE_LOCK_HEARTBEAT_SECONDS } else { 60 }
$holderFile = Join-Path ([System.IO.Path]::GetTempPath()) ("$name.holder")
$mutex = [System.Threading.Mutex]::new($false, "Global\$name")
$held = $false
$code = 0
try {
  $deadline = [DateTime]::UtcNow.AddMinutes($timeout)
  $announced = $false
  try {
    while (-not $held) {
      $remaining = $deadline - [DateTime]::UtcNow
      if ($remaining -le [TimeSpan]::Zero) { break }
      $slice = [TimeSpan]::FromSeconds([Math]::Min($sliceSeconds, $remaining.TotalSeconds))
      $held = $mutex.WaitOne($slice)
      if (-not $held) {
        $who = if (Test-Path -LiteralPath $holderFile) { (Get-Content -LiteralPath $holderFile -Raw).Trim() } else { 'unknown holder' }
        $prefix = if ($announced) { 'still waiting' } else { 'waiting' }
        [Console]::Error.WriteLine("$prefix for engine lock '$name' held by: $who")
        $announced = $true
      }
    }
  } catch [System.Threading.AbandonedMutexException] { $held = $true }

  if (-not $held) {
    [Console]::Error.WriteLine("engine lock not acquired within $timeout minutes")
    $code = 3
  } else {
    if ($announced) { [Console]::Error.WriteLine("engine lock '$name' acquired") }
    $line = "$command $($rest -join ' ') (pid $PID, started $([DateTime]::UtcNow.ToString('o')))"
    Set-Content -LiteralPath $holderFile -Value $line
    Invoke-Wrapped
    $code = $script:wrappedCode
  }
} finally {
  if ($held) {
    Remove-Item -LiteralPath $holderFile -ErrorAction SilentlyContinue
    $mutex.ReleaseMutex()
  }
}
exit $code
