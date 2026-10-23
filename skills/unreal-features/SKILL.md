---
name: unreal-features
description: Choose which Unreal Engine 5.8 system to use for a goal (rendering such as Lumen, Nanite, Virtual Shadow Maps, MegaLights, Substrate and TSR; gameplay such as Gameplay Ability System, Enhanced Input, AI, navigation, animation and Motion Matching; Sequencer, Movie Render Queue and networking; plus Niagara, Chaos, Mover, Control Rig, PCG, Water, Geometry Scripting and MetaSounds), with one reference per system covering when to use it and how an agent drives it from Python, Blueprint, C++ or console variables. Not for choosing a game engine (use engine-selection from agent-engine) or importing sprite, mesh or audio assets (use unreal-import).
when_to_use: Use when asked which Unreal system or plugin to use for lighting, shadows, geometry, materials, anti-aliasing, abilities, input, NPC behaviour, navigation, animation, cinematics, multiplayer, an effect, destruction, vehicle, character movement, cloth, hair, rig, procedural world or mesh, open world, World Partition, landscape, water, terrain or procedural audio; when asked whether Unreal can do something "like Niagara"; before enabling an Unreal plugin; or when deciding whether an Unreal task can be scripted from Python or needs a C++ bridge; when authoring, driving or verifying Niagara effects or fluids or choosing a Niagara template; or on global illumination, ray tracing, replication, RPC, behavior tree, StateTree, Level Sequence or render a movie.
---

# Choosing an Unreal feature

Unreal 5.8 on Windows. Pick the feature from the goal, enable only its plugin, then read that system's reference: when to use it, what to use instead, how an agent drives it. Brackets show each plugin's shipped state.

| You are about to | Read |
|---|---|
| Make fire, smoke, trails, liquid, sand or any particle effect (Niagara; fluids in NiagaraFluids; on) | [Niagara](references/unreal-niagara.md), [Niagara templates](references/unreal-niagara-templates.md), [Toolsets](references/unreal-niagara-toolsets.md) |
| Keep or convert existing Cascade particle content (Cascade on in the editor; converter off, beta) | [Cascade](references/unreal-cascade.md) |
| Drive effects from destruction or physics events (ChaosNiagara; on, beta) | [Chaos Niagara](references/unreal-chaos-niagara.md) |
| Break walls or props apart: fracture, debris, fields (Geometry Collections and Fracture; off, beta) | [Chaos destruction](references/unreal-chaos-destruction.md) |
| Drive wheeled or modular vehicles (Chaos Vehicles, Chaos Modular Vehicle; off, experimental) | [Chaos vehicles](references/unreal-chaos-vehicles.md) |
| Move a character or pawn beyond the Character Movement Component (Mover, ChaosMover; off, experimental) | [Mover](references/unreal-mover.md) |
| Simulate cloth, outfits or soft bodies (ChaosCloth on; Cloth Asset, Outfit Asset, ChaosFlesh off) | [Cloth and flesh](references/unreal-chaos-cloth-and-flesh.md) |
| Add hair or fur (Hair Strands; off) | [Hair Strands](references/unreal-hair-strands.md) |
| Rig, animate procedurally or retarget with IK (Control Rig and IK Rig on; Full Body IK off) | [Control Rig](references/unreal-control-rig.md) |
| Run the example scenes | [Example scenes](references/unreal-example-scenes.md) |
| Build a large landscape with rivers and scattered content (World Partition, Landmass, Water, PCG) | [World Partition](references/unreal-world-partition.md), [Landmass](references/unreal-landmass.md), [Water](references/unreal-water.md), [PCG](references/unreal-pcg.md) |
| Scatter world content by rules: foliage, props, biomes, in the editor or a running game (PCG; on) | [PCG](references/unreal-pcg.md), [PCG in a game](references/unreal-pcg-game-process.md) |
| Author terrain with helpers (Landmass; off, beta) | [Landmass](references/unreal-landmass.md) |
| Add oceans, lakes or rivers (Water; off, experimental) | [Water](references/unreal-water.md) |
| Build or edit meshes from code, in the editor or at runtime (Geometry Scripting; off) | [Geometry Scripting](references/unreal-geometry-scripting.md) |
| Create a runtime mesh from vertex arrays (Procedural Mesh Component; on) | [Procedural Mesh Component](references/unreal-procedural-mesh-component.md) |
| Make parameter-driven, sample-accurate game audio (MetaSounds; on) | [MetaSounds](references/unreal-metasounds.md) |
| Script the editor from Python: run modes, cameras, input, whole-map builds, process cleanup | [Editor Python](references/unreal-editor-python.md) |
| Add what Python lacks, such as Landscape creation, with an editor C++ module | [Python to C++ bridge](references/unreal-python-cpp-bridge.md) |
| Light a scene dynamically: global illumination, reflections, many shadow-casting lights, high-resolution shadows (project settings; MegaLights opt-in) | [Lumen](references/unreal-lumen.md), [MegaLights](references/unreal-megalights.md), [Virtual Shadow Maps](references/unreal-virtual-shadow-maps.md) |
| Render dense or high-polygon geometry without authored LODs (project setting, per-mesh flag) | [Nanite](references/unreal-nanite.md) |
| Give materials or effects a toon or cel look (Substrate Toon, experimental; Niagara) | [Substrate](references/unreal-substrate.md), [Niagara](references/unreal-niagara.md) |
| Author layered or stylized materials; choose anti-aliasing and upscaling (Substrate beta, Substrate Toon experimental; TSR on) | [Substrate](references/unreal-substrate.md), [TSR and anti-aliasing](references/unreal-temporal-super-resolution.md) |
| Give characters abilities, stat effects, costs or predicted actions (GameplayAbilities; off) | [Gameplay Ability System](references/unreal-gameplay-ability-system.md) |
| Bind player input and switch controls by situation (EnhancedInput; on) | [Enhanced Input](references/unreal-enhanced-input.md) |
| Build NPC decisions, sensing, interaction slots or crowds (StateTree, Behavior Trees, Smart Objects, Mass) | [AI](references/unreal-ai-behavior.md) |
| Path AI across level geometry, including World Partition maps | [Navigation](references/unreal-navigation.md) |
| Author character animation logic or drive it by data search (Animation Blueprints; Pose Search) | [Animation Blueprints](references/unreal-animation-blueprints.md), [Motion Matching](references/unreal-motion-matching.md) |
| Author, record or play cinematics; render them offline or from a command line (Sequencer; Movie Render Pipeline off) | [Sequencer](references/unreal-sequencer.md), [Movie Render Queue](references/unreal-movie-render-queue.md) |
| Combine materials, lighting, anti-aliasing and profiling; Niagara facts tested on 5.8.2 | [Unreal production stack](references/unreal-production-stack.md) |
| Replicate gameplay for several players: RPCs, dedicated servers (Iris off; beta or experimental) | [Networking and replication](references/unreal-networking-and-replication.md) |

## Rules of thumb

- When two features fit equally, choose the one whose plugin is on by default. A beta or experimental plugin is a deliberate opt-in.
- Use Niagara for new particle work, Cascade only for existing content. Each reference states what it supersedes and its beta or experimental label.
- Import a fixed asset (GLB, WAV, sprite atlas) with `unreal-import`; build in Unreal (Geometry Scripting, MetaSounds, Niagara) when it must respond to gameplay. Blender or Unreal for a mesh: `mesh-tool-selection`.
- Route by reach: asset creation, level building and property edits are [editor Python](references/unreal-editor-python.md); per-frame behaviour, custom solvers and new data types are C++ or Blueprint.

## Enable a feature

1. List the plugin's descriptor: `node examples/unreal/engine_plugins.mjs --engine "<UE folder>" --name <Plugin>`.
2. Enable it in Edit > Plugins, or add `{ "Name": "<Plugin>", "Enabled": true }` to the `.uproject` `Plugins` array, and restart the editor.
3. See what Python reaches: run [`unreal_surface.py`](../../examples/unreal/unreal_surface.py) headless with `UNREAL_SURFACE_MATCH=<fragment>`.
