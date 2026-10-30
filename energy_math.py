"""Pure, testable energy math. No hidden sensor substitutions or bogus OFF values."""
from __future__ import annotations
from dataclasses import dataclass
import math
from typing import Any


@dataclass(frozen=True)
class Settings:
    assumed_voltage_v: float = 230.0
    tariff_inr_per_kwh: float = 8.0
    peak_demand_w: float = 85.0
    quiet_start_hour: int = 20
    quiet_end_hour: int = 8
    active_current_ma: float = 35.0
    main_reference_gain: float = 1.0
    branch_reference_gain: float = 1.0

    @classmethod
    def parse(cls, raw: dict) -> "Settings":
        data = {k: raw.get(k, getattr(cls(), k)) for k in cls.__dataclass_fields__}
        for k, value in data.items():
            if k in ("quiet_start_hour", "quiet_end_hour"):
                if isinstance(value, bool) or int(value) != float(value) or not 0 <= int(value) <= 23:
                    raise ValueError(f"Invalid {k}: expected hour 0..23")
                data[k] = int(value)
                continue
            data[k] = float(value)
            if not math.isfinite(data[k]):
                raise ValueError(f"Invalid {k}")
        bounds = {
            "assumed_voltage_v": (50, 260), "tariff_inr_per_kwh": (0, 100),
            "peak_demand_w": (1, 10000), "active_current_ma": (1, 1000),
            "main_reference_gain": (0.25, 3.0),
            "branch_reference_gain": (0.25, 3.0),
        }
        for k, (lo, hi) in bounds.items():
            if not lo <= data[k] <= hi:
                raise ValueError(f"{k} must be between {lo} and {hi}")
        return cls(**data)


def parse_data(line: str) -> dict[str, float] | None:
    if not line.startswith("DATA,"):
        return None
    try:
        data = {}
        for item in line[5:].split(","):
            k, v = item.split("=", 1)
            data[k] = float(v)
        if not all(k in data for k in ("s1_mA", "s2_mA")):
            return None
        if not all(math.isfinite(v) for v in data.values()):
            return None
        if data["s1_mA"] < 0 or data["s2_mA"] < 0:
            return None
        return data
    except (ValueError, KeyError):
        return None


def derive(data: dict[str, float], settings: Settings) -> dict[str, Any]:
    """Assumes both bulbs are predominantly resistive; 230V is configurable NOT measured."""
    s1 = data["s1_mA"] * settings.main_reference_gain
    s2 = data["s2_mA"] * settings.branch_reference_gain
    noise1 = data.get("s1_noise_mA", 0) * settings.main_reference_gain
    noise2 = data.get("s2_noise_mA", 0) * settings.branch_reference_gain
    tolerance_ma = max(15.0, 3.0 * math.hypot(noise1, noise2))
    residual = s1 - s2  # retain signed residual, never silently overwrite
    flags: list[str] = []
    new_protocol = "s1_raw_mA" in data and "idle_valid" in data
    if not new_protocol:
        flags.append("LEGACY_FIRMWARE_FILTERS: original ESP8266 noise floor + 8-sample Python smoothing")
        if data.get("legacy_zero_clamped", 0) != 0:
            flags.append("LEGACY_MAIN_ZERO_RULE: downstream reading suppressed in filtered display; transmitted value preserved")
    elif data.get("idle_valid") != 1:
        flags.append("IDLE_UNCALIBRATED: both bulbs OFF → Capture idle noise")
    if data.get("clip", 0) != 0:
        flags.append("ADC_CLIPPING: measurements may be invalid")
    if residual < -tolerance_ma:
        flags.append("METER_MISMATCH: branch sensor > main feeder")
        branch_b = None
    else:
        branch_b = max(0.0, residual)
        if abs(residual) < tolerance_ma:
            flags.append("BRANCH_B_NEAR_NOISE: difference not independently reliable")
    voltage = settings.assumed_voltage_v
    # Powers are ESTIMATES, not direct voltage/power factor measurements.
    good = data.get("clip", 0) == 0
    return {
        "main_ma": round(s1, 3), "branch_a_ma": round(s2, 3),
        "branch_b_ma": round(branch_b, 3) if branch_b is not None else None,
        "signed_residual_ma": round(residual, 3),
        "raw_main_ma": data.get("s1_raw_mA", data.get("s1_transmitted_mA")),
        "raw_branch_ma": data.get("s2_raw_mA", data.get("s2_transmitted_mA")),
        "main_w": round(voltage * s1 / 1000, 3),
        "branch_a_w": round(voltage * s2 / 1000, 3),
        "branch_b_w": round(voltage * branch_b / 1000, 3) if branch_b is not None else None,
        "sensor_noise_main_ma": round(noise1, 3),
        "sensor_noise_branch_ma": round(noise2, 3),
        "estimated": True, "voltage_source": "ASSUMED", "pf_assumption": 1,
        "valid_for_energy": good,
        "idle_calibrated": data.get("idle_valid") == 1 if new_protocol else None,
        "firmware": "energy_monitor_v1" if new_protocol else "legacy",
        "sample_window_ms": data.get("window_ms"),
        "seq": data.get("seq"),
        "tolerance_ma": round(tolerance_ma, 3), "flags": flags,
    }


def within_quiet_hours(hour: int, start: int, end: int) -> bool:
    if start == end:
        return False
    return start <= hour < end if start < end else hour >= start or hour < end


def energy_increment_wh(previous_w: float, current_w: float, elapsed_seconds: float) -> float:
    # Drop gaps to avoid billing extrapolation through serial disconnects.
    if not 0 < elapsed_seconds <= 5 or not all(math.isfinite(v) and v >= 0 for v in (previous_w, current_w)):
        return 0.0
    return (previous_w + current_w) / 2.0 * elapsed_seconds / 3600.0
