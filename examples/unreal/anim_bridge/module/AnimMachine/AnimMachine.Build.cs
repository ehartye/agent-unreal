using UnrealBuildTool;

// Runtime module: the AnimInstance parent class of the state machine and linked layer Animation Blueprints.
public class AnimMachine : ModuleRules
{
	public AnimMachine(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine" });
	}
}
