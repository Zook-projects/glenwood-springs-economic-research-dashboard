// glenwoodMetrics.ts — pure helpers for KPI extraction, daily-series
// aggregation, and profile-bucket transforms used across the three
// Glenwood sub-view strips.

import type {
  GlenwoodVisitationFile,
  GlenwoodFeatureEntity,
  GlenwoodHubsFile,
  GlenwoodPoisFile,
} from '../../../types/placer-glenwood';
import type { GlenwoodTimeframe } from './GlenwoodTimeframeToggle';

// Half-open date interval [startDate, endDate). Inputs are "YYYY-MM-DD"
// strings; comparisons rely on lexicographic ordering, which works as long
// as every date is zero-padded to 10 chars.
export interface DateWindow {
  startDate: string; // inclusive
  endDate: string;   // exclusive
}

export interface TimeframeWindows {
  // The window the user's data should aggregate over (KPIs, rankings, etc.).
  window: DateWindow;
  // Prior-year window used for YoY computation.
  prior: DateWindow;
  // For the trends chart only — start date of the series to plot.
  // 'all' means "no lower bound, plot every available point".
  trendStart: string | 'all';
  // Granularity for the trends chart: 'annual' rolls daily/monthly rows
  // into year buckets; 'monthly' plots monthly points.
  trendGranularity: 'annual' | 'monthly';
  // When set (YTD mode), restricts the annual trend rollup to rows whose
  // month-of-year is <= this number (1-12). Each year therefore contributes
  // a single Jan-through-N point so trend lines are apples-to-apples
  // across years.
  trendMonthFilter?: number;
  // Human-readable subtitle for ranking-card headers, describing the YoY
  // comparison ("Last 12 months vs prior 12 months", "Apr 2026 vs Apr 2025").
  subtitle: string;
}

// Locate the latest "YYYY-MM-DD" or "YYYY-MM" string in a rows array.
// Returns null when the array is empty.
export function findLatestDate(rows: { date: string }[]): string | null {
  let latest: string | null = null;
  for (const r of rows) {
    if (!r.date) continue;
    if (latest == null || r.date > latest) latest = r.date;
  }
  return latest;
}

// Add (positive) or subtract (negative) calendar months from a "YYYY-MM-DD"
// string, returning a new "YYYY-MM-DD" string. Day always normalizes to
// the 1st so window math is unambiguous.
function shiftMonth(yyyymmdd: string, deltaMonths: number): string {
  const y = parseInt(yyyymmdd.slice(0, 4), 10);
  const m = parseInt(yyyymmdd.slice(5, 7), 10) - 1; // 0..11
  const total = y * 12 + m + deltaMonths;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  return `${String(ny).padStart(4, '0')}-${String(nm + 1).padStart(2, '0')}-01`;
}

// Normalize any "YYYY-MM" or "YYYY-MM-DD" string to "YYYY-MM-01".
function toMonthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

// Build the windows + trends config for a given timeframe, anchored at the
// most-recently-reported month in the data.
export function timeframeWindows(
  latestDate: string,
  timeframe: GlenwoodTimeframe,
): TimeframeWindows {
  const monthStart = toMonthStart(latestDate);
  // End of latest month, expressed as the start of the next month so the
  // [startDate, endDate) half-open form catches every day in the latest
  // calendar month.
  const monthEnd = shiftMonth(monthStart, 1);

  if (timeframe === 'ytd') {
    const latestYear = parseInt(monthStart.slice(0, 4), 10);
    const latestMonth = parseInt(monthStart.slice(5, 7), 10); // 1..12
    const ytdStart = `${latestYear}-01-01`;
    const priorYtdStart = `${latestYear - 1}-01-01`;
    // Prior YTD ends one year before the current YTD's exclusive end.
    const priorYtdEnd = shiftMonth(monthEnd, -12);
    const monthLabel = new Date(latestYear, latestMonth - 1, 1)
      .toLocaleString('en-US', { month: 'short' });
    return {
      window: { startDate: ytdStart, endDate: monthEnd },
      prior: { startDate: priorYtdStart, endDate: priorYtdEnd },
      trendStart: 'all',
      trendGranularity: 'annual',
      trendMonthFilter: latestMonth,
      subtitle: `Jan–${monthLabel} ${latestYear} vs Jan–${monthLabel} ${latestYear - 1}`,
    };
  }

  if (timeframe === 'monthly') {
    const priorStart = shiftMonth(monthStart, -12);
    const priorEnd = shiftMonth(monthEnd, -12);
    // Trends: trailing 13 months ending at the latest reported month —
    // i.e. one full year of comparison plus the latest month itself. This
    // gives the chart a stable rolling-window shape regardless of where in
    // the calendar the data lands.
    const trendStart = shiftMonth(monthStart, -12);
    const monthLabel = new Date(
      parseInt(monthStart.slice(0, 4), 10),
      parseInt(monthStart.slice(5, 7), 10) - 1,
      1,
    );
    const priorLabel = new Date(monthLabel);
    priorLabel.setFullYear(priorLabel.getFullYear() - 1);
    const fmt = (d: Date) =>
      d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
    return {
      window: { startDate: monthStart, endDate: monthEnd },
      prior: { startDate: priorStart, endDate: priorEnd },
      trendStart,
      trendGranularity: 'monthly',
      subtitle: `${fmt(monthLabel)} vs ${fmt(priorLabel)}`,
    };
  }

  // Annual mode — trailing 12 months window, prior 12 months for YoY.
  const last12Start = shiftMonth(monthEnd, -12);
  const prior12Start = shiftMonth(last12Start, -12);
  return {
    window: { startDate: last12Start, endDate: monthEnd },
    prior: { startDate: prior12Start, endDate: last12Start },
    trendStart: 'all',
    trendGranularity: 'annual',
    subtitle: 'Last 12 mo.',
  };
}

// Pad a row date to the canonical "YYYY-MM-DD" form. The Placer.ai POI
// feed exports months as "YYYY-MM" (7 chars), but window boundaries are
// always "YYYY-MM-DD" — without padding, a lexicographic comparison
// treats "2025-12" as less than "2025-12-01" and the row gets excluded
// from a Dec-2025 window. Daily rows are already 10 chars and pass
// through unchanged.
export function normalizeRowDate(date: string): string {
  return date.length === 7 ? `${date}-01` : date;
}

// Sum the value of every row whose date falls in [window.startDate,
// window.endDate). Row dates are normalized to "YYYY-MM-DD" so monthly-
// grain feeds compare against the day-grain boundaries cleanly.
export function sumInWindow(
  rows: { date: string; value: number }[],
  window: DateWindow,
): number {
  let total = 0;
  for (const r of rows) {
    const d = normalizeRowDate(r.date);
    if (d >= window.startDate && d < window.endDate) {
      total += r.value;
    }
  }
  return total;
}

// Signed YoY percent for two windows. Returns null when the prior window
// has zero or negative volume (can't divide).
export function yoyPct(
  rows: { date: string; value: number }[],
  window: DateWindow,
  prior: DateWindow,
): number | null {
  const cur = sumInWindow(rows, window);
  const prev = sumInWindow(rows, prior);
  if (prev <= 0) return null;
  return ((cur - prev) / prev) * 100;
}

// Roll daily rows into per-year buckets. Year extracted as the first 4
// chars of `date` (works for "YYYY-MM-DD" and "YYYY-MM").
export function rollupAnnual(
  rows: { date: string; value: number }[],
  startDate?: string,
  endDate?: string,
): { date: string; value: number }[] {
  const sums = new Map<string, number>();
  for (const r of rows) {
    const d = normalizeRowDate(r.date);
    if (startDate && d < startDate) continue;
    if (endDate && d >= endDate) continue;
    const y = d.slice(0, 4);
    sums.set(y, (sums.get(y) ?? 0) + r.value);
  }
  return Array.from(sums.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([y, value]) => ({ date: `${y}-01-01`, value }));
}

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

// Tier palette shared by every consumer of VisitorTier (pie wedges, YoY
// chart legend, etc.). White-gradient — brightest = nearest tier (Local).
export const TIER_COLOR: Record<VisitorTier, string> = {
  Local: 'rgba(255,255,255,1)',
  Regional: 'rgba(255,255,255,0.72)',
  Tourist: 'rgba(255,255,255,0.46)',
};

// Per-entity palette assigned by position in the data file. Hubs and POIs
// each have their own ordering (first two colors swapped) so that the
// two strips don't share a leading color when shown side-by-side. Map
// boundaries pick up the same color when a hub/POI is selected, keeping
// the map and the ranking-card legends in lockstep.
export const HUB_PALETTE = [
  '#86b3ee', '#FFB454', '#6dd182', '#b794f4', '#f06292',
  '#4dd0e1', '#ffd54f', '#a1887f',
];
export const POI_PALETTE = [
  '#FFB454', '#86b3ee', '#6dd182', '#b794f4', '#f06292',
  '#4dd0e1', '#ffd54f', '#a1887f',
];

// Strip the trailing "Household" / "Households" from a Household Size
// bucket label. The Placer feed ships labels like "1 Person Household"
// and "7+ Persons Household"; we surface them as "1 Person" / "7+
// Persons" to keep the strip charts compact.
export function stripHouseholdSuffix(label: string): string {
  return label.replace(/\s*Households?$/i, '').trim();
}

// Parse the LOWER bound (in dollars) of an income bucket label.
//   "<$10K" / "10K or less"      → 0
//   "$10K - $15K" / "10K - 15K"  → 10000
//   "$60K - $75K"                → 60000
//   ">$200K" / "200K or more"    → 200000
function parseIncomeLow(label: string): number {
  if (/or\s*less/i.test(label)) return 0;
  if (/^\s*<\s*\$?/.test(label)) return 0;
  const orMore = /(\d+)\s*K\s*or\s*more/i.exec(label);
  if (orMore) return parseInt(orMore[1], 10) * 1000;
  const gt = /^\s*>\s*\$?(\d+)\s*K/i.exec(label);
  if (gt) return parseInt(gt[1], 10) * 1000;
  const range = /\$?(\d+)\s*K\s*[-–]\s*\$?(\d+)\s*K/i.exec(label);
  if (range) return parseInt(range[1], 10) * 1000;
  const single = /\$?(\d+)\s*K/i.exec(label);
  if (single) return parseInt(single[1], 10) * 1000;
  return Number.POSITIVE_INFINITY;
}

// Condense the 16-bucket Placer income ladder into 5 readable bins. The
// Demographics-mode distribution bars get crowded at 16 rows — these
// coarser groupings still preserve the long-tail shape (high-income
// concentration in mountain-town visitor profiles) while staying
// legible at strip-card height.
const INCOME_BINS: { label: string; max: number }[] = [
  { label: '< $25K', max: 25000 },
  { label: '$25K - $50K', max: 50000 },
  { label: '$50K - $100K', max: 100000 },
  { label: '$100K - $150K', max: 150000 },
  { label: '$150K+', max: Number.POSITIVE_INFINITY },
];

export function condenseIncomeBuckets(
  buckets: { label: string; value: number }[],
): { label: string; value: number }[] {
  const sums = new Array<number>(INCOME_BINS.length).fill(0);
  for (const b of buckets) {
    const low = parseIncomeLow(b.label);
    const idx = INCOME_BINS.findIndex((g) => low < g.max);
    if (idx >= 0) sums[idx] += b.value;
  }
  return INCOME_BINS.map((g, i) => ({ label: g.label, value: sums[i] }));
}

// Classify a single zip into a visitor tier. Same rules as
// tiersFromZipRows aggregation — kept as a standalone helper so per-row
// transforms (e.g. building per-tier monthly YoY series from origins)
// can avoid re-aggregating per call.
export function classifyZipTier(zip: string): VisitorTier {
  if (LOCAL_ZIPS.has(zip)) return 'Local';
  if (REGIONAL_ZIPS.has(zip)) return 'Regional';
  return 'Tourist';
}

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

// Resolve a POI's monthly visit time series. The build script populates
// `monthlyVisits` from the POI_Zipcodes_Visits sheet — merging zip-level
// row sums with POI-level summary rows (for months Placer didn't ship a
// zip breakdown). Falling back to summing `origins` would re-introduce
// those summary-row gaps, so callers should prefer `monthlyVisits`.
export function poiMonthlyFromOrigins(
  p: GlenwoodFeatureEntity,
): { date: string; value: number }[] {
  if (p.monthlyVisits && p.monthlyVisits.length) return p.monthlyVisits;
  // Defensive fallback for entities missing the canonical field.
  const sums = new Map<string, number>();
  for (const o of p.origins) {
    if (!o.month) continue;
    sums.set(o.month, (sums.get(o.month) ?? 0) + o.visits);
  }
  return Array.from(sums.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, value]) => ({ date: month, value }));
}

// Sum daily-visit rows over the most recent N years (default = full series).
export function totalVisits(rows: { date: string; value: number }[], yearFilter?: number): number {
  if (yearFilter == null) {
    return rows.reduce((acc, r) => acc + r.value, 0);
  }
  const tag = String(yearFilter);
  return rows.reduce((acc, r) => (r.date.startsWith(tag) ? acc + r.value : acc), 0);
}

// Same as totalVisits, but driven by an explicit half-open date window
// instead of a year tag. Used by the timeframe-aware code paths.
export function totalVisitsInWindow(
  rows: { date: string; value: number }[],
  window: DateWindow,
): number {
  return sumInWindow(rows, window);
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
  filter?: number | DateWindow,
): { day: string; value: number }[] {
  // Backwards-compat: a number filter is treated as a year tag (legacy
  // call sites in glenwoodMetrics that haven't migrated to windowed
  // mode). A DateWindow filter takes precedence when supplied.
  const tag = typeof filter === 'number' ? String(filter) : null;
  const window = filter && typeof filter === 'object' ? (filter as DateWindow) : null;
  const dailyTotal = new Map<string, number>();
  for (const r of rows) {
    const d = normalizeRowDate(r.date);
    if (tag && !d.startsWith(tag)) continue;
    if (window && !(d >= window.startDate && d < window.endDate)) continue;
    dailyTotal.set(d, (dailyTotal.get(d) ?? 0) + r.value);
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

// Single-series YoY percent points for a flat row stream. Each input row
// is summed into a period bucket (monthly or annual depending on
// tw.trendGranularity), then divided by the same period in the prior year.
// Returns one point per period whose prior-period total is > 0, with the
// x value encoded as the decimal year MiniTrendChart consumes.
//
// Honors tw.trendMonthFilter (so YTD mode reports each year's Jan–N as a
// single annual point) and tw.trendStart (so monthly mode only emits
// points within the display window — the prior lookback ignores this
// cutoff so YoY can still resolve at the edge of the window).
export function yoyPctSeries(
  rows: { date: string; value: number }[],
  tw: TimeframeWindows,
): { year: number; value: number }[] {
  const isMonthly = tw.trendGranularity === 'monthly';
  const periodOf = (d: string) => (isMonthly ? d.slice(0, 7) : d.slice(0, 4));

  const monthInYtd = (d: string) => {
    if (tw.trendMonthFilter == null) return true;
    const m = parseInt(d.slice(5, 7), 10);
    return m <= tw.trendMonthFilter;
  };
  const inTrendWindow = (d: string) => {
    if (!isMonthly) return true;
    if (tw.trendStart === 'all') return true;
    return d >= tw.trendStart;
  };

  const totals = new Map<string, number>();
  const allTotals = new Map<string, number>();
  for (const r of rows) {
    const d = normalizeRowDate(r.date);
    if (!monthInYtd(d)) continue;
    const key = periodOf(d);
    allTotals.set(key, (allTotals.get(key) ?? 0) + r.value);
    if (inTrendWindow(d)) {
      totals.set(key, (totals.get(key) ?? 0) + r.value);
    }
  }

  const points: { year: number; value: number }[] = [];
  for (const key of Array.from(totals.keys()).sort()) {
    const cur = totals.get(key)!;
    let priorKey: string;
    if (isMonthly) {
      const [y, m] = key.split('-').map(Number);
      priorKey = `${y - 1}-${String(m).padStart(2, '0')}`;
    } else {
      priorKey = String(parseInt(key, 10) - 1);
    }
    const prior = allTotals.get(priorKey) ?? 0;
    if (prior <= 0) continue;
    const pct = ((cur - prior) / prior) * 100;
    let decYear: number;
    if (isMonthly) {
      const [y, m] = key.split('-').map(Number);
      decYear = y + (m - 1) / 12;
    } else {
      decYear = parseInt(key, 10);
    }
    points.push({ year: decYear, value: pct });
  }
  return points;
}

// Roll daily rows up into monthly buckets. Used as data input for the
// MiniTrendChart (which doesn't need year resolution but does need a
// pluggable date range — monthly keeps the line readable across 12-24
// months of data).
export function rollupMonthly(
  rows: { date: string; value: number }[],
  startDate?: string,
  endDate?: string,
): { date: string; value: number }[] {
  const sums = new Map<string, number>();
  for (const r of rows) {
    const d = normalizeRowDate(r.date);
    if (startDate && d < startDate) continue;
    if (endDate && d >= endDate) continue;
    const month = d.slice(0, 7);
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
  window?: DateWindow,
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
    // POIs: prefer origins-derived monthly visits (POI_Zipcodes_Visits) so
    // window math captures the latest months. Hubs / city-wide already
    // have daily series.
    const daily =
      f.dailyVisits ??
      (f.monthlyVisits != null && f.origins.length === 0
        ? f.monthlyVisits
        : poiMonthlyFromOrigins(f));
    const fTotal = window
      ? sumInWindow(daily, window)
      : daily.reduce((acc, r) => acc + r.value, 0);
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

// Visitation KPIs from the city-wide bundle. When `window` is supplied, the
// Total Visits + Out-of-market visitors values are recomputed from
// dailyVisits within that window (rather than reading the annual metric
// record), which is necessary in Monthly timeframe mode where only a single
// month of data is in scope.
export function visitationKpis(
  file: GlenwoodVisitationFile,
  year: number,
  window?: DateWindow,
  sublabel?: string,
): GlenwoodKpi[] {
  const annual = file.annualMetrics.find((m) => m.year === year) ?? file.annualMetrics[file.annualMetrics.length - 1];
  const totalLabelYear = annual?.year ?? '—';

  // Total Visits sums every category row per date (Residents + Inbound
  // Commuters + Out-of-Market Visitors). Previously this excluded Inbound
  // Commuters; the chart's Avg Daily Visits default now uses the same
  // byType-summed total, so the KPI matches.
  const totalVisitsValue = window
    ? sumInWindow(
        file.dailyVisits.byType.map((r) => ({ date: r.date, value: r.value })),
        window,
      )
    : totalVisits(
        file.dailyVisits.byType.map((r) => ({ date: r.date, value: r.value })),
        annual?.year,
      );
  const visitorsValue = window
    ? sumInWindow(
        file.dailyVisits.byType
          .filter((r) => r.type === 'Out-of-Market Visitors')
          .map((r) => ({ date: r.date, value: r.value })),
        window,
      )
    : (annual?.outOfMarketVisitors ?? 0);

  const med = file.visitorProfile['_medianIncome'];
  const totalSublabel = sublabel ?? String(totalLabelYear);
  // The dedicated "Out-of-market Visitors" KPI was removed by user request —
  // the same number is implicit in the Visits Breakdown pie (Tourist slice)
  // and the Category section of the ranking card.
  void visitorsValue;
  // New KPIs default to the 'All' distance entry; the left panel overrides
  // them with the active distance/overnight band when a cross-filter is set.
  const daysAll = file.daysInMarketByDistance?.['All'];
  const familyAll = file.familyHouseholdsPctByDistance?.['All'];
  return [
    { label: 'Visitor Median Income', value: med ? fmtCurrency(med) : '—' },
    { label: 'Household Size', value: '2.6', sublabel: 'Avg (calc)' },
    { label: 'Total Visits', value: fmtCount(totalVisitsValue), sublabel: totalSublabel },
    {
      label: 'Median Stay',
      value: annual?.medianDailyTimeMinutes != null ? `${annual.medianDailyTimeMinutes} min` : '—',
    },
    {
      label: 'Avg Days in Market',
      value: daysAll != null ? `${fmtDecimal(daysAll, 1)} days` : '—',
      sublabel: daysAll != null ? `${totalLabelYear} · weighted` : undefined,
    },
    {
      label: 'Family HH',
      value: familyAll != null ? `${(familyAll * 100).toFixed(1)}%` : '—',
      sublabel: 'All distances',
    },
  ];
}

// Hub or POI KPIs from a selection-aware aggregate.
export function hubKpis(
  file: GlenwoodHubsFile,
  selectedIds: Set<string>,
  latestYear: string,
  window?: DateWindow,
): GlenwoodKpi[] {
  const agg = aggregateFeatures(file.hubs, selectedIds, latestYear, window);
  return featureKpis(agg, selectedIds.size, file.hubs.length, 'hubs');
}

export function poiKpis(
  file: GlenwoodPoisFile,
  selectedIds: Set<string>,
  latestYear: string,
  window?: DateWindow,
): GlenwoodKpi[] {
  const agg = aggregateFeatures(file.pois, selectedIds, latestYear, window);
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
