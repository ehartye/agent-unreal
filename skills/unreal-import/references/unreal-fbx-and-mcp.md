# FBX clips and Epic's MCP server (Unreal 5.8.3 and UEFN)

## FBX into Unreal and UEFN: clips need frame-aligned lengths (tested)

Tested on Unreal 5.8.3 and UEFN 42.20. A mesh import tool that only takes FBX (see the next section) means a GLB
has to be converted first, and the clips can vanish in the conversion.

- Symptom: the mesh, skeleton and materials import, no AnimSequence appears with `import_animations` true, and the
  tool reports success. The only trace is an error in the editor log: "Animation length 0.8 is not compatible with
  import frame-rate 24 fps ... frame-border aligned if the 'Snap to Closest Frame Boundary' pipeline option is
  disabled". The FBX does contain the clips; check its animation stacks before blaming the file.
- Fix at the source (works through the MCP tool): export at a rate where each clip is a whole number of frames.
  The fox's 0.8 s and 1.2 s clips are exact at 30 fps and not at 24. In Blender set `scene.render.fps = 30`
  **before** the glTF import: the importer turns seconds into frames at the current rate, and changing it afterwards
  keeps the old frame numbers and shrinks every clip (0.8 s became 0.64 s). `examples/uefn/glb_to_fbx.py` does this.
  After it, the default import and Epic's MCP `import_file` both produced the mesh, skeleton and two clips.
- Fix in the engine (needs a pipeline asset, so not available through the MCP tool): set the animation pipeline's
  `frame_alignment` to `SNAP_TO_FLOOR`, `SNAP_TO_CLOSEST` or `SNAP_TO_CEILING`; all three imported both clips.
- Clip names differ by route: Interchange from the GLB gave `foxwalk`; the MCP tool from the FBX gave
  `Fox_Anim_Ember_fox_walk`. List the clips after import and look them up by suffix.
- Blender from the Microsoft Store cannot be run from its folder under `WindowsApps` (access denied). Run
  `%LOCALAPPDATA%\Microsoft\WindowsApps\blender-launcher.exe` as an interactive task in an interactive user session; it
  swallows Blender's console output, so check that the output file was rewritten. A leftover Blender process stalls
  the next launch.

## Epic's MCP server on Unreal 5.8.3 and UEFN (tested)

Epic's `ModelContextProtocol` plugin (Experimental, off by default) ships with 5.8 and is the same plugin family UEFN
uses. Tested 2026-10-01; details and sources are in the project wiki.

- Enable `ModelContextProtocol`, `ToolsetRegistry`, `EditorToolset` and `AllToolsets` in the `.uproject`. Launch with
  `-RenderOffScreen -unattended -ModelContextProtocolStartServer -ModelContextProtocolPort=<port>`; the server
  answered about 30 seconds later with no click. The default port is 8000, which may be taken. In UEFN the port is
  the `ServerPortNumber` setting, command-line arguments are discarded, and the server must be started by hand after
  each launch.
- Only `list_toolsets`, `describe_toolset` and `call_tool` are listed; the toolsets are reached through `call_tool`
  with a toolset name and a tool name.
- It did: import textures; import FBX and OBJ meshes; spawn an actor from an asset; capture the viewport as a PNG
  (inspect the response: UEFN returned a separate image content block and a JSON URN, not JSON image bytes;
  pass an explicit camera pose, because `FocusOnActors` can park the camera
  kilometres away). It did not: import audio (no tool in either toolset list), accept a GLB ("FbxFactory does not
  support .glb. Allowed: fbx, obj."), or run Python with the `unreal` module (the script tool allows only `json`,
  `re`, `math`, `copy`, `time`, `datetime`).
- Argument shapes differ from UEFN's on 5.8.3: `find_assets` needs `name` (empty string for all),
  `add_to_scene_from_asset` needs an `xform`, and `CaptureViewport` needs both `captureTransform` and `annotations`.
- Pair it with the headless Python route above for GLB and audio. Epic's 20 built-in agent skills are domain guidance
  (PCG, Niagara, editor, Dataflow); none covers import.
