#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <vector>

// No Unreal objects, clocks, files or input dispatch in these rules.
namespace AgentVerify::Domain
{
    inline bool SettleReady(bool CurrentlyReady, double StableSeconds, double MinimumSeconds)
    {
        return CurrentlyReady && StableSeconds >= MinimumSeconds;
    }
    struct FSummary { std::size_t Count = 0; double Mean = 0, P95 = 0, P99 = 0, Maximum = 0; };
    inline bool Summarize(const std::vector<double>& Samples, FSummary& Out)
    {
        Out = {};
        if (Samples.empty()) return false;
        auto Sorted = Samples;
        for (double Value : Samples) if (!std::isfinite(Value) || Value < 0) return false;
        std::sort(Sorted.begin(), Sorted.end());
        Out.Count = Samples.size();
        for (double Value : Samples) Out.Mean += Value / Samples.size();
        Out.P95 = Sorted[static_cast<std::size_t>(std::ceil(0.95 * Sorted.size())) - 1];
        Out.P99 = Sorted[static_cast<std::size_t>(std::ceil(0.99 * Sorted.size())) - 1];
        Out.Maximum = Sorted.back();
        return std::isfinite(Out.Mean);
    }

    struct FHold
    {
        enum class EStage { Settling, Hold, Pending, Complete };
        EStage Stage = EStage::Settling;
        double StableSeconds = 0, HoldSeconds = 0;
        int HoldFrames = 0, CompileRestarts = 0;
        bool InvalidPending = false;
        // Return true only on the actual tick that requests a screenshot.
        bool Tick(double WallSeconds, bool Settled, bool ScreenshotComplete, double MinSettle, double Wait)
        {
            if (!std::isfinite(WallSeconds) || WallSeconds <= 0 || Stage == EStage::Complete) return false;
            if (Stage == EStage::Pending)
            {
                InvalidPending = InvalidPending || !Settled;
                if (ScreenshotComplete)
                {
                    if (!InvalidPending) Stage = EStage::Complete;
                    else { ++CompileRestarts; Stage = EStage::Settling; StableSeconds = HoldSeconds = 0; HoldFrames = 0; InvalidPending = false; }
                }
                return false;
            }
            if (!Settled)
            {
                if (Stage == EStage::Hold || StableSeconds > 0) ++CompileRestarts;
                Stage = EStage::Settling; StableSeconds = HoldSeconds = 0; HoldFrames = 0;
            }
            else if (Stage == EStage::Settling)
            {
                StableSeconds += WallSeconds;
                if (StableSeconds >= MinSettle) Stage = EStage::Hold;
            }
            else
            {
                ++HoldFrames; HoldSeconds += WallSeconds;
                if (HoldFrames >= 90 && HoldSeconds >= Wait) { Stage = EStage::Pending; return true; }
            }
            return false;
        }
    };

    inline bool BudgetEligible(bool ContentionKnownAbsent, bool CacheVerified, bool CacheMatches, bool HardwareMatches, bool RegressionGuard)
    {
        return ContentionKnownAbsent && CacheVerified && CacheMatches && (HardwareMatches || RegressionGuard);
    }

    inline bool AudioComplete(std::size_t Frames, int Rate, int Channels, double RequestedSeconds)
    {
        return Rate > 0 && Channels > 0 && Frames > 0 && static_cast<double>(Frames) + 1 >= RequestedSeconds * Rate;
    }
}
