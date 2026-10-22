# UEFN native exterior materials and save scope

Read for native material pin failures, decorative sky collision, derived
LevelBounds changes or an extra dirty ActorFolder package. Observed in one
consuming UEFN project on UEFN 42.30; not reproduced in this repo. These are
local observations, not a universal engine contract. Use the authoring
reference for connection setup and exact-world guards.

## Choose the work and the evidence

| Operation | Time | Risk | Complexity | Architectural fit | Maintenance |
|---|---|---|---|---|---|
| Probe material pin metadata | One transient graph | Guessing names or retaining failed assets | Small native script | Installed API is authoritative | Record names and connection booleans |
| Add a source-owned sky/exterior | Build, import and scoped save | Entrances, collision, large bounds or cost | Separate mesh groups and opaque materials | Preserve existing levels and actor identities | Hash source, FBX and protected native files |
| Save derived bounds/new folder | Inspect after the actor save | Unrelated dirty packages | Exact identities and ownership evidence | Explicit additions to save scope | Preserve original dirty set; no Save All |

A portable verification record for an exterior like this lists the static mesh
actors, mesh/material assets and actor/folder package saves, the protected
original actor checks and saved package files, and the few intentional file
changes (retained default grids and automatically updated LevelBounds).

## Inspect native pin names before constructing the real material

**[general]** `MaterialEditingLibrary.get_material_expression_input_names(node)`
returned an unnamed `None` input for ComponentMask, and `None`, `Min`, `Max` for
Clamp. WorldPosition has no inputs; Divide and Add expose `A`, `B`; Lerp exposes
`A`, `B`, `Alpha`. Connecting WorldPosition to ComponentMask with the empty input
string returned true; using `Input` returned false. The actual sky graph also
connected Add to Clamp with the empty input string and compiled/saved. Do not
turn printed `None` into the literal pin name `"None"`.

Use a transient material to check unfamiliar nodes before allocating native
destination assets. Inspect output names too when uncertain. Require each
`connect_material_expressions` and `connect_material_property` boolean result;
a plausible-looking graph or no exception does not prove every edge connected.

This reduced example uses calls exercised by the probe; it is not a separately
tested reusable helper:

```python
import unreal

def probe_mask_pin(expected_level):
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    if world.get_path_name().split('.')[0] != expected_level:
        raise RuntimeError("Wrong island")
    lib = unreal.MaterialEditingLibrary
    material = unreal.new_object(unreal.Material)
    position = lib.create_material_expression(material, unreal.MaterialExpressionWorldPosition)
    mask = lib.create_material_expression(material, unreal.MaterialExpressionComponentMask)
    mask.set_editor_property('b', True)
    names = [str(name) for name in lib.get_material_expression_input_names(mask)]
    connected = lib.connect_material_expressions(position, '', mask, '')
    if not connected:
        raise RuntimeError("Installed pin connection differs; inspect rather than guess")
    return {"inputNames": names, "connected": connected}
```

[general] The original probe tested both spellings. A failed real-material pass
left newly created materials; the project reconciled their exact identities and
resumed only that known phase. A later material-map bug stopped on the first
imported mesh. The next continuation checked its exact imported filename and
imported only absent remaining meshes. Neither generically replayed creation or
reimported that mesh. Project-specific continuation scripts are not a reusable
retry policy: changed identities, source bytes or phase require new inspection.

## Recheck collision after lighting/property edits

**[general]** The sky was set to NoCollision, then shadow and distance-field
lighting properties were edited. Independent readback later returned QueryOnly.
The internal cause was not inspected. Setting the NoCollision profile and mode
after those edits, then disabling the exact owned actor's collision, produced
the required readback and passed later queries.

The decorative-sky calls were:

```python
component.set_editor_property('cast_shadow', False)
component.set_editor_property('affect_distance_field_lighting', False)
component.set_collision_profile_name('NoCollision')
component.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
actor.set_actor_enable_collision(False)
if component.get_collision_enabled() != unreal.CollisionEnabled.NO_COLLISION:
    raise RuntimeError("Decorative sky collision differs")
```

These assume an already verified exact owned sky actor/component. Do not disable
a floor, a prop cover or an arbitrary similarly named actor. Read effective mode,
actor collision flag and profile after the final property write and after saving.
Disabling actor collision can make the effective component mode NoCollision;
that mode alone does not establish that the profile itself was repaired.

[general] The foundation retained fitted box strips with QueryAndPhysics; roof
ribbons, decorative forms and sky had no walkable collision. Floor queries hit
actual StaticMeshActors beneath arrival and every start. A visibility trace also
hit an existing billboard `ToolPickingBox` inside the lobby; that editor picking
component was distinguished from the threshold and left unchanged. Identify hit
actor/component and numeric impact point, not just an allocated HitResult string.

## Treat LevelBounds as an explicit derived change

**[general]** A 450 m opaque sky sphere automatically changed existing
LevelBounds center/scale. The project verified exact identity,
`auto_update_bounds` and numeric bounds against the sky envelope, then explicitly
included that package in its save receipt and protected-file exceptions. Other
environment identities/transforms stayed unchanged.

Do not dismiss any dirty LevelBounds as harmless. Verify the automatic change
against the geometry and project constraints. Fixed bounds, unexplained movement,
out-of-island geometry or unrelated changes need inspection before saving. Low
sky vertex counts do not establish streaming, memory or frame-time cost.

[general] The default grid actor paths were inventoried before mutation. Their mesh
identities/transforms remained intact while actor/component rendering and
collision were disabled. A label or prefix alone is not ownership. Verify
replacement floor/spawn support before saving those changes.

## Save a new folder only after identifying it

[general] The first scoped save wrote the owned assets and identified actor
packages. Dirty readback still contained the original unsaved external
objects **plus one new ActorFolder package**. Saving succeeded; the dirty-set
comparison correctly stopped the script. Do not replay that successful save or
broaden it to Save All.

The folder follow-up required that exact saved phase, no previous folder-save
attempt, exactly one identified new ActorFolder object/package and an otherwise
unchanged dirty set. `ObjectIterator(unreal.Object)` identified its class/package.
Folder `label` and actor `folder_guid` property reads failed; actors'
`get_folder_path()` returned the folder path.

Project-specific evidence matched the folder's GUID suffix to one occurrence of
its bytes in each newly saved owned actor file, after checking current
folder paths. Observed serialization was four little-endian 32-bit words from
`ActorFolder_UID_AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD`. This is a narrow observation
about known files, not a general package parser, reflected folder API or
sufficient ownership test for arbitrary assets. Byte presence alone is not
permission to save an unknown folder.

The follow-up recorded the actor hashes, wrote a pending folder-save
receipt, saved only that exact package and checked the dirty set returned to the
original. Preserve unrelated dirty packages. A changed GUID, file hash,
folder path, object identity or dirty set invalidates reconciliation: inspect
again rather than guessing, overwriting receipts or trusting the save boolean alone.

## Keep source reproducibility and runtime acceptance separate

[general] Native LOD0 vertex counts ranged from about one thousand to about eleven
thousand. Ground point queries and opening queries passed; bounded offscreen
captures finished with fixture removal and selection restoration. These establish
their measured import/editor scope. They do not certify a current Fortnite cook,
capsule traversal, falling/respawn, gameplay collision, runtime exposure,
performance or multiplayer capacity.

The build read a font from a sibling web project. The packager matched those
bytes to a licensed copy kept in the consuming project; saved native lettering
needs no sibling to display. Do not call that source build self-contained. A later
path cleanup must retain original import provenance and verify equivalent
geometry, not silently rewrite old source/FBX hashes. Hash inputs used LF
attributes and were checked against committed bytes and the merged Windows checkout.

Runtime evidence at that revision was a Fortnite Sleep Mode window and an earlier
terminal session. No launch/input was sent for exterior capture. Reconcile that
session and obtain a current connected client before claiming gameplay success.
Source publication does not activate an installed plugin cache or establish a
deployed, cooked Fortnite acceptance run.
