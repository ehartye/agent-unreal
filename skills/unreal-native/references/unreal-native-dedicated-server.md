# Dedicated servers on an installed engine: the Server target, a packaged Game and the editor binary as a server

Unreal 5.8, Windows, an engine installed from the Launcher (not a source build). The runs used a throwaway code project with one replicated Actor holding one replicated integer; the probe is [dedicated_server](../../../examples/unreal/dedicated_server/README.md). Run labels (Q1 run 1, Q2 run 1, Q2 run 2; D-Q1 run 1, D-Q3 run 1) are the entries of that probe's run log, all on 2026-10-30, 3 runs allowed per question. No source build of the engine was made. For replication itself see [Networking and replication](../../unreal-gameplay/references/unreal-networking-and-replication.md).

Read [Dedicated-server run evidence](unreal-native-dedicated-server-runs.md) for the exact outcomes and their measured limits.

## Steps and flags that worked

1. [tested] Package the Game target with the existing recipe in [Native packaging](unreal-native-packaging.md) and [Packaging staging](unreal-native-packaging-staging.md) (Q2 run 1).
2. [tested] Host with the map URL option `?listen`: `<Project>.exe /Engine/Maps/Entry?game=<game mode class>?listen` and no `-server` (Q2 run 2). The engine's `IpNetDriver listening on port 7777` line is the listening signal; poll the log for it before starting a client.
3. [tested] Join with a second process of the same package and the address as the first argument (Q2 run 2). Judge by logs: `Welcomed by server` in the client, `Join succeeded` in the server, the replicated value in the client's `OnRep`.
4. [tested] Give each process its own `-abslog=<file>` so the two logs stay apart, and kill only the process ids you started (Q2 runs 1 and 2, D-Q1 run 1).
5. [tested] Dedicated server without a source build: build the project's editor target, then start `UnrealEditor.exe <Project>.uproject <map URL>?game=<game mode> -server -game -log -nullrhi -port=7777` with the project file first (D-Q1 run 1). Poll its log for `IpNetDriver listening on port 7777` and `net mode DedicatedServer, IsRunningDedicatedServer 1`; it listened 7 s after start.
6. [tested] Join it with the packaged Game and the address as the first argument, `<Project>.exe 127.0.0.1:7777 -log -nullrhi` (D-Q2 run 1). `-server -game` on the packaged Game does not host (D-Q3 run 1); use `?listen` (step 2) for a listen server.
7. [general] The repo's earlier example ran a server from the Editor target with `-server -game -Port=<n> -nullrhi`; see [Networking and replication](../../unreal-gameplay/references/unreal-networking-and-replication.md). That is the editor binary, not a packaged Game.

## Epic's documented steps

From Epic's page 'Setting Up Dedicated Servers' (5.8, Windows, Lyra, Development configuration):

- [documented] Requirements: 'You must use a source build of Unreal Engine' and a C++ project that supports client-server play. It gives no reason.
- [documented] Add `<Project>Server.Target.cs` and `<Project>Client.Target.cs` to `Source/` if absent. Build the Development Server solution configuration in Visual Studio; `<Project>Server.exe` appears in `Binaries/Win64`. Then build Development Client for `<Project>Client.exe`.
- [documented] Cook in the editor with Platforms > Windows > Build Target set to Server and Binary Configuration Development. The output is `Saved/Cooked/WindowsServer`. Running the server before cooking fails with missing shaders.
- [documented] Run `./Binaries/Win64/<Project>Server.exe -log`. It listens on `127.0.0.1` port 7777 by default; `-port=<N>` changes it and the client address must follow. Connect with `<Project>Client.exe 127.0.0.1:7777 -WINDOWED -ResX=800 -ResY=450`.

## Where the sources disagree

Only Epic's page is official; the rest are vendor or anecdotal, with no run output.

- [documented] Vendor blog (StraySpark, medium quality): 'you cannot build a server target from the launcher (binary) version of Unreal Engine'; Linux adds a version-pinned cross-compile toolchain. It cites no Epic page. Q1 run 1 agrees for a Windows Development Server target.
- [documented] Vendor documentation (Edgegap): 'Don't build Unreal Engine from Source'; a Docker extension builds the Linux server. It does not say which engine the extension uses.
- [documented] Vendor CI documentation (Tempo Simulation): builds and packages in Epic's `unreal-engine:dev-slim-<version>` container image 'with the engine as Epic ships it'.
- [documented] Forum thread (anecdotal): a respondent says `BuildPlugin` support for server plugins is 'not supported out of the box' and, speaking as the engine's distributor ('we likely distributing'), guesses that a Launcher engine includes the dedicated server plugins, without confirming it.
- [general] Q1 run 1 tests one thing: a Windows Server target with `Build.bat` on a Launcher install. It cannot confirm or refute the Edgegap and Tempo routes, which do not state their engine.

## Not established

- [general] A Server target on a source build of the engine, its Server cook, and whether the same module then logs `DedicatedServer` and accepts the client. The smallest next experiment, and an owner decision.
- [general] Linux servers, containers, cloud hosting, the Client target, a cook with the build target set to Server, Iris tuning and Multi-Server.
- [general] Any other flag or route that makes a packaged Game listen without `?listen`. `-server` (Q2 run 1) and `-server -game` (D-Q3 run 1) both left it Standalone with no listening line; nothing else was tried.
- [general] [Remote suites](../../unreal-verify/references/unreal-remote-jobs.md) have separate acceptance; these server results remain one-machine observations.
