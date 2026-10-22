# UEFN fitted cover verification

Read this after fitting moving prop cover, to check its collision, variant state and geometry independently. Observed in one consuming UEFN project on UEFN 42.30; not reproduced in this repo. The recipe is in [fitted moving prop cover](uefn-native-cover.md).

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

Ordinary native save, capture and disposable asset-lifetime cleanup guidance is in [native operations](uefn-native-operations.md).
