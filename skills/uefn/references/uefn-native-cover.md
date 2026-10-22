# UEFN fitted moving prop cover

Read this when fitted cover must follow skeletal animation or switch with a
prop's visible variant. Observed in one consuming UEFN project on UEFN 42.30;
not reproduced in this repo. This is a measured recipe, not a collision service
supplied by this plugin. Inspect the installed APIs and actual source geometry
in each new project.

**Do not accept self-consistent collider traces alone.** Compare world corners
with independent original model geometry, measure movement and exact return,
and query the active/inactive variant. A misplaced collider can pass all six face
tests against its own wrong transform. Cooking, player/weapon interaction,
saved reload, multiplayer and performance are separate acceptance gates.

Checks that prove the result (semantic collision, variant state, independent geometry and query identity) are in [cover verification](uefn-native-cover-verification.md).

## Select a bounded pilot

| Route | Time | Risk | Complexity | Architectural fit | Maintenance |
|---|---|---|---|---|---|
| Source-named simple boxes attached to actual bones | Proven editor pilot; fit each solid part | Wrong transforms, stale attachments, extra actors | One actor per fitted box in this recipe | Cover follows visible source parts and variant state | Source geometry, exact actor IDs and receipts |
| PhysicsAsset convex shapes per module | More experimentation | Shapes existed but did not answer the observed queries | Native subsystem and body fitting | Potentially fewer actors; not demonstrated here | Preserve failed evidence; require an independent successful proof |
| Broad fixed box around a moving prop | Quick to author | Invisible barriers and blocked source openings | Low implementation complexity | Poor fit for open or changing geometry | Ongoing manual reconciliation; do not use as an untested shortcut |

The pilot covered two visible variants of one animated prop only, with one
fitted box per solid part, animated module bones, a non-unit world scale and a
yaw. The small source bevels are approximated by the fitted boxes. Do not copy
dimensions or transforms into another model. Scope the next prop separately;
passing one editor pilot does not justify claiming every prop has cover.

## Author from original geometry and exact native identity

1. [general] Verify the exact loaded level, both parent/component identities, source
   geometry hashes, original visibility keys, idle Sequencer and absence of an
   unresolved installation/save receipt. Enumerate expected fresh destinations.
2. [general] Import a fresh project-owned primitive with an owned material. Read bounds,
   LOD0 vertices and actual BodySetup primitive arrays. The observed unit FBX was
   one metre across, bounds +/-50cm, 24 LOD0 vertices and one 100cm simple box.
   It is not enough for an importer to report success or auto-collision enabled.
3. [general] Set any intended parent animation/bone-refresh policy **before** fitting
   children. In this pilot, ALWAYS_TICK_POSE_AND_REFRESH_BONES replaced
   ONLY_TICK_POSE_WHEN_RENDERED. Changing it after fitting reset every
   child transform to its bone root. The internal cause is uninspected;
   this is not a universal property-edit or UEFN-bug claim. Its server/client
   behavior and continuous-refresh cost remain unmeasured.
4. [general] Reconstruct each solid part's corners from unchanged original source data.
   Include source coordinate conversion, FBX/root scale, negative scale and
   parent world transform. Read actual bone names/transforms; reject missing
   bones. Do not infer placement from rendered screenshots or assume unit scale.
5. [general] Attach invisible, movable proxy actors to the intended component and bone
   with KEEP_WORLD and welding disabled; fit them to those original corners.
   Static variants attach to their static component without a bone. Record exact
   actor/component paths, parent/socket, mesh and fitted transforms. Visibility,
   hidden-in-game and disabled shadows do not by themselves disable collision.
6. [general] Preserve original controller references, visibility tracks and comparison
   timing. Add collision ownership for **every** proxy plus affected parents.
   Hidden variants must not leave active query geometry behind. Save only owned
   native packages with explicit receipts and read back clean package state.

Duplicating /Engine/BasicShapes/Cube was rejected before any destination asset
or actor was created. The rejected request's pending receipt was reconciled
against native destination absence and unchanged original actors/sequence before
the separate owned-FBX route. Do not replay a pending mutation or force-copy an
Engine asset because the client received an error. Resolve partial outcomes first.
