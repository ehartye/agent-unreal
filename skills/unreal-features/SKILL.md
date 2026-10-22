---
name: unreal-features
description: Choose which Unreal Engine 5.8 system to use for a goal (rendering such as Lumen, Nanite, Virtual Shadow Maps, MegaLights, Substrate and TSR; gameplay such as Gameplay Ability System, Enhanced Input, AI, navigation, animation and Motion Matching; Sequencer, Movie Render Queue and networking; plus Niagara, Chaos, Mover, Control Rig, PCG, Water, Geometry Scripting and MetaSounds), with one reference per system covering when to use it and how an agent drives it from Python, Blueprint, C++ or console variables. Not for choosing a game engine (use engine-selection from agent-engine) or importing sprite, mesh or audio assets (use engine-asset-import from agent-engine).
when_to_use: Use when asked which Unreal system or plugin to use for lighting, shadows, geometry, materials, anti-aliasing, abilities, input, NPC behaviour, navigation, animation, cinematics, offline rendering, multiplayer, an effect, destruction, vehicle, character movement, cloth, hair, rig, procedural world or mesh, water, terrain or procedural audio; when asked whether Unreal can do something "like Niagara"; before enabling an Unreal plugin; or when deciding whether an Unreal task can be scripted from Python; when authoring, driving or verifying Niagara effects or fluids or choosing a Niagara template (fire, smoke, explosion); or on phrases such as global illumination, ray tracing, replication, RPC, behavior tree, StateTree, Level Sequence, render a movie or anti-aliasing.
---

# Choosing an Unreal feature

Unreal 5.8 on Windows. Pick the feature from the goal, enable only its plugin, then read that system's reference. Each reference states when to use the system, what to use instead, how an agent drives it (Python, Blueprint, C++ or editor UI) and the Epic documentation behind it. The plugin state in brackets is the shipped descriptor: `node examples/unreal/engine_plugins.mjs --engine <UE folder>` lists them.

| You are about to | Read |
|---|---|
| Make fire, smoke, sparks, trails, liquid, sand or any particle effect (Niagara; fluid templates in NiagaraFluids; on) | [Niagara](references/unreal-niagara.md), [Niagara templates](references/unreal-niagara-templates.md) |
| Keep or convert existing Cascade particle content (Cascade on in the editor; converter off, beta) | [Cascade](references/unreal-cascade.md) |
| Drive effects from destruction or physics events (ChaosNiagara; on, beta) | [Chaos Niagara](references/unreal-chaos-niagara.md) |
| Break walls or props apart: fracture, debris, fields (Geometry Collections and Fracture; off, beta) | [Chaos destruction](references/unreal-chaos-destruction.md) |
| Drive wheeled or modular vehicles (Chaos Vehicles, Chaos Modular Vehicle; off, experimental) | [Chaos vehicles](references/unreal-chaos-vehicles.md) |
| Move a character or pawn beyond the Character Movement Component (Mover, ChaosMover; off, experimental) | [Mover](references/unreal-mover.md) |
| Simulate cloth, outfits or soft bodies (ChaosCloth on; Cloth Asset, Outfit Asset, ChaosFlesh off) | [Cloth and flesh](references/unreal-chaos-cloth-and-flesh.md) |
| Add hair or fur (Hair Strands; off) | [Hair Strands](references/unreal-hair-strands.md) |
| Rig, animate procedurally or retarget with IK (Control Rig and IK Rig on; Full Body IK off) | [Control Rig](references/unreal-control-rig.md) |
| Scatter or place world content by rules: foliage, props, biomes (PCG; on) | [PCG](references/unreal-pcg.md) |
| Author terrain with helpers (Landmass; off, beta) | [Landmass](references/unreal-landmass.md) |
| Add oceans, lakes or rivers (Water; off, experimental) | [Water](references/unreal-water.md) |
| Build or edit meshes from code, in the editor or at runtime (Geometry Scripting; off) | [Geometry Scripting](references/unreal-geometry-scripting.md) |
| Create a runtime mesh from vertex arrays (Procedural Mesh Component; on) | [Procedural Mesh Component](references/unreal-procedural-mesh-component.md) |
| Make parameter-driven, sample-accurate game audio (MetaSounds; on) | [MetaSounds](references/unreal-metasounds.md) |
| Script the editor from Python: run modes, cameras, keyboard and gamepad input, process cleanup | [Editor Python](references/unreal-editor-python.md) |
| Light a scene dynamically: global illumination and reflections, many shadow-casting lights, high-resolution shadows (project settings; MegaLights opt-in) | [Lumen](references/unreal-lumen.md), [MegaLights](references/unreal-megalights.md), [Virtual Shadow Maps](references/unreal-virtual-shadow-maps.md) |
| Render dense or high-polygon geometry without authored LODs (project setting plus per-mesh flag) | [Nanite](references/unreal-nanite.md) |
| Author layered or stylized materials, or choose anti-aliasing and upscaling (Substrate beta, Substrate Toon experimental; TSR on) | [Substrate](references/unreal-substrate.md), [TSR and anti-aliasing](references/unreal-temporal-super-resolution.md) |
| Give characters abilities, stat effects, costs or predicted actions (GameplayAbilities; off) | [Gameplay Ability System](references/unreal-gameplay-ability-system.md) |
| Bind player input and switch controls by situation (EnhancedInput; on) | [Enhanced Input](references/unreal-enhanced-input.md) |
| Build NPC decisions, sensing, interaction slots or crowds (StateTree, Behavior Trees, Smart Objects, Mass) | [AI](references/unreal-ai-behavior.md) |
| Path AI across level geometry, including World Partition maps | [Navigation](references/unreal-navigation.md) |
| Author character animation logic or drive it by data search (Animation Blueprints; Pose Search) | [Animation Blueprints](references/unreal-animation-blueprints.md), [Motion Matching](references/unreal-motion-matching.md) |
| Author, record or play cinematics; render them offline or from a command line (Sequencer; Movie Render Pipeline off) | [Sequencer](references/unreal-sequencer.md), [Movie Render Queue](references/unreal-movie-render-queue.md) |
| Choose Unreal materials, lighting, anti-aliasing or production profiling together, and check the Niagara facts tested on 5.8.2 | [Unreal production stack](references/unreal-production-stack.md) |
| Make gameplay work for several players: replication, RPCs, dedicated servers (Iris off; beta or experimental) | [Networking and replication](references/unreal-networking-and-replication.md) |

## Rules of thumb

- When two features fit equally, choose the one whose plugin is on by default. A beta or experimental plugin is a deliberate opt-in, and its reference says what it is for.
- Use Niagara for new particle work and keep Cascade for content that already exists. Prefer the current system in every area: each reference notes in one line what it supersedes (for example Lumen over baked lighting, Enhanced Input over legacy mappings) and whether Epic labels it beta or experimental.
- Import a fixed asset (a GLB, a WAV, a sprite atlas) with `engine-asset-import` (agent-engine); build in Unreal (Geometry Scripting, MetaSounds, Niagara) when it must respond to gameplay. Blender or Unreal for a mesh: `mesh-tool-selection` (agent-meshes).
- Choose the route by reach: asset creation, level building and property edits are editor Python (`EditorAssetLibrary`, asset tools, editor subsystems; see [Editor Python](references/unreal-editor-python.md)); per-frame behaviour, custom solvers and new data types are C++ or Blueprint. Each reference's route table says which tasks are which.

## Enable a feature

1. List the plugin's descriptor: `node examples/unreal/engine_plugins.mjs --engine "<UE folder>" --name <Plugin>`.
2. Enable it in Edit > Plugins, or add `{ "Name": "<Plugin>", "Enabled": true }` to the `.uproject` `Plugins` array, and restart the editor.
3. See what Python reaches: run [`unreal_surface.py`](../../examples/unreal/unreal_surface.py) headless with `UNREAL_SURFACE_MATCH=<name fragment>`.
4. Script the editor with [Editor Python](references/unreal-editor-python.md).
