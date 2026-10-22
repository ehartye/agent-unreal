# Native Unreal game build and capture loop

Observed in one consuming Unreal 5.8.2 project on Windows; not reproduced in this repo. Toolchain: Unreal **5.8.2 CL56702186**, VS2022 Build Tools **17.14.37516.0**, actual MSVC **14.44.35228**, SDK **10.0.26100.0**, bundled **.NET 10**, D3D12 on a discrete GPU. Engine source inspection and executed behaviour are labelled separately. Screenshots reveal rendering failures; delivery alone does not establish reference parity.

## Native module and source geometry

- [general] An initial C++ Runtime module loaded in `UnrealEditor.exe -game`, built procedural vehicles and a long track, simulated a Chaos chassis and saved game-camera PNGs using ProceduralMeshComponent.
- [general] Explicit project plugins were `ProceduralMeshComponent`, `PythonScriptPlugin` and `EditorScriptingUtilities`. Runtime used Core, CoreUObject, Engine, InputCore, ProceduralMeshComponent and PhysicsCore, plus JSON/UI modules the game needed. Editor-only material graph creation stayed in Python.
- [documented] Installed-source inspection, not runtime proof: ProceduralMeshComponent is a Runtime module in 5.8.2. It does not automatically provide a skeletal rig, Nanite or authored LODs. Use a few simple collision bodies, not collision on decorative trim. Bake accepted repeated geometry into static meshes when instancing/LODs are needed.
- [general] The first native compile caught an ambiguous conditional between `Parent->Mobility` (`TEnumAsByte`) and `EComponentMobility::Movable`. `Parent->GetMobility()` supplies the exact enum. A test source in a nested module folder could not include the parent's header through a legacy implicit include path; its explicit relative include fixed compilation. Do not widen global include paths to hide a local ownership mistake.

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

- [general] A dirty adaptive-unity build passed; committing regrouped files and exposed duplicate anonymous-namespace names. Distinctive helper/constants fixed the normal committed build. Recheck after working-set changes.
- [general] A concurrent art-audit writer locked a hashed input after compile. Receipt/stage correctly failed; stopping all source/art writers then rerunning succeeded. An engine-only lease does not freeze every hashed input.

## Editor assets and presentation

- [general] [Native presentation](unreal-native-presentation.md) records the Slate/font commandlet crash, empty VertexColor pin, exact-size Canvas glyphs and camera/palette failures caught by actual screenshots.

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

- [general] A failing automation test returned **process exit code 0** under `-TestExit="Automation Test Queue Empty"`. Fresh `index.json` correctly reported failed=1. The engine's queue-empty exit is not a passing test result.
- [general] The project wrapper therefore parses fresh automation JSON and rejects failed, incomplete, zero-test or unexpected-filter reports, in addition to checking process exit/timeout. Dependency-free tooling checks should exercise those rejection paths using deliberate invalid artifacts.
- [general] After the guard fix, fresh automation reported all tests succeeded and none failed. Such bounded behaviours do not replace play-through, handling or physical-input checks.

```powershell
& "$ueRoot/Engine/Binaries/Win64/UnrealEditor-Cmd.exe" $uproject "-ExecCmds=Automation RunTests MyGame" "-TestExit=Automation Test Queue Empty" "-ReportExportPath=$projectRoot/Saved/Verification/fresh-tests" -unattended -nullrhi -nosound -notraceserver
# Parse fresh index.json: require executed successes and failed/notRun/inProcess == 0.
```

Use nullrhi for nonvisual automation, never for a rendered acceptance frame. Engine process ownership must be serialized between builders, content generation, tests and captures.

## Native packaging and remaining acceptance

Read [native Windows packaging](unreal-native-packaging.md) for the Application Control UAT failure and the Build.bat/direct-Cook/UnrealPak route. The actual Game executable delivered native capture scenarios from an immutable commit; this is distinct from Editor-game evidence.

- [general] An initial packaged baseline does not establish full gameplay, hardware input, audible audio, frame-rate robustness ([profiling](unreal-native-profiling.md)), portability or reference parity. Later guides carry their own bounded proofs.
