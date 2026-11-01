#include "AgentVerifyAudio.h"
#include "AudioDeviceManager.h"
#include "AudioMixerDevice.h"
#include "Domain/AgentVerifyRules.h"
#include "Misc/FileHelper.h"
#include "Misc/ScopeLock.h"

TSharedPtr<FAgentVerifyAudio, ESPMode::ThreadSafe> FAgentVerifyAudio::Start(UWorld* World)
{
    auto* Device = FAudioDeviceManager::GetAudioMixerDeviceFromWorldContext(World);
    if (!Device) return nullptr;
    auto Master = Device->GetMasterSubmix().Pin();
    if (!Master.IsValid()) return nullptr;
    auto Tap = MakeShared<FAgentVerifyAudio, ESPMode::ThreadSafe>(); Tap->Submix = Master;
    Master->RegisterBufferListener(Tap);
    return Tap;
}

void FAgentVerifyAudio::Stop()
{
    if (Submix.IsValid()) { Submix->UnregisterBufferListener(AsShared()); Submix.Reset(); }
    FScopeLock Lock(&Mutex); Active = false;
}

void FAgentVerifyAudio::OnNewSubmixBuffer(const USoundSubmix*, float* Data, int32 Count, int32 Channels, int32 Rate, double Clock)
{
    FScopeLock Lock(&Mutex);
    if (!Active || Invalid) return;
    if (!Data || Count <= 0 || Channels <= 0 || Rate <= 0 || Count % Channels || !FMath::IsFinite(Clock) ||
        (SampleRate && (SampleRate != Rate || ChannelCount != Channels)) || static_cast<int64>(Samples.Num()) + Count > 64 * 1024 * 1024)
    { Invalid = true; return; }
    SampleRate = Rate; ChannelCount = Channels;
    for (int Index = 0; Index < Count; ++Index) if (!FMath::IsFinite(Data[Index]) || FMath::Abs(Data[Index]) > 1.0f) { Invalid = true; return; }
    Samples.Append(Data, Count);
}

bool FAgentVerifyAudio::HasDuration(double Seconds) const
{
    FScopeLock Lock(&Mutex);
    return !Invalid && ChannelCount > 0 && AgentVerify::Domain::AudioComplete(Samples.Num() / ChannelCount, SampleRate, ChannelCount, Seconds);
}

bool FAgentVerifyAudio::WriteWav(const FString& File, double RequestedSeconds, int& OutRate, int& OutChannels, int& OutFrames, double& OutRmsDb, FString& Error)
{
    FScopeLock Lock(&Mutex);
    OutRate = SampleRate; OutChannels = ChannelCount; OutFrames = ChannelCount ? Samples.Num() / ChannelCount : 0;
    if (Active) { Error = TEXT("audio_not_stopped"); return false; }
    if (Invalid) { Error = TEXT("audio_invalid_or_capacity_exceeded"); return false; }
    if (!AgentVerify::Domain::AudioComplete(OutFrames, SampleRate, ChannelCount, RequestedSeconds)) { Error = TEXT("audio_truncated"); return false; }
    TArray<uint8> Bytes; Bytes.SetNumZeroed(44 + Samples.Num() * 4);
    auto U16 = [&](int Offset, uint16 V) { Bytes[Offset] = V & 255; Bytes[Offset + 1] = (V >> 8) & 255; };
    auto U32 = [&](int Offset, uint32 V) { for (int I = 0; I < 4; ++I) Bytes[Offset + I] = static_cast<uint8>((V >> (I * 8)) & 255); };
    FMemory::Memcpy(Bytes.GetData(), "RIFF", 4); U32(4, Bytes.Num() - 8); FMemory::Memcpy(Bytes.GetData() + 8, "WAVEfmt ", 8);
    U32(16, 16); U16(20, 3); U16(22, ChannelCount); U32(24, SampleRate); U32(28, SampleRate * ChannelCount * 4); U16(32, ChannelCount * 4); U16(34, 32);
    FMemory::Memcpy(Bytes.GetData() + 36, "data", 4); U32(40, Samples.Num() * 4);
    double Square = 0;
    for (int Index = 0; Index < Samples.Num(); ++Index)
    {
        uint32 Bits; FMemory::Memcpy(&Bits, &Samples[Index], 4); U32(44 + Index * 4, Bits);
        Square += static_cast<double>(Samples[Index]) * Samples[Index] / Samples.Num();
    }
    OutRmsDb = 10 * FMath::Loge(FMath::Max(Square, 1e-12)) / FMath::Loge(10.0);
    if (!FFileHelper::SaveArrayToFile(Bytes, *File)) { Error = TEXT("audio_write_failed"); return false; }
    return true;
}
