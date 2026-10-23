#include "Modules/ModuleManager.h"

// An automation test needs no module class of its own; the module only has to be built and loaded so the test registers.
IMPLEMENT_MODULE(FDefaultModuleImpl, AutomationProbe)
