# Dedicated servers on an installed engine: the Server target and a packaged Game as a server

Unreal 5.8, Windows, an engine installed from the Launcher (not a source build). The runs below used a throwaway code project with one replicated Actor holding one replicated integer; the probe is [dedicated_server](../../../examples/unreal/dedicated_server/README.md). Run labels (Q1 run 1, Q2 run 1, Q2 run 2) are the entries of that probe's run log, all on 2026-10-30, 3 runs allowed per question. No source build of the engine was made. For replication itself see [Networking and replication](../../unreal-gameplay/references/unreal-networking-and-replication.md).

## What happened

- [tested] Q1 run 1: `Build.bat <Project>Server Win64 Development -Project=<uproject> ...` with a `<Project>Server.Target.cs` of `Type = TargetType.Server` exited 6 after 3 s. The build tool printed, word for word, `Server targets are not currently supported from this engine distribution.`, then a `BuildException` with the same sentence, then `Result: Failed (OtherCompilationError)`. The log shows the project's rules compiled and no module compile action ran. Epic's source-build rule held for this install.
- [tested] Q1 run 1: the build tool prints that exception without an `ERROR:` prefix. A judge that looks for `ERROR:` misses it; take the line before `Result: Failed`. The first judging of this run missed it and was corrected on the same log.
- [tested] Q2 run 1: the Game target built and packaged with the plugin's recipe (editor build 49 s, then `RunUAT BuildCookRun ... -build -cook -stage -pak -archive`, 82 s, both exit 0).
- [tested] Q2 run 1: the packaged `<Project>.exe /Engine/Maps/Entry?game=<game mode> -server -log -nullrhi -port=7777 -abslog=<file> -unattended -nosplash -nosound -notraceserver -NoGamepad` logged `net mode Standalone, IsRunningDedicatedServer 0`. Its log (735 lines) held no `IpNetDriver listening on port` line and the process was still running after 90 s. No client was started. The server set the integer to 4242 locally.
- [tested] Q2 run 2: the same package (no rebuild) started with `?listen` on the map URL and without `-server` logged `IpNetDriver listening on port 7777` and `net mode ListenServer, IsRunningDedicatedServer 0`, about 1 s after start. A second process of the same package, `<Project>.exe 127.0.0.1:7777 -log -nullrhi`, was welcomed (`Welcomed by server`; the server logged `Join succeeded`) and logged `client received Value=4242` and `client actor began with Value=4242`. 4 of 4 asserted checks passed.
- [tested] Q2 run 2 was a listen server (a server with a local player), not a dedicated one. The runs did not produce a packaged dedicated server, and they did not run a client against a Server-target binary.
- [general] Why `-server` did not make the packaged Game listen is not established. The runs show the outcome (Standalone, no listening line) and not the cause. The run log notes an engine-header reading of `IsRunningDedicatedServer()` made before the runs; no run confirmed it.

## Steps and flags that worked

1. [tested] Package the Game target with the existing recipe in [Native packaging](unreal-native-packaging.md) and [Packaging staging](unreal-native-packaging-staging.md) (Q2 run 1).
2. [tested] Host with the map URL option `?listen`: `<Project>.exe /Engine/Maps/Entry?game=<game mode class>?listen` and no `-server` (Q2 run 2). The engine's `IpNetDriver listening on port 7777` line is the listening signal; poll the log for it before starting a client.
3. [tested] Join with a second process of the same package and the address as the first argument (Q2 run 2). Judge by logs: `Welcomed by server` in the client, `Join succeeded` in the server and the replicated value in the client's `OnRep`.
4. [tested] Give each process its own `-abslog=<file>` so the two logs stay apart, and kill only the process ids you started (Q2 runs 1 and 2).
5. [general] The repo's earlier example ran a server from the Editor target with `-server -game -Port=<n> -nullrhi`; see [Networking and replication](../../unreal-gameplay/references/unreal-networking-and-replication.md). That is the editor binary, not a packaged Game.

## Epic's documented steps

From Epic's page 'Setting Up Dedicated Servers' (5.8, Windows, Lyra, Development configuration):

- [documented] Requirements: 'You must use a source build of Unreal Engine' and a C++ project that supports client-server play. The page gives no reason for the rule.
- [documented] Add `<Project>Server.Target.cs` and `<Project>Client.Target.cs` to `Source/` if absent. Build the Development Server solution configuration in Visual Studio; `<Project>Server.exe` appears in `Binaries/Win64`. Then build Development Client for `<Project>Client.exe`.
- [documented] Cook in the editor with Platforms > Windows > Build Target set to Server and Binary Configuration Development. The output is `Saved/Cooked/WindowsServer`. Running the server before cooking fails with missing shaders.
- [documented] Run `./Binaries/Win64/<Project>Server.exe -log`. It listens on `127.0.0.1` port 7777 by default; `-port=<N>` changes it and the client address must follow. Connect with `<Project>Client.exe 127.0.0.1:7777 -WINDOWED -ResX=800 -ResY=450`.
- [documented] The page does not use Build.bat or `RunUAT BuildCookRun`.

## Where the sources disagree

Only Epic's page is official. The rest are vendor or anecdotal, with no run output in the captures.

- [documented] Vendor blog (StraySpark, medium quality): 'you cannot build a server target from the launcher (binary) version of Unreal Engine'; Linux adds a version-pinned cross-compile toolchain. It cites no Epic page or error text. Q1 run 1 agrees for a Windows Development Server target.
- [documented] Vendor documentation (Edgegap): 'Don't build Unreal Engine from Source'; a Docker extension builds the Linux server. It does not say which engine the extension uses and asks for an Epic-linked GitHub account.
- [documented] Vendor CI documentation (Tempo Simulation): builds and packages in Epic's `unreal-engine:dev-slim-<version>` container image 'with the engine as Epic ships it'. It never mentions a server target.
- [documented] Forum thread (anecdotal): a respondent says `BuildPlugin` support for server plugins is 'not supported out of the box' and, speaking as the engine's distributor ('we likely distributing'), guesses that a Launcher engine includes the dedicated server plugins, without confirming it. A precompiled plugin without source failed a server target build with 'Missing precompiled manifest'.
- [general] Q1 run 1 tests one thing: a Windows Server target with `Build.bat` on a Launcher install. It cannot confirm or refute the Edgegap and Tempo routes, which do not state their engine.

## Not established

- [general] A Server target on a source build of the engine, its Server cook, and whether the same module then logs `DedicatedServer` and accepts the client. This is the smallest next experiment and an owner decision.
- [general] Linux servers, containers and cloud hosting.
- [general] The Client target, a cook with the build target set to Server, Iris tuning and Multi-Server.
- [general] Any other flag or route that makes a packaged Game listen without `?listen`. Only `-server` was tried (Q2 run 1).
- [general] A second machine or a different Launcher install. Each result stands as one machine's record.
