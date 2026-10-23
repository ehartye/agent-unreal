#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

// In 5.8 EAutomationTestFlags is an enum class. The macro's static asserts need at least one application-context flag
// (EAutomationTestFlags_ApplicationContextMask) and exactly one filter flag (EAutomationTestFlags_FilterMask).
// Combine them with | ; EAutomationTestFlags::Type does not exist in 5.8.
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FAgentProbePassingTest, "AgentUnrealProbe.Passing",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::ProductFilter)

bool FAgentProbePassingTest::RunTest(const FString& Parameters)
{
	TestEqual(TEXT("two plus two"), 2 + 2, 4);
	TestTrue(TEXT("string search"), FString(TEXT("automation")).Contains(TEXT("mat")));
	return true;
}

// Always fails, to show how a failure appears in the report. Run it by its own filter.
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FAgentProbeFailingTest, "AgentUnrealProbe.DeliberateFailure",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::ProductFilter)

bool FAgentProbeFailingTest::RunTest(const FString& Parameters)
{
	TestEqual(TEXT("two plus two is five"), 2 + 2, 5);
	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
