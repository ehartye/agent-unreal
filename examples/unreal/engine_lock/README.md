# Engine lock wrapper

`with-engine-lock.ps1` serialises Unreal Editor, UnrealBuildTool, importer and GPU runs across concurrent agents on one machine with a named OS mutex. A mutex cannot be deleted by mistake and is released if the holder dies.

```
pwsh -NoProfile -File with-engine-lock.ps1 [--no-lock] <command> [args...]
```

- The default mutex is `Global\agent-plugins-engine-runs`, so this copy and an older copy of the script that uses the same name exclude each other. `ENGINE_LOCK_NAME` replaces the name (the tests use a unique one).
- `ENGINE_LOCK_TIMEOUT_MIN` bounds the wait (default 240). Exit codes: 2 usage, 3 lock not acquired, otherwise the command's.
- While it waits it prints the holder's command and start time, then a line every `ENGINE_LOCK_HEARTBEAT_SECONDS` (default 60), and a line when it acquires.
- `--no-lock` runs a read-only scan that starts no engine process without taking the lock.
- A command with one argument runs with that argument, and an empty-string argument is kept (`$PSNativeCommandArgumentPassing = 'Standard'`).
- `bash` that resolves to the System32 WSL launcher is refused with a message; pass the full path of Git Bash's `bash.exe`.
- From Git Bash, a drive-letter argument such as `-script=C:/x` is rewritten by the shell before PowerShell sees it. Call the wrapper from a `.ps1`, or set `MSYS_NO_PATHCONV=1` for the call.

## Tests

`node --test examples/unreal/engine_lock/engine-lock.test.mjs` covers the one-argument and empty-argument cases, exit codes, usage, `--no-lock` while another call holds the lock, the waiting line naming the holder, and the timeout. It needs Windows and `pwsh` and skips elsewhere; it never touches the shared mutex.

## Not verified

The wrapper has not been run under a real engine or build, and Git Bash path conversion is documented, not worked around.
