# Unity build fixes: file-scope names, error codes and build gating in a native Unreal module

Target and evidence as in [Unity builds](unreal-native-unity-builds.md): `examples/unreal/unity_build/` (`node unity_build.mjs --engine <UE_5.8 folder>`) builds a three-file module with Unreal Build Tool under each grouping below.

## Rules for file-scope names

- [general] Give every file-scope name (anonymous-namespace constants and helpers, `static` functions) a prefix that names its file, such as `AlphaBurstCount`, not `BurstCount`.
- [general] Do not write `using namespace` in a `.cpp`; qualify the names. In a unity file the directive stays in force for every file merged after it.
- [general] Keep enum names unique across the headers a module includes together, or qualify each use. Two namespaces that each declare `EState` are ambiguous once a using-directive for each is in one unit.
- [tested] The fixed sources (`variants/fixed`: `AlphaBurstCount` and `BetaBurstCount`, no using-directives, `UnityProbeAlphaStates::EState`) passed with all three files in one unity file.

## Error codes that signal it

- [tested] Two anonymous-namespace constants of one name: `error C2374: '`anonymous-namespace'::BurstCount': redefinition; multiple initialization` and `error C2086 ... redefinition`, reported in the second file with a `see declaration` note in the first.
- [tested] A local variable named like a member of a namespace that an earlier file opened with `using namespace`: `error C4459: declaration of 'MaxCount' hides global declaration`. It is an error because `BuildSettingsVersion.V2` and later make shadow warnings errors (`Configuration/Rules/CppCompileWarnings.cs` lines 88 to 93); the examples pin V7.
- [tested] Two enums of one name in different namespaces, both opened with `using namespace`: `error C2872: 'EState': ambiguous symbol`, then follow-on `C2838` and `C2065` on the enumerators.
- [general] The signature is the same everywhere: the reported line compiles alone, and the note names a declaration in another file.

## Avoid or reproduce the grouping

- [tested] `bUseUnity = false;` in the module rules: the clashing sources built (phase `off`). Cost: slower full builds of that module.
- [tested] `NumIncludedBytesPerUnityCPPOverride = 1;` gave one chunk per source file and the clashing sources built (phase `chunks`); use it only to reproduce a regrouping.
- [tested] `-DisableAdaptiveUnity` on the build command with `MinSourceFilesForUnityBuildOverride = 1;` reproduced all four codes in a project with no git repository (phase `clash`). `unity_build.mjs` passes it through `buildEditor({ extraArgs })`.
- [tested] A scratch run of the same module, outside `unity_build.mjs`: `-ForceUnity` (with `-DisableAdaptiveUnity`) did not group the files, each compiled alone, so set the threshold in the module rules instead.
- [tested] Read-only files as the working set, with no git repository (`node unity_build.mjs --only-readonly`): with every file read-only, the shared header included, nothing is excluded and the clash reproduces (exit 6, all four codes above plus `C2838` and `C2065`). A read-only file whose first include is a writable header is still excluded, so make the header read-only too. This replaces the earlier scratch result that read-only files were excluded; details in [Unity builds](unreal-native-unity-builds.md).

## Chain the next step on the build

- [tested] After the failed build the module binary's timestamp was unchanged, so a replay or test run started anyway would load the previous build and report on old code.
- [general] Gate every follow-on step on the build's exit code, not on a line the script prints. In PowerShell: `if ($LASTEXITCODE -ne 0) { throw 'Native compile failed' }` before the run, as in the build snippet in [native build and capture](unreal-native-game.md).
- [tested] From Node, `runIfBuilt(build, step, { label })` in `examples/unreal/native-build.mjs` runs the step only after a build with exit 0 and no timeout, and otherwise logs `<label> skipped: build failed (exit 6); the previous binary is still on disk and was not tested`.
