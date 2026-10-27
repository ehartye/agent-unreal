# Networking and replication in Unreal 5.8: when to use it and how to drive it

Target: Unreal Engine 5.8, Windows. Multiplayer is client-server and server-authoritative: the server holds the true game state, clients request actions with RPCs on Pawns they own, and the server replicates state back (Epic).

## Enable it

Generic replication is built in and is the default. Plugins:

| Plugin | Category | Enabled by default | Flags (descriptor) | Epic documentation label |
|---|---|---|---|---|
| `Iris` | Networking | no | beta | Experimental |
| `ReplicationGraph` | Performance | no | beta | none stated |
| `NetworkPrediction` | Gameplay | no | beta | see [Mover](unreal-mover.md) |

- Iris is the newest replication system and runs alongside the generic one; the generic system stays the default until you opt in (Epic).
- Opt in: add `{ "Name": "Iris", "Enabled": true }` to the `.uproject`, call `SetupIrisSupport(Target);` in the module `*.Build.cs`; set `bUseIris = true;` in `*.Target.cs`; under `[SystemSettings]` in `DefaultEngine.ini` set `net.SubObjects.DefaultUseSubObjectReplicationList=1` and `net.Iris.UseIrisReplication=1`. The net driver lists Iris in `IrisNetDriverConfigs`; `-UseIrisReplication=1` or `=0` toggles it at launch (Epic).
- Iris requires the registered subobject list and does not support Replication Graph (Epic migration guide).

## Use it when

- More than one player shares a world: the server simulates it.
- Per-connection control of what objects send, and how often: Iris adds filtering and prioritization (Epic).
- A listen server suits casual or small sessions; a dedicated server suits fairness and scale (Epic).

## Use something else when

- Use [Mover](unreal-mover.md) for rollback-predicted movement built on Network Prediction.
- Use the Replication Graph plugin (generic system) for very large actor counts. Epic does not mark it superseded; Iris does not support it.
- Replication is C++ and Blueprint work; Python does not run at runtime (Epic).

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Replicate an actor | C++ / Blueprint | `bReplicates = true;` in the constructor; Blueprint: enable Replicate in the Details panel |
| Replicate a property | C++ | `UPROPERTY(Replicated)` plus `DOREPLIFETIME(Class, Prop)` in `GetLifetimeReplicatedProps` |
| React on clients | C++ / Blueprint | `UPROPERTY(ReplicatedUsing=OnRep_X)` with `UFUNCTION() void OnRep_X()`; a Blueprint Set node calls it |
| Limit who receives | C++ | `DOREPLIFETIME_CONDITION(Class, Prop, COND_OwnerOnly)`; also `COND_SkipOwner`, `COND_InitialOnly` |
| Remote call | C++ / Blueprint | `UFUNCTION(Server, Reliable, WithValidation)`, `Client`, `NetMulticast`, with `_Implementation` and `_Validate`; Blueprint: Custom Event, Replicates |
| Check role | C++ / Blueprint | `GetLocalRole()`, `GetRemoteRole()`: `ROLE_Authority`, `ROLE_AutonomousProxy`, `ROLE_SimulatedProxy` |
| Relevancy and priority, Iris | C++ / config | Iris Filtering (owner, connection, group, dynamic) via `[/Script/IrisCore.NetObjectFilterDefinitions]`; Iris Prioritization (`SphereNetObjectPrioritizer` default) |
| Dormancy | C++ | `SetNetDormancy(DORM_DormantAll)`, `FlushNetDormancy()`, `ForceNetUpdate()` |
| PIE players and mode | Editor UI | `LevelEditorPlaySettings`: `PlayNetMode`, `PlayNumberOfClients` (1 to 10), `RunUnderOneProcess`, `bLaunchSeparateServer`, `ServerPort` are `EditAnywhere` in the 5.8 install header; Epic does not document this class; see the Python result below |

Dedicated server setup, the numbered workflow and the net console commands are in [Networking workflow](unreal-networking-workflow.md).

Related: [Gameplay Ability System](unreal-gameplay-ability-system.md), [Enhanced Input](unreal-enhanced-input.md).

## Replicated play on one machine

`examples/unreal/gas_native/gas_rep.mjs` ran a dedicated server and one client on one machine: 10 of 10 checks (the tenth records that the readings are present), after two fixes to the example's own probe.

- [tested] Launch from the editor target (no Game target, no packaging, no `-log`): server `UnrealEditor-Cmd.exe <uproject> /Engine/Maps/Entry?game=<game mode class> -server -game -Port=<free UDP port> -nullrhi -abslog=<file> -unattended -nosplash -nosound -notraceserver -nopause`; client `UnrealEditor.exe <uproject> 127.0.0.1:<port> -game -nullrhi -windowed -ResX=640 -ResY=360 -abslog=<file>`. The server was ready 4 to 8 s after launch and the scenario took 23 to 27 s across the runs; both processes exited 0.
- [tested] An Ability System Component in Mixed mode on a player state (`SetIsReplicated(true)`), with a replicated attribute (Energy 100) and, on join, a granted LocalPredicted ability and an infinite effect (+5 Energy, grants a tag), replicated to the owning client: component Mixed and owned by its player state, the ability listed, the effect active, its tag owned, Energy 105 current and 100 base. After the client's predicted activation (cost 10): client predicted activations 1, server authority activations 1, Energy 90 base and 95 current on both.
- [tested] With the player state as both owner and avatar, `TryActivateAbilityByClass` on the owning client returned false with no log line at default verbosity, even after calling `InitAbilityActorInfo` again; with the pawn as avatar the same call returned true. The client's player state had local role `SimulatedProxy`; its pawn `AutonomousProxy`.
- [documented] `UGameplayAbility::CanActivateAbility` returns false when the avatar's local role is `ROLE_SimulatedProxy` (`ShouldActivateAbility`, `Engine/Plugins/Runtime/GameplayAbilities/Source/GameplayAbilities/Private/Abilities/GameplayAbility.cpp`, lines 445 and 463 in the 5.8 install).
- [general] Make the pawn the avatar and the player state the owner: in the run above the pawn as avatar activated and the player state as avatar did not.
- [tested] `LevelEditorPlaySettings` was not found as a Python class (0 properties read), so the Play settings route is not scriptable by that name from the example's probe.
- [general] Not covered by these runs: Play In Editor itself, more than one client, Minimal and Full replication modes, Iris, lag or loss, a listen server, a Game target.

## Sources

- [Networking Overview](https://dev.epicgames.com/documentation/unreal-engine/networking-overview-for-unreal-engine)
- [Replicate Actor Properties](https://dev.epicgames.com/documentation/unreal-engine/replicate-actor-properties-in-unreal-engine)
- [Remote Procedure Calls](https://dev.epicgames.com/documentation/unreal-engine/remote-procedure-calls-in-unreal-engine)
- [Actor Role and Remote Role](https://dev.epicgames.com/documentation/en-us/unreal-engine/actor-role-and-remote-role-in-unreal-engine), [Actor Relevancy](https://dev.epicgames.com/documentation/en-us/unreal-engine/actor-relevancy-in-unreal-engine)
- [Actor Owner and Owning Connection](https://dev.epicgames.com/documentation/en-us/unreal-engine/actor-owner-and-owning-connection-in-unreal-engine), [Actor Network Dormancy](https://dev.epicgames.com/documentation/en-us/unreal-engine/actor-network-dormancy-in-unreal-engine)
- [Iris Replication System](https://dev.epicgames.com/documentation/en-us/unreal-engine/iris-replication-system-in-unreal-engine), [Introduction to Iris](https://dev.epicgames.com/documentation/unreal-engine/introduction-to-iris-in-unreal-engine?lang=en-US), [Migrate to Iris](https://dev.epicgames.com/documentation/en-us/unreal-engine/migrate-to-iris-in-unreal-engine)
- [Iris Filtering](https://dev.epicgames.com/documentation/en-us/unreal-engine/iris-filtering-in-unreal-engine), [Iris Prioritization](https://dev.epicgames.com/documentation/en-us/unreal-engine/iris-prioritization-in-unreal-engine), [Replication Graph](https://dev.epicgames.com/documentation/unreal-engine/replication-graph-in-unreal-engine)
- [Play In Editor Multiplayer Options](https://dev.epicgames.com/documentation/en-us/unreal-engine/play-in-editor-multiplayer-options-in-unreal-engine)
- [Setting Up Dedicated Servers](https://dev.epicgames.com/documentation/unreal-engine/setting-up-dedicated-servers-in-unreal-engine)
- [Console Commands for Network Debugging](https://dev.epicgames.com/documentation/unreal-engine/console-commands-for-network-debugging-in-unreal-engine?lang=en-US), [Testing and Debugging Networked Games](https://dev.epicgames.com/documentation/unreal-engine/testing-and-debugging-networked-games-in-unreal-engine)
- [Scripting the Unreal Editor using Python](https://dev.epicgames.com/documentation/unreal-engine/scripting-the-unreal-editor-using-python)
- The Iris, ReplicationGraph and NetworkPrediction plugin descriptors and `LevelEditorPlaySettings.h` in the 5.8 install.
