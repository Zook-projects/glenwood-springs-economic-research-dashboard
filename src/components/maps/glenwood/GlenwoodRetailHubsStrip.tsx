// GlenwoodRetailHubsStrip — bottom strip for the Retail Hubs sub-view.
// Card 1 is always a Visitor Type pie (Local/Regional/Tourist), cards 2 +
// 3 swap by metric:
//   Visits        — Visit Trends by Hub · Avg Daily Visits by DOW
//   Demographics  — Household Income · Household Size
//
// Two stacked ranking cards sit above the rightmost column (Visits per
// Hub, YoY Change per Hub). Clicking a ranking row toggles that hub in
// the parent selectedIds set — the same state as the chips in the left
// panel — so everything else (KPIs, trends, DOW, pie, demographics) re-
// renders consistently. The DOW chart in turn filters the ranking-card
// values by clicked weekday.

import { useMemo, useState } from 'react';
import type {
  GlenwoodHubsFile,
  GlenwoodFeatureEntity,
} from '../../../types/placer-glenwood';
import { MiniTrendChart, type TrendSeries } from '../MiniTrendChart';
import { GlenwoodDistributionBar } from './GlenwoodDistributionBar';
import { GlenwoodDayOfWeekChart } from './GlenwoodDayOfWeekChart';
import { GlenwoodVisitorTypePie } from './GlenwoodVisitorTypePie';
import { GlenwoodRankingCard, type RankingRow } from './GlenwoodRankingCard';
import {
  averageByDayOfWeek,
  condenseIncomeBuckets,
  fmtCount,
  profileScalar,
  stripHouseholdSuffix,
  tiersFromZipRows,
  findLatestDate,
  timeframeWindows,
  sumInWindow,
  rollupMonthly,
  rollupAnnual,
  yoyPctSeries,
  classifyZipTier,
  TIER_COLOR,
  HUB_PALETTE as SERIES_PALETTE,
  type VisitorTier,
} from './glenwoodMetrics';

const TIER_YEAR = 2025;
import type { GlenwoodMetric } from './GlenwoodMetricToggle';
import type { GlenwoodTimeframe } from './GlenwoodTimeframeToggle';

const STRIP_CARD_HEIGHT = 260;

function bracketSortKey(label: string): number {
  const m = label.match(/(\d+)\s*K/);
  return m ? parseInt(m[1], 10) : 0;
}
function isIncomeBucketKey(k: string): boolean {
  return /\d+\s*K/.test(k);
}

interface Props {
  file: GlenwoodHubsFile;
  selectedIds: Set<string>;
  onToggleId: (id: string) => void;
  metric: GlenwoodMetric;
  timeframe: GlenwoodTimeframe;
}

function aggregateBuckets(
  hubs: GlenwoodFeatureEntity[],
  category: string,
  keyFilter: (k: string) => boolean,
  sortFn: (a: string, b: string) => number,
): { label: string; value: number }[] {
  let totalWeight = 0;
  const sum = new Map<string, number>();
  for (const h of hubs) {
    const cat = (h.profile as Record<string, unknown>)[category];
    const pop = profileScalar(h.profile, '_population') ?? 0;
    if (!cat || typeof cat !== 'object' || pop === 0) continue;
    totalWeight += pop;
    for (const [k, v] of Object.entries(cat as Record<string, number>)) {
      if (typeof v !== 'number' || !keyFilter(k)) continue;
      sum.set(k, (sum.get(k) ?? 0) + v * pop);
    }
  }
  if (totalWeight === 0) return [];
  return Array.from(sum.entries())
    .sort((a, b) => sortFn(a[0], b[0]))
    .map(([k, v]) => ({ label: k.replace(/\$/g, ''), value: v / totalWeight }));
}

export function GlenwoodRetailHubsStrip({
  file,
  selectedIds,
  onToggleId,
  metric,
  timeframe,
}: Props) {
  const [dowFilter, setDowFilter] = useState<number | null>(null);
  const [selectedTier, setSelectedTier] = useState<VisitorTier | null>(null);

  const visible = useMemo(
    () => (selectedIds.size === 0 ? file.hubs : file.hubs.filter((h) => selectedIds.has(h.id))),
    [file, selectedIds],
  );

  // Per-hub visit time series, optionally narrowed to a single tier. When
  // no tier is selected, daily visits flow through unchanged. With a tier
  // selected, we scale each day's value by that year's tier share of the
  // hub's origins (the only tier-resolved source — origins are annual
  // per-zip, so true per-day tier counts don't exist). Years without
  // origin data fall back to the closest year's share so the full daily
  // series stays continuous instead of dropping out.
  const visitsById = useMemo(() => {
    const m = new Map<string, { date: string; value: number }[]>();
    if (!selectedTier) {
      for (const h of file.hubs) m.set(h.id, h.dailyVisits ?? []);
      return m;
    }
    for (const h of file.hubs) {
      const yearTotals = new Map<number, { tier: number; total: number }>();
      for (const o of h.origins) {
        const entry = yearTotals.get(o.year) ?? { tier: 0, total: 0 };
        entry.total += o.visits;
        if (classifyZipTier(o.zip) === selectedTier) entry.tier += o.visits;
        yearTotals.set(o.year, entry);
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
      const scaled = (h.dailyVisits ?? []).map((r) => {
        const y = parseInt(r.date.slice(0, 4), 10);
        return { date: r.date, value: r.value * shareForYear(y) };
      });
      m.set(h.id, scaled);
    }
    return m;
  }, [file, selectedTier]);

  // Anchor windows on the latest date present across all hubs (not just
  // selected ones) so the comparison range stays stable as the user toggles
  // hub chips on and off.
  const latestDate = useMemo(() => {
    const all = file.hubs.flatMap((h) => h.dailyVisits ?? []);
    return findLatestDate(all);
  }, [file]);
  const tw = useMemo(
    () => (latestDate ? timeframeWindows(latestDate, timeframe) : null),
    [latestDate, timeframe],
  );

  const trendSeries: TrendSeries[] = useMemo(() => {
    if (!tw) return [];
    return visible.map((h, i) => {
      const source = visitsById.get(h.id) ?? [];
      const rows = dowFilter != null
        ? source.filter(
            (r) => new Date(r.date + 'T00:00:00Z').getUTCDay() === dowFilter,
          )
        : source;
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
        key: h.id,
        label: h.name,
        color: SERIES_PALETTE[i % SERIES_PALETTE.length],
        points,
      };
    });
  }, [visible, visitsById, dowFilter, tw]);

  const tierSlices = useMemo(
    () =>
      tiersFromZipRows(
        visible.flatMap((h) =>
          h.origins
            .filter((o) => o.year === TIER_YEAR)
            .map((o) => ({ zip: o.zip, visits: o.visits })),
        ),
      ),
    [visible],
  );

  // Single-series YoY for the bottom card. Aggregates the per-hub series
  // (daily without a tier filter; monthly tier-filtered origins with one)
  // across every visible hub, then feeds the combined stream through
  // yoyPctSeries.
  const yoySeries: TrendSeries[] = useMemo(() => {
    if (!tw) return [];
    const rows = visible.flatMap((h) => visitsById.get(h.id) ?? []);
    return [
      {
        key: 'yoy',
        label: 'YoY',
        color: 'rgba(255,255,255,0.85)',
        points: yoyPctSeries(rows, tw),
      },
    ];
  }, [visible, visitsById, tw]);

  // 16-bucket income ladder → 5 condensed bins for the strip chart.
  const incomeBuckets = useMemo(
    () =>
      condenseIncomeBuckets(
        aggregateBuckets(
          visible,
          'Household Income',
          isIncomeBucketKey,
          (a, b) => bracketSortKey(a) - bracketSortKey(b),
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

  const dowBars = useMemo(() => {
    const rows = visible.flatMap((h) => h.dailyVisits ?? []);
    if (!tw) return averageByDayOfWeek(rows);
    return averageByDayOfWeek(rows, tw.window);
  }, [visible, tw]);

  const dowFromBarIndex = (i: number) => (i + 1) % 7;
  const selectedBarIndex =
    dowFilter == null ? null : [1, 2, 3, 4, 5, 6, 0].indexOf(dowFilter);

  const baseSelectionTag =
    selectedIds.size === 0 ? `All ${file.hubs.length} hubs` : `${selectedIds.size} selected`;
  const selectionTag = selectedTier
    ? `${baseSelectionTag} · ${selectedTier}`
    : baseSelectionTag;

  // Ranking rows: one row per hub, value = window total, yoyPct = signed %
  // (window vs prior). When a DOW bar is active, the window-total only
  // counts rows on that weekday — so the ranking responds to the cross-
  // filter from the DOW card too. Click selection lives in selectedIds.
  const visitsRows: RankingRow[] = useMemo(() => {
    if (!tw) return [];
    const filterDow = (date: string) =>
      dowFilter == null
        ? true
        : new Date(date + 'T00:00:00Z').getUTCDay() === dowFilter;
    return file.hubs.map((h, i) => {
      const rows = (visitsById.get(h.id) ?? []).filter((r) => filterDow(r.date));
      const value = sumInWindow(rows, tw.window);
      const prior = sumInWindow(rows, tw.prior);
      const yoyPct = prior > 0 ? ((value - prior) / prior) * 100 : null;
      return {
        key: h.id,
        label: h.name,
        color: SERIES_PALETTE[i % SERIES_PALETTE.length],
        value,
        yoyPct,
        dim: selectedIds.size > 0 && !selectedIds.has(h.id),
      };
    });
  }, [file, visitsById, tw, selectedIds, dowFilter]);

  return (
    <div className="px-3 flex flex-col gap-2">
      {metric === 'visits' && tw && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="hidden md:block" />
          <div className="hidden md:block" />
          <div className="flex flex-col gap-2 min-w-0 pointer-events-auto">
            <GlenwoodRankingCard
              title="Visits per Hub"
              subtitle={`${selectionTag} · ${tw.subtitle.split(' vs ')[0]}`}
              rows={visitsRows}
              valueFormat={fmtCount}
              sort="value-desc"
              selectedKeys={selectedIds}
              onRowClick={onToggleId}
            />
            <div
              className="glass rounded-md p-3 flex flex-col gap-2 min-h-0"
              style={{ height: 170 }}
            >
              <div
                className="text-[10px] font-semibold uppercase tracking-wider flex items-baseline justify-between"
                style={{ color: 'var(--text-dim)' }}
              >
                <span>Avg Daily Visits · Day of Week</span>
                <span className="text-[9px]">
                  {tw?.subtitle
                    ? tw.subtitle.includes(' vs ')
                      ? tw.subtitle.split(' vs ')[0]
                      : tw.subtitle
                    : 'latest'}
                </span>
              </div>
              <GlenwoodDayOfWeekChart
                bars={dowBars}
                selectedDay={selectedBarIndex != null && selectedBarIndex >= 0 ? selectedBarIndex : null}
                onSelect={(barIdx) => {
                  if (barIdx == null) setDowFilter(null);
                  else setDowFilter(dowFromBarIndex(barIdx));
                }}
              />
            </div>
          </div>
        </div>
      )}

      <div
        className="grid grid-cols-1 md:grid-cols-3 gap-3 pointer-events-auto"
        style={{ height: STRIP_CARD_HEIGHT }}
      >
        <div className="glass rounded-md p-3 flex flex-col gap-2 min-h-0">
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
            <div className="glass rounded-md p-3 flex flex-col gap-2 min-h-0">
              <div
                className="text-[10px] font-semibold uppercase tracking-wider flex items-baseline justify-between"
                style={{ color: 'var(--text-dim)' }}
              >
                <span>Visit Trends by Hub</span>
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

            <div className="glass rounded-md p-3 flex flex-col gap-2 min-h-0">
              <div
                className="text-[10px] font-semibold uppercase tracking-wider flex items-baseline justify-between"
                style={{ color: 'var(--text-dim)' }}
              >
                <span>YoY Change</span>
                <span className="text-[9px]">
                  {selectionTag} · {timeframe === 'ytd' ? 'YTD' : timeframe === 'annual' ? 'Annual' : 'Monthly'}
                </span>
              </div>
              <div className="flex-1 min-h-0">
                <MiniTrendChart
                  series={yoySeries}
                  height="fill"
                  yMin="auto"
                  valueFormat={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`}
                  hideLegend
                  tooltipDateGranularity={tw?.trendGranularity ?? 'monthly'}
                  zeroBaseline
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="glass rounded-md p-3 flex flex-col gap-2 min-h-0">
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

            <div className="glass rounded-md p-3 flex flex-col gap-2 min-h-0">
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
