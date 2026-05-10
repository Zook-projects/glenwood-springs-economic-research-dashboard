"""
context_builders/demographics.py — Compose demographics.json from cached
Census ACS + PEP + Decennial responses, augmented with SDO place population
(2010 → 2024 + 1950 → 2020 historical) and static decennial state/county
historical population.
"""

from __future__ import annotations

import json
from pathlib import Path

from context_schema import build_envelope, source, trend_series
from geographies import (
    STATE_FIPS,
    COUNTY_FIPS,
    PLACE_CODES,
    all_county_records,
    all_place_records,
)

from . import _census_shared as cs

# Composite age definitions — kept in lockstep with fetch-context-census.py.
COMPOSITES_AGE = {
    "ageU18": [
        "B01001_003E", "B01001_004E", "B01001_005E", "B01001_006E",
        "B01001_027E", "B01001_028E", "B01001_029E", "B01001_030E",
    ],
    "age18to34": [
        "B01001_007E", "B01001_008E", "B01001_009E", "B01001_010E",
        "B01001_011E", "B01001_012E",
        "B01001_031E", "B01001_032E", "B01001_033E", "B01001_034E",
        "B01001_035E", "B01001_036E",
    ],
    "age35to54": [
        "B01001_013E", "B01001_014E", "B01001_015E", "B01001_016E",
        "B01001_037E", "B01001_038E", "B01001_039E", "B01001_040E",
    ],
    "age55to64": [
        "B01001_017E", "B01001_018E", "B01001_019E",
        "B01001_041E", "B01001_042E", "B01001_043E",
    ],
    "age65plus": [
        "B01001_020E", "B01001_021E", "B01001_022E", "B01001_023E",
        "B01001_024E", "B01001_025E",
        "B01001_044E", "B01001_045E", "B01001_046E", "B01001_047E",
        "B01001_048E", "B01001_049E",
    ],
}

DIRECT_VARS = {
    "population": "B01001_001E",
    "medianAge": "B01002_001E",
    "male": "B01001_002E",
    "female": "B01001_026E",
    "white": "B02001_002E",
    "black": "B02001_003E",
    "amInd": "B02001_004E",
    "asian": "B02001_005E",
    "nhpi": "B02001_006E",
    "twoOrMore": "B02001_008E",
    "hispanic": "B03002_012E",
    "notHispanic": "B03002_002E",
    "familyHh": "B11001_002E",
    "nonFamilyHh": "B11001_007E",
    "medianHhIncome": "B19013_001E",
}

# Trend keys carried into trend.{key}[]. medianAge added so the F3 Median Age
# chart has a series to render.
TREND_KEYS = ["population", "medianHhIncome", "medianAge", "ageU18", "age65plus"]
ACS_LATEST_YEAR = 2024
ACS_TREND_START = 2010

# ---------------------------------------------------------------------------
# SDO / static-decennial cache loaders
# ---------------------------------------------------------------------------
SDO_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "context-cache" / "sdo"


def _load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        with path.open() as f:
            return json.load(f)
    except Exception:
        return {}


def _drop_short_series(points: list[dict], *, min_points: int = 2) -> list[dict]:
    """Drop series with fewer than `min_points` non-null observations.
    Snowmass Village pre-incorporation, etc., become empty arrays which the
    chart treats as 'omit this geography'."""
    return points if len(points) >= min_points else []


def _latest_block(row) -> dict | None:
    if row is None:
        return None
    block: dict = {}
    for key, var in DIRECT_VARS.items():
        v = cs.number_or_none(row, var)
        if v is not None:
            block[key] = v
    for key, parts in COMPOSITES_AGE.items():
        v = cs.sum_vars(row, parts)
        if v is not None:
            block[key] = v
    return block or None


def _trend_block(rows_by_year: dict[int, dict | None]) -> dict:
    out: dict[str, list[dict]] = {}
    for tk in TREND_KEYS:
        var = DIRECT_VARS.get(tk)
        pairs: list[tuple[int, int | float | None]] = []
        for y, row in sorted(rows_by_year.items()):
            if var:
                v = cs.number_or_none(row, var)
            elif tk in COMPOSITES_AGE:
                v = cs.sum_vars(row, COMPOSITES_AGE[tk])
            else:
                v = None
            pairs.append((y, v))
        out[tk] = trend_series(pairs)
    return out


def build_demographics() -> dict:
    rows_by_year: dict[int, list[dict]] = {}
    for year in range(ACS_TREND_START, ACS_LATEST_YEAR + 1):
        rows_by_year[year] = cs.load_acs5(year)

    latest_rows = rows_by_year.get(ACS_LATEST_YEAR, [])

    # Augmenting datasets — read once.
    sdo_historical = _load_json(SDO_DIR / "historical-pop.json").get("places", {})
    sdo_muni = _load_json(SDO_DIR / "muni-housing.json").get("places", {})
    static_dec = _load_json(SDO_DIR / "decennial-static.json")
    static_state = static_dec.get("state", {})
    static_counties = static_dec.get("counties", {})

    # ---- State -------------------------------------------------------------
    state_latest_row = cs.state_row(latest_rows, STATE_FIPS)
    state_trend = _trend_block(
        {y: cs.state_row(rows_by_year[y], STATE_FIPS) for y in rows_by_year}
    )
    state_block = {
        "latest": _latest_block(state_latest_row),
        "trend": state_trend,
        "historicalTrend": {
            "population": _drop_short_series(static_state.get("population", []))
        },
    }

    # ---- Counties ----------------------------------------------------------
    county_data: dict[str, dict] = {}
    for cfips in COUNTY_FIPS.keys():
        geoid = f"{STATE_FIPS}{cfips}"
        latest_row = cs.county_row(latest_rows, STATE_FIPS, cfips)
        trend_rows = {
            y: cs.county_row(rows_by_year[y], STATE_FIPS, cfips) for y in rows_by_year
        }
        ctrend = _trend_block(trend_rows)
        county_hist = static_counties.get(geoid, {})
        county_data[geoid] = {
            "latest": _latest_block(latest_row),
            "trend": ctrend,
            "historicalTrend": {
                "population": _drop_short_series(county_hist.get("population", []))
            },
        }

    # ---- Places ------------------------------------------------------------
    place_data: dict[str, dict] = {}
    for rec in all_place_records():
        geoid_7 = rec["place_geoid"]  # may be None for ZCTA-fallback (Old Snowmass)
        if geoid_7:
            place_code = geoid_7[2:]
            latest_row = cs.place_row(latest_rows, STATE_FIPS, place_code)
            trend_rows = {
                y: cs.place_row(rows_by_year[y], STATE_FIPS, place_code)
                for y in rows_by_year
            }
        else:
            latest_row = cs.zcta_row(latest_rows, rec["zip"])
            trend_rows = {
                y: cs.zcta_row(rows_by_year[y], rec["zip"]) for y in rows_by_year
            }

        latest = _latest_block(latest_row)
        trend = _trend_block(trend_rows)

        # SDO place override — for the 10 incorporated anchors the SDO
        # vintage-2024 series replaces ACS 5-Year for population (latest +
        # trend). This eliminates the methodology discontinuity at 2024
        # when toggling between Current and Historical.
        if geoid_7 and geoid_7 in sdo_muni:
            sdo_pop = sdo_muni[geoid_7].get("population", [])
            if sdo_pop:
                # latest = the most recent SDO point
                if latest is not None:
                    latest["population"] = sdo_pop[-1]["value"]
                else:
                    latest = {"population": sdo_pop[-1]["value"]}
                # trend = the SDO annual series, year-sorted
                trend["population"] = sdo_pop

        # Historical decennial population for this place (1950 → 2020 from SDO).
        # Append the most-recent annual point (typically 2024 from SDO muni)
        # so the historical line ends at the present, not at 2020.
        hist_pop: list[dict] = []
        if geoid_7 and geoid_7 in sdo_historical:
            hist_pop = list(sdo_historical[geoid_7])
        # Anchor 2024 (or the latest SDO annual year) onto the historical line.
        if geoid_7 and geoid_7 in sdo_muni:
            sdo_pop = sdo_muni[geoid_7].get("population", [])
            if sdo_pop:
                anchor_year = sdo_pop[-1]["year"]
                # Skip if already present (decennial 2020 + 2020 SDO would double-up)
                if not any(p["year"] == anchor_year for p in hist_pop):
                    hist_pop.append({"year": anchor_year, "value": sdo_pop[-1]["value"]})

        place_entry = {
            "latest": latest,
            "trend": trend,
            "historicalTrend": {
                "population": _drop_short_series(sorted(hist_pop, key=lambda p: p["year"]))
            },
        }
        place_data[rec["zip"]] = place_entry

    return build_envelope(
        topic="demographics",
        vintage_start=ACS_TREND_START,
        vintage_end=ACS_LATEST_YEAR,
        sources=[
            source(
                id="ACS5",
                agency="U.S. Census Bureau",
                dataset="American Community Survey 5-Year Estimates",
                endpoint=f"https://api.census.gov/data/{ACS_LATEST_YEAR}/acs/acs5",
            ),
            source(
                id="SDO_VINTAGE_2024",
                agency="Colorado State Demography Office",
                dataset="Population & Housing Estimates by Municipality (Vintage 2024)",
                endpoint="https://demography.dola.colorado.gov/data/",
            ),
            source(
                id="SDO_HISTORICAL",
                agency="Colorado State Demography Office",
                dataset="Historical Census Population by Place (1870 → 2020)",
                endpoint="https://demography.dola.colorado.gov/data/",
            ),
            source(
                id="DEC_STATIC",
                agency="U.S. Census Bureau",
                dataset="Decennial Census state + county counts (static)",
                endpoint="https://www.census.gov/programs-surveys/decennial-census/data.html",
            ),
        ],
        state_data=state_block,
        county_data=county_data,
        place_data=place_data,
    )
