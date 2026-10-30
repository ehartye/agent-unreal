# Unreal sample scene scripts

For a native C++ game rather than this import sample, see [native Unreal build and capture](../../skills/unreal-native/references/unreal-native-game.md). It records a separate Unreal 5.8 execution path and its observed build, material, font and capture traps. Do not assume this sample's PIE evidence establishes a packaged game.

For comparing several implementations of one visible thing side by side in a native game, see [compare-scene](compare-scene/README.md).

Windows, Unreal Engine 5.8. [general] The scene scripts were observed on earlier engine builds; this was not repeated on the pinned build, and on an earlier 5.8 build they needed three changes, listed in the Unreal import notes (`unreal-import` skill). They build the [Unreal sample scene](../../docs/sample-scene.md), the Unreal build of the shared scene spec in agent-engine, and
run it with real rendering. Read the `unreal-import` and `unreal-native` skills
before changing them.

Set `AGENT_UNREAL_SCENES` to a workspace folder with this layout:

```text
assets/meshes/fox.glb              agent-meshes creature gallery, vulpine/model.glb
assets/sprites/courier.png + courier.atlas.json   agent-sprites examples/character-walk/dist
assets/sprites/campfire.png + campfire.atlas.json  ../campfire/dist
assets/audio/survey-drone.wav, relic-discovered.0..3.wav   rendered with agent-beeps
unreal/SampleScene/SampleScene.uproject   plugins: PythonScriptPlugin, EditorScriptingUtilities,
                                          Interchange, InterchangeEditor, InterchangeAssets, Paper2D
```

Build (assets and level, no rendering, about 30 seconds):

```text
UnrealEditor-Cmd.exe SampleScene.uproject -run=pythonscript -script=build_scene.py
    -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
```

Run (Play-In-Editor offscreen on the GPU, samples state, writes `unreal/report-run.json`, saves a
screenshot under `Saved/Screenshots/WindowsEditor`, then quits):

```text
UnrealEditor.exe SampleScene.uproject /Game/Maps/SampleScene -RenderOffScreen
    -ExecCmds="py run_scene.py" -log=run.log -notraceserver -nosplash -unattended
```

In Git Bash set `MSYS_NO_PATHCONV=1`, or `/Game/Maps/SampleScene` is rewritten into a Windows path.
Do not use `-ExecutePythonScript` for the run: it quits the editor when the script ends.

## Niagara scripts

Six scripts back [Niagara in Unreal](../../skills/unreal-effects/references/unreal-niagara.md). They need a project with PythonScriptPlugin, EditorScriptingUtilities and Niagara, plus NiagaraToolsets (Experimental) for the second. Each writes a JSON report (`NIAGARA_PROBE_REPORT`, default under the project's `Saved/`).

```text
UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=niagara_build.py -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=niagara_toolset_author.py ...same flags...
UnrealEditor.exe Project.uproject /Game/Maps/NiagaraProbe -RenderOffScreen -ExecCmds="py <path>/niagara_verify.py" -log=niagara.log -notraceserver -nosplash -unattended
```

`niagara_validate.mjs` runs all of them in order on a throwaway project in the OS temp folder, plus `niagara_traps.py` (the API facts the reference states) and `niagara_templates.py` (the stock templates), reads the engine's Niagara plugin descriptors, and checks 27 claims, printing PASS or FAIL per claim (27 of 27 passed, in 86 to 92 seconds): `node niagara_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8"`. Its pure checks have node tests in the merge lane (`niagara-validate.test.mjs`); the Unreal run takes about a minute and is a manual lane. That step exits 1 on purpose.

`niagara_build.py` duplicates two engine template systems and places them in a level; `niagara_toolset_author.py` creates a system and adds an emitter through Epic's toolsets and places it; `niagara_verify.py` runs the level in Play-In-Editor, counts particles per emitter with a simulation cache and polls each system's compile state. `niagara_validate.mjs` runs all three (27 of 27).

`niagara_templates.py` lists the one-line description Epic ships with each fluid, sand and core template system (`NIAGARA_TEMPLATES_REPORT` sets the JSON path); it also records the stock-content facts `niagara_validate.mjs` judges (the default template systems and emitters, the user variables of two stock systems, the moving-fire template's emitters, renderers and material), and backs the catalog in [Niagara templates](../../skills/unreal-effects/references/unreal-niagara-templates.md).

`engine_plugins.mjs` lists the plugins an engine install ships from their `.uplugin` descriptors (name, category, enabled by default, beta or experimental, description): `node engine_plugins.mjs --engine "<UE folder>" --name PCG,Metasound`. It needs no Unreal run and has node tests in the merge lane. `unreal_surface.py` lists what the `unreal` Python module exposes for a feature (`UNREAL_SURFACE_MATCH=Hair,Groom`), run headless in a project that enables the plugin. Both back the Unreal domain skills ([unreal-effects](../../skills/unreal-effects/SKILL.md), [unreal-rendering](../../skills/unreal-rendering/SKILL.md) and the others) and their references.

A larger demonstration, [`niagara-showcase`](niagara-showcase/README.md), is an arena of eight stations built from Epic's shipped fluid, sand, ribbon and burst systems plus one system authored through the toolsets. You fly around it with a keyboard and mouse or a gamepad; an automatic camera tour is the hands-off alternative. The same folder has `stage_build.py`, which puts any list of Niagara systems on a flat plane for side-by-side evaluation.

To look at the probe level yourself, `niagara_view.py` frames the systems with the level's camera, labels them and restarts one-shot bursts every few seconds. In the editor: `UnrealEditor.exe Project.uproject /Game/Maps/NiagaraProbe -ExecCmds="py <path>/niagara_view.py"`. As a standalone game (no editor UI), set `NIAGARA_VIEW_GAME=1` and add `-game -windowed -ResX=1280 -ResY=720`. In a game process any `EditorLevelLibrary` call crashes with an access violation, so game mode finds the world with `ObjectIterator`; it was observed running for 25 seconds with no crash, and the window content was not checked by a person here. It is not part of the validation run.

## Test scenes

`stylized/stylized_validate.mjs` (groups `base`, `outline`, `ribbon`, `mesh` and `cost`, picked with `--only`; the ink-brush groups measure particle outlines, ribbons, mesh particles and frame cost, see its [README](stylized/README.md)), `world/world_validate.mjs`, `pcg_game/pcg_validate.mjs`, `editor_python/ep_validate.mjs`, `landscape_bridge/landscape_bridge.mjs`, `automation_test/automation_test.mjs`, `niagara_toolsets/nts_validate.mjs`, `editor_python_friction/epf_validate.mjs`, `constructor_locks/constructor_locks.mjs` and `anim_bridge/anim_bridge.mjs`, `statetree_bridge/statetree_bridge.mjs`, `gas_native/gas_native.mjs`, `unity_build/unity_build.mjs` and `rendering_probes/rp_validate.mjs` each build a throwaway project, run their scripts on an installed Unreal 5.8 and check the claims marked [tested] in the Niagara, Substrate, Landmass, Water, World Partition, PCG, Editor Python, bridge, automation-test and Rendering (Directional lights) references. `rendering_probes/rp_validate.mjs` spawns two directional lights headless and reads ForwardShadingPriority back through the Python setter and four other routes (the renderer's on-screen message needs a rendering editor: `rp_viewport.mjs --offscreen` reproduces it in a Play-In-Editor viewport). `native-build.mjs` finds the Visual Studio toolset and Windows SDK the C++ scenes build with. `editor_probes/probe.mjs` is a helper too: it runs one of three editor-Python probes (`doc_probe.py`, `inspect_system.py`, `asset_probe.py`) headless and fails when no report is written ([README](editor_probes/README.md)). `engine_source.mjs` is a helper too: `node engine_source.mjs --engine "<UE folder>" r.MegaLights.Allowed` prints the install-relative `path:line` where the install defines a console variable, symbol, module or file, with no Unreal run (it has node tests in the merge lane). `contention/editor_contention.mjs` is a helper, not a scene: it stamps other-editor presence into a capture receipt. Commands, scripts and results: [example scenes](../../skills/unreal-editor-scripting/references/unreal-example-scenes.md).

## Engine probes

Each README carries a Status line. The rows marked Ran passed on the pinned engine build; a part named as not run was written and tested against canned reports only, and nothing in it backs a `[tested]` label until a run does. The rendering-editor runs came from a session with no desktop (SSH): a rendering editor there needs `-RenderOffScreen`, because without it the editor ends with exit 3 while it creates the window's swap chain (see [Editor Python run modes](../../skills/unreal-editor-scripting/references/unreal-editor-python.md)).

| Folder or script | Result |
|---|---|
| [`metahuman/mh_probe.mjs`](metahuman/README.md) | Ran (four runs, a windowed editor, a person at the first launch of each run and nobody at the repeat launches; the runs differ and the README names each): run 4 scored 12 of 13 live and 13 of 13 re-judged offline once the sign-in check judged behaviour only. A MetaHuman Character from a preset was rigged and textured through Epic's cloud in every run. The first build attempt failed with a Control Rig `Cannot break link` error in runs 2 (Cine), 3 and 4 (optimized) and a retry built in runs 2 and 4 (run 4: 110.7 s failure, 64.5 s retry); only in run 4 did the character spawn and move: pose animation sequences with `CTRL_expressions_*` curves played on the Face component (jaw open 10.43 percent and smile 5.22 percent of the face region against neutral, noise 0.76 percent). The repeat launch finished by itself with nobody at the editor in runs 1, 3 and 4 (118 to 128 s). The runs used the default shader model; the six Epic project settings were present in runs 3 and 4 only (run 2 held three at its end); headless `--names` 5 of 6 |
| [`niagara_toolsets/nts_probe.mjs`](niagara_toolsets/README.md) | Ran: `renderers` (`AddRenderer` positions and renderer kinds) 6 of 6; `emit` (an emitter that counts no particles) 8 of 8; `nts_validate.mjs` 25 of 25; `gradient` 3 of 3; `wire` (generated assets wired into Niagara) 10 of 11 with the built-in cube, a static export of a rigged model and an agent-sprites atlas (the failing check: `set_variable_static_mesh` did not swap the mesh a bound slot draws); `frame` 5 of 5 once the saved system is recompiled on load (3 of 5 before: the Direct Frame Index linked to a user parameter stayed age-driven) |
| [`umg/umg_probe.mjs`](umg/README.md) | Ran: 23 of 24 (Epic's MCP server lists the UMG toolset with 23 tools and the MVVM toolset with 9 and no widget-animation toolset - the failing check; a script builds, compiles and saves a Widget Blueprint through them and a Play-In-Editor session run offscreen shows it in a `Shot showui` frame, not in a high-resolution shot; the Common UI quickstart pieces are set from a script and an activatable widget reads back active) |
| [`mutable/mu_probe.mjs`](mutable/README.md) | Ran: 9 of 16 (a Customizable Object made by `new_customizable_object` compiles in an editor and in a `-nullrhi` commandlet, and agent-meshes parts import as skeletal meshes; the failing checks: a script cannot add a node to the object's graph or link a pin, so the object has no parameter and no variant to set or capture) |
| [`anim_bridge/anim_runtime.mjs`](anim_bridge/README.md) | Ran: 13 of 13 (a played state machine, a 2D blend space, linked layers) |
| [`chaos_break`](chaos_break/README.md) | Ran: 11 of 11 (a code-built collection with hulls breaks in a running game; the controls do not), 11 of 11 with `--render` and the engine material, 11 of 11 with `--material project --render`, and 11 of 11 with `--sizes` |
| [`automation_test/automation_reference.mjs`](automation_test/README.md), [`insights_capture/insights_stats.mjs`](insights_capture/README.md) | Ran: 7 of 7 (headless Automation runs); 8 of 8 (`stat` output, traces) |
| [`rendering_probes`](rendering_probes/README.md) | Ran: `rp_rt_validate.mjs --offscreen` 8 of 8 (the MegaLights tracing routes); `rp_viewport.mjs` headless extras 3 of 3 and `--offscreen` 11 of 11 (the directional-light message, read from screenshots by an agent). The editor's Project Settings toggle (`--phase toggle-prepare` and `toggle-judge`) 2 of 2: it wrote `r.RayTracing` and `r.SkinCache.CompileShaders` |
| [`compare-scene`](compare-scene/README.md) | Ran (`compare_gpu_run.mjs`, a throwaway project, packaged Development build): `compare_perf.mjs` 7 of 7 rendered and 4 of 4 headless (GPU frame time next to wall, game and render thread times in the receipt; headless reads 0 for GPU, game and render thread time, so the headless check reads wall time) |
| [`unity_build`](unity_build/README.md), [`editor_probes/probe_timeout.mjs`](editor_probes/README.md) | Ran: `--only-readonly` 4 of 4 (the read-only unity working set); 7 of 7 (the probe launcher under a timeout) |
| [`gameplay_cameras`](gameplay_cameras/README.md), [`skeletal_materials`](skeletal_materials/README.md) | Ran: 34 of 34 (Gameplay Cameras in a running game); 15 of 15, headless and with `--rendering` (skeletal mesh material slots from an editor module) |
| [`statetree_bridge`](statetree_bridge/README.md) | Ran: 21 of 21 (the AI component schema as before, the component schema on a plain pawn, and a tree parameter bound to a condition) |
| [`gas_native`](gas_native/README.md) | Ran: `gas_native.mjs` 24 of 24 (the Gameplay Effect components, 44 cases, 5 recorded as observations only); `gas_rep.mjs` 10 of 10 checks, 11 of 11 with `--pie-readback` (a dedicated server and one client on one machine: a Mixed-mode component owned by a player state, a granted ability, an active effect and an attribute replicated; the pawn as avatar worked; the player state as avatar did not). Not run: `--render` |
| [`pcg_packaged`](pcg_packaged/README.md) | Ran (a throwaway project, packaged Development build, headless and rendered): 63 of 63 checks and 36 observations (`GENERATE_AT_RUNTIME` in a cooked game, the cook contents, a partitioned runtime volume with streaming in play); about 7 GB of disk |
| [`dedicated_server`](dedicated_server/README.md) | Ran (a throwaway project on an installed engine): the Server target build is refused by Unreal Build Tool (exit 6, "Server targets are not currently supported from this engine distribution."); a packaged Game started with `-server` stays Standalone and never listens, and with `?listen` it listens, welcomes a second process of the same build and replicates an integer (4 of 4 checks, net mode ListenServer) |
| [`landscape_bridge/landscape_world.mjs`](landscape_bridge/README.md) | Ran: `--rendering` 18 of 18 and `-nullrhi` 16 of 18 (a Landmass brush attached through a bridge function, PCG sampling a partitioned Landscape: 1209 points in a rendering editor and 0 in a `-nullrhi` one, four proxies loaded with `load_actors` then unloaded with `unload_actors`; `unload_actors` alone changed nothing) |
