// GlenwoodRetailHubsStrip — bottom strip for the Retail Hubs sub-view.
// Card 1 is always a Visitor Type pie (Local/Regional/Tourist), cards 2 +
// 3 swap by metric:
//   Visits        — Visit Trends by Hub · Avg Daily Visits by DOW
//   Demographics  — Household Income · Household Size

import { useMemo, useState } from 'react';
import type {
  GlenwoodHubsFile,
  GlenwoodFeatureEntity,
} from '../../../types/placer-glenwood';
import { MiniTrendChart, type TrendSeries } from '../MiniTrendChart';
import { GlenwoodDistributionBar } from './GlenwoodDistributionBar';
import { GlenwoodDayOfWeekChart } from './GlenwoodDayOfWeekChart';
import { GlenwoodVisitorTypePie } from './GlenwoodVisitorTypePie';
import { GlenwoodSeriesLegend } from './GlenwoodSeriesLegend';
import {
  averageByDayOfWeek,
  fmtCount,
  profileScalar,
  tiersFromZipRows,
} from './glenwoodMetrics';

const TIER_YEAR = 2025;
import type { GlenwoodMetric } from './GlenwoodMetricToggle';

const STRIP_CARD_HEIGHT = 260;

const SERIES_PALETTE = [
  '#86b3ee', '#FFB454', '#6dd182', '#b794f4', '#f06292',
  '#4dd0e1', '#ffd54f', '#a1887f',
];

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
  metric: GlenwoodMetric;
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

export function GlenwoodRetailHubsStrip({ file, selectedIds, metric }: Props) {
  const [seriesFilter, setSeriesFilter] = useState<string | null>(null);
  const [dowFilter, setDowFilter] = useState<number | null>(null);

  const visible = useMemo(
    () => (selectedIds.size === 0 ? file.hubs : file.hubs.filter((h) => selectedIds.has(h.id))),
    [file, selectedIds],
  );

  const trendSeries: TrendSeries[] = useMemo(() => {
    const today = new Date();
    const cutoff = new Date(today.getFullYear() - 2, today.getMonth(), 1)
      .toISOString()
      .slice(0, 10);
    return visible.map((h, i) => {
      const rows = (h.dailyVisits ?? []).filter(
        (r) =>
          r.date >= cutoff &&
          (dowFilter == null ||
            new Date(r.date + 'T00:00:00Z').getUTCDay() === dowFilter),
      );
      const monthly = new Map<string, number>();
      for (const r of rows) {
        const m = r.date.slice(0, 7);
        monthly.set(m, (monthly.get(m) ?? 0) + r.value);
      }
      const points = Array.from(monthly.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([m, value]) => {
          const [y, mo] = m.split('-').map(Number);
          return { year: y + (mo - 1) / 12, value };
        });
      return {
        key: h.id,
        label: h.name,
        color: SERIES_PALETTE[i % SERIES_PALETTE.length],
        points,
      };
    });
  }, [visible, dowFilter]);

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

  const incomeBuckets = useMemo(
    () =>
      aggregateBuckets(
        visible,
        'Household Income',
        isIncomeBucketKey,
        (a, b) => bracketSortKey(a) - bracketSortKey(b),
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
      ),
    [visible],
  );

  const dowBars = useMemo(() => {
    const today = new Date();
    const lastFullYear = today.getFullYear() - 1;
    const sourceHubs = seriesFilter
      ? visible.filter((h) => h.id === seriesFilter)
      : visible;
    const rows = sourceHubs.flatMap((h) => h.dailyVisits ?? []);
    return averageByDayOfWeek(rows, lastFullYear);
  }, [visible, seriesFilter]);

  const legendItems = useMemo(
    () =>
      visible.map((h, i) => ({
        key: h.id,
        label: h.name,
        color: SERIES_PALETTE[i % SERIES_PALETTE.length],
      })),
    [visible],
  );

  const dowFromBarIndex = (i: number) => (i + 1) % 7;
  const selectedBarIndex =
    dowFilter == null ? null : [1, 2, 3, 4, 5, 6, 0].indexOf(dowFilter);

  const selectionTag =
    selectedIds.size === 0 ? `All ${file.hubs.length} hubs` : `${selectedIds.size} selected`;

  return (
    <div className="px-3 flex flex-col gap-2">
      <div
        className="grid grid-cols-1 md:grid-cols-3 gap-3"
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
          <GlenwoodVisitorTypePie slices={tierSlices} />
        </div>

        {metric === 'visits' ? (
          <>
            <div className="glass rounded-md p-3 flex flex-col gap-2 min-h-0">
              <div
                className="text-[10px] font-semibold uppercase tracking-wider flex items-baseline justify-between"
                style={{ color: 'var(--text-dim)' }}
              >
                <span>Visit Trends by Hub</span>
                <span className="text-[9px]">{selectionTag}</span>
              </div>
              <GlenwoodSeriesLegend
                items={legendItems}
                selected={seriesFilter}
                onSelect={setSeriesFilter}
              />
              <div className="flex-1 min-h-0">
                <MiniTrendChart
                  series={trendSeries}
                  height="fill"
                  valueFormat={(v) => fmtCount(v)}
                  highlightedKey={seriesFilter}
                  hideLegend
                />
              </div>
            </div>

            <div className="glass rounded-md p-3 flex flex-col gap-2 min-h-0">
              <div
                className="text-[10px] font-semibold uppercase tracking-wider flex items-baseline justify-between"
                style={{ color: 'var(--text-dim)' }}
              >
                <span>Avg Daily Visits · Day of Week</span>
                <span className="text-[9px]">
                  latest full year
                  {seriesFilter
                    ? ` · ${visible.find((h) => h.id === seriesFilter)?.name ?? ''}`
                    : ''}
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
