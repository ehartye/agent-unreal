#include "Modules/ModuleManager.h"

// The module class does nothing. The module exists so that UBT builds AnimBridgeLibrary.h into a UClass.
class FAnimBridgeModule : public IModuleInterface
{
};

IMPLEMENT_MODULE(FAnimBridgeModule, AnimBridge)
