// CommerceMapStrip — bottom card strip for the Commerce map view. Mirrors
// the Demographics / Housing strip pattern (geoLevel-aware Region card,
// Workforce KPI in position 2, multi-select toolbar, multi-series trend
// when items are selected) but uses the variant-aware annual/monthly trend
// rows from CommerceTrend.

import { useMemo } from 'react';
import type {
  CommerceTrend,
  ContextCountyEntry,
  ContextEnvelope,
  ContextPlaceEntry,
  TrendPoint,
} from '../../types/context';
import {
  COMMERCE_METRICS,
  type CommerceMetric,
  type CommerceVariantId,
  type CommerceCadence,
} from './commerceMetrics';
import { SubjectKpiCard } from './SubjectKpiCard';
import { MiniTrendChart, type TrendSeries } from './MiniTrendChart';
import { RAMPS, seriesColor } from '../../lib/subjectColorRamps';
import type { GeoLevel } from './SubjectMapOverlay';
import type { WorkforceTotals } from '../../lib/workforceTotals';
import { MultiSelectToolbar } from './MultiSelectToolbar';

const STRIP_CARD_HEIGHT = 220;

interface Props {
  bundle: ContextEnvelope;
  variantId: CommerceVariantId;
  cadence: CommerceCadence;
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
  gross: number;
  retail: number;
  taxable: number;
  workforce: number;
}

export function CommerceMapStrip({
  bundle,
  variantId,
  cadence,
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
  const variant = COMMERCE_METRICS.find((m) => m.id === variantId)!;
  const ramp = RAMPS.commerce;
  const accent = ramp.accent;

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

  const regionAggregate = useMemo<RegionAggregate>(() => {
    const entities = geoLevel === 'county' ? filteredCounties : filteredPlaces;
    return aggregateCommerce(entities, workforce, geoLevel);
  }, [filteredCounties, filteredPlaces, geoLevel, workforce]);

  const selectionAggregate = useMemo<RegionAggregate | null>(() => {
    if (totalSelected === 0) return null;
    if (activeCounties.length > 0) {
      return aggregateCommerce(activeCounties, workforce, 'county');
    }
    return aggregateCommerce(activePlaces, workforce, 'place');
  }, [totalSelected, activePlaces, activeCounties, workforce]);

  const rankedRows = useMemo(() => {
    const rows = (geoLevel === 'county' ? filteredCounties : filteredPlaces).map((e) => ({
      id: 'zip' in e ? e.zip : e.geoid,
      name: e.name,
      value: variant.extract(e.latest),
    }));
    return rows
      .filter((r) => r.value != null)
      .sort((a, b) => (b.value as number) - (a.value as number));
  }, [filteredCounties, filteredPlaces, geoLevel, variant]);

  const trendSeries = useMemo<TrendSeries[]>(() => {
    if (totalSelected === 0) {
      const entities = geoLevel === 'county' ? filteredCounties : filteredPlaces;
      return [
        {
          key: 'region',
          label: 'Region',
          color: accent,
          points: aggregatedCommerceTrend(entities, cadence, variant.trendField),
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
      points: entityCommerceTrend(e, cadence, variant.trendField),
    }));
  }, [
    totalSelected,
    activePlaces,
    activeCounties,
    filteredCounties,
    filteredPlaces,
    geoLevel,
    cadence,
    variant.trendField,
    accent,
  ]);

  const useMultiSeries = totalSelected > 0;

  const headlineAggregate = selectionAggregate ?? regionAggregate;
  const filterLabel = countyFilter
    ? bundle.counties.find((c) => c.geoid === countyFilter)?.name.replace(/ County$/, '') ?? 'Filtered'
    : 'Region';
  const headlineLabel = (() => {
    if (totalSelected === 0) {
      const ents = geoLevel === 'county' ? filteredCounties : filteredPlaces;
      return `${filterLabel} · ${ents.length} ${geoLevel === 'county' ? (ents.length === 1 ? 'county' : 'counties') : (ents.length === 1 ? 'place' : 'places')}`;
    }
    return `Selected · ${totalSelected} ${totalSelected === 1 ? 'item' : 'items'}`;
  })();

  // % of region — denominators come from regionAggregate (the *filtered*
  // region) so a county filter narrows the baseline: county-only view reads
  // 100%; selecting a place inside the county shows that place's share of
  // the county.
  const headlinePctOfRegion =
    regionAggregate[variant.trendField] > 0
      ? headlineAggregate[variant.trendField] / regionAggregate[variant.trendField]
      : null;
  const workforcePctOfRegion =
    regionAggregate.workforce > 0
      ? headlineAggregate.workforce / regionAggregate.workforce
      : null;

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
          variant={variant}
          label={headlineLabel}
          accent={selectionAggregate ? accent : undefined}
          headlinePctOfRegion={headlinePctOfRegion}
          workforcePctOfRegion={workforcePctOfRegion}
        />
        <TrendCard
          title={
            useMultiSeries
              ? `${variant.label} trend · selected`
              : countyFilter
              ? `${filterLabel} ${variant.label.toLowerCase()} trend`
              : `Regional ${variant.label.toLowerCase()} trend`
          }
          subtitle={
            useMultiSeries
              ? `${totalSelected} series · ${cadence}`
              : geoLevel === 'county'
              ? `sum of ${filteredCounties.length} ${filteredCounties.length === 1 ? 'county' : 'counties'} · ${cadence}`
              : `sum of ${filteredPlaces.length} ${filteredPlaces.length === 1 ? 'place' : 'places'} · ${cadence}`
          }
          series={useMultiSeries ? trendSeries : undefined}
          singlePoints={useMultiSeries ? undefined : trendSeries[0]?.points}
          color={accent}
          valueFormat={variant.format}
        />
        {singleEntity ? (
          <SingleEntityKpis
            entity={singleEntity}
            variant={variant}
            workforce={workforce}
            accent={accent}
            regionTotal={regionAggregate[variant.trendField]}
            regionWorkforce={regionAggregate.workforce}
            onClear={onClearSelections}
          />
        ) : (
          <RankedListCard
            rows={rankedRows}
            variant={variant}
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
  variant,
  label,
  accent,
  headlinePctOfRegion,
  workforcePctOfRegion,
}: {
  region: RegionAggregate;
  variant: CommerceMetric;
  label: string;
  accent?: string;
  headlinePctOfRegion: number | null;
  workforcePctOfRegion: number | null;
}) {
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
          label={variant.label}
          value={variant.format(region[variant.trendField])}
          sublabel={
            headlinePctOfRegion != null
              ? `${(headlinePctOfRegion * 100).toFixed(headlinePctOfRegion === 1 ? 0 : 1)}% of region`
              : undefined
          }
        />
        <SubjectKpiCard
          label="Workforce"
          value={Math.round(region.workforce).toLocaleString()}
          sublabel={
            workforcePctOfRegion != null
              ? `${(workforcePctOfRegion * 100).toFixed(workforcePctOfRegion === 1 ? 0 : 1)}% of region`
              : 'inbound + local'
          }
        />
        <SubjectKpiCard label="Retail" value={variant.format(region.retail)} size="sm" />
        <SubjectKpiCard label="Taxable" value={variant.format(region.taxable)} size="sm" />
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
            yMin="auto"
            valueFormat={valueFormat}
          />
        ) : (
          <MiniTrendChart
            data={singlePoints ?? []}
            color={color}
            height="fill"
            yMin="auto"
            valueFormat={valueFormat}
          />
        )}
      </div>
    </div>
  );
}

function RankedListCard({
  rows,
  variant,
  selectedIds,
  onSelect,
  geoLevel,
  accent,
}: {
  rows: Array<{ id: string; name: string; value: number | null }>;
  variant: CommerceMetric;
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
        {geoLevel === 'county' ? 'Counties' : 'Places'} by {variant.label.toLowerCase()}
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
                  background: active ? 'rgba(245, 185, 66, 0.16)' : 'transparent',
                }}
              >
                <span
                  className="text-[10px] truncate w-[90px] shrink-0"
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
                  className="text-[10px] tabular-nums w-[70px] text-right shrink-0"
                  style={{ color: 'var(--text-h)' }}
                >
                  {variant.format(r.value)}
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
  variant,
  workforce,
  accent,
  regionTotal,
  regionWorkforce,
  onClear,
}: {
  entity: ContextPlaceEntry | ContextCountyEntry;
  variant: CommerceMetric;
  workforce: WorkforceTotals;
  accent: string;
  regionTotal: number;
  regionWorkforce: number;
  onClear: () => void;
}) {
  const latest = entity.latest;
  const isPlace = 'zip' in entity;
  const wf = isPlace
    ? workforce.byZip.get(entity.zip) ?? null
    : workforce.byCountyGeoid.get(entity.geoid) ?? null;
  const value = variant.extract(latest);
  const pctOfRegion = value != null && regionTotal > 0 ? value / regionTotal : null;
  const wfPctOfRegion = wf != null && regionWorkforce > 0 ? wf / regionWorkforce : null;

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
          label={variant.label}
          value={variant.format(value)}
          sublabel={pctOfRegion != null ? `${(pctOfRegion * 100).toFixed(1)}% of region` : undefined}
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
        <SubjectKpiCard label="Retail" value={variant.format(numOrNull(latest?.cdorRetailSales))} size="sm" />
        <SubjectKpiCard label="Taxable" value={variant.format(numOrNull(latest?.cdorNetTaxableSales))} size="sm" />
      </div>
    </div>
  );
}

// ---------- Helpers ----------

function aggregateCommerce(
  entities: Array<ContextPlaceEntry | ContextCountyEntry>,
  workforce: WorkforceTotals,
  level: GeoLevel,
): RegionAggregate {
  let gross = 0;
  let retail = 0;
  let taxable = 0;
  let wf = 0;
  for (const e of entities) {
    const l = e.latest;
    if (!l) continue;
    gross += numOrNull(l.cdorGrossSales) ?? 0;
    retail += numOrNull(l.cdorRetailSales) ?? 0;
    taxable += numOrNull(l.cdorNetTaxableSales) ?? 0;
    if (level === 'county' && 'geoid' in e) {
      wf += workforce.byCountyGeoid.get(e.geoid) ?? 0;
    } else if ('zip' in e) {
      wf += workforce.byZip.get(e.zip) ?? 0;
    }
  }
  return { gross, retail, taxable, workforce: wf };
}

function aggregatedCommerceTrend(
  entities: Array<ContextPlaceEntry | ContextCountyEntry>,
  cadence: CommerceCadence,
  field: 'gross' | 'retail' | 'taxable',
): TrendPoint[] {
  if (cadence === 'annual') {
    const yearMap = new Map<number, number>();
    for (const e of entities) {
      const trend = (e.trend as unknown as CommerceTrend | undefined)?.annual ?? [];
      for (const row of trend) {
        const v = row[field];
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        yearMap.set(row.year, (yearMap.get(row.year) ?? 0) + v);
      }
    }
    return Array.from(yearMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([year, value]) => ({ year, value }));
  }
  const acc = new Map<number, number>();
  for (const e of entities) {
    const trend = (e.trend as unknown as CommerceTrend | undefined)?.monthly ?? [];
    for (const row of trend) {
      const v = row[field];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const key = row.year + (row.month - 1) / 12;
      acc.set(key, (acc.get(key) ?? 0) + v);
    }
  }
  return Array.from(acc.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([year, value]) => ({ year, value }));
}

function entityCommerceTrend(
  entity: ContextPlaceEntry | ContextCountyEntry,
  cadence: CommerceCadence,
  field: 'gross' | 'retail' | 'taxable',
): TrendPoint[] {
  const t = entity.trend as unknown as CommerceTrend | undefined;
  if (!t) return [];
  if (cadence === 'annual') {
    return (t.annual ?? []).map((r) => {
      const v = r[field];
      return { year: r.year, value: typeof v === 'number' && Number.isFinite(v) ? v : null };
    });
  }
  return (t.monthly ?? []).map((r) => {
    const v = r[field];
    const key = r.year + (r.month - 1) / 12;
    return { year: key, value: typeof v === 'number' && Number.isFinite(v) ? v : null };
  });
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}
