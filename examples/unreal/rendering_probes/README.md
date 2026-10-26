# Rendering probes: ForwardShadingPriority on directional lights

Backs the [tested] lines of [Two directional lights: ForwardShadingPriority and the renderer message](../../../skills/unreal-rendering/references/unreal-directional-lights.md). Verified on Unreal Engine 5.8.2, Windows. Nothing here needs a project or an asset of yours: the validator makes a throwaway project in the OS temp folder.

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
- The node tests run these rules on a canned 5.8.2 report. A fresh run against an engine of another version is where a changed outcome would show.

## What it showed (5.8.2)

- Two spawned `DirectionalLight` actors read `forward_shading_priority` 0 and 0; `set_forward_shading_priority(1)` on one gave 1 and 0. The component's mobility reads `STATIONARY`, and reading the attribute `light.forward_shading_priority` gave 0 before the call.
- Other routes, each on its own fresh light: `set_editor_property("forward_shading_priority", 2)` stored 2. Assigning the attribute (`light.forward_shading_priority = 3`) raised `DirectionalLightComponent: Property 'ForwardShadingPriority' for attribute 'forward_shading_priority' on 'DirectionalLightComponent' is read-only and cannot be set`. The setter with -3, after the setter had stored 2, read back 0. A component whose mobility was set to Static kept 4 after `set_forward_shading_priority(5)`.
- `unreal.SystemLibrary.get_console_variable_int_value("r.MegaLights.Allow")` returned 0 and logged `LogBlueprintUserMessages: Warning: Failed to find console variable 'r.MegaLights.Allow'.`; `r.MegaLights.Allowed` returned 1 and logged nothing. The commandlet exited with 0.

## Not verified

The renderer's on-screen message. It is drawn only by a rendering editor viewport, and this probe runs with `-nullrhi`, so the message was not reproduced and its disappearance after raising one priority was not observed. Also not run: whether `set_editor_property` refreshes a rendering viewport the way the setter's render-state update does, a day and night cycle, and the setter on a component that is not registered. Probes for the message, the property route, the unregistered component and the MegaLights tracing routes are prepared under "Opt-in probes" below and have not been run.

## Opt-in probes (prepared, not yet run on an engine)

**Status:** Prepared 2026-10-26. `rp_validate.mjs` with its stricter route check ran on Unreal 5.8.2 the same day and passed 3 of 3; the opt-in probes in this section (`rp_rt_validate.mjs`, `rp_viewport.mjs`) have not yet run on an engine, and a first run tests a probe before it tests the engine. Nothing in this section changes `rp_validate.mjs` or what the default run above does. Every engine name the scripts call was found in the 5.8.2 install first (a comment beside each call names the file); the expected log lines, settings and outcomes come from reading that source, so a failed check on a first run may be the probe's mistake or a wrong reading, and the detail line says what was seen. The canned reports in the tests are shaped like what the scripts are written to produce; the first run confirms the shapes.

| File | What it does |
|---|---|
| `rp_rt_validate.mjs`, `rp_rt_probe.py`, `rp-rt-checks.mjs`, `rp-rt.test.mjs` | MegaLights tracing routes and the editor's ray tracing toggle (below) |
| `rp_viewport.mjs`, `rp_viewport_probe.py`, `rp-viewport-checks.mjs`, `rp-viewport.test.mjs` | the directional-light claims that need a rendering editor viewport (below) |

### MegaLights: the tracing routes and the editor toggle

```text
node examples/unreal/rendering_probes/rp_rt_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--warmup-seconds 120]
```

Needs a GPU window: three launches of a **rendering editor** (visible window, no `-nullrhi`; keep it in front and run no other Unreal process), on a DirectX 12 GPU with ray tracing for the two hardware claims. About 10 minutes plus the first shader compile. Each launch writes its own `Config/DefaultEngine.ini` into a throwaway project (the graphics lines are the ones the engine writes for a new project: DX12, SM6 only):

| Launch | Settings | Judged |
|---|---|---|
| `fatal` | `r.RayTracing=True`, skin cache shaders left at their default | the log has `Ray tracing requires skin cache to be enabled. Set r.SkinCache.CompileShaders>=1.`, the process ends by itself with a non-zero exit code, and the script never ran (`Engine/Source/Runtime/RenderCore/Private/RenderUtils.cpp`) |
| `hardware` | both on, `r.MegaLights.EnableForProject=True` | the log says ray tracing is enabled (`r.RayTracing.EnableOnDemand` defaults to 1, so the line reads "enabled (dynamic)"), no Fatal; the script reads `r.RayTracing`, `r.SkinCache.CompileShaders`, `r.MegaLights.EnableForProject`, `.Allowed` and `.HardwareRayTracing` back, lights a small scene (a floor, a cube, four movable point lights), waits `--warmup-seconds` for the viewport and shaders, and runs `ProfileGPU`; the lines between its two `[rp_rt]` markers are searched for a MegaLights pass |
| `software` | `r.RayTracing` off, `r.GenerateMeshDistanceFields=True`, `r.MegaLights.SoftwareRayTracing.Allow=1` | the log says ray tracing is disabled by the project setting, no Fatal; the same read-back and `ProfileGPU` (`MegaLightsRayTracing.cpp`: software tracing needs mesh distance fields and the Allow variable) |

How MegaLights reports itself active is not identified; the `ProfileGPU` MegaLights pass is a candidate read-back, and the two profile checks fail if it is not. Other candidates from the source, not prepared: the renderer's own on-screen warning "MegaLights is enabled, but has no ray tracing data and won't operate correctly." (`MegaLights.cpp` `WriteWarnings`, viewport only), and `stat GPU`. The Niagara Light Renderer's two switches (`bAllowMegaLights`, `bMegaLightsCastShadows`) and a count of the lights drawn are not prepared.

**Interactive: does the editor toggle write the skin cache setting?** A script cannot answer this: the Project Settings window writes the ini, and a Python `set_editor_property` on the settings object runs in an unattended script, where the skin cache prompt takes its default answer (No, `MessageDialog.cpp`) and the toggle reverts (`RendererSettings.cpp` `PostEditChangeProperty`). So:

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
node examples/unreal/rendering_probes/rp_viewport.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --interactive        # INTERACTIVE, see below
node examples/unreal/rendering_probes/rp_viewport.mjs --judge --report <viewport-report.json> --observed <observations.json>
```

The headless extras (same launch as `rp_validate.mjs`) answer three of the open questions without a viewport: the existing-level form (`get_all_level_actors` filtered to `DirectionalLight`, then the priority set on the sun's component), the setter on a component made with `unreal.new_object` that the world never registered (source predicts it stores the value; the outcome is recorded, not asserted), and `r.ForwardShading`.

**The interactive part is marked INTERACTIVE and needs a person.** The renderer's orange message is drawn only by a rendering editor viewport, so no script can see it. `--interactive` opens a rendering editor with a visible window, spawns a sun and a moon, and steps them through eight phases (`tie`, `raise_setter`, `back_to_tie`, `raise_property`, `back_property`, `moon_component_hidden`, `moon_zero_intensity`, `moon_actor_hidden_in_editor`), 30 s each after a 20 s settle (`--phase-seconds`). The terminal prints each phase as it starts; for each one the owner:

1. looks at the top left of the viewport and notes whether the two-line orange message "Multiple directional lights are competing to be the single one used for forward shading, translucent, water or volumetric fog. Please adjust their ForwardShadingPriority." is on screen;
2. takes a screenshot of the editor window if possible (the capture step; it is the evidence to keep next to the answer);
3. when the editor has quit, fills in `observations.json` (written next to the report): `message_visible` true or false for every phase and, for `tie`, `text_seen` (the first words read) and `colour`.

`--judge` then checks the three phases the source predicts (message shown in `tie` and `back_to_tie`, gone in `raise_setter`), that the lights read back as scripted, that the project is deferred (`r.ForwardShading` 0, which answers whether a deferred project shows the message), the tie text and colour, and records the five phases the source does not settle: `set_editor_property` raising and lowering, a hidden moon component, a moon at intensity 0, and a moon actor hidden in the editor.

Not prepared: a day and night cycle, raising the moon's priority at night, whether the level needs saving or the change is undoable, other engine builds and a packaged game, and the Virtual Shadow Maps clipmap-range before and after.
