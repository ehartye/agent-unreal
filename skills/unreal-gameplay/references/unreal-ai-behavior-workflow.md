# AI decision-making in Unreal 5.8: the workflow, step by step

Target: Unreal Engine 5.8, Windows. The numbered steps for building StateTree, Behavior Tree, EQS, Perception and Smart Object behaviour. What each system is for, how to enable it and which call reaches it are in [AI decision-making](unreal-ai-behavior.md).

## Workflow

1. Choose the layer: per-character logic is a StateTree or a Behavior Tree; many agents are Mass entities.
2. Enable `GameplayStateTree` and `StateTree`, restart, create the asset, and pick the schema that matches where it runs (the component schema for a tree on an Actor; a tree built on another schema is missing from the component's dropdown).
3. Build states. Enter Conditions gate a state; all Tasks in an active state run together; the first Task to finish triggers a transition. Transitions evaluate from the leaf toward the root, so put shared transitions on parent states.
4. Expose permanent data through Global Tasks and Evaluators, bind data instead of copying it, and set outside inputs as Parameters.
5. Reuse a tree by setting a state's type to Linked Asset (since 5.4).
6. Compile after edits. Disabling a state or task needs a compile; breakpoints do not.
7. Behavior Tree path: create the Blackboard and tree, run it from the AIController's Event On Possess, set the pawn's AI Controller Class (Auto Possess AI = Spawned for spawned pawns), and add a NavMeshBoundsVolume. Put conditions in Decorators, not conditional Tasks (Epic).
8. EQS: attach one Generator to the root (only the left-most is used), add Tests, set the Context.
9. Perception: configure senses and Max Age on the AIController; register sources with the Stimuli Source Component.
10. Smart Objects: Find, Claim, move to the slot, Use, then Release; the agent releases its own slot.
