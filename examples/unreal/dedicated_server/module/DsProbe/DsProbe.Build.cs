using UnrealBuildTool;

// The game module of the dedicated-server probe: one replicated Actor and a Game Mode that spawns it.
// NetCore is where the replication macros (DOREPLIFETIME) live.
public class DsProbe : ModuleRules
{
	public DsProbe(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "NetCore" });
	}
}
