#include "AECompare.h"
#include "Components/StaticMeshComponent.h"
#include "Dom/JsonObject.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "NiagaraComponent.h"
#include "NiagaraFunctionLibrary.h"
#include "NiagaraSystem.h"
#include "UObject/StrongObjectPtr.h"

// The example comparison set (AECompare.h), named "example". It uses only content every Unreal project has, so it builds and runs anywhere:
//   baseline     the empty stage, so the other rows read as a cost over it
//   mesh actors  N static mesh components moved by game-thread code every frame
//   Niagara      the engine's lightweight fountain template, N systems
// Copy this file as the model for your own set: describe each way of doing the thing as an AECompare::FCandidate, put them in an FSet and register the set with a static FRegistrar.
namespace ExampleSetsDetail {
// Where point Offset of a GridPoints() grid stands: the grid's X runs across the camera's view (the world's Y) and its Y runs into it (the world's X).
FVector GridWorld(const FTransform& Slot,const FVector2D& Offset) { return Slot.GetLocation()+FVector(Offset.Y,Offset.X,0.f); }
float GridSpacing(int32 Count) { return Count<=5?160.f:90.f; }

/** Candidate (a): nothing. A candidate with no Spawn leaves its slot empty, so its stress row is the cost of the stage and the harness itself. */
AECompare::FCandidate Baseline() {
    AECompare::FCandidate C;
    C.Id=TEXT("baseline"); C.Label=TEXT("BASELINE: nothing"); C.Note=TEXT("the empty stage\nwhat a frame costs with no effect");
    return C;
}

/** Candidate (b): a static mesh component per copy, each rotated and scaled by game-thread code every frame. The components are owned by the slot's Owner, which the harness destroys to clear
 * the slot, so this candidate needs no Clear. */
AECompare::FCandidate MeshActors() {
    struct FState { TArray<TWeakObjectPtr<UStaticMeshComponent>> Components; TArray<float> Phases; };
    const TSharedRef<FState> State=MakeShared<FState>();
    AECompare::FCandidate C;
    C.Id=TEXT("mesh-components"); C.Label=TEXT("MESH ACTORS"); C.Note=TEXT("one StaticMesh component per copy\nturned and scaled by game code every frame");
    C.Spawn=[State](AActor& Owner,const FTransform& Slot,int32 Count) {
        State->Components.Reset(); State->Phases.Reset();
        UStaticMesh* Cube=LoadObject<UStaticMesh>(nullptr,TEXT("/Engine/BasicShapes/Cube.Cube"));
        UMaterialInterface* Material=LoadObject<UMaterialInterface>(nullptr,TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
        const TArray<FVector2D> Points=AECompare::GridPoints(Count,GridSpacing(Count));
        for(int32 I=0;I<Points.Num();++I) {
            UStaticMeshComponent* Component=NewObject<UStaticMeshComponent>(&Owner);
            Component->SetStaticMesh(Cube);
            if(Material) Component->SetMaterial(0,Material);
            Component->SetupAttachment(Owner.GetRootComponent());
            Component->SetMobility(EComponentMobility::Movable);
            Component->SetCollisionEnabled(ECollisionEnabled::NoCollision);
            Component->SetCastShadow(false);
            Component->SetWorldLocation(GridWorld(Slot,Points[I])+FVector(0.f,0.f,45.f));
            Owner.AddInstanceComponent(Component);
            Component->RegisterComponent();
            State->Components.Add(Component);
            State->Phases.Add(I*0.7f);
        }
    };
    C.Tick=[State](float,double Seconds,const FVector&) {
        for(int32 I=0;I<State->Components.Num();++I) {
            UStaticMeshComponent* Component=State->Components[I].Get();
            if(!Component) continue;
            const float T=static_cast<float>(Seconds)+State->Phases[I];
            Component->SetRelativeRotation(FRotator(T*50.f,T*90.f,T*30.f));
            Component->SetRelativeScale3D(FVector(.35f+.15f*FMath::Sin(T*3.f)));
        }
    };
    C.Describe=[State](FJsonObject& Into) {
        int32 Live=0; for(const TWeakObjectPtr<UStaticMeshComponent>& Component:State->Components) Live+=Component.IsValid();
        Into.SetNumberField(TEXT("components"),Live);
        Into.SetStringField(TEXT("per_frame_cpu_work"),TEXT("sets rotation and scale on every component each frame"));
    };
    return C;
}

/** Candidate (c): an engine-shipped Niagara system spawned once per copy. Pass any Niagara system asset path; the same helper builds a candidate for another system (see the README). The
 * components are not owned by the slot's Owner, so Clear destroys them: a candidate that makes things its Owner does not own must remove them there, or they appear in and slow the next
 * candidate's measurement. */
AECompare::FCandidate NiagaraSystemCandidate(const TCHAR* Id,const TCHAR* Label,const TCHAR* Note,const TCHAR* AssetPath) {
    struct FState { TStrongObjectPtr<UNiagaraSystem> System; TArray<TWeakObjectPtr<UNiagaraComponent>> Components; FString Path,Problem; };
    const TSharedRef<FState> State=MakeShared<FState>();
    State->Path=AssetPath;
    AECompare::FCandidate C;
    C.Id=Id; C.Label=Label; C.Note=Note;
    C.Spawn=[State](AActor& Owner,const FTransform& Slot,int32 Count) {
        for(const TWeakObjectPtr<UNiagaraComponent>& Old:State->Components) if(Old.IsValid()) Old->DestroyComponent();
        State->Components.Reset(); State->Problem.Reset();
        if(!State->System.IsValid()) State->System.Reset(LoadObject<UNiagaraSystem>(nullptr,*State->Path));
        if(!State->System.IsValid()) {
            State->Problem=FString::Printf(TEXT("%s did not load (not cooked, or its plugin is not enabled)"),*State->Path);
            UE_LOG(LogTemp,Warning,TEXT("AE COMPARE %s"),*State->Problem);
            return;
        }
        const TArray<FVector2D> Points=AECompare::GridPoints(Count,GridSpacing(Count));
        for(const FVector2D& Point:Points) {
            UNiagaraComponent* Component=UNiagaraFunctionLibrary::SpawnSystemAtLocation(Owner.GetWorld(),State->System.Get(),GridWorld(Slot,Point)+FVector(0.f,0.f,10.f),FRotator::ZeroRotator,FVector(1.f),false,true,ENCPoolMethod::None,true);
            if(Component) State->Components.Add(Component);
        }
    };
    C.Clear=[State]() { for(const TWeakObjectPtr<UNiagaraComponent>& Old:State->Components) if(Old.IsValid()) Old->DestroyComponent(); State->Components.Reset(); };
    C.Describe=[State](FJsonObject& Into) {
        int32 Live=0; for(const TWeakObjectPtr<UNiagaraComponent>& Component:State->Components) Live+=Component.IsValid();
        Into.SetBoolField(TEXT("available"),State->Problem.IsEmpty()&&State->System.IsValid());
        if(!State->Problem.IsEmpty()) Into.SetStringField(TEXT("problem"),State->Problem);
        Into.SetStringField(TEXT("asset"),State->Path);
        Into.SetNumberField(TEXT("components"),Live);
    };
    return C;
}
}

static AECompare::FSet MakeExample() {
    using namespace ExampleSetsDetail;
    AECompare::FSet Set;
    Set.Name=TEXT("example"); Set.Title=TEXT("EXAMPLE: baseline, mesh actors, Niagara");
    // Style stays at its defaults: the engine's basic shape material and a lit stage.
    Set.Candidates.Add(Baseline());
    Set.Candidates.Add(MeshActors());
    Set.Candidates.Add(NiagaraSystemCandidate(TEXT("niagara-lightweight"),TEXT("NIAGARA: lightweight fountain"),TEXT("engine template FountainLightweight\nstateless particles; exposes no parameters"),
        TEXT("/Niagara/DefaultAssets/Templates/Systems/FountainLightweight.FountainLightweight")));
    return Set;
}

static AECompare::FRegistrar ExampleRegistrar(TEXT("example"),&MakeExample);
