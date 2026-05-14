// Placer.ai zip-origin data emitted by scripts/build-placer.py.
// Four parallel metric files (Employee Counts, Employee Visits,
// Visitor Counts, Visitor Visits), each spanning the 11 destination
// anchors that make up the LODES corridor study area.

import type { CorridorId } from './flow';

export type PlacerMetric =
  | 'employee-counts'
  | 'employee-visits'
  | 'visitor-counts'
  | 'visitor-visits';

// pathId indexes the metric file's top-level `paths` table — the build
// script interns unique corridor paths so visitor-side metrics with 70k+
// rows collapse to <200 distinct path arrays. Legacy files (pre-routing)
// may omit `pathId`; the adapter falls back to a LODES OD-pair lookup in
// that case.
export interface PlacerRow {
  destZip: string;
  originZip: string;
  value: number;
  pathId?: number;
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
  summary: PlacerSummary;
}
