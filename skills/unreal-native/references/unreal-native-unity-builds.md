# Unity builds and file-scope names in a native Unreal module

Target: Unreal Engine 5.8.2, Windows, Visual Studio 2022 Build Tools. Evidence comes from `examples/unreal/unity_build/` (`node unity_build.mjs --engine <UE_5.8 folder>`), which builds a three-file module with Unreal Build Tool under each grouping below. Source paths are under `Engine/Source/Programs/UnrealBuildTool/`.

## When to use it

- [general] Use it when a native build fails with C2374, C2086, C4459 or C2872 in a file the change did not touch, when a build passes on one commit and fails on the next, or before adding a `.cpp` file with file-scope names to a game module.
- [general] Not for other compile errors ([native build and capture](unreal-native-game.md)) or for choosing what a build should contain ([content-only pipeline](unreal-native-content-pipeline.md)).

## What unity does

- [documented] Unreal Build Tool merges a module's `.cpp` files into `Module.<Name>.cpp` (numbered when there are several), each a list of `#include` lines, and compiles each as one translation unit. Files are sorted by case-insensitive path with the generated `.gen.cpp` files first (`System/Unity.cs` lines 227 to 257). Anonymous-namespace names, using-directives and enum names are shared by every file in one unity file.
- [documented] A chunk closes once its running size passes `NumIncludedBytesPerUnityCPP`, default 384 KiB (`Configuration/Rules/TargetRules.cs` line 2028; module override `NumIncludedBytesPerUnityCPPOverride`, `ModuleRules.cs` line 1099); a file larger than that gets its own chunk (`Unity.cs` lines 118 to 127, 245 to 254). When the whole module is under twice that size and precompiled headers are on, every file goes into one chunk (`Unity.cs` line 219). A typical game module is therefore one chunk, and boundaries appear only in big modules, where adding, renaming or growing a file moves them.
- [documented] A game module with fewer than `MinGameModuleSourceFilesForUnityBuild` (32) source files is not built as unity (`TargetRules.cs` line 1936, `UEBuildModuleCPP.cs` lines 945 and 973). `MinSourceFilesForUnityBuildOverride` in the module rules changes the threshold for that module.
- [tested] `unity_build.mjs`, phase `small`: the three-file module compiled each file on its own. With `MinSourceFilesForUnityBuildOverride = 1` the three files shared one `Module.UnityProbe.cpp`, listed in order `ProbeAlpha.cpp`, `ProbeBeta.cpp`, `UnityProbeModule.cpp`.

## Adaptive unity decides the grouping

- [documented] Adaptive unity is on by default (`TargetRules.cs` lines 1875 to 1877, off with `-DisableAdaptiveUnity`). Files in the working set, and files whose first include is a working-set header, are left out of the chunks and compiled alone (`Unity.cs` lines 268 to 282, 399 to 410); the rest keep their chunks.
- [documented] The working set is `git status --porcelain` when the project folder or its parent holds a `.git` (`System/SourceFileWorkingSet.cs` lines 120 and 388 to 394). Without git, an installed engine uses every writable file (lines 80 and 408).
- [documented] The makefile is rebuilt when a file joins the working set, or leaves it and has a timestamp newer than the makefile (`System/TargetMakefile.cs` lines 1130 to 1148). A file that leaves it with an old timestamp stays excluded until something rebuilds the makefile.
- [tested] Phases `git-clean`, `git-dirty`, `git-committed`, `git-rewritten` in a git project with the same sources: clean tree failed; after editing `ProbeBeta.cpp` the log read `[Adaptive Build] Excluded from UnityProbe unity file: ProbeBeta.cpp` and the build passed; after the commit the build reported `Target is up to date`; after the committed file was written again it failed again.
- [tested] Phase `adaptive` (no git, unity on): all three writable files were excluded and the clashing sources built. A pass therefore proves only that the current grouping compiled.
- [general] Before trusting a pass, build with `-DisableAdaptiveUnity` (or from a clean checkout, as CI does), so every file takes its place in a chunk.
- [documented] The grouping depends on the module's file list, file sizes and the working set; a search of the unity and module code in `Engine/Source/Programs/UnrealBuildTool` found no processor-count or memory input to it. Two machines group differently when their working sets or checkouts differ, so a clash can fail on one machine and pass on another.
- [general] Observed once on 5.8.x: three clashes in new `.cpp` files (a test class and a struct of one name in two files of one chunk, two files' file-local names, a file-local colour that met a template parameter in another file) failed on a larger machine's build and passed on a smaller one. A pass on one machine proves only that its grouping compiled; build the other machine's tree, or use `-DisableAdaptiveUnity`, before calling a change done. That the chunking follows build parallelism is an unconfirmed guess, and the source search above found no sign of it.

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
- [tested] Two scratch runs of the same module, outside `unity_build.mjs`: `-ForceUnity` (with `-DisableAdaptiveUnity`) did not group the files, each compiled alone, so set the threshold in the module rules instead; with the files marked read-only (the Perforce route) they were still excluded, so that route is unconfirmed.

## Chain the next step on the build

- [tested] After the failed build the module binary's timestamp was unchanged, so a replay or test run started anyway would load the previous build and report on old code.
- [general] Gate every follow-on step on the build's exit code, not on a line the script prints. In PowerShell: `if ($LASTEXITCODE -ne 0) { throw 'Native compile failed' }` before the run, as in the build snippet in [native build and capture](unreal-native-game.md).
- [tested] From Node, `runIfBuilt(build, step, { label })` in `examples/unreal/native-build.mjs` runs the step only after a build with exit 0 and no timeout, and otherwise logs `<label> skipped: build failed (exit 6); the previous binary is still on disk and was not tested`.
