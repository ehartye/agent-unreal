#include "Modules/ModuleManager.h"
#include "UnityProbeTypes.h"

class FUnityProbeModule : public FDefaultModuleImpl
{
public:
	virtual void StartupModule() override
	{
		UE_LOG(LogTemp, Display, TEXT("UnityProbe values %d %d"), UnityProbeAlphaValue(), UnityProbeBetaValue());
	}
};

IMPLEMENT_MODULE(FUnityProbeModule, UnityProbe)
