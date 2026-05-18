// GlenwoodVisitationStrip — bottom strip for the Visitation sub-view.
// Always renders a Visits Breakdown pie as card 1; cards 2 + 3 swap by
// metric. In Visits mode the Visit Trends + Avg Daily Visits cards share
// a Type/Distance toggle (top-right of the trends card) and cross-filter:
// clicking a series in the legend filters the day-of-week bars to that
// series, and clicking a day-of-week bar filters the trend lines to rows
// on that weekday.

import { useMemo, useState } from 'react';
import type { GlenwoodVisitationFile } from '../../../types/placer-glenwood';
import { MiniTrendChart, type TrendSeries } from '../MiniTrendChart';
import { GlenwoodDayOfWeekChart } from './GlenwoodDayOfWeekChart';
import { GlenwoodVisitorTypePie } from './GlenwoodVisitorTypePie';
import { GlenwoodDimToggle } from './GlenwoodDimToggle';
import { GlenwoodSeriesLegend } from './GlenwoodSeriesLegend';
import {
  averageByDayOfWeek,
  fmtCount,
  tiersFromVisitationCategories,
} from './glenwoodMetrics';
import type { GlenwoodMetric } from './GlenwoodMetricToggle';

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

type Dim = 'type' | 'distance';

// Day-of-week index used by JS getUTCDay (0=Sun..6=Sat) → our Mon-first
// display order. averageByDayOfWeek returns bars in [Mon, Tue, ... Sun]
// so index i in the bar list maps to JS dow = ((i + 1) % 7).
function dowFromBarIndex(i: number): number {
  return (i + 1) % 7;
}

interface Props {
  file: GlenwoodVisitationFile;
  metric: GlenwoodMetric;
}

export function GlenwoodVisitationStrip({ file, metric }: Props) {
  const [dim, setDim] = useState<Dim>('distance');
  const [seriesFilter, setSeriesFilter] = useState<string | null>(null);
  const [dowFilter, setDowFilter] = useState<number | null>(null);

  const latestYear = useMemo(() => {
    const years = file.annualMetrics.map((m) => m.year);
    return years.length > 0 ? Math.max(...years) : new Date().getFullYear();
  }, [file]);

  const tierSlices = useMemo(
    () =>
      tiersFromVisitationCategories(
        file.dailyVisits.byType,
        file.dailyVisits.byDistance,
        latestYear,
      ),
    [file, latestYear],
  );

  // Rows for the active dimension, narrowed to the recent 24-month window
  // used by the trends + DOW cards.
  const cutoff = `${latestYear - 1}-01-01`;
  const dimRows = useMemo(() => {
    if (dim === 'type') {
      return file.dailyVisits.byType
        .filter((r) => r.date >= cutoff)
        .map((r) => ({ date: r.date, key: r.type as string, value: r.value }));
    }
    return file.dailyVisits.byDistance
      .filter((r) => r.date >= cutoff)
      .map((r) => ({ date: r.date, key: r.distance as string, value: r.value }));
  }, [file, dim, cutoff]);

  const seriesOrder = dim === 'type' ? TYPE_KEYS : DISTANCE_KEYS;
  const seriesColor = dim === 'type' ? TYPE_COLORS : DISTANCE_COLORS;
  const seriesLabel = (k: string) => (dim === 'distance' ? `${k} mi` : k);

  // Visit Trends data: rows in the active dim, filtered by dowFilter when
  // set, rolled up to monthly per series.
  const trendSeries: TrendSeries[] = useMemo(() => {
    const filtered = dowFilter == null
      ? dimRows
      : dimRows.filter((r) => new Date(r.date + 'T00:00:00Z').getUTCDay() === dowFilter);
    return seriesOrder.map((k) => {
      const monthly = new Map<string, number>();
      for (const r of filtered) {
        if (r.key !== k) continue;
        const m = r.date.slice(0, 7);
        monthly.set(m, (monthly.get(m) ?? 0) + r.value);
      }
      const points = Array.from(monthly.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([m, value]) => {
          const [y, mo] = m.split('-').map(Number);
          return { year: y + (mo - 1) / 12, value };
        });
      return { key: k, label: seriesLabel(k), color: seriesColor[k], points };
    });
  }, [dimRows, seriesOrder, seriesColor, dowFilter]);

  // Day-of-week bars: rows in the active dim, narrowed by seriesFilter
  // when set, averaged across the latest full year.
  const dowBars = useMemo(() => {
    const rows = (seriesFilter == null
      ? dimRows
      : dimRows.filter((r) => r.key === seriesFilter)
    ).map((r) => ({ date: r.date, value: r.value }));
    return averageByDayOfWeek(rows, latestYear);
  }, [dimRows, seriesFilter, latestYear]);

  const legendItems = seriesOrder.map((k) => ({
    key: k,
    label: seriesLabel(k),
    color: seriesColor[k],
  }));

  const dimSwitchClearsFilter = () => {
    setSeriesFilter(null);
    setDowFilter(null);
  };

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
            <span className="text-[9px]">{latestYear}</span>
          </div>
          <GlenwoodVisitorTypePie slices={tierSlices} />
        </div>

        {metric === 'visits' ? (
          <>
            <div className="glass rounded-md p-3 flex flex-col gap-2 min-h-0">
              <div
                className="text-[10px] font-semibold uppercase tracking-wider flex items-center justify-between gap-2"
                style={{ color: 'var(--text-dim)' }}
              >
                <span className="truncate">Visit Trends by {dim === 'type' ? 'Type' : 'Distance'}</span>
                <GlenwoodDimToggle<Dim>
                  options={[
                    { value: 'distance', label: 'Distance' },
                    { value: 'type', label: 'Type' },
                  ]}
                  value={dim}
                  onChange={(d) => {
                    setDim(d);
                    dimSwitchClearsFilter();
                  }}
                  ariaLabel="Visit trends dimension"
                />
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
                  {latestYear}
                  {seriesFilter ? ` · ${seriesLabel(seriesFilter)}` : ''}
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
          </>
        ) : (
          <>
            <div className="glass rounded-md p-3 flex flex-col gap-2 min-h-0">
              <div
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--text-dim)' }}
              >
                Visitor Household Income
              </div>
              <div
                className="flex-1 min-h-0 flex items-center justify-center text-[10px]"
                style={{ color: 'var(--text-dim)' }}
              >
                City-wide visitor profile carries only scalar means. Switch
                to Retail Hubs or POIs for bucketed distributions.
              </div>
            </div>

            <div className="glass rounded-md p-3 flex flex-col gap-2 min-h-0">
              <div
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--text-dim)' }}
              >
                Household Size
              </div>
              <div
                className="flex-1 min-h-0 flex items-center justify-center text-[10px]"
                style={{ color: 'var(--text-dim)' }}
              >
                Not bucketed at the city level. Available per hub or POI.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
