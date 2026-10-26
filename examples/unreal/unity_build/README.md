# Unity builds: names that clash only when files share a chunk

Backs [Unity builds and file-scope names](../../../skills/unreal-native/references/unreal-native-unity-builds.md) and [its fixes](../../../skills/unreal-native/references/unreal-native-unity-build-fixes.md). Unreal Engine 5.8.4, Windows, Visual Studio 2022 Build Tools.

The question: which source changes decide whether two files share a translation unit, and what does the build say when they do? The run answers it with a three-file runtime module whose files build alone and fail together.

## Files

- `module/UnityProbe/` is a runtime module. `ProbeAlpha.cpp` and `ProbeBeta.cpp` clash only when merged: an anonymous-namespace constant of the same name in both (`C2374`, `C2086`); a `using namespace UnityProbeLimits;` in the first that makes a local variable in the second hide a namespace member (`C4459`); two enums named `EState` in different namespaces, each opened with `using namespace` (`C2872`). `UnityProbe.Build.cs` sets `MinSourceFilesForUnityBuildOverride = 1`, because a game module under 32 source files is not built as unity.
- `variants/fixed/` holds the same two files with file-prefixed constants, no using-directives and qualified enums.
- `unity_build.mjs` is the runner. It writes two throwaway code projects in the OS temp folder (`../native-build.mjs`), builds the Editor target 10 times and, after each build, runs a stand-in for a replay through `runIfBuilt`, which skips it after a failed build and says so. Project one has no git repository: small module, unity on with adaptive unity left on, adaptive unity off (the clash), unity off, the fixed sources, a chunk size below every file. Project two is a git repository: clean tree, one file edited, the edit committed, the committed file written again.
- `unity-build-checks.mjs` judges the logs, the generated `Module.UnityProbe*.cpp` files and the binary timestamps; `unity-build.test.mjs` tests that logic with no Unreal (it runs in `node scripts/check.mjs`).

## Run

```text
node examples/unreal/unity_build/unity_build.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
```

About six minutes: the first build of each project takes about a minute, the rest 1 to 15 s. Needs `git` on the path for project two. Unreal Build Tool and the compiler start hidden.

## Opt-in: the read-only working set

**Status:** Prepared and first run 2026-10-26 on Unreal 5.8.2: `unity_build.mjs --only-readonly` passed 4 of 4 checks in 62 s with no change to the probe. Rerun on 5.8.4 with the same result (4 of 4, and the full run 11 of 11). The default run above is unchanged.

```text
node examples/unreal/unity_build/unity_build.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --only-readonly [--keep]
```

`--readonly` adds the group to the default run (15 checks); `--only-readonly` runs just the group (4 checks, about four minutes: one first build and two short ones).

The question is the Perforce case: a workspace syncs files read-only, and an installed engine without git then treats a file as part of the working set only when it is not read-only (`Engine/Source/Programs/UnrealBuildTool/System/SourceFileWorkingSet.cs`, `PerforceSourceFileWorkingSet.Contains` and `TryCreatePerforceWorkingSet`). The group makes a third throwaway project with no git repository and builds it three times without `-DisableAdaptiveUnity`, rewriting the sources and rules before each build so that their timestamps are newer than the makefile (`System/TargetMakefile.cs`, the working set check):

| Phase | Read-only | Writable | Predicted from the source |
|---|---|---|---|
| `ro-all` | the three sources, the header, the rules | nothing | nothing excluded, one unity file, the four clash codes |
| `ro-beta` | the other two sources, the header, the rules | `ProbeBeta.cpp` | only `ProbeBeta.cpp` excluded, the build passes |
| `ro-header` | the three sources, the rules | `UnityProbeTypes.h` | `ProbeAlpha.cpp` and `ProbeBeta.cpp` excluded because `System/Unity.cs` (`GetAdaptiveFiles`) leaves out a source whose first include is a same-named working-set header; `UnityProbeModule.cpp` stays in; the build passes |

The `--only-readonly` run on 5.8.4 observed all three rows as predicted, so the first-include effect is an observation: with only the header writable, both sources that include it first were excluded although read-only. It may explain why an earlier scratch run that made only the sources read-only still saw them excluded (the header stayed writable; what that run changed was not recorded). The checks in `unity-build-checks.mjs` (`evaluateReadOnly`) state each prediction, and a failed check means the prediction was wrong. Node sets and clears the read-only attribute with `chmodSync`; the run clears it again before deleting the folders.

## What it checks (11 checks)

- With three files and the default rules, each file compiles alone. With the threshold lowered and adaptive unity on, an installed engine and no git repository exclude all three writable files from the unity file, so the clashing sources still build.
- With `-DisableAdaptiveUnity` the three files share `Module.UnityProbe.cpp` and the build fails with `C2374`, `C2086`, `C4459` and `C2872`, all reported in `ProbeBeta.cpp`. The module binary is unchanged by the failed build and the follow-on step is skipped.
- `bUseUnity = false` builds the same sources; so do the fixed sources in one unity file; so does `NumIncludedBytesPerUnityCPPOverride = 1`, which gives one unity file per source.
- In the git project the clean tree fails with the same codes; after `ProbeBeta.cpp` is edited the log reads `[Adaptive Build] Excluded from UnityProbe unity file: ProbeBeta.cpp` and the build passes; after the commit the build reports `Target is up to date`; after the committed file is written again (as a checkout or rebase does) the makefile is rebuilt and the clash returns.

## Not verified

A real Perforce workspace with read-only files (the no-git read-only case ran on 5.8.4: nothing is excluded and the build fails), `-ForceUnity` (it did not group the files in a scratch run), a module of 32 or more files in more than one chunk, and a Linux or macOS toolchain.
