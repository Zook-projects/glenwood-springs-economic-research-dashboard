#!/usr/bin/env python3
"""
build-placer.py — Convert the Placer.ai Regional Activity workbook into four
parallel zip-origin JSON files plus a summary index, all under
``public/data/placer/``. Reads the workbook from ``data/placer/`` relative to
the project root. ``data/placer/`` is gitignored so the proprietary workbook
stays out of the repo. Skips the "Retail Leakage" sheet, which is metadata-only.

Workbook layout (one sheet per metric):
    Row 2:  title cell ('Employee Origins by Zip Code - Employee Counts' etc)
    Row 4:  column headers: Destination Zip Code | Year | Origin Zipcode | City
            | State | lat | lng | % of <metric> | <metric value>
    Row 5+: data rows. Column A is always blank.

Output (one file per metric):
    {
      "metric": "employee-counts",
      "label": "Employee Origins — Employee Counts",
      "source": "Placer.ai",
      "lastBuilt": "<ISO-date>",
      "destAnchors": ["81601", "81623"],
      "rows": [
        { "destZip": "81601", "originZip": "81601", "value": 5543 },
        ...
      ]
    }

Plus ``placer-summary.json`` with the same metadata plus per-metric row counts
so the React side can render shell metadata without parsing every file.

Run from any directory:
    python3 scripts/build-placer.py
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

import openpyxl

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent
INPUT_PATH = PROJECT_ROOT / "data" / "placer" / "Placer.ai - Regional Activity .xlsx"
OUTPUT_DIR = PROJECT_ROOT / "public" / "data" / "placer"

# Sheet name → (metric id, human label) mapping. Order matters only for the
# console output / summary structure.
SHEETS = [
    ("Employee Counts", "employee-counts", "Employee Origins — Employee Counts"),
    ("Employee Visits", "employee-visits", "Employee Origins — Employee Visits"),
    ("Visitor Counts",  "visitor-counts",  "Visitor Origins — Visitor Counts"),
    ("Visitor Visits",  "visitor-visits",  "Visitor Origins — Visitor Visits"),
]


def zip_str(value: object) -> str | None:
    """Coerce an Excel cell value into a 5-character zip code string. Returns
    None when the cell is blank or doesn't parse as a positive integer-ish
    number — those rows are skipped silently."""
    if value is None:
        return None
    if isinstance(value, str):
        v = value.strip()
        if not v:
            return None
        # Some cells already arrive as strings — keep as-is but pad.
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


def read_metric_sheet(ws) -> tuple[list[dict], list[str]]:
    """Walk a metric sheet from row 5 onward. Returns (rows, dest_anchors).
    Column indexing (1-based, matches openpyxl):
        B (2) = Destination Zip Code
        D (4) = Origin Zipcode
        J (10) = numeric value
    Other columns are dropped — origin city/state/lat/lng come from the
    existing LODES zips.json on the client side via the FlowRow adapter."""
    rows: list[dict] = []
    seen_dests: set[str] = set()
    for raw in ws.iter_rows(min_row=5, values_only=True):
        if not raw or len(raw) < 10:
            continue
        dest = zip_str(raw[1])
        origin = zip_str(raw[3])
        value = positive_int(raw[9])
        if dest is None or origin is None or value is None:
            continue
        rows.append({"destZip": dest, "originZip": origin, "value": value})
        seen_dests.add(dest)
    return rows, sorted(seen_dests)


def main() -> int:
    if not INPUT_PATH.exists():
        print(f"ERROR: workbook not found at {INPUT_PATH}", file=sys.stderr)
        return 1

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Reading {INPUT_PATH.relative_to(PROJECT_ROOT)}…")
    wb = openpyxl.load_workbook(INPUT_PATH, data_only=True, read_only=True)
    iso_today = date.today().isoformat()

    # All four metric sheets share the same anchor set — capture the union as
    # we go and assert consistency for the user's sanity check.
    anchors_union: set[str] = set()
    summary_metrics: dict[str, dict] = {}

    for sheet_name, metric_id, label in SHEETS:
        if sheet_name not in wb.sheetnames:
            print(f"  skip: sheet '{sheet_name}' not found", file=sys.stderr)
            continue
        ws = wb[sheet_name]
        rows, dests = read_metric_sheet(ws)
        anchors_union.update(dests)
        out_path = OUTPUT_DIR / f"placer-{metric_id}.json"
        payload = {
            "metric": metric_id,
            "label": label,
            "source": "Placer.ai",
            "lastBuilt": iso_today,
            "destAnchors": dests,
            "rows": rows,
        }
        out_path.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
        print(f"  {metric_id}: {len(rows):>6} rows → {out_path.relative_to(PROJECT_ROOT)}")
        summary_metrics[metric_id] = {"label": label, "rowCount": len(rows)}

    summary = {
        "lastBuilt": iso_today,
        "destAnchors": sorted(anchors_union),
        "metrics": summary_metrics,
    }
    summary_path = OUTPUT_DIR / "placer-summary.json"
    summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")
    print(f"  summary: {summary_path.relative_to(PROJECT_ROOT)}")
    print(f"Done. Anchors covered: {sorted(anchors_union)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
