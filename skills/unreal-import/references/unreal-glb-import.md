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

Whether the geometry should be authored in Blender or generated in Unreal is decided by `mesh-tool-selection` in
agent-meshes; the Nanite, collision and LOD settings of the imported StaticMesh are in
[import policy and read-back](unreal-import-policy.md).
