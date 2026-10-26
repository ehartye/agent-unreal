#pragma once

#include "NativeGameplayTags.h"

// Declared here, defined once in GasNativeTags.cpp. Read a tag with .GetTag().
UE_DECLARE_GAMEPLAY_TAG_EXTERN(Tag_GasNative_Ability_Pulse)
UE_DECLARE_GAMEPLAY_TAG_EXTERN(Tag_GasNative_Cooldown_Pulse)
UE_DECLARE_GAMEPLAY_TAG_EXTERN(Tag_GasNative_Dynamic)

// Tags for the effect-component cases (GasNativeCases.cpp) and the replicated-play scenario (GasNativeRep.cpp).
UE_DECLARE_GAMEPLAY_TAG_EXTERN(Tag_GasNative_Ability_Hold)
UE_DECLARE_GAMEPLAY_TAG_EXTERN(Tag_GasNative_Case_Marker)
UE_DECLARE_GAMEPLAY_TAG_EXTERN(Tag_GasNative_Case_Bonus)
UE_DECLARE_GAMEPLAY_TAG_EXTERN(Tag_GasNative_Case_Blocked)
UE_DECLARE_GAMEPLAY_TAG_EXTERN(Tag_GasNative_Case_Gate)
UE_DECLARE_GAMEPLAY_TAG_EXTERN(Tag_GasNative_Ability_Rep)
UE_DECLARE_GAMEPLAY_TAG_EXTERN(Tag_GasNative_Rep_Buff)
