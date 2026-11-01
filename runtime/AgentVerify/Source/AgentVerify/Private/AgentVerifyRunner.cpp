#include "AgentVerifyRunner.h"
#include "AgentVerifyJson.h"
#include "AgentVerifyAudio.h"
#include "Domain/AgentVerifyRules.h"
#include "Containers/Ticker.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/PlayerInput.h"
#include "HAL/IConsoleManager.h"
#include "HAL/PlatformTime.h"
#include "HAL/PlatformMemory.h"
#include "HAL/PlatformMisc.h"
#include "InputKeyEventArgs.h"
#include "InputCoreTypes.h"
#include "Misc/App.h"
#include "Misc/EngineVersion.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "RHI.h"
#include "DynamicRHI.h"
#include "UnrealClient.h"
#include "UObject/UObjectGlobals.h"
#if WITH_EDITOR
#include "AssetCompilingManager.h"
#include "ShaderCompiler.h"
#endif

namespace AgentVerify::Runtime
{
    // A screenshot request and injected input are process-wide resources in this v1 runner.
    static bool RunnerActive = false;
    bool Settled()
    {
        bool Ready = !IsAsyncLoading();
#if WITH_EDITOR
        Ready = Ready && FAssetCompilingManager::Get().GetNumRemainingAssets() == 0 && (!GShaderCompilingManager || !GShaderCompilingManager->IsCompiling());
#endif
        return Ready;
    }
    AgentVerify::Json::FValue Summary(const std::vector<double>& Samples)
    {
        using namespace AgentVerify::Json;
        Domain::FSummary Stats;
        if (!Domain::Summarize(Samples, Stats)) return Null();
        auto Out = Object(); Out->SetNumberField(TEXT("count"), Stats.Count); Out->SetNumberField(TEXT("mean_ms"), Stats.Mean);
        Out->SetNumberField(TEXT("p95_ms"), Stats.P95); Out->SetNumberField(TEXT("p99_ms"), Stats.P99); Out->SetNumberField(TEXT("max_ms"), Stats.Maximum);
        return Value(Out);
    }
}

struct FAgentVerifyRunner::FImpl
{
    using FObject = AgentVerify::Json::FObject;
    using FValue = AgentVerify::Json::FValue;
    using FArray = AgentVerify::Json::FArray;
    enum class EStage { Warmup, Settle, Run, Capture, Cleanup, Done };
    TWeakObjectPtr<UWorld> World;
    TWeakObjectPtr<APlayerController> Controller;
    TSharedRef<IAgentVerifyProbe> Probe;
    FString Output, Error, FinalReason, ExecutionStage = TEXT("structural_validation");
    FObject Request, Receipt, Execution, Validation, Input, Cache;
    FArray Trace, Checks, Actions, Captures, Audio, Artifacts, Releases, CaptureTimeline;
    TArray<FObject> Phases;
    TMap<FString, bool> Keys;
    TMap<FString, double> Axes;
    TSet<FString> InjectedKeys, InjectedAxes;
    TSharedPtr<FAgentVerifyAudio, ESPMode::ThreadSafe> AudioTap;
    FString AudioError;
    AgentVerify::Domain::FHold Hold;
    FTSTicker::FDelegateHandle TickHandle;
    FDelegateHandle ShotHandle;
    EStage Stage = EStage::Done;
    int PhaseIndex = 0, NextAction = 0;
    uint64 LastEngineFrame = MAX_uint64;
    int64 Frame = 0;
    double LastWall = 0, StageWall = 0, StableWall = 0, PhaseWall = 0;
    bool OwnsRunner = false, Success = false, AllChecks = true, ShotProcessed = false, ShotOwned = false, SourceReady = false, OutputReady = false, CleanupProved = true;
    FString ShotPath, ShotRelative;

    FImpl(UWorld* InWorld, TSharedRef<IAgentVerifyProbe> InProbe, const FString& RequestFile, const FString& OutputDirectory)
        : World(InWorld), Probe(InProbe), Output(FPaths::ConvertRelativePathToFull(OutputDirectory))
    {
        using namespace AgentVerify::Json;
        if (!IsInGameThread()) { Error = TEXT("game_thread_required"); return; }
        TArray<FString> Existing; IFileManager::Get().FindFiles(Existing, *(Output / TEXT("*")), true, true);
        if (!Existing.IsEmpty() || IFileManager::Get().FileExists(*Output)) { Error = TEXT("fresh_output_required"); return; }
        if (!IFileManager::Get().MakeDirectory(*Output, true)) { Error = TEXT("output_unavailable"); return; }
        OutputReady = true;
        if (AgentVerify::Runtime::RunnerActive) { Error = TEXT("another_runner_active"); Diagnostic(); return; }
        AgentVerify::Runtime::RunnerActive = true; OwnsRunner = true;
        FObject Source;
        if (!AgentVerify::Json::Source(Source, Error)) { Diagnostic(); return; }
        SourceReady = true;
        FValue Document; TArray<uint8> RequestBytes;
        ReadJson(RequestFile, Document, &RequestBytes);
        const FString Digest = Hash(RequestBytes);
        if (Digest.Len() != 64) { Error = TEXT("request_hash_unavailable"); Diagnostic(); return; }
        Receipt = Object(); Receipt->SetNumberField(TEXT("schema_version"), 1);
        auto Producer = Object(); Producer->SetStringField(TEXT("name"), TEXT("AgentVerify")); Producer->SetStringField(TEXT("version"), Source->GetStringField(TEXT("plugin_version"))); Producer->SetObjectField(TEXT("source"), Source); Receipt->SetObjectField(TEXT("producer"), Producer);
        FString Id, Kind;
        if (Document.IsValid() && Document->Type == EJson::Object) { Document->AsObject()->TryGetStringField(TEXT("request_id"), Id); Document->AsObject()->TryGetStringField(TEXT("kind"), Kind); }
        Receipt->SetStringField(TEXT("request_id"), Token(Id) ? Id : TEXT("invalid-") + Digest);
        Receipt->SetStringField(TEXT("kind"), Kind == TEXT("replay") || Kind == TEXT("shot") || Kind == TEXT("observation") ? Kind : TEXT("observation"));
        Receipt->SetStringField(TEXT("request_sha256"), Digest);
        Receipt->SetField(TEXT("environment"), Null()); Receipt->SetStringField(TEXT("contention"), TEXT("unknown"));
        Cache = Object(); Cache->SetStringField(TEXT("requested"), TEXT("unclassified")); Cache->SetStringField(TEXT("preparation"), TEXT("unavailable request")); Cache->SetStringField(TEXT("state"), TEXT("unclassified")); Cache->SetStringField(TEXT("outcome"), TEXT("unclassified")); Cache->SetStringField(TEXT("evidence"), TEXT("No preparation was observed"));
        Execution = Object();
        for (const FString Field : {TEXT("phases_started"), TEXT("phases_completed"), TEXT("actions_executed"), TEXT("checks_observed"), TEXT("warmup_frames"), TEXT("settle_frames"), TEXT("warmup_seconds"), TEXT("settle_seconds")}) Execution->SetNumberField(Field, 0);
        Validation = Object(); Validation->SetBoolField(TEXT("structural"), false); Validation->SetBoolField(TEXT("live"), false); Validation->SetArrayField(TEXT("issues"), {});
        Input = Object(); Input->SetBoolField(TEXT("released"), true); Input->SetArrayField(TEXT("keys_remaining"), {}); Input->SetArrayField(TEXT("axes_remaining"), {});
        auto Issues = FAgentVerifyRunner::ValidateDocument(Document);
        if (!Issues.IsEmpty()) { Refuse(Issues); return; }
        Request = Document->AsObject(); Validation->SetBoolField(TEXT("structural"), true); ExecutionStage = TEXT("live_validation");
        Cache->SetStringField(TEXT("requested"), Request->GetObjectField(TEXT("cache"))->GetStringField(TEXT("requested"))); Cache->SetStringField(TEXT("preparation"), Request->GetObjectField(TEXT("cache"))->GetStringField(TEXT("preparation")));
        Issues = FAgentVerifyRunner::ValidateLiveNames(Document, *Probe);
        if (!Issues.IsEmpty()) { Refuse(Issues); return; }
        if (Request->GetBoolField(TEXT("save_sandbox")))
        {
            FString SandboxError;
            if (!Probe->PrepareSaveSandbox(SandboxError)) { Refuse({{TEXT("sandbox_unavailable"), TEXT("$.save_sandbox"), SandboxError.IsEmpty() ? TEXT("Save sandbox preparation failed") : SandboxError}}); return; }
        }
        Validation->SetBoolField(TEXT("live"), true);
        for (const auto& Phase : Request->GetArrayField(TEXT("phases"))) Phases.Add(Phase->AsObject());
        const auto CacheObservation = Probe->PrepareCache(Cache->GetStringField(TEXT("requested")), Cache->GetStringField(TEXT("preparation")));
        const bool KnownCache = CacheObservation.State == TEXT("cold") || CacheObservation.State == TEXT("warm") || CacheObservation.State == TEXT("unclassified");
        const bool KnownOutcome = CacheObservation.Outcome == TEXT("verified") || CacheObservation.Outcome == TEXT("failed") || CacheObservation.Outcome == TEXT("unclassified");
        Cache->SetStringField(TEXT("state"), KnownCache ? CacheObservation.State : TEXT("unclassified")); Cache->SetStringField(TEXT("outcome"), KnownOutcome && !CacheObservation.Evidence.IsEmpty() ? CacheObservation.Outcome : TEXT("unclassified")); Cache->SetStringField(TEXT("evidence"), CacheObservation.Evidence.IsEmpty() ? TEXT("Consumer supplied no preparation evidence") : CacheObservation.Evidence);
        Receipt->SetStringField(TEXT("contention"), TEXT("none")); ObserveContention();
        if (!Environment()) { Diagnostic(); return; }
        ExecutionStage = TEXT("warmup"); Stage = EStage::Warmup; LastWall = FPlatformTime::Seconds();
        TickHandle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateRaw(this, &FImpl::Tick));
    }
    ~FImpl()
    {
        if (TickHandle.IsValid()) FTSTicker::GetCoreTicker().RemoveTicker(TickHandle);
        CancelShot();
        if (AudioTap) { AudioTap->Stop(); AudioTap.Reset(); }
        if (Stage != EStage::Done)
        {
            // Early destruction cannot promise a fresh-frame analog zero. Clear owned state, and retain this limitation as a failed diagnostic.
            ReleaseInputs(); CleanupProved = false; FinalReason = TEXT("destroyed_before_cleanup_frame"); Finalize(false);
        }
        if (OwnsRunner) AgentVerify::Runtime::RunnerActive = false;
    }
    void Diagnostic()
    {
        if (OwnsRunner) { AgentVerify::Runtime::RunnerActive = false; OwnsRunner = false; }
        auto D = AgentVerify::Json::Object(); D->SetBoolField(TEXT("success"), false); D->SetStringField(TEXT("reason"), Error);
        if (OutputReady) AgentVerify::Json::Save(Output / TEXT("diagnostic.json"), D);
    }
    void Refuse(const TArray<FAgentVerifyIssue>& Issues)
    {
        FArray Records; for (const auto& I : Issues) Records.Add(AgentVerify::Json::Value(AgentVerify::Json::Issue(I.Code, I.Path, I.Message)));
        Validation->SetArrayField(TEXT("issues"), Records); FinalReason = TEXT("validation_refused"); Finalize(false);
    }
    void Increment(const FString& Name) { Execution->SetNumberField(Name, Execution->GetNumberField(Name) + 1); }
    void ObserveContention()
    {
        const FString Observed = Probe->ObserveContention(), Previous = Receipt->GetStringField(TEXT("contention"));
        Receipt->SetStringField(TEXT("contention"), Previous == TEXT("observed") || Observed == TEXT("observed") ? TEXT("observed") : Previous == TEXT("unknown") || Observed != TEXT("none") ? TEXT("unknown") : TEXT("none"));
    }
    bool Environment()
    {
        using namespace AgentVerify::Json;
        auto E = Object(); E->SetStringField(TEXT("engine"), FEngineVersion::Current().ToString()); E->SetStringField(TEXT("configuration"), LexToString(FApp::GetBuildConfiguration()));
        E->SetStringField(TEXT("map"), World.IsValid() ? World->GetMapName() : TEXT("unavailable")); E->SetStringField(TEXT("rhi"), GDynamicRHI ? GDynamicRHI->GetName() : TEXT("unavailable"));
        E->SetStringField(TEXT("gpu"), GRHIAdapterName.IsEmpty() ? TEXT("unavailable") : GRHIAdapterName);
        FString Hardware = FString(FPlatformMisc::GetCPUBrand()) + TEXT("|") + GRHIAdapterName + TEXT("|") + FString::Printf(TEXT("%llu"), static_cast<unsigned long long>(FPlatformMemory::GetConstants().TotalPhysical));
        FTCHARToUTF8 Utf8(*Hardware); TArray<uint8> Bytes; Bytes.Append(reinterpret_cast<const uint8*>(Utf8.Get()), Utf8.Length());
        const FString Digest = Hash(Bytes);
        if (Digest.Len() != 64) { Error = TEXT("hardware_hash_unavailable"); return false; }
        E->SetStringField(TEXT("hardware_id"), TEXT("hardware-") + Digest);
        const FString Profile = Probe->HardwareProfile(); E->SetStringField(TEXT("profile"), Token(Profile) ? Profile : TEXT("unclassified"));
        FIntPoint Size = FIntPoint(GSystemResolution.ResX, GSystemResolution.ResY);
        if (GEngine && GEngine->GameViewport && GEngine->GameViewport->Viewport) Size = GEngine->GameViewport->Viewport->GetSizeXY();
        auto Resolution = Object(); Resolution->SetNumberField(TEXT("width"), Size.X); Resolution->SetNumberField(TEXT("height"), Size.Y); E->SetObjectField(TEXT("resolution"), Resolution); Receipt->SetObjectField(TEXT("environment"), E);
        return true;
    }
    void Fail(const FString& Reason)
    {
        if (Stage == EStage::Done || Stage == EStage::Cleanup) return;
        FinalReason = Reason; AllChecks = false;
        CancelShot();
        if (AudioTap) { AudioTap->Stop(); AudioTap.Reset(); }
        Stage = EStage::Cleanup;
    }
    bool Tick(float)
    {
        if (Stage == EStage::Done) return false;
        if (LastEngineFrame == GFrameCounter) return true;
        LastEngineFrame = GFrameCounter; ++Frame;
        const double Now = FPlatformTime::Seconds(), Delta = Now - LastWall; LastWall = Now;
        if (!FMath::IsFinite(Delta) || Delta <= 0 || Delta * 1000 > 86400) { Fail(TEXT("wall_clock_invalid")); return true; }
        if (Stage == EStage::Cleanup) { ReleaseInputs(); Finalize(FinalReason.IsEmpty()); return false; }
        if (!World.IsValid()) { Fail(TEXT("world_unavailable")); return true; }
        ObserveContention(); StageWall += Delta;
        if (Stage == EStage::Warmup || Stage == EStage::Settle)
        {
            const FString Name = Stage == EStage::Warmup ? TEXT("warmup") : TEXT("settle");
            const auto Bounds = Request->GetObjectField(Name);
            Increment(Name + TEXT("_frames")); Execution->SetNumberField(Name + TEXT("_seconds"), StageWall);
            if (StageWall > Bounds->GetNumberField(TEXT("max_seconds"))) { Fail(Name + TEXT("_timeout")); return true; }
            if (Stage == EStage::Warmup)
            {
                Controller = World->GetFirstPlayerController();
                if (Controller.IsValid() && StageWall >= Bounds->GetNumberField(TEXT("min_seconds"))) { Stage = EStage::Settle; ExecutionStage = TEXT("settle"); StageWall = StableWall = 0; }
            }
            else
            {
                const bool CurrentlyReady = AgentVerify::Runtime::Settled();
                StableWall = CurrentlyReady ? StableWall + Delta : 0;
                if (AgentVerify::Domain::SettleReady(CurrentlyReady, StableWall, Bounds->GetNumberField(TEXT("min_seconds")))) { if (!Environment()) Fail(Error); else BeginPhase(); }
            }
            return true;
        }
        if (!Controller.IsValid()) { Fail(TEXT("controller_unavailable")); return true; }
        if (Stage == EStage::Capture) { CaptureTick(Delta); return true; }
        PhaseWall += Delta;
        if (!DriveActions()) { Sample(Delta); return true; }
        DriveAxes(); Sample(Delta);
        const double Duration = Phases[PhaseIndex]->GetNumberField(TEXT("seconds"));
        if (PhaseWall >= Duration)
        {
            // A bounded grace observes whether the actual audio renderer supplied the requested duration.
            if (AudioTap && !AudioTap->HasDuration(Duration) && PhaseWall < Duration + 1.0) return true;
            EndPhase();
        }
        return true;
    }
    void BeginPhase()
    {
        Stage = EStage::Run; ExecutionStage = TEXT("runtime"); PhaseWall = StageWall = 0; NextAction = 0; Increment(TEXT("phases_started"));
        AudioError.Empty();
        if (Phases[PhaseIndex]->HasField(TEXT("audio"))) { AudioTap = FAgentVerifyAudio::Start(World.Get()); if (!AudioTap) AudioError = TEXT("audio_tap_unavailable"); }
    }
    bool DriveActions()
    {
        using namespace AgentVerify::Json;
        const auto Phase = Phases[PhaseIndex]; const auto& Declared = Phase->GetArrayField(TEXT("actions"));
        while (NextAction < Declared.Num() && Declared[NextAction]->AsObject()->GetNumberField(TEXT("at")) <= PhaseWall)
        {
            const auto Action = Declared[NextAction]->AsObject(); const FString Type = Action->GetStringField(TEXT("type"));
            auto Record = Object(); Record->SetStringField(TEXT("phase"), Phase->GetStringField(TEXT("name"))); Record->SetNumberField(TEXT("index"), NextAction); Record->SetNumberField(TEXT("frame"), Frame); Actions.Add(Value(Record)); Increment(TEXT("actions_executed")); ++NextAction;
            if (Type == TEXT("command"))
            {
                const auto Console = IConsoleManager::Get().FindConsoleObject(*Action->GetStringField(TEXT("token")));
                TArray<FString> Args; for (const auto& Arg : Action->GetArrayField(TEXT("args"))) Args.Add(Arg->AsString());
                if (!Console || !Console->AsCommand() || !Console->AsCommand()->Execute(Args, World.Get(), *GLog)) { Fail(TEXT("command_failed")); return false; }
            }
            else
            {
                const auto Key = Action->GetStringField(TEXT("key"));
                if (Type == TEXT("axis")) { Axes.Add(Key, Action->GetNumberField(TEXT("value"))); InjectedAxes.Add(Key); }
                else
                {
                    const bool Down = Action->GetBoolField(TEXT("down")); Keys.Add(Key, Down); InjectedKeys.Add(Key);
                    Controller->InputKey(FInputKeyEventArgs::CreateSimulated(FKey(FName(*Key)), Down ? IE_Pressed : IE_Released, Down ? 1.0 : 0.0));
                }
            }
        }
        return true;
    }
    void DriveAxes()
    {
        for (const auto& Axis : Axes) Controller->InputKey(FInputKeyEventArgs::CreateSimulated(FKey(FName(*Axis.Key)), IE_Axis, Axis.Value));
    }
    void ReleaseInputs()
    {
        using namespace AgentVerify::Json;
        if ((!InjectedKeys.IsEmpty() || !InjectedAxes.IsEmpty()) && !Controller.IsValid()) { CleanupProved = false; return; }
        auto Release = [&](const FString& Key, const FString& Type)
        {
            Controller->InputKey(FInputKeyEventArgs::CreateSimulated(FKey(FName(*Key)), Type == TEXT("axis") ? IE_Axis : IE_Released, 0.0));
            auto Record = Object(); Record->SetStringField(TEXT("key"), Key); Record->SetStringField(TEXT("type"), Type); Record->SetNumberField(TEXT("value"), 0); Releases.Add(Value(Record));
        };
        for (const auto& Key : InjectedKeys) Release(Key, TEXT("key"));
        for (const auto& Key : InjectedAxes) Release(Key, TEXT("axis"));
        Keys.Empty(); Axes.Empty(); InjectedKeys.Empty(); InjectedAxes.Empty();
    }
    void Sample(double Delta)
    {
        using namespace AgentVerify::Json;
        const auto Phase = Phases[PhaseIndex]; auto Metrics = Object();
        for (const auto& Check : Phase->GetArrayField(TEXT("checks")))
        {
            const FString Name = Check->AsObject()->GetStringField(TEXT("metric")); if (Metrics->HasField(Name)) continue;
            const auto Observed = Probe->ReadMetric(Name); auto M = Object(); const bool Available = Observed.Available && FMath::IsFinite(Observed.Value);
            M->SetBoolField(TEXT("available"), Available); if (Available) M->SetNumberField(TEXT("value"), Observed.Value); else M->SetStringField(TEXT("reason"), Observed.Reason.IsEmpty() ? TEXT("nonfinite_or_unavailable") : Observed.Reason); Metrics->SetObjectField(Name, M);
        }
        auto Row = Object(); Row->SetNumberField(TEXT("frame"), Frame); Row->SetStringField(TEXT("phase"), Phase->GetStringField(TEXT("name"))); Row->SetNumberField(TEXT("elapsed_seconds"), PhaseWall); Row->SetNumberField(TEXT("wall_frame_ms"), Delta * 1000); Row->SetObjectField(TEXT("metrics"), Metrics); Trace.Add(Value(Row));
    }
    bool Artifact(const FString& RelativePath, const FString& Kind)
    {
        using namespace AgentVerify::Json;
        TArray<uint8> Bytes;
        if (!SafePath(RelativePath) || !FFileHelper::LoadFileToArray(Bytes, *(Output / RelativePath)) || Bytes.IsEmpty()) return false;
        const FString Digest = Hash(Bytes); if (Digest.Len() != 64) return false;
        auto Record = Object(); Record->SetStringField(TEXT("path"), RelativePath); Record->SetStringField(TEXT("kind"), Kind); Record->SetNumberField(TEXT("bytes"), Bytes.Num()); Record->SetStringField(TEXT("sha256"), Digest); Artifacts.Add(Value(Record)); return true;
    }
    void EndPhase()
    {
        using namespace AgentVerify::Json;
        const auto Phase = Phases[PhaseIndex]; const FString Name = Phase->GetStringField(TEXT("name"));
        for (const auto& CheckValue : Phase->GetArrayField(TEXT("checks")))
        {
            const auto Check = CheckValue->AsObject(); const FString Metric = Check->GetStringField(TEXT("metric")), Aggregation = Check->GetStringField(TEXT("aggregation"));
            bool Available = true; std::vector<double> Values;
            for (const auto& Row : Trace) if (Row->AsObject()->GetStringField(TEXT("phase")) == Name)
            {
                const auto M = Row->AsObject()->GetObjectField(TEXT("metrics"))->GetObjectField(Metric); Available &= M->GetBoolField(TEXT("available"));
                if (M->GetBoolField(TEXT("available"))) Values.push_back(M->GetNumberField(TEXT("value")));
            }
            Available &= !Values.empty(); double Number = 0;
            if (Available)
            {
                if (Aggregation == TEXT("last")) Number = Values.back();
                else if (Aggregation == TEXT("min")) Number = *std::min_element(Values.begin(), Values.end());
                else if (Aggregation == TEXT("max")) Number = *std::max_element(Values.begin(), Values.end());
                else for (double V : Values) Number += V / Values.size();
            }
            const bool Passed = Available && Number >= Check->GetNumberField(TEXT("min")) && Number <= Check->GetNumberField(TEXT("max")); AllChecks &= Passed;
            auto Record = Object(); Record->SetStringField(TEXT("id"), Check->GetStringField(TEXT("id"))); Record->SetStringField(TEXT("phase"), Name); Record->SetBoolField(TEXT("available"), Available); Record->SetBoolField(TEXT("passed"), Passed); Record->SetStringField(TEXT("reason"), !Available ? TEXT("metric_unavailable") : Passed ? TEXT("passed") : TEXT("expectation_failed")); if (Available) Record->SetNumberField(TEXT("value"), Number); else Record->SetField(TEXT("value"), Null()); Checks.Add(Value(Record));
        }
        if (Phase->HasField(TEXT("audio"))) FinishAudio();
        if (Phase->HasField(TEXT("capture")))
        {
            Stage = EStage::Capture; StageWall = 0; Hold = {}; CaptureTimeline.Empty(); ShotProcessed = ShotOwned = false;
            ShotRelative = Phase->GetObjectField(TEXT("capture"))->GetStringField(TEXT("id")) + TEXT(".png"); ShotPath = Output / ShotRelative;
        }
        else NextPhase();
    }
    void FinishAudio()
    {
        using namespace AgentVerify::Json;
        const auto Phase = Phases[PhaseIndex], Check = Phase->GetObjectField(TEXT("audio"));
        const FString RelativePath = Check->GetStringField(TEXT("id")) + TEXT(".wav"); int Rate = 0, Channels = 0, Frames = 0; double Rms = 0; bool Available = false;
        if (AudioTap) { AudioTap->Stop(); Available = AudioTap->WriteWav(Output / RelativePath, Phase->GetNumberField(TEXT("seconds")), Rate, Channels, Frames, Rms, AudioError); AudioTap.Reset(); }
        if (Available && !Artifact(RelativePath, TEXT("audio"))) { Available = false; AudioError = TEXT("audio_artifact_missing"); }
        const bool Passed = Available && Rms >= Check->GetNumberField(TEXT("min_rms_db")) && Rms <= Check->GetNumberField(TEXT("max_rms_db")); AllChecks &= Passed;
        auto Record = Object(); Record->SetStringField(TEXT("id"), Check->GetStringField(TEXT("id"))); Record->SetStringField(TEXT("phase"), Phase->GetStringField(TEXT("name"))); Record->SetBoolField(TEXT("available"), Available); Record->SetStringField(TEXT("reason"), Available ? Passed ? TEXT("passed") : TEXT("expectation_failed") : AudioError);
        Record->SetField(TEXT("artifact"), Available ? Text(RelativePath) : Null()); Record->SetNumberField(TEXT("start_frame"), 0); Record->SetNumberField(TEXT("frame_count"), Frames); Record->SetNumberField(TEXT("sample_rate"), Rate); Record->SetNumberField(TEXT("channels"), Channels); Record->SetField(TEXT("rms_db"), Available ? MakeShared<FJsonValueNumber>(Rms) : Null()); Record->SetStringField(TEXT("tap"), Available ? TEXT("master-mix") : TEXT("unavailable")); Audio.Add(Value(Record));
    }
    void CaptureTick(double Delta)
    {
        using namespace AgentVerify::Json;
        const auto Phase = Phases[PhaseIndex]; const auto Capture = Phase->GetObjectField(TEXT("capture")); const bool Settled = AgentVerify::Runtime::Settled();
        // Continue exactly one axis sample per real frame while holding a scene.
        DriveAxes();
        auto Row = Object(); Row->SetNumberField(TEXT("frame"), Frame); Row->SetNumberField(TEXT("wall_seconds"), Delta); Row->SetBoolField(TEXT("settled"), Settled); Row->SetBoolField(TEXT("screenshot_complete"), ShotProcessed); CaptureTimeline.Add(Value(Row));
        const bool WasPending = Hold.Stage == AgentVerify::Domain::FHold::EStage::Pending;
        const bool RequestShot = Hold.Tick(Delta, Settled, ShotProcessed, Request->GetObjectField(TEXT("settle"))->GetNumberField(TEXT("min_seconds")), Capture->GetNumberField(TEXT("wait_seconds")));
        if (ShotProcessed)
        {
            ShotProcessed = false; ShotOwned = false;
            if (ShotHandle.IsValid()) { FScreenshotRequest::OnScreenshotRequestProcessed().Remove(ShotHandle); ShotHandle.Reset(); }
            if (Hold.Stage == AgentVerify::Domain::FHold::EStage::Complete) { FinishCapture(Artifact(ShotRelative, TEXT("screenshot")) ? TEXT("passed") : TEXT("capture_missing")); return; }
            if (WasPending) IFileManager::Get().Delete(*ShotPath, false, true);
        }
        if (RequestShot)
        {
            if (FScreenshotRequest::IsScreenshotRequested()) { FinishCapture(TEXT("capture_busy")); return; }
            ShotHandle = FScreenshotRequest::OnScreenshotRequestProcessed().AddRaw(this, &FImpl::OnShotProcessed); ShotOwned = true;
            FScreenshotRequest::RequestScreenshot(ShotPath, false, false);
        }
        if (StageWall > Request->GetObjectField(TEXT("settle"))->GetNumberField(TEXT("max_seconds")) + Capture->GetNumberField(TEXT("wait_seconds")) + 90) FinishCapture(TEXT("capture_timeout"));
    }
    void OnShotProcessed() { if (ShotOwned) ShotProcessed = true; }
    void CancelShot()
    {
        // Ordinary screenshots are processed synchronously on the game thread. Reset only
        // our still-queued request; never reset another caller's replacement request.
        if (ShotOwned && FScreenshotRequest::IsScreenshotRequested() && FPaths::IsSamePath(FScreenshotRequest::GetFilename(), ShotPath)) FScreenshotRequest::Reset();
        if (ShotHandle.IsValid()) { FScreenshotRequest::OnScreenshotRequestProcessed().Remove(ShotHandle); ShotHandle.Reset(); }
        ShotOwned = ShotProcessed = false;
    }
    void FinishCapture(const FString& Reason)
    {
        using namespace AgentVerify::Json;
        const auto Phase = Phases[PhaseIndex]; const auto Capture = Phase->GetObjectField(TEXT("capture")); const bool Passed = Reason == TEXT("passed"); AllChecks &= Passed;
        auto Record = Object(); Record->SetStringField(TEXT("id"), Capture->GetStringField(TEXT("id"))); Record->SetStringField(TEXT("phase"), Phase->GetStringField(TEXT("name"))); Record->SetBoolField(TEXT("available"), Passed); Record->SetStringField(TEXT("reason"), Reason); Record->SetField(TEXT("artifact"), Passed ? Text(ShotRelative) : Null()); Record->SetNumberField(TEXT("hold_frames"), Hold.HoldFrames); Record->SetNumberField(TEXT("hold_seconds"), Hold.HoldSeconds); Record->SetNumberField(TEXT("compile_restarts"), Hold.CompileRestarts); Record->SetBoolField(TEXT("pending_settled"), !Hold.InvalidPending); Record->SetArrayField(TEXT("timeline"), CaptureTimeline); Captures.Add(Value(Record));
        CancelShot();
        NextPhase();
    }
    void NextPhase()
    {
        Increment(TEXT("phases_completed")); ++PhaseIndex;
        if (PhaseIndex >= Phases.Num()) { Stage = EStage::Cleanup; return; }
        BeginPhase();
    }
    void Finalize(bool Completed)
    {
        using namespace AgentVerify::Json;
        Stage = EStage::Done;
        if (!Receipt) { Diagnostic(); return; }
        if (OwnsRunner) { AgentVerify::Runtime::RunnerActive = false; OwnsRunner = false; }
        if (Completed) ExecutionStage = TEXT("complete");
        Execution->SetStringField(TEXT("stage"), ExecutionStage); Execution->SetNumberField(TEXT("checks_observed"), Checks.Num() + Captures.Num() + Audio.Num());
        Input->SetBoolField(TEXT("released"), CleanupProved); Input->SetArrayField(TEXT("keys_remaining"), Strings(InjectedKeys.Array())); Input->SetArrayField(TEXT("axes_remaining"), Strings(InjectedAxes.Array())); Input->SetArrayField(TEXT("release_events"), Releases);
        Receipt->SetObjectField(TEXT("execution"), Execution); Receipt->SetObjectField(TEXT("validation"), Validation); Receipt->SetObjectField(TEXT("input"), Input); Receipt->SetObjectField(TEXT("cache"), Cache);
        Receipt->SetArrayField(TEXT("actions"), Actions); Receipt->SetArrayField(TEXT("trace"), Trace); Receipt->SetArrayField(TEXT("checks"), Checks); Receipt->SetArrayField(TEXT("captures"), Captures); Receipt->SetArrayField(TEXT("audio"), Audio); Receipt->SetArrayField(TEXT("artifacts"), Artifacts);
        auto Timings = Object(); std::vector<double> Measured; int Unmeasured = 0; FArray Summaries;
        for (const auto& Phase : Phases)
        {
            std::vector<double> Samples;
            for (const auto& Row : Trace) if (Row->AsObject()->GetStringField(TEXT("phase")) == Phase->GetStringField(TEXT("name")))
            {
                if (Phase->GetBoolField(TEXT("measure"))) { const double Ms = Row->AsObject()->GetNumberField(TEXT("wall_frame_ms")); Samples.push_back(Ms); Measured.push_back(Ms); } else ++Unmeasured;
            }
            auto Entry = Object(); Entry->SetStringField(TEXT("name"), Phase->GetStringField(TEXT("name"))); Entry->SetBoolField(TEXT("measured"), Phase->GetBoolField(TEXT("measure"))); Entry->SetField(TEXT("summary"), AgentVerify::Runtime::Summary(Samples)); Summaries.Add(Value(Entry));
        }
        Timings->SetField(TEXT("measured"), AgentVerify::Runtime::Summary(Measured)); Timings->SetNumberField(TEXT("unmeasured_frames"), Unmeasured); Timings->SetArrayField(TEXT("phases"), Summaries); Receipt->SetObjectField(TEXT("timings"), Timings); Receipt->SetField(TEXT("budget"), Null());
        if (Request && Request->HasField(TEXT("budget")) && Validation->GetBoolField(TEXT("live"))) ApplyBudget(Measured);
        Success = Completed && AllChecks && CleanupProved;
        Receipt->SetBoolField(TEXT("success"), Success); Receipt->SetStringField(TEXT("reason"), Completed ? Success ? TEXT("passed") : TEXT("checks_failed") : FinalReason);
        if (!Save(Output / TEXT("receipt.json"), Receipt)) { Success = false; Error = TEXT("receipt_write_failed"); Diagnostic(); }
    }
    void ApplyBudget(const std::vector<double>& Samples)
    {
        using namespace AgentVerify::Json;
        const auto Budget = Request->GetObjectField(TEXT("budget")), Env = Receipt->GetObjectField(TEXT("environment")); FArray Reasons;
        const bool ContentionFree = Receipt->GetStringField(TEXT("contention")) == TEXT("none"); if (!ContentionFree) Reasons.Add(Text(TEXT("contention_unresolved")));
        const bool CacheVerified = Cache->GetStringField(TEXT("state")) != TEXT("unclassified") && Cache->GetStringField(TEXT("outcome")) == TEXT("verified");
        const bool CacheMatches = Cache->GetStringField(TEXT("state")) == Cache->GetStringField(TEXT("requested")) && Cache->GetStringField(TEXT("state")) == Budget->GetStringField(TEXT("cache_state"));
        if (!CacheVerified || !CacheMatches) Reasons.Add(Text(TEXT("cache_unqualified")));
        const bool HardwareMatches = Env->GetStringField(TEXT("hardware_id")) == Budget->GetStringField(TEXT("hardware_id")) && Env->GetStringField(TEXT("profile")) == Budget->GetStringField(TEXT("profile")); const bool Regression = Budget->GetStringField(TEXT("mode")) == TEXT("regression-guard");
        if (!Regression && !HardwareMatches) Reasons.Add(Text(TEXT("hardware_profile_mismatch")));
        const bool Eligible = AgentVerify::Domain::BudgetEligible(ContentionFree, CacheVerified, CacheMatches, HardwareMatches, Regression); AgentVerify::Domain::FSummary Stats;
        const bool Passed = AgentVerify::Domain::Summarize(Samples, Stats) && Eligible && Stats.Mean <= Budget->GetNumberField(TEXT("max_mean_ms")) && Stats.P95 <= Budget->GetNumberField(TEXT("max_p95_ms")) && Stats.P99 <= Budget->GetNumberField(TEXT("max_p99_ms")) && Stats.Maximum <= Budget->GetNumberField(TEXT("max_ms"));
        auto Result = Object(); Result->SetBoolField(TEXT("eligible"), Eligible); Result->SetBoolField(TEXT("passed"), Passed); Result->SetArrayField(TEXT("reasons"), Reasons); Result->SetStringField(TEXT("limitation"), Regression ? HardwareMatches ? TEXT("regression_guard_only") : TEXT("cross_hardware_regression_guard_only") : TEXT("hardware_targeted")); Receipt->SetObjectField(TEXT("budget"), Result); AllChecks &= Passed;
    }
};

FAgentVerifyRunner::FAgentVerifyRunner(UWorld* World, TSharedRef<IAgentVerifyProbe> Probe, const FString& RequestPath, const FString& FreshOutputDirectory)
    : Impl(MakeUnique<FImpl>(World, Probe, RequestPath, FreshOutputDirectory)) {}
FAgentVerifyRunner::~FAgentVerifyRunner() = default;
bool FAgentVerifyRunner::IsFinished() const { return Impl->Stage == FImpl::EStage::Done; }
bool FAgentVerifyRunner::Succeeded() const { return Impl->Success; }
FString FAgentVerifyRunner::ReceiptPath() const { return Impl->Output / TEXT("receipt.json"); }
void FAgentVerifyRunner::Cancel(const FString& Reason) { Impl->Fail(Reason.IsEmpty() ? TEXT("cancelled") : Reason); }
