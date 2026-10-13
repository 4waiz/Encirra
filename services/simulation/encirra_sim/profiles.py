"""Synthetic time-of-day profiles (declared scenario assumptions, not measured data).

Both profiles are piecewise-linear in simulated local clock time and are sampled once per
minute. They are documented in docs/METHODOLOGY.md ("Demand patterns").

* Electrical: multiplier on the IEEE 33-bus nominal loads. The benchmark nominal load is
  interpreted as the district's *evening peak* (Dubai summer evening: cooling plus residential
  return), reached at ~19:00. Afternoon values are lower.
* Water: multiplier on each junction's base demand (base demand = daily average). Dubai summer
  evening water use rises from late afternoon towards ~20:00 (showers, cooking, irrigation after
  sunset).
"""

from __future__ import annotations

import numpy as np

# (clock minutes since midnight, multiplier)
ELECTRICAL_PROFILE: tuple[tuple[int, float], ...] = (
    (0, 0.66),
    (4 * 60, 0.58),
    (8 * 60, 0.70),
    (12 * 60, 0.80),
    (15 * 60, 0.84),
    (16 * 60, 0.85),
    (17 * 60, 0.88),
    (18 * 60, 0.94),
    (19 * 60, 1.00),
    (20 * 60, 0.99),
    (21 * 60, 0.95),
    (22 * 60, 0.86),
    (24 * 60, 0.66),
)

WATER_PROFILE: tuple[tuple[int, float], ...] = (
    (0, 0.55),
    (4 * 60, 0.45),
    (6 * 60, 0.95),
    (8 * 60, 1.15),
    (12 * 60, 1.00),
    (16 * 60, 1.00),
    (17 * 60, 1.06),
    (18 * 60, 1.16),
    (19 * 60, 1.24),
    (20 * 60, 1.26),
    (21 * 60, 1.20),
    (22 * 60, 1.05),
    (24 * 60, 0.55),
)


def _interp(profile: tuple[tuple[int, float], ...], clock_min: float) -> float:
    xs = np.array([p[0] for p in profile], dtype=float)
    ys = np.array([p[1] for p in profile], dtype=float)
    return float(np.interp(clock_min % (24 * 60), xs, ys))


def electrical_multiplier(clock_min: float) -> float:
    return _interp(ELECTRICAL_PROFILE, clock_min)


def water_multiplier(clock_min: float) -> float:
    return _interp(WATER_PROFILE, clock_min)


def per_minute(profile_fn, start_clock_min: int, minutes: int) -> np.ndarray:
    """Profile sampled at t = 0, 1, …, minutes (inclusive) after the start clock."""
    return np.array([profile_fn(start_clock_min + k) for k in range(minutes + 1)], dtype=float)


def clock_str(start_clock_min: int, t_seconds: float) -> str:
    total = int(round(start_clock_min + t_seconds / 60.0)) % (24 * 60)
    return f"{total // 60:02d}:{total % 60:02d}"
