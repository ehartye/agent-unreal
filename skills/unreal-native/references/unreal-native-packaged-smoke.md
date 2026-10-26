# Packaged smoke run for a native game

Observed once in a consuming Unreal 5.8.x project on Windows; the checklist was not run from this repo. A packaged build can boot, run and quietly fall back; replays and automation tests run in the editor build and cannot see a cooking gap. Run this on the staged executable, not the editor, after [staging](unreal-native-packaging.md).

- [general] Observed once on 5.8.x: a character loaded a camera asset by path string. Every editor-build replay and test passed; the first rebuilt package booted and ran, its log named the missing asset, a fallback drew the view, and the cook gave no warning. The folder was not referenced by anything, so it was not cooked; the fix is the `DirectoriesToAlwaysCook` entry in [assets loaded only by path](unreal-native-packaging.md#assets-loaded-only-by-path). Whether a soft object path set on a data asset is found by the cook's reference scan is unverified; only the string case was seen.

## Checklist

1. [documented] Start the staged executable windowed: `MyGame.exe -Windowed -ResX=1280 -ResY=720 -unattended "-abslog=<fresh folder>/smoke.log"`. The engine reads `-Windowed` (`Engine/Source/Runtime/Engine/Private/GameEngine.cpp`).
2. [general] Observed once: a packaged game started full screen with no display attached crashed at swapchain creation with `DXGI_ERROR_NOT_CURRENTLY_AVAILABLE`. Ask for a window in any unattended session.
3. [general] Leave the game idle for a bounded time, as a person who opened it would, then exit through the game's own exit path.
4. [general] Read the log for lines that name a missing asset or a missing usage flag. The exact text was not recorded; treat any line that names an asset path the game could not find as a failure.
5. [general] Read the world, not only the log: the game's own state receipt should count what must exist (actors, components, assets). A fallback can hide behind a healthy log.
6. [general] Run it again after every change that adds an asset loaded by path, and keep each log.

## Lines that were harmless in a clean log

- [general] Observed once: optional debugger libraries that fail to load, a socket asked for before its mesh is there, and a StateTree's stop at shutdown. A clean log from a different project may carry others; compare against a known-good log of the same build.

## Not covered

- [general] Replays, performance and input are separate checks ([packaging](unreal-native-packaging.md), [profiling](unreal-native-profiling.md)). No packaged smoke script exists in this repo and none of these steps was run here, so none carries `[tested]`.
