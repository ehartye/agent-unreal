# agent-unreal

A Claude Code plugin of skills for working in Unreal Engine 5.8 from a coding agent. It picks the engine system that
fits a goal and says how an agent drives it (Python, Blueprint, C++, console variables or project settings), builds,
packages and profiles a native C++ game, audits a project's structure and its testing and performance practice against Epic's documentation and plans the fixes, authors for UEFN, and imports [agent-meshes](https://github.com/ehartye/agent-meshes)
models, [agent-sprites](https://github.com/ehartye/agent-sprites) atlases and
[agent-beeps](https://github.com/ehartye/agent-beeps) sounds into Unreal with a guarded importer. It pairs with
[agent-engine](https://github.com/ehartye/agent-engine), which chooses an engine and imports into Unity, Godot and the web,
and with agent-meshes, whose `mesh-tool-selection` decides between Blender and Unreal for a mesh.

The references cover the current 5.8 systems. A legacy system gets one line saying what superseded it and its Epic
status. Claims are backed by Epic documentation or by the engine install itself, and a statement that was run in this
repository is marked as tested.

## Status

Early (0.34.0). Fourteen skills.

The skills moved here from agent-engine 0.14.0, where their history up to that tag lives; `unreal-import` and its importer scripts followed in 0.2.0. The scripts in `examples/`
were run on Windows against the engine build pinned in `engine-version.json` unless their README says an earlier build or a hand run; other platforms were not run. The sample scene, the `compare.ps1` example set and the showcase hand runs are earlier-build observations.

[`docs/sample-scene.md`](docs/sample-scene.md) records what earlier builds of Unreal and UEFN passed of the cross-engine
sample scene, none of it verified on the pinned builds. Its spec stays in agent-engine, which also holds the Godot, Unity and web builds.

## Verification status

Epic's MCP plugin was tried on an earlier Unreal build and an earlier UEFN build: it drives the editor and returns screenshots, but has no
audio import and rejects GLB. This was not repeated on the pinned builds.

One consuming UEFN project on an earlier UEFN build additionally reported native Python authoring,
scoped actor saves, editor captures, automatic timeline playback and server controller-method
results, and native Python imports of Wave/Cue pairs with per-player playback settings (observed there, not
reproduced in this repo). A launch reached server cook but ended without a connected
game client. Physical button use, rendered reset poses, audible audio, multiplayer and performance remain open;
this does not establish a complete UEFN sample-scene pass.

The UEFN references cover [authoring routes](skills/uefn/references/uefn-authoring.md)
and [native operations](skills/uefn/references/uefn-native-operations.md) (with [switches](skills/uefn/references/uefn-native-switches.md),
[scoped saves](skills/uefn/references/uefn-native-saves.md), [proof cleanup](skills/uefn/references/uefn-native-cleanup.md) and
[capture](skills/uefn/references/uefn-native-capture.md)),
plus [native FBX coordinates and collision](skills/uefn/references/uefn-native-fbx.md)
and [native audio import](skills/uefn/references/uefn-native-audio.md).
The saved-controls reference also records the measured Fortnite Button component
reconstruction trap and a verified whole-vector MCP write with complete readback.
It also documents the measured native rotation constructor trap: use named axes
and verify the visible mesh's world front and up directions before scoped saves.
The [moving exhibit cover reference](skills/uefn/references/uefn-native-cover.md)
records the source-fitted chair pilot, bone-policy ordering, study-owned collision,
independent source-corner checks and failures that self-derived surface rays missed.
Its saved/editor proof remains separate from Fortnite gameplay and performance.
The saved-controls reference also records exact disposable-proof ownership,
hash-bound cleanup reconciliation and the observed Python-before-Unreal GC recovery,
with preserved failed receipts and no force-deletion or automatic replay.

The [Python helper reference](skills/uefn/references/uefn-python-helper-freshness.md)
records stale imports in a running editor, source identity checks and binding
functions after an owned helper reload, backed by a disposable native probe.

The [native Unreal game recipe](skills/unreal-native/references/unreal-native-game.md)
records a separate C++ build and actual offscreen game-camera loop, observed on an earlier engine build, with fresh automation JSON checks
because failed tests can exit zero. Its [presentation companion](skills/unreal-native/references/unreal-native-presentation.md)
covers the measured font/Slate commandlet crash, crisp Canvas glyph sizing and Canvas text drawing; its [exposure and vertex colour companion](skills/unreal-native/references/unreal-native-exposure-and-vertex-color.md) covers physical camera exposure and HDR palette traps.
The [Windows packaging reference](skills/unreal-native/references/unreal-native-packaging.md)
records an actual staged Game EXE separately from Editor-game evidence, including the UAT Application Control failure.
The [content pipeline](skills/unreal-native/references/unreal-native-content-pipeline.md)
records the tested content-only bake/native Game split, short-path cook fix and recipe/hash validation.
The [World Partition reference](skills/unreal-procedural/references/unreal-world-partition.md) covers making a partitioned map and large Water setups; its [Landscape](skills/unreal-procedural/references/unreal-world-partition-landscape.md) and [commandlet](skills/unreal-procedural/references/unreal-world-partition-commandlets.md) companions cover the Landscape proxy grid, converting a map and the builder commandlets, with scenes run in this repo. [PCG in a running game](skills/unreal-procedural/references/unreal-pcg-game-process.md) lists what a game process needs that the editor supplies. The [Python to C++ bridge](skills/unreal-editor-scripting/references/unreal-python-cpp-bridge.md) shows an editor module that creates a Landscape from a height array, and [automation tests](skills/unreal-native/references/unreal-native-automation-tests.md) shows how to write, run and read a 5.8 C++ test.
The [comparison scene reference](skills/unreal-native/references/unreal-native-compare-scene.md) and its [example](examples/unreal/compare-scene/README.md)
set several implementations of one visible thing side by side in a native game, film them and time each alone.

The [native exterior reference](skills/uefn/references/uefn-native-exterior.md)
records installed material pin discovery, sky collision readback, automatically
derived LevelBounds and a separately identified folder save. It keeps exact
package ownership, source-font dependencies and editor point queries distinct
from current Fortnite cook, navigation and performance acceptance.

## Skills

| Skill | Job |
|---|---|
| `unreal-effects` | Niagara particles, fluids and sand, a template catalog and authoring Niagara from Python; Cascade; Chaos Niagara and destruction, including a Geometry Collection built from C++. |
| `unreal-animation` | Control Rig and IK Rig, Animation Blueprints (slot-only graphs from Python, a C++ bridge for state machines), Motion Matching, cloth, hair, Sequencer and Movie Render Queue. |
| `unreal-gameplay` | Gameplay Ability System, Enhanced Input, AI, navigation, Mover, Chaos vehicles, networking and replication. |
| `unreal-procedural` | World Partition and open worlds, Landscape, Landmass, Water, PCG (editor and running game), Geometry Scripting, Procedural Mesh Component, MetaSounds, Quartz and Audio Modulation. |
| `unreal-rendering` | Lumen, MegaLights, directional lights (a sun and a moon), Virtual Shadow Maps, Nanite, Substrate and Toon, Temporal Super Resolution, and a production stack that combines them. |
| `unreal-editor-scripting` | Editor Python run modes, cameras and whole-map builds; the Python-to-C++ bridge; enabling a plugin; the example scenes. |
| `unreal-native` | Build, run, verify, package and profile a native C++ Unreal game from an agent: the build and capture loop, content pipeline, presentation, input replay, material and UV validation, cooking, frame-time profiling against a budget and side-by-side comparison scenes. |
| `unreal-architecture` | Audit and plan a project's code and project structure against Epic's 5.8 documentation: modules, plugins and dependency direction, where state and rules live, Game Features, hard and soft references, lifecycle and object pointers, targets, configuration and layout, with an ownership map, ranked findings and a remediation plan. |
| `unreal-quality` | Audit and plan a project's testing strategy and performance measurement against Epic's 5.8 documentation: which Automation, CQTest, Spec, Functional or Low-Level test fits which behaviour, deterministic tests, headless runs and lanes, and trustworthy frame-time, memory and shader-hitch measurement, with ranked findings and a remediation plan whose steps each have a check. |
| `unreal-mutable` | Mutable runtime character customization: Customizable Objects, Instances and the actor component, compiling from a script under a timeout, headless versus editor, and what Python cannot author (the graph) with the C++ bridge as the route. |
| `unreal-import` | Import agent-sprites atlases, agent-meshes GLBs and agent-beeps WAVs into an Unreal 5.8 project from a script: Interchange and Paper2D notes, FBX clips and Epic's MCP server, a per-mesh import policy read back from the saved asset, guarded reuse and regenerated projects. The importer scripts are in the skill. |
| `unreal-metahuman` | Create, assemble and drive a MetaHuman from a script: the core data, Epic's cloud and the one-time sign-in, a character from a preset (edit, commit, auto-rig, textures), `build_meta_human` and its retry rule, the spawned Blueprint, and the face moved with control curves, with what was run and what was not. |
| `unreal-umg` | UMG, MVVM and Common UI: Epic's MCP UMG toolset, building and compiling a Widget Blueprint from a script, a widget frame captured offscreen, the Common UI setup pieces and input routing, and UMG cost rules and focus traps, with what was run and what was not. |
| `uefn` | Author and import into UEFN from an agent: Epic's MCP tools and their gaps, native Python and Sequence authoring, WAV and FBX import, saved controls and capture, with the evidence behind each claim. |

## Examples

- [`examples/unreal`](examples/unreal/README.md): a plugin lister (`engine_plugins.mjs`), a Python surface dump (`unreal_surface.py`), a probe level, Niagara authoring and validation scripts, a stage builder for any list of Niagara systems and a headless runner.
- [`examples/unreal/niagara-showcase`](examples/unreal/niagara-showcase/README.md): an explorable arena with eight Niagara stations, a free-fly camera and an automatic tour.
- [`examples/unreal/compare-scene`](examples/unreal/compare-scene/README.md): a project-neutral C++ game mode that sets several implementations of one visible thing side by side, films them and times each alone.
- [`examples/unreal/stylized`](examples/unreal/stylized/README.md), [`world`](examples/unreal/world/README.md), [`pcg_game`](examples/unreal/pcg_game/README.md), [`editor_python`](examples/unreal/editor_python/README.md), [`landscape_bridge`](examples/unreal/landscape_bridge/README.md) and [`automation_test`](examples/unreal/automation_test/README.md): test scenes that check the toon and cel guidance, the World Partition, water and PCG guidance, PCG in a game process, editor Python practices, the C++ bridge and the automation-test recipe on an installed engine; see [example scenes](skills/unreal-editor-scripting/references/unreal-example-scenes.md).
- [`examples/uefn`](examples/uefn/README.md): a GLB-to-FBX converter and a helper-freshness probe.

## Importing assets

Importing GLB, sprite and audio output into Unreal is the `unreal-import` skill, which holds the importer scripts
(`skills/unreal-import/scripts/unreal-import.mjs`), the per-mesh import policy and guarded reuse. Import into Unity, Godot
and the web, and choosing a game engine, are `engine-asset-import` and `engine-selection` in agent-engine.

## Checking the skills

This project is in **dev** mode: local merge checks are the gate. CI (`.github/workflows/lint-skills.yml`) is one
non-required Linux observer on ready pull requests, and also runs weekly, manually and on `v*` release tags.

`node scripts/check.mjs` runs the dependency-free merge checks: the Node tests and the skill lint. Native-engine
acceptance (building, cooking and running Unreal) is separate and needs the documented engine setup.
`scripts/lint-skills.mjs` checks frontmatter, relative links, the "You are about to / Read" table, size budgets,
placeholders and evidence labels. `unreal-native` passes the strict rules, and `uefn`, `unreal-architecture` and `unreal-quality` pass the default rules; the six domain skills and `unreal-import` are checked for
structure and size. `node scripts/check.mjs --skill <name>` (repeatable or comma-separated) lints only those skills with the gate's flags and skips the tests; `--no-tests` runs every lint without the test step. The gate runs every step even after a failure and prints all findings. Every folder under `skills/` is linted, and a new skill with no strictness-table entry in `scripts/check.mjs` gets the default rules and fails until it complies or earns an entry. Structural checks do not
establish that a skill improves an agent's work.

`[tested]` means checked in this repo: a run here, or for the repo's own scripts a node test (the line says so); it is a record of what was seen, not a promise about every build, and nothing obliges a rerun when the engine changes. `[documented]` is Epic documentation or engine source; `[general]` is judgement or an observation not reproduced here.

## Install

```
/plugin marketplace add ehartye/hartye-claude-plugins
/plugin install agent-unreal@hartye-plugins
```

## Requirements

Node 20 or later for the checks and scripts. Unreal Engine 5.8 on Windows for the engine-side work.

## License

MIT
