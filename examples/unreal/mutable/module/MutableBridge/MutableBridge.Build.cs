using UnrealBuildTool;

// Editor-only module: it is listed with "Type": "Editor" in the project descriptor and only the Editor target builds it.
// CustomizableObjectEditor is the Mutable plugin's editor module (the graph schema, the node base class and the editor library). Its node classes
// sit in its Private folder, so this module reaches them by reflection (class name, property name, pin name) and links only what the module exports.
public class MutableBridge : ModuleRules
{
	public MutableBridge(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine" });
		PrivateDependencyModuleNames.AddRange(new string[] { "UnrealEd", "CustomizableObjectEditor" });
	}
}
