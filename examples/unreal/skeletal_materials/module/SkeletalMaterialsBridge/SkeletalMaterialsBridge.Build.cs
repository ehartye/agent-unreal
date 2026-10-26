using UnrealBuildTool;

// Editor-only module: it is listed with "Type": "Editor" in the project descriptor and only the Editor target builds it.
// USkeletalMesh, FSkeletalMaterial and UMaterialInterface are all in Engine.
public class SkeletalMaterialsBridge : ModuleRules
{
	public SkeletalMaterialsBridge(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine" });
	}
}
