// Placer.ai zip-origin data emitted by scripts/build-placer.py.
// Four parallel metric files (Employee Counts, Employee Visits,
// Visitor Counts, Visitor Visits), each anchored on a small set of
// destination ZIPs (81601 / 81623 in the v1 workbook).

export type PlacerMetric =
  | 'employee-counts'
  | 'employee-visits'
  | 'visitor-counts'
  | 'visitor-visits';

export interface PlacerRow {
  destZip: string;
  originZip: string;
  value: number;
}

export interface PlacerMetricFile {
  metric: PlacerMetric;
  label: string;
  source: 'Placer.ai';
  lastBuilt: string;          // ISO date the ETL last wrote this file
  destAnchors: string[];      // destination ZIPs covered by the workbook
  rows: PlacerRow[];
}

export interface PlacerSummary {
  lastBuilt: string;
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
