# Dedicated servers on an installed engine: the Server target and a packaged Game as a server

Status: ran on Windows (a throwaway project, an installed Launcher engine, no source build). **Q1 validated in 1 of 3 runs:** the Server target does not build; Unreal Build Tool exits 6 in about 3 seconds with "Server targets are not currently supported from this engine distribution." **Q2 partial in 2 of 3 runs:** the packaged Game builds and stages (49 s editor build, 82 s package), but `-server -log -nullrhi -port=7777` leaves it a Standalone process with no listening line; started with `?listen` instead it listens on 7777, a second process of the same build is welcomed and logs the replicated integer (4 of 4 checks, net mode ListenServer). The runner deletes its project folders on a clean run (disk use was not measured).

## The questions

- **Q1.** Does a Server target build with an installed (Launcher) engine, or does Unreal Build Tool refuse it, as Epic's "Setting up dedicated servers" page implies when it says to use a source build? The probe writes `<Project>Server.Target.cs` (`Type = TargetType.Server`, a copy of the Game target otherwise) into a throwaway code project and runs `Build.bat <Project>Server Win64 Development` with the compiler and SDK flags the Editor build uses. It records the exit code and the build tool's message word for word.
- **Q2.** Can a packaged Game build (the plugin's existing recipe, `RunUAT BuildCookRun ... -build -cook -stage -pak -archive`) be started with `-server -log -nullrhi -port=7777` and accept a second process of the same build at `127.0.0.1:7777`, and does an integer the server sets on a replicated Actor appear in the client's log?

## What it does

```text
node examples/unreal/dedicated_server/ds_probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--only target,packaged] [--keep] [--variant server|listen] [--port 7777]
```

1. `target`: writes the project (module `module/DsProbe`, the Game, Editor and Server targets), runs the Server-target build through `buildGame()` from `../native-build.mjs` (it builds whatever target name it is given), and prints the build tool's error and result lines.
2. `packaged`: writes the same project with no Server target, builds the Editor target, packages with `packageGame()`, starts the packaged executable as a server and, once the server log holds the engine's listening line, a second process of the same build as the client. Both write their own logs (`-abslog`). The probe kills only the two processes it started.
3. Judges with `ds-probe-checks.mjs`: PASS, FAIL or OBSERVE per check, "N of M checks passed", exit code 0 when every asserted check passes. Logs and a `receipt.json` are copied to an evidence folder (printed at the end).

The module is one replicated Actor (`ADsProbeActor`, one `int32 Value` with `ReplicatedUsing`) and a Game Mode that spawns it on the server and logs its net mode. The server sets `Value = 4242`; the client logs `DsProbe: client received Value=4242`. The map is the engine's stock `/Engine/Maps/Entry`; the Game Mode comes from the project default and the `?game=` option.

| Check | Judged by |
|---|---|
| Q1 build gave a definite answer | exit 0 (built), or a non-zero exit with "Server targets are not currently supported from this engine distribution." |
| Q1 message recorded | the error and result lines of the build log |
| Q2 packaged Game built and staged | the editor build and the package exited 0 and the executable exists |
| Q2 server reports listening | the engine's `IpNetDriver listening on port <n>` line in the server log |
| Q2 client reports a connection | `Welcomed by server` in the client log and `Join succeeded` in the server log |
| Q2 replicated value reaches the client log | the server's `server set Value=4242` and the client's `client received Value=4242` |
| Q2 server net mode (observed) | the Game Mode's `net mode` line: `DedicatedServer` for a dedicated server |

## What the runs showed

- **Q1, run 1.** The build tool compiled the project's rules (the Server target file included) and then refused the target type in `UEBuildTarget.CreateRulesObject` before any module was compiled. The log's words, in order: `Server targets are not currently supported from this engine distribution.`, `BuildException: Server targets are not currently supported from this engine distribution.`, `Result: Failed (OtherCompilationError)`, `Total execution time: 2.36 seconds`. The build tool prints the exception without an `ERROR:` prefix, which the message capture handles by taking the line before `Result: Failed`.
- **Q2, run 1 (`-server`).** The server's own log: `LogDsProbe: DsProbe: game mode started, net mode Standalone, IsRunningDedicatedServer 0`, and no `IpNetDriver listening on port` line in 735 lines. The client was not started. The engine header `Misc/CoreMisc.h` reads the `-server` switch for `IsRunningDedicatedServer()` only in an editor build; a Game binary returns false first.
- **Q2, run 2 (`--variant listen`, the packaged build of run 1).** Server: `IpNetDriver listening on port 7777`, `net mode ListenServer`, `server set Value=4242`, `Join succeeded`. Client: `Welcomed by server`, `client received Value=4242`.
- **Smallest next experiment.** The same module built as a Server target on a source build of the engine, cooked for the Server target, started with `-log` and the same client. Not run: a source build is an owner decision.

## Files

| File | What |
|---|---|
| `ds_probe.mjs` | the runner (Windows and Node only) |
| `module/DsProbe/` | the game module: the replicated Actor and the Game Mode |
| `ds-probe-checks.mjs`, `ds-probe.test.mjs` | the judge (Server target source, build-message capture, log parsers, checks) and its test, part of `node scripts/check.mjs` |

## Not covered

Linux servers, containers, a source build of the engine, the Client target, a cook with the build target set to Server, Iris, and any hosting service.
