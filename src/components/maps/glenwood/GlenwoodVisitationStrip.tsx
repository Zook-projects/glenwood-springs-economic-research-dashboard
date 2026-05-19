// GlenwoodVisitationStrip — bottom strip for the Visitation sub-view.
// Card 1 is the Visits Breakdown pie (always); cards 2 + 3 swap by metric.
// In Visits mode the bottom row shows Visit Trends and Avg Daily Visits
// by Day of Week. A 3-section ranking card sits above the rightmost
// column. The ranking card and the DOW chart act as two-way cross-filters:
//   - Clicking a ranking row narrows the trends + DOW + left-panel KPI.
//   - Clicking a DOW bar narrows the trends + ranking card.

import { useMemo, useState } from 'react';
import type { GlenwoodVisitationFile } from '../../../types/placer-glenwood';
import { MiniTrendChart, type TrendSeries } from '../MiniTrendChart';
import { GlenwoodDayOfWeekChart } from './GlenwoodDayOfWeekChart';
import { GlenwoodVisitorTypePie, type VisitorPieSlice } from './GlenwoodVisitorTypePie';
import { GlenwoodRankingCard, type RankingSection } from './GlenwoodRankingCard';
import { GlenwoodDistributionBar } from './GlenwoodDistributionBar';
import {
  averageByDayOfWeek,
  condenseIncomeBuckets,
  fmtCount,
  findLatestDate,
  stripHouseholdSuffix,
  timeframeWindows,
  sumInWindow,
  rollupMonthly,
  rollupAnnual,
  yoyPctSeries,
} from './glenwoodMetrics';
import type { GlenwoodMetric } from './GlenwoodMetricToggle';
import type { GlenwoodTimeframe } from './GlenwoodTimeframeToggle';
import type { VisitationFilter } from './GlenwoodBottomStrip';

const STRIP_CARD_HEIGHT = 260;

const DISTANCE_COLORS: Record<string, string> = {
  '0-25': '#cfe0f5',
  '25-50': '#a6c8ea',
  '50-100': '#7faedd',
  '100-250': '#5e91cb',
  '250+': '#3d70b0',
};
const DISTANCE_KEYS = ['0-25', '25-50', '50-100', '100-250', '250+'] as const;

const TYPE_COLORS: Record<string, string> = {
  Residents: '#86b3ee',
  'Inbound Commuters': '#FFB454',
  'Out-of-Market Visitors': '#6dd182',
};
const TYPE_KEYS = ['Residents', 'Inbound Commuters', 'Out-of-Market Visitors'] as const;

const OVERNIGHT_LABELS: Record<number, string> = {
  0: 'Day Trip',
  1: 'Overnight',
};
const OVERNIGHT_COLORS: Record<number, string> = {
  0: '#7faedd',
  1: '#FFB454',
};

// JS getUTCDay (0=Sun..6=Sat) vs the Mon-first display order used by the
// DOW chart. averageByDayOfWeek returns bars [Mon, Tue, ... Sun]; bar
// index i maps to JS dow = ((i + 1) % 7).
function dowFromBarIndex(i: number): number {
  return (i + 1) % 7;
}

// Per-section row key encoding for the ranking card. Mirrors the format
// used when constructing the rows — needs to round-trip so clicks resolve
// back to (dimension, key).
function rankingKey(
  dimension: 'distance' | 'category' | 'overnight',
  key: string,
): string {
  if (dimension === 'distance') return `dist-${key}`;
  if (dimension === 'category') return `cat-${key}`;
  return `over-${key}`;
}

interface Props {
  file: GlenwoodVisitationFile;
  metric: GlenwoodMetric;
  timeframe: GlenwoodTimeframe;
  filter: VisitationFilter;
  onFilterChange: (next: VisitationFilter) => void;
}

export function GlenwoodVisitationStrip({
  file,
  metric,
  timeframe,
  filter,
  onFilterChange,
}: Props) {
  const [dowFilter, setDowFilter] = useState<number | null>(null);

  const latestYear = useMemo(() => {
    const years = file.annualMetrics.map((m) => m.year);
    return years.length > 0 ? Math.max(...years) : new Date().getFullYear();
  }, [file]);

  const latestDate = useMemo(
    () => findLatestDate(file.dailyVisits.byType) ?? `${latestYear}-12-31`,
    [file, latestYear],
  );
  const tw = useMemo(() => timeframeWindows(latestDate, timeframe), [latestDate, timeframe]);

  // Trends-window source rows for the active dimension. When the filter
  // selects "overnight", we fall back to the same dimension's source for
  // the trend lines (distance, by default) — the overnight feed only has
  // overnight=1 rows, so showing it as the trends dimension would render
  // a single line.
  const trendDimension =
    filter?.dimension === 'overnight'
      ? 'distance'
      : (filter?.dimension ?? 'distance');

  // Convenience flags for filter shape.
  const filterKeys = filter?.keys ?? [];
  const isSectionSelection = filterKeys.includes('ALL');
  const rowKeys = filterKeys.filter((k) => k !== 'ALL');

  // Bucketed visitor demographics for the Demographics-mode strip cards.
  // We pull the "All" profile by default and swap to a specific distance
  // when the ranking card cross-filters to one (distance row click or
  // the Overnight row). Multi-row, section, and category selections fall
  // back to "All" because the source workbook doesn't ship blended
  // sub-distance distributions.
  const demoDistanceLabel = useMemo(() => {
    if (
      filter?.dimension === 'distance' &&
      !isSectionSelection &&
      rowKeys.length === 1
    ) {
      return `${rowKeys[0]} mi`;
    }
    if (filter?.dimension === 'overnight') return 'Overnight';
    return 'All';
  }, [filter, isSectionSelection, rowKeys]);

  const demoProfile = useMemo(
    () => file.visitorProfileByDistance?.[demoDistanceLabel] ?? {},
    [file, demoDistanceLabel],
  );

  // 16-bucket income ladder → 5 condensed bins to keep the bar chart legible.
  const incomeBuckets = useMemo(() => {
    const cat = demoProfile['Household Income'] ?? {};
    const raw = Object.entries(cat)
      .filter(([, v]) => typeof v === 'number')
      .map(([label, value]) => ({ label, value }));
    return condenseIncomeBuckets(raw);
  }, [demoProfile]);

  // Trailing "Household" / "Households" suffix dropped per design — bar
  // labels read as "1 Person", "2 Persons", etc.
  const hhSizeBuckets = useMemo(() => {
    const cat = demoProfile['Household Size'] ?? {};
    return Object.entries(cat)
      .filter(([, v]) => typeof v === 'number')
      .sort((a, b) => (parseInt(a[0], 10) || 0) - (parseInt(b[0], 10) || 0))
      .map(([label, value]) => ({ label: stripHouseholdSuffix(label), value }));
  }, [demoProfile]);

  // Visits Breakdown pie content mode. Defaults to a distance breakdown;
  // a category-dimension filter swaps the pie to category. Distance and
  // overnight filters keep the distance pie — overnight has only one row
  // in the feed, so it can't drive a pie on its own. The historical tier
  // (Local/Regional/Tourist) breakdown is no longer the default here.
  const pieMode: 'distance' | 'category' =
    filter?.dimension === 'category' ? 'category' : 'distance';

  const pieSlices: VisitorPieSlice[] = useMemo(() => {
    if (pieMode === 'category') {
      const sums = TYPE_KEYS.map((k) => {
        const value = sumInWindow(
          file.dailyVisits.byType
            .filter((r) => r.type === k)
            .map((r) => ({ date: r.date, value: r.value })),
          tw.window,
        );
        return { key: k, label: k, color: TYPE_COLORS[k], value };
      });
      const total = sums.reduce((acc, s) => acc + s.value, 0);
      return sums.map((s) => ({ ...s, share: total > 0 ? s.value / total : 0 }));
    }
    const sums = DISTANCE_KEYS.map((k) => {
      const value = sumInWindow(
        file.dailyVisits.byDistance
          .filter((r) => r.distance === k)
          .map((r) => ({ date: r.date, value: r.value })),
        tw.window,
      );
      return { key: k, label: `${k} mi`, color: DISTANCE_COLORS[k], value };
    });
    const total = sums.reduce((acc, s) => acc + s.value, 0);
    return sums.map((s) => ({ ...s, share: total > 0 ? s.value / total : 0 }));
  }, [pieMode, file, tw]);

  // Highlight set for the pie. Section selection populates the full
  // dimension key list — the pie treats size === slices.length as the
  // default render (no dimming, no outlines), so a header click swaps the
  // pie content without singling out any row. Distance/overnight filters
  // both render the distance pie, but only distance-dimension keys can
  // highlight a slice; an overnight selection draws no slice highlight.
  const pieSelectedKeys: ReadonlySet<string> | null = useMemo(() => {
    if (!filter) return null;
    if (filter.dimension === 'overnight') return null;
    if (filter.dimension !== pieMode) return null;
    if (isSectionSelection) {
      return new Set<string>(pieMode === 'distance' ? [...DISTANCE_KEYS] : [...TYPE_KEYS]);
    }
    return new Set(rowKeys);
  }, [pieMode, filter, isSectionSelection, rowKeys]);

  // YoY single-series source. Defaults to summed distance rows; switches
  // to category or overnight when those dimensions are the active filter.
  // When specific rows are selected within the dimension, the sum narrows
  // to just those rows (so e.g. selecting "0-25 mi" gives the 0-25 band's
  // YoY trend on its own).
  const yoyDimension: 'distance' | 'category' | 'overnight' =
    filter?.dimension === 'category'
      ? 'category'
      : filter?.dimension === 'overnight'
        ? 'overnight'
        : 'distance';

  const yoyRows = useMemo<{ date: string; value: number }[]>(() => {
    const keepRow = (key: string) => {
      if (!filter || filter.dimension !== yoyDimension) return true;
      if (isSectionSelection) return true;
      return rowKeys.includes(key);
    };
    if (yoyDimension === 'category') {
      return file.dailyVisits.byType
        .filter((r) => keepRow(r.type))
        .map((r) => ({ date: r.date, value: r.value }));
    }
    if (yoyDimension === 'overnight') {
      return (file.dailyVisits.byOvernight ?? []).map((r) => ({
        date: r.date,
        value: r.value,
      }));
    }
    return file.dailyVisits.byDistance
      .filter((r) => keepRow(r.distance))
      .map((r) => ({ date: r.date, value: r.value }));
  }, [file, yoyDimension, filter, isSectionSelection, rowKeys]);

  const yoySeries: TrendSeries[] = useMemo(
    () => [
      {
        key: 'yoy',
        label: 'YoY',
        color: 'rgba(255,255,255,0.85)',
        points: yoyPctSeries(yoyRows, tw),
      },
    ],
    [yoyRows, tw],
  );

  const yoyDimensionLabel =
    yoyDimension === 'category'
      ? 'Category'
      : yoyDimension === 'overnight'
        ? 'Overnight'
        : 'Distance';

  const trendCutoff = tw.trendStart === 'all' ? '' : tw.trendStart;
  const dimRows = useMemo(() => {
    if (trendDimension === 'category') {
      return file.dailyVisits.byType
        .filter((r) => !trendCutoff || r.date >= trendCutoff)
        .map((r) => ({ date: r.date, key: r.type as string, value: r.value }));
    }
    return file.dailyVisits.byDistance
      .filter((r) => !trendCutoff || r.date >= trendCutoff)
      .map((r) => ({ date: r.date, key: r.distance as string, value: r.value }));
  }, [file, trendDimension, trendCutoff]);

  const seriesOrder = trendDimension === 'category' ? TYPE_KEYS : DISTANCE_KEYS;
  const seriesColor = trendDimension === 'category' ? TYPE_COLORS : DISTANCE_COLORS;
  const seriesLabel = (k: string) =>
    trendDimension === 'distance' ? `${k} mi` : k;

  // Highlight the trend line(s) that match the active filter (only when
  // the filter's dimension matches what the trends chart is rendering
  // AND the filter is row-specific). A whole-section selection leaves
  // all series at full emphasis.
  const highlightedSeriesKeys =
    filter && filter.dimension === trendDimension && !isSectionSelection
      ? rowKeys
      : null;

  const trendSeries: TrendSeries[] = useMemo(() => {
    const filtered = dowFilter == null
      ? dimRows
      : dimRows.filter((r) => new Date(r.date + 'T00:00:00Z').getUTCDay() === dowFilter);
    return seriesOrder.map((k) => {
      const rowsForKey = filtered.filter((r) => r.key === k);
      // YTD mode pre-filters each year's rows down to Jan–latestMonth so
      // the annual rollup gives one apples-to-apples point per year.
      const annualSource = tw.trendMonthFilter != null
        ? rowsForKey.filter(
            (r) => parseInt(r.date.slice(5, 7), 10) <= tw.trendMonthFilter!,
          )
        : rowsForKey;
      const rolled =
        tw.trendGranularity === 'annual'
          ? rollupAnnual(annualSource)
          : rollupMonthly(rowsForKey, tw.trendStart === 'all' ? undefined : tw.trendStart);
      const points = rolled.map((p) => {
        const [y, mo] = p.date.split('-').map(Number);
        return { year: y + (mo - 1) / 12, value: p.value };
      });
      return { key: k, label: seriesLabel(k), color: seriesColor[k], points };
    });
  }, [dimRows, seriesOrder, seriesColor, dowFilter, tw]);

  // DOW averaging source. Narrows to the active ranking filter when row
  // keys are selected; whole-section selection ("ALL") uses every row in
  // that dimension.
  const dowSourceRows = useMemo<{ date: string; value: number }[]>(() => {
    if (!filter) {
      // No filter — sum across all category rows per date so the daily
      // total covers every visitor type (Residents + Inbound Commuters +
      // Out-of-Market Visitors). The byDistance feed only carries
      // out-of-market visits, so it can't be used for the unfiltered
      // default.
      return file.dailyVisits.byType.map((r) => ({ date: r.date, value: r.value }));
    }
    const keep = (key: string) => isSectionSelection || rowKeys.includes(key);
    if (filter.dimension === 'distance') {
      return file.dailyVisits.byDistance
        .filter((r) => keep(r.distance))
        .map((r) => ({ date: r.date, value: r.value }));
    }
    if (filter.dimension === 'category') {
      return file.dailyVisits.byType
        .filter((r) => keep(r.type))
        .map((r) => ({ date: r.date, value: r.value }));
    }
    // overnight (only overnight=1 rows exist in the feed; section + single
    // row selection collapse to the same source).
    return (file.dailyVisits.byOvernight ?? []).map((r) => ({
      date: r.date,
      value: r.value,
    }));
  }, [file, filter, isSectionSelection, rowKeys]);

  const dowBars = useMemo(
    () => averageByDayOfWeek(dowSourceRows, tw.window),
    [dowSourceRows, tw],
  );

  // Ranking card: three sections. Each row's value sums dailyVisits within
  // the active timeframe window, intersected with the active dowFilter
  // when set. YoY compares the same row against the prior window.
  const rankingSections: RankingSection[] = useMemo(() => {
    const applyDow = <R extends { date: string }>(rows: R[]) =>
      dowFilter == null
        ? rows
        : rows.filter(
            (r) => new Date(r.date + 'T00:00:00Z').getUTCDay() === dowFilter,
          );
    const sections: RankingSection[] = [];

    // Distance — preserve the near-to-far order from DISTANCE_KEYS rather
    // than re-sorting by visit count.
    const distRowsAll = file.dailyVisits.byDistance;
    sections.push({
      title: 'Distance',
      sort: 'none',
      rows: DISTANCE_KEYS.map((k) => {
        const rowsForKey = applyDow(distRowsAll.filter((r) => r.distance === k)).map((r) => ({
          date: r.date,
          value: r.value,
        }));
        const value = sumInWindow(rowsForKey, tw.window);
        const prior = sumInWindow(rowsForKey, tw.prior);
        const yoyPct = prior > 0 ? ((value - prior) / prior) * 100 : null;
        return {
          key: rankingKey('distance', k),
          label: `${k} mi`,
          color: DISTANCE_COLORS[k],
          value,
          yoyPct,
        };
      }),
    });

    // Category
    const typeRowsAll = file.dailyVisits.byType;
    sections.push({
      title: 'Category',
      rows: TYPE_KEYS.map((k) => {
        const rowsForKey = applyDow(typeRowsAll.filter((r) => r.type === k)).map((r) => ({
          date: r.date,
          value: r.value,
        }));
        const value = sumInWindow(rowsForKey, tw.window);
        const prior = sumInWindow(rowsForKey, tw.prior);
        const yoyPct = prior > 0 ? ((value - prior) / prior) * 100 : null;
        return {
          key: rankingKey('category', k),
          label: k,
          color: TYPE_COLORS[k],
          value,
          yoyPct,
        };
      }),
    });

    // Overnight (only overnight=1 rows exist in the feed)
    const overnightRowsAll = (file.dailyVisits.byOvernight ?? []).map((r) => ({
      date: r.date,
      value: r.value,
    }));
    const overnightRows = applyDow(overnightRowsAll);
    const overnightValue = sumInWindow(overnightRows, tw.window);
    const overnightPrior = sumInWindow(overnightRows, tw.prior);
    const overnightYoy =
      overnightPrior > 0
        ? ((overnightValue - overnightPrior) / overnightPrior) * 100
        : null;
    sections.push({
      title: 'Overnight',
      rows: [
        {
          key: rankingKey('overnight', '1'),
          label: OVERNIGHT_LABELS[1],
          color: OVERNIGHT_COLORS[1],
          value: overnightValue,
          yoyPct: overnightYoy,
        },
      ],
    });

    return sections;
  }, [file, tw, dowFilter]);

  // Currently-highlighted row keys, expressed in the rankingKey-prefixed
  // form the ranking card uses for its `selectedKeys` prop.
  const selectedRankingKeys = useMemo(() => {
    if (!filter || isSectionSelection) return new Set<string>();
    return new Set(
      rowKeys.map((k) =>
        rankingKey(filter.dimension, filter.dimension === 'overnight' ? '1' : k),
      ),
    );
  }, [filter, isSectionSelection, rowKeys]);

  // Section header → display title. Click a header → select that whole
  // section.
  const SECTION_TITLES: Record<'distance' | 'category' | 'overnight', string> = {
    distance: 'Distance',
    category: 'Category',
    overnight: 'Overnight',
  };
  const selectedSections = useMemo(
    () =>
      filter && isSectionSelection
        ? new Set([SECTION_TITLES[filter.dimension]])
        : new Set<string>(),
    [filter, isSectionSelection],
  );

  const handleRankingClick = (k: string) => {
    // Reverse the rankingKey encoding to recover (dimension, key).
    let dim: 'distance' | 'category' | 'overnight' | null = null;
    let rowKey: string | null = null;
    if (k.startsWith('dist-')) {
      dim = 'distance';
      rowKey = k.slice('dist-'.length);
    } else if (k.startsWith('cat-')) {
      dim = 'category';
      rowKey = k.slice('cat-'.length);
    } else if (k.startsWith('over-')) {
      dim = 'overnight';
      rowKey = k.slice('over-'.length);
    }
    if (!dim || rowKey == null) return;

    // Different dimension (or empty filter) → start fresh with this row.
    if (!filter || filter.dimension !== dim) {
      onFilterChange({ dimension: dim, keys: [rowKey] });
      return;
    }

    // Same dimension → toggle this row in/out. A whole-section ('ALL')
    // state collapses to just this row on first row click.
    const baseKeys = isSectionSelection ? [] : rowKeys;
    const next = baseKeys.includes(rowKey)
      ? baseKeys.filter((x) => x !== rowKey)
      : [...baseKeys, rowKey];
    if (next.length === 0) {
      onFilterChange(null);
    } else {
      onFilterChange({ dimension: dim, keys: next });
    }
  };

  const handleSectionClick = (title: string) => {
    const dim = (Object.entries(SECTION_TITLES).find(([, t]) => t === title)?.[0] ??
      null) as 'distance' | 'category' | 'overnight' | null;
    if (!dim) return;
    // Toggle the section: re-clicking the active section clears the filter.
    if (filter && filter.dimension === dim && isSectionSelection) {
      onFilterChange(null);
    } else {
      onFilterChange({ dimension: dim, keys: ['ALL'] });
    }
  };

  return (
    <div className="px-3 flex flex-col gap-2">
      {/* Ranking row: aligns with the column template below so the card sits
          above the rightmost bottom card and matches its width. */}
      {metric === 'visits' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="hidden md:block" />
          <div className="hidden md:block" />
          <div className="flex flex-col gap-2 min-w-0 pointer-events-auto">
            <GlenwoodRankingCard
              title="Visitation Rankings"
              subtitle={tw.subtitle.split(' vs ')[0]}
              sections={rankingSections}
              valueFormat={fmtCount}
              sort="value-desc"
              selectedKeys={selectedRankingKeys}
              onRowClick={handleRankingClick}
              selectedSections={selectedSections}
              onSectionClick={handleSectionClick}
            />
            <div
              className="glass rounded-md p-3 flex flex-col gap-2 min-h-[260px] md:min-h-0 md:h-[170px]"
            >
              <div
                className="text-[10px] font-semibold uppercase tracking-wider flex items-baseline justify-between"
                style={{ color: 'var(--text-dim)' }}
              >
                <span>Avg Daily Visits · Day of Week</span>
                <span className="text-[9px]">
                  {tw.subtitle.includes(' vs ')
                    ? tw.subtitle.split(' vs ')[0]
                    : tw.subtitle}
                  {filter
                    ? ` · ${
                        isSectionSelection
                          ? `All ${SECTION_TITLES[filter.dimension]}`
                          : rowKeys.length > 1
                            ? `${rowKeys.length} ${SECTION_TITLES[filter.dimension]} selected`
                            : filter.dimension === 'distance'
                              ? `${rowKeys[0]} mi`
                              : filter.dimension === 'overnight'
                                ? OVERNIGHT_LABELS[1]
                                : rowKeys[0]
                      }`
                    : ''}
                </span>
              </div>
              <GlenwoodDayOfWeekChart
                bars={dowBars}
                selectedDay={dowFilter == null ? null : dowBars.findIndex((_, i) => dowFromBarIndex(i) === dowFilter)}
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
        className="grid grid-cols-1 md:grid-cols-3 gap-3 pointer-events-auto md:h-[260px]"
      >
        <div className="glass rounded-md p-3 flex flex-col gap-2 min-h-[260px] md:min-h-0">
          <div
            className="text-[10px] font-semibold uppercase tracking-wider flex items-baseline justify-between"
            style={{ color: 'var(--text-dim)' }}
          >
            <span>Visits Breakdown</span>
            <span className="text-[9px]">
              {tw.subtitle.includes(' vs ')
                ? tw.subtitle.split(' vs ')[0]
                : tw.subtitle}
            </span>
          </div>
          <GlenwoodVisitorTypePie
            slices={pieSlices}
            selectedKeys={pieSelectedKeys}
            onSelectKey={(key) => handleRankingClick(rankingKey(pieMode, key))}
          />
        </div>

        {metric === 'visits' ? (
          <>
            <div className="glass rounded-md p-3 flex flex-col gap-2 min-h-[260px] md:min-h-0">
              <div
                className="text-[10px] font-semibold uppercase tracking-wider flex items-center justify-between gap-2"
                style={{ color: 'var(--text-dim)' }}
              >
                <span className="truncate">
                  Visit Trends by {trendDimension === 'category' ? 'Type' : 'Distance'}
                </span>
                <span className="text-[9px]">
                  {timeframe === 'ytd' ? 'YTD' : timeframe === 'annual' ? 'Annual' : 'Monthly'}
                </span>
              </div>
              <div className="flex-1 min-h-0">
                <MiniTrendChart
                  series={trendSeries}
                  height="fill"
                  valueFormat={(v) => fmtCount(v)}
                  highlightedKey={highlightedSeriesKeys}
                  hideLegend
                  tooltipDateGranularity={tw.trendGranularity}
                />
              </div>
            </div>

            <div className="glass rounded-md p-3 flex flex-col gap-2 min-h-[260px] md:min-h-0">
              <div
                className="text-[10px] font-semibold uppercase tracking-wider flex items-baseline justify-between"
                style={{ color: 'var(--text-dim)' }}
              >
                <span>YoY Change by {yoyDimensionLabel}</span>
                <span className="text-[9px]">
                  {timeframe === 'ytd' ? 'YTD' : timeframe === 'annual' ? 'Annual' : 'Monthly'}
                </span>
              </div>
              <div className="flex-1 min-h-0">
                <MiniTrendChart
                  series={yoySeries}
                  height="fill"
                  yMin="auto"
                  valueFormat={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`}
                  hideLegend
                  tooltipDateGranularity={tw.trendGranularity}
                  zeroBaseline
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="glass rounded-md p-3 flex flex-col gap-2 min-h-[260px] md:min-h-0">
              <div
                className="text-[10px] font-semibold uppercase tracking-wider flex items-baseline justify-between"
                style={{ color: 'var(--text-dim)' }}
              >
                <span>Visitor Household Income</span>
                <span className="text-[9px]">{demoDistanceLabel}</span>
              </div>
              {incomeBuckets.length > 0 ? (
                <GlenwoodDistributionBar buckets={incomeBuckets} />
              ) : (
                <div
                  className="flex-1 min-h-0 flex items-center justify-center text-[10px]"
                  style={{ color: 'var(--text-dim)' }}
                >
                  No data available for {demoDistanceLabel}.
                </div>
              )}
            </div>

            <div className="glass rounded-md p-3 flex flex-col gap-2 min-h-[260px] md:min-h-0">
              <div
                className="text-[10px] font-semibold uppercase tracking-wider flex items-baseline justify-between"
                style={{ color: 'var(--text-dim)' }}
              >
                <span>Household Size</span>
                <span className="text-[9px]">{demoDistanceLabel}</span>
              </div>
              {hhSizeBuckets.length > 0 ? (
                <GlenwoodDistributionBar buckets={hhSizeBuckets} />
              ) : (
                <div
                  className="flex-1 min-h-0 flex items-center justify-center text-[10px]"
                  style={{ color: 'var(--text-dim)' }}
                >
                  No data available for {demoDistanceLabel}.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
