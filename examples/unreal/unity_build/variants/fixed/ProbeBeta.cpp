#include "UnityProbeTypes.h"

namespace
{
	constexpr int32 BetaBurstCount = 5;
}

int32 UnityProbeBetaValue()
{
	const int32 MaxCount = 2;
	const UnityProbeBetaStates::EState State = UnityProbeBetaStates::EState::Done;
	return BetaBurstCount + MaxCount + static_cast<int32>(State);
}
