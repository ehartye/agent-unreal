"""Read-only editor experiment: edited entrypoints, cached helpers and reload.

Call run() through an already verified native editor connection. This creates
only disposable Python files in a unique temporary directory, not Unreal assets.
"""
import hashlib
import importlib
import json
from pathlib import Path
import runpy
import shutil
import sys
import tempfile
import uuid


def run(expected_level, content_directory, receipt_path):
    import unreal
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    if world.get_path_name().split('.')[0] != expected_level:
        raise RuntimeError('Wrong editor world')
    if unreal.LevelSequenceEditorBlueprintLibrary.get_current_level_sequence():
        raise RuntimeError('Sequencer must be idle')
    editor = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    if any(isinstance(a, unreal.SceneCapture2D) for a in editor.get_all_level_actors()):
        raise RuntimeError('Finish/reconcile active capture fixtures before probing')
    api = unreal.EditorLoadingAndSavingUtils
    content = Path(content_directory).resolve()
    receipt = Path(receipt_path).resolve()
    if not content.is_dir() or receipt.exists():
        raise RuntimeError('Missing content root or occupied receipt')
    sha = lambda data: hashlib.sha256(data).hexdigest()

    def require_origin(loaded, expected):
        expected = Path(expected).resolve()
        if (Path(loaded.__file__).resolve() != expected
                or Path(loaded.__spec__.origin).resolve() != expected):
            raise RuntimeError('Helper origin does not match the intended source')

    def snapshot():
        actors = sorted((a.get_path_name(), a.get_actor_label(), a.get_actor_transform().export_text())
                        for a in editor.get_all_level_actors())
        native = sorted((p.relative_to(content).as_posix(), sha(p.read_bytes())) for p in content.rglob('*.uasset'))
        return {'actors': len(actors), 'actorDigest': sha(json.dumps(actors).encode()),
                'nativeFiles': len(native), 'nativeDigest': sha(json.dumps(native).encode()),
                'dirty': sorted(p.get_path_name() for p in api.get_dirty_map_packages() + api.get_dirty_content_packages()),
                'selection': sorted(a.get_path_name() for a in editor.get_selected_level_actors())}

    baseline = snapshot()
    if baseline['dirty']:
        raise RuntimeError('Unsaved editor work')
    original_path = list(sys.path)
    temp_base = Path(tempfile.gettempdir()).resolve()
    directory = Path(tempfile.mkdtemp(prefix='agent-engine-helper-', dir=temp_base)).resolve()
    if directory.parent != temp_base or not directory.name.startswith('agent-engine-helper-'):
        raise RuntimeError('Unexpected fixture directory')
    name = '_agent_engine_helper_probe_' + uuid.uuid4().hex
    helper = directory / (name + '.py')
    entry = directory / 'probe_entry.py'
    module = None
    report = {'schema': 'agent-engine-native-helper-probe@1', 'pending': True,
              'world': world.get_path_name(), 'pythonVersion': sys.version,
              'baseline': baseline, 'moduleName': name, 'fixtureDirectory': str(directory),
              'probeSourceSha256': sha(Path(__file__).read_text(encoding='utf-8').encode()),
              'runtimeVerified': False}
    receipt.write_text(json.dumps(report, indent=2) + '\n')
    try:
        if name in sys.modules:
            raise RuntimeError('Fixture module name occupied')
        helper.write_text("LEGACY_TOKEN = 'before'\ndef value():\n    return 'before'\n", encoding='utf-8')
        entry.write_text("from " + name + " import value\nENTRY_VERSION = 'before'\nRESULT = value()\n", encoding='utf-8')
        sys.path.insert(0, str(directory))
        first = runpy.run_path(str(entry))
        module = sys.modules[name]
        if Path(module.__file__).resolve() != helper:
            raise RuntimeError('Imported fixture resolved to the wrong source')
        report['first'] = {'entry': first['ENTRY_VERSION'], 'helper': first['RESULT'],
                           'helperPath': module.__file__, 'helperSha256': sha(helper.read_bytes())}
        old_function = first['value']
        # Different source sizes avoid ambiguous same-size/same-timestamp pyc
        # invalidation in this experiment. General reload is not hash validation.
        helper.write_text("def value():\n    return 'after-explicit-reload'\n", encoding='utf-8')
        entry.write_text("from " + name + " import value\nENTRY_VERSION = 'after-entry-edit'\nRESULT = value()\n", encoding='utf-8')
        second = runpy.run_path(str(entry))
        report['second'] = {'entry': second['ENTRY_VERSION'], 'helper': second['RESULT'],
                            'sameModule': sys.modules[name] is module, 'sameFunction': second['value'] is old_function,
                            'helperPath': module.__file__, 'helperSha256': sha(helper.read_bytes())}
        importlib.invalidate_caches()
        report['afterFinderInvalidation'] = importlib.import_module(name).value()
        # Check origin before reload: reloading the wrong module executes it.
        require_origin(module, helper)
        try:
            require_origin(module, directory / 'foreign.py')
        except RuntimeError:
            report['wrongPathRejectedBeforeReload'] = True
        else:
            raise RuntimeError('Origin guard accepted a different source')
        module = importlib.reload(module)
        report['afterReload'] = {'moduleCall': module.value(), 'oldFunctionCall': old_function(),
                                 'oldFunctionStillCurrent': old_function is module.value,
                                 'removedNameRemains': hasattr(module, 'LEGACY_TOKEN')}
        rebound = getattr(module, 'value')
        report['reboundCall'] = rebound()
        if not (first['RESULT'] == 'before' and second['ENTRY_VERSION'] == 'after-entry-edit'
                and second['RESULT'] == 'before' and report['afterFinderInvalidation'] == 'before'
                and report['afterReload']['moduleCall'] == 'after-explicit-reload'
                and report['afterReload']['oldFunctionCall'] == 'before'
                and report['reboundCall'] == 'after-explicit-reload'):
            raise RuntimeError('Observed import behavior differs from expected experiment')
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        # Only this unique fixture module/path is owned. Do not clear arbitrary
        # editor globals, reload unreal or enumerate/delete neighboring files.
        sys.path[:] = original_path
        if module is not None and sys.modules.get(name) is module:
            del sys.modules[name]
        if directory.parent != temp_base or not directory.name.startswith('agent-engine-helper-'):
            raise RuntimeError('Refusing cleanup outside the owned fixture')
        shutil.rmtree(directory)
        report['cleanup'] = {'pathRestored': sys.path == original_path,
                             'moduleAbsent': name not in sys.modules, 'directoryAbsent': not directory.exists()}
        report['after'] = snapshot()
        report['protectedStateUnchanged'] = report['after'] == baseline
        report['pending'] = False
        receipt.write_text(json.dumps(report, indent=2) + '\n')
    if not report['protectedStateUnchanged'] or not all(report['cleanup'].values()):
        raise RuntimeError('Fixture cleanup or protected editor state differs')
    return report
