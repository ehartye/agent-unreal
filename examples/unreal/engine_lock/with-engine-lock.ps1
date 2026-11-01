# Compatibility entry point. All ownership is in the shared Node launcher.
# Usage: pwsh -NoProfile -File with-engine-lock.ps1 [--no-lock] <executable> [args...]
$ErrorActionPreference = 'Stop'
$PSNativeCommandArgumentPassing = 'Standard'
$commandIndex = if ($args.Count -gt 0 -and $args[0] -eq '--no-lock') { 1 } else { 0 }
if ($args.Count -gt $commandIndex -and $args[$commandIndex] -eq 'bash') {
    $found = Get-Command bash -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found -and $found.Source -match '(?i)[\\/]system32[\\/]bash\.exe$') {
        [Console]::Error.WriteLine("'bash' resolves to the WSL launcher; pass the full path of Git Bash's bash.exe instead")
        exit 2
    }
}
& node (Join-Path $PSScriptRoot 'compat.mjs') @args
exit $LASTEXITCODE
