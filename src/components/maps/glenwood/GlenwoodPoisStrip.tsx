// GlenwoodPoisStrip — bottom strip for the POIs sub-view. Card 1 is the
// Local/Regional/Tourist pie; cards 2 + 3 swap by metric:
//   Visits        — Visit Trends by POI · Avg Daily Visits by DOW (POI
//                   source is monthly, so the DOW card surfaces an empty
//                   state explaining the gap).
//   Demographics  — Household Income · Household Size

import { useMemo } from 'react';
import type {
  GlenwoodPoisFile,
  GlenwoodFeatureEntity,
} from '../../../types/placer-glenwood';
import { MiniTrendChart, type TrendSeries } from '../MiniTrendChart';
import { GlenwoodDistributionBar } from './GlenwoodDistributionBar';
import { GlenwoodVisitorTypePie } from './GlenwoodVisitorTypePie';
import { fmtCount, tiersFromZipRows } from './glenwoodMetrics';

const TIER_YEAR = 2025;
import type { GlenwoodMetric } from './GlenwoodMetricToggle';

const STRIP_CARD_HEIGHT = 260;

const SERIES_PALETTE = [
  '#FFB454', '#86b3ee', '#6dd182', '#b794f4', '#f06292',
  '#4dd0e1', '#ffd54f', '#a1887f',
];

interface Props {
  file: GlenwoodPoisFile;
  selectedIds: Set<string>;
  metric: GlenwoodMetric;
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
    const monthlyTotal = (p.monthlyVisits ?? []).reduce((acc, r) => acc + r.value, 0) || 1;
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

export function GlenwoodPoisStrip({ file, selectedIds, metric }: Props) {
  const visible = useMemo(
    () => (selectedIds.size === 0 ? file.pois : file.pois.filter((p) => selectedIds.has(p.id))),
    [file, selectedIds],
  );

  const trendSeries: TrendSeries[] = useMemo(() => {
    return visible.map((p, i) => {
      const points = (p.monthlyVisits ?? []).map((r) => {
        const [y, mo] = r.date.split('-').map(Number);
        return { year: y + (mo - 1) / 12, value: r.value };
      });
      const trimmed = points.slice(-24);
      return {
        key: p.id,
        label: p.name,
        color: SERIES_PALETTE[i % SERIES_PALETTE.length],
        points: trimmed,
      };
    });
  }, [visible]);

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

  const incomeBuckets = useMemo(
    () =>
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

  const selectionTag =
    selectedIds.size === 0 ? `All ${file.pois.length} POIs` : `${selectedIds.size} selected`;

  // POI daily visits aren't published, so the avg-daily-visits card is
  // suppressed in Visits mode and the grid collapses to 2 columns.
  const gridCols = metric === 'visits' ? 'md:grid-cols-2' : 'md:grid-cols-3';

  return (
    <div className="px-3 flex flex-col gap-2">
      <div
        className={`grid grid-cols-1 ${gridCols} gap-3`}
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
          <div className="glass rounded-md p-3 flex flex-col gap-2 min-h-0">
            <div
              className="text-[10px] font-semibold uppercase tracking-wider flex items-baseline justify-between"
              style={{ color: 'var(--text-dim)' }}
            >
              <span>Visit Trends by POI</span>
              <span className="text-[9px]">{selectionTag}</span>
            </div>
            <div className="flex-1 min-h-0">
              <MiniTrendChart
                series={trendSeries}
                height="fill"
                valueFormat={(v) => fmtCount(v)}
              />
            </div>
          </div>
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

