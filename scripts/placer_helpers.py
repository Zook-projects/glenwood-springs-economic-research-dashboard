"""Shared coercion helpers for the Placer.ai build scripts.

Imported by build-placer.py (regional) and build-glenwood-placer.py
(Glenwood-internal). Centralized so both pipelines apply the same
parsing rules to Excel cells that arrive as mixed int/float/string.
"""

from __future__ import annotations


def zip_str(value: object) -> str | None:
    """Coerce an Excel cell value into a 5-character zip code string.
    Returns None when the cell is blank or doesn't parse as a positive
    integer-ish number — those rows are skipped silently."""
    if value is None:
        return None
    if isinstance(value, str):
        v = value.strip()
        if not v:
            return None
        if v.isdigit():
            return v.zfill(5)
        return None
    if isinstance(value, (int, float)):
        n = int(value)
        if n <= 0:
            return None
        return f"{n:05d}"
    return None


def positive_int(value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        n = int(value)
        return n if n > 0 else None
    if isinstance(value, str):
        v = value.strip()
        try:
            n = int(float(v))
            return n if n > 0 else None
        except ValueError:
            return None
    return None


def finite_float(value: object) -> float | None:
    """Coerce an Excel cell to a finite float, or None if absent/malformed.
    Rejects NaN/inf and absurd magnitudes (|x| >= 1e9)."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        f = float(value)
        return f if (f == f and abs(f) < 1e9) else None
    if isinstance(value, str):
        v = value.strip()
        if not v:
            return None
        try:
            f = float(v)
            return f if f == f else None
        except ValueError:
            return None
    return None
