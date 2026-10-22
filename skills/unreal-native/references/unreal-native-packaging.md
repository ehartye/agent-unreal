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

## Receipt staging and native UnrealPak

- [general] A finite PowerShell stager read `Binaries/Win64/MyGame.target`. It copied executable/dynamic-library/required-resource build products and NonUFS runtime dependencies, skipped debug-only products, and built UFS entries from runtime receipt dependencies plus the actual cooked files. It rejected missing files and unsupported roots instead of guessing paths.
- [general] Receipt roots `$(ProjectDir)` and `$(EngineDir)` mapped to the package's project-name and Engine directories. Cooked Metadata was excluded. Config and plugin config were staged deliberately. Native UnrealPak consumed a UTF-8 response list mapping sources to `../../../Project/...` and `../../../Engine/...`; the resulting pak mounted at `../../../` in the actual game log.
- [general] Staging also included Windows DDPI's **icudt64l** English ICU data at `Engine/Content/Internationalization/icudt64l`, Engine en localization, app-local VC/DirectX DLLs beside the executable, and an empty **Engine/Config/StagedBuild_MyGame.ini outside the pak**. The marker lets native startup find the staged project directory before mounting paks. Installed UAT staging source supplied these contracts; receipt DLLs alone were insufficient as a complete recipe.
- [general] Source font OFL files and source metadata were copied from the exact archived tree into ThirdPartyNotices. Font binaries were already in cooked FontFace assets. The delivery was a Development Game executable of a few hundred MB, not a size-optimized Shipping build.

```text
UnrealPak.exe MyGame-Windows.pak -Create=pak-response.txt -compress -UTF8Output
```

Every response entry quotes both paths, for example `"source-file" "../../../MyGame/Content/Maps/MyMap.umap"`. Keep non-UFS DLLs and the staged marker physically accessible. A direct native executable may live at `MyGame/Binaries/Win64/MyGame.exe`; do not assume a UAT-created root bootstrap exists. A small relative-path launch script can expose it to the player without requiring the Editor.

## Actual packaged runtime proof

- [general] The **Game executable**, not UnrealEditor, ran its scenarios offscreen on D3D12 on a discrete GPU. Each delivered a fresh 1920×1080 PNG and matching native JSON; the images were opened. The log mounted the staged pak. App-local runtime DLLs and the OFL notices were present.
- [general] Scenario receipts sampled actor count, player displacement, speed, grounded wheels and weapon execution. These establish sampled native motion/control-command execution. They do not establish a completed session or physical keyboard/controller interaction.
- [general] Performance acceptance needs the profiling method in [native profiling](unreal-native-profiling.md), run on the immutable package with the sampler built into it.
- [general] Preserve visual GAP status, known HUD/world issues and open full-play/input/audio/performance acceptance. A locally running native package does not establish cross-machine portability; another clean Windows machine remains a separate test.

## Pace audio captures

- [general] UE5.8.2's fixed-step/benchmark branch bypasses frame waiting (`UnrealEngine.cpp`), so MaxFPS alone cannot pace it. For an isolated 60Hz master recording, save FApp's fixed-step/benchmark flags and engine fixed-rate/FPS; during recording disable the former and enable engine fixed 60FPS. Restore on normal stop and teardown. One project observed 19.65 simulation seconds during 20.0095 wall seconds (ratio 0.9820), with settings restored. Validate both clocks, intended tick rate and restoration beside WAV/EXE hashes. Use the project's intended rate rather than copying 60 universally; restrict this to explicit captures. A normal-cadence excerpt is not a sustained-performance test or owner approval.
