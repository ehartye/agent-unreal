#include "Modules/ModuleManager.h"

// The module class does nothing. The module exists so that UBT builds StateTreeBridgeLibrary.h into a UClass.
class FStateTreeBridgeModule : public IModuleInterface
{
};

IMPLEMENT_MODULE(FStateTreeBridgeModule, StateTreeBridge)
