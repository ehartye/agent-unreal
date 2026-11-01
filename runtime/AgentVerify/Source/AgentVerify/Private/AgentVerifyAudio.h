#pragma once
#include "CoreMinimal.h"
#include "ISubmixBufferListener.h"
#include "AudioMixerSubmix.h"

class UWorld;

/** Explicit master-submix tap. It retains complete callback blocks and never selects a favorable subwindow. */
class FAgentVerifyAudio final : public ISubmixBufferListener
{
public:
    static TSharedPtr<FAgentVerifyAudio, ESPMode::ThreadSafe> Start(UWorld* World);
    // Call before releasing the last owner; never unregister from the destructor.
    void Stop();
    virtual void OnNewSubmixBuffer(const USoundSubmix*, float* Data, int32 Count, int32 Channels, int32 Rate, double Clock) override;
    virtual bool IsRenderingAudio() const override { return true; }
    bool WriteWav(const FString& File, double RequestedSeconds, int& OutRate, int& OutChannels, int& OutFrames, double& OutRmsDb, FString& Error);
    bool HasDuration(double Seconds) const;
private:
    mutable FCriticalSection Mutex;
    TSharedPtr<Audio::FMixerSubmix, ESPMode::ThreadSafe> Submix;
    TArray<float> Samples;
    int SampleRate = 0, ChannelCount = 0;
    bool Active = true, Invalid = false;
};
