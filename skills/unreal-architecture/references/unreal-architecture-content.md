# Content references and loading

Source for every `[documented]` line here: Epic's 5.8 pages "Asynchronous Asset Loading in Unreal Engine", "Asset Management in Unreal Engine" and "Reference Viewer in Unreal Engine".

## What Epic documents

- `[documented]` A hard `UObject` pointer property that references an asset causes that asset to load when the object containing the property loads. Epic: "If you are not careful, you can end up loading 100% of your assets at game startup time."
- `[documented]` `FSoftObjectPath` and `TSoftObjectPtr` give artists and designers the same picker as a hard pointer without always loading the asset. `TSoftObjectPtr::Get()` returns the object only if it is in memory; otherwise resolve `ToSoftObjectPath()` and load it.
- `[documented]` To find assets meeting a requirement without loading all of them, use the asset registry (properties need the `AssetRegistrySearchable` tag) and object libraries. A directory-based library lets artists add assets "without having to edit some manual master list".
- `[documented]` `FStreamableManager::RequestAsyncLoad` loads a group of assets and calls a delegate when they have all loaded or failed. It holds hard references until the delegate fires, then releases them; keep your own reference if assets must persist. `SynchronousLoad` can stall the main thread.
- `[documented]` The loading methods work identically in development and with cooked data on devices. Epic's stated payoff for converting code to asynchronous loading is "far fewer stalls and much lower memory usage".
- `[documented]` Only levels (`UWorld`) are Primary Assets by default. Another class becomes Primary by overriding `GetPrimaryAssetId`. Secondary Assets are loaded by the engine when Primary Assets reference them.
- `[documented]` An Asset Bundle is a named list of assets attached to a Primary Asset, created by tagging a soft-pointer property with the `AssetBundles` meta tag. `UPrimaryDataAsset` has built-in bundle support.
- `[documented]` Register Primary Asset types in Project Settings (Game, Asset Manager) or by overriding `StartInitialLoading` and calling `ScanPathsForPrimaryAssets`. Putting all assets of one type in one subfolder "will make discovery and registration faster". Project Settings can exclude directories such as test assets and mark production-only cooking.
- `[documented]` The Reference Viewer shows one-way reference graphs for selected assets or a folder. Edge types toggle with keys: Soft (`S`), Hard (`H`), Editor Only (`E`), Management (`M`), Name (`N`), C++ Packages (`C`). Search depth and breadth limit control graph size.
- `[documented]` Size Map gives a visual breakdown of an asset and its dependencies by size, on disk or in memory. Audit Assets opens the Asset Audit tool and exports `.csv`. Both open from the Reference Viewer or the Content Browser context menu.
- `[documented]` Non-Blueprint Primary Assets (instances of `UDataAsset` subclasses) are more memory-efficient and simpler to access in code, but cannot be inherited; use a Blueprint class when a child must inherit and override values.

## Judgements built on it

- `[general]` The classes that load first (game mode, game instance, player controller, default pawn) deserve the closest look: any hard pointer there is loaded for every session.
- `[general]` A hard reference to a large asset on a class that is always loaded is a finding; a hard reference to a small asset that is always needed is not. Size it with Size Map before ranking it.
- `[general]` Optional or per-mode content is the best soft-reference candidate; content needed on the first frame should stay hard or be preloaded behind a loading screen.
- `[general]` Epic's pages do not set a size or count threshold for a hard reference. State the measured size in the finding and let the owner decide.

## How to inspect

1. `[general]` List `UPROPERTY` members of asset pointer types (`UStaticMesh*`, `USoundBase*`, `UTexture2D*`, `UMaterialInterface*`, `UParticleSystem*`, `UNiagaraSystem*`, `TSubclassOf<>` to Blueprints) on the always-loaded classes.
2. `[general]` Open each class default object's asset in the Reference Viewer with Hard edges on; run Size Map on the root to rank by size.
3. `[general]` Check whether Primary Asset types are registered, and whether data assets or Blueprint classes are used where inheritance is needed.
4. `[general]` Record loads that are synchronous in gameplay code (`LoadSynchronous`, `StaticLoadObject`, `SynchronousLoad`).

Next: [audit](unreal-architecture-audit.md).
