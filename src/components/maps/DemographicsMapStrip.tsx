// DemographicsMapStrip — bottom card strip for the Demographics map view.
// Renders as an absolute overlay (set up by MapShell) at the bottom of the
// map. Cards use the .glass class so the map underneath shows through with
// backdrop-blur, matching the Workforce BottomCardStrip pattern.
//
// Three layouts:
//   - 0 selected: regional aggregate KPIs (place- or county-level depending
//     on the geoLevel toggle), single-line regional population trend, top-N
//     ranked-list of places.
//   - 1 selected (single-select mode): per-place / per-county KPIs, that
//     entity's population trend, peer comparison ranked list.
//   - N selected (multi-select on): aggregate-of-selected KPIs, multi-line
//     population trend with legend, ranked list with selected items highlighted.

import { useMemo } from 'react';
import type {
  ContextCountyEntry,
  ContextEnvelope,
  ContextLatest,
  ContextPlaceEntry,
  ContextTrend,
  TrendPoint,
} from '../../types/context';
import {
  DEMOGRAPHICS_METRIC_BY_ID,
  DEMOGRAPHICS_METRICS,
  type DemographicsMetric,
  type DemographicsMetricId,
} from './demographicsMetrics';
import { SubjectKpiCard } from './SubjectKpiCard';
import { MiniTrendChart, type TrendSeries } from './MiniTrendChart';
import { NEGATIVE_DIVERGING_COLOR, RAMPS, seriesColor } from '../../lib/subjectColorRamps';
import type { GeoLevel } from './SubjectMapOverlay';
import type { WorkforceTotals } from '../../lib/workforceTotals';

const STRIP_CARD_HEIGHT = 260;

interface Props {
  bundle: ContextEnvelope;
  metricId: DemographicsMetricId;
  geoLevel: GeoLevel;
  // Optional county scope. When set, the Region card and ranked list are
  // computed across the filtered subset only.
  countyFilter: string | null;
  selectedZips: Set<string>;
  selectedCountyGeoids: Set<string>;
  multiSelect: boolean;
  onMultiSelectChange: (next: boolean) => void;
  // Ranked-list click handlers (always toggle in/out — the ranked list is
  // the canonical multi-select comparison surface). Map-symbol clicks live
  // on SubjectMapOverlay and use the view's onSelectZip/onSelectCounty
  // directly, so this strip doesn't need to thread those through.
  onToggleZip: (zip: string) => void;
  onToggleCounty: (geoid: string) => void;
  onClearSelections: () => void;
  workforce: WorkforceTotals;
}

interface RegionAggregate {
  population: number;
  workforce: number;
  medianAge: number | null;
  medianHhIncome: number | null;
  under18: number;
  over65: number;
  hispanic: number;
}

export function DemographicsMapStrip({
  bundle,
  metricId,
  geoLevel,
  countyFilter,
  selectedZips,
  selectedCountyGeoids,
  multiSelect,
  onMultiSelectChange,
  onToggleZip,
  onToggleCounty,
  onClearSelections,
  workforce,
}: Props) {
  const metric = DEMOGRAPHICS_METRICS.find((m) => m.id === metricId)!;
  const ramp = RAMPS.demographics;
  const accent = ramp.accent;

  // County-scoped place + county sets used for every aggregation below.
  const filteredPlaces = useMemo(
    () => bundle.places.filter((p) => !countyFilter || p.countyGeoid === countyFilter),
    [bundle.places, countyFilter],
  );
  const filteredCounties = useMemo(
    () => bundle.counties.filter((c) => !countyFilter || c.geoid === countyFilter),
    [bundle.counties, countyFilter],
  );

  const activePlaces = useMemo(
    () => filteredPlaces.filter((p) => selectedZips.has(p.zip)),
    [filteredPlaces, selectedZips],
  );
  const activeCounties = useMemo(
    () => filteredCounties.filter((c) => selectedCountyGeoids.has(c.geoid)),
    [filteredCounties, selectedCountyGeoids],
  );
  const totalSelected = activePlaces.length + activeCounties.length;

  // Region aggregate — computed over the filtered set so the headline reads
  // as "% of the visible scope" rather than "% of the original 11 places."
  const regionAggregate = useMemo<RegionAggregate>(() => {
    const entities = geoLevel === 'county' ? filteredCounties : filteredPlaces;
    return aggregateDemographics(entities, workforce, geoLevel);
  }, [filteredCounties, filteredPlaces, geoLevel, workforce]);

  // Aggregate-of-selected (only relevant when totalSelected > 0). When the
  // user has highlighted N places (or counties) the Region card switches
  // from "all 11 places" to "your 4-place selection".
  const selectionAggregate = useMemo<RegionAggregate | null>(() => {
    if (totalSelected === 0) return null;
    if (activeCounties.length > 0) {
      return aggregateDemographics(activeCounties, workforce, 'county');
    }
    return aggregateDemographics(activePlaces, workforce, 'place');
  }, [totalSelected, activePlaces, activeCounties, workforce]);

  // Ranked entities for the right-side list, scoped to the active geoLevel.
  // Prefers metric.extractFromTrend() when present (composite metrics like
  // Population 10-yr % that need a multi-year computation); falls back to
  // metric.extract() for everyday single-year latest reads.
  // When the active metric is Population, each row also gets a 10-yr %
  // change as a YoY-style chip — mirrors the Glenwood Activity ranking
  // card's signed-percent chip so the visual reads consistently across
  // maps.
  const showYoyChip = metricId === 'population';
  const pop10yrExtract = DEMOGRAPHICS_METRIC_BY_ID.population10yrPct.extractFromTrend;
  const rankedRows = useMemo(() => {
    const rows = (geoLevel === 'county' ? filteredCounties : filteredPlaces).map((e) => {
      const pct = showYoyChip && pop10yrExtract ? pop10yrExtract(e.trend) : null;
      return {
        id: 'zip' in e ? e.zip : e.geoid,
        name: e.name,
        value: metric.extractFromTrend
          ? metric.extractFromTrend(e.trend)
          : metric.extract(e.latest),
        // YoY value is stored as a percentage (e.g. 8.5 for +8.5%) so the
        // chip formatter can render it directly without re-scaling.
        yoyPct: pct == null ? null : pct * 100,
      };
    });
    return rows
      .filter((r) => r.value != null)
      .sort((a, b) => (b.value as number) - (a.value as number));
  }, [filteredCounties, filteredPlaces, geoLevel, metric, showYoyChip, pop10yrExtract]);

  // Trend series — multi-series when ≥1 entity selected, otherwise the
  // single regional aggregate line. Uses the active metric's trendKey
  // (falling back to 'population' when the metric has no per-metric series
  // available in the bundle).
  const trendKey = metric.trendKey ?? 'population';
  const trendSeries = useMemo<TrendSeries[]>(() => {
    if (totalSelected === 0) {
      let points = aggregatedTrend(
        geoLevel === 'county' ? filteredCounties : filteredPlaces,
        trendKey,
      );
      // Fallback — if the selected metric has no data, render the canonical
      // population trend instead so the chart slot is never blank.
      if (points.length === 0 && trendKey !== 'population') {
        points = aggregatedTrend(
          geoLevel === 'county' ? filteredCounties : filteredPlaces,
          'population',
        );
      }
      return [
        {
          key: 'region',
          label: 'Region',
          color: accent,
          points,
        },
      ];
    }
    const entities: Array<ContextPlaceEntry | ContextCountyEntry> = [
      ...activePlaces,
      ...activeCounties,
    ];
    return entities.map((e, i) => {
      const primary = e.trend?.[trendKey] ?? [];
      const points = primary.length > 0 ? primary : (e.trend?.population ?? []);
      return {
        key: 'zip' in e ? e.zip : e.geoid,
        label: e.name,
        color: seriesColor(i),
        points,
      };
    });
  }, [totalSelected, activePlaces, activeCounties, filteredCounties, filteredPlaces, geoLevel, accent, trendKey]);

  // Use multi-series mode (with legend) whenever the user has selections.
  const useMultiSeries = totalSelected > 0;

  // Choose which "Region" card to render: aggregate-of-selected vs full region.
  const headlineAggregate = selectionAggregate ?? regionAggregate;
  const filterLabel = countyFilter
    ? bundle.counties.find((c) => c.geoid === countyFilter)?.name.replace(/ County$/, '') ?? 'Filtered'
    : 'Region';
  const headlineLabel = (() => {
    if (totalSelected === 0) {
      const ents = geoLevel === 'county' ? filteredCounties : filteredPlaces;
      return `${filterLabel} · ${ents.length} ${geoLevel === 'county' ? (ents.length === 1 ? 'county' : 'counties') : (ents.length === 1 ? 'place' : 'anchor places')}`;
    }
    return `Selected · ${totalSelected} ${totalSelected === 1 ? 'item' : 'items'}`;
  })();

  // % of region — proportion of the headline (selected or filtered region)
  // value relative to the *filtered* region. Denominators come from
  // regionAggregate so a county filter narrows the baseline: when a county
  // is filtered with no selection the card reads 100%; when a place inside
  // the filter is selected the % is the place's share of that county.
  const populationPctOfRegion =
    regionAggregate.population > 0
      ? headlineAggregate.population / regionAggregate.population
      : null;
  const workforcePctOfRegion =
    regionAggregate.workforce > 0
      ? headlineAggregate.workforce / regionAggregate.workforce
      : null;

  // Headline override for composite metrics (Population 10-yr %) that
  // require the aggregated trend, not a single-year latest. Synthesizes a
  // ContextTrend from the active geo level so metric.extractFromTrend() can
  // run against it.
  const headlineOverride = useMemo<number | null>(() => {
    if (!metric.extractFromTrend) return null;
    const entities = totalSelected === 0
      ? (geoLevel === 'county' ? filteredCounties : filteredPlaces)
      : [...activePlaces, ...activeCounties];
    const synthTrend: ContextTrend = {
      population: aggregatedTrend(entities, 'population'),
    };
    return metric.extractFromTrend(synthTrend);
  }, [metric, totalSelected, geoLevel, filteredCounties, filteredPlaces, activePlaces, activeCounties]);

  return (
    <div className="px-3 flex flex-col gap-2">
      <div
        className="grid grid-cols-1 md:grid-cols-3 gap-3 md:h-[260px]"
      >
        <RegionKpis
          region={headlineAggregate}
          metric={metric}
          label={headlineLabel}
          accent={selectionAggregate ? accent : undefined}
          headlinePctOfRegion={
            metric.id === 'population' ? populationPctOfRegion : null
          }
          workforcePctOfRegion={workforcePctOfRegion}
          headlineOverride={headlineOverride}
        />
        <TrendCard
          title={(() => {
            // The trend card mirrors the active metric where possible, but
            // composite/derived metrics (e.g. Population 10-yr %) still
            // show the underlying population series — so we phrase the
            // title from the trendKey rather than the metric label.
            const trendLabel = trendCardLabel(metric, trendKey);
            if (useMultiSeries) return `${trendLabel} · selected`;
            return countyFilter
              ? `${filterLabel} ${trendLabel.toLowerCase()}`
              : `Regional ${trendLabel.toLowerCase()}`;
          })()}
          subtitle={
            useMultiSeries
              ? `${totalSelected} series`
              : geoLevel === 'county'
              ? `sum of ${filteredCounties.length} ${filteredCounties.length === 1 ? 'county' : 'counties'}`
              : `sum of ${filteredPlaces.length} ${filteredPlaces.length === 1 ? 'place' : 'anchor places'}`
          }
          series={useMultiSeries ? trendSeries : undefined}
          singlePoints={useMultiSeries ? undefined : trendSeries[0]?.points}
          color={accent}
          singleSeriesName={trendCardLabel(metric, trendKey).replace(/ trend$/, '')}
        />
        <RankedListCard
          rows={rankedRows}
          metric={metric}
          selectedIds={
            activeCounties.length > 0
              ? new Set([...selectedCountyGeoids])
              : new Set([...selectedZips])
          }
          onSelect={(id) =>
            geoLevel === 'county' || activeCounties.length > 0
              ? onToggleCounty(id)
              : onToggleZip(id)
          }
          geoLevel={geoLevel}
          accent={accent}
          showYoyChip={showYoyChip}
        />
      </div>
    </div>
  );
}

// ---------- Sub-components ----------

function RegionKpis({
  region,
  metric,
  label,
  accent,
  headlinePctOfRegion,
  workforcePctOfRegion,
  headlineOverride,
}: {
  region: RegionAggregate;
  metric: DemographicsMetric;
  label: string;
  accent?: string;
  headlinePctOfRegion: number | null;
  workforcePctOfRegion: number | null;
  // For composite metrics that don't read from a single ContextLatest
  // (e.g. Population 10-yr %), the parent computes the headline from the
  // aggregated trend and threads it in here.
  headlineOverride: number | null;
}) {
  const synthLatest: ContextLatest = {
    population: region.population,
    medianAge: region.medianAge,
    medianHhIncome: region.medianHhIncome,
    ageU18: region.under18,
    age65plus: region.over65,
    hispanic: region.hispanic,
  };
  const headline = headlineOverride ?? metric.extract(synthLatest);

  return (
    <div
      className="glass rounded-md p-3 flex flex-col gap-2 min-w-0 min-h-[280px] md:min-h-0 overflow-hidden"
      style={accent ? { borderColor: accent } : undefined}
    >
      <div className="flex items-baseline justify-between">
        <div
          className="text-[10px] font-semibold uppercase tracking-wider truncate"
          style={{ color: accent ?? 'var(--text-h)' }}
        >
          {label}
        </div>
        <div
          className="text-[9px] tracking-wider"
          style={{ color: 'var(--text-dim)' }}
        >
          aggregate
        </div>
      </div>
      <div className="grid grid-cols-2 grid-rows-2 gap-2 flex-1 min-h-0">
        <SubjectKpiCard
          label={metric.label}
          value={metric.format(headline)}
          sublabel={
            headlinePctOfRegion != null
              ? `${(headlinePctOfRegion * 100).toFixed(headlinePctOfRegion === 1 ? 0 : 1)}% of region`
              : undefined
          }
          size="md"
        />
        <SubjectKpiCard
          label="Workforce"
          value={Math.round(region.workforce).toLocaleString()}
          sublabel={
            workforcePctOfRegion != null
              ? `${(workforcePctOfRegion * 100).toFixed(workforcePctOfRegion === 1 ? 0 : 1)}% of region`
              : 'inbound + local'
          }
          size="md"
        />
        <SubjectKpiCard
          label="Median Age"
          value={region.medianAge != null ? region.medianAge.toFixed(1) : '—'}
          sublabel="pop-weighted mean"
          size="sm"
        />
        <SubjectKpiCard
          label="Median HH Income"
          value={
            region.medianHhIncome != null
              ? `$${Math.round(region.medianHhIncome).toLocaleString()}`
              : '—'
          }
          sublabel="pop-weighted mean"
          size="sm"
        />
      </div>
    </div>
  );
}

function TrendCard({
  title,
  subtitle,
  series,
  singlePoints,
  color,
  singleSeriesName,
}: {
  title: string;
  subtitle?: string;
  series?: TrendSeries[];
  singlePoints?: TrendPoint[];
  color: string;
  singleSeriesName?: string;
}) {
  return (
    <div className="glass rounded-md p-3 flex flex-col gap-2 min-w-0 min-h-[280px] md:min-h-0 overflow-hidden">
      <div className="flex items-baseline justify-between gap-2">
        <div
          className="text-[10px] font-semibold uppercase tracking-wider truncate"
          style={{ color: 'var(--text-h)' }}
        >
          {title}
        </div>
        {subtitle && (
          <div className="text-[9px] tracking-wider truncate" style={{ color: 'var(--text-dim)' }}>
            {subtitle}
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0">
        {series ? (
          <MiniTrendChart
            series={series}
            height="fill"
            tooltipDateGranularity="annual"
          />
        ) : (
          <MiniTrendChart
            data={singlePoints ?? []}
            color={color}
            height="fill"
            name={singleSeriesName}
            tooltipDateGranularity="annual"
          />
        )}
      </div>
    </div>
  );
}

function RankedListCard({
  rows,
  metric,
  selectedIds,
  onSelect,
  geoLevel,
  accent,
  showYoyChip = false,
}: {
  rows: Array<{ id: string; name: string; value: number | null; yoyPct?: number | null }>;
  metric: DemographicsMetric;
  selectedIds: Set<string>;
  onSelect: (id: string) => void;
  geoLevel: GeoLevel;
  accent: string;
  // When true, render a signed-percent 10-yr change chip on each row.
  // Style mirrors the Glenwood Activity ranking card's YoY chip — green
  // for positive, red for negative, dim em-dash for null.
  showYoyChip?: boolean;
}) {
  // Diverging mode: any row with a negative value flips the bar layout to
  // anchor on a zero centerline so negative bars extend left and positive
  // bars extend right (instead of disappearing under a zero-width segment).
  // Auto-detected so we don't need a per-metric flag — works correctly for
  // any signed metric the demographics map adds in the future.
  const hasNegative = rows.some((r) => r.value != null && r.value < 0);
  const maxAbs = rows.reduce(
    (m, r) => Math.max(m, r.value != null ? Math.abs(r.value) : 0),
    0,
  );
  const max = rows.length ? (rows[0].value ?? 0) : 0;

  return (
    <div className="glass rounded-md p-3 flex flex-col gap-2 min-w-0 min-h-[280px] md:min-h-0 overflow-hidden">
      <div
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--text-h)' }}
      >
        {geoLevel === 'county' ? 'Counties' : 'Places'} by {metric.label.toLowerCase()}
      </div>
      {showYoyChip && (
        // Tiny column header so the YoY chip's denominator is self-evident.
        // Spacer spans mirror the row's column widths to keep "10Y" aligned
        // over the chip rather than relying on absolute positioning.
        <div className="flex items-center gap-2 px-1" aria-hidden="true">
          <span className="w-[80px] shrink-0" />
          <span className="flex-1" />
          <span className="w-[80px] shrink-0" />
          <span
            className="text-[9px] uppercase tracking-wider shrink-0 text-center"
            style={{ minWidth: 44, color: 'var(--text-dim)' }}
          >
            10Y
          </span>
        </div>
      )}
      <ul className="flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto">
        {rows.map((r) => {
          const active = selectedIds.has(r.id);
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onSelect(r.id)}
                className="w-full text-left flex items-center gap-2 px-1 py-1 rounded transition-colors"
                style={{
                  background: active ? `${accent}29` : 'transparent',
                }}
              >
                <span
                  className="text-[10px] truncate w-[80px] shrink-0"
                  style={{ color: active ? accent : 'var(--text-h)' }}
                  title={r.name}
                >
                  {r.name}
                </span>
                {hasNegative ? (
                  <DivergingBar
                    value={r.value}
                    maxAbs={maxAbs}
                    positiveColor={accent}
                    negativeColor={NEGATIVE_DIVERGING_COLOR}
                  />
                ) : (
                  <span
                    className="flex-1 h-2 rounded-full overflow-hidden"
                    style={{ background: 'rgba(255,255,255,0.05)' }}
                  >
                    <span
                      className="block h-full"
                      style={{
                        width: `${(r.value != null && max > 0 ? r.value / max : 0) * 100}%`,
                        background: accent,
                      }}
                    />
                  </span>
                )}
                <span
                  className="text-[10px] tabular-nums w-[80px] text-right shrink-0"
                  style={{ color: 'var(--text-h)' }}
                >
                  {metric.format(r.value)}
                </span>
                {showYoyChip && <YoyChip pct={r.yoyPct ?? null} />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Signed-percent chip used to surface 10-yr % change on the Population
// ranking. Visual mirrors the Glenwood Activity ranking card's YoY chip:
// green for positive, red for negative, dim em-dash for null.
function YoyChip({ pct }: { pct: number | null }) {
  const positive = pct != null && pct > 0;
  const negative = pct != null && pct < 0;
  const color = positive
    ? '#34d399'
    : negative
      ? '#f87171'
      : 'var(--text-dim)';
  const background = positive
    ? 'rgba(52, 211, 153, 0.12)'
    : negative
      ? 'rgba(248, 113, 113, 0.12)'
      : 'transparent';
  const text =
    pct == null ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
  return (
    <span
      className="text-[9px] tabular-nums shrink-0 text-right px-1 rounded"
      style={{ minWidth: 44, color, background }}
      title="10-yr % change"
    >
      {text}
    </span>
  );
}

function DivergingBar({
  value,
  maxAbs,
  positiveColor,
  negativeColor,
}: {
  value: number | null;
  maxAbs: number;
  positiveColor: string;
  negativeColor: string;
}) {
  const pct = value != null && maxAbs > 0 ? value / maxAbs : 0;
  // Half-width fractions, capped at 50% per side.
  const halfPct = Math.min(50, Math.abs(pct) * 50);
  const isPositive = pct >= 0;
  return (
    <span
      className="flex-1 h-2 rounded-full overflow-hidden relative"
      style={{ background: 'rgba(255,255,255,0.05)' }}
    >
      {/* Zero centerline */}
      <span
        className="absolute top-0 bottom-0"
        style={{
          left: '50%',
          width: 1,
          background: 'rgba(255,255,255,0.22)',
          transform: 'translateX(-0.5px)',
        }}
      />
      {value != null && (
        <span
          className="absolute top-0 bottom-0"
          style={
            isPositive
              ? { left: '50%', width: `${halfPct}%`, background: positiveColor }
              : { right: '50%', width: `${halfPct}%`, background: negativeColor }
          }
        />
      )}
    </span>
  );
}

// ---------- Helpers ----------

function aggregateDemographics(
  entities: Array<ContextPlaceEntry | ContextCountyEntry>,
  workforce: WorkforceTotals,
  level: GeoLevel,
): RegionAggregate {
  let pop = 0;
  let wf = 0;
  let weightedAge = 0;
  let popForAge = 0;
  let weightedIncome = 0;
  let popForIncome = 0;
  let under18 = 0;
  let over65 = 0;
  let hispanic = 0;
  for (const e of entities) {
    const l = e.latest;
    if (!l) continue;
    const p = numOrNull(l.population) ?? 0;
    pop += p;
    if (level === 'county' && 'geoid' in e) {
      wf += workforce.byCountyGeoid.get(e.geoid) ?? 0;
    } else if ('zip' in e) {
      wf += workforce.byZip.get(e.zip) ?? 0;
    }
    const age = numOrNull(l.medianAge);
    if (age != null && p > 0) {
      weightedAge += age * p;
      popForAge += p;
    }
    const inc = numOrNull(l.medianHhIncome);
    if (inc != null && p > 0) {
      weightedIncome += inc * p;
      popForIncome += p;
    }
    under18 += numOrNull(l.ageU18) ?? 0;
    over65 += numOrNull(l.age65plus) ?? 0;
    hispanic += numOrNull(l.hispanic) ?? 0;
  }
  return {
    population: pop,
    workforce: wf,
    medianAge: popForAge > 0 ? weightedAge / popForAge : null,
    medianHhIncome: popForIncome > 0 ? weightedIncome / popForIncome : null,
    under18,
    over65,
    hispanic,
  };
}

function aggregatedTrend(
  entities: Array<ContextPlaceEntry | ContextCountyEntry>,
  metricKey: string,
): TrendPoint[] {
  const yearMap = new Map<number, number>();
  for (const e of entities) {
    const trend = e.trend?.[metricKey] ?? [];
    for (const tp of trend) {
      if (tp.value == null) continue;
      yearMap.set(tp.year, (yearMap.get(tp.year) ?? 0) + tp.value);
    }
  }
  return Array.from(yearMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([year, value]) => ({ year, value }));
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

// Friendly trend-card title. Composite metrics (no trendKey, or trendKey
// falling back to 'population') retain "Population trend" wording so the
// chart caption matches what the user sees rendered.
function trendCardLabel(metric: DemographicsMetric, trendKey: string): string {
  if (!metric.trendKey) return 'Population trend';
  // Population 10-yr % keeps the population trend chart; phrase as the
  // underlying chart, not the metric.
  if (metric.id === 'population10yrPct') return 'Population trend';
  if (trendKey === 'population') return 'Population trend';
  return `${metric.label} trend`;
}
