"""
ingest-sdo-muni-housing.py — Read the Colorado State Demography Office's
muni-pop-housing Excel (annual 2010 → 2024 per place: population, housing
units, occupancy, vacancy, household size) and emit normalized JSON for both
the demographics builder (population) and housing builder (HU + characteristics).

Source file (manual drop):
    data/context-cache/sdo/SDO_muni-pop-housing.xlsx
Sheet:
    Vintage 2024 (header on row 4 — first 3 rows are title/source banner)
Columns:
    Year | County | Place | County FIPS | Place FIPS |
    Total Population | Group Quarters Population | Household Population |
    Household Size | Total Housing Units | Occupied Housing Units |
    Vacant Housing Units | Vacancy Percent |
    Household Population to Total Housing Units Ratio

Output (data/context-cache/sdo/muni-housing.json):
    {
      "places": {
        "0830780": {
          "population":       [{"year": 2010, "value": 9576}, ...],
          "housingUnitsTotal":    [{"year": 2010, "value": 4118}, ...],
          "housingUnitsOccupied": [...],
          "housingUnitsVacant":   [...],
          "vacancyPct":           [...],
          "householdSize":        [...],
          "householdPopulation":  [...]
        },
        ...
      }
    }

Joins by Place FIPS (5-digit) → matches the trailing 5 digits of the
geographies.PLACE_CODES place_geoid. "Multi-county" Total rows (places that
straddle county lines, like Aurora) are preferred over per-county Part rows
where applicable; for our 11 anchors no place crosses a county line so only
single-county rows appear.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from geographies import STATE_FIPS, PLACE_CODES

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent
SRC_XLSX = PROJECT_ROOT / "data" / "context-cache" / "sdo" / "SDO_muni-pop-housing.xlsx"
OUT_JSON = PROJECT_ROOT / "data" / "context-cache" / "sdo" / "muni-housing.json"

# Place FIPS (5-digit) → place GEOID (7-digit) for our 10 incorporated anchors.
# The SDO file uses 5-digit codes; we surface 7-digit GEOIDs so the housing
# builder joins identically to ACS / Zillow.
def _build_placefips_to_geoid() -> dict[str, str]:
    out: dict[str, str] = {}
    for rec in PLACE_CODES.values():
        if rec.get("place_code") is None:
            continue
        out[str(rec["place_code"]).zfill(5)] = f"{STATE_FIPS}{rec['place_code']}"
    return out


# Output metric key → SDO column header (case-sensitive, exactly as it appears
# on row 4 of the Vintage 2024 sheet).
METRIC_COLS: list[tuple[str, str]] = [
    ("population",          "Total Population"),
    ("householdPopulation", "Household Population"),
    ("householdSize",       "Household Size"),
    ("housingUnitsTotal",   "Total Housing Units"),
    ("housingUnitsOccupied", "Occupied Housing Units"),
    ("housingUnitsVacant",  "Vacant Housing Units"),
    ("vacancyPct",          "Vacancy Percent"),
]


def _to_number(v):
    if v is None or v == "":
        return None
    try:
        if isinstance(v, (int, float)):
            return float(v)
        s = str(v).strip()
        if not s:
            return None
        return float(s)
    except (ValueError, TypeError):
        return None


def main() -> int:
    if not SRC_XLSX.exists():
        print(f"ERROR: source not found: {SRC_XLSX}", file=sys.stderr)
        return 1
    try:
        import openpyxl  # type: ignore
    except ImportError:
        print("ERROR: openpyxl required (pip install openpyxl)", file=sys.stderr)
        return 1

    fips_to_geoid = _build_placefips_to_geoid()
    print(f"Anchor places to extract: {len(fips_to_geoid)}", file=sys.stderr)

    wb = openpyxl.load_workbook(SRC_XLSX, data_only=True, read_only=True)
    ws = wb["Vintage 2024"]

    # Header on row 4 (1-indexed) — skip first 3 banner rows.
    rows = ws.iter_rows(values_only=True)
    for _ in range(3):
        next(rows)
    header = next(rows)
    col_idx = {str(c).strip(): i for i, c in enumerate(header)}

    for required in ["Year", "Place FIPS", "County"] + [c for _, c in METRIC_COLS]:
        if required not in col_idx:
            print(f"ERROR: missing column '{required}' in source", file=sys.stderr)
            return 1

    # places[geoid][metric_key][year] = value
    places: dict[str, dict[str, dict[int, float | None]]] = {
        g: {mk: {} for mk, _ in METRIC_COLS} for g in fips_to_geoid.values()
    }

    rows_seen = 0
    rows_kept = 0
    for row in rows:
        rows_seen += 1
        if row[col_idx["Place FIPS"]] is None:
            continue
        # County name: skip "(Part)" rows for multi-county places — prefer the
        # "(Total)" row recorded under "Multi-county". Our 11 anchors don't
        # cross county lines, so we accept only single-county rows whose
        # County column is one of the canonical CO county names.
        county = (row[col_idx["County"]] or "").strip()
        if county.lower() == "multi-county":
            continue  # skip duplicated multi-county aggregates
        try:
            pfips = str(int(row[col_idx["Place FIPS"]])).zfill(5)
        except (TypeError, ValueError):
            continue
        geoid = fips_to_geoid.get(pfips)
        if not geoid:
            continue
        try:
            yr = int(row[col_idx["Year"]])
        except (TypeError, ValueError):
            continue

        for metric_key, col_name in METRIC_COLS:
            v = _to_number(row[col_idx[col_name]])
            places[geoid][metric_key][yr] = v
        rows_kept += 1

    wb.close()

    out_places: dict[str, dict[str, list[dict]]] = {}
    for geoid, metrics in places.items():
        norm: dict[str, list[dict]] = {}
        for mk, year_map in metrics.items():
            norm[mk] = [
                {"year": y, "value": v}
                for y, v in sorted(year_map.items())
                if v is not None
            ]
        out_places[geoid] = norm

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps({"places": out_places}, indent=2) + "\n")

    print(f"Rows scanned: {rows_seen}, anchor matches: {rows_kept}", file=sys.stderr)
    for geoid, metrics in out_places.items():
        pop_pts = metrics.get("population", [])
        hu_pts = metrics.get("housingUnitsTotal", [])
        rng = (
            f"pop {min(p['year'] for p in pop_pts)}–{max(p['year'] for p in pop_pts)}"
            if pop_pts else "pop none"
        )
        hu_rng = (
            f"hu {min(p['year'] for p in hu_pts)}–{max(p['year'] for p in hu_pts)}"
            if hu_pts else "hu none"
        )
        print(f"  {geoid}: {rng}, {hu_rng}", file=sys.stderr)
    print(f"Wrote {OUT_JSON.relative_to(PROJECT_ROOT)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
