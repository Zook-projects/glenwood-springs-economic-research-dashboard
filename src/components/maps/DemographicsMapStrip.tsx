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
  TrendPoint,
} from '../../types/context';
import {
  DEMOGRAPHICS_METRICS,
  type DemographicsMetric,
  type DemographicsMetricId,
} from './demographicsMetrics';
import { SubjectKpiCard } from './SubjectKpiCard';
import { MiniTrendChart, type TrendSeries } from './MiniTrendChart';
import { RAMPS, seriesColor } from '../../lib/subjectColorRamps';
import type { GeoLevel } from './SubjectMapOverlay';
import type { WorkforceTotals } from '../../lib/workforceTotals';
import { MultiSelectToolbar } from './MultiSelectToolbar';

const STRIP_CARD_HEIGHT = 220;

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
  const rankedRows = useMemo(() => {
    const rows = (geoLevel === 'county' ? filteredCounties : filteredPlaces).map((e) => ({
      id: 'zip' in e ? e.zip : e.geoid,
      name: e.name,
      value: metric.extract(e.latest),
    }));
    return rows
      .filter((r) => r.value != null)
      .sort((a, b) => (b.value as number) - (a.value as number));
  }, [filteredCounties, filteredPlaces, geoLevel, metric]);

  // Trend series — multi-series when ≥1 entity selected, otherwise the
  // single regional aggregate line.
  const trendSeries = useMemo<TrendSeries[]>(() => {
    if (totalSelected === 0) {
      return [
        {
          key: 'region',
          label: 'Region',
          color: accent,
          points: aggregatedTrend(
            geoLevel === 'county' ? filteredCounties : filteredPlaces,
            'population',
          ),
        },
      ];
    }
    const entities: Array<ContextPlaceEntry | ContextCountyEntry> = [
      ...activePlaces,
      ...activeCounties,
    ];
    return entities.map((e, i) => ({
      key: 'zip' in e ? e.zip : e.geoid,
      label: e.name,
      color: seriesColor(i),
      points: e.trend?.population ?? [],
    }));
  }, [totalSelected, activePlaces, activeCounties, filteredCounties, filteredPlaces, geoLevel, accent]);

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

  return (
    <div className="px-3 flex flex-col gap-2">
      <MultiSelectToolbar
        multiSelect={multiSelect}
        onMultiSelectChange={onMultiSelectChange}
        totalSelected={totalSelected}
        onClearSelections={onClearSelections}
        accent={accent}
      />
      <div
        className="grid grid-cols-1 md:grid-cols-3 gap-3"
        style={{ height: STRIP_CARD_HEIGHT }}
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
        />
        <TrendCard
          title={
            useMultiSeries
              ? 'Population trend · selected'
              : countyFilter
              ? `${filterLabel} population trend`
              : 'Regional population trend'
          }
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
}: {
  region: RegionAggregate;
  metric: DemographicsMetric;
  label: string;
  accent?: string;
  headlinePctOfRegion: number | null;
  workforcePctOfRegion: number | null;
}) {
  const synthLatest: ContextLatest = {
    population: region.population,
    medianAge: region.medianAge,
    medianHhIncome: region.medianHhIncome,
    ageU18: region.under18,
    age65plus: region.over65,
    hispanic: region.hispanic,
  };
  const headline = metric.extract(synthLatest);

  return (
    <div
      className="glass rounded-md p-3 flex flex-col gap-2 min-w-0 min-h-0 overflow-hidden"
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
      <div className="grid grid-cols-2 gap-2 flex-1 min-h-0">
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
}: {
  title: string;
  subtitle?: string;
  series?: TrendSeries[];
  singlePoints?: TrendPoint[];
  color: string;
}) {
  return (
    <div className="glass rounded-md p-3 flex flex-col gap-2 min-w-0 min-h-0 overflow-hidden">
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
          <MiniTrendChart series={series} height="fill" />
        ) : (
          <MiniTrendChart data={singlePoints ?? []} color={color} height="fill" />
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
}: {
  rows: Array<{ id: string; name: string; value: number | null }>;
  metric: DemographicsMetric;
  selectedIds: Set<string>;
  onSelect: (id: string) => void;
  geoLevel: GeoLevel;
  accent: string;
}) {
  const max = rows.length ? (rows[0].value ?? 0) : 0;
  return (
    <div className="glass rounded-md p-3 flex flex-col gap-2 min-w-0 min-h-0 overflow-hidden">
      <div
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--text-h)' }}
      >
        {geoLevel === 'county' ? 'Counties' : 'Places'} by {metric.label.toLowerCase()}
      </div>
      <ul className="flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto">
        {rows.map((r) => {
          const pct = r.value != null && max > 0 ? r.value / max : 0;
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
                <span
                  className="flex-1 h-2 rounded-full overflow-hidden"
                  style={{ background: 'rgba(255,255,255,0.05)' }}
                >
                  <span
                    className="block h-full"
                    style={{ width: `${pct * 100}%`, background: accent }}
                  />
                </span>
                <span
                  className="text-[10px] tabular-nums w-[80px] text-right shrink-0"
                  style={{ color: 'var(--text-h)' }}
                >
                  {metric.format(r.value)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
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
