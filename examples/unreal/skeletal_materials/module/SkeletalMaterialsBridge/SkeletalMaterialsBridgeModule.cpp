#include "Modules/ModuleManager.h"

// The module class does nothing. The module exists so that UBT builds SkeletalMaterialsBridgeLibrary.h into a UClass.
class FSkeletalMaterialsBridgeModule : public IModuleInterface
{
};

IMPLEMENT_MODULE(FSkeletalMaterialsBridgeModule, SkeletalMaterialsBridge)
