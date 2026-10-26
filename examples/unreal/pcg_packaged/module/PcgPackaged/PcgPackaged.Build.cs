using UnrealBuildTool;

// The game module of the packaged PCG probe. PCG is the plugin module that holds UPCGComponent, APCGWorldActor and the runtime generation scheduler;
// Json writes the receipt; RHI gives GUsingNullRHI and the adapter name.
public class PcgPackaged : ModuleRules
{
	public PcgPackaged(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "PCG" });
		PrivateDependencyModuleNames.AddRange(new string[] { "Json", "RHI" });
	}
}
