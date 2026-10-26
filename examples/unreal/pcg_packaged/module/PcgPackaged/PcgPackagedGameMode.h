#pragma once
#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "GameFramework/GameModeBase.h"
#include "PcgPackagedGameMode.generated.h"

class UPCGComponent;

/** A game mode that watches PCG in a cooked game and writes a JSON receipt, then exits. It changes nothing in the level: it only reads.
 *
 * Started with the `game=` URL option on any map (`<Map>?game=/Script/PcgPackaged.PcgPackagedGameMode`) and these command-line values:
 *   -PcgReport=<file>      where the receipt goes (required; rewritten every two seconds, so a crash leaves a partial one with "complete": false)
 *   -PcgMode=runtime       (default) watch every PCG component in the loaded level for -PcgSeconds (20); then call Generate(true) on each component whose trigger
 *                          is GenerateOnDemand and watch -PcgManualSeconds (8) more (-PcgNoManual skips that)
 *   -PcgMode=stream        watch a pawn travel from -PcgA=x,y,z to -PcgB=x,y,z: hold -PcgHoldA seconds (12), travel -PcgTravel seconds (20), hold -PcgHoldB (15)
 *   -PcgAssets=<paths>     comma-separated object paths to load by path at the end ("loaded": true or false in the receipt)
 *   -PcgOrphan=<path>      one object path nothing references, loaded the same way, as a control for the cook
 *
 * What it records is in the README next to the module. */
UCLASS()
class APcgPackagedGameMode : public AGameModeBase
{
	GENERATED_BODY()
public:
	APcgPackagedGameMode();
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

private:
	enum class EMode : uint8 { Runtime, Stream };
	enum class EStage : uint8 { Window, Manual };

	struct FSnap
	{
		bool bGenerated = false;
		bool bGenerating = false;
		int32 OutputItems = 0;
		int32 OutputPoints = 0;
		int32 IsmComponents = 0;
		int32 Instances = 0;
		int32 ProceduralInstances = 0;
		FString Mesh;
		FString Material;
		bool bMaterialFlag = false;
		bool bMaterialIsDefault = false;
	};

	struct FTracked
	{
		TWeakObjectPtr<UPCGComponent> Component;
		FString ActorName;
		FString Trigger;
		FString GraphPath;
		FString PolicyClass;
		bool bPartitioned = false;
		bool bComponentless = false;
		int32 StartEvents = 0;
		int32 GeneratedEvents = 0;
		double FirstStartS = -1.0;
		double FirstGeneratedS = -1.0;
		double LastGeneratedS = -1.0;
		double FirstInstancesS = -1.0;
		double ManualAtS = -1.0;
		bool bHasInitial = false;
		FSnap Initial;
		FSnap Last;
		TArray<TSharedPtr<FJsonValue>> Series;
	};

	void ReadCommandLine();
	void RefreshTracked(double T);
	void BindEvents(int32 Index);
	void Snapshot(const UPCGComponent& Component, FSnap& Out) const;
	void CountInstances(const AActor& Holder, FSnap& Out) const;
	TSharedRef<FJsonObject> SnapJson(const FSnap& Snap) const;
	TSharedRef<FJsonObject> WorldJson() const;
	TSharedRef<FJsonObject> ComponentJson(const FTracked& Entry) const;
	TArray<TSharedPtr<FJsonValue>> AssetChecksJson() const;

	void TickRuntime(double T);
	void TickStream(double T);
	TSharedRef<FJsonObject> StreamSample(double T, const TCHAR* Phase, const FVector& Source) const;
	void WriteReceipt(bool bComplete);
	void Finish(double T);

	EMode Mode = EMode::Runtime;
	EStage Stage = EStage::Window;
	FString ReportPath;
	FString ModeName;
	TArray<FString> AssetPaths;
	FString OrphanPath;
	double WindowSeconds = 20.0;
	double ManualSeconds = 8.0;
	bool bManual = true;
	double SampleInterval = 0.25;

	double BeginSeconds = 0.0;
	double NextSampleT = 0.0;
	double NextFlushT = 2.0;
	double ManualStartT = 0.0;
	bool bFinished = false;
	bool bFirstSampleDone = false;
	TSharedPtr<FJsonObject> WorldAtStart;
	TArray<FTracked> Tracked;

	FVector PointA = FVector(-50000.0, 0.0, 100.0);
	FVector PointB = FVector(50000.0, 0.0, 100.0);
	double HoldA = 12.0;
	double Travel = 20.0;
	double HoldB = 15.0;
	double StreamStartT = -1.0;
	bool bTeleported = false;
	TArray<TSharedPtr<FJsonValue>> Samples;
};
