# Plugins, targets, configurations and project layout

Source for every `[documented]` line here: Epic's 5.8 pages "Plugins in Unreal Engine", "Unreal Engine Directory Structure", "Build Configurations Reference for Unreal Engine", "Unreal Engine Build Tool Target Reference", "Configuration Files in Unreal Engine" and "Recommended Asset Naming Conventions in Unreal Engine projects".

## Plugins

- `[documented]` Plugins are collections of code and data that can be enabled or disabled per project; code is not required, and a plugin may hold only content (then the descriptor's `CanContainContent` must be `true`). Engine plugins live in `Engine/Plugins/`, game plugins in the project's `Plugins/`.
- `[documented]` A `.uplugin` JSON descriptor is found automatically; `FileVersion` is the only required field. Each module entry needs `Name` and `Type`: Runtime, RuntimeNoCommandlet, Developer, Editor, EditorNoCommandlet or Program. Runtime modules load in all cases including shipped games; Developer modules never in shipping; Editor modules only when the editor starts.
- `[documented]` Plugins and modules sit in hierarchical levels and "can only depend on other Plugins or Modules at the same level or higher". A project module can depend on an Engine module, but an Engine module cannot depend on a project module, because the Engine and its plugins "must be able to build without a Project".
- `[documented]` Project modules depend on plugins by enabling them in the `.uproject`; plugins depend on other plugins in their own `.uplugin`. Plugin config files are not packaged with projects at present.
- `[documented]` Modules contain only code; plugins also carry assets and a `.uplugin`, so a plugin can be redistributed to other projects.

## Targets and configurations

- `[documented]` UBT has five target types: Game (standalone, needs cooked data), Client (no server code), Server (no client code), Editor and Program. A `.target.cs` derives from `TargetRules` and is named the file name plus "Target".
- `[documented]` Configurations: Debug (no optimization), DebugGame (game code unoptimized), Development (the editor's default), Shipping ("strips out console commands, stats, and profiling tools") and Test (Shipping with some of those enabled). Editor exists only in Debug, DebugGame and Development. In the project-only matrix Test, Client and Server have no available configurations, which implies (an inference; the page does not say so) that they need an engine built from source.
- `[documented]` Per-target switches tune Shipping and Test behaviour, for example `bUseLoggingInShipping`, `bAllowProfileGPUInTest` and `bForceCompileDevelopmentAutomationTests`. `EnablePlugins`, `DisablePlugins` and `OptionalPlugins` control plugins per target; a disabled plugin may still be referenced by the project file, so mark it optional.

## Configuration files

- `[documented]` Config files load in category order, base files first, then project `Default*.ini`, then platform and user files, with later files overriding earlier ones. Epic: "If possible, use the configuration files located in your project directory for finer control over configuration changes."
- `[documented]` Bind a setting to code with `UCLASS(config=<Category>)` and `UPROPERTY(Config)`; the section is `[/Script/ModuleName.ClassName]` without the `U` or `A` prefix. Console variables are generally set in `[ConsoleVariables]` of the project's `DefaultEngine.ini`.

## Folders and names

- `[documented]` Per module: `Public` for headers other modules need, `Private` for all `.cpp` files and the module implementation, `Internal` for cross-module includes inside one plugin or module; `Classes` "should not be added to". `Intermediate` and `Saved` can be deleted and rebuilt.
- `[documented]` Asset names follow `[AssetTypePrefix]_[AssetName]_[Descriptor]_[OptionalVariantLetterOrNumber]` (for example `SM_`, `SK_`, `M_`, `MI_`, `T_`, `BP_`, `WBP_`, `DT_`, `FXS_`). Epic calls it "only a recommendation": project requirements take precedence, and the prefix list is not exhaustive.

## Judgements built on it

- `[general]` Optional behaviour is a plugin candidate; a plugin the game cannot run without is a module. A game plugin that depends on the game's primary module inverts the direction Epic documents for the Engine, so report it as a finding with that analogy stated.
- `[general]` A project needs a Server or Client target only when it ships those builds. A missing `Target.cs` for a shipped build type is a finding; an unused one is not.
- `[general]` Naming and folder findings rank last. Check the project's own written convention first and report deviations from it, not from Epic's table.

## How to inspect

1. `[general]` List `.uproject` and every `.uplugin`: enabled plugins, module types, `CanContainContent`, and plugin-to-plugin dependencies. Mark any plugin that nothing uses.
2. `[general]` List `*.Target.cs` files and the configurations the project builds; note which need a source-built engine.
3. `[general]` Compare each plugin's dependencies with the level rule, and each module type with where its classes are used.

Next: [lifecycle and data](unreal-architecture-lifecycle.md).
