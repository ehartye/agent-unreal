using UnrealBuildTool;

public class UnityProbe : ModuleRules
{
	public UnityProbe(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine" });
		// A game module with fewer than TargetRules.MinGameModuleSourceFilesForUnityBuild (32) source files is not built as unity at all.
		// Lowering the module's own threshold makes this three-file module a unity module, as a larger game module is.
		MinSourceFilesForUnityBuildOverride = 1; // UNITY_SETTING
	}
}
