---
name: unreal-import
description: "Import agent-sprites atlases, agent-meshes GLB models and agent-beeps WAV exports into an Unreal Engine 5.7 or 5.8 project from a script, with a guarded importer. Not for UEFN (use uefn), choosing an Unreal system (the unreal-* domain skills), a native C++ game's build or packaging (use unreal-native) or other engines (engine-asset-import in agent-engine)."
when_to_use: "Use when bringing a sprite atlas, GLB, WAV or song export into an Unreal project by script or through Epic's MCP server; when an imported model is missing bones, morphs, meshes or animation clips, or its clips have different names; when an Unreal import splits one model into many meshes, leaves nothing on disk or needs a per-mesh policy (Nanite, vertex colour, UV, material, rename, collision) stated and read back from the saved asset; when reusing a saved import, or adopting the importer in a project that is regenerated each run; or when asked whether an asset 'works in' Unreal."
---

# Importing plugin assets into Unreal

The asset plugins export plain files. Unreal imports them through Interchange, Paper2D and `AssetTools`, and a failed
import is often quiet. This skill holds the importer and records what is known about it, with a strict line between
what was run and what was only read in documentation.

## Before you claim anything

- Say what you checked: "imports into UE 5.7 via Interchange with names intact", not "works in Unreal". Sections
  marked "tested" were run in the [sample scene](../../docs/sample-scene.md); the rest is documentation.
- Check what the engine reports, not only the cause the tool states. A failure message can blame the wrong thing
  (a wrong expected bone name was reported as a skin problem).
- A validator or `mesh verify-unreal` proves the import only. Rendering, collision and gameplay are separate checks.

## What to read

| You are about to | Read |
|---|---|
| Import into Unreal 5.7 or 5.8 by script (Interchange, Paper2D, saving, run modes), or fix a GLB that splits into one mesh per skin or leaves nothing on disk | [Unreal import notes](references/unreal-import-notes.md) |
| Check a GLB's bones, morphs, meshes and clip names after import | [GLB meshes in Unreal](references/unreal-glb-import.md) |
| Convert a GLB to FBX for a tool that takes only FBX, or drive Epic's MCP server | [FBX clips and MCP](references/unreal-fbx-and-mcp.md) |
| Write down a repeatable per-mesh import policy (Nanite, vertex colour, UV, material, rename, collision) and read it back from the saved asset | [Import policy and read-back](references/unreal-import-policy.md) |
| Reuse a saved-project GLB import while protecting generated assets and owner edits | [Guarded import reuse](references/unreal-import-reuse.md) |
| Adopt the importer in a project that is regenerated each run or that also writes its own folders | [Regenerated projects](references/unreal-import-regenerated-projects.md) |
| See what is verified and not verified for Unreal and UEFN | [Unreal import status](references/unreal-import-status.md) |

The importer scripts are in `scripts/` beside this file (`unreal-import.mjs`, `unreal_import_native.py`); the policy
and reuse references document their options.

## Neighbouring skills

- Whether a mesh is authored in Blender or generated in Unreal, and the `mesh verify-unreal` scratch-project check:
  `mesh-tool-selection` and `mesh-build` in agent-meshes.
- Import into Unity, Godot or the web, and sprite and audio import in general: `engine-asset-import` in agent-engine.
- Nanite and the other engine systems an imported asset meets: `unreal-rendering`, `unreal-procedural` (Geometry Scripting) and the other domain skills.
- UEFN's own routes: `uefn`. Native C++ games: `unreal-native`.

## After importing

Import, then check, then report. If Epic's MCP server is connected, use it to list the imported assets and read the
engine log; if it is not, say which checks you could not run.
