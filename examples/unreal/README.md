# Unreal sample scene scripts

For a native C++ game rather than this import sample, see [native Unreal build and capture](../../skills/unreal-native/references/unreal-native-game.md). It records a separate Unreal 5.8.2 execution path and its observed build, material, font and capture traps. Do not assume this sample's PIE evidence establishes a packaged game.

For comparing several implementations of one visible thing side by side in a native game, see [compare-scene](compare-scene/README.md).

Verified on Unreal Engine 5.7.3 and 5.8.3, Windows (5.8.3 needed three changes, listed in the Unreal import notes (`unreal-import` skill)). They build the [Unreal sample scene](../../docs/sample-scene.md), the Unreal build of the shared scene spec in agent-engine, and
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

Six scripts back [Niagara in Unreal](../../skills/unreal-features/references/unreal-niagara.md). They need a project with PythonScriptPlugin, EditorScriptingUtilities and Niagara, plus NiagaraToolsets (Experimental) for the second. Each writes a JSON report (`NIAGARA_PROBE_REPORT`, default under the project's `Saved/`).

```text
UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=niagara_build.py -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=niagara_toolset_author.py ...same flags...
UnrealEditor.exe Project.uproject /Game/Maps/NiagaraProbe -RenderOffScreen -ExecCmds="py <path>/niagara_verify.py" -log=niagara.log -notraceserver -nosplash -unattended
```

`niagara_validate.mjs` runs all of them in order on a throwaway project in the OS temp folder, plus `niagara_traps.py` (the API facts the reference states), and checks 15 claims, printing PASS or FAIL per claim: `node niagara_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8"`. Its pure checks have node tests in the merge lane (`niagara-validate.test.mjs`); the Unreal run takes about a minute and is a manual lane. That step exits 1 on purpose.

`niagara_build.py` duplicates two engine template systems and places them in a level; `niagara_toolset_author.py` creates a system and adds an emitter through Epic's toolsets and places it; `niagara_verify.py` runs the level in Play-In-Editor, counts particles per emitter with a simulation cache and polls each system's compile state. They run on Unreal 5.8.2 only.

`niagara_templates.py` lists the one-line description Epic ships with each fluid, sand and core template system (`NIAGARA_TEMPLATES_REPORT` sets the JSON path); it backs the catalog in [Niagara templates](../../skills/unreal-features/references/unreal-niagara-templates.md).

`engine_plugins.mjs` lists the plugins an engine install ships from their `.uplugin` descriptors (name, category, enabled by default, beta or experimental, description): `node engine_plugins.mjs --engine "<UE folder>" --name PCG,Metasound`. It needs no Unreal run and has node tests in the merge lane. `unreal_surface.py` lists what the `unreal` Python module exposes for a feature (`UNREAL_SURFACE_MATCH=Hair,Groom`), run headless in a project that enables the plugin. Both back the [Unreal feature selector](../../skills/unreal-features/SKILL.md) and its references.

A larger demonstration, [`niagara-showcase`](niagara-showcase/README.md), is an arena of eight stations built from Epic's shipped fluid, sand, ribbon and burst systems plus one system authored through the toolsets. You fly around it with a keyboard and mouse or a gamepad; an automatic camera tour is the hands-off alternative. The same folder has `stage_build.py`, which puts any list of Niagara systems on a flat plane for side-by-side evaluation.

To look at the probe level yourself, `niagara_view.py` frames the systems with the level's camera, labels them and restarts one-shot bursts every few seconds. In the editor: `UnrealEditor.exe Project.uproject /Game/Maps/NiagaraProbe -ExecCmds="py <path>/niagara_view.py"`. As a standalone game (no editor UI), set `NIAGARA_VIEW_GAME=1` and add `-game -windowed -ResX=1280 -ResY=720`. In a game process any `EditorLevelLibrary` call crashes with an access violation, so game mode finds the world with `ObjectIterator`; it was observed running for 25 seconds with no crash, and the window content was not checked by a person here. It is not part of the validation run.
