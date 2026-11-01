# Niagara showcase and stage

The launch transcript below is historical evidence of the earlier hand run. For current execution use the [shared launcher](../engine_lock/README.md) with fresh evidence; do not reuse bare `Start-Process` engine launches.

Two Unreal 5.8 scenes built only from engine content and driven by Python, both flown with a keyboard and mouse or a gamepad:

- **The arena** (`showcase_build.py`): eight stations that show what Epic's shipped Niagara systems do, plus one system authored through the Niagara toolsets.
- **The stage** (`stage_build.py`): a single flat plane that holds any list of Niagara systems, for looking at them side by side. Use it to evaluate a template or compare candidates.

Each system switches on as the camera comes close. An automatic camera tour (`showcase_run.py`) is the hands-off alternative.

| Arena station | System | What it shows |
| --- | --- | --- |
| 2D fire | `Grid2D_Gas_MovingFire` | A GPU grid fluid drawn as a sprite: the fire Epic ships for parenting in a map |
| 3D fire | `Grid3D_Gas_Fire` | A GPU grid fluid: fire and embers advected through a 3D volume (no smoke) |
| Explosion | `Grid3D_Gas_Explosion` | A 3D gas explosion that restarts every 10 s |
| Liquid hose | `Grid3D_Flip_Hose` | A 3D FLIP liquid (particles plus a grid) |
| Sand | `SandSystem` | A granular simulation: thousands of spheres that pile and flow |
| Ribbon trails | `AttributeReaderTrails` | Ribbons that read attributes from another emitter's particles |
| Radial burst | `RadialBurst` | CPU sprites, restarting every 5 s |
| Authored here | `NS_ShowcaseVortex` | The radial-burst system with vortex, curl-noise and point-attraction modules added through Epic's Niagara toolsets |

## Project setup

Enable PythonScriptPlugin, EditorScriptingUtilities, Niagara and NiagaraFluids (and NiagaraToolsets, Experimental, for the arena's authored system). For the 3D fluid templates enable Generate Mesh Distance Fields and restart the editor ([Epic: Mesh Distance Fields](https://dev.epicgames.com/documentation/unreal-engine/mesh-distance-fields-in-unreal-engine)):

```ini
; Config/DefaultEngine.ini
[/Script/Engine.RendererSettings]
r.GenerateMeshDistanceFields=True
```

## Build and run (PowerShell)

Build a level once, headless, then open it in a game window. `$ue` is the engine's `Engine/Binaries/Win64` folder and `$here` this folder:

```powershell
# arena: showcase_build.py -> /Game/Maps/NiagaraShowcase.  stage: stage_build.py -> /Game/Maps/NiagaraStage
$build = @("`"$proj`"", "-run=pythonscript", "-script=`"$here/stage_build.py`"", "-unattended", "-nullrhi", "-nosplash", "-nopause", "-nosound", "-notraceserver")
$p = Start-Process "$ue\UnrealEditor-Cmd.exe" -ArgumentList $build -PassThru -WindowStyle Hidden; $p.WaitForExit()

$env:NIAGARA_SHOWCASE_GAME = "1"
$play = @("`"$proj`"", "/Game/Maps/NiagaraStage", "-game", "-windowed", "-ResX=1600", "-ResY=900", "-nosplash", "-notraceserver", "-ExecCmds=`"py $here/showcase_explore.py`"")
Start-Process "$ue\UnrealEditor.exe" -ArgumentList $play
```

`$proj` is the `.uproject` path and `$here` uses forward slashes. `NIAGARA_SHOWCASE_GAME=1` selects the game-window path, where the script finds the world with `ObjectIterator`; leave it unset to run in the editor, which starts Play-In-Editor itself (click the viewport for focus). Details of the run modes are in [Editor Python](../../../skills/unreal-editor-scripting/references/unreal-editor-python.md).

## The stage

`stage_build.py` places a flat plane, a very dim directional light, a point light at each system and a camera. Systems stand on a ring around the centre (a single system stands at the centre), and `showcase_explore.py` finds the centre from the systems, so any number works. Set these environment variables before the build:

| Variable | Meaning | Default |
| --- | --- | --- |
| `NIAGARA_STAGE_SYSTEMS` | `;`-separated systems: `path`, `path@r,g,b` (light colour) or `path@r,g,b@seconds` (restart every N seconds) | the 2D and 3D fluid fire and smoke |
| `NIAGARA_STAGE_MAP` | map to write | `/Game/Maps/NiagaraStage` |
| `NIAGARA_STAGE_MOON` | directional light in lux, 0 for none | 0.4 |
| `NIAGARA_STAGE_LIGHT` | point light at each system in candela, 0 for none | 300 |

For example, `$env:NIAGARA_STAGE_SYSTEMS = "/Niagara/DefaultAssets/Templates/Systems/SimpleExplosion@255,200,120@6;/Niagara/DefaultAssets/Templates/Systems/RadialBurst@255,255,255@5"` builds a stage with two bursts that restart. [`niagara_templates.py`](../niagara_templates.py) lists the available templates and [Niagara templates](../../../skills/unreal-effects/references/unreal-niagara-templates.md) says what each is for.

## Controls

| | Keyboard and mouse | Gamepad |
| --- | --- | --- |
| Move | W A S D | left stick |
| Look | mouse, arrow keys | right stick |
| Up, down | Space, C | right trigger, left trigger |
| Boost | hold Shift | hold B, or press the left stick in |
| Previous, next station | Q, E (or 1 to 8) | left bumper, right bumper |
| Restart the nearest station | F | A |
| Hide or show the help line | H | Y |
| Quit | Esc | close the window |

The previous and next controls glide the camera to a pose in front of a station; any movement or look input cancels the glide. A station switches on within 1000 cm of the camera and off beyond 1300 cm, with at most three running at once. Explosions and bursts replay on a timer while you are near. A line on screen shows the nearest station and what is running.

A system compiles the first time it is activated, from a fraction of a second up to about a minute for a fluid, and the window waits meanwhile; the result is cached. Fly toward a station to activate it ahead of the moment you want to look at it.

## Tour

`showcase_run.py` glides to each station, drifts around it and moves on, switching systems on shortly before the camera arrives. Launch it the same way with that script. Hold and transit seconds, the start station and per-station screenshots are environment variables listed at the top of the file.

## Self-test

`NIAGARA_SHOWCASE_SELFTEST=1` replaces the device with scripted input, checks the motion maths (full-stick speed, strafing, turn rate, the pitch limit, boost), glides to every station and checks the switching rules (the station is the nearest, it is running, at most three run). It logs `[showcase_explore] selftest PASS` or `FAIL ...` and, in a game process, quits. Add `-RenderOffScreen -unattended -abslog=<file>` to the launch to run it without a visible window. `NIAGARA_SHOWCASE_SHOTS=1` (editor only) also writes one screenshot per station under `Saved/Screenshots`, after `NIAGARA_SHOWCASE_SETTLE` seconds at the station (default 4; an offscreen editor runs a few frames per second, so the fluids need about 12).

One command runs and judges it: `node showcase_validate.mjs --engine <UE_5.8 folder> [--keep] [--timeout-ms N]`. It writes a throwaway project in the OS temp folder (the plugins above and `r.GenerateMeshDistanceFields=True`), builds the arena headless, runs the self-test in an offscreen game process (`NIAGARA_SHOWCASE_GAME=1`, `-game -windowed -RenderOffScreen`), and `showcase-validate-checks.mjs` judges the build report and both logs: the PASS line, each of the 12 checks (four motion, eight stations) on its own, the check count and any fatal error. The first activation of each fluid compiles it, so the run allows 40 minutes by default. The node test `showcase-validate.test.mjs` covers the judge (pass, a FAIL line, a missing PASS line, a timeout). Status: run, 19 of 19 asserted checks passed and 2 observations were recorded (55 s once the shaders are cached): the arena builds with eight stations, the game-mode self-test finishes and reports exactly the 12 checks (four motion, eight stations), each judged, with no fatal error. In a `-game` run the log shows two tracebacks at start-up from Epic's own experimental plugins: `NiagaraToolsets` (`from skills import blueprint_interop`, `unreal` has no attribute `AgentSkill`) and `ToolsetRegistry` (`unreal.PythonTestRunner.create`, no attribute `PythonTestRunner`). They do not stop the toolsets (the same toolset calls work in the editor runs); the validator records them as an observation and fails only for a traceback from the showcase scripts.

Earlier hand runs on an earlier engine build, Windows, in a game process (not repeated by hand on the pinned build): the arena (12 checks, eight stations), the default stage (four systems) and a one-system stage. The self-test drives the same input code the devices feed, with scripted values; reading a physical gamepad and mouse uses the player-controller calls listed in [Editor Python](../../../skills/unreal-editor-scripting/references/unreal-editor-python.md).

The scenes show Epic's templates at their default settings and make no performance claim: only systems near the camera run, at most three at once.
