#include "Misc/AutomationTest.h"
#include "AgentVerifyRunner.h"
#include "AgentVerifyJson.h"
#include "Domain/AgentVerifyRules.h"
#include "Misc/Paths.h"
#include "Misc/Guid.h"
#include <limits>

#if WITH_DEV_AUTOMATION_TESTS
namespace AgentVerify::Tests
{
    constexpr EAutomationTestFlags Flags = EAutomationTestFlags::EditorContext | EAutomationTestFlags::ProductFilter;
    TSharedPtr<FJsonValue> Document()
    {
        TSharedPtr<FJsonValue> Result;
        Json::Parse(TEXT(R"({"schema_version":1,"request_id":"native-rules","kind":"replay","warmup":{"min_seconds":0,"max_seconds":3},"settle":{"min_seconds":0,"max_seconds":3},"save_sandbox":false,"cache":{"requested":"unclassified","preparation":"native rule fixture"},"phases":[{"name":"observe","seconds":1,"measure":true,"actions":[],"checks":[{"id":"sample","metric":"sample","aggregation":"last","min":0,"max":10}]}]})"), Result);
        return Result;
    }
    bool Has(const TArray<FAgentVerifyIssue>& Issues, const FString& Code)
    {
        return Issues.ContainsByPredicate([&](const auto& Issue) { return Issue.Code == Code; });
    }
    struct FProbe : IAgentVerifyProbe
    {
        mutable int Reads = 0;
        virtual TArray<FString> MetricNames() const override { return {TEXT("sample")}; }
        virtual FAgentVerifyMetric ReadMetric(const FString&) const override { ++Reads; return FAgentVerifyMetric::Unavailable(TEXT("fixture intentionally unavailable")); }
    };
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FAgentVerifyStructural, "AgentVerify.A2.StructuralPrevalidation", AgentVerify::Tests::Flags)
bool FAgentVerifyStructural::RunTest(const FString&)
{
    using namespace AgentVerify::Tests;
    auto Doc = Document(); TestTrue(TEXT("valid request"), FAgentVerifyRunner::ValidateDocument(Doc).IsEmpty());
    Doc->AsObject()->SetNumberField(TEXT("schema_version"), 2);
    TestTrue(TEXT("unknown version refused"), Has(FAgentVerifyRunner::ValidateDocument(Doc), TEXT("schema.const")));
    Doc = Document(); Doc->AsObject()->SetBoolField(TEXT("extra"), true);
    TestTrue(TEXT("unknown field refused"), Has(FAgentVerifyRunner::ValidateDocument(Doc), TEXT("schema.unknown")));
    Doc = Document(); Doc->AsObject()->GetArrayField(TEXT("phases"))[0]->AsObject()->SetArrayField(TEXT("checks"), {});
    TestTrue(TEXT("empty observations refused"), Has(FAgentVerifyRunner::ValidateDocument(Doc), TEXT("document.no_observations")));
    Doc = Document(); Doc->AsObject()->GetObjectField(TEXT("settle"))->SetNumberField(TEXT("min_seconds"), 4);
    TestTrue(TEXT("unbounded settle refused"), Has(FAgentVerifyRunner::ValidateDocument(Doc), TEXT("document.stage_bounds")));
    TestTrue(TEXT("malformed root refused"), Has(FAgentVerifyRunner::ValidateDocument(nullptr), TEXT("schema.type")));
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FAgentVerifyLive, "AgentVerify.A2.LiveNamesBeforeActions", AgentVerify::Tests::Flags)
bool FAgentVerifyLive::RunTest(const FString&)
{
    using namespace AgentVerify::Tests; using namespace AgentVerify::Json;
    FProbe Probe; auto Doc = Document();
    TestTrue(TEXT("known name accepted"), FAgentVerifyRunner::ValidateLiveNames(Doc, Probe).IsEmpty());
    auto Phase = Doc->AsObject()->GetArrayField(TEXT("phases"))[0]->AsObject();
    Phase->GetArrayField(TEXT("checks"))[0]->AsObject()->SetStringField(TEXT("metric"), TEXT("absent"));
    TestTrue(TEXT("unknown metric refused"), Has(FAgentVerifyRunner::ValidateLiveNames(Doc, Probe), TEXT("unknown_metric")));
    Doc = Document(); Doc->AsObject()->SetBoolField(TEXT("save_sandbox"), true);
    TestTrue(TEXT("sandbox refusal"), Has(FAgentVerifyRunner::ValidateLiveNames(Doc, Probe), TEXT("sandbox_unavailable")));
    Doc = Document(); Phase = Doc->AsObject()->GetArrayField(TEXT("phases"))[0]->AsObject();
    auto Action = Object(); Action->SetNumberField(TEXT("at"), 0); Action->SetStringField(TEXT("type"), TEXT("key")); Action->SetStringField(TEXT("key"), TEXT("UnknownAgentVerifyKey")); Action->SetBoolField(TEXT("down"), true); Phase->SetArrayField(TEXT("actions"), {Value(Action)});
    TestTrue(TEXT("unknown physical key refused"), Has(FAgentVerifyRunner::ValidateLiveNames(Doc, Probe), TEXT("unknown_key")));
    Action = Object(); Action->SetNumberField(TEXT("at"), 0); Action->SetStringField(TEXT("type"), TEXT("command")); Action->SetStringField(TEXT("token"), TEXT("AgentVerify.Absent")); Action->SetArrayField(TEXT("args"), {}); Phase->SetArrayField(TEXT("actions"), {Value(Action)});
    TestTrue(TEXT("unknown command refused"), Has(FAgentVerifyRunner::ValidateLiveNames(Doc, Probe), TEXT("unknown_command")));
    TestEqual(TEXT("prevalidation never samples"), Probe.Reads, 0);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FAgentVerifyRefusal, "AgentVerify.A2.RefusalReceiptHasZeroActions", AgentVerify::Tests::Flags)
bool FAgentVerifyRefusal::RunTest(const FString&)
{
    using namespace AgentVerify::Tests; using namespace AgentVerify::Json;
    // Receipt identity hashes exact bytes, including empty and binary input.
    TestEqual(TEXT("SHA256 empty"), Hash({}), FString(TEXT("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")));
    TestEqual(TEXT("SHA256 abc"), Hash({0x61, 0x62, 0x63}), FString(TEXT("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")));
    const ANSICHAR MultiBlock[] = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
    TArray<uint8> Bytes; Bytes.Append(reinterpret_cast<const uint8*>(MultiBlock), sizeof(MultiBlock) - 1);
    TestEqual(TEXT("SHA256 padded multi-block"), Hash(Bytes), FString(TEXT("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1")));
    Bytes.Reset(); for (int I = 0; I < 256; ++I) Bytes.Add(static_cast<uint8>(I));
    TestEqual(TEXT("SHA256 binary full blocks"), Hash(Bytes), FString(TEXT("40aff2e9d2d8922e47afd4648e6967497158785fbd1da870e7110266bf944880")));
    auto Doc = Document(); Doc->AsObject()->SetNumberField(TEXT("schema_version"), 2);
    const FString Root = FPaths::ProjectSavedDir() / TEXT("AgentVerifyRules") / FGuid::NewGuid().ToString(EGuidFormats::Digits);
    IFileManager::Get().MakeDirectory(*Root, true);
    const FString Input = Root / TEXT("request.json"); TestTrue(TEXT("fixture saved"), Save(Input, Doc->AsObject()));
    auto Probe = MakeShared<FProbe>(); FAgentVerifyRunner Runner(nullptr, Probe, Input, Root / TEXT("evidence"));
    TestTrue(TEXT("refusal completes synchronously"), Runner.IsFinished()); TestFalse(TEXT("refusal cannot pass"), Runner.Succeeded());
    TSharedPtr<FJsonValue> Receipt; if (!TestTrue(TEXT("receipt retained"), ReadJson(Runner.ReceiptPath(), Receipt))) return false;
    TestEqual(TEXT("zero actions"), Receipt->AsObject()->GetObjectField(TEXT("execution"))->GetNumberField(TEXT("actions_executed")), 0.0);
    TestEqual(TEXT("zero observed frames"), Receipt->AsObject()->GetArrayField(TEXT("trace")).Num(), 0);
    TestEqual(TEXT("zero reads"), Probe->Reads, 0);
    AddInfo(TEXT("Refusal evidence: ") + Root); return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FAgentVerifyStatistics, "AgentVerify.A3.NearestRankStatistics", AgentVerify::Tests::Flags)
bool FAgentVerifyStatistics::RunTest(const FString&)
{
    using namespace AgentVerify::Domain;
    std::vector<double> Samples; for (int I = 1; I <= 100; ++I) Samples.push_back(I);
    FSummary S; TestTrue(TEXT("finite samples"), Summarize(Samples, S)); TestEqual(TEXT("mean"), S.Mean, 50.5); TestEqual(TEXT("p95"), S.P95, 95.0); TestEqual(TEXT("p99"), S.P99, 99.0); TestEqual(TEXT("maximum"), S.Maximum, 100.0);
    TestFalse(TEXT("empty unavailable"), Summarize({}, S)); TestFalse(TEXT("NaN unavailable"), Summarize({std::numeric_limits<double>::quiet_NaN()}, S)); TestFalse(TEXT("negative invalid"), Summarize({-1}, S));
    TestTrue(TEXT("one sample"), Summarize({7}, S)); TestEqual(TEXT("one sample p99"), S.P99, 7.0); return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FAgentVerifyEligibility, "AgentVerify.A3.EligibilityAndUnavailableMetrics", AgentVerify::Tests::Flags)
bool FAgentVerifyEligibility::RunTest(const FString&)
{
    using namespace AgentVerify::Domain;
    TestTrue(TEXT("fully qualified"), BudgetEligible(true, true, true, true, false));
    TestFalse(TEXT("unknown contention"), BudgetEligible(false, true, true, true, false));
    TestFalse(TEXT("unverified cache"), BudgetEligible(true, false, true, true, false));
    TestFalse(TEXT("different cache"), BudgetEligible(true, true, false, true, false));
    TestFalse(TEXT("different hardware"), BudgetEligible(true, true, true, false, false));
    TestTrue(TEXT("explicit cross-hardware regression guard"), BudgetEligible(true, true, true, false, true));
    TestFalse(TEXT("missing metric is not zero-valued success"), FAgentVerifyMetric::Unavailable(TEXT("absent")).Available);
    TestFalse(TEXT("nonfinite metric unavailable"), FAgentVerifyMetric::Number(std::numeric_limits<double>::infinity()).Available);
    TestTrue(TEXT("real zero remains available"), FAgentVerifyMetric::Number(0).Available); return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FAgentVerifyHold, "AgentVerify.A4.RealFrameHoldAndCompileRestart", AgentVerify::Tests::Flags)
bool FAgentVerifyHold::RunTest(const FString&)
{
    using namespace AgentVerify::Domain;
    TestFalse(TEXT("zero minimum does not bypass busy compilation"), SettleReady(false, 0, 0));
    TestTrue(TEXT("zero minimum still requires ready"), SettleReady(true, 0, 0));
    FHold Hold; TestFalse(TEXT("settle completing frame excluded"), Hold.Tick(0.01, true, false, 0, 0));
    for (int I = 0; I < 89; ++I) TestFalse(TEXT("fewer than ninety actual frames"), Hold.Tick(0.01, true, false, 0, 0));
    TestTrue(TEXT("ninetieth real frame requests"), Hold.Tick(0.01, true, false, 0, 0));
    Hold.Tick(0.01, false, false, 0, 0); Hold.Tick(0.01, true, true, 0, 0);
    TestEqual(TEXT("pending compile invalidation resets count"), Hold.HoldFrames, 0); TestEqual(TEXT("pending restart retained"), Hold.CompileRestarts, 1);
    Hold.Tick(0.01, true, false, 0, 0); for (int I = 0; I < 20; ++I) Hold.Tick(0.01, true, false, 0, 0);
    Hold.Tick(0.01, false, false, 0, 0); TestEqual(TEXT("mid-hold compile resets count"), Hold.HoldFrames, 0);
    Hold.Tick(0.01, true, false, 0, 0); for (int I = 0; I < 90; ++I) Hold.Tick(0.01, true, false, 0, 0);
    Hold.Tick(0.01, true, true, 0, 0); TestTrue(TEXT("settled completion"), Hold.Stage == FHold::EStage::Complete); return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FAgentVerifyAudioDuration, "AgentVerify.A4.FullPhaseAudioRequired", AgentVerify::Tests::Flags)
bool FAgentVerifyAudioDuration::RunTest(const FString&)
{
    using namespace AgentVerify::Domain;
    TestFalse(TEXT("empty audio cannot pass"), AudioComplete(0, 48000, 2, 1));
    TestFalse(TEXT("convenient partial slice cannot pass"), AudioComplete(24000, 48000, 2, 1));
    TestFalse(TEXT("unknown format cannot pass"), AudioComplete(48000, 0, 2, 1));
    TestTrue(TEXT("full requested duration"), AudioComplete(48000, 48000, 2, 1)); return true;
}
#endif
