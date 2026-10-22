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
| PIE players and mode | Editor UI; Python by reflection | `LevelEditorPlaySettings`: `PlayNetMode`, `PlayNumberOfClients` (1 to 10), `RunUnderOneProcess`, `bLaunchSeparateServer`, `ServerPort` are `EditAnywhere` in the 5.8 install header, so `set_editor_property` should reach them (Epic: `EditAnywhere` members are editor properties); Epic does not document this class; not run |

Dedicated server (Epic): needs a source build and a C++ project. Add Server and Client `*.Target.cs` files, build Development Server and Client, cook each, set Server Default Map. Run `<Project>Server.exe -log` (port 7777, `-port=<N>`), then `<Project>Client.exe 127.0.0.1:7777 -WINDOWED` per client.

## Workflow

1. Keep state on the server. Replicate state with properties, including variables that drive visuals and audio (meshes, particles and sounds do not replicate by default); use RPCs (no return value) for transient or cosmetic events (Epic).
2. Call a Server RPC from the owning client on a replicated actor. Reliable RPCs resend until acknowledged and cost bandwidth; use sparingly. Add `WithValidation` to Server RPCs; a failed validation disconnects the caller (Epic).
3. Set ownership through the PlayerController chain: the owning connection decides who can call Server RPCs, where Client RPCs run and who receives `bOnlyRelevantToOwner` actors (Epic).
4. Set relevancy per actor with `NetCullDistanceSquared`, `bAlwaysRelevant` and `bOnlyRelevantToOwner`; override `AActor::IsNetRelevantFor` for custom rules (Epic).
5. Wake a dormant actor with `SetNetDormancy(DORM_Awake)` or `FlushNetDormancy` before changing its replicated properties, then set it back to `DORM_DormantAll` (Epic).
6. Migrating to Iris: set `bReplicateUsingRegisteredSubObjectList = true;` in the actor constructor; override `RegisterReplicationFragments` for UObject subobjects; use `FIrisFastArraySerializer` for fast arrays; list reflection-safe custom-`NetSerialize` structs under `SupportsStructNetSerializerList` in `[/Script/IrisCore.ReplicationStateDescriptorConfig]`. Dormancy, properties and RPCs work as before (Epic).
7. Test in PIE. Number of Players is the total; Net Mode is Standalone, Listen Server or Client (Client starts a dedicated server in the background). Run Under One Process loads faster but is less representative (Epic).
8. Enable Network Emulation in PIE (Average, Bad or Custom profile) or use `NetEmulation.*`.
9. Check final behaviour on dedicated server builds; use Networking Insights for traffic and Gauntlet for multi-session tests (Epic).

Net console commands (Epic): `net.DebugDraw`, `net.ActorReport`, `net.DumpRelevantActors`, `net.ListActorChannels`, `net.Replication.DebugProperty`, `NetEmulation.PktLag`, `PktLoss`, `PktEmulationProfile`, `NetEmulation.Off`; Iris: `net.iris.UseIrisReplication`. Append `?` to a variable to read it.

Related: [Gameplay Ability System](unreal-gameplay-ability-system.md), [Enhanced Input](unreal-enhanced-input.md).

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
