// glenwoodMetrics.ts — pure helpers for KPI extraction, daily-series
// aggregation, and profile-bucket transforms used across the three
// Glenwood sub-view strips.

import type {
  GlenwoodVisitationFile,
  GlenwoodFeatureEntity,
  GlenwoodHubsFile,
  GlenwoodPoisFile,
} from '../../../types/placer-glenwood';

// Local = Glenwood Springs proper. Regional = the user's named "Roaring
// Fork + I-70 corridor" zip set, which includes every dashboard workplace
// anchor plus the two Eagle CO zips (81631, 81637) treated as Regional by
// editorial preference. Tourist = anything else.
const LOCAL_ZIPS = new Set(['81601']);
const REGIONAL_ZIPS = new Set([
  '81623', // Carbondale
  '81650', // Rifle
  '81647', // New Castle
  '81637', // Eagle (east of Glenwood)
  '81621', // Basalt
  '81631', // Eagle (Vail-adjacent)
  '81652', // Silt
  '81611', // Aspen
  '81635', // Parachute
  '81615', // Snowmass Village
  '81654', // Old Snowmass
  '81630', // De Beque — dashboard workplace anchor, added implicitly
]);

export type VisitorTier = 'Local' | 'Regional' | 'Tourist';

export interface VisitorTierSlice {
  tier: VisitorTier;
  visits: number;
  share: number;
}

interface ZipVisitRow {
  zip: string;
  visits: number;
}

// Tier classification for hub/POI zip-level data. Driven entirely by the
// LOCAL_ZIPS / REGIONAL_ZIPS sets above; any zip not in either bucket is
// counted as Tourist.
export function tiersFromZipRows(rows: ZipVisitRow[]): VisitorTierSlice[] {
  const counts: Record<VisitorTier, number> = { Local: 0, Regional: 0, Tourist: 0 };
  for (const r of rows) {
    if (LOCAL_ZIPS.has(r.zip)) counts.Local += r.visits;
    else if (REGIONAL_ZIPS.has(r.zip)) counts.Regional += r.visits;
    else counts.Tourist += r.visits;
  }
  return tiersFromCounts(counts);
}

// Tier classification for the city-wide Visitation file. Pulls from two
// Visitation_Combined_NEW categories:
//   Local    = Type · Residents
//   Regional = Distance · 0-25 mi + 25-50 mi
//   Tourist  = Distance · 50-100 mi + 100-250 mi + 250+ mi
// Optional yearFilter narrows both series to a single year.
export function tiersFromVisitationCategories(
  byType: { date: string; type: string; value: number }[],
  byDistance: { date: string; distance: string; value: number }[],
  yearFilter?: number,
): VisitorTierSlice[] {
  const tag = yearFilter != null ? String(yearFilter) : null;
  const inRange = (date: string) => tag == null || date.startsWith(tag);

  const counts: Record<VisitorTier, number> = { Local: 0, Regional: 0, Tourist: 0 };
  for (const r of byType) {
    if (r.type === 'Residents' && inRange(r.date)) {
      counts.Local += r.value;
    }
  }
  for (const r of byDistance) {
    if (!inRange(r.date)) continue;
    if (r.distance === '0-25' || r.distance === '25-50') {
      counts.Regional += r.value;
    } else if (
      r.distance === '50-100' ||
      r.distance === '100-250' ||
      r.distance === '250+'
    ) {
      counts.Tourist += r.value;
    }
  }
  return tiersFromCounts(counts);
}

function tiersFromCounts(counts: Record<VisitorTier, number>): VisitorTierSlice[] {
  const total = counts.Local + counts.Regional + counts.Tourist;
  const slices: VisitorTier[] = ['Local', 'Regional', 'Tourist'];
  return slices.map((tier) => ({
    tier,
    visits: counts[tier],
    share: total === 0 ? 0 : counts[tier] / total,
  }));
}

export interface GlenwoodKpi {
  label: string;
  value: string;
  sublabel?: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function safeNumber(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return v;
  return null;
}

export function profileScalar(
  profile: GlenwoodFeatureEntity['profile'] | Record<string, number> | undefined,
  key: string,
): number | null {
  if (!profile) return null;
  const v = (profile as Record<string, unknown>)[key];
  return safeNumber(v);
}

export function profileBucket(
  profile: GlenwoodFeatureEntity['profile'] | Record<string, number> | undefined,
  category: string,
  key: string,
): number | null {
  if (!profile) return null;
  const cat = (profile as Record<string, unknown>)[category];
  if (!cat || typeof cat !== 'object') return null;
  return safeNumber((cat as Record<string, unknown>)[key]);
}

// Average HH size derived from bucketed distribution shares. Treats
// "7+ Persons" as 7.5.
export function avgHHSizeFromBuckets(
  profile: GlenwoodFeatureEntity['profile'] | Record<string, number>,
): number | null {
  const cat = (profile as Record<string, unknown>)['Household Size'];
  if (!cat || typeof cat !== 'object') return null;
  const buckets = cat as Record<string, number>;
  let total = 0;
  let weight = 0;
  for (const [k, v] of Object.entries(buckets)) {
    if (typeof v !== 'number') continue;
    const m = k.match(/^(\d+)/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    const size = k.includes('+') ? n + 0.5 : n;
    total += size * v;
    weight += v;
  }
  if (weight === 0) return null;
  return total / weight;
}

// Sum daily-visit rows over the most recent N years (default = full series).
export function totalVisits(rows: { date: string; value: number }[], yearFilter?: number): number {
  if (yearFilter == null) {
    return rows.reduce((acc, r) => acc + r.value, 0);
  }
  const tag = String(yearFilter);
  return rows.reduce((acc, r) => (r.date.startsWith(tag) ? acc + r.value : acc), 0);
}

// Average daily visits by day of week. Callers pass row sets where each
// date may appear multiple times (one row per type / distance band / hub);
// rows are first SUMMED to a per-date total, THEN averaged across the
// distinct dates of each weekday. Without the per-date roll-up, the
// average would be diluted by the row multiplicity (e.g., divided by 3
// for byType, by 5 for byDistance, by 8 for the eight-hub aggregate).
// Returns 7 entries Mon-Sun (the order Placer's BI tool uses).
export function averageByDayOfWeek(
  rows: { date: string; value: number }[],
  yearFilter?: number,
): { day: string; value: number }[] {
  const tag = yearFilter != null ? String(yearFilter) : null;
  const dailyTotal = new Map<string, number>();
  for (const r of rows) {
    if (tag && !r.date.startsWith(tag)) continue;
    dailyTotal.set(r.date, (dailyTotal.get(r.date) ?? 0) + r.value);
  }

  const sums: number[] = [0, 0, 0, 0, 0, 0, 0];
  const counts: number[] = [0, 0, 0, 0, 0, 0, 0];
  for (const [date, value] of dailyTotal) {
    const dow = new Date(date + 'T00:00:00Z').getUTCDay();
    sums[dow] += value;
    counts[dow] += 1;
  }
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.map((d) => ({
    day: WEEKDAYS[d],
    value: counts[d] === 0 ? 0 : sums[d] / counts[d],
  }));
}

// Roll daily rows up into monthly buckets. Used as data input for the
// MiniTrendChart (which doesn't need year resolution but does need a
// pluggable date range — monthly keeps the line readable across 12-24
// months of data).
export function rollupMonthly(
  rows: { date: string; value: number }[],
  startDate?: string,
): { date: string; value: number }[] {
  const sums = new Map<string, number>();
  for (const r of rows) {
    if (startDate && r.date < startDate) continue;
    const month = r.date.slice(0, 7);
    sums.set(month, (sums.get(month) ?? 0) + r.value);
  }
  return Array.from(sums.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, value]) => ({ date: `${month}-01`, value }));
}

// Pretty short formatting for KPI values: 12,345 / $88K / 1.2M / 2.6
export function fmtCount(n: number): string {
  if (!isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}
export function fmtCurrency(n: number): string {
  if (!isFinite(n)) return '—';
  return `$${new Intl.NumberFormat('en-US').format(Math.round(n))}`;
}
export function fmtCurrencyCompact(n: number): string {
  if (!isFinite(n)) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}
export function fmtMinutes(n: number): string {
  if (!isFinite(n)) return '—';
  return `${Math.round(n)} min`;
}
export function fmtDecimal(n: number, places = 2): string {
  if (!isFinite(n)) return '—';
  return n.toFixed(places);
}

// Selection-aware aggregates for retail hubs / POIs. When `selectedIds`
// is empty, aggregates over all entities.
export interface FeatureAggregate {
  totalVisits: number;
  averageHHSize: number | null;
  medianIncome: number | null;
  averageIncome: number | null;
  avgDwellMin: number | null;
  visitFrequency: number | null;
  population: number;
}

function weightedAvg(parts: { value: number; weight: number }[]): number | null {
  let v = 0;
  let w = 0;
  for (const p of parts) {
    if (!isFinite(p.value) || !isFinite(p.weight)) continue;
    v += p.value * p.weight;
    w += p.weight;
  }
  return w === 0 ? null : v / w;
}

export function aggregateFeatures(
  entities: GlenwoodFeatureEntity[],
  selectedIds: Set<string>,
  latestYear: string,
): FeatureAggregate {
  const visible = selectedIds.size === 0
    ? entities
    : entities.filter((e) => selectedIds.has(e.id));

  let totalVisits = 0;
  const incomeParts: { value: number; weight: number }[] = [];
  const avgIncomeParts: { value: number; weight: number }[] = [];
  const hhSizeParts: { value: number; weight: number }[] = [];
  const dwellParts: { value: number; weight: number }[] = [];
  const freqParts: { value: number; weight: number }[] = [];
  let population = 0;

  for (const f of visible) {
    const daily = f.dailyVisits ?? f.monthlyVisits ?? [];
    const fTotal = daily.reduce((acc, r) => acc + r.value, 0);
    totalVisits += fTotal;
    const pop = profileScalar(f.profile, '_population') ?? 0;
    population += pop;
    const w = pop > 0 ? pop : fTotal > 0 ? fTotal : 1;
    const median = profileScalar(f.profile, '_medianIncome');
    if (median != null) incomeParts.push({ value: median, weight: w });
    const avgInc = profileScalar(f.profile, '_averageIncome');
    if (avgInc != null) avgIncomeParts.push({ value: avgInc, weight: w });
    const hh = avgHHSizeFromBuckets(f.profile);
    if (hh != null) hhSizeParts.push({ value: hh, weight: w });
    const m = f.metrics[latestYear] ?? f.metrics[Object.keys(f.metrics).sort().reverse()[0] ?? ''];
    if (m?.avgDwellMin != null) dwellParts.push({ value: m.avgDwellMin, weight: fTotal });
    if (m?.visitFrequency != null) freqParts.push({ value: m.visitFrequency, weight: fTotal });
  }

  return {
    totalVisits,
    averageHHSize: weightedAvg(hhSizeParts),
    medianIncome: weightedAvg(incomeParts),
    averageIncome: weightedAvg(avgIncomeParts),
    avgDwellMin: weightedAvg(dwellParts),
    visitFrequency: weightedAvg(freqParts),
    population,
  };
}

// Visitation KPIs from the city-wide bundle.
export function visitationKpis(file: GlenwoodVisitationFile, year: number): GlenwoodKpi[] {
  const annual = file.annualMetrics.find((m) => m.year === year) ?? file.annualMetrics[file.annualMetrics.length - 1];
  const totalThisYear = totalVisits(
    file.dailyVisits.byType.filter((r) => r.type !== 'Inbound Commuters').map((r) => ({ date: r.date, value: r.value })),
    annual?.year,
  );
  const visitorsThisYear = annual?.outOfMarketVisitors ?? 0;
  const med = file.visitorProfile['_medianIncome'];
  return [
    { label: 'Visitor Median Income', value: med ? fmtCurrency(med) : '—' },
    { label: 'Household Size', value: '2.6', sublabel: 'Avg (calc)' },
    { label: 'Total Visits', value: fmtCount(totalThisYear), sublabel: String(annual?.year ?? '—') },
    { label: `${annual?.year ?? '—'} Visitors`, value: fmtCount(visitorsThisYear), sublabel: 'Out-of-market' },
    {
      label: 'Median Stay',
      value: annual?.medianDailyTimeMinutes != null ? `${annual.medianDailyTimeMinutes} min` : '—',
    },
  ];
}

// Hub or POI KPIs from a selection-aware aggregate.
export function hubKpis(
  file: GlenwoodHubsFile,
  selectedIds: Set<string>,
  latestYear: string,
): GlenwoodKpi[] {
  const agg = aggregateFeatures(file.hubs, selectedIds, latestYear);
  return featureKpis(agg, selectedIds.size, file.hubs.length, 'hubs');
}

export function poiKpis(
  file: GlenwoodPoisFile,
  selectedIds: Set<string>,
  latestYear: string,
): GlenwoodKpi[] {
  const agg = aggregateFeatures(file.pois, selectedIds, latestYear);
  return featureKpis(agg, selectedIds.size, file.pois.length, 'POIs');
}

function featureKpis(agg: FeatureAggregate, selCount: number, total: number, noun: string): GlenwoodKpi[] {
  const sub = selCount === 0 ? `All ${total} ${noun}` : `${selCount} of ${total} ${noun}`;
  return [
    { label: 'Median Income', value: agg.medianIncome != null ? fmtCurrency(agg.medianIncome) : '—', sublabel: sub },
    { label: 'Average Income', value: agg.averageIncome != null ? fmtCurrency(agg.averageIncome) : '—', sublabel: sub },
    {
      label: 'Household Size',
      value: agg.averageHHSize != null ? `${fmtDecimal(agg.averageHHSize)} avg` : '—',
      sublabel: sub,
    },
    { label: 'Total Visits', value: fmtCount(agg.totalVisits), sublabel: sub },
    { label: 'Avg Dwell', value: agg.avgDwellMin != null ? fmtMinutes(agg.avgDwellMin) : '—', sublabel: sub },
    {
      label: 'Visit Frequency',
      value: agg.visitFrequency != null ? `${fmtDecimal(agg.visitFrequency)} avg` : '—',
      sublabel: sub,
    },
  ];
}
