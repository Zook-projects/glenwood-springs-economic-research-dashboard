"""
context_builders/housing.py — Compose housing.json from cached
ACS B25 (Census) + Zillow ZHVI/ZORI + HUD CHAS + HUD FMR + Census BPS,
augmented with SDO place housing units (annual 2010 → 2024) and NHGIS
decennial housing units (1970 → 2020 places + counties) for the historical
trend.

Each underlying source contributes a subset of keys. The builder unions them
per geography level — missing sources leave their keys absent rather than
zero-valued, so the renderer's "no data" placeholder triggers correctly.
"""

from __future__ import annotations

import json
from pathlib import Path

from context_schema import build_envelope, source, trend_series
from geographies import (
    STATE_FIPS,
    COUNTY_FIPS,
    all_place_records,
)

from . import _census_shared as cs

CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "context-cache"
SDO_DIR = CACHE_DIR / "sdo"

ACS_HOUSING_VARS = {
    "medianHomeValueAcs": "B25077_001E",
    "medianGrossRent": "B25064_001E",
    "ownerOccupied": "B25003_002E",
    "renterOccupied": "B25003_003E",
    "totalHousingUnits": "B25001_001E",
}

# Year-built cohort variables (B25034). Keys map directly to camelCase
# field names the UI consumes.
ACS_YEAR_BUILT_VARS = {
    "yearBuilt2020plus": "B25034_002E",
    "yearBuilt2010to19": "B25034_003E",
    "yearBuilt2000to09": "B25034_004E",
    "yearBuilt1990to99": "B25034_005E",
    "yearBuilt1980to89": "B25034_006E",
    "yearBuilt1970to79": "B25034_007E",
    "yearBuilt1960to69": "B25034_008E",
    "yearBuilt1950to59": "B25034_009E",
    "yearBuilt1940to49": "B25034_010E",
    "yearBuiltPre1940":  "B25034_011E",
}

# Cost burden composites — sum across renter (B25070) and owner (B25091)
# buckets. Owner side covers BOTH mortgage-status sub-universes (with /
# without) and skips the "Not computed" bucket so the count reflects only
# households whose burden the Census actually estimated. The earlier list
# was missing owners with-mortgage at 30–39.9% and all owners without-
# mortgage at 30%+, and was instead summing the without-mortgage *parent
# total* and the "Not computed" bucket — see commit history for context.
COST_BURDEN_30_VARS = [
    # Renters 30%+
    "B25070_007E", "B25070_008E", "B25070_009E", "B25070_010E",
    # Owners WITH mortgage 30%+
    "B25091_006E", "B25091_007E", "B25091_008E", "B25091_009E",
    # Owners WITHOUT mortgage 30%+
    "B25091_017E", "B25091_018E", "B25091_019E", "B25091_020E",
]
COST_BURDEN_50_VARS = [
    # Renters 50%+
    "B25070_010E",
    # Owners 50%+ (with + without mortgage)
    "B25091_009E", "B25091_020E",
]
# B25106 — Tenure by Housing Costs as % of HHI. 30%+ rows summed across
# income brackets (one per income bracket per tenure) give a single-table
# cross-check of cost burden. Owner: _006, _010, _014, _018, _022. Renter:
# _028, _032, _036, _040, _044.
COST_BURDEN_30_B25106_VARS = [
    "B25106_006E", "B25106_010E", "B25106_014E", "B25106_018E", "B25106_022E",
    "B25106_028E", "B25106_032E", "B25106_036E", "B25106_040E", "B25106_044E",
]

ACS_LATEST_YEAR = 2024
ACS_TREND_START = 2015  # B25 series have decent ZCTA-level coverage from 2015 on


def _load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        with path.open() as f:
            return json.load(f)
    except Exception:
        return {}


def _drop_short_series(points: list[dict], *, min_points: int = 2) -> list[dict]:
    return points if len(points) >= min_points else []


def _zillow_for_geo(geo_kind: str, key: str, *, kind: str = "all") -> dict | None:
    """
    Read a normalized Zillow ZHVI record from data/context-cache/zillow/.
    `kind` selects the property-type / bedroom-tier variant:
      'all'           → zhvi-{geo}.json       (SFR + Condo combined, mid-tier)
      'sfr'           → zhvi-sfr-{geo}.json   (Single-family only)
      'condo'         → zhvi-condo-{geo}.json (Condo / co-op only)
      'br1'..'br5'    → zhvi-br{N}-{geo}.json (mid-tier, by bedroom count)
    `geo_kind` is one of 'zip', 'city', 'county', 'state', 'us'.
    Returns the matching record (with 'latest' + 'trend') or None.
    """
    prefix = "zhvi" if kind == "all" else f"zhvi-{kind}"
    path = CACHE_DIR / "zillow" / f"{prefix}-{geo_kind}.json"
    if not path.exists():
        return None
    try:
        with path.open() as f:
            data = json.load(f)
    except json.JSONDecodeError:
        return None
    for rec in data:
        if rec.get("key") == key:
            return rec
    return None


def _zori_for_geo(geo_kind: str, key: str) -> dict | None:
    path = CACHE_DIR / "zillow" / f"zori-{geo_kind}.json"
    if not path.exists():
        return None
    try:
        with path.open() as f:
            data = json.load(f)
    except json.JSONDecodeError:
        return None
    for rec in data:
        if rec.get("key") == key:
            return rec
    return None


def _hud_fmr_county(county_geoid: str) -> dict | None:
    """county_geoid is the 5-digit Census GEOID (e.g., '08045'); HUD's cache
    file uses '{state_county}99999' (HUD's entity-ID format)."""
    hud_code = f"{county_geoid}99999"
    cache_dir = CACHE_DIR / "hud"
    if not cache_dir.exists():
        return None
    matches = sorted(cache_dir.glob(f"fmr-{hud_code}-*.json"), reverse=True)
    if not matches:
        return None
    try:
        with matches[0].open() as f:
            return json.load(f)
    except json.JSONDecodeError:
        return None


def _bps_for_year(year: int) -> list[dict]:
    """Phase 3 fetcher will write a normalized JSON; for now graceful empty."""
    path = CACHE_DIR / "bps" / f"{year}.json"
    if not path.exists():
        return []
    try:
        with path.open() as f:
            return json.load(f)
    except json.JSONDecodeError:
        return []


def _acs_block(row) -> dict:
    """Direct ACS variables + composites for cost burden + year built."""
    block: dict = {}
    for key, var in ACS_HOUSING_VARS.items():
        v = cs.number_or_none(row, var)
        if v is not None:
            block[key] = v
    for key, var in ACS_YEAR_BUILT_VARS.items():
        v = cs.number_or_none(row, var)
        if v is not None:
            block[key] = v
    cb30 = cs.sum_vars(row, COST_BURDEN_30_VARS)
    if cb30 is not None:
        block["costBurden30"] = cb30
    cb50 = cs.sum_vars(row, COST_BURDEN_50_VARS)
    if cb50 is not None:
        block["costBurden50"] = cb50
    # B25106 cross-validation total — same metric, single-table source.
    cb30_b25106 = cs.sum_vars(row, COST_BURDEN_30_B25106_VARS)
    if cb30_b25106 is not None:
        block["costBurden30B25106"] = cb30_b25106
    return block


ZHVI_VARIANTS: tuple[tuple[str, str], ...] = (
    ("all",   "zhvi"),
    ("sfr",   "zhviSfr"),
    ("condo", "zhviCondo"),
    ("br1",   "zhviBr1"),
    ("br2",   "zhviBr2"),
    ("br3",   "zhviBr3"),
    ("br4",   "zhviBr4"),
    ("br5",   "zhviBr5"),
)


def _merge_zillow(block: dict, geo_kind: str, key: str) -> None:
    for variant_kind, out_key in ZHVI_VARIANTS:
        z = _zillow_for_geo(geo_kind, key, kind=variant_kind)
        if z and z.get("latest") is not None:
            block[out_key] = z["latest"]
    z = _zori_for_geo(geo_kind, key)
    if z and z.get("latest") is not None:
        block["zori"] = z["latest"]


def _zillow_trend_block(geo_kind: str, key: str) -> dict:
    out: dict = {}
    for variant_kind, out_key in ZHVI_VARIANTS:
        out[out_key] = _zillow_trend(geo_kind, key, kind=variant_kind)
    return out


def _merge_fmr(block: dict, county_geoid: str) -> None:
    fmr = _hud_fmr_county(county_geoid)
    if not fmr:
        return
    try:
        basic = fmr.get("data", {}).get("basicdata", {})
        row = basic[0] if isinstance(basic, list) and basic else basic
        if isinstance(row, dict):
            two_br = row.get("Two-Bedroom") or row.get("Two_Bedroom") or row.get("fmr_2")
            if two_br is not None:
                block["fmr2br"] = float(two_br)
    except (AttributeError, KeyError, TypeError, ValueError):
        pass


def _zillow_trend(geo_kind: str, key: str, *, kind: str = "all") -> list[dict]:
    z = _zillow_for_geo(geo_kind, key, kind=kind)
    if not z or not z.get("trend"):
        return []
    return trend_series([(int(p["year"]), float(p["value"])) for p in z["trend"]])


def _annual_cost_burden_30(
    rows_by_year: dict[int, list[dict]],
    row_lookup,
) -> list[dict]:
    """Per-year cost-burden-30 composite series. `row_lookup(rows, year)` must
    return the matching ACS row for the geography. Uses the corrected
    COST_BURDEN_30_VARS — renters at 30%+ plus owners (with + without
    mortgage) at 30%+ — so the time series matches the latest-year point in
    `_acs_block`."""
    pairs: list[tuple[int, float | None]] = []
    for y in sorted(rows_by_year):
        row = row_lookup(rows_by_year[y])
        cb = cs.sum_vars(row, COST_BURDEN_30_VARS)
        pairs.append((y, cb))
    return trend_series(pairs)


def _annual_pct_owner_occupied(trend_block: dict) -> list[dict]:
    """Per-year owner-occupied share, computed from the already-built
    ownerOccupied + renterOccupied trends. Skips years where either side is
    missing or the denominator is zero so the share never reads as 0%."""
    owner = {p["year"]: p["value"] for p in trend_block.get("ownerOccupied", []) if p.get("value") is not None}
    renter = {p["year"]: p["value"] for p in trend_block.get("renterOccupied", []) if p.get("value") is not None}
    out: list[dict] = []
    for year in sorted(set(owner) & set(renter)):
        denom = owner[year] + renter[year]
        if denom <= 0:
            continue
        out.append({"year": year, "value": owner[year] / denom})
    return out


def _annual_pct_cost_burdened(trend_block: dict) -> list[dict]:
    """Per-year cost-burdened share. Numerator = costBurden30 series;
    denominator = ownerOccupied + renterOccupied (tenure universe). Skips
    years where either side is missing."""
    burden = {p["year"]: p["value"] for p in trend_block.get("costBurden30", []) if p.get("value") is not None}
    owner = {p["year"]: p["value"] for p in trend_block.get("ownerOccupied", []) if p.get("value") is not None}
    renter = {p["year"]: p["value"] for p in trend_block.get("renterOccupied", []) if p.get("value") is not None}
    out: list[dict] = []
    for year in sorted(set(burden) & set(owner) & set(renter)):
        denom = owner[year] + renter[year]
        if denom <= 0:
            continue
        out.append({"year": year, "value": burden[year] / denom})
    return out


def _vacancy_pct_from_sdo(sdo_metrics: dict) -> list[dict]:
    """Annual vacancy-rate series from SDO. SDO publishes the rate as a
    percentage (e.g. 8.4), not a fraction. The UI's HousingMetric formatter
    treats vacancyPct the same way, so the series is passed through as-is."""
    return list(sdo_metrics.get("vacancyPct", []))


def build_housing() -> dict:
    rows_by_year: dict[int, list[dict]] = {}
    for year in range(ACS_TREND_START, ACS_LATEST_YEAR + 1):
        rows_by_year[year] = cs.load_acs5(year)
    latest_rows = rows_by_year.get(ACS_LATEST_YEAR, [])

    # Augmenting datasets — read once.
    sdo_muni = _load_json(SDO_DIR / "muni-housing.json").get("places", {})
    nhgis = _load_json(SDO_DIR / "nhgis-housing.json")
    nhgis_places = nhgis.get("places", {})
    nhgis_counties = nhgis.get("counties", {})
    static_dec = _load_json(SDO_DIR / "decennial-static.json")
    static_state_hu = static_dec.get("state", {}).get("housingUnits", [])

    # ---- State -------------------------------------------------------------
    state_row = cs.state_row(latest_rows, STATE_FIPS)
    state_block_latest = _acs_block(state_row)
    _merge_zillow(state_block_latest, "state", "CO")
    state_trend = _zillow_trend_block("state", "CO")
    for tk, var in ACS_HOUSING_VARS.items():
        pairs = []
        for y in sorted(rows_by_year):
            row = cs.state_row(rows_by_year[y], STATE_FIPS)
            pairs.append((y, cs.number_or_none(row, var)))
        state_trend[tk] = trend_series(pairs)
    # Alias housingUnits = ACS B25001 totals at the state/county level for
    # the Current view of the Housing Units Trend chart (SDO covers places).
    state_trend["housingUnits"] = state_trend.get("totalHousingUnits", [])
    # Affordability time series: cost-burden composite (ACS B25070+B25091),
    # owner-occupied share, and cost-burdened share. SDO publishes vacancy
    # as a percentage for places only — state/county vacancyPct stays empty.
    state_trend["costBurden30"] = _annual_cost_burden_30(
        rows_by_year,
        lambda rows: cs.state_row(rows, STATE_FIPS),
    )
    state_trend["pctOwnerOccupied"] = _annual_pct_owner_occupied(state_trend)
    state_trend["pctCostBurdened30"] = _annual_pct_cost_burdened(state_trend)

    # Anchor most-recent non-null ACS B25001 state HU point onto the historical
    # series (mirrors the place + county anchoring below).
    state_hist_hu = list(static_state_hu)
    state_acs_hu_trend = [
        p for p in state_trend.get("housingUnits", []) if p.get("value") is not None
    ]
    if state_acs_hu_trend:
        anchor = state_acs_hu_trend[-1]
        if not any(p["year"] == anchor["year"] for p in state_hist_hu):
            state_hist_hu.append({"year": anchor["year"], "value": anchor["value"]})

    state_data = {
        "latest": state_block_latest or None,
        "trend": state_trend,
        "historicalTrend": {
            "housingUnits": _drop_short_series(sorted(state_hist_hu, key=lambda p: p["year"])),
        },
    }

    # ---- Counties ----------------------------------------------------------
    county_data = {}
    for cfips in COUNTY_FIPS.keys():
        geoid = f"{STATE_FIPS}{cfips}"
        latest_county = cs.county_row(latest_rows, STATE_FIPS, cfips)
        block = _acs_block(latest_county)
        _merge_zillow(block, "county", geoid)
        _merge_fmr(block, geoid)
        ctrend = _zillow_trend_block("county", geoid)
        for tk, var in ACS_HOUSING_VARS.items():
            pairs = []
            for y in sorted(rows_by_year):
                row = cs.county_row(rows_by_year[y], STATE_FIPS, cfips)
                pairs.append((y, cs.number_or_none(row, var)))
            ctrend[tk] = trend_series(pairs)
        ctrend["housingUnits"] = ctrend.get("totalHousingUnits", [])
        # Affordability time series — see _annual_* helpers above.
        ctrend["costBurden30"] = _annual_cost_burden_30(
            rows_by_year,
            lambda rows, cf=cfips: cs.county_row(rows, STATE_FIPS, cf),
        )
        ctrend["pctOwnerOccupied"] = _annual_pct_owner_occupied(ctrend)
        ctrend["pctCostBurdened30"] = _annual_pct_cost_burdened(ctrend)

        # Historical decennial housing units (1970 → 2020 from NHGIS).
        # Anchor most-recent non-null ACS B25001 point so the historical line
        # ends at the present, not 2020. (B25001 may be absent from the cache
        # if fetch-context-census.py hasn't been re-run with an API key — in
        # that case fall back to the 2020 NHGIS endpoint without an anchor.)
        hist_hu = list(nhgis_counties.get(geoid, []))
        acs_hu_trend = [
            p for p in ctrend.get("housingUnits", []) if p.get("value") is not None
        ]
        if acs_hu_trend:
            anchor = acs_hu_trend[-1]
            if not any(p["year"] == anchor["year"] for p in hist_hu):
                hist_hu.append({"year": anchor["year"], "value": anchor["value"]})

        county_data[geoid] = {
            "latest": block or None,
            "trend": ctrend,
            "historicalTrend": {
                "housingUnits": _drop_short_series(sorted(hist_hu, key=lambda p: p["year"])),
            },
        }

    # ---- Places ------------------------------------------------------------
    place_data = {}
    for rec in all_place_records():
        if rec["place_geoid"]:
            pc = rec["place_geoid"][2:]
            latest_place = cs.place_row(latest_rows, STATE_FIPS, pc)
            block = _acs_block(latest_place)
            ptrend = {}
            for tk, var in ACS_HOUSING_VARS.items():
                pairs = []
                for y in sorted(rows_by_year):
                    row = cs.place_row(rows_by_year[y], STATE_FIPS, pc)
                    pairs.append((y, cs.number_or_none(row, var)))
                ptrend[tk] = trend_series(pairs)
            ptrend["costBurden30"] = _annual_cost_burden_30(
                rows_by_year,
                lambda rows, pc=pc: cs.place_row(rows, STATE_FIPS, pc),
            )
        else:
            latest_place = cs.zcta_row(latest_rows, rec["zip"])
            block = _acs_block(latest_place)
            ptrend = {}
            for tk, var in ACS_HOUSING_VARS.items():
                pairs = []
                for y in sorted(rows_by_year):
                    row = cs.zcta_row(rows_by_year[y], rec["zip"])
                    pairs.append((y, cs.number_or_none(row, var)))
                ptrend[tk] = trend_series(pairs)
            ptrend["costBurden30"] = _annual_cost_burden_30(
                rows_by_year,
                lambda rows, z=rec["zip"]: cs.zcta_row(rows, z),
            )
        # Owner-occupied + cost-burdened shares depend on the raw counts +
        # cost-burden composites above; compute after both have been built.
        ptrend["pctOwnerOccupied"] = _annual_pct_owner_occupied(ptrend)
        ptrend["pctCostBurdened30"] = _annual_pct_cost_burdened(ptrend)

        # Zillow ZIP-level — merge all eight ZHVI variants + trend block
        _merge_zillow(block, "zip", rec["zip"])
        ptrend.update(_zillow_trend_block("zip", rec["zip"]))
        ptrend["zori"] = _zillow_trend("zip", rec["zip"])

        # SDO override — SDO place data covers 2010 → 2024 with point
        # estimates that are more authoritative for small CO places than
        # ACS 5-Year averages. Surface annual housing units (current trend)
        # and the current-period housing characteristics (latest fields).
        geoid_7 = rec["place_geoid"]
        sdo_pop_trend: list[dict] = []
        if geoid_7 and geoid_7 in sdo_muni:
            sdo_metrics = sdo_muni[geoid_7]
            # Surface 2024 vintage characteristics into latest. Each metric
            # is an array of {year, value}; pick the most recent point.
            for sdo_key in (
                "housingUnitsTotal",
                "housingUnitsOccupied",
                "housingUnitsVacant",
                "vacancyPct",
                "householdSize",
                "householdPopulation",
            ):
                series = sdo_metrics.get(sdo_key, [])
                if series:
                    block[sdo_key] = series[-1]["value"]
            # Annual 2010 → 2024 housing units trend (SDO).
            ptrend["housingUnits"] = sdo_metrics.get("housingUnitsTotal", [])
            # Annual vacancy-rate trend (SDO publishes as a percentage).
            ptrend["vacancyPct"] = _vacancy_pct_from_sdo(sdo_metrics)
            sdo_pop_trend = sdo_metrics.get("population", [])
        else:
            # ZCTA fallbacks (Old Snowmass) — no SDO coverage. Use ACS B25001
            # if available.
            ptrend["housingUnits"] = ptrend.get("totalHousingUnits", [])

        # Historical decennial housing units (1970 → 2020 from NHGIS).
        # Anchor most-recent non-null housing-units point (SDO 2024 for our
        # 10 anchors; ACS B25001 fallback for ZCTAs).
        hist_hu = list(nhgis_places.get(geoid_7, [])) if geoid_7 else []
        sdo_hu_trend = [
            p for p in ptrend.get("housingUnits", []) if p.get("value") is not None
        ]
        if sdo_hu_trend:
            anchor = sdo_hu_trend[-1]
            if not any(p["year"] == anchor["year"] for p in hist_hu):
                hist_hu.append({"year": anchor["year"], "value": anchor["value"]})

        place_data[rec["zip"]] = {
            "latest": block or None,
            "trend": ptrend,
            "historicalTrend": {
                "housingUnits": _drop_short_series(sorted(hist_hu, key=lambda p: p["year"])),
            },
        }

    # United States benchmark — synthetic place entry keyed 'US'.
    us_block: dict = {}
    _merge_zillow(us_block, "us", "US")
    us_trend = _zillow_trend_block("us", "US")
    if us_block:
        place_data["US"] = {"latest": us_block or None, "trend": us_trend}

    envelope = build_envelope(
        topic="housing",
        vintage_start=ACS_TREND_START,
        vintage_end=ACS_LATEST_YEAR,
        sources=[
            source(
                id="ACS5",
                agency="U.S. Census Bureau",
                dataset="ACS 5-Year Estimates (B25 series)",
                endpoint=f"https://api.census.gov/data/{ACS_LATEST_YEAR}/acs/acs5",
            ),
            source(
                id="ZILLOW",
                agency="Zillow Research",
                dataset="ZHVI / ZORI",
                endpoint="https://www.zillow.com/research/data/",
            ),
            source(
                id="HUD_FMR",
                agency="U.S. Department of Housing and Urban Development",
                dataset="Fair Market Rents",
                endpoint="https://www.huduser.gov/hudapi/public/fmr",
            ),
            source(
                id="SDO_VINTAGE_2024",
                agency="Colorado State Demography Office",
                dataset="Population & Housing Estimates by Municipality (Vintage 2024)",
                endpoint="https://demography.dola.colorado.gov/data/",
            ),
            source(
                id="NHGIS",
                agency="IPUMS NHGIS",
                dataset="Decennial Housing Units Time Series (1970 → 2020)",
                endpoint="https://www.nhgis.org/",
            ),
        ],
        state_data=state_data,
        county_data=county_data,
        place_data=place_data,
    )

    # Append the United States benchmark as a synthetic place entry.
    us_pd = place_data.get("US")
    if us_pd:
        envelope["places"].append({
            "zip": "US",
            "name": "United States",
            "kind": "national",
            "placeGeoid": None,
            "countyGeoid": "",
            "countyName": "",
            "latest": us_pd.get("latest"),
            "trend": us_pd.get("trend", {}),
        })

    return envelope
