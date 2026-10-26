"""Probe how a skeletal mesh's material slots can be set from Python and from a C++ editor-module function (Unreal 5.8).

  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound
      -notraceserver -abslog=<log path>
  (with SM_RUN=tick it runs inside an editor instead: UnrealEditor.exe Project.uproject -ExecCmds="py <this file>" ...)
Environment: SM_REPORT (JSON report path), SM_MODE (author or read), SM_RUN (direct, the default, or tick).
The SkeletalMaterialsBridge module must be built first (skeletal_materials.mjs does that).

Mode author (one process):
  materials  two Materials made from nodes (a Constant3Vector into Base Color), recompiled and saved; compile errors and shader
             statistics are recorded, not judged (a content stage that runs without rendering is an open question, see the README)
  meshes     five copies of /Engine/EngineMeshes/SkeletalCube (one slot each), saved before anything is done to them:
             SK_Element      the element edit: slots = mesh.get_editor_property("materials"); slots[0].material_interface = red
             SK_Assign       the assign-back route: new SkeletalMaterial structs set with set_editor_property("materials", ...), twice,
                             each followed by a default save (only if dirty); no forced save
             SK_AssignForced the same assign-back, then a forced save (only_if_is_dirty False)
             SK_Single       the C++ function on one slot, then a default save
             SK_Two          padded to two slots from Python, the C++ function refused with three materials, then called with two,
                             then a default save
  Every file is stat-ed before and after each save: a default save that writes nothing leaves the file unchanged.
Mode read (a fresh process, so nothing is cached):
  registry   each mesh's hidden asset-registry "Materials" tag, read from disk before any mesh is loaded
  slots      each mesh loaded and its slots read
Nothing here renders; a failure in one step is recorded and the next step still runs.
"""
import json
import os
import time
import traceback

import unreal

REPORT = os.environ.get("SM_REPORT", "skeletal-materials.json").replace("\\", "/")
MODE = os.environ.get("SM_MODE", "author")
RUN = os.environ.get("SM_RUN", "direct")
FOLDER = "/Game/Skel"
SOURCE = "/Engine/EngineMeshes/SkeletalCube"
MESHES = ["SK_Element", "SK_Assign", "SK_AssignForced", "SK_Single", "SK_Two"]
PROJECT = unreal.SystemLibrary.get_project_directory().replace("\\", "/")
CONTENT = PROJECT.rstrip("/") + "/Content/Skel"
report = {"mode": MODE, "engine": unreal.SystemLibrary.get_engine_version(), "steps": {}, "errors": []}
eal = unreal.EditorAssetLibrary   # source: Engine/Plugins/Editor/EditorScriptingUtilities/.../EditorAssetLibrary.h


def clean(text):
    """Keep an error text whole, but never write the project folder into a report."""
    return str(text).replace("\\", "/").replace(PROJECT.rstrip("/"), "<project>")


def step(name, fn):
    try:
        report["steps"][name] = fn()
    except Exception as exc:
        report["steps"][name] = None
        report["errors"].append({"step": name, "error": clean(repr(exc))[:500], "trace": clean(traceback.format_exc())[-900:]})


def path_of(obj):
    return obj.get_path_name() if obj else ""


def describe(mesh):
    """The slots as the Python read route sees them. source: SkeletalMesh.h Materials (BlueprintGetter GetMaterials)."""
    rows = []
    for slot in mesh.get_editor_property("materials"):
        row = {"name": str(slot.material_slot_name), "material": path_of(slot.material_interface)}
        try:   # source: SkinnedAssetCommon.h FSkeletalMaterial::ImportedMaterialSlotName, UPROPERTY(VisibleAnywhere), editor only:
            # not BlueprintReadOnly, so the attribute form is absent on 5.8.2 (first run); get_editor_property reads edit-visible properties.
            row["imported_name"] = str(slot.get_editor_property("imported_material_slot_name"))
        except Exception as exc:
            row["imported_name"] = "error: " + clean(exc)[:120]
        rows.append(row)
    return rows


def stat(name):
    """[mtime_ns, size] of the saved .uasset, or None."""
    try:
        info = os.stat(f"{CONTENT}/{name}.uasset")
        return [info.st_mtime_ns, info.st_size]
    except OSError:
        return None


def is_dirty(name):
    """True when the package of /Game/Skel/<name> is in the editor's dirty content packages."""
    try:   # source: Engine/Source/Editor/UnrealEd/Public/FileHelpers.h UEditorLoadingAndSavingUtils::GetDirtyContentPackages (the out array is the return value)
        return f"{FOLDER}/{name}" in [p.get_path_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_content_packages()]
    except Exception as exc:
        return "error: " + clean(exc)[:120]


def save(mesh, forced):
    # source: EditorAssetLibrary.h SaveLoadedAsset(UObject*, bool bOnlyIfIsDirty = true)
    time.sleep(0.05)
    return bool(eal.save_loaded_asset(mesh, not forced))


def duplicate(name):
    destination = f"{FOLDER}/{name}"
    if eal.does_asset_exist(destination):
        eal.delete_asset(destination)
    mesh = eal.duplicate_asset(SOURCE, destination)   # source: EditorAssetLibrary.h DuplicateAsset
    save(mesh, True)                                  # a clean baseline on disk
    return mesh


def fresh_slots(mesh, material):
    """New SkeletalMaterial structs for every slot of `mesh`, all pointing at `material`; slot names are kept."""
    return [unreal.SkeletalMaterial(material_interface=material, material_slot_name=s.material_slot_name) for s in mesh.get_editor_property("materials")]


def attempt(fn):
    """None when the call returned, the whole error text when it raised."""
    try:
        fn()
        return None
    except Exception as exc:
        return clean(exc)


# ------------------------------------------------------------------------------------------------ mode author
def author_material(name, rgb):
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    path = f"{FOLDER}/{name}"
    if eal.does_asset_exist(path):
        eal.delete_asset(path)
    material = tools.create_asset(name, FOLDER, unreal.Material, unreal.MaterialFactoryNew())
    mel = unreal.MaterialEditingLibrary   # source: Engine/Source/Editor/MaterialEditor/Public/MaterialEditingLibrary.h
    expression = mel.create_material_expression(material, unreal.MaterialExpressionConstant3Vector, -400, 0)
    expression.set_editor_property("constant", unreal.LinearColor(rgb[0], rgb[1], rgb[2], 1.0))
    mel.connect_material_property(expression, "", unreal.MaterialProperty.MP_BASE_COLOR)   # source: SceneTypes.h EMaterialProperty MP_BaseColor
    out = {"path": path_of(material), "class": material.get_class().get_name()}
    out["compile_errors"] = [clean(e) for e in (mel.recompile_material(material) or [])]
    try:   # source: MaterialEditingLibrary.h GetStatistics -> FMaterialStatistics
        stats = mel.get_statistics(material)
        out["stats"] = {"pixel_instructions": stats.get_editor_property("num_pixel_shader_instructions"),
                        "vertex_instructions": stats.get_editor_property("num_vertex_shader_instructions")}
    except Exception as exc:
        out["stats"] = {"error": clean(exc)[:200]}
    out["saved"] = save(material, True)
    return material, out


def run_author():
    lib = getattr(unreal, "SkeletalMaterialsBridgeLibrary", None)
    report["bridge"] = {"class_found": lib is not None, "members": [m for m in dir(lib) if "material" in m] if lib else []}
    eal.make_directory(FOLDER)
    # A commandlet has not scanned engine content, and EditorAssetLibrary.DuplicateAsset looks the source up in the asset registry
    # ("Could not find the source asset ... in the Asset Registry"), so scan the source folder first.
    unreal.AssetRegistryHelpers.get_asset_registry().scan_paths_synchronous([SOURCE.rsplit("/", 1)[0]], True)
    made = {}

    def make_materials():
        out = {}
        for label, name, rgb in (("red", "M_ProbeRed", (1.0, 0.0, 0.0)), ("blue", "M_ProbeBlue", (0.0, 0.0, 1.0))):
            made[label], out[label] = author_material(name, rgb)
        return out
    step("materials", make_materials)
    red, blue = made.get("red"), made.get("blue")
    if not red or not blue:
        return

    def element():
        mesh = duplicate("SK_Element")
        before, base = describe(mesh), stat("SK_Element")

        def edit():
            slots = mesh.get_editor_property("materials")
            slots[0].material_interface = red
        out = {"slots_before": before, "raised": attempt(edit)}
        out["after"] = describe(mesh)
        out["in_memory_changed"] = out["after"] != before
        save(mesh, True)
        out["forced_save_file_changed"] = stat("SK_Element") != base
        return out
    step("SK_Element", element)

    def assign():
        mesh = duplicate("SK_Assign")
        before, base = describe(mesh), stat("SK_Assign")
        out = {"slots_before": before, "base_stat": base}
        out["raised"] = attempt(lambda: mesh.set_editor_property("materials", fresh_slots(mesh, red)))   # the assign-back route
        out["after"] = describe(mesh)
        out["in_memory_changed"] = out["after"] != before
        out["dirty_after_set_1"] = is_dirty("SK_Assign")
        out["default_save_1"] = save(mesh, False)
        out["file_changed_after_save_1"] = stat("SK_Assign") != base
        after_1 = stat("SK_Assign")
        out["dirty_after_save_1"] = is_dirty("SK_Assign")
        out["raised_again"] = attempt(lambda: mesh.set_editor_property("materials", fresh_slots(mesh, red)))   # the identical set, second time
        out["dirty_after_set_2"] = is_dirty("SK_Assign")
        out["default_save_2"] = save(mesh, False)
        out["file_changed_after_save_2"] = stat("SK_Assign") != base
        out["file_changed_by_save_2"] = stat("SK_Assign") != after_1   # save 2 against the file save 1 wrote
        return out
    step("SK_Assign", assign)

    def control():   # nothing is done to the mesh, so a default save must write nothing: this tells "the set dirtied it" from "a default save always writes"
        mesh = duplicate("SK_Control")
        base = stat("SK_Control")
        out = {"dirty_before_save": is_dirty("SK_Control")}
        out["default_save"] = save(mesh, False)
        out["file_changed_after_default_save"] = stat("SK_Control") != base
        return out
    step("SK_Control", control)

    def assign_forced():
        mesh = duplicate("SK_AssignForced")
        before, base = describe(mesh), stat("SK_AssignForced")
        out = {"slots_before": before}
        out["raised"] = attempt(lambda: mesh.set_editor_property("materials", fresh_slots(mesh, red)))
        out["after"] = describe(mesh)
        out["in_memory_changed"] = out["after"] != before
        save(mesh, True)
        out["forced_save_file_changed"] = stat("SK_AssignForced") != base
        return out
    step("SK_AssignForced", assign_forced)

    def single():
        mesh = duplicate("SK_Single")
        before, base = describe(mesh), stat("SK_Single")
        out = {"slots_before": before}
        out["returned"] = lib.set_skeletal_mesh_materials(mesh, [red])   # the module's UFUNCTION
        out["after"] = describe(mesh)
        out["in_memory_changed"] = out["after"] != before
        out["default_save"] = save(mesh, False)
        out["file_changed_after_default_save"] = stat("SK_Single") != base
        return out
    step("SK_Single", single)

    def two():
        mesh = duplicate("SK_Two")
        out = {"slots_before_padding": describe(mesh)}

        def pad():
            current = mesh.get_editor_property("materials")
            padded = [unreal.SkeletalMaterial(material_interface=s.material_interface, material_slot_name=s.material_slot_name) for s in current]
            padded.append(unreal.SkeletalMaterial(material_interface=current[0].material_interface, material_slot_name="ProbeSlot1"))
            mesh.set_editor_property("materials", padded)
        out["pad_raised"] = attempt(pad)
        padded = describe(mesh)
        out["slots_padded"] = padded
        base = stat("SK_Two")
        out["refused_returned"] = lib.set_skeletal_mesh_materials(mesh, [red, blue, red])   # three materials for two slots
        out["slots_after_refusal"] = describe(mesh)
        out["returned"] = lib.set_skeletal_mesh_materials(mesh, [red, blue])
        out["after"] = describe(mesh)
        out["default_save"] = save(mesh, False)
        out["file_changed_after_default_save"] = stat("SK_Two") != base
        return out
    step("SK_Two", two)


# ------------------------------------------------------------------------------------------------ mode read
def tag_of(registry, object_path):
    """The hidden asset-registry Materials tag read from disk data. Two routes are tried and the one that worked is recorded."""
    out = {"route": None, "raw": None, "value": None, "attempts": []}
    routes = (
        ("get_asset_by_object_path", lambda: registry.get_asset_by_object_path(object_path, True)),   # source: IAssetRegistry.h GetAssetByObjectPath(FName, bool bIncludeOnlyOnDiskAssets) (deprecated)
        ("k2_get_asset_by_object_path", lambda: registry.k2_get_asset_by_object_path(unreal.SoftObjectPath(object_path), True)),   # source: IAssetRegistry.h K2_GetAssetByObjectPath; the Python name is unconfirmed
    )
    for route, fn in routes:
        try:
            data = fn()
            # source: AssetRegistryHelpers.h GetTagValue(const FAssetData&, const FName&, FString& out), ScriptMethod
            raw = data.get_tag_value("Materials")
            out["raw"] = repr(raw)[:400]
            if isinstance(raw, tuple):
                out["value"] = raw[-1] if raw and raw[0] else None
            elif isinstance(raw, str):
                out["value"] = raw
            out["route"] = route
            return out
        except Exception as exc:
            out["attempts"].append({"route": route, "error": clean(exc)[:300]})
    return out


def run_read():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous([FOLDER], True)   # source: IAssetRegistry.h ScanPathsSynchronous(const TArray<FString>&, bool bForceRescan)
    tags = {}
    for name in MESHES:
        step("tag_" + name, lambda n=name: tags.__setitem__(n, tag_of(registry, f"{FOLDER}/{n}.{n}")))   # all tags first, before any mesh is loaded
    meshes = {}
    for name in MESHES:
        def load(n=name):
            mesh = eal.load_asset(f"{FOLDER}/{n}")
            meshes[n] = {"class": mesh.get_class().get_name() if mesh else None, "slots": describe(mesh) if mesh else [], "registry": tags.get(n)}
        step("load_" + name, load)
    report["meshes"] = meshes

    def materials():
        out = {}
        for label, name in (("red", "M_ProbeRed"), ("blue", "M_ProbeBlue")):
            asset = eal.load_asset(f"{FOLDER}/{name}") if eal.does_asset_exist(f"{FOLDER}/{name}") else None
            out[label] = {"exists": asset is not None, "path": path_of(asset), "class": asset.get_class().get_name() if asset else None}
        return out
    step("materials", materials)


# ------------------------------------------------------------------------------------------------ run
def main():
    try:
        (run_author if MODE == "author" else run_read)()
    except Exception as exc:
        report["errors"].append({"step": "script", "error": clean(repr(exc))[:500], "trace": clean(traceback.format_exc())[-1200:]})
    os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
    with open(REPORT, "w") as fh:
        json.dump(report, fh, indent=2, default=str)
    unreal.log("[skeletal] report written")


if RUN == "tick":
    state = {"t": 0.0, "done": False}

    def tick(dt):
        if state["done"]:
            return
        state["t"] += dt
        if state["t"] < 3.0:
            return
        state["done"] = True
        main()
        unreal.SystemLibrary.execute_console_command(None, "QUIT_EDITOR")

    unreal.register_slate_post_tick_callback(tick)
else:
    main()
