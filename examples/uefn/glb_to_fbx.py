"""Convert a rigged GLB to FBX for UEFN, whose skeletal-mesh MCP tool only accepts .fbx and .obj.

  blender --background --python glb_to_fbx.py -- <in.glb> <out.fbx>

Imports the GLB with Blender's glTF importer (the 48 skins that share 19 joints become one armature with 48 meshes),
then exports every action as a baked animation, without the extra leaf bones Blender adds by default.
"""
import sys

import bpy

src, dst = sys.argv[sys.argv.index("--") + 1:][:2]

bpy.ops.wm.read_factory_settings(use_empty=True)
# Unreal's importer drops a clip whose length is not a whole number of frames ("Animation length 0.8 is not compatible with
# import frame-rate 24 fps"), and Blender's default is 24 fps. 30 fps makes 0.8 s and 1.2 s exact (24 and 36 frames).
# Set it BEFORE the glTF import: the importer converts seconds to frames at the scene rate, so changing it afterwards
# keeps the old frame numbers and shortens every clip (0.8 s became 0.64 s).
bpy.context.scene.render.fps = 30
bpy.context.scene.render.fps_base = 1.0
bpy.ops.import_scene.gltf(filepath=src)

armatures = [o for o in bpy.data.objects if o.type == "ARMATURE"]
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
actions = [a.name for a in bpy.data.actions]
print("AGENT_ENGINE_CONVERT armatures=%d meshes=%d bones=%s actions=%s" % (
    len(armatures), len(meshes), [len(a.data.bones) for a in armatures], actions))

bpy.ops.export_scene.fbx(
    filepath=dst,
    use_selection=False,
    object_types={"ARMATURE", "MESH"},
    add_leaf_bones=False,
    bake_anim=True,
    bake_anim_use_all_actions=True,
    bake_anim_use_nla_strips=False,
    bake_anim_force_startend_keying=True,
    path_mode="COPY",
    embed_textures=False,
)
print("AGENT_ENGINE_CONVERT wrote", dst)
