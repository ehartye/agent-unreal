# Gameplay Cameras in Unreal 5.8: a third-person view built from code, and a blend that never finishes

Target: Unreal Engine 5.8, Windows. Observed once on 5.8.x in a native C++ third-person game, so a line is `[general]` unless it says it rests on a header or descriptor, which is `[documented]`. A line is `[tested]` only where `examples/unreal/gameplay_cameras/` ran it on 5.8.4 (34 of 34 checks, no rendering window). Names marked "header read" were also found in a 5.8.2 install under `Engine/Plugins/Cameras/GameplayCameras/`. Choose Cine Cameras and Sequencer shots in [unreal-animation](../../unreal-animation/SKILL.md); this page is the gameplay camera that follows a pawn.

## Enable it

- [documented] The `GameplayCameras` plugin is experimental: its descriptor sets `IsExperimentalVersion` (header read), and lists it enabled by default with EnhancedInput, StateTree and TemplateSequence as plugin dependencies. Add the module `GameplayCameras` to the game module's `Build.cs`.
- [general] The character has a `UGameplayCameraComponent` (the camera asset is its `CameraReference`, header read), and the player controller's camera manager class is `AGameplayCamerasPlayerCameraManager`. The spring arm stayed as a fallback behind a console variable; setting it to 0 brought the arm back.

## Where the numbers live

- [general] Decide this first. Which modes are wanted at a moment (a sprint above a multiple of the run speed on the ground, a glide of its own, a cast over either) is a rule that can sit in an engine-free header and be unit tested. What each mode does to the picture is data in rig assets that one editor-module function builds from code. The numbers then have one place.

## The rigs

- [general] A base rig of an attach-to-player-pawn node (`UAttachToPlayerPawnCameraNode`), a boom arm (`UBoomArmCameraNode`) with an offset back and up, a collision push (`UCollisionPushCameraNode`) and a field of view (`UFieldOfViewCameraNode`).
- [general] The boom's input slot is a driven control rotation node (`UDrivenControlRotationCameraNode`), so the player controller's rotation, pitch limits and a test harness's mouse and stick still turn it. A critical-damper interpolator (`UCriticalDamperValueInterpolator`) gives the lag.
- [general] One modifier rig per mode, blended over the base for as long as the mode lasts, each with an enter and an exit blend time. A camera asset holds a single director (`USingleCameraDirector`) that plays the base rig.
- [general] The character starts and stops each mode's rig with `StartGlobalCameraModifierRig(Rig, OrderKey)`, which returns an `FCameraRigInstanceID`, and `StopCameraModifierRig(Id, bImmediately)` (both on the component and on the camera manager, header read).
- [tested] On 5.8.4 the manager's `StartGlobalCameraModifierRig` logs `LogCameraSystem: Warning: Camera rig '<rig>' may experience a hitch because its initial result isn't valid.` once per start; the view still blends correctly. The component's start logs nothing. Treat the warning as expected on the manager path. One start-up warning naming `CameraRigAsset_0` appears in the manager session only and was not traced.
- [documented] The manager path runs the rig in a null context, which is the likely source of the warning (`Core/BlendStackCameraNode.cpp`, source read; not isolated by a run).

## Build traps

- [documented] `FCameraRigAssetAssembler::AddEnterTransition` does not compile for the plain assembler in 5.8: it hands a base class where the derived one is wanted. In `CameraAssetAssembleUtils.h` (header read) the base template passes `*this` as a `TCameraRigAssetAssemblerBase<ThisType>` to a transition assembler that wants `ThisType&`. Make the blend transitions by hand: `UCameraRigAsset` holds public `EnterTransitions` and `ExitTransitions` arrays of `UCameraRigTransition` (header read).
- [general] An enum value named `Cast` meets Unreal's `Cast<>` where the enum's namespace is brought in with `using`. Pick another name.
- [tested] On 5.8.4 a plain move of the character makes the boom lag: the eye peaked at 1158 cm from the pawn against a 412.3 cm boom and settled to 412.6 cm in about 8 s (852, 641, 520, 461, 433, 421, 416, 414, 413, 413 cm at 1 to 10 s). After a teleport (an `ETeleportType` other than `None`) the eye lands at the boom length at once (412.6 cm). Teleport the character to its start; otherwise a camera assertion needs about 8 s to settle. Observed once in a native game: 1,395 cm against a 465 cm boom in the first frames.
- [documented] A move with an `ETeleportType` other than `None` marks a camera cut (`UGameplayCameraComponentBase::OnUpdateTransform`), and `BoomArmCameraNode.cpp` skips the lag on a cut (source read); that is the likely reason for the immediate landing.

## What was checked

- [general] The evidence was read from the camera manager after the change. At rest the eye was the boom's length from the character and the field of view the base rig's. A sprint widened the view and pulled the eye out by the rig's numbers, and both came back afterwards. The spring arm returned when the console variable was 0.
- [general] Not covered: camera shakes (the system has shake nodes and assets), framing nodes that keep a target in view, collision against terrain, and how any of it feels. Damping and blend times were a first guess nobody played.

## A view blend under time dilation

- [general] A view-target blend takes its time from the world's. A photo mode held the world by slowing world time to a ten-thousandth and blended the view to a flying Cine Camera over 0.35 s. The blend never finished and the screen kept the original camera (78 degree field of view). Pictures through a 35 mm and a 100 mm lens came out identical. In the stock `APlayerCameraManager`, `BlendTimeToGo` falls by the `DeltaTime` that `UpdateCamera` receives (`Engine/Source/Runtime/Engine/Private/PlayerCameraManager.cpp`, header read), which is the world's delta.
- [tested] On 5.8.4 at world time dilation 0.0001 the stock `APlayerCameraManager` blend stays pending (`BlendTimeToGo` about 0.35, view 78.0 degrees), the photo camera's own lens reads 30.0 and the view's eye is 2009 cm from the photo camera. The Gameplay Cameras evaluator blends on world time too: a modifier rig's enter blend progressed 0.000 in 2.03 s of real time.
- [tested] On 5.8.4 the frame that sets the dilation still passes the old delta, so set the dilation at least one frame before starting a blend. Started in the same frame, the view-target blend read `BlendTimeToGo` 0.3165 and the view had moved to 73.4 degrees.
- [tested] On 5.8.4 `APlayerCameraManager::SetViewTarget` ignores a cut to the target that is already pending ("already transitioning to this new target, don't interrupt"): cutting to the photo camera mid-blend leaves the blend pending. Cut to the base camera first, which aborts the blend; a cut to the photo camera then works (30.0 degrees, nothing pending).
- [general] Fix: abort the pending blend with a cut to the base camera, cut to the photo camera, and cut back at the end; or update the blend on real time. Pausing the world instead froze the clouds' temporal accumulation as a dither of dots and left the first frames streaked with motion blur from a velocity over a frame time of nothing.
- [general] A held world also distorts a cloth simulation: time slowed to about 1e-4 of real time made cloth pictures wrong (observed once). Take a cloth picture with a camera yaw and normal time, not through the held-world photo mode.
- [general] A camera check must read the screen's camera, not the camera it set up. The replay read the photo camera's own lens and how far it had flown, so the feature was marked verified while its camera was not on screen. Read the view's field of view and the distance between the view's eye and the photo camera (the run above read these from `GetCameraCacheView()`).
