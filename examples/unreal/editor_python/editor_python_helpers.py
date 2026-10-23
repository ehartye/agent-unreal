"""Helpers for building a whole map, its materials and meshes from editor Python (Unreal 5.8). Import them from a script:

  import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
  import editor_python_helpers as H

Each helper was run by the scripts beside this file; README.md lists the commands and what they showed.
  soft_set            set_editor_property that records a warning instead of raising
  probe               list the attribute names of an object that contain a fragment
  run_stages          run a generator whose `yield` waits one editor tick, so tick-driven work reads top to bottom
  wait_until          a generator for `yield from`: wait ticks until a condition holds
  recreate_map        create a level at a path that may already exist on disk
  triangle_count      the number of triangles in a Geometry Script DynamicMesh (0 for an empty mesh)
  look_at_rotation    the Rotator that faces from one point to another (MathLibrary.make_rot_from_x)
  place_above_ground  a location a height above the first surface under an x, y (line trace down)
  make_instancer      a Blueprint actor class that holds an instanced static mesh component (Python cannot add components to a level actor)
  allow_instancing    set used_with_instanced_static_meshes on a list of materials
"""
import os
import traceback

import unreal


def soft_set(obj, name, value, warnings):
    """Set an editor property; on a wrong name or value append a warning line instead of raising. Returns True when set."""
    try:
        obj.set_editor_property(name, value)
        return True
    except Exception as exc:
        warnings.append("%s.%s: %s" % (type(obj).__name__, name, str(exc).splitlines()[0][:200]))
        return False


def probe(obj, *fragments):
    """Names from dir(obj) that contain any fragment. dir() lists the script-exposed attributes only: an EditAnywhere property such
    as MaterialExpressionCustom.Code is not listed but set_editor_property('code', ...) reaches it (name it from the header)."""
    return sorted(n for n in dir(obj) if not n.startswith("_") and any(f in n for f in fragments))


def run_stages(stages, on_done=None):
    """Drive `stages()`, a generator function, from Slate post-tick callbacks. `yield` waits one tick, `yield n` waits n ticks.
    A script started with -ExecCmds="py x.py" keeps the editor alive while the stages run; call on_done(error_or_None) at the end."""
    gen, state = stages(), {"skip": 0, "busy": False, "reentered": 0}

    def finish(error):
        unreal.unregister_slate_post_tick_callback(state["handle"])
        if on_done:
            on_done(error)

    def tick(_delta):
        if state["busy"]:   # Slate ticks again inside a long editor call (compile, asset creation); never re-enter the generator
            state["reentered"] += 1
            return
        if state["skip"] > 0:
            state["skip"] -= 1
            return
        state["busy"] = True
        try:
            state["skip"] = max(int(next(gen) or 1) - 1, 0)
        except StopIteration:
            finish(None)
        except Exception:
            unreal.log_error(traceback.format_exc())
            finish(traceback.format_exc())
        finally:
            state["busy"] = False

    state["handle"] = unreal.register_slate_post_tick_callback(tick)
    return state


def wait_until(predicate, max_ticks=600):
    """Use as `ready = yield from wait_until(lambda: ..., 300)`; returns False when max_ticks passed first."""
    for _ in range(max_ticks):
        if predicate():
            return True
        yield
    return predicate()


def recreate_map(path, neutral="/Engine/Maps/Entry"):
    """Create an empty level at a /Game `path` even if a map is already on disk there. Returns True when the level was created.
    delete_asset only drops a loaded level and keeps the .umap, and new_level then fails with 'An asset already exists at this
    location'. So: leave the level, delete, remove the file, rescan the folder, create. Never save while `neutral` is the open map."""
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    eal = unreal.get_editor_subsystem(unreal.EditorAssetSubsystem)
    disk = unreal.SystemLibrary.get_project_directory() + "Content" + path[len("/Game"):] + ".umap"
    if eal.does_asset_exist(path) or os.path.exists(disk):
        les.load_level(neutral)
        eal.delete_asset(path)
        if os.path.exists(disk):
            os.remove(disk)
        unreal.AssetRegistryHelpers.get_asset_registry().scan_paths_synchronous([os.path.dirname(disk)], True)
    return bool(les.new_level(path))


def triangle_count(mesh):
    """Triangles in a DynamicMesh. get_num_triangle_i_ds counts triangle IDs, which stays at the old number after a cut removed
    every triangle, so count the ID list; check this is above 0 before creating a Static Mesh asset from the mesh."""
    ids = unreal.GeometryScript_MeshQueries.get_all_triangle_i_ds(mesh)[1]
    return unreal.GeometryScript_List.get_index_list_length(ids)


def look_at_rotation(start, target):
    """Rotator whose forward (+X) axis points from start to target. unreal.Vector has no rotation(); make_rot_from_x takes the direction."""
    return unreal.MathLibrary.make_rot_from_x(unreal.Vector(target.x - start.x, target.y - start.y, target.z - start.z))


def place_above_ground(world, x, y, height, top=500000.0, depth=500000.0):
    """Location `height` cm above the first blocking surface under (x, y), found by a line trace from `top` down to `-depth`.
    Returns None when nothing blocks (for example terrain that is not loaded yet)."""
    result = unreal.SystemLibrary.line_trace_single(    # Python returns the HitResult, or None when nothing was hit
        world, unreal.Vector(x, y, top), unreal.Vector(x, y, -depth), unreal.TraceTypeQuery.TRACE_TYPE_QUERY1,
        False, [], unreal.DrawDebugTrace.NONE, True)
    if result is None:
        return None
    point = result.to_dict()["impact_point"]
    return unreal.Vector(point.x, point.y, point.z + height)


def make_instancer(path):
    """Blueprint actor class at `path` with one InstancedStaticMeshComponent. Spawn it with spawn_actor_from_class, then call
    set_static_mesh, set_material and add_instance on actor.get_component_by_class(unreal.InstancedStaticMeshComponent)."""
    if not unreal.EditorAssetLibrary.does_asset_exist(path):
        factory = unreal.BlueprintFactory()
        factory.set_editor_property("parent_class", unreal.Actor)
        folder, name = path.rsplit("/", 1)
        blueprint = unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, folder, unreal.Blueprint, factory)
        subsystem = unreal.get_engine_subsystem(unreal.SubobjectDataSubsystem)
        root = subsystem.k2_gather_subobject_data_for_blueprint(blueprint)[0]
        params = unreal.AddNewSubobjectParams(parent_handle=root, new_class=unreal.InstancedStaticMeshComponent, blueprint_context=blueprint)
        subsystem.add_new_subobject(params)
        unreal.EditorAssetLibrary.save_loaded_asset(blueprint)
    return unreal.EditorAssetLibrary.load_blueprint_class(path)


def allow_instancing(materials):
    """Set used_with_instanced_static_meshes on every material (asset paths or loaded materials) and recompile it. Instanced static
    meshes need the flag; a Python-made material has it off. Returns the paths changed."""
    changed = []
    for m in materials:
        mat = unreal.EditorAssetLibrary.load_asset(m) if isinstance(m, str) else m
        if not mat.get_editor_property("used_with_instanced_static_meshes"):
            mat.set_editor_property("used_with_instanced_static_meshes", True)
            unreal.MaterialEditingLibrary.recompile_material(mat)
            changed.append(mat.get_path_name())
    return changed
