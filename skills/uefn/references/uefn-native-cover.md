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

## Check semantic collision and variant state

[general] Requesting BlockAll read back as Custom on these Fortnite proxy
components. A disabled actor returned effective NO_COLLISION through
`get_collision_enabled()` while its BodyInstance retained configured
QUERY_AND_PHYSICS. Read configured BodyInstance state, intended Pawn/Visibility
responses and actual query results. Neither the profile name alone nor an
effective disabled value proves that a correctly inactive variant is misconfigured.
The installed response enum is `unreal.CollisionResponseType.ECR_BLOCK`.

A small preliminary experiment showed that merely hiding an actor still
blocked queries. `MovieSceneBoolTrack` keys on `bActorEnableCollision` switched
queries off and back on. The installed comparison added one collision track per
original parent and per proxy. Frames 0/30 select variant A/B; verification
uses 0/30/0. Changing the visible parent's collision alone was not demonstrated
to disable attached children.

Keep the selected comparison sequence actively evaluated while querying that
variant. Closing editor Sequencer restored the pre-evaluation state in this recipe,
despite KEEP_STATE sections; variant B queries then encountered variant A state.
Runtime device ForceKeepState behavior is unverified. Restore documented default
visibility/collision, selection and idle Sequencer in a finally block; retain
pending state if cleanup cannot be verified.

## Verify independent geometry, movement and query identity

In the observed native API, `HitResult.to_dict()` supplied `hit_actor`,
`hit_component`, `impact_point` and `initial_overlap`. Verify actual actor and
component identity, no initial overlap and fitted intersection location. The
generic `SystemLibrary.break_hit_result` helper was absent in this installation;
inspect available methods rather than inventing a helper.

Use isolated six-face surface rays for every fitted part, **plus independent
source-corner comparisons** at multiple actual animation poses. Measure that
each intended moving part changes position and returns within a stated tolerance;
passing at several frame numbers does not prove that animation moved. The pilot
sampled five frames, required movement >1cm at the middle frame and return
<0.01cm at the last. That threshold and schedule describe this pilot, not all
possible animations.

An initially assumed gap actually crossed solid source geometry. Replace
an incorrect gap expectation with a genuine source-open cavity; do not weaken
fitted cover merely to satisfy the test. The proof used rest-pose gap rays per
variant. Those rays do not establish capsule clearance or gaps throughout the
moving cycle. Exclude unrelated/editor-only device meshes when testing proxy
identity; a CreativeEditOnlyMesh hit is not proof of a runtime wall.

After the post-fit bone-policy change, independent corners exposed the wrong
child positions even though self-derived face checks passed. The bounded repair
kept actor/bone identities, refitted only the owned proxies and saved their exact
packages. All checks and motion/return then passed in fresh native calls. Before
another mutation, inspect and reconcile the failed attempt; do not repeat full
installation or replace original geometry/controller assets.

## Evidence and limits

[general] Disposable preliminary experiments with convex PhysicsAsset shapes on
module bodies yielded zero query hits. Deferred calls, saved proof packages and
positive-scale tests also failed. The cause remains unresolved; this is not
evidence that all UEFN PhysicsAssets or gameplay physics are unsupported.

[general] The fitted installation stored its recipe and verification receipts as
JSON: identity/face checks, source-corner comparisons, variant selection
queries, rest-gap checks and moving/returning parts. The saved packages were
clean and unrelated architecture package hashes were unchanged. Source hash
inputs survive a fresh Windows autocrlf checkout. These are saved/editor facts.

No Fortnite validation/cook or real player/weapon, saved-reload, moving-gap,
multiplayer or cost result is claimed for this pilot. The observed client was in
Sleep Mode with Disconnected/Unconnected session status. Reconcile the prior
pending launch before starting another; a server cook with no connected client
does not establish gameplay readiness. Do not add general simulation/ragdolls
merely to create cover or infer a performance improvement from fewer actors.

Ordinary native save/capture and disposable asset-lifetime cleanup guidance are
in the operations reference linked directly from the skill.
