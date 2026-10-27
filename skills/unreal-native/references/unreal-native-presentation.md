# Native Unreal materials, fonts and Canvas text

Observed in one consuming project on an earlier engine build; not reproduced in this repo. Engine source inspection and executed behaviour are labelled separately. These are editor/native-game integration observations, not screenshot-reference acceptance. The [native game loop](unreal-native-game.md) covers compiler selection, capture completion, tests and current cook/package status; exposure, palette and imported vertex colour are in [exposure and vertex colour](unreal-native-exposure-and-vertex-color.md).

## Editor asset generation and fonts

- [general] Native unlit material graphs were created and explicitly saved under `/Game/Art`. Connecting `VertexColor` output **"RGB"** failed even though the node looks RGB in the editor. Its compound RGB output has an **empty** name; `""` connects it, while `"A"` connects alpha. Check every material connection boolean instead of assuming success.
- [general] `FontFileImportFactory` through automated `AssetTools.import_asset_tasks` **crashed a Python commandlet** at `SlateApplication::CurrentApplication.IsValid()`. Python try/except could not catch the native assertion. Switching construction to the full Editor initialized Slate and imported/saved the actual fonts without fallback.
- [general] The working construction command was full `UnrealEditor.exe -ExecutePythonScript=... -RenderOffScreen -nullrhi -unattended`. Automatic exit when the synchronous script returns is correct here. It is wrong for a later tick-driven gameplay capture.
- [general] Source fonts plus their individual SIL OFL licenses were vendored from a pinned commit of the official Google Fonts repository. Builds did not depend on Windows font installation or a live download. `FontFileImportFactory.batch_create_font_asset = BatchCreateFontAsset.YES` created FontFace plus matching UFont; discover their actual types/names, rename the UFont deliberately and save both.
- [general] An empty map saved successfully; native BeginPlay built the actual game world. Asset generation success did not establish correct exposure or typography in the first runtime frame.
- [general] Imported runtime fonts initially looked blurred because legacy Canvas text rasterized at its small default size and then scaled those glyphs up. Keep the font import; copy `Font->GetLegacySlateFontInfo()`, set its `Size` to the actual desired font point size and use `FCanvasTextItem(position, text, SlateFontInfo, color)` with `Item.Scale=(1,1)`. Recaptured text was crisp. Slate uses 96 DPI (a 0.75 point-to-pixel factor was used here); measure the same explicit font info for right alignment instead of scaling legacy metrics. This uses the runtime glyph cache while still drawing into Canvas.
- [documented] That route works because the font info carries a `UFont`. `FCanvasSimpleTextItem` sets `Font = Cast<UFont>(FontInfo.FontObject)` (`Engine/Source/Runtime/Engine/Public/CanvasItem.h`), its `HasValidText()` is `Font != nullptr`, and `FCanvasTextItemBase::Draw` returns before drawing when that is false (`Engine/Source/Runtime/Engine/Private/UserInterface/CanvasItem.cpp`). A font info built from a composite font, such as `FCoreStyle::GetDefaultFontStyle(...)`, has a null `FontObject` (`Engine/Source/Runtime/SlateCore/Private/Fonts/SlateFontInfo.cpp`), so Canvas draws nothing and logs nothing.
- [general] Observed once in a consuming project on an earlier engine build: with a default-style Slate font info, a HUD's shapes drew and its words did not, with no error.
- [documented] A project with no font assets still has the engine's own fonts: Roboto Light, Regular and Bold load from `Engine/Content/Slate/Fonts` (`LegacySlateFontInfoCache.cpp`). `UEngine::GetSmallFont()` and `GetMediumFont()` return a `UFont`, a loaded font asset or the fallback that `UEngine::InitializeObjectReferences` builds: a transient `UFont` with the Runtime cache and `RuntimeFontSource = ERuntimeFontSource::CoreStyleDefault`. Build one the same way and hold it so it is not collected; the typeface name picks the weight.

```cpp
UFont* Font = NewObject<UFont>(GetTransientPackage(), NAME_None, RF_Transient);
Font->FontCacheType = EFontCacheType::Runtime;
Font->RuntimeFontSource = ERuntimeFontSource::CoreStyleDefault;
FontHolder.Reset(Font);                          // TStrongObjectPtr<UFont> member
const FSlateFontInfo Info(Font, 18.f, TEXT("Bold")); // "Light", "Regular" or "Bold"
```

- [general] The fix observed once in that project copied the default composite font into the transient `UFont` instead (`Font->GetMutableInternalCompositeFont() = *FCoreStyle::GetDefaultFont();`; the public `CompositeFont` member is deprecated since 5.7, `Engine/Source/Runtime/Engine/Classes/Engine/Font.h`). The snippet above was not compiled or run in this repo, and whether a packaged build stages `Engine/Content/Slate/Fonts` is unchecked.

```powershell
& "$ueRoot/Engine/Binaries/Win64/UnrealEditor.exe" $uproject "-ExecutePythonScript=$projectRoot/Scripts/build_content.py" -RenderOffScreen -nullrhi -unattended -nosplash -nosound -notraceserver "-abslog=$projectRoot/Saved/Logs/content.log"
if ($LASTEXITCODE -ne 0) { throw 'Editor content generation failed' }
```

Keep editor asset creation separate from shipped runtime modules. Explicitly save materials, fonts and map; reopen from disk and cook before claiming persistence. Assets loaded only by path need their folder in `DirectoriesToAlwaysCook` ([packaged smoke run](unreal-native-packaged-smoke.md)); here `/Game/Art` was explicit.

## Inspect generated scenery and varied native lettering

- [general] A capture-only camera location/target override enabled close native inspection of generated interiors. Keep overrides restricted to a named capture scenario; validate both vectors, finite coordinates, a world bound and distinct target. `FParse::Value(..., false)` preserves comma-separated XYZ values (its default stops at commas). In the installed engine source, `LexTryParseString` is declared in `String/LexFromString.h`. Record actual camera values in the native receipt and compare them with requested values; hide menu Canvas only for that inspection. A close inspection frame does not replace normal gameplay-view evidence.
- [general] Several distinct display font families plus a body family imported and cooked in a fresh content-only Editor bake, each from pinned source bytes with its own bundled OFL notice. A review found that reusing any existing UFont could certify an old fallback as the desired source font. A strict importer should tag successful imports with a source SHA-256, reject untagged/mismatched reuse, and raise on import failure without creating a fallback. Validate actual runtime font loads separately from source hashes and Editor import success.
- [general] Production captions rendered using the explicit-size SlateFontInfo Canvas path, with a rotated local Canvas transform, burst silhouettes and layered glyph keylines. A runtime loaded-font mask confirmed every display family. This establishes availability and the sampled rendered captions, not legibility of every font/treatment; retain actual frames for each combination being judged.

## Record native audio

- [documented] In the installed engine source, AudioComponent copies priority into ActiveSound at Play. Configure priority/concurrency before Play; SpawnSoundAtLocation already starts playback.
- [general] In the consuming project, `UAudioMixerBlueprintLibrary::StartRecordingOutput`/`StopRecordingOutput` wrote 20 s stereo PCM from the game's master mix. Offscreen sound voices played into silence: the default unfocused volume was 0. A capture-only `-ini:Engine:[Audio]:UnfocusedVolumeMultiplier=1.0` made the unchanged EXE audible, with zero clipped samples. WAV export is asynchronous: require fresh complete PCM, duration and nonzero data, then bind WAV/EXE hashes before capture completion.
- [general] Cadence auditions need paced gameplay as well as normal sample pitch. The engine's fixed-step/benchmark branch bypasses frame waiting (`UnrealEngine.cpp`), so MaxFPS alone cannot pace it. For an isolated 60Hz master recording, save FApp's fixed-step/benchmark flags and engine fixed-rate/FPS; during recording disable the former and enable engine fixed 60FPS. Restore on normal stop and teardown. One project observed 19.65 simulation seconds during 20.0095 wall seconds (ratio 0.9820), with settings restored. Validate both clocks, tick rate and restoration beside WAV/EXE hashes. Use the project's own rate, not 60 universally, and only for explicit captures. A normal-cadence excerpt is not a sustained-performance test or owner approval.
