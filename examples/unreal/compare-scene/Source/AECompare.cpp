#include "AECompare.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/TextRenderComponent.h"
#include "Dom/JsonObject.h"
#include "Engine/PostProcessVolume.h"
#include "Engine/StaticMesh.h"
#include "Components/LightComponent.h"
#include "Engine/DirectionalLight.h"
#include "Engine/Engine.h"
#include "Engine/SkyLight.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "GameFramework/HUD.h"
#include "GameFramework/PlayerController.h"
#include "HAL/PlatformMisc.h"
#include "HAL/PlatformProcess.h"
#include "HAL/PlatformTime.h"
#include "Misc/App.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "RHI.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "UnrealClient.h"

namespace AECompareDetail {
constexpr float CameraFov=50.f,FloorSize=6000.f;
constexpr double GapSeconds=.35;

UMaterialInterface* LoadMaterial(const FString& Path) {
    return LoadObject<UMaterialInterface>(nullptr,Path.IsEmpty()?TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"):*Path);
}

TMap<FString,AECompare::FSetFactory>& Registry() { static TMap<FString,AECompare::FSetFactory> Sets; return Sets; }

/** The material for one role on the stage: the project's own when it names one, otherwise the engine's basic shape material tinted to Grey (it is lit, one-sided and has a "Color" parameter). */
UMaterialInterface* StageMaterial(UObject& Outer,const FString& Path,float Grey) {
    UMaterialInterface* Base=LoadMaterial(Path);
    if(!Path.IsEmpty()||!Base) return Base;
    UMaterialInstanceDynamic* Tinted=UMaterialInstanceDynamic::Create(Base,&Outer);
    Tinted->SetVectorParameterValue(TEXT("Color"),FLinearColor(Grey,Grey,Grey));
    return Tinted;
}

UStaticMeshComponent* AddShape(AActor& Owner,const TCHAR* Mesh,const FTransform& Transform,UMaterialInterface* Material) {
    UStaticMeshComponent* C=NewObject<UStaticMeshComponent>(&Owner);
    C->SetStaticMesh(LoadObject<UStaticMesh>(nullptr,Mesh));
    C->SetupAttachment(Owner.GetRootComponent());
    C->SetMobility(EComponentMobility::Movable);
    C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    C->SetCastShadow(false);
    C->SetWorldTransform(Transform);
    if(Material) C->SetMaterial(0,Material);
    Owner.AddInstanceComponent(C);
    C->RegisterComponent();
    return C;
}

UTextRenderComponent* AddText(AActor& Owner,const FString& Text,const FVector& At,float Size) {
    UTextRenderComponent* T=NewObject<UTextRenderComponent>(&Owner);
    T->SetupAttachment(Owner.GetRootComponent());
    T->SetText(FText::FromString(Text));
    T->SetWorldSize(Size);
    T->SetHorizontalAlignment(EHTA_Center);
    T->SetVerticalAlignment(EVRTA_TextBottom);
    T->SetTextRenderColor(FColor(8,8,8));
    T->SetWorldLocationAndRotation(At,FRotator(0.f,180.f,0.f));   // the text faces the camera, which looks down +X
    Owner.AddInstanceComponent(T);
    T->RegisterComponent();
    return T;
}

float Percentile(TArray<float> Values,float Fraction) {
    if(Values.IsEmpty()) return 0.f;
    Values.Sort();
    return Values[FMath::Clamp(FMath::FloorToInt(Fraction*(Values.Num()-1)),0,Values.Num()-1)];
}

TSharedPtr<FJsonObject> FrameStats(const TArray<float>& Ms) {
    TSharedRef<FJsonObject> J=MakeShared<FJsonObject>();
    double Sum=0.; for(const float V:Ms) Sum+=V;
    J->SetNumberField(TEXT("frames"),Ms.Num());
    J->SetNumberField(TEXT("frame_ms_mean"),Ms.IsEmpty()?0.:Sum/Ms.Num());
    J->SetNumberField(TEXT("frame_ms_p50"),Percentile(Ms,.5f));
    J->SetNumberField(TEXT("frame_ms_p95"),Percentile(Ms,.95f));
    J->SetNumberField(TEXT("frame_ms_max"),Percentile(Ms,1.f));
    return J;
}
}

TArray<FVector2D> AECompare::GridPoints(int32 Count,float Spacing) {
    TArray<FVector2D> Points;
    if(Count<=0) return Points;
    const int32 Columns=FMath::Max(1,FMath::CeilToInt(FMath::Sqrt(Count*16.f/9.f)));
    const int32 Rows=FMath::DivideAndRoundUp(Count,Columns);
    for(int32 I=0;I<Count;++I) Points.Add(FVector2D((I%Columns-(Columns-1)*.5f)*Spacing,(I/Columns-(Rows-1)*.5f)*Spacing));
    return Points;
}

AAECompareGameMode::AAECompareGameMode() {
    PrimaryActorTick.bCanEverTick=true;
    PrimaryActorTick.bTickEvenWhenPaused=true;
    HUDClass=AHUD::StaticClass();
    PlayerControllerClass=APlayerController::StaticClass();
    DefaultPawnClass=nullptr;
}

void AAECompareGameMode::BeginPlay() {
    Super::BeginPlay();
    FString Name=TEXT("example");
    FParse::Value(FCommandLine::Get(),TEXT("AECompareSet="),Name);
    FParse::Value(FCommandLine::Get(),TEXT("AECaptureDir="),CaptureDir);
    FParse::Value(FCommandLine::Get(),TEXT("AECompareCount="),StressCount);
    FParse::Value(FCommandLine::Get(),TEXT("AECompareWarmup="),WarmupSeconds);
    FParse::Value(FCommandLine::Get(),TEXT("AECompareStress="),StressSeconds);
    bLive=FParse::Param(FCommandLine::Get(),TEXT("AECompareLive"));
    FParse::Value(FCommandLine::Get(),TEXT("AECompareShowcase="),ShowcaseCount);
    if(CaptureDir.IsEmpty()) CaptureDir=FPaths::ProjectSavedDir()/TEXT("Compare");
    CaptureDir=FPaths::ConvertRelativePathToFull(CaptureDir);
    IFileManager::Get().MakeDirectory(*CaptureDir,true);
    Set=AECompare::MakeSet(Name);
    if(!ensureAlwaysMsgf(Set.Candidates.Num()>0,TEXT("AE COMPARE no comparison set called '%s'"),*Name)) { FPlatformMisc::RequestExit(false); return; }
    RenderAdapter=GRHIAdapterName;
    ShowcaseCount=Set.ShowcaseCopies;
    FParse::Value(FCommandLine::Get(),TEXT("AECompareShowcase="),ShowcaseCount);
    BuildStage(Set.Candidates.Num());
    LiveCount=ShowcaseCount;
    SpawnPhase(ShowcaseCount,-1);
    if(bLive) Phase=EPhase::Live;
    PhaseStartSeconds=LastFrameSeconds=FPlatformTime::Seconds();
    UE_LOG(LogTemp,Display,TEXT("AE COMPARE set=%s candidates=%d showcase=%d stress=%d adapter=%s dir=%s"),*Set.Name,Set.Candidates.Num(),ShowcaseCount,StressCount,*RenderAdapter,*CaptureDir);
}

void AAECompareGameMode::BuildStage(int32 SlotCount) {
    using namespace AECompareDetail;
    UWorld* World=GetWorld();
    FActorSpawnParameters Spawn; Spawn.SpawnCollisionHandlingOverride=ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
    // The stage: a light floor and a light wall behind the row and a dark pedestal under each candidate. A project with an unlit style lights nothing; without one, a directional light and a sky light are added.
    AActor* Stage=World->SpawnActor<AActor>(FVector::ZeroVector,FRotator::ZeroRotator,Spawn);
    USceneComponent* Root=NewObject<USceneComponent>(Stage); Stage->SetRootComponent(Root); Root->RegisterComponent();
    const float SlotSpacing=Set.SlotSpacing,Width=SlotSpacing*SlotCount;
    UMaterialInterface* FloorMaterial=StageMaterial(*Stage,Set.Style.Floor,.4f); UMaterialInterface* WallMaterial=StageMaterial(*Stage,Set.Style.Wall,1.f); UMaterialInterface* DarkMaterial=StageMaterial(*Stage,Set.Style.Dark,.02f);
    const TCHAR* Plane=TEXT("/Engine/BasicShapes/Plane.Plane"); const TCHAR* Cylinder=TEXT("/Engine/BasicShapes/Cylinder.Cylinder");
    AddShape(*Stage,Plane,FTransform(FRotator::ZeroRotator,FVector(0.f,0.f,0.f),FVector(FloorSize/100.f)),FloorMaterial);
    AddShape(*Stage,Plane,FTransform(FRotator(90.f,0.f,0.f),FVector(SlotSpacing*2.f,0.f,FloorSize*.5f),FVector(FloorSize/100.f)),WallMaterial);
    for(int32 I=0;I<SlotCount;++I) {
        const FVector At(0.f,(I-(SlotCount-1)*.5f)*SlotSpacing,0.f);
        Slots.Add(FTransform(At));
        AddShape(*Stage,Cylinder,FTransform(FRotator::ZeroRotator,At+FVector(0.f,0.f,3.f),FVector(SlotSpacing*.0057f,SlotSpacing*.0057f,.06f)),DarkMaterial);
        // Behind each candidate the wall is dark up to Set.DarkHeight, so an effect is seen against both: additive light shows on the dark and dark shapes show on the light.
        AddShape(*Stage,Plane,FTransform(FRotator(90.f,0.f,0.f),FVector(SlotSpacing*2.f-10.f,At.Y,Set.DarkHeight*.5f),FVector(Set.DarkHeight/100.f,SlotSpacing*.96f/100.f,1.f)),DarkMaterial);
        const AECompare::FCandidate& C=Set.Candidates[I];
        const float TextScale=SlotSpacing/700.f;
        AddText(*Stage,C.Label,At+FVector(0.f,0.f,Set.LabelHeight),34.f*TextScale);
        AddText(*Stage,C.Note,At+FVector(0.f,0.f,Set.LabelHeight-70.f*TextScale),15.f*TextScale);
    }
    AddText(*Stage,Set.Title,FVector(0.f,0.f,Set.LabelHeight+170.f*SlotSpacing/700.f),48.f*SlotSpacing/700.f);
    // The camera: far enough back that the whole row fits the horizontal field of view with a margin, a little above the ground, looking along +X.
    CameraDistance=FMath::Max(450.f,Width*1.2f/(2.f*FMath::Tan(FMath::DegreesToRadians(CameraFov*.5f))));
    BaseCameraDistance=CameraDistance;
    const float Distance=CameraDistance;
    CameraLocation=FVector(-Distance,0.f,Set.FocusHeight*.75f);
    ACameraActor* Camera=World->SpawnActor<ACameraActor>(CameraLocation,FRotator::ZeroRotator,Spawn);
    Camera->SetActorRotation((FVector(0.f,0.f,Set.FocusHeight)-CameraLocation).Rotation());
    UCameraComponent* View=Camera->GetCameraComponent();
    View->SetFieldOfView(CameraFov);
    auto& PP=View->PostProcessSettings;
    PP.bOverride_MotionBlurAmount=true; PP.MotionBlurAmount=0.f;
    PP.bOverride_AutoExposureMethod=true; PP.AutoExposureMethod=AEM_Manual;
    PP.bOverride_AutoExposureApplyPhysicalCameraExposure=true; PP.AutoExposureApplyPhysicalCameraExposure=false;
    PP.bOverride_AutoExposureBias=true; PP.AutoExposureBias=Set.Style.Wall.IsEmpty()?-2.f:0.f;   // the lit stage is darker than an unlit one at the same exposure
    CameraActor=Camera;
    // A project's own finish (a post-process material) goes on an unbound volume; without one the stage is lit like any basic scene.
    if(!Set.Style.PostProcess.IsEmpty()) {
        APostProcessVolume* Finish=World->SpawnActor<APostProcessVolume>(FVector::ZeroVector,FRotator::ZeroRotator,Spawn);
        Finish->bUnbound=true;
        if(UMaterialInterface* Palette=LoadMaterial(Set.Style.PostProcess)) Finish->Settings.WeightedBlendables.Array.Add(FWeightedBlendable(1.f,Palette));
    }
    if(Set.Style.Wall.IsEmpty()) {
        // A key light on the camera's side, aimed along the view and down 35 degrees, so the wall and the fronts of the candidates are lit, and a sky light for the rest. The key is Movable so it
        // does not depend on a lighting build.
        const FTransform KeyAt(FRotator(-35.f,0.f,0.f),FVector(-500.f,0.f,800.f));
        ADirectionalLight* Key=World->SpawnActorDeferred<ADirectionalLight>(ADirectionalLight::StaticClass(),KeyAt);
        Key->GetLightComponent()->SetMobility(EComponentMobility::Movable);
        Key->FinishSpawning(KeyAt);
        World->SpawnActor<ASkyLight>(FVector(0.f,0.f,500.f),FRotator::ZeroRotator,Spawn);
    }
}

void AAECompareGameMode::ClearPhase() {
    for(AActor* SlotOwner:SlotOwners) if(IsValid(SlotOwner)) SlotOwner->Destroy();
    SlotOwners.Reset();
    for(const AECompare::FCandidate& Candidate:Set.Candidates) if(Candidate.Clear) Candidate.Clear();
}

void AAECompareGameMode::PlaceCamera() {
    if(!CameraActor) return;
    const float Yaw=FMath::DegreesToRadians(CameraYawDegrees);
    CameraLocation=FVector(-FMath::Cos(Yaw)*CameraDistance,FMath::Sin(Yaw)*CameraDistance,Set.FocusHeight*.75f);
    CameraActor->SetActorLocation(CameraLocation);
    CameraActor->SetActorRotation((FVector(0.f,0.f,Set.FocusHeight)-CameraLocation).Rotation());
}

void AAECompareGameMode::TickLive(float DeltaSeconds,float FrameMs) {
    APlayerController* PC=GetWorld()->GetFirstPlayerController();
    if(!PC) return;
    SmoothedFrameMs=SmoothedFrameMs<=0.f?FrameMs:FMath::Lerp(SmoothedFrameMs,FrameMs,.05f);
    // Keyboard and gamepad do the same things: Esc or B or Back quits; Up or D-pad up doubles the copies and Down or D-pad down halves them; Left and Right, D-pad left and right or the left stick orbit;
    // the right stick moves the camera in and out.
    if(PC->WasInputKeyJustPressed(EKeys::Escape)||PC->WasInputKeyJustPressed(EKeys::Gamepad_FaceButton_Right)||PC->WasInputKeyJustPressed(EKeys::Gamepad_Special_Left)) { FPlatformMisc::RequestExit(false); return; }
    int32 Wanted=LiveCount;
    if(PC->WasInputKeyJustPressed(EKeys::Up)||PC->WasInputKeyJustPressed(EKeys::Gamepad_DPad_Up)) Wanted=FMath::Min(LiveCount*2,2000);
    if(PC->WasInputKeyJustPressed(EKeys::Down)||PC->WasInputKeyJustPressed(EKeys::Gamepad_DPad_Down)) Wanted=FMath::Max(LiveCount/2,1);
    if(Wanted!=LiveCount) { LiveCount=Wanted; SpawnPhase(LiveCount,-1); PhaseStartSeconds=FPlatformTime::Seconds(); }
    float Orbit=PC->GetInputAnalogKeyState(EKeys::Gamepad_LeftX);
    if(PC->IsInputKeyDown(EKeys::Left)||PC->IsInputKeyDown(EKeys::Gamepad_DPad_Left)) Orbit-=1.f;
    if(PC->IsInputKeyDown(EKeys::Right)||PC->IsInputKeyDown(EKeys::Gamepad_DPad_Right)) Orbit+=1.f;
    CameraYawDegrees=FMath::Clamp(CameraYawDegrees+FMath::Clamp(Orbit,-1.f,1.f)*40.f*DeltaSeconds,-50.f,50.f);
    const float Dolly=PC->GetInputAnalogKeyState(EKeys::Gamepad_RightY);
    CameraDistance=FMath::Clamp(CameraDistance*(1.f-Dolly*.8f*DeltaSeconds),BaseCameraDistance*.35f,BaseCameraDistance*2.5f);
    PlaceCamera();
    FString Capped;
    for(const AECompare::FCandidate& C:Set.Candidates) if(C.StressCount>0&&LiveCount>C.StressCount) Capped+=FString::Printf(TEXT("   %s is held at %d copies"),*C.Id,C.StressCount);
    if(GEngine) GEngine->AddOnScreenDebugMessage(7001,0.f,FColor::Black,FString::Printf(TEXT("%s   |   %d copies of each   |   frame %.2f ms (%.0f fps)%s"),*Set.Title,LiveCount,SmoothedFrameMs,SmoothedFrameMs>0.f?1000.f/SmoothedFrameMs:0.f,*Capped),true,FVector2D(1.4f));
    if(GEngine) GEngine->AddOnScreenDebugMessage(7002,0.f,FColor(60,60,60),TEXT("Up / Down (D-pad): double / halve the copies     Left / Right (D-pad, left stick): orbit     right stick: in / out     Esc / B / Back: quit"),true,FVector2D(1.1f));
}

void AAECompareGameMode::SpawnPhase(int32 Count,int32 OnlyCandidate) {
    ClearPhase();
    ActiveCandidate=OnlyCandidate;
    FActorSpawnParameters Spawn; Spawn.SpawnCollisionHandlingOverride=ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
    for(int32 I=0;I<Set.Candidates.Num();++I) {
        AActor* SlotOwner=GetWorld()->SpawnActor<AActor>(FVector::ZeroVector,FRotator::ZeroRotator,Spawn);
        USceneComponent* Root=NewObject<USceneComponent>(SlotOwner); SlotOwner->SetRootComponent(Root); Root->RegisterComponent();
        SlotOwners.Add(SlotOwner);
        if(OnlyCandidate>=0&&I!=OnlyCandidate) continue;
        // A stress phase puts its one candidate in the middle of the view; the showcase puts each at its own slot.
        const FTransform Slot=OnlyCandidate>=0?FTransform(FVector::ZeroVector):Slots[I];
        const int32 Cap=Set.Candidates[I].StressCount;
        if(Set.Candidates[I].Spawn) Set.Candidates[I].Spawn(*SlotOwner,Slot,(bLive&&Cap>0)?FMath::Min(Count,Cap):Count);
    }
}

void AAECompareGameMode::RequestShot(const FString& FileName) {
    FScreenshotRequest::RequestScreenshot(CaptureDir/FileName,false,false);
}

void AAECompareGameMode::BeginStress(int32 Index) {
    StressIndex=Index;
    const int32 Count=Set.Candidates[Index].StressCount>0?Set.Candidates[Index].StressCount:StressCount;
    SpawnPhase(Count,Index);
    FStressResult Result; Result.Id=Set.Candidates[Index].Id; Result.Count=Count;
    StressResults.Add(Result);
    Phase=EPhase::StressWarm;
    PhaseStartSeconds=FPlatformTime::Seconds();
}

void AAECompareGameMode::Tick(float DeltaSeconds) {
    Super::Tick(DeltaSeconds);
    const double Now=FPlatformTime::Seconds();
    const float FrameMs=LastFrameSeconds>0.?static_cast<float>((Now-LastFrameSeconds)*1000.):0.f;
    LastFrameSeconds=Now;
    const double Elapsed=Now-PhaseStartSeconds;
    if(!bViewTargetSet) {
        if(APlayerController* PC=GetWorld()->GetFirstPlayerController()) { PC->SetViewTarget(CameraActor); bViewTargetSet=true; }
    }
    for(int32 I=0;I<Set.Candidates.Num();++I) {
        if(ActiveCandidate>=0&&I!=ActiveCandidate) continue;
        if(Set.Candidates[I].Tick) Set.Candidates[I].Tick(DeltaSeconds,Elapsed,CameraLocation);
    }
    switch(Phase) {
    case EPhase::Showcase:
        if(Elapsed>=WarmupSeconds) { ShowcaseShotA=CaptureDir/TEXT("compare.png"); RequestShot(TEXT("compare.png")); Phase=EPhase::ShotA; }
        break;
    case EPhase::ShotA:
        if(!FScreenshotRequest::IsScreenshotRequested()) { Phase=EPhase::Gap; PhaseStartSeconds=Now; }
        break;
    case EPhase::Gap:
        if(Elapsed>=AECompareDetail::GapSeconds) { ShowcaseShotB=CaptureDir/TEXT("compare-b.png"); RequestShot(TEXT("compare-b.png")); Phase=EPhase::ShotB; }
        break;
    case EPhase::ShotB:
        if(!FScreenshotRequest::IsScreenshotRequested()) BeginStress(0);
        break;
    case EPhase::StressWarm:
        if(Elapsed>=StressWarmSeconds) { Phase=EPhase::StressMeasure; PhaseStartSeconds=Now; }
        break;
    case EPhase::StressMeasure:
        if(FrameMs>0.f) StressResults.Last().FrameMs.Add(FrameMs);
        if(Elapsed>=StressSeconds) {
            // What the candidate says about itself is read now, while it is still spawned: the clear that follows the screenshot would leave it describing nothing.
            StressResults.Last().Described=MakeShared<FJsonObject>();
            if(Set.Candidates[StressIndex].Describe) Set.Candidates[StressIndex].Describe(*StressResults.Last().Described);
            StressResults.Last().Shot=FString::Printf(TEXT("compare-stress-%s.png"),*StressResults.Last().Id);
            RequestShot(StressResults.Last().Shot);
            Phase=EPhase::StressShot;
        }
        break;
    case EPhase::StressShot:
        if(!FScreenshotRequest::IsScreenshotRequested()) {
            if(StressIndex+1<Set.Candidates.Num()) BeginStress(StressIndex+1);
            else { ClearPhase(); WriteReceipt(); Phase=EPhase::Finishing; PhaseStartSeconds=Now; }
        }
        break;
    case EPhase::Live:
        TickLive(DeltaSeconds,FrameMs);
        break;
    case EPhase::Finishing:
        // The PNGs are written on another thread: give them a moment before the process goes.
        if(Elapsed>=1.5) FPlatformMisc::RequestExit(false);
        break;
    }
}

void AAECompareGameMode::WriteReceipt() {
    using namespace AECompareDetail;
    TSharedRef<FJsonObject> J=MakeShared<FJsonObject>();
    J->SetStringField(TEXT("scenario"),TEXT("compare"));
    J->SetStringField(TEXT("screenshot"),ShowcaseShotA);
    J->SetStringField(TEXT("screenshot_b"),ShowcaseShotB);
    J->SetStringField(TEXT("set"),Set.Name);
    J->SetStringField(TEXT("title"),Set.Title);
    J->SetStringField(TEXT("engine_version"),FApp::GetBuildVersion());
    J->SetStringField(TEXT("rhi_adapter"),RenderAdapter);
    J->SetNumberField(TEXT("showcase_copies"),ShowcaseCount);
    J->SetNumberField(TEXT("showcase_warmup_seconds"),WarmupSeconds);
    J->SetNumberField(TEXT("stress_copies"),StressCount);
    J->SetNumberField(TEXT("stress_warmup_seconds"),StressWarmSeconds);
    J->SetNumberField(TEXT("stress_measure_seconds"),StressSeconds);
    J->SetStringField(TEXT("frame_time_meaning"),TEXT("wall-clock time between game ticks of the whole process (game thread, render thread and GPU together), not an isolated cost"));
    TArray<TSharedPtr<FJsonValue>> Entries;
    for(int32 I=0;I<Set.Candidates.Num();++I) {
        const AECompare::FCandidate& C=Set.Candidates[I];
        TSharedRef<FJsonObject> E=MakeShared<FJsonObject>();
        E->SetStringField(TEXT("id"),C.Id); E->SetStringField(TEXT("label"),C.Label); E->SetStringField(TEXT("note"),C.Note);
        if(StressResults.IsValidIndex(I)) {
            TSharedPtr<FJsonObject> S=FrameStats(StressResults[I].FrameMs);
            S->SetNumberField(TEXT("copies"),StressResults[I].Count);
            S->SetStringField(TEXT("screenshot"),CaptureDir/StressResults[I].Shot);
            E->SetObjectField(TEXT("stress"),S);
        }
        if(StressResults.IsValidIndex(I)&&StressResults[I].Described.IsValid()) { for(const auto& Field:StressResults[I].Described->Values) E->SetField(Field.Key,Field.Value); }
        else if(C.Describe) C.Describe(*E);
        Entries.Add(MakeShared<FJsonValueObject>(E));
    }
    J->SetArrayField(TEXT("candidates"),Entries);
    FString Out; const auto Writer=TJsonWriterFactory<>::Create(&Out); FJsonSerializer::Serialize(J,Writer);
    FFileHelper::SaveStringToFile(Out,*(CaptureDir/TEXT("compare.json")),FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
    UE_LOG(LogTemp,Display,TEXT("AE COMPARE receipt %s"),*(CaptureDir/TEXT("compare.json")));
}

AECompare::FRegistrar::FRegistrar(const TCHAR* Name,FSetFactory Factory) { AECompareDetail::Registry().Add(Name,Factory); }

AECompare::FSet AECompare::MakeSet(const FString& Name) {
    if(const FSetFactory* Factory=AECompareDetail::Registry().Find(Name)) return (*Factory)();
    return FSet();
}
