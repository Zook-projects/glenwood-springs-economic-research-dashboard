// Placer.ai data emitted by scripts/build-placer.py. Five parallel metric
// files: four origin-flow files (Employee/Visitor × Counts/Visits) keyed
// inbound to the GWS anchors (81601, 81623), plus a shoppers-toplocations
// file aggregated from the resident-top-locations table (origin = resident
// ZIP, destination = out-of-market property ZIP — the only file with the
// flow axis flipped relative to the others).

import type { CorridorId } from './flow';

export type PlacerMetric =
  | 'employee-counts'
  | 'employee-visits'
  | 'visitor-counts'
  | 'visitor-visits'
  | 'shoppers-toplocations';

// pathId indexes the metric file's top-level `paths` table — the build
// script interns unique corridor paths so visitor-side metrics with 70k+
// rows collapse to <200 distinct path arrays. Legacy files (pre-routing)
// may omit `pathId`; the adapter falls back to a LODES OD-pair lookup in
// that case.
//
// Visitor metric files (visitor-counts / visitor-visits) also retain
// `originLat` / `originLng` per row so the client can plot origin
// symbols at the home centroid — visitor origins span the whole country
// and most don't appear in the local ZipMeta universe. Employee + shopper
// metrics drop these (their origins are valley ZIPs already in ZipMeta).
export interface PlacerRow {
  destZip: string;
  originZip: string;
  value: number;
  pathId?: number;
  originLat?: number;
  originLng?: number;
  // City + state of the origin (visitor metric files only). The client
  // aggregates origin symbols by `${originCity}, ${originState}` so a
  // major city like Dallas — spread across 20+ ZIPs — collapses to a
  // single bubble. Absent on every employee/shopper row and on legacy
  // visitor files predating the 2026-05 build.
  originCity?: string;
  originState?: string;
  // Shopper-metric fields (absent on every other metric). Each shopper
  // row is aggregated at (residentZip, destZip, category) granularity so
  // a single (resident, dest) pair can appear multiple times when its
  // visits span several venue categories.
  residents?: number;     // unique residents this row covers (used for /resident KPI)
  category?: string;      // group category — drives pie + category-rankings
  subCategory?: string;   // optional sample sub-category for tooltips
  propertySample?: string; // one representative property name for tooltips
}

// Shopper-only property point (heatmap source). One entry per unique
// address from Placer_resident_toplocations, aggregated across every
// resident ZIP that touches that address. Lat/lng populated by the
// Nominatim cache (scripts/geocode-properties.py) — null when the
// address hasn't been geocoded yet.
export interface ShopperProperty {
  address: string;
  property?: string | null;
  category: string;
  subCategory?: string | null;
  destZip: string;
  visits: number;
  residents: number;
  lat: number | null;
  lng: number | null;
}

export interface PlacerMetricFile {
  metric: PlacerMetric;
  label: string;
  source: 'Placer.ai';
  lastBuilt: string;          // ISO date the ETL last wrote this file
  // Data vintage from the workbook's Year column (e.g., 2025). Distinct
  // from `lastBuilt` — that's when the ETL ran. Optional on legacy files.
  dataYear?: number;
  destAnchors: string[];      // destination ZIPs covered by the workbook
  // Unique corridor paths used by rows in this metric. rows[i].pathId
  // indexes this array. Legacy files (pre-routing) omit `paths`.
  paths?: CorridorId[][];
  rows: PlacerRow[];
  // Shopper-only — list of property points used by the Heatmap view.
  // Absent on every non-shopper file.
  properties?: ShopperProperty[];
}

export interface PlacerSummary {
  lastBuilt: string;
  // Data vintage from the workbook (mirrors PlacerMetricFile.dataYear).
  // Optional on legacy summary files.
  dataYear?: number;
  destAnchors: string[];
  metrics: Record<PlacerMetric, { label: string; rowCount: number }>;
}

export interface PlacerData {
  employeeCounts: PlacerMetricFile;
  employeeVisits: PlacerMetricFile;
  visitorCounts: PlacerMetricFile;
  visitorVisits: PlacerMetricFile;
  // Resident → out-of-market shopping destinations. destAnchors here lists
  // the 11 valley resident ZIPs treated as ORIGINS (focal-anchor selection
  // for this metric), not destinations as in the four files above.
  shoppersTopLocations: PlacerMetricFile;
  summary: PlacerSummary;
}
