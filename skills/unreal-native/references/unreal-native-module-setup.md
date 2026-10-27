# Native C++ module setup and first-compile pitfalls

Observed in one consuming project on an earlier engine build; not reproduced in this repo. Engine source inspection and executed behaviour are labelled separately. The compiler pin, build command and capture loop that follow this setup are in the [native game loop](unreal-native-game.md).

## Plugins, modules and procedural geometry

- [general] An initial C++ Runtime module loaded in `UnrealEditor.exe -game`, built procedural vehicles and a long track, simulated a Chaos chassis and saved game-camera PNGs using ProceduralMeshComponent.
- [general] Explicit project plugins were `ProceduralMeshComponent`, `PythonScriptPlugin` and `EditorScriptingUtilities`. Runtime used Core, CoreUObject, Engine, InputCore, ProceduralMeshComponent and PhysicsCore, plus JSON/UI modules the game needed. Editor-only material graph creation stayed in Python.
- [documented] Installed-source inspection, not runtime proof: ProceduralMeshComponent is a Runtime module in the installed engine source. It does not automatically provide a skeletal rig, Nanite or authored LODs. Use a few simple collision bodies, not collision on decorative trim. Bake accepted repeated geometry into static meshes when instancing/LODs are needed.
- [general] The first native compile caught an ambiguous conditional between `Parent->Mobility` (`TEnumAsByte`) and `EComponentMobility::Movable`. `Parent->GetMobility()` supplies the exact enum. A test source in a nested module folder could not include the parent's header through a legacy implicit include path; its explicit relative include fixed compilation. Do not widen global include paths to hide a local ownership mistake.
