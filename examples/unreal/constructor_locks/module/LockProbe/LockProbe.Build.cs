using UnrealBuildTool;

// A runtime module (it loads in the editor and in a game); the two kinds of actor in LockProbeActors.h are the subject of the test.
public class LockProbe : ModuleRules
{
	public LockProbe(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine" });
	}
}
