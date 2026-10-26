using UnrealBuildTool;

// The module list a native GAS module names. Each module the code calls into is named here: with only GameplayAbilities listed the
// module compiles (the include paths are transitive) but fails to link, with unresolved symbols from GameplayTags and GameplayTasks.
// NetCore is for the replicated-play scenario (GasNativeRep): the replication macros live in Engine and NetCore.
public class GasNative : ModuleRules
{
	public GasNative(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "GameplayAbilities", "GameplayTags", "GameplayTasks", "Json", "NetCore" });
	}
}
