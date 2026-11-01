#include "../Domain/TravelRule.h"
#include "Misc/AutomationTest.h"
#if WITH_DEV_AUTOMATION_TESTS
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSampleTravelRule, "ObservationSample.Domain.Travel.ReleasedAxisStopsMovement", EAutomationTestFlags::EditorContext | EAutomationTestFlags::ProductFilter)
bool FSampleTravelRule::RunTest(const FString&)
{
    TestEqual(TEXT("mapped deflection moves the game position"), ObservationSample::Domain::Travel(0, .5, 1), 50.0);
    TestEqual(TEXT("release preserves the game position"), ObservationSample::Domain::Travel(50, 0, 1), 50.0);
    TestEqual(TEXT("input is bounded by the game rule"), ObservationSample::Domain::Travel(0, 2, 1), 100.0);
    return true;
}
#endif
