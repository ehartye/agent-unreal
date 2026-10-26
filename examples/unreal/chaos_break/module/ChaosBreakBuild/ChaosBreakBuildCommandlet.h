#pragma once

#include "CoreMinimal.h"
#include "Commandlets/Commandlet.h"
#include "ChaosBreakBuildCommandlet.generated.h"

/**
 * Builds Geometry Collection assets from a static mesh and writes a JSON report. Run it as a commandlet:
 *
 *   UnrealEditor-Cmd.exe Project.uproject -run=ChaosBreakBuild -Report=<json> [-Mesh=/Engine/BasicShapes/Cube.Cube] [-OutDir=/Game/Chaos]
 *       [-Variants=healthy+nohull+update_hulls+simdata_first+fine_spacing] [-Sites=24] [-Seed=7] [-Material=engine|project]
 *
 * Variants (each is one asset named GC_<variant>):
 *   healthy        append, Voronoi fracture, GetValidConvexHullData, invalidate, CreateSimulationData.
 *   nohull         the same without the hull step (the negative control: a collection that loads and never breaks).
 *   update_hulls   the engine's own editor route: UGeometryCollection::UpdateGeometryDependentProperties instead of GetValidConvexHullData.
 *   simdata_first  CreateSimulationData before the hulls, with no second invalidate (tests the order the reference leaves open).
 *   fine_spacing   healthy with a noise point spacing of 1 cm (the asset-size claim).
 */
UCLASS()
class UChaosBreakBuildCommandlet : public UCommandlet
{
	GENERATED_BODY()

public:
	UChaosBreakBuildCommandlet(const FObjectInitializer& ObjectInitializer);
	virtual int32 Main(const FString& Params) override;
};
