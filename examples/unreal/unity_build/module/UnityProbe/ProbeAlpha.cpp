#include "UnityProbeTypes.h"

// Clash 1: an anonymous-namespace constant. ProbeBeta.cpp declares one with the same name.
namespace
{
	constexpr int32 BurstCount = 3;
}

// Clash 2: a using-directive. In a unity chunk it stays in force for every file merged after this one.
using namespace UnityProbeLimits;
// Clash 3: this directive makes EState mean UnityProbeAlphaStates::EState; ProbeBeta.cpp does the same with its own EState.
using namespace UnityProbeAlphaStates;

int32 UnityProbeAlphaValue()
{
	const EState State = EState::Active;
	return BurstCount + MaxCount + static_cast<int32>(State);
}
