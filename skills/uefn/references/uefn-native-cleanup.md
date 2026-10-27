# UEFN disposable proof asset cleanup

Read this before deleting proof assets an experiment created. Observed in one consuming UEFN project on an earlier UEFN build; not reproduced in this repo. Every claim is labelled `[general]` for that reason. Inspect the installed schemas after upgrades; these observations are not an API contract for every project. Use the [authoring reference](uefn-authoring.md) for connection setup.

## Delete only reconciled disposable proof assets

**[general] Observed on an earlier UEFN build:** immediate deletion failed while proof assets
remained in use. Closing owned asset editors returned zero; Unreal GC alone did
not release the assets. Python `gc.collect()` followed by
`unreal.SystemLibrary.collect_garbage()` allowed the remaining disposable
assets to be deleted. The Python return value counts **unreachable objects**,
not cycles. The exact retaining references/internal cause were not inspected.
A later hardened cleanup returned hundreds of unreachable Python objects and
removed an additional owned comparison sequence. Do not turn those observations
into a universal cleanup guarantee or invent a reference-clearing fix.

Treat deletion as a separate operation from experiment authoring. Before any
delete, reconcile against current native state, not just a `removed` flag:

1. [general] Verify the exact loaded island and that editor Sequencer is idle.
   Stop or finish the owned callback/job and remove its owned transient fixtures
   first. Do not delete an asset still evaluated or used by a live fixture.
2. [general] Derive the complete expected proof set from the original experiment
   recipe: exact role, version, package and object name. A folder, naming prefix
   or glob is not deletion ownership. The expected set may include named
   sequences outside the proof folder. Accept an exact package path or its
   matching package.object form; refuse a neighboring version, nested path,
   unknown role or mismatched object suffix.
3. [general] Preserve historical failed receipts verbatim. Write a separate
   read-only reconciliation containing each original receipt's SHA-256, exact
   fixture paths, current absence and idle evaluation evidence. Missing or
   incomplete identities fail closed.
4. [general] Immediately before deletion, re-hash every original receipt, require
   the same complete set and recheck each recorded fixture path unoccupied. A path
   may have been reused after reconciliation: even a different actor there is
   a stop, not permission to destroy it. Verify protected original assets and
   the full exact asset set against the preflight. Refuse a prior cleanup-attempt
   receipt instead of overwriting it or treating elapsed time as reconciliation.
5. [general] Write a pending cleanup receipt before collection/deletion. Avoid
   loading owned proof assets during the deletion pass. In the observed recovery,
   collect unreachable Python wrappers before Unreal UObject collection; do
   not clear shared Python globals, force deletion or suppress references to
   make the operation pass. A GC count proves collection, not asset absence.
6. [general] Delete only exact owned targets with `EditorAssetLibrary.delete_asset`.
   Record the currently attempted path and each successful deletion. Check
   the boolean result and `does_asset_exist` after each target. Stop on failure;
   retain the partial receipt and inspect/reconcile before a later operation.
   Refuse automatic retries, including after a client timeout.
7. [general] Check every expected destination absent, not merely those reported
   deleted. Restore selection/evaluation state and verify protected native state.
   Record explicit remaining targets, package-save state and the evidence
   boundary. Never replace this process with Delete Directory, Save All or
   user-global clearing. These are editor cleanup checks, not Fortnite
   behavior/performance.

A final receipt should show every exact asset path absent and each hash-bound
reconciliation; say which pass deleted what, and do not claim one operation
deleted everything. A disposable physics package may be saved and then deleted;
the proof feature should save no production changes. Source-scope tests of the
ownership guards (nearby or foreign names, roles, versions, stale hashes) do not
execute native GC or deletion.

**API discovery is separate evidence:** installed `FortPhysicsAssetEditorSubsystem`
exposed body creation, weighted bone vertices and primitive authoring/inspection;
generic `PhysicsAsset.skeletal_body_setups` was not reflected. Shapes created in
failed PhysicsAsset experiments on a placed prop still produced zero query hits.
Discover actual available APIs; neither the existence of authoring methods nor
failed queries establishes universal runtime support or a performance budget.
A production installation uses a separate recipe and is not a disposable target.
