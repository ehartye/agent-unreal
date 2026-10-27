# Rendering probes: ForwardShadingPriority on directional lights

Backs the [tested] lines of [Two directional lights: ForwardShadingPriority and the renderer message](../../../skills/unreal-rendering/references/unreal-directional-lights.md). The default run and the opt-in probes are verified on Unreal Engine 5.8, Windows. Nothing here needs a project or an asset of yours: the validator makes a throwaway project in the OS temp folder.

## Run

```text
node examples/unreal/rendering_probes/rp_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep]
```

It starts one hidden headless commandlet (`-run=pythonscript`, `-nullrhi`), usually under a minute including the first start of the new project (timing varies with machine load), prints PASS or FAIL per check and exits 0 when every check passes. A line is written, and flushed, as each phase starts and ends, so a redirected run shows progress. The project folder is deleted after a clean run. A failed check or a missing report keeps it and prints its path and the editor log's path; `--keep` also keeps it after a clean run. The folder holds `Saved/probe.json` (the report) and `Saved/Logs/probe.log`. It is not part of `node scripts/check.mjs`; the check logic is tested there (`rp-validate.test.mjs`).

## Files

| File | What it does |
|---|---|
| `rp_probe.py` | makes a level, spawns `DirectionalLight` actors and reads `forward_shading_priority` through `get_editor_property`; calls `set_forward_shading_priority(1)` on one of two lights; tries four other routes to the property, each on a fresh light in its own `try`, keeping the whole error text; looks up two console variables |
| `rp_validate.mjs` | writes the throwaway project, runs the probe once (a timeout is retried once), stops only processes that name that project, judges the report and the log |
| `rp-validate-checks.mjs`, `rp-validate.test.mjs` | the checks as a pure function of the report and the log text, plus the folder-keeping rule and the flushed-line writer; the test changes one fact at a time and expects the matching check to fail, and an empty report to fail every check |

## What the checks judge

- Check 2 rejects any recorded text that is a Python `AttributeError` or `NameError` (a bug in the probe, not an engine result) and asserts the outcomes the reference's [tested] lines state: the setter route stores 2, attribute assignment raises the read-only error, the setter with -3 after 2 reads back 0, a Static component keeps 4, a spawned light's mobility reads `STATIONARY`, and reading the attribute works. A changed outcome fails the check; before, it only needed each route to record something.
- The node tests run these rules on a canned report. A fresh run against another engine build is where a changed outcome would show.

## What it showed

- Two spawned `DirectionalLight` actors read `forward_shading_priority` 0 and 0; `set_forward_shading_priority(1)` on one gave 1 and 0. The component's mobility reads `STATIONARY`, and reading the attribute `light.forward_shading_priority` gave 0 before the call.
- Other routes, each on its own fresh light: `set_editor_property("forward_shading_priority", 2)` stored 2. Assigning the attribute (`light.forward_shading_priority = 3`) raised `DirectionalLightComponent: Property 'ForwardShadingPriority' for attribute 'forward_shading_priority' on 'DirectionalLightComponent' is read-only and cannot be set`. The setter with -3, after the setter had stored 2, read back 0. A component whose mobility was set to Static kept 4 after `set_forward_shading_priority(5)`.
- `unreal.SystemLibrary.get_console_variable_int_value("r.MegaLights.Allow")` returned 0 and logged `LogBlueprintUserMessages: Warning: Failed to find console variable 'r.MegaLights.Allow'.`; `r.MegaLights.Allowed` returned 1 and logged nothing. The commandlet exited with 0.

## Not verified

The renderer's on-screen message in this default run. It is drawn only by a rendering editor viewport, and this probe runs with `-nullrhi`, so the message is not reproduced here; the opt-in `rp_viewport.mjs --offscreen` below reproduced it. Also not run: a day and night cycle. The setter on a component that is not registered, the `set_editor_property` route and the MegaLights tracing routes are covered under "Opt-in probes" below.

## Opt-in probes

**Status:** Prepared 2026-10-26. `rp_validate.mjs` with its stricter route check passed 3 of 3. From a session with no desktop (SSH), `rp_rt_validate.mjs --offscreen` passed 8 of 8, `rp_viewport.mjs` passed its 3 headless extras, and `rp_viewport.mjs --offscreen` passed 11 of 11 with the observations read from eight screenshots by an agent. Earlier runs of `rp_rt_validate.mjs` passed 2 of 8 (the editor window's swap chain failed at start) and then 6 of 8 (the profile was taken from a viewport that drew nothing); both are fixed in the script by the flag and the Play-In-Editor change below. Not run: the interactive Project Settings toggle of the next section. Nothing in this section changes `rp_validate.mjs` or what the default run above does. Every engine name the scripts call was found in the installed engine source first (a comment beside each call names the file); the expected log lines, settings and outcomes came from reading that source.

| File | What it does |
|---|---|
| `rp_rt_validate.mjs`, `rp_rt_probe.py`, `rp-rt-checks.mjs`, `rp-rt.test.mjs` | MegaLights tracing routes and the editor's ray tracing toggle (below) |
| `rp_viewport.mjs`, `rp_viewport_probe.py`, `rp-viewport-checks.mjs`, `rp-viewport.test.mjs` | the directional-light claims that need a rendering editor viewport (below) |

### MegaLights: the tracing routes and the editor toggle

```text
node examples/unreal/rendering_probes/rp_rt_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--offscreen] [--warmup-seconds 120]
```

Needs a GPU: three launches of a **rendering editor** (no `-nullrhi`; run no other Unreal process), on a DirectX 12 GPU with ray tracing for the two hardware claims. Without `--offscreen` the editor opens a visible window (keep it in front). `--offscreen` adds `-RenderOffScreen` for a session with no desktop (SSH, a service), where a visible window cannot be created: the editor ends with exit 3 at its window swap chain. Either way the script starts a Play-In-Editor session and profiles that viewport, because the offscreen editor's own level viewport drew nothing on an earlier engine build (see [Editor Python run modes](../../../skills/unreal-editor-scripting/references/unreal-editor-python.md)). About 10 minutes plus the first shader compile. Each launch writes its own `Config/DefaultEngine.ini` into a throwaway project (the graphics lines are the ones the engine writes for a new project: DX12, SM6 only):

| Launch | Settings | Judged |
|---|---|---|
| `fatal` | `r.RayTracing=True`, skin cache shaders left at their default | the log has `Ray tracing requires skin cache to be enabled. Set r.SkinCache.CompileShaders>=1.`, the process ends by itself with a non-zero exit code, and the script never ran (`Engine/Source/Runtime/RenderCore/Private/RenderUtils.cpp`) |
| `hardware` | both on, `r.MegaLights.EnableForProject=True` | the log has the line "Ray tracing is enabled" (`r.RayTracing.EnableOnDemand` read back 1), no Fatal; the script reads `r.RayTracing`, `r.SkinCache.CompileShaders`, `r.MegaLights.EnableForProject`, `.Allowed` and `.HardwareRayTracing` back, lights a small scene (a floor, a cube, four movable point lights), waits `--warmup-seconds` for the viewport and shaders, and runs `ProfileGPU`; the lines between its two `[rp_rt]` markers are searched for a MegaLights pass |
| `software` | `r.RayTracing` off, `r.GenerateMeshDistanceFields=True`, `r.MegaLights.SoftwareRayTracing.Allow=1` | the log says ray tracing is disabled by the project setting, no Fatal; the same read-back and `ProfileGPU` (`MegaLightsRayTracing.cpp`: software tracing needs mesh distance fields and the Allow variable) |

What the run showed (8 of 8, `--offscreen`):

- `fatal`: exit 3 after about 2 s, the log line "Ray tracing requires skin cache to be enabled. Set r.SkinCache.CompileShaders>=1.", and no report written.
- `hardware`: the "Ray tracing is enabled" line, a report, exit 0 after about 160 s. Read back: `r.RayTracing` 1, `r.SkinCache.CompileShaders` 1, `r.GenerateMeshDistanceFields` 0, `r.MegaLights.EnableForProject` 1, `.Allowed` 1, `.HardwareRayTracing` 1, `.HardwareRayTracing.Inline` 1, `.SoftwareRayTracing.Allow` 0, `r.RayTracing.EnableOnDemand` 1, `r.ForwardShading` 0. The `ProfileGPU` section held 14 lines naming MegaLights.
- `software`: the log line "Ray tracing is disabled. Reason: disabled through project setting (r.RayTracing=0)". Read back: `r.RayTracing` 0, `r.GenerateMeshDistanceFields` 1, `.SoftwareRayTracing.Allow` 1, `r.MegaLights.EnableForProject` 1. The profile section held 14 lines naming MegaLights.

The `ProfileGPU` section of the report held 14 lines naming MegaLights in both phases, and both profile checks passed on that count; the count alone does not show that MegaLights is active. This is one project and one small scene; the run does not show how MegaLights reports itself in another project. Other candidates from the source, not prepared: the renderer's own on-screen warning "MegaLights is enabled, but has no ray tracing data and won't operate correctly." (`MegaLights.cpp` `WriteWarnings`, viewport only), and `stat GPU`. The Niagara Light Renderer's two switches (`bAllowMegaLights`, `bMegaLightsCastShadows`) and a count of the lights drawn are not prepared.

**Interactive: does the editor toggle write the skin cache setting?** Not run on any engine. A script cannot answer this: the Project Settings window writes the ini, and a Python `set_editor_property` on the settings object runs in an unattended script, where the skin cache prompt takes its default answer (No, `MessageDialog.cpp`) and the toggle reverts (`RendererSettings.cpp` `PostEditChangeProperty`). So:

```text
node rp_rt_validate.mjs --engine <folder> --phase toggle-prepare     # makes a project and saves Saved/toggle-before.ini
# YOU: open the project in a rendering editor, tick Project Settings > Engine > Rendering > Hardware Ray Tracing > Support Hardware Ray Tracing,
#      answer Yes to the skin cache question, close the editor
node rp_rt_validate.mjs --phase toggle-judge --project <that folder>
```

The judge diffs the `[/Script/Engine.RendererSettings]` section and prints every key that changed; it passes when `r.RayTracing` is written and a skin cache key (`r.SkinCache.CompileShaders`, or the property name `SkinningShaderSupport`) is written as something other than the inline-only value. The source predicts both on a Yes.

### Directional lights: what needs a rendering viewport

```text
node examples/unreal/rendering_probes/rp_viewport.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep]             # headless extras, about a minute, no GPU
node examples/unreal/rendering_probes/rp_viewport.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --offscreen          # no desktop needed, an agent reads the screenshots, see below
node examples/unreal/rendering_probes/rp_viewport.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --interactive        # INTERACTIVE, see below
node examples/unreal/rendering_probes/rp_viewport.mjs --judge --report <viewport-report.json> --observed <observations.json>
```

The headless extras (same launch as `rp_validate.mjs`) answer three of the open questions without a viewport: the existing-level form (`get_all_level_actors` filtered to `DirectionalLight`, then the priority set on the sun's component), the setter on a component made with `unreal.new_object` that the world never registered (the outcome is recorded, not asserted), and `r.ForwardShading`. They passed 3 of 3: the existing-level form found both lights and set each, the setter on an unregistered component recorded the value 3, and `r.ForwardShading` read 0.

**`--offscreen`** (implies `--interactive`; for a session with no desktop) starts the rendering editor with `-RenderOffScreen`, begins a Play-In-Editor session, changes the PIE copies of the two lights through the same calls, and takes one `Shot showui` screenshot in the middle of each of the eight phases (the file is `rpv_<phase>00000.png` under `Saved/Screenshots/WindowsEditor/`; it shows the whole editor window, 1280 by 720). A high-res screenshot would omit the message ([Editor Python run modes](../../../skills/unreal-editor-scripting/references/unreal-editor-python.md)). An agent reads the eight images and fills `observations.json`; `--judge` then checks them as below. It passed 11 of 11. The images showed the orange message, in the top left of the viewport, in `tie`, `back_to_tie`, `back_property` and `moon_actor_hidden_in_editor`, and not in `raise_setter`, `raise_property`, `moon_component_hidden` and `moon_zero_intensity`. The text read "Multiple directional lights are competing to be the single one used for forward shading, translucent, water or volumetric fog. Please adjust their ForwardShadingPriority. As a fallback, the main directional light will be selected based on overall brightness." The renderer was deferred (`r.ForwardShading` 0). The `moon_actor_hidden_in_editor` hide was applied to the PIE copy, where it left the message on. Caveats: the observations came from reading screenshots, not from a person watching, and the phases ran in a Play-In-Editor viewport, not in the level editor viewport.

**The interactive part is marked INTERACTIVE and needs a person.** It was not run. The renderer's orange message is drawn only by a rendering editor viewport, so a script cannot see it. `--interactive` opens a rendering editor with a visible window, spawns a sun and a moon, and steps them through eight phases (`tie`, `raise_setter`, `back_to_tie`, `raise_property`, `back_property`, `moon_component_hidden`, `moon_zero_intensity`, `moon_actor_hidden_in_editor`), 30 s each after a 20 s settle (`--phase-seconds`). The terminal prints each phase as it starts; for each one the owner:

1. looks at the top left of the viewport and notes whether the two-line orange message "Multiple directional lights are competing to be the single one used for forward shading, translucent, water or volumetric fog. Please adjust their ForwardShadingPriority." is on screen;
2. takes a screenshot of the editor window if possible (the capture step; it is the evidence to keep next to the answer);
3. when the editor has quit, fills in `observations.json` (written next to the report): `message_visible` true or false for every phase and, for `tie`, `text_seen` (the first words read) and `colour`.

`--judge` then checks the three phases the source predicts (message shown in `tie` and `back_to_tie`, gone in `raise_setter`), that the lights read back as scripted, that the project is deferred (`r.ForwardShading` 0, which answers whether a deferred project shows the message), the tie text and colour, and records the five phases the source does not settle: `set_editor_property` raising and lowering, a hidden moon component, a moon at intensity 0, and a moon actor hidden in the editor.

Not prepared: a day and night cycle, raising the moon's priority at night, whether the level needs saving or the change is undoable, other engine builds and a packaged game, and the Virtual Shadow Maps clipmap-range before and after.
