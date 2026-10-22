# UEFN saved controls and capture

Read this when native UEFN edits need scoped saves, disposable proof cleanup,
Verse references, compact buttons or screenshots. Observed in one consuming
UEFN project on UEFN 42.30; not reproduced in this repo. Every claim below is
labelled `[general]` for that reason.
Inspect the installed schemas after upgrades; these observations are not an API
contract for every project. Use the authoring reference for connection setup.

## Contents

- [Choose the operation and its proof](#choose-the-operation-and-its-proof)
- [Name rotation axes and check the visible component](#name-rotation-axes-and-check-the-visible-component)
- [Save only owned external actor packages](#save-only-owned-external-actor-packages)
- [Delete only reconciled disposable proof assets](#delete-only-reconciled-disposable-proof-assets)
- [Distinguish built-in adapters from custom Verse instances](#distinguish-built-in-adapters-from-custom-verse-instances)
- [Compact switches without shrinking interaction targets](#compact-switches-without-shrinking-interaction-targets)
- [Bounded editor screenshots when viewport capture stalls](#bounded-editor-screenshots-when-viewport-capture-stalls)
- [Actual client capture across Windows sessions](#actual-client-capture-across-windows-sessions)
- [Runtime QA without leaking diagnostics into visits](#runtime-qa-without-leaking-diagnostics-into-visits)

## Choose the operation and its proof

| Operation | Time | Risk | Complexity | Architectural fit | Maintenance |
|---|---|---|---|---|---|
| Orient native switches | One audited rotation pass | Positional axes or upside-down child mesh | Low | Explicit axes and visible component basis | Versioned evidence; preserve other transforms |
| Save named external actor packages | One preflight and batch call | Wrong package ownership | Small native script | Project owns its actors | Exact targets and save receipt |
| Delete owned disposable proof assets | Reconcile first, then one bounded attempt | Wrong ownership or retained references | Explicit identities and native readback | Experiments own their fixtures | Preserve failures; stop rather than force/replay |
| Reuse existing Verse adapters | Preflight, write, read back | Wrong reference type or stale field | Small MCP script | Preserve device identities | Stable editable fields |
| Shrink a Button's visible component | One component edit | Confusing appearance with reach | Low | Preserve the logical device | Read back both scales and radius |
| Offscreen SceneCapture2D | Short bounded callback job | Leaked actor or misleading exposure | Moderate | Temporary editor inspection | Cleanup receipt; keep runtime checks |

Source, saved packages, editor images, validation and runtime behavior establish
different things. State the layer checked. Method-invoking QA does not establish
physical interaction, third-person camera behavior, late joining or performance.

## Name rotation axes and check the visible component

**[general] Observed on UEFN 42.30:** `unreal.Rotator(0, 90, 0)` produced
`pitch=90, yaw=0, roll=0` in the installed native Python API. A repair that
treated the middle argument as yaw left some switches lying flat and others
upside down. Do not infer this constructor's positional order from a displayed
Pitch/Yaw/Roll struct or an MCP JSON schema.

Use explicit `pitch=`, `yaw=` and `roll=` arguments for every native constructor,
including camera and verification code. MCP rotation objects name their fields;
that does not make positional Python constructors equivalent. Recheck the
installed API after upgrades instead of assuming this observation is universal.

The observed Military Switch ButtonMesh used local +X as its visible front and
+Z as its top. For an upright world yaw, verify **both** its world forward and
up vectors. Forward alone accepts a switch rolled 180 degrees. Actor rotation
alone can miss a rotated child component: inspect the current `buttonMesh`,
its relative rotation/scale, and its world basis. Other imported meshes may
use different face axes; establish those from actual geometry first. Do not
zero an intentional child transform just to satisfy a Button-specific check.

This excerpt uses the exercised calls; `actor` and `target_yaw` must come from
an exact project/actor preflight. It is not a standalone repair or save routine.

```python
import math
import unreal

actor.set_actor_rotation(
    unreal.Rotator(pitch=0, yaw=target_yaw, roll=0), False)
mesh = actor.get_editor_property('buttonMesh')
front, up = mesh.get_forward_vector(), mesh.get_up_vector()
angle = math.radians(target_yaw)
expected_front = [math.cos(angle), math.sin(angle), 0]
if (math.dist([front.x, front.y, front.z], expected_front) > .001
        or math.dist([up.x, up.y, up.z], [0, 0, 1]) > .001):
    raise RuntimeError('Visible switch orientation differs; inspect child transform')
```

Snapshot identities, positions, scales and interaction properties first. Apply
only the audited rotation changes, preserve already-correct and retired devices,
then read back the visible basis and protected state before scoped package saves.
A good repair receipt shows every active switch passing both axis checks while
all other positions, scales and rotations stay unchanged, plus a few editor
captures of upright switches. These checks do not establish physical
interaction, readable placards or full-prop camera framing.

## Save only owned external actor packages

**[general]** `actor.get_package()` returned the external actor package in the
loaded island. Verify `actor.is_package_external()` and the actual package path;
do not assume the returned object is the map or assume every actor is external.
`EditorLoadingAndSavingUtils.save_packages(packages, False)` saved scoped sets
of named actors. Check its boolean result. Related external
object packages may also change for an owned folder; inspect ownership before
staging. A source commit does not back up native assets unless those files ship.

The following function uses those native calls. Its arguments come from
a project-specific preflight: the exact island level, unique owned actor paths,
and the verified external package prefix. It has not been run as a reusable
function; the calls and guards were exercised separately in project scripts.

```python
import unreal

def save_owned_actor_packages(expected_level, actor_paths, external_package_prefix):
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    if world.get_path_name().split('.')[0] != expected_level:
        raise RuntimeError("Wrong island")
    if not actor_paths or len(set(actor_paths)) != len(actor_paths):
        raise RuntimeError("Expected unique, explicitly owned save targets")
    if not external_package_prefix or not external_package_prefix.endswith('/'):
        raise RuntimeError("Expected a preflighted external package prefix")
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
    packages = {}
    for path in actor_paths:
        found = [actor for actor in actors if actor.get_path_name() == path]
        if len(found) != 1:
            raise RuntimeError("Missing or ambiguous target: " + path)
        actor = found[0]
        package = actor.get_package()
        if not actor.is_package_external():
            raise RuntimeError("Refusing a nonexternal actor package")
        if not package.get_path_name().startswith(external_package_prefix):
            raise RuntimeError("Refusing an out-of-scope package")
        packages[package.get_path_name()] = package
    if not unreal.EditorLoadingAndSavingUtils.save_packages(list(packages.values()), False):
        raise RuntimeError("Save failed; inspect before repeating")
    return list(packages)
```

Do not replace this preflight with Save All. Empty target lists must fail closed.
Retain the saved package names and pending-save state in a receipt. Reconcile a
timeout against native package state before another mutation. Serialize native
scripts and callback jobs: the observed remote entrypoint shared Python globals.
Do not call MCP from inside an editor Python script.

For an extra dirty ActorFolder, derived LevelBounds, native material pins or sky
collision readback, use [exterior materials and save scope](uefn-native-exterior.md).
In the observed folder follow-up the new package was identified separately and
the original dirty external objects were preserved; a successful actor save was
not replayed.

## Delete only reconciled disposable proof assets

**[general] Observed on 42.30:** immediate deletion failed while proof assets
remained in use. Closing owned asset editors returned zero; Unreal GC alone did
not release the assets. Python `gc.collect()` followed by
`unreal.SystemLibrary.collect_garbage()` allowed the remaining disposable
assets to be deleted. The Python return value counts **unreachable objects**,
not cycles. The exact retaining references/internal cause were not inspected.
A later hardened cleanup returned hundreds of unreachable Python objects and
removed an additional owned comparison sequence. Do not turn those observations
into a universal cleanup guarantee or invent a reference-clearing fix.

Treat deletion as a separate operation from experiment authoring. Before any
delete, reconcile against current native state, not just a `removed` flag:

1. [general] Verify the exact loaded island and that editor Sequencer is idle.
   Stop or finish the owned callback/job and remove its owned transient fixtures
   first. Do not delete an asset still evaluated or used by a live fixture.
2. [general] Derive the complete expected proof set from the original experiment
   recipe: exact role, version, package and object name. A folder, naming prefix
   or glob is not deletion ownership. The expected set may include named
   sequences outside the proof folder. Accept an exact package path or its
   matching package.object form; refuse a neighboring version, nested path,
   unknown role or mismatched object suffix.
3. [general] Preserve historical failed receipts verbatim. Write a separate
   read-only reconciliation containing each original receipt's SHA-256, exact
   fixture paths, current absence and idle evaluation evidence. Missing or
   incomplete identities fail closed.
4. [general] Immediately before deletion, re-hash every original receipt, require
   the same complete set and recheck each recorded fixture path unoccupied. A path
   may have been reused after reconciliation: even a different actor there is
   a stop, not permission to destroy it. Verify protected original assets and
   the full exact asset set against the preflight. Refuse a prior cleanup-attempt
   receipt instead of overwriting it or treating elapsed time as reconciliation.
5. [general] Write a pending cleanup receipt before collection/deletion. Avoid
   loading owned proof assets during the deletion pass. In the observed recovery,
   collect unreachable Python wrappers before Unreal UObject collection; do
   not clear shared Python globals, force deletion or suppress references to
   make the operation pass. A GC count proves collection, not asset absence.
6. [general] Delete only exact owned targets with `EditorAssetLibrary.delete_asset`.
   Record the currently attempted path and each successful deletion. Check
   the boolean result and `does_asset_exist` after each target. Stop on failure;
   retain the partial receipt and inspect/reconcile before a later operation.
   Refuse automatic retries, including after a client timeout.
7. [general] Check every expected destination absent, not merely those reported
   deleted. Restore selection/evaluation state and verify protected native state.
   Record explicit remaining targets, package-save state and the evidence
   boundary. Never replace this process with Delete Directory, Save All or
   user-global clearing. These are editor cleanup checks, not Fortnite
   behavior/performance.

A final receipt should show every exact asset path absent and each hash-bound
reconciliation; say which pass deleted what, and do not claim one operation
deleted everything. A disposable physics package may be saved and then deleted;
the proof feature should save no production changes. Source-scope tests of the
ownership guards (nearby or foreign names, roles, versions, stale hashes) do not
execute native GC or deletion.

**API discovery is separate evidence:** installed `FortPhysicsAssetEditorSubsystem`
exposed body creation, weighted bone vertices and primitive authoring/inspection;
generic `PhysicsAsset.skeletal_body_setups` was not reflected. Shapes created in
failed PhysicsAsset experiments on a placed prop still produced zero query hits.
Discover actual available APIs; neither the existence of authoring methods nor
failed queries establishes universal runtime support or a performance budget.
A production installation uses a separate recipe and is not a disposable target.

## Distinguish built-in adapters from custom Verse instances

**[general]** Built-in device editables such as `button_device` and
`cinematic_sequence_device` returned typed adapter objects through
`DeviceTools.GetDeviceProperties`. Preflight each adapter with ObjectTools:
its `savedActor` schema must identify `/Script/Engine.Actor`. Set `savedActor`
to the desired actor reference using `ObjectTools.set_properties`, then read it
back exactly. Replacing the entire editable with a Blueprint actor reference
was rejected. Do not discard a working adapter to work around this.

An obsolete built-in binding can be cleared by setting `savedActor` to JSON
`null`, with readback. Preserve field names during a controller migration so
existing saved devices retain their compatible schema. Clearing obsolete or
default slots this way preserved the active references.

Custom Verse-controller editables need their contained Verse instance, not the
actor and not a built-in `savedActor` adapter. In the observed island, removing
the final property component from an existing controller adapter path located
that containing instance. `DeviceTools.SetDeviceProperty` accepted and read back
the resulting reference, and the actual references subsequently passed server QA.
Validate the containing object and expected class in a new project. Do not
hardcode a generated instance suffix or apply this path rule to arbitrary objects.

Ordinary Verse editable values use DeviceTools. Native Button blueprints used
ObjectTools; DeviceTools rejected them as invalid ScriptDevices. Discover the
schema rather than treating every Fortnite device as the same object type.

## Compact switches without shrinking interaction targets

**[general]** The native Button exposed `buttonMesh`, a StaticMeshComponent.
Changing its `relativeScale3D` to 0.10 reduced its visible mesh while retaining
actor scale 1 and `interactionRadius` 1. Every compacted control had an
independent native readback. A visible mesh about 45.94 cm tall became about
4.59 cm. Other components expanded actor bounds to 128 cm; those bounds did not
measure the visible switch.

**[general] Button component reconstruction (42.30):** a nested MCP write such as
`{"relativeScale3D":{"x":0.1,"y":0.1,"z":0.1}}` returned true but changed
only the first supplied axis on the native Fortnite Button's `ButtonMesh`.
Fresh unequal-axis fixtures reproduced this; changing JSON member order changed
which axis survived. Generic StaticMeshActor components passed the same writes.
This is not a general JSON-vector serialization failure.

The installed ObjectTools wrapper forwards the JSON directly to native
`ToolsetLibrary.set_object_properties`. Calling that native method directly
reproduced the Button failure. Its original mesh became `TRASH_StaticMeshComponent`
and a different component occupied the same `ButtonMesh` path. Component
reconstruction during nested member editing is observed; subsequent writes
targeting the obsolete component is the likely mechanism, not inspected C++ proof.

For this Button property, pass one whole-vector text value through MCP:
`{"relativeScale3D":"(X=0.1,Y=0.1,Z=0.1)"}`. Independent MCP and native readback
confirmed all axes, including when their initial values were 1, 2 and 3. Native
`mesh.set_relative_scale3d(unreal.Vector(.1,.1,.1))` also worked; read it with
`mesh.get_editor_property('relative_scale3d')`. This build has no
`get_relative_scale3d()` getter. Resolve the component again after reflected
property edits, since its identity may change even when its path stays the same.
Do not patch vendor files or generalize this workaround to untested struct types.

Always verify every axis on the current component. An already-uniform .1/.1/.1
fixture masked the nested-write defect and cannot establish a working setter.
The disposable fixtures were transient, cleaned up with selection restored,
and never saved or pushed. These editor tests do not establish physical reach.

Logical radius readback is not a physical reach test. Confirm the real focus
prompt, activation and camera view in Fortnite before claiming usability.
Evaluate framing at interaction approaches, with actual prop dimensions;
lowering a large placed prop alone can still leave most of it outside the frame.

The friendly native properties included `visibleDuringGame`,
`enabledAtGameStart`, `interactionRadius` and `buttonMesh`. `bIsEnabled` was
readable but **read-only on the observed instances**. A multi-property write
partly succeeded before failing on that field. Read back before retrying.
Retire a button by clearing its controller binding, setting supported startup
enablement and visibility false, and placing the obsolete prop out of view.
Verify its runtime inactivity; an underfloor transform alone is insufficient.

## Bounded editor screenshots when viewport capture stalls

**[general]** Viewport screenshot tasks stalled after two images. Smaller batches
and uncovering the editor did not establish a cause. A temporary native
`SceneCapture2D` with `SceneCaptureComponent2D` and a transient RGBA8 render
target successfully exported 16 views at 1920 x 1080.

The working configuration used `capture_every_frame=False`,
`capture_on_movement=False`, `always_persist_rendering_state=True`, FOV 80,
`SCS_FINAL_COLOR_LDR` and `RenderingLibrary.create_render_target2d`. A bounded
Slate post-tick callback positioned the camera, allowed editor frames to settle,
called `capture_scene()` and `RenderingLibrary.export_render_target`.
Use named `unreal.Rotator(pitch=..., yaw=..., roll=...)` arguments.

Preflight for an existing temporary actor before starting. On completion or any
failure, independently attempt all cleanup: detach the texture target, release
the render target, destroy the capture actor and unregister the callback.
Collect cleanup failures rather than allowing the first failure to skip the
remaining actions. Inspect the image files and require a receipt confirming
actor removal. Do not save or push while temporary capture actors exist.

These images established geometry and editor framing. Exposure differed from
the main viewport. They did not prove color fidelity, game camera framing or
interaction. Do not label an editor SceneCapture image as a Fortnite screenshot.

## Actual client capture across Windows sessions

**[general]** The agent shell ran in Windows session 0 while UEFN and Fortnite
ran in session 1. Shell-side `EnumWindows` found no game windows. Running a
read-only ctypes inspection through native editor Python found the sole window
belonging to `FortniteClient-Win64-Shipping.exe` in the editor's session.

Record the actual client rectangle, foreground status and method. Foreground
screen `BitBlt` produced a readable game image. Background `PrintWindow` may
return success with blank DirectX content; inspect the PNG. Do not assume an
earlier 1920 x 1080 sign-in screen implies that a later 853 x 640 gameplay window
meets a full-resolution readability requirement. Capture does not require
focusing another window or sending input.

## Runtime QA without leaking diagnostics into visits

**[general]** Automatic startup advanced the kinetic and animated timelines. A
second private probe invoked production controller methods and passed its
expected server results: cycle wrapping, held-frame pause/resume, reset and
quiet behavior. It did not press physical devices or verify rendered poses,
completed-clip reset, multiplayer or performance.

Use one authoritative controller and timeline. Pause legacy Animated Mesh
players and companions before starting the shared cinematic timeline. Match
loop, everyone/always-relevant and completion settings to the intended prop.
For timed frame animation, reset its next-frame clock on held-frame resume;
do not catch up all elapsed pause time or restart the animation at frame zero.
Shared quiet handlers must preserve a static station's chosen state and avoid
advertising motion controls that station does not have.

A private QA device defaults disabled. Before a normal push, verify **every
installed** QA device disabled and explicitly saved, no pending migration/save
receipt, and no temporary capture actor. Checking only the original probe missed
a newer probe during review. Record fresh log offsets so old results cannot pass
a new run. Keep one pending push receipt and reconcile uncertain operations;
a completed content push and Connected/Running state are separate from a
passing physical interaction or capacity test.
