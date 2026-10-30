#include "Modules/ModuleManager.h"

// The module class does nothing. The module exists so that UBT builds MutableBridgeLibrary.h into a UClass.
class FMutableBridgeModule : public IModuleInterface
{
};

IMPLEMENT_MODULE(FMutableBridgeModule, MutableBridge)
