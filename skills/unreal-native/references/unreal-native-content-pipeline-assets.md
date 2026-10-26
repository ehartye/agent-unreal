# Import GLB controls and WAVs through the content-only bake

Observed in one consuming Unreal **5.8.2 CL56702186** project on Windows; not reproduced in this repo. The bake, cook and reuse rules are in the [content pipeline](unreal-native-content-pipeline.md); the receipt staging is in the [native packaging staging recipe](unreal-native-packaging-staging.md).

## Rigid GLB controls and native WAVs through the same bake

- [general] The full Editor bake imported several Blender GLBs as real StaticMesh assets through `InterchangeManager.import_asset`. A saved `InterchangeGenericAssetsPipeline` used static-mesh combine `ALL`, baked meshes, explicit `IVCIO_REPLACE` vertex colors and disabled material import. `ImportAssetParameters.override_pipelines` received its saved soft object path, not a pipeline object. Each result was deliberately named, assigned the owned material and explicitly saved.
- [general] Native conversion put source glTF +Z on Unreal +Y; an asymmetric part's forward extent and the actual game-camera frame confirmed a single -90-degree component yaw into the actor's +X. A body-origin offset aligned the authored wheel hubs without changing physics. Do not copy these asset-specific transforms to another model without measuring it.
- [general] CPU access was enabled on the imported StaticMeshes before cook. The real Game target read nonwhite native RGBA vertices with baseline wear alpha across the meshes. That establishes retained data; the [presentation reference](unreal-native-presentation.md) records why its material still initially crushed the visible form.
- [general] Mono PCM16/48kHz WAV exports imported through `AssetTools`, with explicit loop/compression settings and saves. WAVs did not use Interchange. Native game receipts confirmed assets, an audio device and bounded engine/one-shot voices; owner listening approval was not inferred.
- [general] Cook reuse hashes included the exact imported GLBs and mesh/audio importer scripts. Editable Blender files, preview renders and transient managed-build locks were excluded. Changing an imported GLB or WAV invalidated reuse; an unrelated draft model did not. An exclusive transient Blender lock had previously broken source hashing before capture, so the exclusion addressed an observed workflow failure.

## Actual second-generation runtime proof

- [general] After the separated bake/cook and native Game build, receipt staging/UnrealPak produced a new Windows folder. The real EXE delivered fresh PNGs and matching JSON for each scenario; the images were opened. A jump scenario sampled zero grounded wheels at altitude. This establishes an airborne sample, not a landing.
- [general] This package retained **visual GAP** status. No full session, physical keyboard/controller input, audible audio, normal-gameplay performance or cross-machine acceptance follows from those offscreen frames. Fixed simulation timestep and short measured frame samples are not performance acceptance.
