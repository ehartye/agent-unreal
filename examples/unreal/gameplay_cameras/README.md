# Gameplay Cameras rig, modifier rig and a view blend under time dilation

Prepared for [Gameplay Cameras in Unreal 5.8](../../../skills/unreal-gameplay/references/unreal-gameplay-cameras.md). Unreal Engine 5.8, Windows, Visual Studio 2022 Build Tools.

**Status:** Run on Unreal 5.8.2 on 2026-10-26: 34 of 34 checks pass; rerun on 5.8.4 with the same result. The first run (21 of 27) found three probe faults and the engine behaviours listed under Findings; the checks now assert what the engine does.

The questions: does a third-person rig built in code with the Gameplay Cameras assemblers put the player camera manager's eye and field of view where the rig's numbers say; do a modifier rig's start and stop blend the view in and out; and what does a view blend do in a world held at 0.0001 of real time?

## Files

- `module/CameraProbe/` (runtime module, game process):
  - `CameraProbeRigs.cpp` builds the data with `FCameraRigAssetAssembler` and `FCameraAssetAssembler` (`Public/Build/CameraAssetAssembleUtils.h` in the plugin): a base rig (attach to player pawn, boom arm with a driven control rotation input and a critical-damper length interpolator, collision push, field of view 78), a modifier rig (field of view 95, an offset pulling the eye 120 cm back) with enter and exit blend transitions made by hand, and a camera asset whose single director plays the base rig.
  - `CameraProbeGame.h/.cpp` hold the pawn (a `UGameplayCameraComponent`), the controller (its camera manager class follows `-CamHost`) and the game mode (spawns the pawn at a fixed transform, runs the scenario from `Tick`, writes the report and exits).
  - `CameraProbeScenario.cpp` has the two scenarios.
- `gameplay_cameras.mjs` writes a throwaway code project in the OS temp folder (`../native-build.mjs`), enables the `GameplayCameras` plugin, builds the Editor target and starts `UnrealEditor.exe <project> <map>?game=/Script/CameraProbe.CameraProbeGameMode -game -nullrhi -UseFixedTimeStep -FPS=30 -CamHost=<session> -CamReport=<file>` once per session.
- `gameplay-cameras-checks.mjs` judges the build, the reports and the logs; `gameplay-cameras.test.mjs` tests that logic with no Unreal (it runs in `node scripts/check.mjs`). The test reports are the shape the C++ writes, with predicted values: the shape is an assumption until a first run.

## Sessions

| Session | Camera manager | Who runs the camera system | Reads |
|---|---|---|---|
| `manager` | `AGameplayCamerasPlayerCameraManager` | the manager (`bRunStandaloneCameraSystem` false; `ActivateGameplayCamera`) | rest eye and field of view, boom lag, modifier start and stop, modifier blend at dilation 0.0001 |
| `component` | stock `APlayerCameraManager` | the component (`bRunStandaloneCameraSystem` true; `ActivateCameraForPlayerController`) | the same, through the child camera the stock manager reads |
| `stock` | stock `APlayerCameraManager` | no Gameplay Cameras | a 0.35 s view-target blend between two camera actors in normal time and at dilation 0.0001, then a cut |

Every reading comes from `APlayerCameraManager::GetCameraCacheView()`, the view the renderer is given, not from the camera asset or the photo camera that was set up.

## Run

```text
node examples/unreal/gameplay_cameras/gameplay_cameras.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--compiler 14.44.35228] [--sdk 10.0.26100.0] [--map /Engine/Maps/Entry] [--sessions manager,component,stock]
```

`--engine` may be replaced by the `UE_ROOT` environment variable. The build takes under a minute (a single module; the plugin is prebuilt); each session is a game start and about ten seconds of fixed-step frames. Nothing is rendered.

## What it checks (34 checks: 1 build, 12 for each of the two rig sessions, 9 for the stock session)

- The module compiles against `GameplayCameras` (`GameplayCameras.Build.cs` is the dependency to name).
- Per rig session (12 checks): the process ran with the fixed time step and the log has no `LogCameraSystem` error and no warning other than the hitch warning below; the host is the one the session names; the modifier start logs the hitch warning on the manager and not on the component; the assembler-built rigs report a clean build status and the pawn was possessed before activation; the eye at rest is within 5 cm of the pawn plus the control rotation applied to the boom offset and the field of view is 78; a plain 1000 cm move shows the boom lag in the first frames and settles within 10 cm of the boom length after ten seconds; the same move as a teleport shows no lag; the modifier rig starts (valid instance id), is halfway at 0.2 s and complete at 2 s (95 degrees, eye out by the modifier's offset); it stops with the exit blend; the same start at dilation 0.0001 progresses less than 10 percent in two seconds of real time; an immediate stop in the held world returns the base view; the time dilation is back at 1.
- Stock session (9 checks): the cached view starts on the base camera; a 0.35 s blend finishes in normal time; the same blend does not finish in the held world (the photo camera stays pending, `BlendTimeToGo` stays near 0.35, the view keeps 78 degrees); in that state the photo camera's own lens says 30 and the view says 78, with the view's eye more than 1000 cm from the photo camera; a blend started in the frame that sets the dilation gets one frame of time; a cut to the camera the stalled blend is heading for does nothing; a cut to the base camera aborts the blend; a cut to the photo camera then works.

## Findings (Unreal 5.8.4)

- Both hosts blend a modifier rig on world time: at dilation 0.0001 the enter blend progressed 0.000 in two seconds of real time. The Gameplay Cameras evaluator stalls in a held world as the stock view-target blend does.
- Order matters: a blend started in the same frame that sets the dilation gets one undilated frame. In the first run the view-target blend lost 0.0335 s (`BlendTimeToGo` 0.3165, field of view 73.4) and the modifier blend showed 2 percent progress. The probe sets the dilation two frames before it starts the blend, and one stock check keeps the same-frame case.
- A cut to the camera a blend is already heading for is ignored: `APlayerCameraManager::SetViewTarget` returns early when the new target is the pending one (`Engine/Source/Runtime/Engine/Private/PlayerCameraManager.cpp`). A cut to the current view target aborts the pending blend; a cut to the photo camera works after that.
- A teleport is a camera cut: `UGameplayCameraComponentBase::OnUpdateTransform` marks the next frame a cut for any teleport type but `None`, and the boom arm re-uses its pull on a cut (`Nodes/Common/BoomArmCameraNode.cpp`), so the eye lands at its rest distance at once. A plain move of 1000 cm showed the lag: the eye was 852 cm from the pawn one second later and back to 413 cm after ten.
- `AGameplayCamerasPlayerCameraManager::StartGlobalCameraModifierRig` runs the rig in a null context (`EnsureNullContext`) whose initial result is never marked valid, so the log gets `LogCameraSystem: Warning: Camera rig '<rig>' may experience a hitch because its initial result isn't valid.` once per start (`Core/BlendStackCameraNode.cpp`). The view is right. The component logs none. The manager session also logs one such line for an engine rig, `CameraRigAsset_0`, during start-up.

## Header facts the code depends on (read on disk, not run)

- `UDrivenControlRotationCameraNode` and `UCriticalDamperValueInterpolator` are declared `UCLASS()` with no API macro, so `NewObject<T>()` on either would not link from another module. `CameraProbeRigs.cpp` makes both from the class path through an exported base class (`UInput2DCameraNode`, `UCameraValueInterpolator`).
- `AttachToPlayerPawnCameraNode.cpp` reads the controller's pawn in `OnInitialize`; the scenario activates the camera after possession for that reason.
- `TCameraRigAssetAssemblerBase::AddEnterTransition` and `AddExitTransition` pass `*this` (the base type) to a transition assembler built on the derived type. They are never called here; the transitions are made by hand. This probe does not compile the failing call.
- `AGameplayCamerasPlayerCameraManager::SetViewTarget` ignores transition parameters for blending (it calls the base with empty parameters and overrides the next activation transition on the new context), so the `manager` session's blend is the modifier rig's own blend, not a view-target blend.

## Not covered

Camera shakes, framing nodes, collision against terrain (the map has no geometry), input-driven rotation, and how any of it feels. The sprint rule (which mode applies when) is game logic and is not part of the probe.
