#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonValue.h"
#include "IAgentVerifyProbe.h"

class UWorld;

struct FAgentVerifyIssue
{
    FString Code;
    FString Path;
    FString Message;
};

/** Own this object until IsFinished(), including after Cancel(), so the next frame can deliver release zeros exactly once. */
class AGENTVERIFY_API FAgentVerifyRunner
{
public:
    FAgentVerifyRunner(UWorld* World, TSharedRef<IAgentVerifyProbe> Probe, const FString& RequestPath, const FString& FreshOutputDirectory);
    ~FAgentVerifyRunner();
    FAgentVerifyRunner(const FAgentVerifyRunner&) = delete;
    FAgentVerifyRunner& operator=(const FAgentVerifyRunner&) = delete;
    bool IsFinished() const;
    bool Succeeded() const;
    FString ReceiptPath() const;
    void Cancel(const FString& Reason = TEXT("cancelled"));
    // Structural validation has no world, input or command side effects.
    static TArray<FAgentVerifyIssue> ValidateDocument(const TSharedPtr<FJsonValue>& Document);
    static TArray<FAgentVerifyIssue> ValidateLiveNames(const TSharedPtr<FJsonValue>& Document, const IAgentVerifyProbe& Probe);
private:
    struct FImpl;
    TUniquePtr<FImpl> Impl;
};
