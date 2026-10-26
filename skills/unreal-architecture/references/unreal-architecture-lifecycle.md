# Lifecycle, object handling, Blueprint boundary and data

Source for every `[documented]` line here: Epic's 5.8 pages "Unreal Engine Actor Lifecycle", "Object Pointers in Unreal Engine", "Unreal Object Handling in Unreal Engine", "Coding in Unreal Engine: Blueprint vs. C++", "Blueprint Best Practices in Unreal Engine", "Data Assets in Unreal Engine", "Data Registries in Unreal Engine", "Using Gameplay Tags in Unreal Engine" and "Common Memory and CPU Performance Considerations in Unreal Engine".

## Actor and component lifecycle

- `[documented]` An Actor already in a level loads from its package: `PostLoad`, then initialization, then `BeginPlay` when the level starts. A spawned Actor runs `PostActorCreated`, `ExecuteConstruction`, `OnConstruction` and `PostActorConstruction`, then `BeginPlay`. `PostLoad` and `PostActorCreated` are mutually exclusive.
- `[documented]` Component initialization order is the same on every path: `PreInitializeComponents`, `InitializeComponent` for each component, then `PostInitializeComponents`.
- `[documented]` Deferred spawn (`SpawnActorDeferred`) is "meant to spawn procedural Actors" and allows setup before the construction script; `FinishSpawning` resumes.
- `[documented]` `EndPlay` is the guaranteed end-of-life callback, called on `Destroy`, level transitions, streaming unload, lifetime expiry and shutdown. `OnDestroyed` is legacy; move its logic to `EndPlay`. `EndPlay` does not necessarily mean destruction.

## Object pointers and garbage collection

- `[documented]` Raw `T*` for locals and parameters; `TObjectPtr<T>` for a persistent reference on a `UCLASS` or `USTRUCT` (GC-safe only as a `UPROPERTY`); `TSoftObjectPtr<T>` for an asset that must not force a load; `TWeakObjectPtr<T>` for a non-owning reference or cache; `TStrongObjectPtr<T>` only for a non-`UObject` owner. `TLazyObjectPtr` is deprecated.
- `[documented]` Existing `UPROPERTY` raw pointers "should migrate" to `TObjectPtr` where possible. A raw pointer that is not a `UPROPERTY` is not nulled and does not keep the object alive.
- `[documented]` Never access a `UObject` through a `TObjectPtr` from a worker thread unless it is rooted; use `TWeakObjectPtr` and `Pin()` instead.
- `[documented]` Processing spikes often occur on frames when the garbage collector runs. Manual collection suits a loading screen; pooling pays off most for Actors; replace Tick polling with callbacks, timers or tick intervals; spread large spawns over frames.

## Blueprint and C++

- `[documented]` Epic: "use C++ as the foundation and build Blueprint classes on top of it". The performance difference is "usually insignificant"; it matters most in core low-level code, tight loops, large data sets and many ticking instances.
- `[documented]` Expose C++ with `UPROPERTY(BlueprintReadWrite)`, `UFUNCTION(BlueprintCallable)` and `UBlueprintFunctionLibrary`; call into Blueprint with `BlueprintImplementableEvent` and `BlueprintNativeEvent`; bind widgets with `meta=(BindWidget)`.
- `[documented]` Blueprints suit event-driven logic. Blueprint Classes are the reusable unit; Level Blueprints are for one-off, level-specific work. Schedule Blueprint work with timers or delegates, not Tick, and profile with Unreal Insights before converting to C++.

## Data-driven design

- `[documented]` Use Data Only Blueprints when data must inherit; `UPrimaryDataAsset` adds a Primary Asset Id and asset bundles for the Asset Manager.
- `[documented]` A Data Registry is read-only global storage for `USTRUCT` data. Session data such as story progress belongs in Save Game. Use data immediately or copy it, because cached items can unload without warning.
- `[documented]` Gameplay Tags are hierarchical labels; objects usually carry an `FGameplayTagContainer`; native tags use the `NativeGameplayTags.h` macros and the `GameplayTags` module in `Build.cs`.

## Judgements built on it

- `[general]` A class that finds the player or another actor every frame in `Tick` is a candidate to cache the reference in `BeginPlay` or resolve it through an event; rank it by instance count and measured cost, not by the pattern alone.
- `[general]` Teardown in `OnDestroyed` or a destructor that `EndPlay` should own is a lifetime finding. Hard asset pointers to specific meshes or sounds on gameplay classes are usually better as soft references or data assets (see [content](unreal-architecture-content.md)).
- `[general]` Epic gives no count at which a tag set or data table needs a registry; recommend one only when several systems read the same read-only data.

## How to inspect

1. `[general]` Read `BeginPlay`, `EndPlay` and `Tick` bodies of the busiest classes; list per-frame searches and teardown placement.
2. `[general]` List `UPROPERTY` pointer types; flag raw pointers and unneeded hard asset references.
3. `[general]` List what each Blueprint-exposed boundary exposes and which direction the dependency runs.

Next: [audit](unreal-architecture-audit.md).
