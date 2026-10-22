# Native Unreal materials, fonts and camera presentation

Observed in one consuming Unreal 5.8.2 CL56702186 project on Windows; not reproduced in this repo. Engine source inspection and executed behaviour are labelled separately. These are editor/native-game integration observations, not screenshot-reference acceptance. The [native game loop](unreal-native-game.md) covers compiler selection, capture completion, tests and current cook/package status.

## Editor asset generation and fonts

- [general] Native unlit material graphs were created and explicitly saved under `/Game/Art`. Connecting `VertexColor` output **"RGB"** failed even though the node looks RGB in the editor. Its compound RGB output has an **empty** name; `""` connects it, while `"A"` connects alpha. Check every material connection boolean instead of assuming success.
- [general] `FontFileImportFactory` through automated `AssetTools.import_asset_tasks` **crashed a Python commandlet** at `SlateApplication::CurrentApplication.IsValid()`. Python try/except could not catch the native assertion. Switching construction to the full Editor initialized Slate and imported/saved the actual fonts without fallback.
- [general] The working construction command was full `UnrealEditor.exe -ExecutePythonScript=... -RenderOffScreen -nullrhi -unattended`. Automatic exit when the synchronous script returns is correct here. It is wrong for a later tick-driven gameplay capture.
- [general] Source fonts plus their individual SIL OFL licenses were vendored from a pinned commit of the official Google Fonts repository. Builds did not depend on Windows font installation or a live download. `FontFileImportFactory.batch_create_font_asset = BatchCreateFontAsset.YES` created FontFace plus matching UFont; discover their actual types/names, rename the UFont deliberately and save both.
- [general] An empty map saved successfully; native BeginPlay built the actual game world. Asset generation success did not establish correct exposure or typography in the first runtime frame.
- [general] Imported runtime fonts initially looked blurred because legacy Canvas text rasterized at its small default size and then scaled those glyphs up. Keep the font import; copy `Font->GetLegacySlateFontInfo()`, set its `Size` to the actual desired font point size and use `FCanvasTextItem(position, text, SlateFontInfo, color)` with `Item.Scale=(1,1)`. Recaptured text was crisp. Slate uses 96 DPI (a 0.75 point-to-pixel factor was used here); measure the same explicit font info for right alignment instead of scaling legacy metrics. This uses the runtime glyph cache while still drawing into Canvas.

```powershell
& "$ueRoot/Engine/Binaries/Win64/UnrealEditor.exe" $uproject "-ExecutePythonScript=$projectRoot/Scripts/build_content.py" -RenderOffScreen -nullrhi -unattended -nosplash -nosound -notraceserver "-abslog=$projectRoot/Saved/Logs/content.log"
if ($LASTEXITCODE -ne 0) { throw 'Editor content generation failed' }
```

Keep editor asset creation separate from shipped runtime modules. Explicitly save materials, fonts and map; reopen from disk and cook before claiming persistence. If runtime assets load only by string, add their directory to ProjectPackagingSettings `DirectoriesToAlwaysCook`, or supply a real hard asset reference. Here `/Game/Art` was explicit.

## Diagnose from actual native frames

- [general] The first gameplay image was almost black while its Canvas HUD remained legible. A second scene showed real geometry, isolating the problem to the chase-camera exposure path rather than missing content. This is why compile/import/actor counts cannot substitute for opening the PNG.
- [general] The chase camera used manual exposure without overriding physical camera exposure. Setting `bOverride_AutoExposureApplyPhysicalCameraExposure=true` and `AutoExposureApplyPhysicalCameraExposure=false` made the authored emissive scene visible on recapture. The same explicit setting was applied to the presentation camera. HDR red emissive values had tonemapped orange; a separately generated after-tonemap palette material restored signal red. A global palette finish still did not create missing geometry/detail or fix white HUD text over a pale background.

- [general] The final palette material was MD_POST_PROCESS at BL_SCENE_COLOR_AFTER_TONEMAPPING, reading PPI_POST_PROCESS_INPUT0. It was explicitly saved under /Game/Art and attached through an unbound native UPostProcessComponent. A fresh Editor-game screenshot established the intended colors; the first successful save did not.
- [general] A palette pass cannot invent object anatomy, surface marks or structural depth. Keep world objects separated and moving correctly, and inspect actual camera poses. Preserve broad dark and light masses before adding noise. Canvas UI remains outside the world palette pass and must have its own contrast over the changing scene.

## Imported vertex colors can have a different tone contract

- [general] A Blender-exported model carried nonwhite linear `COLOR_0` with semantic wear alpha. Native GPU frames still hid its formed details. Runtime StaticMesh color-buffer readback confirmed the data existed; a missing-color diagnosis would have been wrong.
- [documented] Installed-source inspection of 5.8.2 `GLTFCore/Private/GLTFMeshFactory.cpp` shows `SRGBToLinear` countering the later `MeshBuilder/Private/StaticMeshBuilder.cpp` call to `LinearColor.ToFColor(true)`. The resulting shader buffer retains the glTF linear values. Check both ends of this path before assuming a color-space conversion from one function name.
- [general] An artist's sRGB tone of .22 was exported near .03955. An existing procedural material treated that as a designed density and applied another `pow(tone,2.15)`, producing a near-zero emissive intensity. A separate material recovered the artist tone before its mapping and used a restrained normal term. Native recaptures revealed the previously hidden bevels and tread. This proved the local material diagnosis; independent reference parity remained open.
- [general] Do not gamma-correct every imported material. First establish source color semantics, actual native buffer values and the consuming shader's expected range. Keep semantic alpha separate from opacity, and inspect the game-camera image after cooking rather than accepting an exporter or color-buffer count alone.


## Inspect generated scenery and varied native lettering

- [general] A capture-only camera location/target override enabled close native inspection of generated interiors. Keep overrides restricted to a named capture scenario; validate both vectors, finite coordinates, a world bound and distinct target. `FParse::Value(..., false)` preserves comma-separated XYZ values (its default stops at commas). In 5.8.2, `LexTryParseString` is declared in `String/LexFromString.h`. Record actual camera values in the native receipt and compare them with requested values; hide menu Canvas only for that inspection. A close inspection frame does not replace normal gameplay-view evidence.
- [general] Several distinct display font families plus a body family imported and cooked in a fresh content-only Editor bake, each from pinned source bytes with its own bundled OFL notice. A review found that reusing any existing UFont could certify an old fallback as the desired source font. A strict importer should tag successful imports with a source SHA-256, reject untagged/mismatched reuse, and raise on import failure without creating a fallback. Validate actual runtime font loads separately from source hashes and Editor import success.
- [general] Production captions rendered using the explicit-size SlateFontInfo Canvas path, with a rotated local Canvas transform, burst silhouettes and layered glyph keylines. A runtime loaded-font mask confirmed every display family. This establishes availability and the sampled rendered captions, not legibility of every font/treatment; retain actual frames for each combination being judged.

## Record native audio

- [documented] In 5.8.2, AudioComponent copies priority into ActiveSound at Play. Configure priority/concurrency before Play; SpawnSoundAtLocation already starts playback.
- [general] In 5.8.2, `UAudioMixerBlueprintLibrary::StartRecordingOutput`/`StopRecordingOutput` wrote 20 s stereo PCM from the game's master mix. Offscreen sound voices played into silence: the default unfocused volume was 0. A capture-only `-ini:Engine:[Audio]:UnfocusedVolumeMultiplier=1.0` made the unchanged EXE audible, with zero clipped samples. WAV export is asynchronous: require fresh complete PCM, duration and nonzero data, then bind WAV/EXE hashes before capture completion.
- [general] Cadence auditions need paced gameplay as well as normal sample pitch. See [audio clock verification](unreal-native-packaging.md#pace-audio-captures).
