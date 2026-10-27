# Native Windows packaging: receipt staging, UnrealPak and the packaged runtime proof

Continues [native packaging](unreal-native-packaging.md): the same consuming project on an earlier engine build, observed there and not reproduced in this repo. A real packaged executable was run; no final-game or visual-parity claim follows.

## Receipt staging and native UnrealPak

- [general] A finite PowerShell stager read `Binaries/Win64/MyGame.target`. It copied executable/dynamic-library/required-resource build products and NonUFS runtime dependencies, skipped debug-only products, and built UFS entries from runtime receipt dependencies plus the actual cooked files. It rejected missing files and unsupported roots instead of guessing paths.
- [general] Receipt roots `$(ProjectDir)` and `$(EngineDir)` mapped to the package's project-name and Engine directories. Cooked Metadata was excluded. Config and plugin config were staged deliberately. Native UnrealPak consumed a UTF-8 response list mapping sources to `../../../Project/...` and `../../../Engine/...`; the resulting pak mounted at `../../../` in the actual game log.
- [general] Staging also included Windows DDPI's **icudt64l** English ICU data at `Engine/Content/Internationalization/icudt64l`, Engine en localization, app-local VC/DirectX DLLs beside the executable, and an empty **Engine/Config/StagedBuild_MyGame.ini outside the pak**. The marker lets native startup find the staged project directory before mounting paks. Installed UAT staging source supplied these contracts; receipt DLLs alone were insufficient as a complete recipe.
- [general] Source font OFL files and source metadata were copied from the exact archived tree into ThirdPartyNotices. Font binaries were already in cooked FontFace assets. The delivery was a Development Game executable of a few hundred MB, not a size-optimized Shipping build.

```text
UnrealPak.exe MyGame-Windows.pak -Create=pak-response.txt -compress -UTF8Output
```

Every response entry quotes both paths, for example `"source-file" "../../../MyGame/Content/Maps/MyMap.umap"`. Keep non-UFS DLLs and the staged marker physically accessible. A direct native executable may live at `MyGame/Binaries/Win64/MyGame.exe`; do not assume a UAT-created root bootstrap exists. A small relative-path launch script can expose it to the player without requiring the Editor.

## Actual packaged runtime proof

- [general] The **Game executable**, not UnrealEditor, ran its scenarios offscreen on D3D12 on a discrete GPU. Each delivered a fresh 1920×1080 PNG and matching native JSON; the images were opened. The log mounted the staged pak. App-local runtime DLLs and the OFL notices were present.
- [general] Scenario receipts sampled actor count, player displacement, speed, grounded wheels and weapon execution. These establish sampled native motion/control-command execution. They do not establish a completed session or physical keyboard/controller interaction.
- [general] Performance acceptance needs the profiling method in [native profiling](unreal-native-profiling.md), run on the immutable package with the sampler built into it.
- [general] Preserve visual GAP status, known HUD/world issues and open full-play/input/audio/performance acceptance. A locally running native package does not establish cross-machine portability; another clean Windows machine remains a separate test.
