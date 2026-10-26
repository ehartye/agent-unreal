#include "Modules/ModuleManager.h"

// The module class does nothing. The module exists so that UBT builds AnimMachineBridgeLibrary.h into a UClass.
class FAnimMachineBridgeModule : public IModuleInterface
{
};

IMPLEMENT_MODULE(FAnimMachineBridgeModule, AnimMachineBridge)
