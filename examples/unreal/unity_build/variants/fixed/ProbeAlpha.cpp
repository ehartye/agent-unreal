#include "UnityProbeTypes.h"

// Fix 1: a prefix that names the file, so no other file can pick the same name.
namespace
{
	constexpr int32 AlphaBurstCount = 3;
}

// Fix 2 and 3: no using-directives; every name is qualified where it is used.
int32 UnityProbeAlphaValue()
{
	const UnityProbeAlphaStates::EState State = UnityProbeAlphaStates::EState::Active;
	return AlphaBurstCount + UnityProbeLimits::MaxCount + static_cast<int32>(State);
}
