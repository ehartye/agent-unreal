#include "AECompare.h"
#include "Dom/JsonObject.h"
#include "HAL/IConsoleManager.h"
#include "HAL/PlatformTime.h"

// The perf comparison set (AECompare.h), named "perf". It checks that the receipt's perf block (wall frame time, game thread, render thread and the GPU's own frame time) tells a GPU-side
// change from a CPU-side one, and it uses nothing but engine settings, so it builds and runs in any project:
//   perf-baseline         the empty stage
//   perf-gpu-supersample  r.ScreenPercentage 200 while it is spawned: about four times the pixels, the same game-thread work
//   perf-cpu-spin         the game thread busy-waits PerfSetsDetail::SpinMilliseconds every frame: more game-thread time, no extra GPU work
// Expected reading: the supersample row's gpu_ms rises over the baseline and its game_thread_ms does not; the spin row's game_thread_ms rises and its gpu_ms does not.
// The showcase phase spawns every candidate at once, so its two screenshots are filmed with r.ScreenPercentage at 200; only the stress rows are the measurement.
namespace PerfSetsDetail {
constexpr double SpinMilliseconds=4.0;
constexpr float SupersamplePercent=200.f;

AECompare::FCandidate PerfBaseline() {
    AECompare::FCandidate C;
    C.Id=TEXT("perf-baseline"); C.Label=TEXT("BASELINE: nothing"); C.Note=TEXT("the empty stage\nthe reference row");
    return C;
}

/** Spawn raises r.ScreenPercentage, Clear puts back the value it found. The harness clears every candidate before each phase, so the setting never leaks into the next row. */
AECompare::FCandidate PerfSupersample() {
    struct FState { float Previous=0.f; bool bChanged=false; };
    const TSharedRef<FState> State=MakeShared<FState>();
    AECompare::FCandidate C;
    C.Id=TEXT("perf-gpu-supersample"); C.Label=TEXT("GPU: 200% screen percentage"); C.Note=TEXT("r.ScreenPercentage 200\nmore pixels, no extra game code");
    C.StressCount=1;
    C.Spawn=[State](AActor&,const FTransform&,int32) {
        if(IConsoleVariable* Variable=IConsoleManager::Get().FindConsoleVariable(TEXT("r.ScreenPercentage"))) {
            if(!State->bChanged) { State->Previous=Variable->GetFloat(); State->bChanged=true; }
            Variable->Set(SupersamplePercent,ECVF_SetByConsole);
        }
    };
    C.Clear=[State]() {
        if(!State->bChanged) return;
        if(IConsoleVariable* Variable=IConsoleManager::Get().FindConsoleVariable(TEXT("r.ScreenPercentage"))) Variable->Set(State->Previous,ECVF_SetByConsole);
        State->bChanged=false;
    };
    C.Describe=[](FJsonObject& Into) {
        Into.SetStringField(TEXT("gpu_side_change"),TEXT("r.ScreenPercentage 200"));
    };
    return C;
}

/** Busy-wait on the game thread. FPlatformTime::Seconds is an external call, so the loop is not optimised away. */
AECompare::FCandidate PerfCpuSpin() {
    AECompare::FCandidate C;
    C.Id=TEXT("perf-cpu-spin"); C.Label=TEXT("CPU: game thread spin"); C.Note=TEXT("busy-waits 4 ms on the game thread\nno extra GPU work");
    C.StressCount=1;
    C.Tick=[](float,double,const FVector&) {
        const double End=FPlatformTime::Seconds()+SpinMilliseconds*0.001;
        while(FPlatformTime::Seconds()<End) {}
    };
    C.Describe=[](FJsonObject& Into) {
        Into.SetNumberField(TEXT("cpu_spin_ms"),SpinMilliseconds);
    };
    return C;
}
}

static AECompare::FSet MakePerfSet() {
    using namespace PerfSetsDetail;
    AECompare::FSet Set;
    Set.Name=TEXT("perf"); Set.Title=TEXT("PERF: baseline, GPU-side change, CPU-side change");
    Set.Candidates.Add(PerfBaseline());
    Set.Candidates.Add(PerfSupersample());
    Set.Candidates.Add(PerfCpuSpin());
    return Set;
}

static AECompare::FRegistrar PerfRegistrar(TEXT("perf"),&MakePerfSet);
