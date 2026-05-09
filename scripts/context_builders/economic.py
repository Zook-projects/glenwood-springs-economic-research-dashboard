"""
context_builders/economic.py — Build the EconomicEnvelope for the
Economic Research dashboard section.

National-only by design. CES (and the future BLS/BEA national datasets that
will share this section) publish at the U.S. national tier with no place /
county / state triple, so this builder emits a parallel envelope shape
distinct from the existing 6-topic ContextEnvelope.

Today the envelope carries one block: `ces` (BLS CES Table 1300, age of
reference person). Real refresh attempts to parse cached XLSX files under
data/context-cache/bls/cex/; when none parse, the seeded illustrative
values from cex_api.SEEDED_LATEST_2023 keep the dashboard rendering.
"""

from __future__ import annotations

import sys
from datetime import date

from context_schema import source as source_descriptor

import cex_api


def _build_ces_block() -> dict:
    """
    Compose the CES block. Tries cached XLSX first; falls back to seeded
    illustrative values when nothing parses.
    """
    cached = cex_api.cached_years()
    parsed_by_year: dict[int, dict] = {}
    for year in cached:
        path = cex_api.cache_path_for_year(year)
        parsed = cex_api.parse_table_1300(path)
        if parsed is not None:
            parsed_by_year[year] = parsed

    seeded = not parsed_by_year
    if seeded:
        # Seeded path — use the literal 2023 snapshot + scaled trend.
        latest = cex_api.SEEDED_LATEST_2023
        trend = cex_api.build_seeded_trend()
        years_used = cex_api.SEEDED_TREND_YEARS
        latest_year = latest["year"]
    else:
        # Real-data path — use the most recent parsed year as `latest` and
        # pivot all parsed years into the trend bag.
        latest_year = max(parsed_by_year)
        latest = parsed_by_year[latest_year]
        trend = _pivot_trend_from_parsed(parsed_by_year)
        years_used = sorted(parsed_by_year.keys())

    return {
        "source": source_descriptor(
            id="bls-ces-table-1300",
            agency="U.S. Bureau of Labor Statistics",
            dataset="Consumer Expenditure Survey · Table 1300 "
                    "(Age of reference person)",
            endpoint="https://www.bls.gov/cex/tables.htm",
            last_pulled=date.today().isoformat(),
        ),
        "vintageRange": {
            "start": min(years_used),
            "end": max(years_used),
        },
        "latest": latest,
        "trend": trend,
        "seeded": seeded,
    }


def _pivot_trend_from_parsed(parsed_by_year: dict[int, dict]) -> dict[str, list[dict]]:
    """
    Pivot per-year parsed snapshots into the dotted-key trend bag the
    renderer consumes. Only invoked when real CES XLSX files have been
    successfully parsed by cex_api.parse_table_1300().
    """
    paths: list[tuple[str, str]] = [
        ("income", "wagesBusiness"),
        ("income", "socSecRetirement"),
        ("income", "dividendsInterestRent"),
        ("incomeTax", "federal"),
        ("incomeTax", "stateLocal"),
        ("spending", "food"),
        ("spending", "housing"),
        ("spending", "transportation"),
        ("spending", "healthcare"),
        ("spending", "entertainment"),
        ("spending", "insurancePensions"),
        ("spending", "other"),
    ]
    trend: dict[str, list[dict]] = {}
    for group, cat in paths:
        key = f"{group}.{cat}"
        points: list[dict] = []
        for year in sorted(parsed_by_year):
            block = parsed_by_year[year].get(group, {}).get(cat, {})
            for cohort, value in block.items():
                points.append({"year": year, "cohort": cohort, "value": value})
        trend[key] = points
    return trend


def build_economic() -> dict:
    """Top-level builder — produces the wire-format EconomicEnvelope."""
    try:
        ces_block = _build_ces_block()
    except Exception as e:  # pragma: no cover
        print(f"  economic: ces block failed → {type(e).__name__}: {e}", file=sys.stderr)
        ces_block = None

    return {
        "geography": "us-national",
        "ces": ces_block,
    }


if __name__ == "__main__":  # pragma: no cover
    import json
    env = build_economic()
    print(json.dumps(env, indent=2)[:1200])
