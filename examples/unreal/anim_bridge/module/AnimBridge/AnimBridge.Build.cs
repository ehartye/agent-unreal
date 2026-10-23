using UnrealBuildTool;

// Editor-only module: it is listed with "Type": "Editor" in the project descriptor and only the Editor target builds it.
public class AnimBridge : ModuleRules
{
	public AnimBridge(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "UnrealEd", "BlueprintGraph", "AnimGraph", "AnimGraphRuntime" });
	}
}
