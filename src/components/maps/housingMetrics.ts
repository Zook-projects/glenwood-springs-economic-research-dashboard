// housingMetrics — single source of truth for which housing metrics the
// Housing map exposes. Some metrics (affordability ratio) cross-reference
// the demographics bundle for median HH income; those are computed at the
// call site by passing a paired demographics latest block.

import type { ContextLatest } from '../../types/context';

export type HousingMetricId =
  | 'zhvi'
  | 'medianHomeValueAcs'
  | 'medianGrossRent'
  | 'pctOwnerOccupied'
  | 'pctCostBurdened30'
  | 'vacancyPct'
  | 'totalHousingUnits'
  | 'medianStockAge';

export interface HousingMetric {
  id: HousingMetricId;
  label: string;
  shortLabel: string;
  format: (v: number | null | undefined) => string;
  extract: (latest: ContextLatest | null) => number | null;
}

const fmtInt = (v: number | null | undefined) =>
  v == null ? '—' : Math.round(v).toLocaleString();
const fmtPct = (v: number | null | undefined) =>
  v == null ? '—' : `${(v * 100).toFixed(1)}%`;
const fmtMoney = (v: number | null | undefined) =>
  v == null ? '—' : `$${Math.round(v).toLocaleString()}`;
const fmtMoneyK = (v: number | null | undefined) =>
  v == null
    ? '—'
    : v >= 1_000_000
    ? `$${(v / 1_000_000).toFixed(2)}M`
    : `$${Math.round(v / 1000)}k`;
const fmtDecimal = (v: number | null | undefined) =>
  v == null ? '—' : v.toFixed(1);

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function ratio(numerator: unknown, denominator: unknown): number | null {
  const n = num(numerator);
  const d = num(denominator);
  if (n == null || d == null || d === 0) return null;
  return n / d;
}

// Year-built cohort midpoints used for median-stock-age computation.
// Each value is the midpoint year of the cohort; for "Pre-1940" we use 1930
// as a reasonable lower-bound proxy.
const COHORT_MIDPOINTS: ReadonlyArray<{ field: string; midpoint: number }> = [
  { field: 'yearBuiltPre1940', midpoint: 1930 },
  { field: 'yearBuilt1940to49', midpoint: 1945 },
  { field: 'yearBuilt1950to59', midpoint: 1955 },
  { field: 'yearBuilt1960to69', midpoint: 1965 },
  { field: 'yearBuilt1970to79', midpoint: 1975 },
  { field: 'yearBuilt1980to89', midpoint: 1985 },
  { field: 'yearBuilt1990to99', midpoint: 1995 },
  { field: 'yearBuilt2000to09', midpoint: 2005 },
  { field: 'yearBuilt2010to19', midpoint: 2015 },
  { field: 'yearBuilt2020plus', midpoint: 2022 },
];

function medianStockAge(latest: ContextLatest | null, refYear = 2024): number | null {
  if (!latest) return null;
  let total = 0;
  const cohorts: Array<{ midpoint: number; units: number }> = [];
  for (const c of COHORT_MIDPOINTS) {
    const u = num(latest[c.field]);
    if (u == null) continue;
    cohorts.push({ midpoint: c.midpoint, units: u });
    total += u;
  }
  if (total === 0) return null;
  // Find the cohort containing the cumulative median (50th percentile).
  let cum = 0;
  for (const c of cohorts) {
    cum += c.units;
    if (cum >= total / 2) return refYear - c.midpoint;
  }
  return null;
}

export const HOUSING_METRICS: ReadonlyArray<HousingMetric> = [
  {
    id: 'zhvi',
    label: 'ZHVI (Zillow)',
    shortLabel: 'ZHVI',
    format: fmtMoneyK,
    extract: (l) => num(l?.zhvi),
  },
  {
    id: 'medianHomeValueAcs',
    label: 'Median Home Value',
    shortLabel: 'Med. Value',
    format: fmtMoneyK,
    extract: (l) => num(l?.medianHomeValueAcs),
  },
  {
    id: 'medianGrossRent',
    label: 'Median Rent',
    shortLabel: 'Med. Rent',
    format: fmtMoney,
    extract: (l) => num(l?.medianGrossRent),
  },
  {
    id: 'pctOwnerOccupied',
    label: 'Owner Occupied',
    shortLabel: 'Owner %',
    format: fmtPct,
    extract: (l) => {
      const own = num(l?.ownerOccupied);
      const rent = num(l?.renterOccupied);
      if (own == null || rent == null || own + rent === 0) return null;
      return own / (own + rent);
    },
  },
  {
    id: 'pctCostBurdened30',
    label: 'Cost Burdened',
    shortLabel: 'Burden %',
    format: fmtPct,
    extract: (l) => ratio(l?.costBurden30, sumOwnerRenter(l)),
  },
  {
    id: 'vacancyPct',
    label: 'Vacancy Rate',
    shortLabel: 'Vacancy',
    format: (v) => (v == null ? '—' : `${v.toFixed(1)}%`),
    extract: (l) => num(l?.vacancyPct),
  },
  {
    id: 'totalHousingUnits',
    label: 'Housing Units',
    shortLabel: 'Units',
    format: fmtInt,
    extract: (l) => num(l?.totalHousingUnits) ?? num(l?.housingUnitsTotal),
  },
  {
    id: 'medianStockAge',
    label: 'Median Stock Age',
    shortLabel: 'Stock Age',
    format: (v) => (v == null ? '—' : `${Math.round(v)} yrs`),
    extract: (l) => medianStockAge(l),
  },
];

function sumOwnerRenter(l: ContextLatest | null | undefined): number | null {
  const own = num(l?.ownerOccupied);
  const rent = num(l?.renterOccupied);
  if (own == null && rent == null) return null;
  return (own ?? 0) + (rent ?? 0);
}

export const HOUSING_METRIC_BY_ID: Record<HousingMetricId, HousingMetric> =
  HOUSING_METRICS.reduce(
    (acc, m) => {
      acc[m.id] = m;
      return acc;
    },
    {} as Record<HousingMetricId, HousingMetric>,
  );

// Helper: explicit decimal formatter export so views can format
// custom-derived values (affordability ratio etc.) consistently.
export { fmtDecimal };
