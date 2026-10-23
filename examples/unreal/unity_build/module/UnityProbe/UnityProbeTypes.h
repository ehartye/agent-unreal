#pragma once

#include "CoreMinimal.h"

// Names that two different .cpp files in the module both use. Each file builds on its own; merged into one unity chunk they meet.
namespace UnityProbeAlphaStates { enum class EState : uint8 { Idle, Active }; }
namespace UnityProbeBetaStates { enum class EState : uint8 { Ready, Done }; }
namespace UnityProbeLimits { constexpr int32 MaxCount = 8; }

int32 UnityProbeAlphaValue();
int32 UnityProbeBetaValue();
