# Native UEFN FBX: decks, editor physics and reimport

Read this after the collision is read back: circular decks, editor trace checks and
reimport. Coordinates and simple collision are in [UEFN FBX coordinates and
collision](uefn-native-fbx.md). Observed in one consuming UEFN project on UEFN 42.30;
not reproduced in this repo.

## Match circular decks instead of using square covers

[general] A separate reusable cylinder imported with bounds origin Z=50 cm,
extents `(100,100,50)` cm. `StaticMeshEditorSubsystem` exposed
`set_convex_decomposition_collisions(mesh, 1, 64, 100000)`; it returned success
and one convex element was read back. This produced a tight hull for that
cylinder, not a universal decomposition recipe for arbitrary meshes.

Hidden, non-rendering collision actors matched the layers of round platforms.
Their component collision stayed `QUERY_AND_PHYSICS`. Reuse the saved mesh;
stable labels reject duplicates and repeated placement created zero new actors.
Inspect center, rim and a point outside the circle's diagonal corner. A square
box can appear correct at center and still block empty floor near its corners.
These decks are walking surfaces, not evidence that moving meshes provide
gunfight cover.

## Check editor physics and retain the runtime gate

[general] Editor traces checked floor/roof/wall/divider blocking and open
entrance, threshold and return passages. Deck checks sampled center/rim/outside-corner
heights; all passed within 3 mm of expected surfaces. Saved recovery after an
editor crash retained the enclosure and passed traces again.

The installed `SystemLibrary.line_trace_single` returned a HitResult for a hit
and `None` for no hit. Verify the actual return contract in another installation.
The observed project used `ECC_VISIBILITY`, `trace_complex=False` and explicit ignored
actors to isolate the intended collision. Test both expected hits and expected
misses; unrelated props can otherwise mask a missing walking surface.

HitResult locations were protected in this installation. Instead of parsing
their repr, the deck checker bracketed height with repeated boolean queries:
fix a start point above the surface, find a lower endpoint that hits and an
upper endpoint that misses, then bisect the endpoint height twelve times.
Use monotonic single-surface intervals, reject an unbounded result and compare
the bracketed height to planned centre/rim/floor heights in consistent units.

Editor traces do not establish Fortnite character stepping, cooked collision,
weapon cover, multiplayer or performance. Keep those acceptance checks open.

## Reimport is a separate authoring operation

An access violation occurred during asynchronous validation after repeated FBX
reimport. Its cause was not isolated; do not label reimport itself the proven
cause. Routine placement skips existing assets and unchanged collision.
New source geometry requires an explicit import/revision step; do not silently
reuse an old asset while claiming the new geometry landed.

Preflight every input and destination before imports. Import only the intended
assets, inspect the registry/bounds/materials/collision, save them and the owned
actor packages, then validate. Keep a pending receipt for uncertain work and
inspect recovery state before another import. Do not blindly replay a crashed
or timed-out mutation or normalize unrelated scene actors. Keep receipts at
`runtimeVerified=false` until observed in Fortnite.
