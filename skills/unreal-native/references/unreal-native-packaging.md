# Native Windows packaging without a UAT project-discovery assembly

Observed in one consuming Unreal 5.8.2 CL56702186 project on Windows; not reproduced in this repo. Engine source inspection and executed behaviour are labelled separately. This complements the [native game loop](unreal-native-game.md). A real packaged executable was run; no final-game or visual-parity claim follows.

## The exact UAT failure

- [general] Installed `RunUAT.bat BuildCookRun -noP4` parsed the project, compiler and staging arguments, then failed **before build/cook** with `System.IO.FileLoadException`, **0x800711C7**: Windows Application Control blocked its dynamically generated `Temp/UAT/.../Rules/UATRules-*.dll`. A subsequently rebuilt Editor module was also denied loading under the same policy family (GetLastError 4551). This is a host trust boundary, not a C++ syntax failure.
- [documented] Installed `AutomationUtils/ProjectUtils.cs` chooses Temp/UAT for installed-engine target discovery and dynamically compiles/loads target scripts. Supplying a client target does not skip the initial project-detection call. Repeatedly changing the blocked file's name/location is not a packaging solution.
- [general] No security policy was changed or disabled; the blocked DLL was not moved/reloaded to evade the decision. The successful alternative used separate supported native engine tools and never loaded that UAT-generated assembly.

Preserve the first failure log, HRESULT, source identity and failed receipt even when another route succeeds. Do not report UAT as successful because a manual native stage later runs.

For the later Editor-module rejection, the [content-only pipeline](unreal-native-content-pipeline.md) records the asset-bake/Game-EXE split, unchanged retry failure, short-path cook fix and packaged captures.

## Freeze the source before independent packaging

- [general] `git archive` of the exact commit went into a new directory while another worktree evolved. No uncommitted source was copied into that proof. A `.source-snapshot.json` stored the commit, archive SHA-256 and initial source fingerprint; subsequent build/capture receipts labelled provenance `git-archive`, dirty=false. Native outputs did not change that source fingerprint.
- [general] Native `Build.bat MyGame Win64 Development` compiled/linked the real Game EXE in under a minute; the snapshot Editor target took about the same. These were ordinary supported UBT builds and independently passed the host's policy. Do not assume another newly built executable or DLL will also be allowed without actually running it.

Record HEAD, dirty state and source fingerprint for active worktrees. An archive that is later edited must become dirty in its receipt. Generated material packages and source-font licenses must belong to that same snapshot or have separately recorded provenance.

## Direct native cook

- [general] Direct `UnrealEditor-Cmd -run=Cook -TargetPlatform=Windows -CookAll -SkipZenStore -unversioned -unattended -nullrhi` completed with exit 0 and no cook errors, in seconds of wall time after a warm cache. `SkipZenStore` selected ordinary cooked files suitable for explicit staging. No cook server or custom background service was needed.
- [general] Adding the optional `-SkipEditorContent` optimization caused cook errors: enabled Landmass startup materials referenced Engine EditorMaterials that this flag excluded. `-DisablePlugins=Landmass` was parsed but did not override an already configured target plugin. Removing the optimization let the actual dependency graph cook cleanly. No `IgnoreCookErrors` or error suppression was used.
- [documented] Source `CookCommandlet.cpp` supports CookAll and SkipZenStore. `PluginManager.cpp` processes extra DisablePlugins only when a name has not already been configured. Prefer a deliberately scoped project/plugin configuration for production; do not guess that an override worked because its flag appeared in the command line.

```powershell
$ueRoot = 'C:/Program Files/Epic Games/UE_5.8'
$projectRoot = 'C:/path/to/frozen-project'
$uproject = "$projectRoot/MyGame.uproject"
& "$ueRoot/Engine/Build/BatchFiles/Build.bat" MyGame Win64 Development "-Project=$uproject" -2022 -CompilerVersion=14.44.35228 -WindowsSDKVersion=10.0.26100.0
& "$ueRoot/Engine/Build/BatchFiles/Build.bat" MyGameEditor Win64 Development "-Project=$uproject" -2022 -CompilerVersion=14.44.35228 -WindowsSDKVersion=10.0.26100.0
& "$ueRoot/Engine/Binaries/Win64/UnrealEditor-Cmd.exe" $uproject -run=Cook -TargetPlatform=Windows -CookAll -SkipZenStore -unversioned -unattended -nullrhi -nosound -notraceserver
```

Check each process exit and fresh cook logs before continuing; the shell snippet is not a failure-aware wrapper. Cook success does not prove stage completeness or runtime startup.

## Assets loaded only by path

- [documented] A folder that nothing references is cooked only if it is listed. `DirectoriesToAlwaysCook` ("Additional Asset Directories to Cook", Packaging, Advanced) names directories cooked "regardless of whether they're referenced by anything" (`Engine/Source/Developer/DeveloperToolSettings/Classes/Settings/ProjectPackagingSettings.h`); `CookCommandlet.cpp` adds each unless `NoGameAlwaysCookPackages` is set.
- [general] `Config/DefaultGame.ini`: `[/Script/UnrealEd.ProjectPackagingSettings]` (the class now lives in the DeveloperToolSettings module; the engine redirects the old name, which project templates still use; not run here) then `+DirectoriesToAlwaysCook=(Path="/Game/Art")`. Code that loads by path (a string-built soft path, a run-time name lookup) needs its folder listed. The failure is silent; see the [packaged smoke run](unreal-native-packaged-smoke.md).

Receipt staging, native UnrealPak and the actual packaged runtime proof: [packaging staging](unreal-native-packaging-staging.md).
