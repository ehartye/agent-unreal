#include "UnityProbeTypes.h"

namespace
{
	constexpr int32 BurstCount = 5;
}

using namespace UnityProbeBetaStates;

int32 UnityProbeBetaValue()
{
	// Fine on its own: nothing in this file named MaxCount is in scope. After ProbeAlpha.cpp's using-directive it hides UnityProbeLimits::MaxCount.
	const int32 MaxCount = 2;
	const EState State = EState::Done;
	return BurstCount + MaxCount + static_cast<int32>(State);
}
