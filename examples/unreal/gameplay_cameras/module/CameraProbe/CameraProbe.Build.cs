using UnrealBuildTool;

// Runtime module: the pawn, controller and game mode belong to the game, not to an editor module.
// GameplayCameras is a plugin module (Engine/Plugins/Cameras/GameplayCameras); the project descriptor must enable the plugin.
// Json is for the report. The GameplayCameras public dependencies (EnhancedInput, StateTreeModule, GameplayTags and others) reach
// this module's include paths through GameplayCameras itself.
public class CameraProbe : ModuleRules
{
	public CameraProbe(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "GameplayCameras", "Json" });
	}
}
