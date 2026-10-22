#pragma once
#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "AECompare.generated.h"

class AActor;
class FJsonObject;

/** A side-by-side comparison scene: several ways of doing the same thing, set in a row in an empty test level under one camera, so a person can see them next to each other and the
 * numbers that decide between them are measured in the same run. It is a pattern, not a test of any one effect: a *set* is a title and a list of *candidates*, and a candidate is only a name, a way
 * to spawn N copies of itself at a slot, and what it does each frame. Everything else is the harness's: the layout, the labels, the camera, the look of the world, the warm-up, the
 * screenshots, the stress phase that times each candidate alone at N copies, the JSON receipt and the exit. Adding a comparison means adding a set (in your own sets file) and nothing else.
 *
 * Run it with compare.ps1 (next to the Source folder); it starts the game on this game mode (the `game=` URL option) with -AECompareSet=<name> -AECaptureDir=<dir> (and optionally -AECompareCount,
 * -AECompareWarmup, -AECompareStress). It writes <dir>/compare.png and compare-b.png (two frames, a moment apart, so motion differs), compare-stress-<id>.png per candidate and
 * compare.json, then exits. The frame times in the receipt are wall-clock frame times of the whole process (game thread, render thread and GPU together), not isolated costs. */
namespace AECompare {
struct FCandidate {
    /** A short identifier used in file names and the receipt, and the text shown under the candidate in the scene. */
    FString Id,Label,Note;
    /** Make Count copies of the candidate around Slot (a world transform on the floor; X forward, Z up). Everything it creates must be owned by Owner or tracked by the candidate itself,
     * because the harness destroys Owner to clear the slot. Called once per phase; a second call starts the candidate fresh. */
    TFunction<void(AActor& Owner,const FTransform& Slot,int32 Count)> Spawn;
    /** Called every frame while the candidate is spawned: the frame's seconds, the seconds since the phase began, and the camera's position (for anything that faces it). Optional. */
    TFunction<void(float DeltaSeconds,double Seconds,const FVector& Camera)> Tick;
    /** Undo Spawn: destroy whatever the candidate made that Owner does not own (an actor of its own, Niagara components). Called for every candidate each time the harness clears a phase,
     * so one candidate's leftovers never appear in, or slow, the next one's measurement. Optional. */
    TFunction<void()> Clear;
    /** How many copies this candidate is timed at in the stress phase; 0 uses the run's count. A candidate that costs far more per copy (a fluid simulation) names a smaller number, and the
     * receipt records the number each was actually timed at. */
    int32 StressCount=0;
    /** Add whatever the candidate can tell about itself (component counts, which asset it loaded, whether it was available) to its entry in the receipt. Optional. */
    TFunction<void(FJsonObject& Into)> Describe;
};
/** Asset paths for the stage's look. Empty paths use the engine's basic shape material (light floor and wall, dark panels), and the stage is then lit (a key light on the camera's side and a sky light are added, and the exposure is lowered); a project with an unlit
 * house style (an unlit material, a post-process finish) names its own and gets exactly its look. */
struct FStyle { FString Floor,Wall,Dark,PostProcess; };
struct FSet {
    FString Name,Title; TArray<FCandidate> Candidates;
    FStyle Style;
    /** The distance between candidates, the height their labels hang at and the height the camera looks at, all in centimetres: a set of small props is much smaller than a set of large effects. */
    float SlotSpacing=700.f,LabelHeight=470.f,FocusHeight=300.f;
    /** How high the dark panel behind each candidate rises (the light wall is above it): additive light shows on the dark and dark shapes show on the light wall, so a candidate is seen against both. */
    float DarkHeight=220.f;
    /** How many copies of each candidate the showcase (and the live scene's start) holds. */
    int32 ShowcaseCopies=3;
};
/** Count points on a grid about the origin (X and Y offsets, as wide as it is deep to a 16:9 view), Spacing apart: the layout a candidate uses for N copies of itself. */
TArray<FVector2D> GridPoints(int32 Count,float Spacing);
/** The set called Name ("example"), or an empty Name if none is registered. A set registers itself from its own file with a static FRegistrar (see the sets file), so adding a comparison
 * touches no other file. */
using FSetFactory=FSet(*)();
struct FRegistrar { FRegistrar(const TCHAR* Name,FSetFactory Factory); };
FSet MakeSet(const FString& Name);
}

UCLASS()
class AAECompareGameMode : public AGameModeBase {
    GENERATED_BODY()
public:
    AAECompareGameMode();
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;
private:
    enum class EPhase : uint8 { Showcase,ShotA,Gap,ShotB,StressWarm,StressMeasure,StressShot,Finishing,Live };
    void BuildStage(int32 SlotCount);
    void SpawnPhase(int32 Count,int32 OnlyCandidate);
    void ClearPhase();
    void RequestShot(const FString& FileName);
    void BeginStress(int32 Index);
    void WriteReceipt();
    void TickLive(float DeltaSeconds,float FrameMs);
    void PlaceCamera();

    AECompare::FSet Set;
    FString CaptureDir;
    int32 ShowcaseCount=3,StressCount=332;
    double WarmupSeconds=2.5,StressSeconds=2.,StressWarmSeconds=1.,PhaseStartSeconds=0.,LastFrameSeconds=0.;
    EPhase Phase=EPhase::Showcase;
    int32 StressIndex=-1;
    bool bViewTargetSet=false;
    int32 ActiveCandidate=-1;     // the one candidate spawned (a stress phase), or -1 when every candidate is
    TArray<TObjectPtr<AActor>> SlotOwners;
    TArray<FTransform> Slots;
    TObjectPtr<AActor> CameraActor;
    FVector CameraLocation=FVector::ZeroVector;
    // Live mode (-AECompareLive): the showcase runs until Esc, with Up and Down doubling and halving the copies of every candidate, Left and Right orbiting the camera, and the frame time on screen. A gamepad does the same: D-pad up and down for the copies, the left stick or D-pad left and right to orbit,
    // the right stick to move the camera in and out, B or Back to quit.
    bool bLive=false;
    int32 LiveCount=3;
    float CameraDistance=1600.f,BaseCameraDistance=1600.f,CameraYawDegrees=0.f,SmoothedFrameMs=0.f;
    struct FStressResult { FString Id,Shot; int32 Count=0; TArray<float> FrameMs; TSharedPtr<FJsonObject> Described; };
    TArray<FStressResult> StressResults;
    FString ShowcaseShotA,ShowcaseShotB,RenderAdapter;
};
