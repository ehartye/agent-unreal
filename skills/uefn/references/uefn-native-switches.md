# UEFN native Button switches

Read this when a native Fortnite Button must be oriented, compacted or retired. Observed in one consuming UEFN project on an earlier UEFN build; not reproduced in this repo. Every claim is labelled `[general]` for that reason. Inspect the installed schemas after upgrades; these observations are not an API contract for every project. Use the [authoring reference](uefn-authoring.md) for connection setup.

## Name rotation axes and check the visible component

**[general] Observed on an earlier UEFN build:** `unreal.Rotator(0, 90, 0)` produced
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

## Compact switches without shrinking interaction targets

**[general]** The native Button exposed `buttonMesh`, a StaticMeshComponent.
Changing its `relativeScale3D` to 0.10 reduced its visible mesh while retaining
actor scale 1 and `interactionRadius` 1. Every compacted control had an
independent native readback. A visible mesh about 45.94 cm tall became about
4.59 cm. Other components expanded actor bounds to 128 cm; those bounds did not
measure the visible switch.

**[general] Button component reconstruction (earlier UEFN build):** a nested MCP write such as
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
