---
name: uefn
description: "Author and import into UEFN (Unreal Editor for Fortnite) from an agent: Epic's MCP tools and their gaps, native Python and Sequence authoring, WAV and FBX import, device controls on a Fortnite island, and editor capture. Not for importing into Unreal (use unreal-import) or other engines (use engine-asset-import from agent-engine)."
when_to_use: "Use when working in UEFN or on a Fortnite island: missing MCP tools, native Python or Sequencer authoring, resetting an Animated Mesh device to its first frame, importing rendered WAVs, an imported building that is mirrored, has reversed lettering or no collision, material pin failures or sky collision after property edits, collision that follows an animated prop's bones, device buttons and switches driven from Python or wired to Verse references, editor screenshots that stall, or edited native Python helpers that still produce old values in a running editor."
---

# UEFN

UEFN 42.20 and 42.30, partly tested. Say which statements were run and which were read in documentation.
Other engines' imports are in `engine-asset-import` (agent-engine); the FBX frame-rate
fix and Epic's MCP server are in FBX clips and MCP (`unreal-import` skill).

| You are about to | Read |
|---|---|
| Find missing MCP tools, choose a route, or decide whether to author in regular UE | [UEFN authoring beyond MCP](references/uefn-authoring.md) |
| Run Python in the editor: startup scripts, remote execution, launch with a project | [Native Python](references/uefn-native-python.md) |
| Set an exact Reset, make a Level Sequence or migrate assets from UE | [Animation and migration](references/uefn-animation.md) |
| Import rendered WAVs (SoundFactory, guarded source and destination checks, looping Wave Players, scoped saves) | [Native UEFN audio import](references/uefn-native-audio.md) |
| Choose a native operation and its proof, wire typed Verse references or run runtime QA | [Native operations](references/uefn-native-operations.md) |
| Set named rotation axes, check a switch's front and up, or compact a Button's visible mesh | [Native Button switches](references/uefn-native-switches.md) |
| Save actors in scope, or a new ActorFolder, without Save All | [Scoped saves](references/uefn-native-saves.md) |
| Delete disposable proof assets after reconciling them | [Proof asset cleanup](references/uefn-native-cleanup.md) |
| Take editor screenshots when viewport capture stalls, or capture the Fortnite client window | [Editor and client capture](references/uefn-native-capture.md) |
| Fix edited Python helpers that still produce old values in a running editor | [Python helper freshness](references/uefn-python-helper-freshness.md) |
| Diagnose native material pin failures, sky collision after property edits or LevelBounds changes | [Exterior materials](references/uefn-native-exterior.md) |
| Fit prop cover that follows bones | [Moving prop cover](references/uefn-native-cover.md) |
| Check fitted cover: semantic collision, variant state, hidden comparison blockers, misplaced proxies after animation edits | [Cover verification](references/uefn-native-cover-verification.md) |
| Fix mirrored native FBX architecture, reversed glyphs or missing UCX and deck collision | [UEFN FBX coordinates and collision](references/uefn-native-fbx.md) |

## What was tested

- Tested through the MCP server in a real project: textures import; the fox imports as a skeletal mesh with a
  skeleton and 48 materials from the converted FBX. The 30 fps fix was re-run: both clips were saved and verified
  through registry duration/frame counts. An Animated Mesh device renders it in the editor; runtime is unverified.
- Audio: no MCP import tool in the tested configuration. Auto Reimport created nothing from dropped WAVs across
  two 42.20 restarts. Native Python imported and saved five Wave/Cue pairs in 42.30; use the audio reference above.
  Content Browser Import remains a fallback. Audible playback and a full UEFN sample-scene pass remain unverified.
- Documented versus tested: Epic's pages say GLB and glTF import in the editor; the MCP mesh tool accepts only FBX
  and OBJ. Say which one you mean.
