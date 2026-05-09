"""
fetch-context-economic.py — Best-effort fetch of BLS Consumer Expenditure
Survey Table 1300 (Age of reference person) for the trend window.

bls.gov sits behind Akamai and frequently returns HTTP 403 to programmatic
fetches. When that happens, the recommended refresh path is manual:
download the XLSX from
  https://www.bls.gov/cex/tables.htm
(open Table 1300 → "Age of reference person") and drop the file into
  data/context-cache/bls/cex/

The builder picks up the cached file on the next `python3 scripts/build-context.py`
run; until then it uses the seeded illustrative values embedded in
scripts/cex_api.py.
"""

from __future__ import annotations

import sys

import cex_api

# 10-year trend window ending in the most recent published year.
TREND_YEARS = list(range(2014, 2025))


def main() -> int:
    print(
        "Fetching BLS CES Table 1300 into data/context-cache/bls/cex/…",
        file=sys.stderr,
    )
    fetched = 0
    for year in TREND_YEARS:
        try:
            path = cex_api.fetch_table_1300_xlsx(year)
            print(f"  [ces {year}] cached → {path.name}", file=sys.stderr)
            fetched += 1
        except Exception as e:
            # 403 from Akamai is expected; surface and continue.
            print(f"  [ces {year}] {type(e).__name__}: {e}", file=sys.stderr)

    if fetched == 0:
        print(
            "\n  WARN: no XLSX cached. BLS commonly blocks programmatic fetches.\n"
            "  Refresh manually by downloading Table 1300 from\n"
            "    https://www.bls.gov/cex/tables.htm\n"
            "  and dropping the .xlsx files into\n"
            f"    {cex_api.CACHE_DIR}",
            file=sys.stderr,
        )
    print("CES fetch complete.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
