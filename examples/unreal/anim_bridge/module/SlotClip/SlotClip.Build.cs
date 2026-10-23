using UnrealBuildTool;

// Runtime module: the AnimInstance parent class belongs in the game module, not in the editor module.
public class SlotClip : ModuleRules
{
	public SlotClip(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine" });
	}
}
