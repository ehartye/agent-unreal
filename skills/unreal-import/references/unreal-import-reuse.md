# Guarded Unreal project import reuse

- [general] Use this small Node helper for a **final delivered, self-contained GLB** imported into a closed Windows Unreal project. It calls the installed Editor's Interchange importer. It does not implement a new converter or replace agent-meshes `verify-unreal`, which remains scratch import verification. Cook, gameplay, rendering, Unity and Godot are separate acceptance paths.
- [tested] The host filesystem/process contracts cover output ownership, exact file hashes, missing-output invalidation, source/config/importer changes, force, no-launch reuse, pending-operation refusal, and broken-junction refusal. Native acceptance is bounded to the recorded installed UE **5.8.2 CL56702186** disposable fixture; do not generalize it to another engine build or live project.

## Configure one exclusively generated destination

- [general] Save this project-local config, with paths relative to the config file. Use a fresh dedicated `/Game/Generated/<one-asset-folder>` destination. The helper owns **all files** below that destination, including its saved pipeline, meshes, materials, skeletons, animations, textures and native package sidecars. Keep the Editor closed and do not concurrently edit inputs or outputs.

```json
{
  "source": "Art/Reaper/generated/model.glb",
  "project": "Game.uproject",
  "engine": "C:/Program Files/Epic Games/UE_5.8",
  "destination": "/Game/Generated/Reaper",
  "options": {
    "combineStaticMeshes": true,
    "combineSkeletalMeshes": true,
    "importMaterials": true
  },
  "inputs": ["Scripts/import-policy.json"]
}
```

- [general] The three shown booleans default to true. The native script saves an owned `InterchangeGenericAssetsPipeline`, sets static combine `ALL` or "do not combine", skeletal combine `BY_SKELETON` or "do not combine", and the material-import flag. Two more pipeline options (`vertexColors`, `nanite`) and a per-mesh `meshes` policy with read-back are optional and described in [import policy and read-back](unreal-import-policy.md); a game whose project is regenerated each run should read [regenerated projects](unreal-import-regenerated-projects.md) before expecting reuse. When a key is absent the importer's own default is left untouched and the helper behaves as in 0.12.0. Existing project materials are not reused. Other pipeline defaults are tied to the recorded engine/project configuration. Unknown options and external-file GLB buffer/image URIs are rejected before launch. FBX, external `.gltf`, custom pipeline assets and unsupported options need another route.
- [general] Enable the project's PythonScriptPlugin and EditorScriptingUtilities through its normal project configuration first. Resolve native module/security-policy failures through the normal engine workflow. Do not use an active project as a verification fixture.
- [tested] The first disposable project's initial Editor startup created `Config/DefaultInput.ini`, so the input-stability check retained a pending result instead of blessing changed inputs. The fresh acceptance fixture included that observed default before import. Initialize a new project's normal configuration and close it before the first guarded import; a pending operation must be inspected rather than blindly retried.
- [tested] On 5.8.2 a new project's first launch also appended an `AndroidFileServer` settings block, with a generated security token, to `Config/DefaultEngine.ini` (hashing the `.uproject` and the `Config`, `Binaries` and `Plugins` files before and after a no-op commandlet showed that file alone changing). The first import then stopped with `INPUT_CHANGED`; a launch after that changed nothing. Launch the project once with a no-op script before the first import.

## Inspect, reuse or regenerate

```powershell
$importer = '<agent-unreal-plugin>/skills/unreal-import/scripts/unreal-import.mjs'
node $importer import.json --inspect
node $importer import.json --if-changed
node $importer import.json --force
```

- [general] `--inspect` reads identities and ownership without creating Saved state or launching the Editor. It returns `reusable`, `needs-import` or `pending`; conflicts fail explicitly. `--if-changed` skips the Editor only when the identity matches and every recorded output is present and byte-identical. `--force` and the default invocation regenerate; force does **not** override ownership conflicts. The two build flags are mutually exclusive.
- [general] Identity covers the delivered GLB bytes/path, normalized options, project path/destination, `.uproject`, the project Config/Binaries/Plugins files and declared `inputs` files; Node/platform; the helper and native script bytes; engine Build.version, Editor executable, identified Interchange/Python DLLs, engine configuration and installed Interchange/Python pipeline/configuration assets. Add project-specific helper scripts, data, custom importer dependencies and nonstandard engine dependencies to `inputs` as individual files. No automatic dependency closure, undeclared-read audit, network/environment determinism or universal hermetic-build claim is made. Opt into reuse only for understood deterministic inputs.
- [general] The receipt lives under `Saved/AgentEngineImports/<destination-id>/receipt.json`, records exact sorted filenames, sizes and SHA-256 hashes, and links the native report. A missing file invalidates reuse. An extra or changed file means `OUTPUT_CONFLICT`, even with force. Preserve owner work and choose a new destination or deliberately reconcile it outside the helper; do not silently replace receipt hashes to acknowledge an edit.

## Safe replacement and uncertain outcomes

- [general] The helper takes one project-wide lock. Before invoking the Editor it journals the input identity, expected old files, exact request and backup location, both per destination and project-wide. It checks ownership again and moves the entire old owned directory into that operation's `previous-output` archive. The native importer then creates the same destination afresh with replacement disabled, explicitly saves each imported package, and reports the destination inventory. The host hashes every file under that exclusive directory, checks reported packages exist, rechecks inputs and atomically publishes the receipt. Old outputs remain archived; obsolete files do not leak into the new destination.
- [general] Any uncertain failure retains pending journals and evidence, blocking **all** imports into that project. The 180-second native timeout is a failure, not permission to replay. `--inspect` exposes the journal. Check the exact operation's native report, `native.log`, console log, current output directory, previous-output archive, input snapshot and previous receipt; confirm every Editor/child process has stopped. Recover by a deliberate owner-reviewed reconciliation or use a new disposable project. There is no automatic adopt/repair/unlock/delete command.
- [general] Successful operations also retain their previous-output archives. Review/archive them as project build evidence and clean exact proven operation paths through the project's normal retention policy. This helper does not perform recursive cleanup or automatically remove owner files. Receipts are trusted local build state, not a tamper-resistant security boundary.

## Sources and verification limits

- [documented] Epic describes Interchange as customizable through pipeline stacks and exposes synchronous Python asset import. Its import settings affect output identity: [Importing assets using Interchange](https://dev.epicgames.com/documentation/en-us/unreal-engine/importing-assets-using-interchange-in-unreal-engine), [InterchangeManager](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/InterchangeManager?application_version=5.6), [ImportAssetParameters](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/ImportAssetParameters?application_version=5.6). Versioned older API pages establish the call contract; the installed 5.8.2 headers and actual native fixture establish the tested enum/property names.
- [general] A saved import receipt proves observed files from that invocation. It does not prove artistic quality, correct units/collision/material semantics, runtime animation, target-player rendering, cook success, cross-machine compatibility, or all engine side effects. Use the existing engine/mesh verification and real game acceptance for those claims.
