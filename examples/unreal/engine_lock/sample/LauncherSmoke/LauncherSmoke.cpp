#include "Modules/ModuleManager.h"
#include "Containers/Ticker.h"
#include "HAL/PlatformMisc.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"

class FLauncherSmokeModule : public FDefaultGameModuleImpl
{
public:
    virtual void StartupModule() override
    {
        float Seconds = 0.0f;
        if (FParse::Value(FCommandLine::Get(), TEXT("LauncherSmokeSeconds="), Seconds) && Seconds > 0.0f)
        {
            FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([](float)
            {
                UE_LOG(LogTemp, Display, TEXT("LauncherSmoke completed"));
                FPlatformMisc::RequestExitWithStatus(false, 0);
                return false;
            }), Seconds);
        }
    }
};
IMPLEMENT_PRIMARY_GAME_MODULE(FLauncherSmokeModule, LauncherSmoke, "LauncherSample");
