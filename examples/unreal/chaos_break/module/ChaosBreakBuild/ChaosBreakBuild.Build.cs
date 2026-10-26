using UnrealBuildTool;

// Editor-only module: AppendStaticMesh and AppendMeshDescription sit inside WITH_EDITORONLY_DATA, so a collection is built in the editor
// or in a commandlet. Module names: FractureEngine and PlanarCut come from the Fracture and PlanarCut plugins, DataflowCore and
// GeometryCollectionEngine are engine modules.
public class ChaosBreakBuild : ModuleRules
{
	public ChaosBreakBuild(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core", "CoreUObject", "Engine", "UnrealEd", "AssetRegistry",
			"GeometryCollectionEngine", "FractureEngine", "PlanarCut", "DataflowCore",
		});
		SetupModulePhysicsSupport(Target);
	}
}
