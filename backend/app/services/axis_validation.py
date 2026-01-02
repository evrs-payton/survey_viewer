"""Axis validation utilities for frequency axis compatibility checking."""

from __future__ import annotations

from typing import Dict, Optional, Tuple


def validate_axis_compatibility(
    axis1: Dict[str, float], axis2: Dict[str, float], tolerance: float = 1e-6
) -> Tuple[bool, Optional[str]]:
    """Validate that two frequency axes are compatible for overlay/comparison.

    Two axes are compatible if they have:
    - Same step_hz (within tolerance)
    - Overlapping frequency ranges
    - Compatible start frequencies (aligned on the step grid)

    Args:
        axis1: First axis dictionary with keys: start_hz, step_hz, stop_hz, n_freqs
        axis2: Second axis dictionary with keys: start_hz, step_hz, stop_hz, n_freqs
        tolerance: Tolerance for floating-point comparisons

    Returns:
        Tuple of (is_compatible: bool, error_message: Optional[str])
    """
    start1 = axis1.get("start_hz")
    step1 = axis1.get("step_hz")
    stop1 = axis1.get("stop_hz")
    n_freqs1 = axis1.get("n_freqs")

    start2 = axis2.get("start_hz")
    step2 = axis2.get("step_hz")
    stop2 = axis2.get("stop_hz")
    n_freqs2 = axis2.get("n_freqs")

    # Check that all required fields are present
    if None in [start1, step1, stop1, n_freqs1, start2, step2, stop2, n_freqs2]:
        return False, "Missing required axis fields (start_hz, step_hz, stop_hz, n_freqs)"

    # Check step_hz compatibility (must match within tolerance)
    if abs(step1 - step2) > tolerance:
        return False, f"Step size mismatch: {step1} Hz vs {step2} Hz (tolerance: {tolerance} Hz)"

    # Check that ranges overlap
    if stop1 < start2 or stop2 < start1:
        return False, f"Frequency ranges do not overlap: [{start1}, {stop1}] vs [{start2}, {stop2}]"

    # Check alignment (start frequencies should align on the step grid)
    # Calculate offset from a common reference point
    if step1 > tolerance:
        offset1 = (start1 % step1) if start1 >= 0 else ((start1 % step1) - step1)
        offset2 = (start2 % step1) if start2 >= 0 else ((start2 % step1) - step1)
        if abs(offset1 - offset2) > tolerance:
            return (
                False,
                f"Start frequencies not aligned on step grid: offset1={offset1}, offset2={offset2}",
            )

    return True, None

