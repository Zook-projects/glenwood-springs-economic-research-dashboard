// GlenwoodPoisStrip — bottom strip for the POIs sub-view. Card 1 is the
// Local/Regional/Tourist pie; cards 2 + 3 swap by metric:
//   Visits        — Visit Trends by POI · Avg Daily Visits by DOW (POI
//                   source is monthly, so the DOW card surfaces an empty
//                   state explaining the gap).
//   Demographics  — Household Income · Household Size

import { useMemo, useState } from 'react';
import type {
  GlenwoodPoisFile,
  GlenwoodFeatureEntity,
} from '../../../types/placer-glenwood';
import { MiniTrendChart, type TrendSeries } from '../MiniTrendChart';
import { GlenwoodDistributionBar } from './GlenwoodDistributionBar';
import { GlenwoodVisitorTypePie } from './GlenwoodVisitorTypePie';
import { GlenwoodRankingCard, type RankingRow } from './GlenwoodRankingCard';
import {
  condenseIncomeBuckets,
  fmtCount,
  stripHouseholdSuffix,
  tiersFromZipRows,
  findLatestDate,
  timeframeWindows,
  sumInWindow,
  rollupMonthly,
  rollupAnnual,
  poiMonthlyFromOrigins,
  classifyZipTier,
  TIER_COLOR,
  POI_PALETTE as SERIES_PALETTE,
  type VisitorTier,
} from './glenwoodMetrics';

const TIER_YEAR = 2025;
import type { GlenwoodMetric } from './GlenwoodMetricToggle';
import type { GlenwoodTimeframe } from './GlenwoodTimeframeToggle';

const TIER_ORDER: VisitorTier[] = ['Local', 'Regional', 'Tourist'];

interface Props {
  file: GlenwoodPoisFile;
  selectedIds: Set<string>;
  onToggleId: (id: string) => void;
  metric: GlenwoodMetric;
  timeframe: GlenwoodTimeframe;
}

function aggregateBuckets(
  pois: GlenwoodFeatureEntity[],
  category: string,
  keyFilter: (k: string) => boolean,
  sortFn: (a: string, b: string) => number,
): { label: string; value: number }[] {
  let totalWeight = 0;
  const sum = new Map<string, number>();
  for (const p of pois) {
    const cat = (p.profile as Record<string, unknown>)[category];
    // Weight by POI_Zipcodes_Visits totals (more complete than the Visits
    // sheet), with a 1.0 floor so a POI with no origin data still
    // contributes to the demographic averages.
    const monthlyTotal = p.origins.reduce((acc, o) => acc + (o.visits ?? 0), 0) || 1;
    if (!cat || typeof cat !== 'object') continue;
    totalWeight += monthlyTotal;
    for (const [k, v] of Object.entries(cat as Record<string, number>)) {
      if (typeof v !== 'number' || !keyFilter(k)) continue;
      sum.set(k, (sum.get(k) ?? 0) + v * monthlyTotal);
    }
  }
  if (totalWeight === 0) return [];
  return Array.from(sum.entries())
    .sort((a, b) => sortFn(a[0], b[0]))
    .map(([k, v]) => ({ label: k.replace(/\$/g, ''), value: v / totalWeight }));
}

export function GlenwoodPoisStrip({
  file,
  selectedIds,
  onToggleId,
  metric,
  timeframe,
}: Props) {
  const [selectedTier, setSelectedTier] = useState<VisitorTier | null>(null);

  const visible = useMemo(
    () => (selectedIds.size === 0 ? file.pois : file.pois.filter((p) => selectedIds.has(p.id))),
    [file, selectedIds],
  );

  // Per-POI monthly visit time series, optionally narrowed to a single tier.
  // For months where Placer shipped a zip-level breakdown, origin sums are
  // the exact tier decomposition of monthlyVisits (they tally identically
  // — verified empirically). For months where the breakdown is missing
  // (Hanging Lake's low-volume winter months, Sunlight Mountain's
  // closed-resort summer months), we scale monthlyVisits by the year's
  // tier share so the trend line stays continuous instead of opening
  // gaps. Years with no origins at all fall back to the closest year's
  // share.
  const monthlyById = useMemo(() => {
    const m = new Map<string, { date: string; value: number }[]>();
    if (!selectedTier) {
      for (const p of file.pois) m.set(p.id, poiMonthlyFromOrigins(p));
      return m;
    }
    for (const p of file.pois) {
      // Origin tier sums and origin totals, keyed by month.
      const monthTierSum = new Map<string, number>();
      const monthOriginPresent = new Set<string>();
      const yearTotals = new Map<number, { tier: number; total: number }>();
      for (const o of p.origins) {
        const entry = yearTotals.get(o.year) ?? { tier: 0, total: 0 };
        entry.total += o.visits;
        const isTier = classifyZipTier(o.zip) === selectedTier;
        if (isTier) entry.tier += o.visits;
        yearTotals.set(o.year, entry);
        if (o.month) {
          monthOriginPresent.add(o.month);
          if (isTier) {
            monthTierSum.set(o.month, (monthTierSum.get(o.month) ?? 0) + o.visits);
          }
        }
      }
      const years = Array.from(yearTotals.keys()).sort();
      const shareForYear = (year: number): number => {
        const exact = yearTotals.get(year);
        if (exact && exact.total > 0) return exact.tier / exact.total;
        if (years.length === 0) return 0;
        let closest = years[0];
        let minDiff = Math.abs(year - closest);
        for (const y of years) {
          const diff = Math.abs(year - y);
          if (diff < minDiff) {
            minDiff = diff;
            closest = y;
          }
        }
        const c = yearTotals.get(closest)!;
        return c.total > 0 ? c.tier / c.total : 0;
      };
      const baseMonthly = poiMonthlyFromOrigins(p);
      const blended = baseMonthly.map((r) => {
        // Use the exact origin-derived tier sum when Placer shipped a
        // breakdown for this month; only fall back to the year-share
        // scaling when the breakdown is missing.
        if (monthOriginPresent.has(r.date)) {
          return { date: r.date, value: monthTierSum.get(r.date) ?? 0 };
        }
        const y = parseInt(r.date.slice(0, 4), 10);
        return { date: r.date, value: r.value * shareForYear(y) };
      });
      m.set(p.id, blended);
    }
    return m;
  }, [file, selectedTier]);

  // Anchor windows on the latest monthly date across all POIs so window
  // math stays stable when the user toggles POI chips.
  const latestDate = useMemo(() => {
    const all: { date: string }[] = [];
    for (const series of monthlyById.values()) all.push(...series);
    return findLatestDate(all);
  }, [monthlyById]);
  const tw = useMemo(
    () => (latestDate ? timeframeWindows(latestDate, timeframe) : null),
    [latestDate, timeframe],
  );

  const trendSeries: TrendSeries[] = useMemo(() => {
    if (!tw) return [];
    return visible.map((p, i) => {
      const rows = monthlyById.get(p.id) ?? [];
      const annualSource = tw.trendMonthFilter != null
        ? rows.filter(
            (r) => parseInt(r.date.slice(5, 7), 10) <= tw.trendMonthFilter!,
          )
        : rows;
      const rolled =
        tw.trendGranularity === 'annual'
          ? rollupAnnual(annualSource)
          : rollupMonthly(rows, tw.trendStart === 'all' ? undefined : tw.trendStart);
      const points = rolled.map((p) => {
        const [y, mo] = p.date.split('-').map(Number);
        return { year: y + (mo - 1) / 12, value: p.value };
      });
      return {
        key: p.id,
        label: p.name,
        color: SERIES_PALETTE[i % SERIES_PALETTE.length],
        points,
      };
    });
  }, [visible, monthlyById, tw]);

  // Per-tier YoY % series. For each (tier, period) we sum tier-resolved
  // visits across every visible POI, then divide current period by same
  // period prior year. For months where Placer shipped a zip-level
  // breakdown we use the exact origin tier sums; for months where the
  // breakdown is missing (Hanging Lake's low-volume winter months,
  // Sunlight's closed-resort summer months) we fall back to scaling
  // monthlyVisits by the year's tier share so the YoY chart doesn't
  // drop out for those POIs. Period granularity follows the active
  // timeframe:
  //   - Monthly mode → 13 monthly buckets (each compared to same month
  //                    prior year)
  //   - Annual mode  → annual buckets across full history
  //   - YTD mode     → annual buckets, prefiltered to Jan–latestMonth so
  //                    each year reports Jan-N YoY vs prior Jan-N
  const yoyTierSeries: TrendSeries[] = useMemo(() => {
    if (!tw) return [];

    // periodKey: "YYYY-MM" for monthly, "YYYY" for annual/ytd.
    const isMonthly = tw.trendGranularity === 'monthly';
    const periodOfMonth = (yyyymm: string) =>
      isMonthly ? yyyymm : yyyymm.slice(0, 4);
    const priorPeriod = (key: string) => {
      if (isMonthly) {
        const [y, m] = key.split('-').map(Number);
        return `${y - 1}-${String(m).padStart(2, '0')}`;
      }
      return String(parseInt(key, 10) - 1);
    };
    // For YTD mode, only count months <= trendMonthFilter when building
    // the annual buckets.
    const monthInYtd = (yyyymm: string) => {
      if (tw.trendMonthFilter == null) return true;
      const m = parseInt(yyyymm.slice(5, 7), 10);
      return m <= tw.trendMonthFilter;
    };
    // For monthly mode, narrow to the trendStart cutoff (so we don't pull
    // ancient history into the chart). Annual/YTD show full history.
    const inTrendWindow = (yyyymm: string) => {
      if (isMonthly) {
        if (tw.trendStart === 'all') return true;
        return `${yyyymm}-01` >= tw.trendStart;
      }
      return true;
    };

    // Build per-POI lookups: month→tier sums (where origins exist) and
    // year-share fallback (for months where they don't).
    type YearTiers = Record<VisitorTier, number> & { total: number };
    const poiLookups = visible.map((p) => {
      const monthTierSums = new Map<string, Record<VisitorTier, number>>();
      const monthOriginPresent = new Set<string>();
      const yearTotals = new Map<number, YearTiers>();
      for (const o of p.origins) {
        const entry: YearTiers = yearTotals.get(o.year) ?? {
          Local: 0,
          Regional: 0,
          Tourist: 0,
          total: 0,
        };
        const tier = classifyZipTier(o.zip);
        entry.total += o.visits;
        entry[tier] += o.visits;
        yearTotals.set(o.year, entry);
        if (o.month) {
          monthOriginPresent.add(o.month);
          const slot = monthTierSums.get(o.month) ?? {
            Local: 0,
            Regional: 0,
            Tourist: 0,
          };
          slot[tier] += o.visits;
          monthTierSums.set(o.month, slot);
        }
      }
      const years = Array.from(yearTotals.keys()).sort();
      const shareForYear = (year: number, tier: VisitorTier): number => {
        const exact = yearTotals.get(year);
        if (exact && exact.total > 0) return exact[tier] / exact.total;
        if (years.length === 0) return 0;
        let closest = years[0];
        let minDiff = Math.abs(year - closest);
        for (const y of years) {
          const diff = Math.abs(year - y);
          if (diff < minDiff) {
            minDiff = diff;
            closest = y;
          }
        }
        const c = yearTotals.get(closest)!;
        return c.total > 0 ? c[tier] / c.total : 0;
      };
      return { poi: p, monthOriginPresent, monthTierSums, shareForYear };
    });

    // periodKey → tier → visits, summed across visible POIs.
    const totals = new Map<string, Record<VisitorTier, number>>();
    const allTotals = new Map<string, Record<VisitorTier, number>>();
    for (const { poi, monthOriginPresent, monthTierSums, shareForYear } of poiLookups) {
      const baseMonthly = poiMonthlyFromOrigins(poi);
      for (const row of baseMonthly) {
        if (!row.date) continue;
        if (!monthInYtd(row.date)) continue;
        const key = periodOfMonth(row.date);
        if (!key) continue;
        const year = parseInt(row.date.slice(0, 4), 10);
        // Resolve tier counts for this month: use exact origin sums when
        // present, otherwise scale monthlyVisits by the year-share.
        const tierForRow: Record<VisitorTier, number> = monthOriginPresent.has(row.date)
          ? (monthTierSums.get(row.date) ?? { Local: 0, Regional: 0, Tourist: 0 })
          : {
              Local: row.value * shareForYear(year, 'Local'),
              Regional: row.value * shareForYear(year, 'Regional'),
              Tourist: row.value * shareForYear(year, 'Tourist'),
            };
        const all = allTotals.get(key) ?? { Local: 0, Regional: 0, Tourist: 0 };
        for (const tier of TIER_ORDER) all[tier] += tierForRow[tier];
        allTotals.set(key, all);
        if (!inTrendWindow(row.date)) continue;
        const cur = totals.get(key) ?? { Local: 0, Regional: 0, Tourist: 0 };
        for (const tier of TIER_ORDER) cur[tier] += tierForRow[tier];
        totals.set(key, cur);
      }
    }

    return TIER_ORDER.map((tier) => {
      const points = Array.from(totals.entries())
        .map(([key, cur]) => {
          const priorKey = priorPeriod(key);
          const prior = allTotals.get(priorKey);
          if (!prior || prior[tier] <= 0) return null;
          const pct = ((cur[tier] - prior[tier]) / prior[tier]) * 100;
          // Convert periodKey to decimal-year for the chart x-axis.
          let decYear: number;
          if (isMonthly) {
            const [y, m] = key.split('-').map(Number);
            decYear = y + (m - 1) / 12;
          } else {
            decYear = parseInt(key, 10);
          }
          return { year: decYear, value: pct };
        })
        .filter((p): p is { year: number; value: number } => p != null)
        .sort((a, b) => a.year - b.year);
      return {
        key: tier,
        label: tier,
        color: TIER_COLOR[tier],
        points,
      };
    });
  }, [visible, tw]);

  const tierSlices = useMemo(() => {
    // POI origins are monthly; sum each zip's TIER_YEAR visits across all
    // visible POIs.
    const rows: { zip: string; visits: number }[] = [];
    for (const p of visible) {
      const visitsByZip = new Map<string, number>();
      for (const o of p.origins) {
        if (o.year !== TIER_YEAR) continue;
        visitsByZip.set(o.zip, (visitsByZip.get(o.zip) ?? 0) + o.visits);
      }
      for (const [zip, visits] of visitsByZip) {
        rows.push({ zip, visits });
      }
    }
    return tiersFromZipRows(rows);
  }, [visible]);

  // 16-bucket income ladder → 5 condensed bins for the strip chart.
  const incomeBuckets = useMemo(
    () =>
      condenseIncomeBuckets(
        aggregateBuckets(
          visible,
          'Household Income',
          (k) => /\d+\s*K/.test(k),
          (a, b) => {
            const na = parseInt(a.match(/(\d+)\s*K/)?.[1] ?? '0', 10);
            const nb = parseInt(b.match(/(\d+)\s*K/)?.[1] ?? '0', 10);
            return na - nb;
          },
        ),
      ),
    [visible],
  );

  const hhSizeBuckets = useMemo(
    () =>
      aggregateBuckets(
        visible,
        'Household Size',
        () => true,
        (a, b) => {
          const na = parseInt(a, 10) || 0;
          const nb = parseInt(b, 10) || 0;
          return na - nb;
        },
      ).map((b) => ({ ...b, label: stripHouseholdSuffix(b.label) })),
    [visible],
  );

  const baseSelectionTag =
    selectedIds.size === 0 ? `All ${file.pois.length} POIs` : `${selectedIds.size} selected`;
  const selectionTag = selectedTier
    ? `${baseSelectionTag} · ${selectedTier}`
    : baseSelectionTag;

  // Bottom row is 3 columns in both modes:
  //   Visits        — Pie · Visit Trends by POI · YoY % by Tier
  //   Demographics  — Pie · Household Income · Household Size
  const gridCols = 'md:grid-cols-3';

  // Ranking rows: per-POI window total + per-POI YoY (window vs prior).
  // Computed off the FULL POI list; selection state is communicated via
  // the `dim` flag, matching the retail-hubs cross-filter pattern.
  const visitsRows: RankingRow[] = useMemo(() => {
    if (!tw) return [];
    return file.pois.map((p, i) => {
      const rows = monthlyById.get(p.id) ?? [];
      const value = sumInWindow(rows, tw.window);
      const prior = sumInWindow(rows, tw.prior);
      const yoyPct = prior > 0 ? ((value - prior) / prior) * 100 : null;
      return {
        key: p.id,
        label: p.name,
        color: SERIES_PALETTE[i % SERIES_PALETTE.length],
        value,
        yoyPct,
        dim: selectedIds.size > 0 && !selectedIds.has(p.id),
      };
    });
  }, [file, monthlyById, tw, selectedIds]);

  return (
    <div className="px-3 flex flex-col gap-2">
      {metric === 'visits' && tw && (
        <div className={`grid grid-cols-1 ${gridCols} gap-3`}>
          <div className="hidden md:block" />
          <div className="hidden md:block" />
          <div className="flex flex-col gap-2 min-w-0 pointer-events-auto">
            <GlenwoodRankingCard
              title="Visits per POI"
              subtitle={`${selectionTag} · ${tw.subtitle.split(' vs ')[0]}`}
              rows={visitsRows}
              valueFormat={fmtCount}
              sort="value-desc"
              selectedKeys={selectedIds}
              onRowClick={onToggleId}
            />
          </div>
        </div>
      )}

      <div
        className={`grid grid-cols-1 ${gridCols} gap-3 pointer-events-auto md:h-[260px]`}
      >
        <div className="glass rounded-md p-3 flex flex-col gap-2 min-h-[260px] md:min-h-0">
          <div
            className="text-[10px] font-semibold uppercase tracking-wider flex items-baseline justify-between"
            style={{ color: 'var(--text-dim)' }}
          >
            <span>Visits Breakdown</span>
            <span className="text-[9px]">{selectionTag}</span>
          </div>
          <GlenwoodVisitorTypePie
            slices={tierSlices.map((s) => ({
              key: s.tier,
              label: s.tier,
              color: TIER_COLOR[s.tier],
              value: s.visits,
              share: s.share,
            }))}
            selectedKeys={selectedTier ? new Set([selectedTier]) : null}
            onSelectKey={(key) => {
              const t = key as VisitorTier;
              setSelectedTier(selectedTier === t ? null : t);
            }}
          />
        </div>

        {metric === 'visits' ? (
          <>
            <div className="glass rounded-md p-3 flex flex-col gap-2 min-h-[260px] md:min-h-0">
              <div
                className="text-[10px] font-semibold uppercase tracking-wider flex items-baseline justify-between"
                style={{ color: 'var(--text-dim)' }}
              >
                <span>Visit Trends by POI</span>
                <span className="text-[9px]">
                  {selectionTag} · {timeframe === 'ytd' ? 'YTD' : timeframe === 'annual' ? 'Annual' : 'Monthly'}
                </span>
              </div>
              <div className="flex-1 min-h-0">
                <MiniTrendChart
                  series={trendSeries}
                  height="fill"
                  valueFormat={(v) => fmtCount(v)}
                  hideLegend
                  tooltipDateGranularity={tw?.trendGranularity ?? 'monthly'}
                />
              </div>
            </div>

            <div className="glass rounded-md p-3 flex flex-col gap-2 min-h-[260px] md:min-h-0">
              <div
                className="text-[10px] font-semibold uppercase tracking-wider flex items-baseline justify-between"
                style={{ color: 'var(--text-dim)' }}
              >
                <span>YoY Change by Tier</span>
                <span className="text-[9px]">
                  {selectionTag} · {timeframe === 'ytd' ? 'YTD' : timeframe === 'annual' ? 'Annual' : 'Monthly'}
                </span>
              </div>
              {/* Inline legend chips — matches the tier-color scheme of
                  the Visits Breakdown pie above so the user can read all
                  three series at a glance. */}
              <div className="flex gap-2 text-[10px]" style={{ color: 'var(--text-dim)' }}>
                {TIER_ORDER.map((t) => (
                  <span key={t} className="flex items-center gap-1">
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full"
                      style={{ background: TIER_COLOR[t] }}
                    />
                    {t}
                  </span>
                ))}
              </div>
              <div className="flex-1 min-h-0">
                <MiniTrendChart
                  series={yoyTierSeries}
                  height="fill"
                  yMin="auto"
                  valueFormat={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`}
                  hideLegend
                  highlightedKey={selectedTier}
                  tooltipDateGranularity={tw?.trendGranularity ?? 'monthly'}
                  zeroBaseline
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="glass rounded-md p-3 flex flex-col gap-2 min-h-[260px] md:min-h-0">
              <div
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--text-dim)' }}
              >
                Household Income
              </div>
              {incomeBuckets.length === 0 ? (
                <div
                  className="flex-1 min-h-0 flex items-center justify-center text-[10px]"
                  style={{ color: 'var(--text-dim)' }}
                >
                  No income buckets in selection.
                </div>
              ) : (
                <GlenwoodDistributionBar buckets={incomeBuckets} />
              )}
            </div>

            <div className="glass rounded-md p-3 flex flex-col gap-2 min-h-[260px] md:min-h-0">
              <div
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--text-dim)' }}
              >
                Household Size
              </div>
              {hhSizeBuckets.length === 0 ? (
                <div
                  className="flex-1 min-h-0 flex items-center justify-center text-[10px]"
                  style={{ color: 'var(--text-dim)' }}
                >
                  No household-size buckets in selection.
                </div>
              ) : (
                <GlenwoodDistributionBar buckets={hhSizeBuckets} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

