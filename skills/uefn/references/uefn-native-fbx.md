# Native UEFN FBX: coordinates and collision

Read this when an imported building is mirrored, lettering reverses, UCX hulls
are missing or circular platforms do not match their collision. Observed in one
consuming UEFN project on an earlier UEFN build; not reproduced in this repo. Re-discover
native APIs after upgrades.

## Choose a bounded repair

| Repair | Time | Risk | Complexity | Architectural fit | Maintenance |
|---|---|---|---|---|---|
| Calibrate one native FBX before placement | Short probe | Wrong basis or centimetre scale | Low | Target coordinates are authoritative | Record the measured basis |
| Reuse saved architecture; import a new scoped asset when needed | One explicit conversion | Dependencies and validation | Moderate | Preserve placed props/devices | Stable labels and source hashes |
| Add owned simple collision | One mesh preflight and traces | Incorrect space or shape | Moderate | Physics matches the visible surface | Read back before rewriting |
| Reflect every scene actor | Broad edits | Reversed glyphs and broken bindings | High | Changes unrelated content | Difficult to maintain |

The consuming project corrected only its architecture and retained prop and
device positions. A whole-scene conversion is unnecessary for this bounded repair.

## Measure this importer's basis

[general] This native FBX route mapped Blender `(x,y,z)` to `(x,-y,z)` and
metres to native centimetres. Actor scale `(1,-1,1)` restored the building's
planned layout. An earlier MCP-imported interior used a different basis;
reflecting its actor aligned platforms but reversed lettering. A fresh native
interior mesh normalized that scenery actor without moving placed props.

Do not copy the reflection to another importer, asset or project without a
calibration. Check distinguishable positive-axis landmarks, native bounds,
world positions and text from the intended viewing side. Verify actual mesh
dimensions before adding scale 100 to an FBX already imported in centimetres.
Keep source-to-mesh and mesh-to-world transforms separate; collision is authored
in mesh space, not blindly copied from world coordinates.

Use named rotation arguments. Positional `Rotator` arguments did not match the
assumed order in the observed script; this call avoids that ambiguity:

```python
import unreal

rotation = unreal.Rotator(pitch=0.0, yaw=90.0, roll=0.0)
```

The resulting transform still needs readback in the target; syntactically valid
rotation is not visual proof.

## Separate glyph correction from room placement

[general] The native-only FBX export reflected local X on named lettering
meshes before joining the architecture. Portable GLB lettering was retained.
Two-sided imported material-instance overrides completed the reflected extruded
glyph faces. The narrow material names were shared with architecture, so those
surfaces also became two-sided; runtime cost was not measured.

Apply an importer-specific correction only to identified glyph geometry. Inspect
readability and winding in a native image; do not repair source ordering or
identity errors by swapping artist colors. Prefer separately scoped lettering
materials when a shared surface override would affect the room. Two-sided
rendering does not make text opaque from behind; signage backing remains a
separate requirement.

## Read actual simple collision after import

[general] Exported `UCX_<mesh>_<index>` box hulls were absent from both shell
and roof imports despite `one_convex_hull_per_ucx=True`. The native import used
`FbxImportUI`, static mesh mode, combined meshes and auto collision disabled.
These options describe the observed route; they do not guarantee UCX handling.

Read `mesh.body_setup.agg_geom` rather than accepting an import success message.
Inspect counts and actual shapes. The following read-only helper uses property
calls exercised in the observed project; the combined helper was syntax-checked,
not run. Call it only after verifying the loaded level and exact owned mesh identity.

```python
import unreal

def describe_simple_collision(mesh):
    if not isinstance(mesh, unreal.StaticMesh):
        raise RuntimeError("Expected the preflighted static mesh")
    body = mesh.get_editor_property('body_setup')
    if body is None:
        raise RuntimeError("Missing BodySetup; inspect the imported asset")
    geometry = body.get_editor_property('agg_geom')
    counts = {key: len(geometry.get_editor_property(key)) for key in
              ('box_elems', 'convex_elems', 'sphere_elems', 'sphyl_elems')}
    boxes = []
    for box in geometry.get_editor_property('box_elems'):
        center = box.get_editor_property('center')
        boxes.append({'centerCm': [center.x, center.y, center.z],
                      'dimensionsCm': [box.get_editor_property(axis) for axis in ('x', 'y', 'z')]})
    return {'counts': counts, 'boxes': boxes}
```

For an owned rectangular shell, native `unreal.KBoxElem` shapes replaced the
missing hulls. Set `center`, full `x/y/z` dimensions and `collision_enabled` to
`QUERY_AND_PHYSICS`; assign `agg_geom.box_elems` and then BodySetup's `agg_geom`.
The source reflected collision-center Y and multiplied metres by 100
before actor reflection restored world coordinates. Box dimensions are full
dimensions, not half-extents. Both the component and hulls enabled query/physics.

Compare existing shape coordinates and counts before writing. Snapshot the
owned BodySetup; do not erase unrelated sphere/capsule/convex shapes or replace
collision on a shared asset without checking its users. The fully owned
shell cleared unwanted convex elements, assigned the boxes, and refreshed each
component with `set_static_mesh(None)` followed by `set_static_mesh(mesh)`.
Read back again, save explicitly and run physics checks. A count alone cannot
show that boxes are in the right place or leave doorways open.

Circular decks, editor physics checks and reimport: [FBX decks and verification](uefn-native-fbx-verification.md).

## Skeletal import in a scratch project

- [tested] `SkeletalMeshTools.import_file` with materials, textures and animations on gave one skeletal mesh, one skeleton, both clips (1.2 s / 36 frames and 0.8 s / 24 frames at 30 fps, the asset name as a prefix) and one material per FBX material. The response lists only the mesh; read the destination folder for the rest.
- [tested] Blender's glTF import adds a 42-vertex Icosphere (its bone-display shape) to a rigged model, and the exported FBX carried it as a second mesh that UEFN imported as an extra skeletal mesh. `examples/uefn/glb_to_fbx.py` now exports only meshes skinned by or parented to the armature and prints what it dropped. The converted fox imported on 2026-10-29 as one skeletal mesh, one skeleton, two animation sequences and eight materials, read back by class from the destination folder.
- [tested] Vertex colours do not survive the import: a model coloured by vertex colours imported with white materials, and a material that reads vertex colours also rendered white. The native importer option that replaces vertex colours split the model into several meshes. Colour a UEFN character with per-material colours or a baked texture.
