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

const STRIP_CARD_HEIGHT = 260;

interface Props {
  bundle: ContextEnvelope;
  metricId: HousingMetricId;
  geoLevel: GeoLevel;
  countyFilter: string | null;
  selectedZips: Set<string>;
  selectedCountyGeoids: Set<string>;
  multiSelect: boolean;
  onMultiSelectChange: (next: boolean) => void;
  // Ranked-list click handlers (always toggle in/out — the ranked list is
  // the canonical multi-select comparison surface). Map-symbol clicks live
  // on SubjectMapOverlay and don't flow through the strip.
  onToggleZip: (zip: string) => void;
  onToggleCounty: (geoid: string) => void;
  onClearSelections: () => void;
  workforce: WorkforceTotals;
}

interface RegionAggregate {
  totalHousingUnits: number;
  ownerOccupied: number;
  renterOccupied: number;
  costBurden30: number;
  zhvi: number | null;
  zhviSfr: number | null;
  zhviCondo: number | null;
  medianGrossRent: number | null;
  vacancyPct: number | null;
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
  onToggleZip,
  onToggleCounty,
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

  const trendKey = metric.trendKey ?? 'zhvi';
  const histKey = metric.historicalTrendKey;
  const trendSeries = useMemo<TrendSeries[]>(() => {
    const scopeEntities = geoLevel === 'county' ? filteredCounties : filteredPlaces;
    if (totalSelected === 0) {
      // Prefer the metric's historical series (decennial + anchor) when
      // available — gives a longer time horizon. Falls through to the
      // annual `trend` block, then to the canonical ZHVI trend.
      let points: TrendPoint[] = [];
      if (histKey) {
        points = aggregatedHistoricalTrend(scopeEntities, histKey);
      }
      if (points.length === 0) {
        points = weightedTrend(scopeEntities, trendKey);
      }
      if (points.length === 0 && trendKey !== 'zhvi') {
        points = weightedTrend(scopeEntities, 'zhvi');
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
      // Per-entity series uses historicalTrend first if the metric prefers
      // it; falls back to annual trend, then to ZHVI as a last resort.
      const histSeries = histKey ? e.historicalTrend?.[histKey] ?? [] : [];
      const annualSeries = e.trend?.[trendKey] ?? [];
      const fallback = e.trend?.zhvi ?? [];
      const points =
        histSeries.length > 0
          ? histSeries
          : annualSeries.length > 0
          ? annualSeries
          : fallback;
      return {
        key: 'zip' in e ? e.zip : e.geoid,
        label: e.name,
        color: seriesColor(i),
        points,
      };
    });
  }, [totalSelected, activePlaces, activeCounties, filteredCounties, filteredPlaces, geoLevel, accent, trendKey, histKey]);

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
          workforcePctOfRegion={workforcePctOfRegion}
        />
        <TrendCard
          title={(() => {
            // Title pivots to whichever metric's trend is actually rendered
            // — for metrics without their own trend series, the chart falls
            // back to ZHVI so the label follows.
            const trendLabel = housingTrendLabel(metric, trendKey);
            if (useMultiSeries) return `${trendLabel} · selected`;
            return countyFilter
              ? `${filterLabel} ${trendLabel.toLowerCase()}`
              : `Regional ${trendLabel.toLowerCase()}`;
          })()}
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
          valueFormat={housingValueFormat(metric, trendKey)}
          singleSeriesName={housingTrendLabel(metric, trendKey).replace(/ trend$/, '')}
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
    // Mirror the aggregate into the SDO field so the metric extract's
    // SDO-first preference resolves to the same total regardless of which
    // field name it reads.
    housingUnitsTotal: region.totalHousingUnits,
    ownerOccupied: region.ownerOccupied,
    renterOccupied: region.renterOccupied,
    costBurden30: region.costBurden30,
    zhvi: region.zhvi,
    zhviSfr: region.zhviSfr,
    zhviCondo: region.zhviCondo,
    medianGrossRent: region.medianGrossRent,
    vacancyPct: region.vacancyPct,
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
  singleSeriesName,
}: {
  title: string;
  subtitle?: string;
  series?: TrendSeries[];
  singlePoints?: TrendPoint[];
  color: string;
  valueFormat?: (v: number) => string;
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
            tooltipDateGranularity="annual"
          />
        ) : (
          <MiniTrendChart
            data={singlePoints ?? []}
            color={color}
            height="fill"
            yMin="zero"
            valueFormat={valueFormat}
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
    <div className="glass rounded-md p-3 flex flex-col gap-2 min-w-0 min-h-[280px] md:min-h-0 overflow-hidden">
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
  let weightedZhviSfr = 0;
  let weightedZhviSfrDenom = 0;
  let weightedZhviCondo = 0;
  let weightedZhviCondoDenom = 0;
  let weightedRent = 0;
  let weightedRentDenom = 0;
  let weightedVacancy = 0;
  let weightedVacancyDenom = 0;
  let wf = 0;
  for (const e of entities) {
    const l = e.latest;
    if (!l) continue;
    // Prefer the SDO 2024 housing-unit total (more current and matches the
    // latest point on the historical chart); fall back to ACS B25001 for
    // ZCTAs that have no SDO coverage.
    const u =
      numOrNull(l.housingUnitsTotal) ?? numOrNull(l.totalHousingUnits) ?? 0;
    units += u;
    owner += numOrNull(l.ownerOccupied) ?? 0;
    renter += numOrNull(l.renterOccupied) ?? 0;
    burden += numOrNull(l.costBurden30) ?? 0;
    const z = numOrNull(l.zhvi);
    if (z != null && u > 0) {
      weightedZhvi += z * u;
      weightedZhviDenom += u;
    }
    const zSfr = numOrNull(l.zhviSfr);
    if (zSfr != null && u > 0) {
      weightedZhviSfr += zSfr * u;
      weightedZhviSfrDenom += u;
    }
    const zCondo = numOrNull(l.zhviCondo);
    if (zCondo != null && u > 0) {
      weightedZhviCondo += zCondo * u;
      weightedZhviCondoDenom += u;
    }
    const rent = numOrNull(l.medianGrossRent);
    if (rent != null && u > 0) {
      weightedRent += rent * u;
      weightedRentDenom += u;
    }
    const vac = numOrNull(l.vacancyPct);
    if (vac != null && u > 0) {
      weightedVacancy += vac * u;
      weightedVacancyDenom += u;
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
    zhviSfr: weightedZhviSfrDenom > 0 ? weightedZhviSfr / weightedZhviSfrDenom : null,
    zhviCondo: weightedZhviCondoDenom > 0 ? weightedZhviCondo / weightedZhviCondoDenom : null,
    medianGrossRent: weightedRentDenom > 0 ? weightedRent / weightedRentDenom : null,
    vacancyPct: weightedVacancyDenom > 0 ? weightedVacancy / weightedVacancyDenom : null,
    workforce: wf,
  };
}

// Decennial historical trend aggregated by simple sum across entities.
// Used for `historicalTrend.housingUnits` (NHGIS 1970→2020 + present-day
// SDO anchor) so the regional line plots stock growth over half a century.
// Unit counts are additive, not unit-weighted means.
function aggregatedHistoricalTrend(
  entities: Array<ContextPlaceEntry | ContextCountyEntry>,
  metricKey: string,
): TrendPoint[] {
  const yearMap = new Map<number, number>();
  for (const e of entities) {
    const trend = e.historicalTrend?.[metricKey] ?? [];
    for (const tp of trend) {
      if (tp.value == null) continue;
      yearMap.set(tp.year, (yearMap.get(tp.year) ?? 0) + tp.value);
    }
  }
  return Array.from(yearMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([year, value]) => ({ year, value }));
}

// Unit-weighted aggregate trend across a list of entities, keyed by metric.
// Each entity's per-year value is weighted by its current totalHousingUnits
// so the regional line tracks place-size, not place-count.
function weightedTrend(
  entities: Array<ContextPlaceEntry | ContextCountyEntry>,
  metricKey: string,
): TrendPoint[] {
  const yearAcc = new Map<number, { weighted: number; denom: number }>();
  for (const e of entities) {
    const trend = e.trend?.[metricKey] ?? [];
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

// Trend-card title for the active metric. When the metric has no trendKey
// or the trend falls back to ZHVI, the title stays "ZHVI Average trend" so
// the caption matches what the chart actually renders.
function housingTrendLabel(metric: HousingMetric, trendKey: string): string {
  if (!metric.trendKey) return 'ZHVI Average trend';
  if (trendKey === 'zhvi') return 'ZHVI Average trend';
  return `${metric.label} trend`;
}

// Y-axis formatter chosen to match the trend metric's units. Dollar metrics
// keep the $K formatter; housing-unit and percentage metrics get formatters
// that read correctly at their own magnitude.
function housingValueFormat(
  metric: HousingMetric,
  trendKey: string,
): ((v: number) => string) | undefined {
  // Fallback to ZHVI trend → keep dollar formatter.
  if (!metric.trendKey || trendKey === 'zhvi') {
    return (v) => `$${Math.round(v / 1000)}k`;
  }
  if (trendKey === 'medianGrossRent') {
    return (v) => `$${Math.round(v).toLocaleString()}`;
  }
  if (trendKey === 'housingUnits') {
    return (v) => Math.round(v).toLocaleString();
  }
  if (trendKey === 'zhviSfr' || trendKey === 'zhviCondo') {
    return (v) => `$${Math.round(v / 1000)}k`;
  }
  // Fractional percentages (0–1) — owner-occupied + cost-burdened shares.
  if (trendKey === 'pctOwnerOccupied' || trendKey === 'pctCostBurdened30') {
    return (v) => `${(v * 100).toFixed(0)}%`;
  }
  // SDO vacancy is already expressed as a percentage (8.4 → "8.4%").
  if (trendKey === 'vacancyPct') {
    return (v) => `${v.toFixed(1)}%`;
  }
  return undefined;
}
