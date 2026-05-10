"""
ingest-decennial-static.py — Hardcoded U.S. Census Bureau decennial counts
for state- and county-level historical population (and Colorado state-level
historical housing units) that aren't accessible without a CENSUS_API_KEY.

These are public-record decennial census counts. Each value below corresponds
to a published Census Bureau figure for the year given. Sources:
  - Colorado state population 1950–2020 — Census Bureau decennial counts,
    https://www.census.gov/library/stories/2021/08/colorado-population-change-between-census-decade.html
  - Anchor-county population 1990–2020 — Census Bureau decennial counts,
    QuickFacts (https://www.census.gov/quickfacts/{county}countycolorado).
  - Colorado state housing units 1990–2020 — Decennial Census H1 / DP1.

Output:
    data/context-cache/sdo/decennial-static.json

Shape mirrors the SDO/NHGIS ingest scripts so the demographics + housing
builders can join uniformly:
    {
      "state": {
        "population":   [{"year": 1950, "value": ...}, ...],
        "housingUnits": [{"year": 1990, "value": ...}, ...]
      },
      "counties": {
        "08045": {"population": [{"year": 1990, "value": ...}, ...]},
        ...
      }
    }

If/when CENSUS_API_KEY becomes available, the demographics + housing
builders should switch to live decennial API pulls (dec/sf1, dec/sf3,
dec/dhc, dec/pl) and this static module can be deprecated.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from geographies import STATE_FIPS

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent
OUT_JSON = PROJECT_ROOT / "data" / "context-cache" / "sdo" / "decennial-static.json"


# ---------------------------------------------------------------------------
# Colorado state — population (1950–2020 decennial)
# ---------------------------------------------------------------------------
STATE_POP: dict[int, int] = {
    1950: 1_325_089,
    1960: 1_753_947,
    1970: 2_209_596,
    1980: 2_889_964,
    1990: 3_294_394,
    2000: 4_301_261,
    2010: 5_029_196,
    2020: 5_773_714,
}

# Colorado state — total housing units (1990–2020 decennial). Earlier
# decades (1970, 1980) are intentionally absent — Census Bureau publishes
# 1970/1980 state HU only via the historic-print volumes; we don't surface
# them here. Chart will truncate the line to start at 1990 for state.
STATE_HU: dict[int, int] = {
    1990: 1_477_349,
    2000: 1_808_037,
    2010: 2_212_898,
    2020: 2_491_404,
}

# ---------------------------------------------------------------------------
# Counties — population (1990–2020 decennial)
# Pre-1990 county counts are not surfaced here (the Census API era starts
# at 1990 and we keep this static module aligned with that boundary).
# ---------------------------------------------------------------------------
COUNTY_POP: dict[str, dict[int, int]] = {
    # Garfield (045)
    "08045": {
        1990: 29_974,
        2000: 43_791,
        2010: 56_389,
        2020: 61_685,
    },
    # Pitkin (097)
    "08097": {
        1990: 12_661,
        2000: 14_872,
        2010: 17_148,
        2020: 17_358,
    },
    # Eagle (037)
    "08037": {
        1990: 21_928,
        2000: 41_659,
        2010: 52_197,
        2020: 55_731,
    },
    # Mesa (077)
    "08077": {
        1990: 93_145,
        2000: 116_255,
        2010: 146_723,
        2020: 154_210,
    },
}


def _series(d: dict[int, int]) -> list[dict]:
    return [{"year": y, "value": v} for y, v in sorted(d.items())]


def main() -> int:
    payload = {
        "state": {
            "fips": STATE_FIPS,
            "population": _series(STATE_POP),
            "housingUnits": _series(STATE_HU),
        },
        "counties": {
            geoid: {"population": _series(d)}
            for geoid, d in COUNTY_POP.items()
        },
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, indent=2) + "\n")

    print(f"Wrote {OUT_JSON.relative_to(PROJECT_ROOT)}", file=sys.stderr)
    print(
        f"  state population: {len(STATE_POP)} decennial points "
        f"({min(STATE_POP)}–{max(STATE_POP)})",
        file=sys.stderr,
    )
    print(
        f"  state housing units: {len(STATE_HU)} decennial points "
        f"({min(STATE_HU)}–{max(STATE_HU)})",
        file=sys.stderr,
    )
    for geoid, d in COUNTY_POP.items():
        print(
            f"  county {geoid} population: {len(d)} points "
            f"({min(d)}–{max(d)})",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
