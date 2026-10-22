# Native material cook and UV validation

Observed in one consuming Unreal 5.8.2 CL56702186 project on Windows; not reproduced in this repo. Preserve failed native logs alongside successful receipts; saved graph assets and process exit codes alone do not establish usable runtime shaders.

## A zero-exit cook can substitute DefaultMaterial

- [general] A cook log reported `Failed to compile Material /Game/Art/M_Example` and default-material substitution, although the Cook process exited 0. Its HLSL Custom expression declared `float triangle`, a reserved HLSL keyword. The staged package was rejected for visual acceptance. Renaming the variable requires a fresh cook and native visual check.
- [general] Keep a source-owned complete required-material list. Reject compilation failure or invalid ShaderMap warnings for those exact owned paths/hierarchies. Bind validation to the actual cook process's project and `-abslog`, retain the log hash, and verify list completeness on reuse. An unrelated clean log or a receipt list omitting the failed material cannot certify the cook. Check the final game render separately.

## Imported UV channels need an explicit contract

- [general] Blender-exported GLBs carried both `TEXCOORD_0` and `TEXCOORD_1`. Channel 0 was the primitive UV map; channel 1 was an authored physical-repeat map. Reading channel 0 made surface wear differ from the intended physical scale. A full Editor import reported two native UV channels for each mesh through `StaticMeshEditorSubsystem.get_num_uv_channels(mesh,0)`.
- [documented] Installed `GLTFMeshFactory.cpp:642–650` preserves UV index. `StaticMeshEditorSubsystem.h:500` exposes the UV-channel count as BlueprintCallable. Inspect actual exported accessors and imported counts; do not infer their meaning merely from a nonempty UV array. If the authored convention is a fixed number of UV units per metre, the material should read coordinate index 1 and scale accordingly; such numbers are asset-specific.

See [content-only construction](unreal-native-content-pipeline.md) and [native presentation](unreal-native-presentation.md). These observations are consuming-project evidence; they do not establish published plugin capability or final art fidelity.
