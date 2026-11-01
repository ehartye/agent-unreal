#include "AgentVerifyRunner.h"
#include "AgentVerifyJson.h"
#include "HAL/IConsoleManager.h"
#include "InputCoreTypes.h"

TArray<FAgentVerifyIssue> FAgentVerifyRunner::ValidateDocument(const TSharedPtr<FJsonValue>& Document)
{
    using namespace AgentVerify::Json;
    FValue Shape;
    if (!ReadJson(PluginRoot() / TEXT("Resources/document-v1.schema.json"), Shape) || Shape->Type != EJson::Object) return {{TEXT("schema.unavailable"), TEXT("$"), TEXT("Bundled document schema is missing or invalid")}};
    auto Issues = Schema(Document, Shape->AsObject());
    if (!Issues.IsEmpty()) return Issues;
    const auto Root = Document->AsObject();
    for (const FString Stage : {TEXT("warmup"), TEXT("settle")})
    {
        const auto Bounds = Root->GetObjectField(Stage);
        if (Bounds->GetNumberField(TEXT("min_seconds")) > Bounds->GetNumberField(TEXT("max_seconds"))) Issues.Add({TEXT("document.stage_bounds"), TEXT("$.") + Stage, TEXT("Minimum exceeds maximum")});
    }
    TSet<FString> Names, Ids; bool DuplicatePhase = false, DuplicateId = false, HasShot = false, HasMeasured = false; int Observations = 0;
    const auto& Phases = Root->GetArrayField(TEXT("phases"));
    for (int Index = 0; Index < Phases.Num(); ++Index)
    {
        const auto Phase = Phases[Index]->AsObject(); const FString Path = FString::Printf(TEXT("$.phases[%d]"), Index);
        const FString Name = Phase->GetStringField(TEXT("name")); DuplicatePhase |= Names.Contains(Name); Names.Add(Name);
        HasMeasured |= Phase->GetBoolField(TEXT("measure")); double Previous = -1;
        const auto& Actions = Phase->GetArrayField(TEXT("actions"));
        for (int ActionIndex = 0; ActionIndex < Actions.Num(); ++ActionIndex)
        {
            const double At = Actions[ActionIndex]->AsObject()->GetNumberField(TEXT("at"));
            if (At < Previous || At >= Phase->GetNumberField(TEXT("seconds"))) Issues.Add({TEXT("document.action_time"), FString::Printf(TEXT("%s.actions[%d]"), *Path, ActionIndex), TEXT("Actions must be ordered and before phase end")});
            Previous = At;
        }
        auto AddId = [&](const FString& Id) { DuplicateId |= Ids.Contains(Id); Ids.Add(Id); ++Observations; };
        for (const auto& CheckValue : Phase->GetArrayField(TEXT("checks")))
        {
            const auto Check = CheckValue->AsObject(); AddId(Check->GetStringField(TEXT("id")));
            if (Check->GetNumberField(TEXT("min")) > Check->GetNumberField(TEXT("max"))) Issues.Add({TEXT("document.check_range"), Path, TEXT("Minimum exceeds maximum")});
            if (Check->GetStringField(TEXT("metric")).StartsWith(TEXT("frame."))) Issues.Add({TEXT("document.reserved_metric"), Path, TEXT("Frame timing uses the budget contract")});
        }
        const FObject* Observation = nullptr;
        if (Phase->TryGetObjectField(TEXT("capture"), Observation)) { HasShot = true; AddId((*Observation)->GetStringField(TEXT("id"))); }
        if (Phase->TryGetObjectField(TEXT("audio"), Observation))
        {
            AddId((*Observation)->GetStringField(TEXT("id")));
            if ((*Observation)->GetNumberField(TEXT("min_rms_db")) > (*Observation)->GetNumberField(TEXT("max_rms_db"))) Issues.Add({TEXT("document.audio_range"), Path, TEXT("Minimum exceeds maximum")});
        }
    }
    if (DuplicatePhase) Issues.Add({TEXT("document.duplicate_phase"), TEXT("$.phases"), TEXT("Phase names must be unique")});
    if (DuplicateId) Issues.Add({TEXT("document.duplicate_check"), TEXT("$.phases"), TEXT("Check IDs must be unique")});
    if (!Observations) Issues.Add({TEXT("document.no_observations"), TEXT("$.phases"), TEXT("At least one observation is required")});
    if (Root->GetStringField(TEXT("kind")) == TEXT("shot") && !HasShot) Issues.Add({TEXT("document.shot_missing"), TEXT("$.phases"), TEXT("Shot requires a capture")});
    const FObject* Budget = nullptr;
    if (Root->TryGetObjectField(TEXT("budget"), Budget))
    {
        if (!HasMeasured) Issues.Add({TEXT("document.unmeasured_budget"), TEXT("$.budget"), TEXT("Budget requires measured frames")});
        if ((*Budget)->GetStringField(TEXT("cache_state")) != Root->GetObjectField(TEXT("cache"))->GetStringField(TEXT("requested"))) Issues.Add({TEXT("document.cache_request"), TEXT("$.budget.cache_state"), TEXT("Budget and requested cache state differ")});
    }
    return Issues;
}

TArray<FAgentVerifyIssue> FAgentVerifyRunner::ValidateLiveNames(const TSharedPtr<FJsonValue>& Document, const IAgentVerifyProbe& Probe)
{
    auto Issues = ValidateDocument(Document);
    if (!Issues.IsEmpty()) return Issues;
    const auto Metrics = Probe.MetricNames(), Commands = Probe.CommandNames();
    const auto Root = Document->AsObject(); const auto& Phases = Root->GetArrayField(TEXT("phases"));
    for (int Index = 0; Index < Phases.Num(); ++Index)
    {
        const auto Phase = Phases[Index]->AsObject(); const FString Path = FString::Printf(TEXT("$.phases[%d]"), Index);
        const auto& Checks = Phase->GetArrayField(TEXT("checks"));
        for (int CheckIndex = 0; CheckIndex < Checks.Num(); ++CheckIndex)
        {
            const FString Name = Checks[CheckIndex]->AsObject()->GetStringField(TEXT("metric"));
            if (!Metrics.Contains(Name)) Issues.Add({TEXT("unknown_metric"), FString::Printf(TEXT("%s.checks[%d].metric"), *Path, CheckIndex), Name});
        }
        const auto& Actions = Phase->GetArrayField(TEXT("actions"));
        for (int ActionIndex = 0; ActionIndex < Actions.Num(); ++ActionIndex)
        {
            const auto Action = Actions[ActionIndex]->AsObject(); const FString Type = Action->GetStringField(TEXT("type"));
            if (Type == TEXT("command"))
            {
                const FString Name = Action->GetStringField(TEXT("token")); const auto Console = IConsoleManager::Get().FindConsoleObject(*Name);
                if (!Commands.Contains(Name) || !Console || !Console->AsCommand()) Issues.Add({TEXT("unknown_command"), FString::Printf(TEXT("%s.actions[%d].token"), *Path, ActionIndex), Name});
            }
            else
            {
                const FString Name = Action->GetStringField(TEXT("key")); const FKey Key{FName(*Name)};
                if (!Key.IsValid() || Key.IsAnalog() != (Type == TEXT("axis"))) Issues.Add({TEXT("unknown_key"), FString::Printf(TEXT("%s.actions[%d].key"), *Path, ActionIndex), TEXT("Unknown key or wrong digital/analog kind: ") + Name});
            }
        }
    }
    if (Root->GetBoolField(TEXT("save_sandbox")) && !Probe.HasSaveSandbox()) Issues.Add({TEXT("sandbox_unavailable"), TEXT("$.save_sandbox"), TEXT("Consumer has no save sandbox hook")});
    return Issues;
}
