#pragma once
#include <cmath>

namespace ObservationSample::Domain
{
    // A game rule, with no engine objects, clocks or file access.
    inline double Travel(double Position, double Axis, double Seconds)
    {
        if (!std::isfinite(Position) || !std::isfinite(Axis) || !std::isfinite(Seconds) || Seconds < 0) return Position;
        const double Clamped = Axis < -1 ? -1 : Axis > 1 ? 1 : Axis;
        return Position + Clamped * Seconds * 100.0;
    }
}
