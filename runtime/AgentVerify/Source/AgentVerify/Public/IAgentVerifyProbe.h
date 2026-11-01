#pragma once

#include "CoreMinimal.h"

/** Unavailable is a first-class result, never a successful zero. */
struct FAgentVerifyMetric
{
    bool Available = false;
    double Value = 0.0;
    FString Reason = TEXT("unavailable");
    static FAgentVerifyMetric Number(double Number)
    {
        return FMath::IsFinite(Number) ? FAgentVerifyMetric{true, Number, FString()} : FAgentVerifyMetric{false, 0.0, TEXT("nonfinite_metric")};
    }
    static FAgentVerifyMetric Unavailable(const FString& Why) { return {false, 0.0, Why.IsEmpty() ? TEXT("unavailable") : Why}; }
};

struct FAgentVerifyCacheObservation
{
    FString State = TEXT("unclassified");
    FString Outcome = TEXT("unclassified");
    FString Evidence = TEXT("No preparation was observed");
};

/** Consumer-owned metrics, command allowlist and optional isolated-save preparation. All methods run on the game thread. */
class AGENTVERIFY_API IAgentVerifyProbe
{
public:
    virtual ~IAgentVerifyProbe() = default;
    virtual TArray<FString> MetricNames() const = 0;
    virtual FAgentVerifyMetric ReadMetric(const FString& Name) const = 0;
    // Tokens must also resolve to an IConsoleCommand; console-variable assignment and command chaining are not replay actions.
    virtual TArray<FString> CommandNames() const { return {}; }
    virtual bool HasSaveSandbox() const { return false; }
    virtual bool PrepareSaveSandbox(FString& Reason) { Reason = TEXT("sandbox_unavailable"); return false; }
    virtual FAgentVerifyCacheObservation PrepareCache(const FString& Requested, const FString& Preparation) { return {}; }
    // Unknown remains ineligible for a performance pass. A consumer must supply an actual monitor, not a requested label.
    virtual FString ObserveContention() const { return TEXT("unknown"); }
    virtual FString HardwareProfile() const { return TEXT("unclassified"); }
};
