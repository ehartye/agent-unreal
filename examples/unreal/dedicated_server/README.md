# Dedicated servers on an installed engine: the Server target and a packaged Game as a server

Run the launcher commands below from the plugin root. They wrap each complete probe in the [shared owned process tree](../engine_lock/README.md); retained scientific results describe their original runs.

Status: ran on Windows (a throwaway project, an installed Launcher engine, no source build). **Q1 validated in 1 of 3 runs:** the Server target does not build; Unreal Build Tool exits 6 in about 3 seconds with "Server targets are not currently supported from this engine distribution." **Q2 partial in 2 of 3 runs:** the packaged Game builds and stages (49 s editor build, 82 s package), but `-server -log -nullrhi -port=7777` leaves it a Standalone process with no listening line; started with `?listen` instead it listens on 7777, a second process of the same build is welcomed and logs the replicated integer (4 of 4 checks, net mode ListenServer). **Editor Q1 and Q2 validated in 1 of 3 runs (5 of 5 checks):** the editor binary started as `-server -game -log -nullrhi -port=7777` logs `net mode DedicatedServer, IsRunningDedicatedServer 1` and `IpNetDriver listening on port 7777` 7 s after start, and the packaged Game (editor build 41 s, package 82 s) joins it: `Welcomed by server`, `client received Value=4242`. **Q3 recorded in 1 of 3 runs:** the packaged Game started as `-server -game` logs `net mode Standalone, IsRunningDedicatedServer 0` and never logs the listening line (waited 30 s), the same outcome as `-server` alone. Both server processes were stopped by the probe, which started them. The runner deletes its project folders on a clean run (disk use was not measured).

## The questions

- **Q1.** Does a Server target build with an installed (Launcher) engine, or does Unreal Build Tool refuse it, as Epic's "Setting up dedicated servers" page implies when it says to use a source build? The probe writes `<Project>Server.Target.cs` (`Type = TargetType.Server`, a copy of the Game target otherwise) into a throwaway code project and runs `Build.bat <Project>Server Win64 Development` with the compiler and SDK flags the Editor build uses. It records the exit code and the build tool's message word for word.
- **Q2.** Can a packaged Game build (the plugin's existing recipe, `RunUAT BuildCookRun ... -build -cook -stage -pak -archive`) be started with `-server -log -nullrhi -port=7777` and accept a second process of the same build at `127.0.0.1:7777`, and does an integer the server sets on a replicated Actor appear in the client's log?
- **Editor Q1.** Given the project built as an editor target, is the editor binary started as `UnrealEditor.exe <Project>.uproject <map URL> -server -game -log -nullrhi -port=7777` a dedicated server: does its log carry `net mode DedicatedServer, IsRunningDedicatedServer 1` and the engine's `IpNetDriver listening on port 7777` line? If not, the report records the net mode it logged, whether it listened and how the process ended.
- **Editor Q2.** Given that held, does the packaged Game from the Q2 recipe, started as a second process at `127.0.0.1:7777`, log `Welcomed by server` and `client received Value=4242`?
- **Q3.** Started as `<Project>.exe <map URL> -server -game -log -nullrhi -port=7777` (`--variant server-game`), what net mode and `IsRunningDedicatedServer` value does the module log, and does the listening line appear?

## What it does

```text
pwsh -NoProfile -File examples/unreal/engine_lock/with-engine-lock.ps1 node examples/unreal/dedicated_server/ds_probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--only target,packaged,editor] [--keep] [--variant server|server-game|listen] [--port 7777] [--project <kept folder> --skip-package] [--seconds 90]
```

1. `target`: writes the project (module `module/DsProbe`, the Game, Editor and Server targets), runs the Server-target build through `buildGame()` from `../native-build.mjs` (it builds whatever target name it is given), and prints the build tool's error and result lines.
2. `packaged`: writes the same project with no Server target, builds the Editor target, packages with `packageGame()`, starts the packaged executable as a server and, once the server log holds the engine's listening line, a second process of the same build as the client. Both write their own logs (`-abslog`). The probe kills only the two processes it started.
3. `editor`: writes the same project, builds the Editor target, packages the Game (the client), starts the engine's editor binary as the server (`editorServerArguments()`) and, once its log holds the listening line, the packaged Game as the client. `--project <kept folder> --skip-package` runs it again without building. The probe records the net mode the module logged whatever it is, and how the server process ended.
4. Every process the probe starts has a hard time limit (the server `2n + 60` s, the client `n + 60` s for `--seconds n`); the probe stops it by its own process id and descendants, and touches no other process.
5. Judges with `ds-probe-checks.mjs`: PASS, FAIL or OBSERVE per check, "N of M checks passed", exit code 0 when every asserted check passes. Logs and a `receipt.json` are copied to an evidence folder (printed at the end).

The module is one replicated Actor (`ADsProbeActor`, one `int32 Value` with `ReplicatedUsing`) and a Game Mode that spawns it on the server and logs its net mode. The server sets `Value = 4242`; the client logs `DsProbe: client received Value=4242`. The map is the engine's stock `/Engine/Maps/Entry`; the Game Mode comes from the project default and the `?game=` option.

| Check | Judged by |
|---|---|
| Q1 build gave a definite answer | exit 0 (built), or a non-zero exit with "Server targets are not currently supported from this engine distribution." |
| Q1 message recorded | the error and result lines of the build log |
| Q2 packaged Game built and staged | the editor build and the package exited 0 and the executable exists |
| Q2 server reports listening | the engine's `IpNetDriver listening on port <n>` line in the server log |
| Q2 client reports a connection | `Welcomed by server` in the client log and `Join succeeded` in the server log |
| Q2 replicated value reaches the client log | the server's `server set Value=4242` and the client's `client received Value=4242` |
| Editor: build and packaged client staged | the editor build and the package exited 0 and the packaged executable exists |
| Editor: server reports listening | the engine's `IpNetDriver listening on port <n>` line in the editor-binary server's log |
| Editor: server is a dedicated server | the module's line `net mode DedicatedServer, IsRunningDedicatedServer 1` |
| Editor: packaged client reports a connection, replicated value reaches the client log | as for Q2 |
| Editor: server net mode (observed) | the net mode, the listening flag and how the process ended, whatever they are |
| Q2 server net mode (observed) | the Game Mode's `net mode` line: `DedicatedServer` for a dedicated server |
| Q3 (`--variant server-game`) | the same checks, labelled Q3 |

## What the runs showed

- **Q1, run 1.** The build tool compiled the project's rules (the Server target file included) and then refused the target type in `UEBuildTarget.CreateRulesObject` before any module was compiled. The log's words, in order: `Server targets are not currently supported from this engine distribution.`, `BuildException: Server targets are not currently supported from this engine distribution.`, `Result: Failed (OtherCompilationError)`, `Total execution time: 2.36 seconds`. The build tool prints the exception without an `ERROR:` prefix, which the message capture handles by taking the line before `Result: Failed`.
- **Q2, run 1 (`-server`).** The server's own log: `LogDsProbe: DsProbe: game mode started, net mode Standalone, IsRunningDedicatedServer 0`, and no `IpNetDriver listening on port` line in 735 lines. The client was not started. An earlier reading of `Misc/CoreMisc.h` suggested the `-server` switch is read only in editor builds; no run confirmed it.
- **Q2, run 2 (`--variant listen`, the packaged build of run 1).** Server: `IpNetDriver listening on port 7777`, `net mode ListenServer`, `server set Value=4242`, `Join succeeded`. Client: `Welcomed by server`, `client received Value=4242`.
- **Editor, run 1 (`--only editor --seconds 150`).** Server (editor binary), word for word: `IpNetDriver listening on port 7777`, `DsProbe: game mode started, net mode DedicatedServer, IsRunningDedicatedServer 1`, `DsProbe: server set Value=4242`, `Join succeeded`. Client (packaged Game): `Welcomed by server (Level: /Engine/Maps/Entry, Game: /Script/DsProbe.DsProbeGameMode)`, `DsProbe: client received Value=4242`. The network version check did not refuse the join. The server was still running when the probe stopped it.
- **Q3, run 1 (`--variant server-game`, the package of the editor run).** The server's log held `DsProbe: game mode started, net mode Standalone, IsRunningDedicatedServer 0` and `DsProbe: server set Value=4242`, no `IpNetDriver listening on port` line (735 lines), and the process ran on until the probe stopped it. The client was not started.
- **Smallest next experiment.** The same module built as a Server target on a source build of the engine, cooked for the Server target, started with `-log` and the same client. Not run: a source build is an owner decision.

## Files

| File | What |
|---|---|
| `ds_probe.mjs` | the runner (Windows and Node only) |
| `module/DsProbe/` | the game module: the replicated Actor and the Game Mode |
| `ds-probe-checks.mjs`, `ds-probe.test.mjs` | the judge (Server target source, build-message capture, log parsers, checks) and its test, part of `node scripts/check.mjs` |

## Not covered

Linux servers, containers, a source build of the engine, the Client target, a cook with the build target set to Server, Iris, and any hosting service. The editor-binary server is a record of what runs on an installed engine, not a statement about licensing or suitability for a release.
