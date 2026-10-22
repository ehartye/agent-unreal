# agent-unreal

A Claude Code plugin of skills for working in Unreal Engine 5.8 from a coding agent. It picks the engine system that
fits a goal and says how an agent drives it (Python, Blueprint, C++, console variables or project settings), builds,
packages and profiles a native C++ game, and authors for UEFN. It pairs with
[agent-engine](https://github.com/ehartye/agent-engine), which imports [agent-meshes](https://github.com/ehartye/agent-meshes)
models, [agent-sprites](https://github.com/ehartye/agent-sprites) atlases and
[agent-beeps](https://github.com/ehartye/agent-beeps) sounds into Unreal and keeps the importer scripts.

The references cover the current 5.8 systems. A legacy system gets one line saying what superseded it and its Epic
status. Claims are backed by Epic documentation or by the engine install itself, and a statement that was run in this
repository is marked as tested.

## Status

Early (0.1.1). Three skills.

The skills moved here from agent-engine 0.14.0, where their history up to that tag lives. The scripts in `examples/`
were run on Windows against Unreal 5.7.3, 5.8.2 and 5.8.3 as each README states; other platforms were not run.

## Verification status

Epic's MCP plugin was tried on Unreal 5.8.3 and UEFN 42.20: it drives the editor and returns screenshots, but has no
audio import and rejects GLB.

One consuming UEFN 42.30 project additionally reported native Python authoring,
scoped actor saves, editor captures, automatic timeline playback and server controller-method
results, and native Python imports of Wave/Cue pairs with per-player playback settings (observed there, not
reproduced in this repo). A launch reached server cook but ended without a connected
game client. Physical button use, rendered reset poses, audible audio, multiplayer and performance remain open;
this does not establish a complete UEFN sample-scene pass.

The UEFN references cover [authoring routes](skills/uefn/references/uefn-authoring.md)
and [saved controls and capture](skills/uefn/references/uefn-native-operations.md),
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
records a separate 5.8.2 C++ build and actual offscreen game-camera loop, with fresh automation JSON checks
because failed tests can exit zero. Its [presentation companion](skills/unreal-native/references/unreal-native-presentation.md)
covers the measured font/Slate commandlet crash, crisp Canvas glyph sizing, physical camera exposure and HDR palette traps.
The [Windows packaging reference](skills/unreal-native/references/unreal-native-packaging.md)
records an actual staged Game EXE separately from Editor-game evidence, including the UAT Application Control failure.
The [content pipeline](skills/unreal-native/references/unreal-native-content-pipeline.md)
records the tested content-only bake/native Game split, short-path cook fix and recipe/hash validation.
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
| `unreal-features` | Choose which Unreal 5.8 system fits a goal: rendering (Lumen, Nanite, Virtual Shadow Maps, MegaLights, Substrate, TSR), gameplay (Gameplay Ability System, Enhanced Input, AI, navigation, animation, Motion Matching), Sequencer, Movie Render Queue, networking, Niagara, Chaos, Mover, Control Rig, PCG, Water, Geometry Scripting, MetaSounds and the legacy Cascade. A selector table maps a goal to the reference; Niagara, a template catalog, editor Python and the production stack sit beside the system references. |
| `unreal-native` | Build, run, verify, package and profile a native C++ Unreal game from an agent: the build and capture loop, content pipeline, presentation, input replay, material and UV validation, cooking, frame-time profiling against a budget and side-by-side comparison scenes. |
| `uefn` | Author and import into UEFN from an agent: Epic's MCP tools and their gaps, native Python and Sequence authoring, WAV and FBX import, saved controls and capture, with the evidence behind each claim. |

## Examples

- [`examples/unreal`](examples/unreal/README.md): a plugin lister (`engine_plugins.mjs`), a Python surface dump (`unreal_surface.py`), a probe level, Niagara authoring and validation scripts, a stage builder for any list of Niagara systems and a headless runner.
- [`examples/unreal/niagara-showcase`](examples/unreal/niagara-showcase/README.md): an explorable arena with eight Niagara stations, a free-fly camera and an automatic tour.
- [`examples/unreal/compare-scene`](examples/unreal/compare-scene/README.md): a project-neutral C++ game mode that sets several implementations of one visible thing side by side, films them and times each alone.
- [`examples/uefn`](examples/uefn/README.md): a GLB-to-FBX converter and a helper-freshness probe.

## Importing assets

Importing GLB, sprite and audio output into Unreal is the `engine-asset-import` skill in agent-engine, which also holds
the importer scripts, the per-mesh import policy and guarded reuse. Choosing a game engine is `engine-selection` in
agent-engine.

## Checking the skills

This project is in **dev** mode: local merge checks are the gate. CI (`.github/workflows/lint-skills.yml`) is one
non-required Linux observer on ready pull requests, and also runs weekly, manually and on `v*` release tags.

`node scripts/check.mjs` runs the dependency-free merge checks: the Node tests and the skill lint. Native-engine
acceptance (building, cooking and running Unreal) is separate and needs the documented engine setup.
`scripts/lint-skills.mjs` checks frontmatter, relative links, the "You are about to / Read" table, size budgets,
placeholders and evidence labels. `unreal-native` passes the strict rules; `unreal-features` is checked for structure
and size, and four `uefn` references are over the size budget and held at their current size. Structural checks do not
establish that a skill improves an agent's work.

## Install

```
/plugin marketplace add ehartye/hartye-claude-plugins
/plugin install agent-unreal@hartye-plugins
```

## Requirements

Node 20 or later for the checks and scripts. Unreal Engine 5.8 on Windows for the engine-side work.

## License

MIT
