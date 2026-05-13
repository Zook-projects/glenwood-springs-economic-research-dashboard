// demographicsMetrics — single source of truth for which demographic metrics
// the Demographics map exposes. Each entry knows how to extract its value
// from a context entry's `latest` block, how to format the value for display,
// and (for percentage-derived metrics) which fields it composites from.

import type { ContextLatest, ContextTrend } from '../../types/context';

export type DemographicsMetricId =
  | 'population'
  | 'population10yrPct'
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
  // Trend-key in the entity's `trend` block. When set, the map's trend card
  // reads `entity.trend[trendKey]` for this metric. When undefined OR the
  // resulting series is empty, the strip falls back to `trend.population`.
  trendKey?: string;
  // Optional alternative extractor that reads from the trend array instead
  // of the `latest` block. Used by composite metrics like Population 10-yr%
  // that need a multi-year computation, not a single point.
  extractFromTrend?: (trend: ContextTrend | null | undefined) => number | null;
}

const fmtInt = (v: number | null | undefined) =>
  v == null ? '—' : Math.round(v).toLocaleString();
const fmtPct = (v: number | null | undefined) =>
  v == null ? '—' : `${(v * 100).toFixed(1)}%`;
// Signed percent — preserves sign for 10-yr change metrics where negative
// growth is a real (and material) outcome.
const fmtPctSigned = (v: number | null | undefined) => {
  if (v == null) return '—';
  const abs = Math.abs(v * 100);
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${abs.toFixed(1)}%`;
};
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

// 10-year % change extractor. Reads `trend.population` (annual ACS 5-Year,
// 2010 → latest) and computes the percent change between the year-10-prior
// point and the latest point. Falls back to the widest available span if
// the desired 10-year offset isn't present (e.g., a series that starts in
// 2015 against a 2024 latest yields a 9-year change, which we still surface
// rather than going blank).
function pct10yrFromTrend(trend: ContextTrend | null | undefined): number | null {
  const series = trend?.population;
  if (!Array.isArray(series) || series.length < 2) return null;
  // Narrow to points with real numeric values so the rest of the function
  // can treat .value as guaranteed-number.
  const valid: { year: number; value: number }[] = [];
  for (const p of series) {
    if (p && typeof p.year === 'number' && typeof p.value === 'number') {
      valid.push({ year: p.year, value: p.value });
    }
  }
  if (valid.length < 2) return null;
  const latest = valid[valid.length - 1];
  // Default target window: 10 years prior to latest.
  const targetYear = latest.year - 10;
  // Prefer exact match, otherwise fall back to the oldest point on or
  // before the target year, otherwise the first point in the series.
  const candidate =
    valid.find((p) => p.year === targetYear) ??
    [...valid].reverse().find((p) => p.year <= targetYear) ??
    valid[0];
  if (!candidate || candidate.value === 0) return null;
  return (latest.value - candidate.value) / candidate.value;
}

export const DEMOGRAPHICS_METRICS: ReadonlyArray<DemographicsMetric> = [
  {
    id: 'population',
    label: 'Population',
    shortLabel: 'Population',
    format: fmtInt,
    extract: (l) => num(l?.population),
    trendKey: 'population',
  },
  {
    id: 'population10yrPct',
    label: 'Population 10 yr %',
    shortLabel: 'Pop. 10y %',
    format: fmtPctSigned,
    // Computed from the trend array; no single-year `latest` field exists.
    extract: () => null,
    extractFromTrend: pct10yrFromTrend,
    // Per spec, keep the default population trend chart even though the
    // metric value is a 10-yr % change.
    trendKey: 'population',
  },
  {
    id: 'medianHhIncome',
    label: 'Median HH Income',
    shortLabel: 'Med. HH Inc.',
    format: fmtMoney,
    extract: (l) => num(l?.medianHhIncome),
    trendKey: 'medianHhIncome',
  },
  {
    id: 'medianAge',
    label: 'Median Age',
    shortLabel: 'Med. Age',
    unitSuffix: 'yrs',
    format: fmtDecimal,
    extract: (l) => num(l?.medianAge),
    trendKey: 'medianAge',
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
