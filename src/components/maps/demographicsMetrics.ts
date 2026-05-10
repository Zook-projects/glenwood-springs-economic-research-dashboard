// demographicsMetrics — single source of truth for which demographic metrics
// the Demographics map exposes. Each entry knows how to extract its value
// from a context entry's `latest` block, how to format the value for display,
// and (for percentage-derived metrics) which fields it composites from.

import type { ContextLatest } from '../../types/context';

export type DemographicsMetricId =
  | 'population'
  | 'medianHhIncome'
  | 'medianAge'
  | 'pctUnder18'
  | 'pct65plus'
  | 'pctHispanic'
  | 'pctFamilyHh';

export interface DemographicsMetric {
  id: DemographicsMetricId;
  label: string;
  shortLabel: string;
  // Sublabel shown beneath the value in KPI cards (e.g. units, denominator).
  unitSuffix?: string;
  format: (v: number | null | undefined) => string;
  // Derive metric value from a place/county/state's `latest` object.
  // Returns null if any required field is missing.
  extract: (latest: ContextLatest | null) => number | null;
}

const fmtInt = (v: number | null | undefined) =>
  v == null ? '—' : Math.round(v).toLocaleString();
const fmtPct = (v: number | null | undefined) =>
  v == null ? '—' : `${(v * 100).toFixed(1)}%`;
const fmtMoney = (v: number | null | undefined) =>
  v == null ? '—' : `$${Math.round(v).toLocaleString()}`;
const fmtDecimal = (v: number | null | undefined) =>
  v == null ? '—' : v.toFixed(1);

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function ratio(numerator: unknown, denominator: unknown): number | null {
  const n = num(numerator);
  const d = num(denominator);
  if (n == null || d == null || d === 0) return null;
  return n / d;
}

export const DEMOGRAPHICS_METRICS: ReadonlyArray<DemographicsMetric> = [
  {
    id: 'population',
    label: 'Population',
    shortLabel: 'Pop.',
    format: fmtInt,
    extract: (l) => num(l?.population),
  },
  {
    id: 'medianHhIncome',
    label: 'Median HH Income',
    shortLabel: 'Med. HH Inc.',
    format: fmtMoney,
    extract: (l) => num(l?.medianHhIncome),
  },
  {
    id: 'medianAge',
    label: 'Median Age',
    shortLabel: 'Med. Age',
    unitSuffix: 'yrs',
    format: fmtDecimal,
    extract: (l) => num(l?.medianAge),
  },
  {
    id: 'pctUnder18',
    label: 'Under 18',
    shortLabel: '<18 %',
    format: fmtPct,
    extract: (l) => ratio(l?.ageU18, l?.population),
  },
  {
    id: 'pct65plus',
    label: '65 +',
    shortLabel: '65+ %',
    format: fmtPct,
    extract: (l) => ratio(l?.age65plus, l?.population),
  },
  {
    id: 'pctHispanic',
    label: 'Hispanic',
    shortLabel: 'Hisp. %',
    format: fmtPct,
    extract: (l) => ratio(l?.hispanic, l?.population),
  },
  {
    id: 'pctFamilyHh',
    label: 'Family HH',
    shortLabel: 'Fam. HH %',
    format: fmtPct,
    extract: (l) => {
      const fam = num(l?.familyHh);
      const non = num(l?.nonFamilyHh);
      if (fam == null || non == null || fam + non === 0) return null;
      return fam / (fam + non);
    },
  },
];

export const DEMOGRAPHICS_METRIC_BY_ID: Record<DemographicsMetricId, DemographicsMetric> =
  DEMOGRAPHICS_METRICS.reduce(
    (acc, m) => {
      acc[m.id] = m;
      return acc;
    },
    {} as Record<DemographicsMetricId, DemographicsMetric>,
  );
