using UnrealBuildTool;

// Editor-only module: it is listed with "Type": "Editor" in the project descriptor and only the Editor target builds it.
// StateTreeEditorModule holds the factory, UStateTreeState, the editor data and the compiler entry point.
public class StateTreeBridge : ModuleRules
{
	public StateTreeBridge(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] {
			"Core", "CoreUObject", "Engine", "UnrealEd", "AssetTools",
			"StateTreeModule", "StateTreeEditorModule", "GameplayStateTreeModule", "PropertyBindingUtils", "StateTreeNodes" });
	}
}
