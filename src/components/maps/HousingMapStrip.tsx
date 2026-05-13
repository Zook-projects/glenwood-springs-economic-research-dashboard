// HousingMapStrip — bottom card strip for the Housing map view. Renders as
// an absolute overlay (set up by MapShell) with .glass cards. Mirrors the
// Demographics strip pattern: geoLevel-aware Region card, Workforce KPI in
// position 2, multi-select toolbar above, multi-series trend with legend
// when items are selected.

import { useMemo } from 'react';
import type {
  ContextCountyEntry,
  ContextEnvelope,
  ContextLatest,
  ContextPlaceEntry,
  TrendPoint,
} from '../../types/context';
import {
  HOUSING_METRICS,
  type HousingMetric,
  type HousingMetricId,
} from './housingMetrics';
import { SubjectKpiCard } from './SubjectKpiCard';
import { MiniTrendChart, type TrendSeries } from './MiniTrendChart';
import { RAMPS, seriesColor } from '../../lib/subjectColorRamps';
import type { GeoLevel } from './SubjectMapOverlay';
import type { WorkforceTotals } from '../../lib/workforceTotals';
import { MultiSelectToolbar } from './MultiSelectToolbar';

const STRIP_CARD_HEIGHT = 220;

interface Props {
  bundle: ContextEnvelope;
  metricId: HousingMetricId;
  geoLevel: GeoLevel;
  countyFilter: string | null;
  selectedZips: Set<string>;
  selectedCountyGeoids: Set<string>;
  multiSelect: boolean;
  onMultiSelectChange: (next: boolean) => void;
  onSelectZip: (zip: string) => void;
  onSelectCounty: (geoid: string) => void;
  onClearSelections: () => void;
  workforce: WorkforceTotals;
}

interface RegionAggregate {
  totalHousingUnits: number;
  ownerOccupied: number;
  renterOccupied: number;
  costBurden30: number;
  zhvi: number | null;
  workforce: number;
}

export function HousingMapStrip({
  bundle,
  metricId,
  geoLevel,
  countyFilter,
  selectedZips,
  selectedCountyGeoids,
  multiSelect,
  onMultiSelectChange,
  onSelectZip,
  onSelectCounty,
  onClearSelections,
  workforce,
}: Props) {
  const metric = HOUSING_METRICS.find((m) => m.id === metricId)!;
  const ramp = RAMPS.housing;
  const accent = ramp.accent;

  const studyPlaces = useMemo(
    () => bundle.places.filter((p) => p.kind !== 'national'),
    [bundle.places],
  );

  const filteredPlaces = useMemo(
    () => studyPlaces.filter((p) => !countyFilter || p.countyGeoid === countyFilter),
    [studyPlaces, countyFilter],
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

  const regionAggregate = useMemo<RegionAggregate>(() => {
    const entities = geoLevel === 'county' ? filteredCounties : filteredPlaces;
    return aggregateHousing(entities, workforce, geoLevel);
  }, [filteredCounties, filteredPlaces, geoLevel, workforce]);

  const selectionAggregate = useMemo<RegionAggregate | null>(() => {
    if (totalSelected === 0) return null;
    if (activeCounties.length > 0) {
      return aggregateHousing(activeCounties, workforce, 'county');
    }
    return aggregateHousing(activePlaces, workforce, 'place');
  }, [totalSelected, activePlaces, activeCounties, workforce]);

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

  const trendSeries = useMemo<TrendSeries[]>(() => {
    if (totalSelected === 0) {
      return [
        {
          key: 'region',
          label: 'Region',
          color: accent,
          points: weightedZhviTrend(geoLevel === 'county' ? filteredCounties : filteredPlaces),
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
      points: e.trend?.zhvi ?? [],
    }));
  }, [totalSelected, activePlaces, activeCounties, filteredCounties, filteredPlaces, geoLevel, accent]);

  const useMultiSeries = totalSelected > 0;

  const headlineAggregate = selectionAggregate ?? regionAggregate;
  const workforcePctOfRegion =
    regionAggregate.workforce > 0
      ? headlineAggregate.workforce / regionAggregate.workforce
      : null;
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

  const showSingleDetail = !multiSelect && totalSelected === 1;
  const singleEntity: ContextPlaceEntry | ContextCountyEntry | null =
    showSingleDetail ? (activePlaces[0] ?? activeCounties[0] ?? null) : null;

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
          workforcePctOfRegion={workforcePctOfRegion}
        />
        <TrendCard
          title={
            useMultiSeries
              ? 'ZHVI trend · selected'
              : countyFilter
              ? `${filterLabel} ZHVI trend`
              : 'Regional ZHVI trend'
          }
          subtitle={
            useMultiSeries
              ? `${totalSelected} series`
              : geoLevel === 'county'
              ? `unit-weighted across ${filteredCounties.length} ${filteredCounties.length === 1 ? 'county' : 'counties'}`
              : `unit-weighted across ${filteredPlaces.length} ${filteredPlaces.length === 1 ? 'place' : 'places'}`
          }
          series={useMultiSeries ? trendSeries : undefined}
          singlePoints={useMultiSeries ? undefined : trendSeries[0]?.points}
          color={accent}
          valueFormat={(v) => `$${Math.round(v / 1000)}k`}
        />
        {singleEntity ? (
          <SingleEntityKpis
            entity={singleEntity}
            metric={metric}
            workforce={workforce}
            accent={accent}
            regionWorkforce={regionAggregate.workforce}
            onClear={onClearSelections}
          />
        ) : (
          <RankedListCard
            rows={rankedRows}
            metric={metric}
            selectedIds={
              activeCounties.length > 0
                ? new Set([...selectedCountyGeoids])
                : new Set([...selectedZips])
            }
            onSelect={(id) =>
              activeCounties.length > 0 || geoLevel === 'county'
                ? onSelectCounty(id)
                : onSelectZip(id)
            }
            geoLevel={geoLevel}
            accent={accent}
          />
        )}
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
  workforcePctOfRegion,
}: {
  region: RegionAggregate;
  metric: HousingMetric;
  label: string;
  accent?: string;
  workforcePctOfRegion: number | null;
}) {
  const synthLatest: ContextLatest = {
    totalHousingUnits: region.totalHousingUnits,
    ownerOccupied: region.ownerOccupied,
    renterOccupied: region.renterOccupied,
    costBurden30: region.costBurden30,
    zhvi: region.zhvi,
  };
  const headline = metric.extract(synthLatest);
  const ownPct =
    region.ownerOccupied + region.renterOccupied > 0
      ? region.ownerOccupied / (region.ownerOccupied + region.renterOccupied)
      : null;
  const burdPct =
    region.ownerOccupied + region.renterOccupied > 0
      ? region.costBurden30 / (region.ownerOccupied + region.renterOccupied)
      : null;

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
        <SubjectKpiCard label={metric.label} value={metric.format(headline)} />
        <SubjectKpiCard
          label="Workforce"
          value={Math.round(region.workforce).toLocaleString()}
          sublabel={
            workforcePctOfRegion != null
              ? `${(workforcePctOfRegion * 100).toFixed(workforcePctOfRegion === 1 ? 0 : 1)}% of region`
              : 'inbound + local'
          }
        />
        <SubjectKpiCard
          label="Owner Occupied"
          value={ownPct != null ? `${(ownPct * 100).toFixed(0)}%` : '—'}
          size="sm"
        />
        <SubjectKpiCard
          label="Cost Burdened (≥30%)"
          value={burdPct != null ? `${(burdPct * 100).toFixed(0)}%` : '—'}
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
  valueFormat,
}: {
  title: string;
  subtitle?: string;
  series?: TrendSeries[];
  singlePoints?: TrendPoint[];
  color: string;
  valueFormat?: (v: number) => string;
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
          <div
            className="text-[9px] tracking-wider truncate"
            style={{ color: 'var(--text-dim)' }}
          >
            {subtitle}
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0">
        {series ? (
          <MiniTrendChart
            series={series}
            height="fill"
            yMin="zero"
            valueFormat={valueFormat}
          />
        ) : (
          <MiniTrendChart
            data={singlePoints ?? []}
            color={color}
            height="fill"
            yMin="zero"
            valueFormat={valueFormat}
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
}: {
  rows: Array<{ id: string; name: string; value: number | null }>;
  metric: HousingMetric;
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
                  background: active ? 'rgba(229, 143, 182, 0.16)' : 'transparent',
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

function SingleEntityKpis({
  entity,
  metric,
  workforce,
  accent,
  regionWorkforce,
  onClear,
}: {
  entity: ContextPlaceEntry | ContextCountyEntry;
  metric: HousingMetric;
  workforce: WorkforceTotals;
  accent: string;
  regionWorkforce: number;
  onClear: () => void;
}) {
  const latest = entity.latest;
  const isPlace = 'zip' in entity;
  const wf = isPlace
    ? workforce.byZip.get(entity.zip) ?? null
    : workforce.byCountyGeoid.get(entity.geoid) ?? null;
  const wfPctOfRegion = wf != null && regionWorkforce > 0 ? wf / regionWorkforce : null;

  const ownPct = (() => {
    const own = numOrNull(latest?.ownerOccupied);
    const rent = numOrNull(latest?.renterOccupied);
    if (own == null || rent == null || own + rent === 0) return null;
    return own / (own + rent);
  })();
  const burdPct = (() => {
    const burden = numOrNull(latest?.costBurden30);
    const own = numOrNull(latest?.ownerOccupied);
    const rent = numOrNull(latest?.renterOccupied);
    const denom = (own ?? 0) + (rent ?? 0);
    if (burden == null || denom === 0) return null;
    return burden / denom;
  })();

  return (
    <div
      className="glass rounded-md p-3 flex flex-col gap-2 min-w-0 min-h-0 overflow-hidden"
      style={{ borderColor: accent }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: accent }}
          />
          <div
            className="text-[10px] font-semibold uppercase tracking-wider truncate"
            style={{ color: accent }}
          >
            {entity.name}
          </div>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded hover:bg-white/10"
          style={{ color: 'var(--text-dim)' }}
        >
          Clear
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 flex-1 min-h-0">
        <SubjectKpiCard
          label={metric.label}
          value={metric.format(metric.extract(latest))}
          active
        />
        <SubjectKpiCard
          label="Workforce"
          value={wf != null ? Math.round(wf).toLocaleString() : '—'}
          sublabel={
            wfPctOfRegion != null
              ? `${(wfPctOfRegion * 100).toFixed(1)}% of region`
              : 'inbound + local'
          }
        />
        <SubjectKpiCard
          label="Owner Occ."
          value={ownPct != null ? `${(ownPct * 100).toFixed(0)}%` : '—'}
          size="sm"
        />
        <SubjectKpiCard
          label="Cost Burdened"
          value={burdPct != null ? `${(burdPct * 100).toFixed(0)}%` : '—'}
          size="sm"
        />
      </div>
    </div>
  );
}

// ---------- Helpers ----------

function aggregateHousing(
  entities: Array<ContextPlaceEntry | ContextCountyEntry>,
  workforce: WorkforceTotals,
  level: GeoLevel,
): RegionAggregate {
  let units = 0;
  let owner = 0;
  let renter = 0;
  let burden = 0;
  let weightedZhvi = 0;
  let weightedZhviDenom = 0;
  let wf = 0;
  for (const e of entities) {
    const l = e.latest;
    if (!l) continue;
    const u = numOrNull(l.totalHousingUnits) ?? 0;
    units += u;
    owner += numOrNull(l.ownerOccupied) ?? 0;
    renter += numOrNull(l.renterOccupied) ?? 0;
    burden += numOrNull(l.costBurden30) ?? 0;
    const z = numOrNull(l.zhvi);
    if (z != null && u > 0) {
      weightedZhvi += z * u;
      weightedZhviDenom += u;
    }
    if (level === 'county' && 'geoid' in e) {
      wf += workforce.byCountyGeoid.get(e.geoid) ?? 0;
    } else if ('zip' in e) {
      wf += workforce.byZip.get(e.zip) ?? 0;
    }
  }
  return {
    totalHousingUnits: units,
    ownerOccupied: owner,
    renterOccupied: renter,
    costBurden30: burden,
    zhvi: weightedZhviDenom > 0 ? weightedZhvi / weightedZhviDenom : null,
    workforce: wf,
  };
}

function weightedZhviTrend(
  entities: Array<ContextPlaceEntry | ContextCountyEntry>,
): TrendPoint[] {
  const yearAcc = new Map<number, { weighted: number; denom: number }>();
  for (const e of entities) {
    const trend = e.trend?.zhvi ?? [];
    const u = numOrNull(e.latest?.totalHousingUnits) ?? 1;
    for (const tp of trend) {
      if (tp.value == null) continue;
      const cur = yearAcc.get(tp.year) ?? { weighted: 0, denom: 0 };
      cur.weighted += tp.value * u;
      cur.denom += u;
      yearAcc.set(tp.year, cur);
    }
  }
  return Array.from(yearAcc.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([year, { weighted, denom }]) => ({
      year,
      value: denom > 0 ? weighted / denom : null,
    }));
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}
