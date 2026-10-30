# Networking and replication workflow in Unreal 5.8: ordered steps, dedicated server and console commands

Target: Unreal Engine 5.8, Windows. Companion to [Networking and replication](unreal-networking-and-replication.md), which covers enabling Iris, when to use replication and the driving table. This is the dedicated server setup and the steps in order.

## Dedicated server

Dedicated server (Epic): needs a source build and a C++ project. Add Server and Client `*.Target.cs` files, build Development Server and Client, cook each, set Server Default Map. Run `<Project>Server.exe -log` (port 7777, `-port=<N>`), then `<Project>Client.exe 127.0.0.1:7777 -WINDOWED` per client. What a Server target build and a packaged Game run as a server did on a Launcher install is in [Dedicated servers on an installed engine](../../unreal-native/references/unreal-native-dedicated-server.md).

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

Related: [Networking and replication](unreal-networking-and-replication.md), [Gameplay Ability System](unreal-gameplay-ability-system.md), [Enhanced Input](unreal-enhanced-input.md).

## Sources

The sources listed in [Networking and replication](unreal-networking-and-replication.md).
