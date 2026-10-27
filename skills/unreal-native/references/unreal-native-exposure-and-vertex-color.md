# Native exposure, palette and imported vertex-colour diagnosis

Observed in one consuming project on an earlier engine build; not reproduced in this repo. Engine source inspection and executed behaviour are labelled separately. These are native-game integration observations, not screenshot-reference acceptance. Fonts, Canvas text and generated assets are in [native presentation](unreal-native-presentation.md); the [native game loop](unreal-native-game.md) covers compiler selection, capture completion and tests.

## Diagnose from actual native frames

- [general] The first gameplay image was almost black while its Canvas HUD remained legible. A second scene showed real geometry, isolating the problem to the chase-camera exposure path rather than missing content. This is why compile/import/actor counts cannot substitute for opening the PNG.
- [general] The chase camera used manual exposure without overriding physical camera exposure. Setting `bOverride_AutoExposureApplyPhysicalCameraExposure=true` and `AutoExposureApplyPhysicalCameraExposure=false` made the authored emissive scene visible on recapture. The same explicit setting was applied to the presentation camera. HDR red emissive values had tonemapped orange; a separately generated after-tonemap palette material restored signal red. A global palette finish still did not create missing geometry/detail or fix white HUD text over a pale background.

- [general] The final palette material was MD_POST_PROCESS at BL_SCENE_COLOR_AFTER_TONEMAPPING, reading PPI_POST_PROCESS_INPUT0. It was explicitly saved under /Game/Art and attached through an unbound native UPostProcessComponent. A fresh Editor-game screenshot established the intended colors; the first successful save did not.
- [general] A palette pass cannot invent object anatomy, surface marks or structural depth. Keep world objects separated and moving correctly, and inspect actual camera poses. Preserve broad dark and light masses before adding noise. Canvas UI remains outside the world palette pass and must have its own contrast over the changing scene.

## Imported vertex colors can have a different tone contract

- [general] A Blender-exported model carried nonwhite linear `COLOR_0` with semantic wear alpha. Native GPU frames still hid its formed details. Runtime StaticMesh color-buffer readback confirmed the data existed; a missing-color diagnosis would have been wrong.
- [documented] Installed-source inspection of `GLTFCore/Private/GLTFMeshFactory.cpp` shows `SRGBToLinear` countering the later `MeshBuilder/Private/StaticMeshBuilder.cpp` call to `LinearColor.ToFColor(true)`. The resulting shader buffer retains the glTF linear values. Check both ends of this path before assuming a color-space conversion from one function name.
- [general] An artist's sRGB tone of .22 was exported near .03955. An existing procedural material treated that as a designed density and applied another `pow(tone,2.15)`, producing a near-zero emissive intensity. A separate material recovered the artist tone before its mapping and used a restrained normal term. Native recaptures revealed the previously hidden bevels and tread. This proved the local material diagnosis; independent reference parity remained open.
- [general] Do not gamma-correct every imported material. First establish source color semantics, actual native buffer values and the consuming shader's expected range. Keep semantic alpha separate from opacity, and inspect the game-camera image after cooking rather than accepting an exporter or color-buffer count alone.
