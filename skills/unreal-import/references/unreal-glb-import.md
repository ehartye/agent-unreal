# GLB meshes (agent-meshes) in Unreal

Verified on Unreal 5.7.3 through Interchange, import only:

- A GLB whose 48 mesh parts each had their own skin, all listing the same 19 joint nodes, imported
  as one SkeletalMesh with one Skeleton, 19 bones, 2 animation sequences, 48 material instances and
  no errors.
- Clips `walk` and `trot` from `fox.glb` arrived named `foxwalk` and `foxtrot`. Look clips up by
  suffix, or list them after import.
- Check an Unreal import with agent-meshes `verify-unreal` (see its `mesh-build` skill). It needs
  an installed engine (`AGENT_MESHES_UNREAL`, or a launcher install) and fails with
  `UNREAL_NOT_FOUND` otherwise. Say so instead of claiming Unreal support.

Documented by agent-meshes, not re-verified here:

- In a GLB that has a skin, Interchange silently drops mesh nodes with no skin, no morphs and no
  skin joint above them. Bind every mesh to the skin.
- Unreal keeps morph target names only if every name is unique across all meshes in the file.
  Otherwise all are renamed `<file>_mesh_<m>_<i>_MorphTarget`. Put all morph-bearing parts in one
  mesh, one primitive per material.
- Unreal drops a morph that moves no vertex used by a triangle.
- Interchange builds one SkeletalMesh and Skeleton per skin, unless the skins share joint nodes. (On 5.8.3 the
  default stack split a GLB whose skins share joints into one mesh per skin anyway; see [Unreal import notes](unreal-import-notes.md).)

## Emissive glow

glTF carries a glow as `emissiveFactor`, with an optional `KHR_materials_emissive_strength` multiplier. Tested on Unreal 5.8.2 with one model of four boxes (no glow, colour only, strength 4, strength 0.5) captured in a lit scene:

- [tested] Imported with the importer's explicit pipeline (`importMaterials` on, its default), each glTF material becomes a `Material` asset. The emissive colour is a linear constant and a strength other than 1 is a second constant wired into the same input. The captures glowed, brighter at strength 4 and darker at 0.5 (red channel of the centre pixel about 1.21 for colour only, 5.59 at strength 4, 0.55 at strength 0.5; the lit surface adds its own light, so the ratios are near 4 and 0.5, not exact).
- [tested] Imported with Interchange's default glTF pipeline, each material is an instance of `MI_Default_Opaque` with the colour in the `EmissiveFactor` vector parameter. A strength other than 1 is stored as the scalar `EmissiveStrength`, and the render ignores it unless the instance's `bHasEmissiveTexture` static switch is on, which the import leaves off when there is no emissive texture. With the switch on, strength 4 rendered brighter and 0.5 darker. Turn the switch on in the instance, or assign a project material that sets the brightness.
- [general] Check which route produced an asset by its class: `Material` from the importer, `MaterialInstanceConstant` from the default pipeline.
- [general] Not verified: whether the switch stays on in a saved instance after a reimport.

Whether the geometry should be authored in Blender or generated in Unreal is decided by `mesh-tool-selection` in
agent-meshes; the Nanite, collision and LOD settings of the imported StaticMesh are in
[import policy and read-back](unreal-import-policy.md).
