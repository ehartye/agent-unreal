#include "Modules/ModuleManager.h"

// The module class does nothing. The module exists so that UBT builds LandscapeBridgeLibrary.h into a UClass.
class FLandscapeBridgeModule : public IModuleInterface
{
};

IMPLEMENT_MODULE(FLandscapeBridgeModule, LandscapeBridge)
