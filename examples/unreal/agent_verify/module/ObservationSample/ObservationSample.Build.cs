using UnrealBuildTool;
public class ObservationSample : ModuleRules
{
    public ObservationSample(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new[] { "Core", "CoreUObject", "Engine", "InputCore", "Json", "AgentVerify" });
    }
}
