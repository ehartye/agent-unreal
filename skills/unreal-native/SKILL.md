---
name: unreal-native
description: "Build, run, verify, package and profile a native C++ Unreal game: the build and capture loop, content-only versus native construction, presentation, input replay, cooking and staging, frame-time profiling against a budget, and comparison scenes. Not for importing assets (use unreal-import), choosing an Unreal system (the unreal-* domain skills), editor Python (use unreal-editor-scripting) or auditing tests, CI or structure (use unreal-quality or unreal-architecture)."
when_to_use: "Use when profiling frame time on a quiet machine, hitting a frame budget, reading a frame-time percentile, costing new content, capturing an Insights trace (utrace) or exporting timer statistics headless; when building native C++, checking screenshots or automation results, replaying input, or staging a Windows build that falls back on an uncooked asset; when a build fails on code you did not change (adaptive unity) or a content step hits locked files (PermissionError); when Canvas text draws nothing, static parts sit at the world origin or a car falls through a procedural road; or when comparing implementations on stage."
---

# Native Unreal games

- [general] Before any build, editor, game, commandlet or package, read the consumer launcher instructions and the [shared launcher](references/unreal-engine-launcher.md). Use its owned process tree; retain an existing consumer launcher until migration is separately verified.

Unreal 5.8 on Windows, driven by an agent. Each reference holds the commands, the evidence behind them
and what was not verified. Importing assets is `unreal-import`;
choosing a system and Niagara are the domain skills (for example
[unreal-effects](../unreal-effects/SKILL.md)); scripting the editor from Python is
[unreal-editor-scripting](../unreal-editor-scripting/SKILL.md). This skill runs, captures and profiles; judging
whether a project's tests, CI and performance claims can be trusted is [unreal-quality](../unreal-quality/SKILL.md), and
reviewing its module and state structure is [unreal-architecture](../unreal-architecture/SKILL.md).

| You are about to | Read |
|---|---|
| Start an engine process, diagnose an engine lock, or adopt the prescribed launcher | [Shared launcher](references/unreal-engine-launcher.md) |
| Pin the compiler, run real gameplay, verify screenshots, or find static parts at the world origin (`is not static`) | [Native game loop](references/unreal-native-game.md) |
| Add plugins and modules to a native game, or fix a first C++ compile error | [Module setup](references/unreal-native-module-setup.md) |
| Diagnose a build that passes then fails on code you did not change (adaptive unity, chunking, the git working set) | [Unity builds](references/unreal-native-unity-builds.md) |
| Fix C2374, C2086, C4459 or C2872, name file-scope symbols safely, turn the grouping off, and gate replay and test steps on the build | [Unity build fixes](references/unreal-native-unity-build-fixes.md) |
| Write a C++ automation test for 5.8, run it headless, read its report and why the exit code is not the verdict | [Automation tests](references/unreal-native-automation-tests.md) |
| Generate materials and fonts, draw crisp Canvas text (it draws nothing without a `UFont`), record native audio | [Native presentation](references/unreal-native-presentation.md) |
| Diagnose a near-black first frame, physical-camera exposure, an HDR palette pass or imported vertex colour that hides detail | [Exposure and vertex colour](references/unreal-native-exposure-and-vertex-color.md) |
| Cook Windows; tell UAT policy failures from real Game EXE proof; cook a folder that code loads only by path | [Native packaging](references/unreal-native-packaging.md) |
| Stage a cooked build from the target receipt, create the pak with UnrealPak, and read what a packaged Game EXE run proves | [Packaging staging](references/unreal-native-packaging-staging.md) |
| Build a Server target on a Launcher install, or run a packaged Game (`-server`, `?listen`) or the editor binary as a server and read what each did | [Dedicated server](references/unreal-native-dedicated-server.md) |
| Check a staged build with a packaged smoke run: windowed start, log read, world counts | [Packaged smoke run](references/unreal-native-packaged-smoke.md) |
| Separate content-only asset construction from native gameplay and preserve cooked provenance | [Native content pipeline](references/unreal-native-content-pipeline.md) |
| Import rigid GLB controls and WAVs through the content-only bake, or read what the second-generation runtime proof did and did not show | [Content pipeline assets](references/unreal-native-content-pipeline-assets.md) |
| Replay mapped input and diagnose retained trigger state during native tests | [Native input replay](references/unreal-native-input.md) |
| Reject default-material cook fallbacks and verify imported UV channel meaning | [Material and UV validation](references/unreal-native-material-validation.md) |
| Diagnose a body that falls through a procedural surface, a sweep that finds no wall, and keep collision regression evidence separate | [Native contact case study](references/unreal-native-contact.md) |
| Profile frame time against a budget (120 fps), decompose game thread, render thread and GPU, run an ablation matrix and cost per item | [Native profiling](references/unreal-native-profiling.md); the engine-neutral method is in the `phaser-verification` skill, agent-phaser |
| Read a measured ablation table, per-item cost model and fix results to see what a profile looks like | [Profiling measurements](references/unreal-native-profiling-measurements.md) |
| Capture an Unreal Insights trace, mark a region, export timer statistics headless and judge the 99th percentile and maximum frame time | [Insights capture](references/unreal-native-insights-capture.md); runner in [insights_capture](../../examples/unreal/insights_capture/README.md) |
| Prove a performance fix exact, check engine source before predicting a cost, avoid Insights, nullrhi and PowerShell pitfalls | [Profiling facts](references/unreal-native-profiling-facts.md) |
| Put several ways of doing one visible thing side by side on a stage, film them, time each alone at N copies and write a receipt | [Comparison scene](references/unreal-native-compare-scene.md); source and runner in [compare-scene](../../examples/unreal/compare-scene/README.md) |
| Read GPU, game thread, render thread and wall time of each candidate in a comparison run, headless and rendered, or reproduce that run end to end | [GPU time in the comparison scene](references/unreal-native-compare-gpu-time.md) |
| Script the editor from Python: run modes, cameras, keyboard and gamepad input, process cleanup | [Editor Python](../unreal-editor-scripting/references/unreal-editor-python.md) |
