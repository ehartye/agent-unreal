# Game Features and modular gameplay

Source for every `[documented]` line here: Epic's 5.8 pages "Game Features and Modular Gameplay in Unreal Engine" and "Lyra Sample Game in Unreal Engine".

## What Epic documents

- `[documented]` Game Feature plugins keep the codebase clean and avoid "accidental interactions or dependencies between unrelated features", which Epic calls especially important for live products whose feature sets change.
- `[documented]` Setup: enable the Game Features and Modular Gameplay plugins, add a new plugin of type Game Feature (Content Only), save it under `/Plugins/GameFeatures/`, then create a `GameFeatureData` data asset named after the plugin. Restart the editor once if a new feature does not work, because `GameFeatureData` assets load at editor startup.
- `[documented]` Behaviour comes from Actions in the `GameFeatureData` asset: Add Cheats, Add Components, Add Data Registry, Add Data Registry Source and Add World Partition Content.
- `[documented]` Add Components is "the most common way" to use these plugins. The components come from the plugin; the actor class is an engine class such as `Pawn` or a project child; and the components "should handle all program logic and data storage related to your feature". Keeping the required interaction with the project's actor subclass minimal makes the feature reusable.
- `[documented]` Target the narrowest actor subclass that needs the component. The base `Actor` class in an Add Components action is unsupported and that part of the action is ignored. Use several actions when targets share no common parent.
- `[documented]` To receive components an actor must register with `UGameFrameworkComponentManager` by passing itself to `AddReceiver`, generally in `BeginPlay`.
- `[documented]` Cheat Manager Extensions added by a feature do not instantiate in Shipping builds.
- `[documented]` Lyra keeps only generic assets and the main lobby in `Content`; the game lives in Game Feature plugins (ShooterCore, ShooterMaps, TopDownArena) that load when an experience is chosen.
- `[documented]` A `LyraExperienceDefinition` is "a much more advanced version of a GameMode", selected through World Settings. Several experiences can share a plugin and a parent class.
- `[documented]` Lyra's UI features are designed so their systems can be used "independent of Lyra".

## What the pages do not state

- `[general]` Epic's captured pages give no rule for the dependency direction between a feature and the base game, how to share data between features, or when a feature deserves a plugin. Do not cite Epic for any of those.
- `[general]` Lyra is a sample game meant as a learning resource, not a prescribed layout. Use it as a worked example of the mechanism, and say so in a finding.

## Judgements built on it

- `[general]` A good candidate for a Game Feature is behaviour the project could ship without: an optional mode, a seasonal event, a cheat set. A bad candidate is behaviour every actor needs, which belongs in the base game.
- `[general]` The feature should depend on the base game's public types, and the base game should not hard-reference the feature's content. Test this by disabling the feature: the game should still build, load and run.
- `[general]` A feature that reaches into the base game's private headers or player controller loses the isolation Epic describes; move the shared contract to a small interface or to a game instance subsystem.
- `[general]` For an existing project, extract one feature as a pilot before moving others, and keep the extracted feature's data in its own plugin folder.

## Check

1. `[general]` Which behaviour could be absent in some builds or modes? That is the candidate list.
2. `[general]` For each candidate, what does the base game reference directly? Each hard reference is an obstacle.
3. `[general]` After the move, disable the feature and confirm the base game still builds and plays.

Next: [content references](unreal-architecture-content.md) for what the feature's assets pull in.
