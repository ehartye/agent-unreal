# Native Mass without the MassGameplay plugin in Unreal 5.8: a hand-run pipeline from C++

Target: Unreal Engine 5.8, Windows. Paths are install-relative under `Engine/Source/Runtime/` and were read in a 5.8.2 install. The recipe was used once on 5.8.3 for a crowd of tens of thousands of simple entities in a native C++ project, with no simulation phases, LOD, avoidance, movement, replication or representation. No run in this repository covers it, so no line here is `[tested]`.

## Enable it

- [documented] No plugin entry. `MassEntity` and `MassCore` are engine modules (`MassEntity/MassEntity.Build.cs`, `Mass/MassCore/MassCore.Build.cs`). `MassGameplay`, `MassAI`, `MassCrowd` and `ZoneGraph` stay experimental plugins ([AI](unreal-ai-behavior.md)).
- [documented] List `MassEntity` and `MassCore` in the game module's dependencies. `FMassFragment`, `FMassTag` and `FMassElement` are defined in MassCore (`Mass/MassCore/Public/Mass/EntityElementTypes.h`). [general] A link failure with only `MassEntity` listed was reported once on 5.8.3. The 5.8.2 `MassEntity.Build.cs` already lists MassCore as a public dependency, so the cause is unconfirmed; the extra entry costs nothing.

## Recipe

1. [documented] Get the entity manager from `UMassEntitySubsystem::GetMutableEntityManager()`. `CreateArchetype` takes the fragment and tag `UScriptStruct`s, and `BatchCreateEntities(Archetype, Count, OutEntities)` makes entities in a batch.
2. [documented] Write each processor as a `UMassProcessor` subclass with its queries in `ConfigureQueries(const TSharedRef<FMassEntityManager>&)`. In its constructor set `bAutoRegisterWithProcessingPhases = false` (default true) and `QueryBasedPruning = EMassQueryBasedPruning::Never` (default `Prune`), so only your code runs it. [general] Why `Never` mattered was not isolated; it was applied while getting the pipeline to run.
3. [documented] Have a gameplay actor own an `FMassRuntimePipeline`, fill it with `InitializeFromClassArray(Classes, *this, Manager.AsShared())` and run it from `Tick`: `UE::Mass::FProcessingContext Context(Manager, DeltaSeconds); UE::Mass::Executor::Run(Pipeline, Context);`. `Run` takes a non-const reference, so a temporary does not bind. [general] Declare the pipeline as a `UPROPERTY` so its processors stay referenced. The project relied on the listed order and it behaved; how the executor orders processors was not read.
4. [documented] Use `ParallelForEachEntityChunk` for hot processors. Put tag changes and destruction through the command buffer, `Context.Defer()`.
5. [general] Observed once: draw outside Mass. A query run by the actor reads the fragments and writes one instanced mesh component in a batch, with per-instance custom data for a material to read.

## First-contact failures

1. [documented] A query that is not part of a processor must run on a local execution context. On a processing context it asserts "ExecutionContextType mismatch, make sure all the queries run as part of processor execution are registered with some processor with a FMassEntityQuery::RegisterWithProcessor call" (`MassEntity/Private/MassEntityQuery.cpp`; the assert sits behind `WITH_MASSENTITY_DEBUG`). Build `FMassExecutionContext Local(Manager, 0.f, false)` (the constructor takes an `FMassEntityManager&`) and run the query on it; the context must come from the manager the query was built with. A draw query owned by the actor is the usual case.
2. [documented] `FMassFragment`, `FMassTag` and `FMassElement` live in MassCore, not MassEntity: list both modules (see Enable it).
3. [documented] `FMassRuntimePipeline::Processors` is private. Use `Reset()`, `Num()`, `GetProcessors()` and `InitializeFromClassArray`.
4. [documented] `FMassExecutionContext::DoesArchetypeHaveTag` takes a `TNotNull<const UScriptStruct*>`, or a tag type as a template argument. The overload taking a reference is `UE_DEPRECATED(5.8, ...)`, so passing a reference gets a deprecation diagnostic. `FMassEntityManager::AddTagToEntity` and `RemoveTagFromEntity` also take a `TNotNull<const UScriptStruct*>`: pass the tag's `StaticStruct()`.
5. [documented] A query has no `Initialize` method. Construct it with its owner: a processor passes itself (`FMassEntityQuery(*this)`), and a query outside any processor passes the entity manager as a shared pointer (`FMassEntityQuery(Manager.AsShared())`).
6. [general] A parameter named like a constant brought in by a `using namespace` elsewhere in the same unity chunk fails with C4459 on one machine and not another, because the chunks differ: [unity builds](../../unreal-native/references/unreal-native-unity-builds.md).

## A cost data point, with its limits

[general] Observed once on 5.8.3: one machine with a high-end GPU and an 8-core CPU at 1920 x 1080, entities with one body fragment and one mind fragment, six processors of which two run with `ParallelForEachEntityChunk`, drawn as one instanced mesh with three custom floats each. Each row is a 3 s mean.

| Entities | Processors, ms | Frame, ms | GPU, ms |
|---|---|---|---|
| 0 | not run | 4.99 | 4.35 |
| 1,000 | 0.19 | 5.01 | 4.37 |
| 10,000 | 0.45 | 5.14 | 4.51 |
| 40,000 | 1.19 | 8.60 | 5.26 |

- [general] The simulation stays near a millisecond at 40,000. The frame cost that shows is the game thread handing 40,000 transforms and their custom data to the instanced mesh.
- [general] Limits: one machine; a swarm that mostly drifts, with few hunting; no avoidance, pathing or collision between entities; parallel scaling on a machine with more cores was not measured. It is a data point for the by-hand route, not for the plugin's simulation or representation.

## Not covered

- The `MassGameplay` simulation route, Mass representation and LOD, avoidance, a StateTree hosted by Mass, replication, and the executor's processor ordering. Smart Object roosting from this pipeline is in [native Smart Objects](unreal-smart-objects-native.md).
