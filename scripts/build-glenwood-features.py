#!/usr/bin/env python3
"""Convert the hand-digitized Glenwood Springs KMZ (retail hubs + POIs) into the
GeoJSON FeatureCollection consumed by GlenwoodMapCanvas.

Input:  data/glenwood-boundaries.kmz
Output: public/data/placer/glenwood/glenwood-features.geojson

Each KMZ Placemark becomes a GeoJSON Feature with:
  properties.id    — the slug used in retail-hubs.json / pois.json
  properties.name  — the KMZ Placemark name
  properties.kind  — 'hub' or 'poi'
  geometry         — Polygon (KML LinearRing → GeoJSON Polygon coordinates[0])
"""

from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
KMZ_PATH = ROOT / "data" / "glenwood-boundaries.kmz"
OUT_PATH = ROOT / "public" / "data" / "placer" / "glenwood" / "glenwood-features.geojson"

KML_NS = "http://www.opengis.net/kml/2.2"
NS = {"kml": KML_NS}

# Map KMZ Placemark names to the existing entity slugs in retail-hubs.json /
# pois.json. Any Placemark whose name isn't found here raises a hard error so
# typos / future renames surface loudly rather than silently dropping a polygon.
HUB_SLUGS: dict[str, str] = {
    "Glenwood Meadows": "glenwood-meadows",
    "Downtown Core": "downtown-core",
    "Roaring Fork Marketplace": "roaring-fork-marketplace",
    "6th Street - West": "6th-street-west",
    "6th Street - East": "6th-street-east",
    "Bethel & 7th Street": "bethel-7th",
    "1400 Block Grand Ave": "1400-grand-ave",
    "Glenwood Springs Mall": "glenwood-springs-mall",
}
POI_SLUGS: dict[str, str] = {
    "Glenwood Caverns Adventure Park": "glenwood-caverns",
    "Glenwood Hot Springs Pool": "glenwood-hot-springs-pool",
    "Hanging Lake": "hanging-lake",
    "Iron Mountain Hot Springs": "iron-mountain-hot-springs",
    "Two Rivers Park": "two-rivers-park",
    "Yampah Vapor Caves": "yampah-vapor-caves",
    "Sunlight Mountain Resort": "sunlight-mountain-resort",
}

FOLDER_KIND = {
    "Retail Hubs": ("hub", HUB_SLUGS),
    "POIs": ("poi", POI_SLUGS),
}


def parse_coordinates(text: str) -> list[list[float]]:
    """Parse a KML <coordinates> body into a list of [lon, lat] pairs.

    KML triples are 'lon,lat,alt' separated by whitespace. We drop alt because
    GeoJSON doesn't need it and MapLibre would ignore it anyway.
    """
    coords: list[list[float]] = []
    for token in text.split():
        parts = token.split(",")
        if len(parts) < 2:
            continue
        lon = float(parts[0])
        lat = float(parts[1])
        coords.append([lon, lat])
    return coords


def extract_polygon(placemark: ET.Element) -> list[list[float]]:
    """Return the LinearRing coordinates for a Placemark's outer boundary."""
    ring = placemark.find(
        "kml:Polygon/kml:outerBoundaryIs/kml:LinearRing/kml:coordinates",
        NS,
    )
    if ring is None or ring.text is None:
        raise ValueError("Placemark missing outerBoundaryIs/LinearRing/coordinates")
    coords = parse_coordinates(ring.text)
    if len(coords) < 4:
        raise ValueError(f"Polygon needs at least 4 coords (got {len(coords)})")
    # KML LinearRings are closed (first == last). GeoJSON requires the same;
    # the source file already satisfies this, but assert defensively so a
    # malformed export fails loud.
    if coords[0] != coords[-1]:
        raise ValueError(f"LinearRing is not closed: first {coords[0]} != last {coords[-1]}")
    return coords


def polygon_centroid(coords: list[list[float]]) -> list[float]:
    """Compute the centroid of a closed polygon ring (shoelace formula).

    `coords` is a list of [lon, lat] pairs with coords[0] == coords[-1].
    Falls back to the arithmetic mean for degenerate (zero-area) rings.
    """
    n = len(coords) - 1  # drop the duplicate closing vertex
    if n < 3:
        return [
            sum(c[0] for c in coords[:n]) / n,
            sum(c[1] for c in coords[:n]) / n,
        ]
    a2 = 0.0
    cx = 0.0
    cy = 0.0
    for i in range(n):
        x0, y0 = coords[i]
        x1, y1 = coords[i + 1]
        cross = x0 * y1 - x1 * y0
        a2 += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if a2 == 0:
        return [
            sum(c[0] for c in coords[:n]) / n,
            sum(c[1] for c in coords[:n]) / n,
        ]
    return [cx / (3 * a2), cy / (3 * a2)]


def build_features() -> list[dict]:
    with zipfile.ZipFile(KMZ_PATH) as zf:
        with zf.open("doc.kml") as f:
            tree = ET.parse(f)

    root = tree.getroot()
    features: list[dict] = []

    for folder in root.iter(f"{{{KML_NS}}}Folder"):
        name_el = folder.find("kml:name", NS)
        folder_name = (name_el.text or "").strip() if name_el is not None else ""
        if folder_name not in FOLDER_KIND:
            print(f"  skip folder: {folder_name!r}", file=sys.stderr)
            continue
        kind, slug_map = FOLDER_KIND[folder_name]
        print(f"  folder: {folder_name} ({kind})", file=sys.stderr)

        for pm in folder.findall("kml:Placemark", NS):
            name_el = pm.find("kml:name", NS)
            placemark_name = (name_el.text or "").strip() if name_el is not None else ""
            if not placemark_name:
                raise ValueError(f"Placemark in folder {folder_name!r} is missing <name>")
            if placemark_name not in slug_map:
                raise ValueError(
                    f"Placemark {placemark_name!r} in folder {folder_name!r} "
                    f"has no slug mapping — add it to {kind.upper()}_SLUGS"
                )
            slug = slug_map[placemark_name]
            polygon = extract_polygon(pm)

            properties = {
                "id": slug,
                "name": placemark_name,
                "kind": kind,
            }
            features.append(
                {
                    "type": "Feature",
                    "properties": properties,
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [polygon],
                    },
                }
            )
            print(f"    + {kind} {slug:30s} ({len(polygon)} points)", file=sys.stderr)

            # POIs also get a sibling Point feature at the polygon centroid so
            # the `gw-pois-pin` circle layer can render one marker per POI
            # (filtering on geometry-type = Point) instead of one per vertex
            # of the polygon. Same id/name/kind so hover hits route to the
            # same tooltip lookup.
            if kind == "poi":
                center = polygon_centroid(polygon)
                features.append(
                    {
                        "type": "Feature",
                        "properties": properties,
                        "geometry": {
                            "type": "Point",
                            "coordinates": center,
                        },
                    }
                )
                print(
                    f"      └ centroid pin @ ({center[0]:.5f}, {center[1]:.5f})",
                    file=sys.stderr,
                )

    return features


def main() -> int:
    if not KMZ_PATH.exists():
        print(f"error: KMZ not found at {KMZ_PATH}", file=sys.stderr)
        return 1

    features = build_features()
    # Hubs emit one Polygon each; POIs emit a Polygon plus a centroid Point.
    expected = len(HUB_SLUGS) + 2 * len(POI_SLUGS)
    if len(features) != expected:
        print(
            f"warning: emitted {len(features)} features but expected {expected} "
            f"({len(HUB_SLUGS)} hubs + {len(POI_SLUGS)} POI polygons + "
            f"{len(POI_SLUGS)} POI centroids)",
            file=sys.stderr,
        )

    collection = {"type": "FeatureCollection", "features": features}
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(collection, indent=2) + "\n")
    print(f"wrote {OUT_PATH.relative_to(ROOT)} ({len(features)} features)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
