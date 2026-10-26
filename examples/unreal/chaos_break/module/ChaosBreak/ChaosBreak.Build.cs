using UnrealBuildTool;

// Runtime module: it runs inside a game process. The break scenarios are driven from here so that the verification does not depend on an
// editor script. Module names are the ones the engine's GeometryCollectionEngine module lists as public dependencies.
public class ChaosBreak : ModuleRules
{
	public ChaosBreak(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "GeometryCollectionEngine" });
		SetupModulePhysicsSupport(Target);
	}
}
