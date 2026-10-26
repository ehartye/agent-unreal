# Native Unreal game build and capture loop

Observed in one consuming Unreal 5.8.2 project on Windows; not reproduced in this repo. Toolchain: Unreal **5.8.2 CL56702186**, VS2022 Build Tools **17.14.37516.0**, actual MSVC **14.44.35228**, SDK **10.0.26100.0**, bundled **.NET 10**, D3D12 on a discrete GPU. Engine source inspection and executed behaviour are labelled separately. Screenshots reveal rendering failures; delivery alone does not establish reference parity. Plugins, modules and first-compile pitfalls are in [module setup](unreal-native-module-setup.md).

## Exact compiler and engine versions

- [general] Read `Engine/Build/Build.version`, `Engine/Config/Windows/Windows_SDK.json` and the compiler's actual ProductVersion. The VS2022 folder was named **14.44.35207**, which looks banned, but `cl.exe` ProductVersion was **14.44.35228.0**, above the banned ceiling. UBT selected and logged the correct actual version.
- [documented] Installed UBT `MicrosoftPlatformSDK.cs::IsValidToolChainDirMSVC` reads ProductVersion before folder-family. VS2026 14.51 was outside 5.8.2 preferred families; pin the tested compiler. This is source inspection, not runtime proof.
- [documented] Installed-source inspection, not runtime proof: Pin `DefaultBuildSettings = BuildSettingsVersion.V7` and `IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_8` in both Target.cs files. Using `Latest` changes defaults on upgrade; V7 adds error-level dangling/return/unreachable diagnostics.

```powershell
$ueRoot = 'C:/Program Files/Epic Games/UE_5.8'
$projectRoot = 'C:/path/to/project'
$uproject = "$projectRoot/MyGame.uproject"
& "$ueRoot/Engine/Build/BatchFiles/Build.bat" MyGameEditor Win64 Development "-Project=$uproject" -WaitMutex -NoHotReloadFromIDE -2022 -CompilerVersion=14.44.35228 -WindowsSDKVersion=10.0.26100.0
if ($LASTEXITCODE -ne 0) { throw 'Native compile failed' }
```

Use Epic's wrappers and bundled dotnet. Preserve logs and receipts. Record HEAD, dirty status, source hash and changes during compile; HEAD alone cannot identify the build.

## Commit and hash boundaries

- [general] A dirty build can pass where the committed one fails, because adaptive unity groups files by the git working set. Naming rules, error codes and the exit-code gate for replay and test steps: [unity build fixes](unreal-native-unity-build-fixes.md).
- [general] A concurrent art-audit writer locked a hashed input after compile. Receipt/stage correctly failed; stopping all source/art writers then rerunning succeeded. An engine-only lease does not freeze every hashed input.

## Editor assets and presentation

- [general] [Native presentation](unreal-native-presentation.md) records the Slate/font commandlet crash, empty VertexColor pin, exact-size Canvas glyphs and Canvas text that needs a `UFont`; [exposure and vertex colour](unreal-native-exposure-and-vertex-color.md) the camera and palette failures caught by actual screenshots.

The [content-only pipeline](unreal-native-content-pipeline.md) separates asset authoring from native gameplay when the host refuses an Editor module.

## Capture the actual game

- [general] `UnrealEditor.exe project.uproject /Game/Maps/MyMap -game -RenderOffScreen -ResX=1920 -ResY=1080 -ForceRes` ran native gameplay and delivered fresh 1920×1080 PNGs plus JSON state. The log selected the discrete GPU; no screen scraping or desktop input service was used.
- [general] A scenario receipt sampled several actors, player displacement, grounded wheels and speed. Those numbers establish sampled native state, not a completed session, good handling or physical keyboard/gamepad coverage.
- [documented] Installed-source inspection, not runtime proof: `FScreenshotRequest::RequestScreenshot(absolutePng, false, false)` lets the engine save the game render target. Wait for screenshot processing **and** file existence before writing success/quitting. Binding `UGameViewportClient::OnScreenshotCaptured()` replaces automatic disk saving; explicitly save delegate pixels if using that path.
- [general] A Canvas HUD rendered in the world-target capture with showUI=false. This does not establish offscreen Slate/UMG capture; that separate path needs showUI=true and a valid Slate window.
- [documented] Installed-source inspection, not runtime proof: `FInputKeyEventArgs::CreateSimulated` and `APlayerController::InputKey(FInputKeyEventArgs)` are the current 5.8.2 input route. The old `FInputKeyParams` overload is deprecated and final. Native control-command replay proves gameplay interfaces separately from physical input mapping/focus behavior.
- [general] [Native input replay](unreal-native-input.md) records the retained-trigger failure and corrected per-frame sample schedule; it separates simulated events from human controller acceptance.

The `MyScenario`/`MyCaptureDir` flags below belong to the project's own harness; they are not built-in engine flags. Implement a finite in-game scenario that drives the same command interface as normal player/AI input, records actual state, captures and exits only after completion.

```powershell
$capture = "$projectRoot/Saved/Verification/fresh-run/scenario"
& "$ueRoot/Engine/Binaries/Win64/UnrealEditor.exe" $uproject /Game/Maps/MyMap -game -RenderOffScreen -unattended -ResX=1920 -ResY=1080 -ForceRes -Deterministic -FPS=60 -MyScenario=drive "-MyCaptureDir=$capture" "-abslog=$capture/native.log"
```

Use a fresh output directory. Reject stale/missing PNG or JSON, invalid PNG dimensions, wrong scenario identity, wrong screenshot path, timeout and failure exit codes. Record exact command, source/build identity, engine version, launch mode, camera/exposure/seed and native state. `-Deterministic -FPS=60` selects a fixed simulation step/seed; do not report frames divided by simulated time as measured rendering FPS. It does not promise deterministic Chaos physics.

## Automation exit codes are insufficient

- [general] A failing test can exit 0 under the queue-empty exit; read the fresh report ([automation tests](unreal-native-automation-tests.md#the-exit-code-is-not-the-verdict)).

## Static parts at the world origin

- [documented] `USceneComponent` is Movable by default. `AttachToComponent` refuses to attach a Static component to a non-Static parent: it logs a line that starts `AttachTo: '<parent>' is not static` and goes on `, cannot attach '<child>' which is static to it. Aborting.` (the engine formats a blueprint-info string between the two, which is empty outside a blueprint) through `FMessageLog("PIE")` and returns false, so the child stays unattached (`Engine/Source/Runtime/Engine/Private/Components/SceneComponent.cpp`; skipped while the owner runs a user construction script).
- [general] Observed once on 5.8.x: actors that owned static slabs and walls drew those parts at the world origin, not where the actor stood. A wall jump's sweeps found no wall for three runs, through changes of mesh origin and trace channel, until one log line showed the walls never attached. Give an actor that owns static meshes a Static root (`SetMobility(EComponentMobility::Static)` on it before attaching), and search the log for `is not static` before debugging a probe. A sweep that finds a Nanite wall is a separate trap: [contact case study](unreal-native-contact.md#a-sweep-can-need-the-complex-triangles).

## Native packaging and remaining acceptance

Read [native Windows packaging](unreal-native-packaging.md) for the Application Control UAT failure and the Build.bat/direct-Cook/UnrealPak route. The actual Game executable delivered native capture scenarios from an immutable commit; this is distinct from Editor-game evidence.

- [general] An initial packaged baseline does not establish full gameplay, hardware input, audible audio, frame-rate robustness ([profiling](unreal-native-profiling.md)), portability or reference parity. Later guides carry their own bounded proofs.
