# Unreal import status

What was verified for importing agent-sprites atlases, agent-meshes GLBs and agent-beeps WAVs into Unreal, and what
was not. The scene and checks are in the [Unreal sample scene](../../../docs/sample-scene.md).

| Engine | Verified | Not verified |
|---|---|---|
| Unreal 5.7.3 | Import of fox, courier, campfire and audio; a clean Play-In-Editor run; a screenshot read by eye; music bed reports playing | Audio by ear, pickup variant picking, any automated pixel check |
| Unreal 5.8.3 | The same scene after three fixes: import, a clean rendered run, fox animating, music bed reporting playing, a screenshot read by eye; Epic's MCP server started headless, imported textures and an FBX, spawned an actor and returned a screenshot | Audio by ear, pickup variant picking, an automated pixel check, MCP audio or GLB import (none exists) |
| UEFN 42.20 / 42.30 | MCP imports and saved clips; gallery captures; native Python/Sequence authoring; scoped actor saves; Fortnite startup on 12 timelines and 156 controller-method results, including reset and held-frame resume | Physical button use, rendered reset poses, completed-clip reset, audio playback, multiplayer and memory/performance budget |

Import into Unity, Godot and the web is in `engine-asset-import` (agent-engine), which has the status table for those engines.
