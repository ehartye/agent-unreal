# State ownership and lifetimes

Source for every `[documented]` line here: Epic's 5.8 pages "Gameplay Framework in Unreal Engine" and "Programming Subsystems in Unreal Engine".

## Where each kind of state can live

| Lifetime and scope | Owner | Replicated | What Epic says belongs there |
|---|---|---|---|
| Whole process | Engine subsystem (`UEngineSubsystem`) | No | Systems that must exist as long as the engine module is loaded |
| Whole game session, across level loads | Game instance, or a `UGameInstanceSubsystem` | No | "Anything that you want to persist between level loads should live in the game instance", such as the save-game system |
| One local player | `ULocalPlayerSubsystem` | No | Per-local-player systems |
| One level | Game mode (server only) | No | Session rules and structure; it creates the other framework actors |
| All players, one level | Game state | Yes | Team scores, objectives, the player list |
| One player, one level | Player state | Yes | Health, ammo, inventory of that player |
| A player's decisions | Controller | Controller is not replicated to others | Player controller processes input; AI controller directs a pawn |
| The physical body | Pawn and its components | Per actor | Collision, mesh, movement |

## What Epic documents

- `[documented]` Subsystems are "automatically instanced classes with managed lifetimes" in four scopes: Engine, Editor, GameInstance and LocalPlayer. Epic lists as reasons to use one: avoiding overrides of engine classes, avoiding more API on a busy class, Blueprint and Python access, and modularity.
- `[documented]` Subsystems are "particularly useful when creating plugins": the author knows exactly when the subsystem is instanced and initialized, so the user needs no wiring instructions.
- `[documented]` A `UGameInstanceSubsystem` is created after the game instance, `Initialize()` runs when the game instance initializes, `Deinitialize()` when it shuts down, and the object is then garbage-collected if nothing else references it. Access is `GameInstance->GetSubsystem<T>()`.
- `[documented]` The game instance is created at engine launch, lives until shutdown and is not replicated; it exists independently on the server and every client.
- `[documented]` The game mode is server-side, is not persistent across levels, is created right after the level loads, can be set per map and creates the game state and one player state per player.
- `[documented]` Game state and player state replicate between server and clients. Game state holds data and logic for all players; player state holds data and logic for one player.
- `[documented]` Controllers have no presence in the world; pawns are the physical manifestation, possessed and directed by controllers, and are built from actor components. Epic presents the framework classes as a foundation from which developers "pick and choose".
- `[documented]` Game Instance Subsystems are for "systems and functionality that should exist for the lifetime of the game".

## Judgements built on it

- `[general]` Match-scoped values (score, wave number) kept on the game instance must be reset by hand on level change; the documented level-scoped homes are game state for shared values and player state for per-player values.
- `[general]` A value kept on a controller is not on the replicated per-player class; if clients or other players read it, player state is the documented home.
- `[general]` Epic's pages state no rule that separates gameplay rules from presentation. A workable split is rules in game mode, game state and components, and presentation in widgets and the HUD that react to state changes or events. Treat a violation as a maintainability finding, not a rule break.
- `[general]` When a game instance subclass accretes unrelated systems, a game instance subsystem per concern is the lighter alternative the subsystem page itself uses in its worked example.
- `[general]` Inspect the class that owns each field. List persistent and per-match fields, name each one's lifetime, and compare it with the table above; a mismatch is a finding with the owning class and field as evidence.

## Check before you move state

1. `[general]` Who reads and writes it? Search call sites in code and Blueprint.
2. `[general]` Does it need to survive a level load, or be visible to clients?
3. `[general]` Is a subsystem enough, or does it need to replicate (then game state or player state)?

Next: [Game Features](unreal-architecture-features.md) for optional behaviour, or the [remediation plan](unreal-architecture-remediation.md).
