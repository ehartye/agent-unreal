---
name: unreal-native
description: Build, run, verify, package and profile a native C++ Unreal game from an agent: the build and capture loop, content-only versus native construction, presentation, input replay, material and UV validation, cooking and staging, frame-time profiling against a budget, and side-by-side comparison scenes. Not for importing assets (use engine-asset-import from agent-engine) or for choosing an Unreal system or scripting the editor from Python (use unreal-features).
when_to_use: Use when building native C++ for an Unreal game, running real gameplay and checking screenshots or automation results, cooking or staging a Windows build, replaying input in native tests, rejecting default-material cook fallbacks, diagnosing procedural-road or collision losses, profiling an Unreal game's frame time, hitting a frame budget such as 120 fps, costing +25% to +50% more content, or comparing implementations side by side on a stage.
---

# Native Unreal games

Unreal 5.8 on Windows, driven by an agent. Each reference holds the commands, the evidence behind them
and what was not verified. Importing assets is `engine-asset-import` (agent-engine);
choosing a system, Niagara and scripting the editor from Python are
[unreal-features](../unreal-features/SKILL.md).

| You are about to | Read |
|---|---|
| Build native C++, run real gameplay, verify screenshots and automation results | [Native game loop](references/unreal-native-game.md) |
| Generate materials and fonts, draw crisp Canvas text, diagnose exposure and palette | [Native presentation](references/unreal-native-presentation.md) |
| Cook and stage Windows; tell UAT policy failures from real Game EXE proof | [Native packaging](references/unreal-native-packaging.md) |
| Separate content-only asset construction from native gameplay and preserve cooked provenance | [Native content pipeline](references/unreal-native-content-pipeline.md) |
| Replay mapped input and diagnose retained trigger state during native tests | [Native input replay](references/unreal-native-input.md) |
| Reject default-material cook fallbacks and verify imported UV channel meaning | [Material and UV validation](references/unreal-native-material-validation.md) |
| Diagnose procedural-road loss and keep collision regression evidence separate | [Native contact case study](references/unreal-native-contact.md) |
| Profile frame time against a budget (120 fps), decompose game thread, render thread and GPU, run an ablation matrix and cost per item | [Native profiling](references/unreal-native-profiling.md); method in profiling method (`engine-phaser` skill, agent-engine) |
| Prove a performance fix exact, check engine source before predicting a cost, avoid Insights, nullrhi and PowerShell pitfalls | [Profiling facts](references/unreal-native-profiling-facts.md) |
| Put several ways of doing one visible thing side by side on a stage, film them, time each alone at N copies and write a receipt | [Comparison scene](references/unreal-native-compare-scene.md); source and runner in `examples/unreal/compare-scene` |
| Script the editor from Python: run modes, cameras, keyboard and gamepad input, process cleanup | [Editor Python](../unreal-features/references/unreal-editor-python.md) |
