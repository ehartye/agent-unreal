# Motion Matching in Unreal 5.8: Pose Search databases, schemas, the Motion Matching node and trajectory

Target: Unreal Engine 5.8, Windows. Motion Matching selects animation from a Pose Search Database by comparing a query built from the character's pose history and trajectory. Epic calls it "a dynamic alternative to State Machines, or Blendspaces", with no transition or blending logic to set up between sequences. State-machine locomotion stays documented; see [Animation Blueprints](unreal-animation-blueprints.md).

## Enable it

| Plugin | Default | Flags (descriptor) | Depends on |
|---|---|---|---|
| `PoseSearch` | off | not beta, not experimental | AnimationWarping, BlendStack, Chooser, MotionWarping, RigVM |
| `MotionTrajectory` | off | experimental | PoseSearch |
| `MotionWarping` | off | beta | none |

- Epic: enable Pose Search under Edit > Plugins (Animation) and restart the editor.
- Epic's Trajectory channel is "designed to be used in conjunction with the Character Trajectory blueprint component"; in the 5.8 install `CharacterTrajectoryComponent` ships in the experimental `MotionTrajectory` plugin.
- Marked Experimental by Epic or in the 5.8 headers: Crashing Legs and Permutation Time channels, the VPTree and EventOnly search modes, the predictor-based trajectory nodes, and multi-character interaction (`MotionMatchMulti`). Epic: experimental channels "should not be relied upon in production".

## Use it when

- Locomotion or actions should respond to the current trajectory, and fidelity should grow by adding animation to the Database (Epic).
- Which Databases are searched depends on gameplay context: a Chooser picks them at runtime (Epic's Game Animation Sample does this per movement state).
- The trajectory comes from a movement component; [Mover](unreal-mover.md) offers `GetPredictedTrajectory` and ChaosMover adds trajectory prediction for motion-matching workflows (5.8 release notes).

## Use something else when

- State machines and Blend Spaces are the other documented locomotion route: [Animation Blueprints](unreal-animation-blueprints.md).
- Epic requires root motion, with the Root Motion property enabled, in locomotion animations; clips without it need another route.
- Use [Control Rig](unreal-control-rig.md) for procedural pose edits after the pose is chosen.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Author Schema, Database, Normalization Set | editor UI | Content Browser: Pose Search Schema, Pose Search Database |
| Create the assets by script | Python | AssetTools `create_asset` (see `examples/unreal/build_scene.py`) with `PoseSearchSchemaFactory`, `PoseSearchDatabaseFactory` (`TargetSchema`), `PoseSearchNormalizationSetFactory`, declared in the 5.8 install; not run here |
| Tune assets | Python | both are `BlueprintType` data assets with `EditAnywhere` properties (editor properties, Epic). Database: `Schema`, `DatabaseAnimationAssets`, `Tags`, `BaseCostBias`, `ContinuingPoseCostBias`, `LoopingCostBias`, `PoseSearchMode`, `KDTreeQueryNumNeighbors`. Schema: `SampleRate` (1 to 240, default 30), `Channels`, `DataPreprocessor` |
| Place the node | editor UI | AnimGraph Pose Search category: Motion Matching node, Searchable pin = Database; Pose History node |
| Drive the node from graph logic | Blueprint | `MotionMatchingAnimNodeLibrary` Anim Node Functions such as On Update: Get Search Result, Override Blend Settings (install header) |
| Generate the trajectory | Blueprint | Pose History > Generate Trajectory; `Pose Search Generate Trajectory (for Character)` with history and prediction sampling intervals and counts |
| Shape the data in clips | editor UI | Anim Notify States: Exclude From Database, Sampling Range, Modify Cost, Block Transition (Epic API page) |
| Debug | editor UI | Tools > Debug > Rewind Debugger, Pose Search track; Active Pose, Continuing Pose and Pose Candidates tabs |

No console variables are claimed: the pages and headers read do not document any.

## Workflow

1. Enable `PoseSearch` (and `MotionTrajectory` for the Character Trajectory component) and restart.
2. Prepare clips with root motion and the Root Motion property enabled on each sequence.
3. Create a Schema. New Schemas come preconfigured for locomotion with a Pose channel and a Trajectory channel. Each channel adds cost to the query and weights set its influence, so use as few channels as the goal needs (Epic). A higher `SampleRate` refines search and costs memory.
4. Create a Database that references the Schema and add the animation assets (`FPoseSearchDatabaseAnimationAsset` replaces the per-type structs deprecated in 5.7). Use as few samples as possible (Epic). Trim clip ends and bias costs with notifies and the cost-bias properties to keep the search in a segment longer or shorter.
5. In the AnimGraph add a Pose History node with Generate Trajectory enabled and the bones to sample under Collected Bones, then a Motion Matching node whose Searchable pin takes the Database. Connect the result to the Output Pose.
6. Feed the trajectory from the movement component. The 5.8 release notes default trajectory generation to mesh space.
7. Select Databases at runtime with a Chooser keyed to gameplay state, as the Game Animation Sample does in its `Update_MotionMatching` function.
8. Pick the search mode. `PCAKDTree` (default) projects poses to `NumberOfPrincipalComponents` dimensions and builds a KD-tree; `BruteForce` evaluates every indexed pose. Databases created for Chooser columns default to BruteForce in 5.8.
9. Debug in the Rewind Debugger: compare Active Pose and Continuing Pose to see why a pose swapped; values are colored green (favorable), red (unfavorable) and gray (ignored).

## Sources

- [Motion Matching](https://dev.epicgames.com/documentation/en-us/unreal-engine/motion-matching-in-unreal-engine)
- [Motion Matching debugging](https://dev.epicgames.com/documentation/en-us/unreal-engine/motion-matching-debugging-in-unreal-engine)
- [Game Animation Sample Project](https://dev.epicgames.com/documentation/en-us/unreal-engine/game-animation-sample-project-in-unreal-engine)
- [PoseSearch API module](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Plugins/PoseSearch)
- [Pose Search Generate Trajectory (for Character)](https://dev.epicgames.com/documentation/en-us/unreal-engine/BlueprintAPI/Animation/PoseSearch/PoseSearchGenerateTrajectory_for-)
- [Scripting the Editor using Python](https://dev.epicgames.com/documentation/en-us/unreal-engine/scripting-the-unreal-editor-using-python)
- [Unreal Engine 5.8 release notes](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-5-8-release-notes)
- Plugin descriptors and the PoseSearch and MotionTrajectory headers in the 5.8 install.
