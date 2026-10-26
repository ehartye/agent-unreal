# PCG generation modes in Unreal 5.8: partitioned, hierarchical and runtime generation

Target: Unreal Engine 5.8, Windows. Companion to [PCG](unreal-pcg.md), which covers enabling the plugin, when to use it, the driving table and the workflow. These are the generation modes, their grid settings and the runtime console variables.

## Generation modes

Generation modes `[documented]` (Epic, [Using PCG Generation Modes](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-pcg-generation-modes-in-unreal-engine)): Non-partitioned (default), Partitioned, Hierarchical and Runtime. A large grid suits large meshes such as trees and boulders; a small grid suits grass, flowers and stones.
- Non-partitioned: one component generates its whole domain, on demand with the Generate button or `PCGComponent.generate`. Meshes stay inside the domain, which Epic says can slow a large area.
- Partitioned: tick Is Partitioned to split data across a grid that World Partition and Level Instancing can stream. Partition Grid Size is on the PCGWorldActor; after changing it click Cleanup on each PCG asset, then Generate.
- Hierarchical: requires partitioned components. Tick Use Hierarchical Generation in Graph Settings and set HiGen Default Grid Size. The Grid Size node (HiGen Grid Size) sets the grid for every node after it, so place it before the samplers. Nodes with no Grid Size node use the default; data flows from a larger grid to a smaller one, not back; a node fed by several grids outputs at the smallest; subgraphs use their parent's or input's grid.
- Runtime: set Generation Trigger to Generate at Runtime; Epic pairs it with Hierarchical. It runs in editor, PIE and standalone. Generation sources are the editor viewport (Treat Editor Viewport as Generation Source on the PCGWorldActor), player controllers, World Partition streaming sources and PCG Generation Source components. A component generates inside the Generation Radius for its grid size (Override Generation Radii per component) and cleans up beyond that radius times Cleanup Radius Multiplier; each radius should exceed the next smaller grid's. The page also covers Unbounded grid size, scheduling and frustum culling.
- Console variables `[tested]`, 5.8.2 defaults: `pcg.RuntimeGeneration.Enable` true, `.EnablePooling` true, `.BasePoolSize` 100, `.NumGeneratingComponents` 16, `.EnableDebugging` false, `pcg.FrameTime` 5.0 ms, `pcg.EditorFrameTime` 15.0 ms. Epic's page lists 16.667 and 50 ms and a `.FramesBetweenGraphSchedules` variable; the 5.8.2 plugin source declares other defaults and no such variable.
- Console variables `[tested]`, read in a cooked Development game on 5.8.3: `pcg.RuntimeGeneration.Enable` true, `.NumGeneratingComponents` 16, `.EnablePooling` true, `.BasePoolSize` 100, the same as the 5.8.2 values above; the cooked game also read `.EnableWorldStreamingQueries` true and `.GlobalRadiusMultiplier` 1. Runtime generation in a cooked game, partitioned and not: [PCG in a cooked game](unreal-pcg-cooked-game.md).
- A running game needs more than the editor does: see [PCG in a running game](unreal-pcg-game-process.md).

## Sources

- [Using PCG Generation Modes](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-pcg-generation-modes-in-unreal-engine)
