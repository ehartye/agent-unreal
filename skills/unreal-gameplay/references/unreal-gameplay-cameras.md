# Gameplay Cameras in Unreal 5.8: a third-person view built from code, and a blend that never finishes

Target: Unreal Engine 5.8, Windows. Observed once on 5.8.x in a native C++ third-person game. No run in this repository covers it, so every line is `[general]`. Names marked "header read" were also found in a 5.8.2 install under `Engine/Plugins/Cameras/GameplayCameras/`. Choose Cine Cameras and Sequencer shots in [unreal-animation](../../unreal-animation/SKILL.md); this page is the gameplay camera that follows a pawn.

## Enable it

- [general] The `GameplayCameras` plugin is experimental: its descriptor sets `IsExperimentalVersion` (header read), and lists it enabled by default with EnhancedInput, StateTree and TemplateSequence as plugin dependencies. Add the module `GameplayCameras` to the game module's `Build.cs`.
- [general] The character has a `UGameplayCameraComponent` (the camera asset is its `CameraReference`, header read), and the player controller's camera manager class is `AGameplayCamerasPlayerCameraManager`. The spring arm stayed as a fallback behind a console variable; setting it to 0 brought the arm back.

## Where the numbers live

- [general] Decide this first. Which modes are wanted at a moment (a sprint above a multiple of the run speed on the ground, a glide of its own, a cast over either) is a rule that can sit in an engine-free header and be unit tested. What each mode does to the picture is data in rig assets that one editor-module function builds from code. The numbers then have one place.

## The rigs

- [general] A base rig of an attach-to-player-pawn node (`UAttachToPlayerPawnCameraNode`), a boom arm (`UBoomArmCameraNode`) with an offset back and up, a collision push (`UCollisionPushCameraNode`) and a field of view (`UFieldOfViewCameraNode`).
- [general] The boom's input slot is a driven control rotation node (`UDrivenControlRotationCameraNode`), so the player controller's rotation, pitch limits and a test harness's mouse and stick still turn it. A critical-damper interpolator (`UCriticalDamperValueInterpolator`) gives the lag.
- [general] One modifier rig per mode, blended over the base for as long as the mode lasts, each with an enter and an exit blend time. A camera asset holds a single director (`USingleCameraDirector`) that plays the base rig.
- [general] The character starts and stops each mode's rig with `StartGlobalCameraModifierRig(Rig, OrderKey)`, which returns an `FCameraRigInstanceID`, and `StopCameraModifierRig(Id, bImmediately)` (both on the component and on the camera manager, header read).

## Build traps

- [general] `FCameraRigAssetAssembler::AddEnterTransition` does not compile for the plain assembler in 5.8: it hands a base class where the derived one is wanted. In `CameraAssetAssembleUtils.h` (header read) the base template passes `*this` as a `TCameraRigAssetAssemblerBase<ThisType>` to a transition assembler that wants `ThisType&`. Make the blend transitions by hand: `UCameraRigAsset` holds public `EnterTransitions` and `ExitTransitions` arrays of `UCameraRigTransition` (header read).
- [general] An enum value named `Cast` meets Unreal's `Cast<>` where the enum's namespace is brought in with `using`. Pick another name.
- [general] The eye can read far from the character in the first frames of a run (1,395 cm against a 465 cm boom) while a test moves the character to its start and the boom's lag catches up. A camera assertion needs a settle time.

## What was checked

- [general] The evidence was read from the camera manager after the change. At rest the eye was the boom's length from the character and the field of view the base rig's. A sprint widened the view and pulled the eye out by the rig's numbers, and both came back afterwards. The spring arm returned when the console variable was 0.
- [general] Not covered: camera shakes (the system has shake nodes and assets), framing nodes that keep a target in view, collision against terrain, and how any of it feels. Damping and blend times were a first guess nobody played.

## A view blend under time dilation

- [general] A view-target blend takes its time from the world's. A photo mode held the world by slowing world time to a ten-thousandth and blended the view to a flying Cine Camera over 0.35 s. The blend never finished and the screen kept the original camera (78 degree field of view). Pictures through a 35 mm and a 100 mm lens came out identical. In the stock `APlayerCameraManager`, `BlendTimeToGo` falls by the `DeltaTime` that `UpdateCamera` receives (`Engine/Source/Runtime/Engine/Private/PlayerCameraManager.cpp`, header read), which is the world's delta. Whether the Gameplay Cameras evaluator behaves the same was not checked.
- [general] Fix: cut to the photo camera and back at once, or update the blend on real time. Pausing the world instead froze the clouds' temporal accumulation as a dither of dots and left the first frames streaked with motion blur from a velocity over a frame time of nothing.
- [general] A held world also distorts a cloth simulation: time slowed to about 1e-4 of real time made cloth pictures wrong (observed once). Take a cloth picture with a camera yaw and normal time, not through the held-world photo mode.
- [general] A camera check must read the screen's camera, not the camera it set up. The replay read the photo camera's own lens and how far it had flown, so the feature was marked verified while its camera was not on screen. Read the view's field of view and the distance between the view's eye and the photo camera.
