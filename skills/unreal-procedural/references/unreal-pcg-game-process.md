# PCG in a running game: what a game process needs that the editor supplies

Target: Unreal Engine 5.8.2, Windows. A game process here is the editor binary started with `-game` ([run modes](../../unreal-editor-scripting/references/unreal-editor-python.md)). A cooked Development game, `GENERATE_AT_RUNTIME` and partitioned runtime generation, run on 5.8.3: [PCG in a cooked game](unreal-pcg-cooked-game.md). `[tested]` marks a result of [`examples/unreal/pcg_game`](../../../examples/unreal/pcg_game/README.md); `[documented]` marks the engine install (paths under `Engine/Plugins/PCG/Source/PCG/` unless they start with `Source/`). Node choice and graph building: [PCG](unreal-pcg.md).

## Before a game process generates

1. A `PCGWorldActor` saved in the level, with its Landscape cache set to serialize.
2. `used_with_instanced_static_meshes` on every material spawned as instances.
3. A script that keeps ticking while generation runs.
4. Noise scales in the units the node uses.

## PCGWorldActor and the Landscape cache

- [documented] The subsystem creates the actor only outside runtime and Play-In-Editor (`Private/Subsystems/PCGSubsystem.cpp` lines 431 to 446). An editor generation adds one; a game process only finds one saved in the level.
- [tested] No actor: Get Landscape Data logs `Landscape data is unable to access the landscape cache (Note: Will happen if there is no PCG world actor.` (text as shipped, `Private/Data/PCGLandscapeData.cpp` line 740) and the sampler spawns nothing.
- [tested] `unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.PCGWorldActor, unreal.Vector(0, 0, 0))` adds one that a game process finds; the log then shows the next message. In the editor, `pcg.BuildLandscapeCache` after such a spawn left two actors in the world; configure the actor that an editor generation creates, and keep one.
- [tested] The cache `serialization_mode` defaults to `NEVER_SERIALIZE` (`Public/Grid/PCGLandscapeCache.h` line 161). A game process logs `PCG Landscape cache (on the PCG World Actor) is not set to be serialized and will not work in non-editor modes.` (`Private/Utils/PCGLogErrors.cpp` line 212) and spawns nothing.
- [tested] Fix, then save the level:

```python
cache = world_actor.get_editor_property("landscape_cache_object")
cache.set_editor_property("serialization_mode", unreal.PCGLandscapeCacheSerializationMode.ALWAYS_SERIALIZE)
unreal.SystemLibrary.execute_console_command(world, "pcg.BuildLandscapeCache")   # fills the cache
```

- [tested] Both volumes then spawned instances in the game process. With the mode set and no build it generated too, and the map file stayed the same size. The build made the map 12.6 MB larger (1.2 MB to 13.8 MB, four Landscape components); `cache_entry_count` read 4 after it and 0 without.
- [documented] Cache entries are created from Landscape data only in editor builds (`Private/Grid/PCGLandscapeCache.cpp` line 873), so a build without editor data depends on entries in the file.

## Materials on spawned instances

- [tested] Two volumes spawned the same cube with two unlit materials, one with the flag and one without. In the game process's engine screenshot the flagged material drew its colour (about 41,000 red pixels, none on the other side) and the other drew the default grey. The log said `Material /Game/Pcg/M_Unflagged.M_Unflagged missing usage flag InstancedStaticMeshes! Default Material will be used in game.` (`Source/Runtime/Engine/Private/Materials/Material.cpp` line 1945).
- [documented] The editor sets a missing flag itself only when `GIsEditor` is true and no play session runs (`Material.cpp` lines 1883 to 1893). [tested] A rendering editor logged `needed to set usage flag InstancedStaticMeshes` on the first generation.
- Set it on the asset and save: `mat.set_editor_property("used_with_instanced_static_meshes", True)`, then `unreal.MaterialEditingLibrary.recompile_material(mat)`.

## Static Mesh Spawner from Python

```python
settings.set_mesh_selector_type(unreal.PCGMeshSelectorWeighted)
entries = settings.get_editor_property("mesh_selector_parameters").get_editor_property("mesh_entries")
entry = unreal.PCGMeshSelectorWeightedEntry()
desc = entry.get_editor_property("descriptor")            # PCGSoftISMComponentDescriptor
desc.set_editor_property("static_mesh", mesh); desc.set_editor_property("override_materials", [mat])
entry.set_editor_property("descriptor", desc); entries.append(entry)   # edits the selector in place
settings.set_editor_property("seed", 5)
```

- [tested] Refused: setting `mesh_selector_parameters` (`Property 'MeshSelectorParameters' for attribute 'mesh_selector_parameters' on 'PCGStaticMeshSpawnerSettings' is read-only and cannot be set`) and reading or setting `use_seed` (`Property 'bUseSeed' ... is protected and cannot be read` / `cannot be set`). `seed` is accepted.

## Noise nodes

- [documented] Spatial Noise multiplies the transform scale by `MAGIC_SCALE_FACTOR` 0.0001 (`Private/Elements/PCGSpatialNoise.cpp` lines 70 and 737): one noise cell is 100 m divided by the scale, so 0.4 to 1.0 gives cells of 250 to 100 m. `tiling` is a bool (`Public/Elements/PCGSpatialNoise.h` line 96); [tested] a float is refused with `Cannot nativize 'float' as 'bTiling' (BoolProperty)`.
- [tested] Perlin2D on a 510 m Landscape, 2,401 points; the range over which values stay correlated: scale 0.4 gives 145 m, 1.0 gives 95 m, 1.5 gives 75 m, 5.0 gives 25 m. Scale 5e-5 gives one value (0.5321) everywhere, so a 0.6 Density Filter removed all 2,401 points; at scale 1.0 it kept 393.
- [tested] Perlin values sit in a narrow band: 10th to 90th percentile 0.29 to 0.64 at scale 1.0; `contrast=6.0` spreads them to 0.005 to 0.97.
- [documented] Attribute Noise and Density Noise are two presets of `PCGAttributeNoiseSettings` (`Public/Elements/PCGAttributeNoise.h`); `mode` defaults to `Set` (line 74), which overwrites the attribute. [tested] After a Perlin density and a 0.5 Density Filter, `Set` kept 1,140 of 2,401 points and `Multiply` kept 155.
- [tested] Edge Mask (`EDGE_MASK2D`) then Attribute Noise `MULTIPLY` then Density Filter spawned 629 instances on a Landscape-wide volume. On a 40 m volume it spawned none, and so did Edge Mask then the filter alone: the mask peaked at 0.19 because `edge_blend_distance` 1.0 is 100 m at scale 1. `edge_blend_distance=0.1` or transform scale 10 gave about 150 instances.

## Waiting for generation

- [tested] `generate()` returns before any point exists. Saved in the same tick, the map held 0 instances (20 appeared afterwards); saved after the `on_pcg_graph_generated_external` event, the reloaded map held all 20.
- [tested] A script run with `-ExecutePythonScript` quit before its tick callback wrote a report. Use `-ExecCmds="py <script>"` and a Slate post-tick callback; `pcg_common.run_stages` runs a generator that yields once per tick and skips ticks that blocking calls such as `load_map` re-enter.

## Test variants before a long build

Build N small graph variants after Get Landscape Data, generate each on a test volume, and log the point count, the density spread and the ISM instance count. `pcg_experiments.py` does this; a chain that empties its output shows up in one run.

```python
graph, nodes = pc.build_variant("V1", [(unreal.PCGSurfaceSamplerSettings, {"points_per_squared_meter": 0.01}), (unreal.PCGSpatialNoiseSettings, {})], spawner=(mesh, None))
vol, comp = pc.spawn_volume("V1", center, half_x, half_y, half_z, graph)
result = yield from pc.generate_and_count(vol, comp)   # completed, instances, points
```

Read points with `unreal.PCGDataFunctionLibrary.get_typed_inputs(collection, unreal.PCGBasePointData)[0]`; `PCGTaggedData` does not expose its data.

## Not verified

- The material fallback in Play-In-Editor was not run. The cooked game, `GENERATE_AT_RUNTIME` and a partitioned map were run on 5.8.3 and are in [PCG in a cooked game](unreal-pcg-cooked-game.md); the Landscape cache rules above were not repeated in a cooked game. A later Landscape graph gave 0 points in `-nullrhi` editors and 1209 in a rendering editor on 5.8.3, on a Landscape from an editor module; the Perlin counts above come from `-nullrhi` editors on 5.8.2 with a copied engine sample Landscape. The cause of the difference is not isolated ([World Partition Landscape](unreal-world-partition-landscape.md)).

## Sources

- Epic: [Using PCG Generation Modes](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-pcg-generation-modes-in-unreal-engine).
- The PCG plugin and Engine sources named above, UE 5.8.2.
