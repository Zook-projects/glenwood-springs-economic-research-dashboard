#!/usr/bin/env python3
"""
geocode-properties.py — Resolve every unique Address that appears in the
Placer_resident_toplocations table to a (lat, lng) pair so build-placer.py
can ship property-level coordinates with the shopper JSON. Used by the
Activity map's Shoppers metric to render a genuine property-level heatmap
(MapLibre heatmap layer weighted by visits, same primitive as the
Workforce map heatmap).

Hits the OpenStreetMap Nominatim service (free, no API key) and caches
every successful resolution to `data/placer/geocode-cache.json` so
subsequent builds (and CI re-runs) are near-instant. Rate-limited to one
request per second per Nominatim's usage policy.

Run:
    python3 scripts/geocode-properties.py        # incremental — only
                                                 # geocodes addresses not
                                                 # already in the cache.
    python3 scripts/geocode-properties.py --reset
                                                 # forces re-geocode of
                                                 # every address.
    python3 scripts/geocode-properties.py --limit N
                                                 # stops after N new
                                                 # requests (useful for
                                                 # incremental fills /
                                                 # honoring Nominatim's
                                                 # bulk-use guidance).

Cache shape (data/placer/geocode-cache.json):
    {
      "address string": {"lat": 39.07, "lng": -108.54, "src": "nominatim", "queriedAt": "2026-05-16"},
      "BAD_ADDRESS": {"failed": true, "queriedAt": "..."},   # negative cache
      ...
    }

build-placer.py consumes the same JSON to attach coordinates to its
emitted shopper-property file.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

import openpyxl

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent
INPUT_PATH = PROJECT_ROOT / "data" / "placer" / "Placer.ai - Regional Activity .xlsx"
CACHE_PATH = PROJECT_ROOT / "data" / "placer" / "geocode-cache.json"
SHOPPERS_SHEET = "Retail Leakage"

USER_AGENT = (
    "glenwood-valley-behavioral-map/1.0 "
    "(transportation research; jake@glenwoodsprings.gov)"
)
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
# Nominatim usage policy: ≤1 request/sec, supply a real User-Agent.
SLEEP_SECONDS = 1.05


def load_cache(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        with path.open(encoding="utf-8") as fh:
            data = json.load(fh)
            if isinstance(data, dict):
                return data
    except json.JSONDecodeError:
        pass
    return {}


def save_cache(path: Path, cache: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(cache, fh, indent=2, sort_keys=True)
    tmp.replace(path)


def read_unique_addresses(xlsx_path: Path) -> list[str]:
    """Walk the Placer_resident_toplocations sheet (column E = address)
    and return the unique non-empty address strings in workbook order."""
    if not xlsx_path.exists():
        print(f"ERROR: workbook missing at {xlsx_path}", file=sys.stderr)
        sys.exit(1)
    wb = openpyxl.load_workbook(xlsx_path, data_only=True, read_only=True)
    if SHOPPERS_SHEET not in wb.sheetnames:
        print(f"ERROR: sheet '{SHOPPERS_SHEET}' not found", file=sys.stderr)
        sys.exit(1)
    ws = wb[SHOPPERS_SHEET]
    seen: set[str] = set()
    ordered: list[str] = []
    for raw in ws.iter_rows(min_row=5, values_only=True):
        if not raw or len(raw) < 5:
            continue
        cell = raw[4]
        if not isinstance(cell, str):
            continue
        addr = cell.strip()
        if not addr:
            continue
        if addr in seen:
            continue
        seen.add(addr)
        ordered.append(addr)
    return ordered


_ZIP_RE = re.compile(r"\b(\d{5})(?:-\d{4})?\b")


def normalize_address(addr: str) -> str:
    """Trim + collapse whitespace so trivially-different variants hit the
    same cache entry."""
    return re.sub(r"\s+", " ", addr).strip()


def geocode_one(address: str) -> dict | None:
    """One Nominatim lookup. Returns {lat, lng} on success, None on
    failure. Network errors are propagated as None so the caller can
    record a negative-cache entry and move on."""
    params = {
        "q": address,
        "format": "json",
        "limit": "1",
        "countrycodes": "us",
        "addressdetails": "0",
    }
    url = f"{NOMINATIM_URL}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = json.load(resp)
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as e:
        print(f"  network error: {e}", file=sys.stderr)
        return None
    if not payload:
        return None
    first = payload[0]
    try:
        lat = float(first["lat"])
        lng = float(first["lon"])
    except (KeyError, ValueError, TypeError):
        return None
    return {"lat": round(lat, 6), "lng": round(lng, 6)}


def main() -> int:
    ap = argparse.ArgumentParser(description="Geocode Placer property addresses.")
    ap.add_argument(
        "--reset",
        action="store_true",
        help="Discard existing cache and re-geocode every address.",
    )
    ap.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Stop after N new geocode requests (default: no limit).",
    )
    args = ap.parse_args()

    addresses = read_unique_addresses(INPUT_PATH)
    print(f"Unique addresses in workbook: {len(addresses)}")

    cache = {} if args.reset else load_cache(CACHE_PATH)
    if cache:
        success = sum(1 for v in cache.values() if isinstance(v, dict) and not v.get("failed"))
        failed = sum(1 for v in cache.values() if isinstance(v, dict) and v.get("failed"))
        print(f"Cache loaded: {len(cache)} entries ({success} hits, {failed} negative)")

    today = date.today().isoformat()
    new_requests = 0
    successes = 0
    failures = 0

    try:
        for i, addr in enumerate(addresses):
            norm = normalize_address(addr)
            if norm in cache and not args.reset:
                continue
            if args.limit and new_requests >= args.limit:
                print(f"Hit --limit ({args.limit}); stopping for this run.")
                break
            new_requests += 1
            print(f"[{i + 1}/{len(addresses)}] {addr[:70]}")
            result = geocode_one(norm)
            if result is None:
                cache[norm] = {"failed": True, "queriedAt": today}
                failures += 1
            else:
                cache[norm] = {**result, "src": "nominatim", "queriedAt": today}
                successes += 1
            # Persist every 25 requests so a Ctrl-C still saves progress.
            if new_requests % 25 == 0:
                save_cache(CACHE_PATH, cache)
            time.sleep(SLEEP_SECONDS)
    except KeyboardInterrupt:
        print("\nInterrupted — saving partial cache.")
    finally:
        save_cache(CACHE_PATH, cache)

    print(
        f"Done. New requests: {new_requests} "
        f"({successes} success, {failures} failed). "
        f"Cache: {CACHE_PATH.relative_to(PROJECT_ROOT)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
