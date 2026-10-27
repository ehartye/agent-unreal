# UEFN scoped saves

Read this when native UEFN edits must be saved without Save All: external actor packages, and an extra ActorFolder package that appears after an actor save. Observed in one consuming UEFN project on an earlier UEFN build; not reproduced in this repo. Every claim is labelled `[general]` for that reason. Inspect the installed schemas after upgrades; these observations are not an API contract for every project. Use the [authoring reference](uefn-authoring.md) for connection setup.

## Save only owned external actor packages

**[general]** `actor.get_package()` returned the external actor package in the
loaded island. Verify `actor.is_package_external()` and the actual package path;
do not assume the returned object is the map or assume every actor is external.
`EditorLoadingAndSavingUtils.save_packages(packages, False)` saved scoped sets
of named actors. Check its boolean result. Related external
object packages may also change for an owned folder; inspect ownership before
staging. A source commit does not back up native assets unless those files ship.

The following function uses those native calls. Its arguments come from
a project-specific preflight: the exact island level, unique owned actor paths,
and the verified external package prefix. It has not been run as a reusable
function; the calls and guards were exercised separately in project scripts.

```python
import unreal

def save_owned_actor_packages(expected_level, actor_paths, external_package_prefix):
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    if world.get_path_name().split('.')[0] != expected_level:
        raise RuntimeError("Wrong island")
    if not actor_paths or len(set(actor_paths)) != len(actor_paths):
        raise RuntimeError("Expected unique, explicitly owned save targets")
    if not external_package_prefix or not external_package_prefix.endswith('/'):
        raise RuntimeError("Expected a preflighted external package prefix")
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
    packages = {}
    for path in actor_paths:
        found = [actor for actor in actors if actor.get_path_name() == path]
        if len(found) != 1:
            raise RuntimeError("Missing or ambiguous target: " + path)
        actor = found[0]
        package = actor.get_package()
        if not actor.is_package_external():
            raise RuntimeError("Refusing a nonexternal actor package")
        if not package.get_path_name().startswith(external_package_prefix):
            raise RuntimeError("Refusing an out-of-scope package")
        packages[package.get_path_name()] = package
    if not unreal.EditorLoadingAndSavingUtils.save_packages(list(packages.values()), False):
        raise RuntimeError("Save failed; inspect before repeating")
    return list(packages)
```

Do not replace this preflight with Save All. Empty target lists must fail closed.
Retain the saved package names and pending-save state in a receipt. Reconcile a
timeout against native package state before another mutation. Serialize native
scripts and callback jobs: the observed remote entrypoint shared Python globals.
Do not call MCP from inside an editor Python script.

For derived LevelBounds, native material pins or sky collision readback, use [exterior materials](uefn-native-exterior.md). Cleanup of disposable proof assets is in [proof asset cleanup](uefn-native-cleanup.md).

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
