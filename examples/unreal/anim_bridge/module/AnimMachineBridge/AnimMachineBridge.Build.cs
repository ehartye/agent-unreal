using UnrealBuildTool;

// Editor-only module: it is listed with "Type": "Editor" in the project descriptor and only the Editor target builds it.
public class AnimMachineBridge : ModuleRules
{
	public AnimMachineBridge(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "UnrealEd", "BlueprintGraph", "AnimGraph", "AnimGraphRuntime" });
	}
}
