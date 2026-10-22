"""Invoked only by unreal-import.mjs in a closed project; uses Unreal's Interchange importer."""
import json
import os
import traceback
from pathlib import Path

import unreal

COLLISION_FLAGS = {'complex-as-simple': 'CTF_USE_COMPLEX_AS_SIMPLE'}


def resolve_enum(enum, *names):
    """Return (name, value) for the first member of an Unreal enum that exists; builds differ in what they call a member."""
    for name in names:
        value = getattr(enum, name, None)
        if value is not None:
            return name, value
    raise RuntimeError('none of %s exist on the installed engine enum' % ', '.join(names))


def bounds_cm(bounds):
    """Asset-local bounds as min/max corners in centimetres (Unreal's own unit)."""
    origin, extent = bounds.origin, bounds.box_extent
    return {'min': [origin.x - extent.x, origin.y - extent.y, origin.z - extent.z],
            'max': [origin.x + extent.x, origin.y + extent.y, origin.z + extent.z]}


def build_pipeline(request, pipeline_folder):
    pipeline = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        'Pipeline', pipeline_folder, unreal.InterchangeGenericAssetsPipeline, None)
    if pipeline is None:
        raise RuntimeError('could not create owned Interchange pipeline')
    mesh = pipeline.get_editor_property('mesh_pipeline')
    options = request['options']
    used = {}
    if options['combineStaticMeshes']:
        static_value = unreal.InterchangeCombineStaticMeshesBehavior.ALL
        used['combineStaticMeshes'] = 'ALL'
    else:
        # Some engine builds call "do not combine" NONE; resolve it and report which name worked.
        used['combineStaticMeshes'], static_value = resolve_enum(
            unreal.InterchangeCombineStaticMeshesBehavior, 'DO_NOT_COMBINE', 'NONE')
    mesh.set_editor_property('combine_static_meshes_behavior', static_value)
    if options['combineSkeletalMeshes']:
        skeletal_value = unreal.InterchangeCombineSkeletalMeshesBehavior.BY_SKELETON
        used['combineSkeletalMeshes'] = 'BY_SKELETON'
    else:
        used['combineSkeletalMeshes'], skeletal_value = resolve_enum(
            unreal.InterchangeCombineSkeletalMeshesBehavior, 'DO_NOT_COMBINE', 'NONE')
    mesh.set_editor_property('combine_skeletal_meshes_behavior', skeletal_value)
    # Only keys the config names are touched; everything else stays at the engine's importer default.
    if 'nanite' in options:
        mesh.set_editor_property('build_nanite', bool(options['nanite']))
        used['nanite'] = bool(options['nanite'])
    if 'vertexColors' in options:
        name, value = resolve_enum(unreal.InterchangeVertexColorImportOption, 'IVCIO_' + options['vertexColors'].upper())
        pipeline.get_editor_property('common_meshes_properties').set_editor_property('vertex_color_import_option', value)
        used['vertexColors'] = name
    material = pipeline.get_editor_property('material_pipeline')
    material.set_editor_property('import_materials', options['importMaterials'])
    material.set_editor_property('reuse_existing_materials', False)
    if not unreal.EditorAssetLibrary.save_loaded_asset(pipeline, only_if_is_dirty=False):
        raise RuntimeError('pipeline save failed')
    return pipeline, used


def mesh_subsystem():
    # PythonScriptCommandlet does not register every editor subsystem; the getters are plain asset queries.
    subsystem = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem)
    return subsystem if subsystem is not None else unreal.get_default_object(unreal.StaticMeshEditorSubsystem)


def match_meshes(specs, meshes, problems):
    """Pair each requested mesh with one imported StaticMesh: exact node name first, then 'node_' prefix."""
    pairs, remaining = [], list(meshes)
    for spec in specs:
        node = spec.get('node')
        if node is None:
            found = list(remaining)
        else:
            found = [m for m in remaining if m.get_name() == node]
            if not found:
                found = [m for m in remaining if m.get_name().startswith(node + '_')]
        label = spec['asset']
        if len(found) != 1:
            names = [m.get_name() for m in meshes]
            problems.append('%s: expected exactly one imported StaticMesh%s, found %d of %s' % (
                label, ' named %s' % node if node else '', len(found), names))
            continue
        remaining.remove(found[0])
        pairs.append((spec, found[0]))
    return pairs, remaining


def rename_to(mesh, destination, asset, problems):
    editor = unreal.EditorAssetLibrary
    source = mesh.get_path_name().split('.')[0]
    target = destination + '/' + asset
    if source == target:
        return mesh, None
    if editor.does_asset_exist(target):
        problems.append('%s: an asset already exists at %s' % (asset, target))
        return mesh, None
    if not editor.rename_asset(source, target):
        problems.append('%s: could not rename %s to %s' % (asset, source, target))
        return mesh, None
    renamed = editor.load_asset(target)
    # An unsaved asset leaves no redirector; if this build leaves one, remove it so the destination holds only the requested names.
    if editor.does_asset_exist(source):
        leftover = editor.load_asset(source)
        if leftover is not None and leftover.get_class().get_name() == 'ObjectRedirector':
            editor.delete_asset(source)
        if editor.does_asset_exist(source):
            problems.append('%s: %s still exists after the rename' % (asset, source))
    return renamed, source


def apply_policy(mesh, spec, problems):
    editor = unreal.EditorAssetLibrary
    subsystem = mesh_subsystem()
    label = spec['asset']
    if 'allowCpuAccess' in spec:
        mesh.set_editor_property('allow_cpu_access', bool(spec['allowCpuAccess']))
    if 'fullPrecisionUVs' in spec:
        for lod in range(subsystem.get_lod_count(mesh)):
            settings = subsystem.get_lod_build_settings(mesh, lod)
            settings.set_editor_property('use_full_precision_u_vs', bool(spec['fullPrecisionUVs']))
            subsystem.set_lod_build_settings(mesh, lod, settings)
    if 'material' in spec:
        material = editor.load_asset(spec['material']) if editor.does_asset_exist(spec['material']) else None
        if not isinstance(material, unreal.MaterialInterface):
            problems.append('%s: material %s does not exist or is not a material' % (label, spec['material']))
        else:
            for index in range(len(mesh.get_editor_property('static_materials'))):
                mesh.set_material(index, material)
    collision = spec.get('collision')
    double_sided = spec.get('doubleSidedCollision', True if collision else None)
    if collision or double_sided is not None:
        setup = mesh.get_editor_property('body_setup')
        if setup is None:
            problems.append('%s: the mesh has no body setup to set collision on' % label)
        else:
            if collision:
                setup.set_editor_property('collision_trace_flag', getattr(unreal.CollisionTraceFlag, COLLISION_FLAGS[collision]))
            if double_sided is not None:
                setup.set_editor_property('double_sided_geometry', bool(double_sided))
    # StaticMesh has no post_edit_change in Python: the trace flag is set in place on the body setup,
    # the mesh is marked modified, and the explicit save below persists it.
    mesh.modify()


def measure(readback, name, function):
    try:
        return function()
    except Exception as error:  # an unreadable field is reported, never guessed
        readback.setdefault('unreadable', {})[name] = str(error)
        return None


def read_back(mesh, requested, node, renamed_from, read_from):
    subsystem = mesh_subsystem()
    readback = {'asset': mesh.get_path_name(), 'requested': requested, 'node': node, 'renamedFrom': renamed_from, 'readFrom': read_from}
    readback['naniteEnabled'] = measure(readback, 'naniteEnabled', lambda: bool(mesh.get_editor_property('nanite_settings').get_editor_property('enabled')))
    readback['fullPrecisionUvs'] = measure(readback, 'fullPrecisionUvs', lambda: all(
        bool(subsystem.get_lod_build_settings(mesh, lod).get_editor_property('use_full_precision_u_vs'))
        for lod in range(subsystem.get_lod_count(mesh))))
    readback['allowCpuAccess'] = measure(readback, 'allowCpuAccess', lambda: bool(mesh.get_editor_property('allow_cpu_access')))

    def trace_flag():
        setup = mesh.get_editor_property('body_setup')
        return setup.get_editor_property('collision_trace_flag').name if setup else None
    readback['collisionTraceFlag'] = measure(readback, 'collisionTraceFlag', trace_flag)

    def double_sided():
        setup = mesh.get_editor_property('body_setup')
        return bool(setup.get_editor_property('double_sided_geometry')) if setup else None
    readback['doubleSidedCollision'] = measure(readback, 'doubleSidedCollision', double_sided)
    readback['materialSlots'] = measure(readback, 'materialSlots', lambda: [
        slot.material_interface.get_path_name() if slot.material_interface else None
        for slot in mesh.get_editor_property('static_materials')])
    readback['hasVertexColors'] = measure(readback, 'hasVertexColors', lambda: bool(subsystem.has_vertex_colors(mesh)))
    readback['uvChannels'] = measure(readback, 'uvChannels', lambda: int(subsystem.get_num_uv_channels(mesh, 0)))
    readback['vertices'] = measure(readback, 'vertices', lambda: int(subsystem.get_number_verts(mesh, 0)))
    readback['boundsCm'] = measure(readback, 'boundsCm', lambda: bounds_cm(mesh.get_bounds()))
    return readback


def reload_saved(meshes):
    """Reload the saved packages so the read-back comes from what was written, not from the pre-save object.

    Returns (assets, source). If this build cannot reload, the loaded assets are read instead and the source says so.
    """
    editor = unreal.EditorAssetLibrary
    paths = [mesh.get_path_name().split('.')[0] for mesh in meshes]
    try:
        _, mode = resolve_enum(unreal.ReloadPackagesInteractionMode, 'ASSUME_NEGATIVE', 'ASSUME_POSITIVE')
        packages = [mesh.get_package() for mesh in meshes]
        reloaded, message = unreal.EditorLoadingAndSavingUtils.reload_packages(packages, mode)
        fresh = [editor.load_asset(path) for path in paths]
        if reloaded and all(isinstance(asset, unreal.StaticMesh) for asset in fresh):
            return fresh, 'reloaded-package'
        return fresh if all(fresh) else list(meshes), 'loaded-asset (reload reported: %s)' % (message or 'nothing to reload')
    except Exception as error:
        return [editor.load_asset(path) or mesh for path, mesh in zip(paths, meshes)], 'loaded-asset (reload failed: %s)' % error


def prepare_meshes(request, imported, problems):
    """Rename and configure the imported StaticMeshes. Returns (requested asset or None, node, renamed_from, mesh) entries."""
    editor = unreal.EditorAssetLibrary
    destination = request['destination']
    meshes = [asset for asset in (editor.load_asset(path) for path in imported) if isinstance(asset, unreal.StaticMesh)]
    specs = request.get('meshes')
    entries = []
    if specs:
        pairs, remaining = match_meshes(specs, meshes, problems)
        for spec, mesh in pairs:
            mesh, renamed_from = rename_to(mesh, destination, spec['asset'], problems)
            apply_policy(mesh, spec, problems)
            entries.append((spec['asset'], spec.get('node'), renamed_from, mesh))
        entries.extend((None, None, None, mesh) for mesh in remaining)
    else:
        entries.extend((None, None, None, mesh) for mesh in meshes)
    return entries


def read_back_all(entries):
    fresh, read_from = reload_saved([entry[3] for entry in entries])
    return [read_back(mesh, entry[0], entry[1], entry[2], read_from) for entry, mesh in zip(entries, fresh)]


def main(request):
    destination = request['destination']
    project = Path(unreal.Paths.get_project_file_path()).resolve()
    if project != Path(request['project']).resolve():
        raise RuntimeError('project identity mismatch')
    if Path(request['outputDirectory']).exists():
        raise RuntimeError('destination is not empty; refusing import')
    existing = unreal.EditorAssetLibrary.list_assets(destination, recursive=True, include_folder=False)
    if existing:
        raise RuntimeError('destination already contains registered assets')
    pipeline_folder = destination + '/_Import'
    pipeline, used = build_pipeline(request, pipeline_folder)
    params = unreal.ImportAssetParameters()
    params.is_automated = True
    params.replace_existing = False
    params.override_pipelines = [unreal.SoftObjectPath(pipeline.get_path_name())]
    source = unreal.InterchangeManager.create_source_data(request['source'])
    result = unreal.InterchangeManager.get_interchange_manager_scripted().import_asset(destination, source, params)
    if not result:
        raise RuntimeError('Interchange import failed')
    assets = [str(path) for path in unreal.EditorAssetLibrary.list_assets(destination, recursive=True, include_folder=False)]
    imported = [path for path in assets if not path.startswith(pipeline_folder + '/')]
    if not imported:
        raise RuntimeError('Interchange created no imported assets')
    problems, entries = [], None
    if request.get('readback'):
        entries = prepare_meshes(request, imported, problems)
        assets = [str(path) for path in unreal.EditorAssetLibrary.list_assets(destination, recursive=True, include_folder=False)]
        imported = [path for path in assets if not path.startswith(pipeline_folder + '/')]
    for path in assets:
        if not unreal.EditorAssetLibrary.save_asset(path, only_if_is_dirty=False):
            raise RuntimeError('asset save failed: ' + path)
    report = {'assets': assets, 'imported': imported, 'engine': unreal.SystemLibrary.get_engine_version(), 'pipeline': used}
    if entries is not None:
        # Read after the saves, from the reloaded packages, so the receipt describes what was written.
        report['meshes'] = read_back_all(entries)
        report['problems'] = problems
    return report


def run():
    request_path = os.environ['AGENT_ENGINE_IMPORT_REQUEST']
    with open(request_path, encoding='utf-8') as source_file:
        request = json.load(source_file)
    report = {'ok': False, 'operation': request['operation'], 'destination': request['destination']}
    try:
        report.update(main(request))
        report['ok'] = True
    except Exception as error:
        report.update(error=str(error), trace=traceback.format_exc())
        unreal.log_error(report['trace'])
    finally:
        with open(request['report'], 'x', encoding='utf-8') as output_file:
            json.dump(report, output_file, indent=2)


# Imported without a request (the host tests load this file against a stub `unreal`), nothing runs.
if 'AGENT_ENGINE_IMPORT_REQUEST' in os.environ:
    run()
