---
name: unreal-animation
description: "Choose and drive Unreal Engine 5.8 character animation and cinematics: Control Rig and IK Rig, Animation Blueprints (slot-only graphs from Python, state machines and other nodes through a C++ bridge), Motion Matching and Pose Search, cloth and flesh, Hair Strands, Sequencer, and Movie Render Queue for offline rendering. Not for character movement or abilities (use unreal-gameplay), effects (unreal-effects) or importing animated models (use unreal-import)."
when_to_use: "Use when asked to rig, retarget or animate procedurally; to build or script an Animation Blueprint, state machine, blend space or montage slot; to add AnimDynamics, Two Bone IK or another AnimGraph node from code; about Motion Matching; for cloth, outfits, soft bodies, hair or fur, or a cloth asset built from a script; to author, record or play cinematics or Level Sequences; or to render a movie or image sequence offline or from a command line."
---

# Choosing an Unreal animation or cinematics system

Unreal 5.8 on Windows. Pick the feature from the goal, then read that system's reference: when to use it, what to use instead, how an agent drives it. Brackets show each plugin's shipped state. Other Unreal skills: `unreal-effects`, `unreal-gameplay`, `unreal-procedural`, `unreal-rendering`, `unreal-editor-scripting`, `unreal-native`, `unreal-import`, `uefn`, `unreal-architecture`, `unreal-quality`.

| You are about to | Read |
|---|---|
| Simulate cloth, outfits or soft bodies (ChaosCloth on; Cloth Asset, Outfit Asset, ChaosFlesh off) | [Cloth and flesh](references/unreal-chaos-cloth-and-flesh.md) |
| Add hair or fur (Hair Strands; off) | [Hair Strands](references/unreal-hair-strands.md) |
| Rig, animate procedurally or retarget with IK (Control Rig and IK Rig on; Full Body IK off) | [Control Rig](references/unreal-control-rig.md) |
| Author character animation logic or drive it by data search (Animation Blueprints; Pose Search) | [Animation Blueprints](references/unreal-animation-blueprints.md), [Motion Matching](references/unreal-motion-matching.md) |
| Author, record or play cinematics; render them offline or from a command line (Sequencer; Movie Render Pipeline off) | [Sequencer](references/unreal-sequencer.md), [Movie Render Queue](references/unreal-movie-render-queue.md) |

## Rules of thumb

- Python builds slot-only Animation Blueprints; state-machine states, transitions and blend-space resampling need the C++ bridge in the Animation Blueprints reference.
- Import animated models with `unreal-import`; rigging and clip authoring before import are `mesh-rigging` in agent-meshes.

Enable only the plugin a system needs: the steps are under Enable a feature in [unreal-editor-scripting](../unreal-editor-scripting/SKILL.md).
