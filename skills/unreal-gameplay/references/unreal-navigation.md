# Navigation in Unreal 5.8: NavMesh, modifiers, links, dynamic generation and World Partition

Target: Unreal Engine 5.8, Windows. Epic's Navigation System builds a Navigation Mesh from level collision geometry, split into tiles and polygons, and agents path over per-polygon costs. In the 5.8 install this is the `NavigationSystem` engine module (`NavigationSystemV1`, `RecastNavMesh`), not a plugin. Epic's 5.8 Navigation page documents only this system; it describes no successor.

## Enable it

| Item | State |
|---|---|
| `NavigationSystem` module | built in; place a `NavMeshBoundsVolume` over the playable space and the navmesh generates |
| `RecastNavMesh-Default` | created by the navigation system (`bAutoCreateNavigationData`); the class is not placeable |
| `NavCorridor` plugin | Gameplay, off, experimental ("Experimental Navigation Corridor"); Epic's API page lists a testing actor and testing component; `MassAI` and `GameplayInteractions` depend on it |

- Epic labels World Partitioned Navigation Mesh and Automatic Navigation Link Generation Experimental: "use caution when shipping with it".
- 5.8 release notes: static meshes can define their own walkable areas (a flag and an area class on `NavCollision`); the navmesh format is version 28 with tile-local vertices (about 50% smaller) and a smaller link pool; Detour crowd avoidance gained a side-bias threshold.

## Use it when

- AI must path-find over level geometry with per-area costs.
- The level changes at runtime: choose Runtime Generation Static, Dynamic or Dynamic Modifiers Only.
- A large level should build navmesh only near agents (Navigation Invokers).
- A World Partition map streams its navmesh in data chunks.
- Platforms, bridges and drops need links between separate navmesh areas.
- Avoidance between agents: Epic documents Reciprocal Velocity Obstacles and the Detour Crowd Manager.

## Use something else when

- Use [Mover](unreal-mover.md) for how the pawn moves along the path (Mover has a NavWalking mode).
- Use [AI behavior](unreal-ai-behavior.md) for decisions; `MassAI` carries its own navmesh and ZoneGraph path-following modules for Mass agents.
- Use Dynamic, not Dynamic Modifiers Only, when new walkable surfaces must appear: modifiers change the existing mesh and generate no new surfaces.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Place the navigation volume | editor UI; Python | Add > Volumes > NavMeshBoundsVolume, scale over the level (`ANavMeshBoundsVolume` is a UCLASS in the install; the class-surface dump did not cover it) |
| Area costs | editor UI; Blueprint | `NavModifierVolume` with an Area Class; `NavModifierComponent` on an Actor whose root is a basic shape, one per Actor; `NavArea_Null` leaves no navmesh, `NavArea_Obstacle` adds high cost |
| Links | editor UI; Blueprint | `NavLinkProxy`: simple links are static; one smart link per proxy, enabled with Smart Link Is Relevant; `SetSmartLinkEnabled`, `ReceiveSmartLinkReached`, `ResumePathFollowing` (install header) |
| Auto links | editor UI | RecastNavMesh > Generation > Generate Nav Links, Nav Link Jump Down Config, Link Proxy Class from a `GeneratedNavLinksProxy` Blueprint |
| Runtime generation | project settings | Project Settings > Navigation Mesh > Runtime > Runtime Generation |
| Invokers | project settings; Blueprint; C++ | enable Generate Navigation Only Around Navigation Invokers; `NavigationInvokerComponent` (Tile Generation Radius 3000, Tile Removal Radius 5000 in Epic's guide); `RegisterNavigationInvoker(Actor, TileGenerationRadius, TileRemovalRadius)` |
| Queries | Blueprint; C++ | `ProjectPointToNavigation`, `GetRandomReachablePointInRadius` on `NavigationSystemV1` (install header); AI Move To |
| Edit navmesh settings from script | Python | `EditAnywhere` properties are editor properties (Epic): `set_editor_property` on the RecastNavMesh actor (C++ names `bGenerateNavLinks`, `bIsWorldPartitioned`); not run here |
| Build | editor UI; commandlet | Build > Build Paths; static World Partition navmesh out of editor: `WorldPartitionBuilderCommandlet` with `WorldPartitionNavigationDataBuilder` (Epic) |
| Debug | editor UI; console | P shows the navmesh; Gameplay Debugger (apostrophe) then 0; `ai.debug.nav.RefreshInterval`, `ai.debug.nav.DisplaySize` |

## Workflow

1. Add a `NavMeshBoundsVolume` over the playable space; press P to view.
2. Set Runtime Generation. Static: generated offline and saved with the level. Dynamic: tiles affected by a change regenerate. Dynamic Modifiers Only: only modifiers change the mesh, and an Actor needs a `NavModifierComponent` for that.
3. Shape cost with area classes. Pathing takes the lowest total cost; a raised cost steers agents away but they still cross it when it is the only route.
4. Link separate areas with a Nav Link Proxy; Epic limits smart links to adjacent navmesh tiles.
5. For large dynamic levels use invokers: enable Generate Navigation Only Around Navigation Invokers, set Runtime Generation to Dynamic, keep the bounds volume, and add `NavigationInvokerComponent` to agents.
6. World Partition (Epic): use a World Partitioned map (Open World template enables World Partition, One File Per Actor and Data Layers); set Runtime Generation to Static; enable Is World Partitioned Navmesh on RecastNavMesh-Default; turn off Update Navigation Automatically for large worlds; run `n.bNavmeshAllowPartitionedBuildingFromEditor 1`; Build > Build Paths; NavDataChunk actors appear in the Outliner. Size chunks with Navigation Data Chunk Grid Size and Navigation Data Builder Loading Cell Size in World Settings, and enable Fixed Tile Pool Size for streaming.
7. Keep generation cheap (the install's navmesh optimization notes): largest workable `CellSize` and `CellHeight`; tiles of 32 to 128 cells per side; simple nav collision; avoid objects that dirty the navmesh without affecting paths; lock automatic generation while loading and release it afterwards; use Is Dynamic Obstacle on static meshes that need only a surface mark; prefer a static navmesh with chunk streaming when only sublevels change.

## Sources

- [Navigation System](https://dev.epicgames.com/documentation/en-us/unreal-engine/navigation-system-in-unreal-engine)
- [How to Modify the Navigation Mesh](https://dev.epicgames.com/documentation/en-us/unreal-engine/overview-of-how-to-modify-the-navigation-mesh-in-unreal-engine)
- [Navigation Components](https://dev.epicgames.com/documentation/en-us/unreal-engine/navigation-components-in-unreal-engine)
- [World Partitioned Navigation Mesh](https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partitioned-navigation-mesh)
- [Automatic Navigation Link Generation](https://dev.epicgames.com/documentation/en-us/unreal-engine/automatic-navigation-link-generation)
- [Using Navigation Invokers](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-navigation-invokers-in-unreal-engine)
- [Navigation Mesh project settings](https://dev.epicgames.com/documentation/en-us/unreal-engine/navigation-mesh-settings-in-the-unreal-engine-project-settings)
- [NavCorridor API](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Plugins/NavCorridor)
- [Scripting the Editor using Python](https://dev.epicgames.com/documentation/en-us/unreal-engine/scripting-the-unreal-editor-using-python)
- [Unreal Engine 5.8 release notes](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-5-8-release-notes)
- NavigationSystem and AIModule headers, the navmesh optimization notes (`NavigationSystem/DevDocs`) and the NavCorridor descriptor in the 5.8 install.
