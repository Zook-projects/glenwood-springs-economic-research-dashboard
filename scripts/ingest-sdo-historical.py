"""
ingest-sdo-historical.py — Read the Colorado State Demography Office's
historical-census Excel (1870 → 2020 decennial population per CO place) and
emit a normalized JSON dictionary the demographics builder consumes for the
historical population trend.

Source file (manual drop):
    data/context-cache/sdo/SDO_historical-census.xlsx
Sheet:
    historical-census
Columns:
    id | area_name | area_type | incorporation_year |
    county_incorporation | population_year | total_population | name_type

Filter:
- area_type == 'M' (Municipality) — drops counties, CDPs, etc.
- area_name matches one of the 11 anchor place names (case + whitespace tolerant)
- population_year >= 1950 (we don't surface earlier eras in the dashboard)

Output (data/context-cache/sdo/historical-pop.json):
    {
      "places": {
        "0830780": [{"year": 1950, "value": 2412}, ...],
        ...
      }
    }

Keys are 7-digit place GEOIDs (state FIPS + 5-digit place code) so the
demographics builder can join directly against geographies.PLACE_CODES.

Old Snowmass (ZIP 81654) is a ZCTA-fallback anchor — never an incorporated
municipality — so it never appears in the SDO historical file. The builder
falls back to ACS for that anchor.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from geographies import STATE_FIPS, PLACE_CODES

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent
SRC_XLSX = PROJECT_ROOT / "data" / "context-cache" / "sdo" / "SDO_historical-census.xlsx"
OUT_JSON = PROJECT_ROOT / "data" / "context-cache" / "sdo" / "historical-pop.json"

MIN_YEAR = 1950


def _normalize_name(s: str) -> str:
    return (s or "").strip().lower()


def _build_name_to_geoid() -> dict[str, str]:
    """Map normalized place name → 7-digit place GEOID for our 11 anchors."""
    out: dict[str, str] = {}
    for rec in PLACE_CODES.values():
        if rec.get("place_code") is None:
            # Old Snowmass (ZCTA fallback) — no incorporated-place GEOID
            continue
        out[_normalize_name(rec["place_name"])] = f"{STATE_FIPS}{rec['place_code']}"
    return out


def main() -> int:
    if not SRC_XLSX.exists():
        print(f"ERROR: source not found: {SRC_XLSX}", file=sys.stderr)
        return 1

    try:
        import openpyxl  # type: ignore
    except ImportError:
        print("ERROR: openpyxl required (pip install openpyxl)", file=sys.stderr)
        return 1

    name_to_geoid = _build_name_to_geoid()
    print(f"Anchor places to extract: {len(name_to_geoid)}", file=sys.stderr)

    wb = openpyxl.load_workbook(SRC_XLSX, data_only=True, read_only=True)
    ws = wb["historical-census"]

    # Layout per file: row 0 is the header. We index columns by name.
    rows = ws.iter_rows(values_only=True)
    header = next(rows)
    col_idx = {str(c).strip(): i for i, c in enumerate(header)}
    required = ["area_name", "area_type", "population_year", "total_population"]
    for r in required:
        if r not in col_idx:
            print(f"ERROR: missing column '{r}' in source", file=sys.stderr)
            return 1

    by_geoid: dict[str, dict[int, int | None]] = {g: {} for g in name_to_geoid.values()}

    rows_seen = 0
    rows_kept = 0
    for row in rows:
        rows_seen += 1
        atype_raw = row[col_idx["area_type"]]
        atype = (atype_raw or "").strip() if atype_raw else ""
        # SDO encodes municipality as either "M" (abbreviated) or
        # "Municipality" (long form) depending on which read mode openpyxl
        # uses. Match the leading letter so both work.
        if not atype.startswith("M"):
            continue
        nm = _normalize_name(str(row[col_idx["area_name"]] or ""))
        geoid = name_to_geoid.get(nm)
        if not geoid:
            continue
        try:
            yr = int(row[col_idx["population_year"]])
        except (TypeError, ValueError):
            continue
        if yr < MIN_YEAR:
            continue
        try:
            pop = int(row[col_idx["total_population"]])
        except (TypeError, ValueError):
            pop = None
        # SDO encodes "no data" / pre-incorporation as 0; preserve as None so
        # the chart truncates rather than rendering a flat 0 line. (Snowmass
        # Village → 0 for 1950–1970 because it was incorporated 1977.)
        by_geoid[geoid][yr] = pop if pop and pop > 0 else None
        rows_kept += 1

    wb.close()

    # Emit sorted-by-year arrays per place GEOID.
    out_places: dict[str, list[dict]] = {}
    for geoid, year_map in by_geoid.items():
        series = [
            {"year": y, "value": v}
            for y, v in sorted(year_map.items())
            if v is not None
        ]
        out_places[geoid] = series

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps({"places": out_places}, indent=2) + "\n")

    print(f"Rows scanned: {rows_seen}, anchor matches: {rows_kept}", file=sys.stderr)
    for geoid, series in out_places.items():
        years = [p["year"] for p in series]
        rng = f"{min(years)}–{max(years)}" if years else "no data"
        print(f"  {geoid}: {len(series)} points ({rng})", file=sys.stderr)
    print(f"Wrote {OUT_JSON.relative_to(PROJECT_ROOT)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
