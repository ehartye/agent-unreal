# Edited Python helpers in a running UEFN editor

Read this when rerunning a native editor script still produces the old layout,
an edited helper seems ignored, or a reloaded module's imported function stays
old. Observed in one consuming UEFN project on UEFN 42.30 with embedded Python
3.11.8; not reproduced in this repo. The probe source and its recorded receipt
are in `examples/uefn`.

## What the local experiment established

[general] A consuming project's placement refinement reran with an edited
placement helper but retained the earlier coordinates. Fresh actor readback
caught the discrepancy before save. Explicitly reloading that project-owned
helper then applied the intended translation.

[tested] A separate disposable probe in the same editor isolated the Python
behavior (`python_helper_freshness_probe.py`, recorded in the receipt below):

| Step | Observed result |
|---|---|
| Run a temporary entrypoint importing a helper | Both returned their first version |
| Edit both files, execute the entrypoint again with `runpy.run_path` | New entrypoint value, old helper function; same cached module and function |
| Invalidate import finder caches and import again | Helper still returned its first version |
| Reload the owned module | Module's function returned the new literal |
| Call a function reference captured before reload | Still returned the old literal |
| Bind the function from the module after reload | Returned the new literal |
| Inspect a name removed from the new helper source | Old name remained in the module dictionary |

[tested] The probe also rejected a mismatched source path before reload, restored
`sys.path`, removed its unique fixture module and temporary directory, and
preserved actor identities/transforms, the `.uasset` file set, selection and
clean package state. It created no Unreal actors or assets and sent no input.
The experiment executed two entrypoint versions inside one interpreter; it does
not establish that every remote command mode creates a fresh namespace.

[tested] Source and recorded output are
[`python_helper_freshness_probe.py`](../../../examples/uefn/python_helper_freshness_probe.py)
and [`helper-freshness-receipt.json`](../../../examples/uefn/helper-freshness-receipt.json).
The receipt binds the probe source hash and before/after protected-state digests.

## Apply the correction to the intended helper

1. [general] Verify the exact level and serialize native jobs. Finish or reconcile owned
   capture callbacks before executing another script in the shared interpreter.
2. [general] Inspect the prior mutation's receipt and actual actor/asset state first.
   Stale helper output does not authorize replaying a creation/import script or
   replacing a pending receipt. Reconcile completed and incomplete changes.
3. [general] Identify the specific project-owned module, its resolved `__file__` and
   `__spec__.origin`, and the expected source hash. A same-named module from
   another folder is a path problem, not permission to reload it. Review imports
   and module-level code: reloading resolves the module again and executes that
   code. Check the next resolution, not only the cached module's old origin.
   Keep layout helpers
   free of actor edits, imports of assets, saves and callback registration.
4. [tested] Reload only that helper, then obtain its function from the returned module.
   Repeating the old `from helper import function` binding *before* reload leaves
   the caller with an old object. Call `helper.function(...)` or rebind afterward.
5. [general] Check a pure output against the intended source change, then independently
   read back the actual native result and protected state before an owned save.
   A matching file hash identifies disk bytes, not the function already in memory.

This excerpt assumes `module_name`, `expected_file` and `expected_sha256` came
from a reviewed project preflight, and the already imported helper has a pure
`build_plan` function. It supports only top-level Python source modules with the
standard import finders; custom hooks and package helpers need a separately
reviewed resolver. Keep import paths/hooks unchanged throughout this synchronous
block. It does not import an unknown module or perform a native mutation.

```python
import hashlib
import importlib
from importlib.machinery import BuiltinImporter, FrozenImporter, PathFinder, SourceFileLoader
from pathlib import Path
import sys

expected_file = Path(expected_file).resolve()
helper = sys.modules.get(module_name)
if helper is None:
    raise RuntimeError('Inspect and import the intended helper first')

def check_source(module):
    if (Path(module.__file__).resolve() != expected_file
            or Path(module.__spec__.origin).resolve() != expected_file):
        raise RuntimeError('Wrong helper source; do not reload or call it')
    if hashlib.sha256(expected_file.read_bytes()).hexdigest() != expected_sha256:
        raise RuntimeError('Helper source changed since preflight')

check_source(helper)
if '.' in module_name or sys.meta_path != [BuiltinImporter, FrozenImporter, PathFinder]:
    raise RuntimeError('This example requires standard top-level import resolution')
next_spec = PathFinder.find_spec(module_name, sys.path)
if (next_spec is None or type(next_spec.loader) is not SourceFileLoader
        or Path(next_spec.origin).resolve() != expected_file):
    raise RuntimeError('Reload would resolve a different helper; stop before execution')
helper = importlib.reload(helper)
check_source(helper)
build_plan = helper.build_plan  # bind AFTER reload
# Inspect build_plan(...) before any native edit; retain mutation receipt guards.
```

[tested] The native probe exercised the import/reload and origin-check behavior.
[general] A separate host Python 3.13 run of this excerpt with temporary
helpers (not part of this repo) rejected a shadowing path and custom finder before
helper code ran, while the intended reload/rebind succeeded. The standard-finder constraint
has not been established for every UEFN interpreter; inspect it and stop if it
does not hold. This is not a universal loader. Reload is not a
fresh-interpreter reset: removed names and old references can survive. The
experiment deliberately changed helper source size to avoid a same-size,
same-timestamp bytecode ambiguity; it did not test every loader/cache variant.
Do not claim reload alone proves the intended code executed.

[documented] Python documents finder-cache invalidation, module reload, retained dictionaries
and the need to rebind imported objects in its
[3.11 importlib reference](https://docs.python.org/3.11/library/importlib.html#importlib.reload).
These mechanisms are separate from UEFN asset caching or the MCP script sandbox.

[general] Do not clear all `sys.modules`, reload `unreal` or another engine extension,
delete project caches, restart the editor, or replay an uncertain mutation to
make a stale-helper symptom disappear. Reloading a helper with import-time
mutations is itself a mutation; separate computation from native execution
before adopting this pattern. Existing instances or callbacks holding earlier
objects need explicit lifecycle handling, not blanket reloading.

[general] Time and complexity are small for a side-effect-free helper. The material risks
are wrong-path imports, repeated import-time effects and stale caller bindings.
Source identity, a pure planning boundary and native readback fit the existing
project scripts without introducing a resident loader service. This is editor
execution evidence, not Fortnite validation, player behavior or performance.
