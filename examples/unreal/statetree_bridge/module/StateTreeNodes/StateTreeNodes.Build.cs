using UnrealBuildTool;

// Runtime module: the custom task and condition structs, their instance data and the actors that run the tree. The editor module
// names the structs in AddTask<T>() and AddConditionWithOuter<T>(), so they sit in Public/ with STATETREENODES_API on each type.
public class StateTreeNodes : ModuleRules
{
	public StateTreeNodes(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "AIModule", "StateTreeModule", "GameplayStateTreeModule" });
	}
}
