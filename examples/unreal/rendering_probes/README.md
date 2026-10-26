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

The renderer's on-screen message. It is drawn only by a rendering editor viewport, and this probe runs with `-nullrhi`, so the message was not reproduced and its disappearance after raising one priority was not observed. Also not run: whether `set_editor_property` refreshes a rendering viewport the way the setter's render-state update does, a day and night cycle, and the setter on a component that is not registered.
