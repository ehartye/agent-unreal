# Modules and dependencies

Source for every `[documented]` line here: Epic's 5.8 pages "Unreal Engine Modules", "Module Properties in Unreal Engine" and "Plugins in Unreal Engine".

## What Epic documents

- `[documented]` A module is "the basic building block" of the engine's architecture. Each has a `Build.cs` deriving from `ModuleRules`; Unreal Build Tool builds from `Target.cs` and `Build.cs` files, not from the IDE solution. Regenerate project files when a `Build.cs` changes or source files move between folders.
- `[documented]` List a module in `PublicDependencyModuleNames` when a public header needs it, and in `PrivateDependencyModuleNames` when only `.cpp` files do. Epic: "Private dependencies are preferred wherever possible", because they can cut compile times; forward-declaring in headers keeps many dependencies private.
- `[documented]` Headers in `Public` are exposed to every dependent module; headers in `Private` are not; every `.cpp` goes in `Private`. The `Public` and `Private` folders are unrelated to C++ access specifiers. A module at the end of the chain, such as the game's primary module, need not use the split.
- `[documented]` `PublicIncludePathModuleNames` and `PrivateIncludePathModuleNames` give header access without linking against the module.
- `[documented]` `CircularlyReferencedDependentModules` is "Only for legacy reason, should not be used in new code". `bValidateCircularDependencies` exists because circular module dependencies slow builds, and disabling it is "strongly discouraged".
- `[documented]` `bEnforceIWYU` enforces Include What You Use when `PCHUsage` is `ExplicitOrSharedPCH`: it warns on monolithic headers such as `Engine.h` and `UnrealEd.h` and checks that a source file includes its matching header first. `bValidateInternalApi` warns when a non-engine module uses internal API.
- `[documented]` `Type` is most often `Runtime` (in-game classes) or `Editor` (editor-only classes). A module can be included or excluded by platform, target (`Game`, `Server`, `Client`, `Editor`, `Program`) and configuration through the `IncludelistPlatforms` / `ExcludelistPlatforms` family of properties.
- `[documented]` `Default` loading phase suits most gameplay modules; a plugin whose classes the editor often fails to find can try `PreDefault`. Load order inside one phase is not deterministic, so a required order uses `LoadModule` or `LoadModuleChecked`.
- `[documented]` The `Modules` list in `.uproject` and `.uplugin` sets which modules load and how. A module that is in no dependency chain is not compiled.
- `[documented]` Plugins and modules sit in hierarchical levels and can only depend on others at the same level or higher; an Engine module cannot depend on a project module because the Engine "must be able to build without a Project". Editor modules load only when the editor starts and Developer modules never in shipping (see [layout](unreal-architecture-layout.md)).

## Judgements built on it

- `[general]` Dependencies point from the game toward lower-level and optional code: no Runtime module depends on an Editor module, because Editor modules load only when the editor starts and so are absent from a packaged game.
- `[general]` A game plugin that the project can run without should not depend on the game's primary module; Epic documents this direction for Engine versus project code, and the same reasoning applies. The game depends on the plugin, or both depend on a small shared module.
- `[general]` Epic gives no rule for how many modules a project needs or how to name them. Split a module when a boundary is real (a different load condition, an optional feature, an editor-only tool), not to look tidy.
- `[general]` Turning on `bEnforceIWYU` in an existing module surfaces monolithic includes as warnings you can fix one module at a time.

## How to inspect

1. `[general]` List every `*.uproject`, `*.uplugin` and `*.Build.cs`. For each module record its `Type`, loading phase, platform and target conditions, and its public and private dependency lists.
2. `[general]` Draw the edges. Flag any edge from a Runtime module to an Editor module, any edge from a plugin to the game module, and any cycle, including one hidden by `CircularlyReferencedDependentModules`.
3. `[general]` For each public dependency, search the module's `Public` headers for a type from it. No hit means the dependency can move to private.
4. `[general]` Search headers for `#include "Engine.h"` and other monolithic includes, and for `Public` headers that include a sibling module's `Private` path.

Next: [state ownership](unreal-architecture-ownership.md) for what the module holds, or the [audit](unreal-architecture-audit.md) for how to report it.
