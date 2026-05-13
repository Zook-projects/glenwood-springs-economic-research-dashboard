// DemographicsMapTile — left filter / info panel for the Demographics map
// view. Hosts: about-this-data card, geo-level toggle (place/county),
// metric selector, map-layer toggle (symbols/choropleth), color legend,
// and a small headline-KPI mini-strip for the active scope.

import type { ContextEnvelope, ContextLatest } from '../../types/context';
import {
  DEMOGRAPHICS_METRICS,
  type DemographicsMetric,
  type DemographicsMetricId,
} from './demographicsMetrics';
import { RAMPS, quintileBreaks } from '../../lib/subjectColorRamps';
import type { GeoLevel, MapLayerKind } from './SubjectMapOverlay';
import { MapToggleSegmented } from './MapToggleSegmented';

export type { GeoLevel, MapLayerKind };

interface Props {
  bundle: ContextEnvelope;
  geoLevel: GeoLevel;
  onGeoLevelChange: (next: GeoLevel) => void;
  metricId: DemographicsMetricId;
  onMetricChange: (next: DemographicsMetricId) => void;
  mapLayer: MapLayerKind;
  onMapLayerChange: (next: MapLayerKind) => void;
  // Active scope: a place selected on the map, or null = aggregate region.
  selectedZip: string | null;
  // Selected county (when geoLevel === 'county' and user clicks a county).
  selectedCountyGeoid: string | null;
  // County GEOID to scope the visible places / counties to a single county;
  // null = all counties. Independent from selectedCountyGeoid (which is a
  // click selection on a county polygon).
  countyFilter: string | null;
  onCountyFilterChange: (next: string | null) => void;
}

export function DemographicsMapTile({
  bundle,
  geoLevel,
  onGeoLevelChange,
  metricId,
  onMetricChange,
  mapLayer,
  onMapLayerChange,
  selectedZip,
  selectedCountyGeoid,
  countyFilter,
  onCountyFilterChange,
}: Props) {
  const metric = DEMOGRAPHICS_METRICS.find((m) => m.id === metricId)!;
  const ramp = RAMPS.demographics;

  // Compute the visible distribution for the legend, scoped to the current
  // geo-level. Used to render quintile bin labels.
  const distribution = (() => {
    const entries = geoLevel === 'place' ? bundle.places : bundle.counties;
    const vals: number[] = [];
    for (const e of entries) {
      const v = metric.extract(e.latest);
      if (v != null) vals.push(v);
    }
    return vals.sort((a, b) => a - b);
  })();
  const breaks = quintileBreaks(distribution);

  // Active entry for the headline mini-strip — selected place > selected
  // county > regional aggregate (sum/avg of all places).
  const activeLatest: ContextLatest | null = (() => {
    if (selectedZip) {
      return bundle.places.find((p) => p.zip === selectedZip)?.latest ?? null;
    }
    if (selectedCountyGeoid) {
      return bundle.counties.find((c) => c.geoid === selectedCountyGeoid)?.latest ?? null;
    }
    return null;
  })();

  // Compute an aggregate snapshot when no entity is selected.
  const aggregateSnapshot = (() => {
    if (activeLatest) return null;
    let pop = 0;
    let popDenomForAge = 0;
    let weightedAge = 0;
    let popDenomForIncome = 0;
    let weightedIncome = 0;
    for (const p of bundle.places) {
      const lp = p.latest;
      if (!lp) continue;
      const pp = typeof lp.population === 'number' ? lp.population : 0;
      pop += pp;
      const ma = typeof lp.medianAge === 'number' ? lp.medianAge : null;
      if (ma != null && pp > 0) {
        weightedAge += ma * pp;
        popDenomForAge += pp;
      }
      const inc = typeof lp.medianHhIncome === 'number' ? lp.medianHhIncome : null;
      if (inc != null && pp > 0) {
        weightedIncome += inc * pp;
        popDenomForIncome += pp;
      }
    }
    return {
      population: pop,
      medianAge: popDenomForAge > 0 ? weightedAge / popDenomForAge : null,
      medianHhIncome: popDenomForIncome > 0 ? weightedIncome / popDenomForIncome : null,
    };
  })();

  const activeLabel = (() => {
    if (selectedZip) {
      const p = bundle.places.find((pp) => pp.zip === selectedZip);
      return p?.name ?? selectedZip;
    }
    if (selectedCountyGeoid) {
      const c = bundle.counties.find((cc) => cc.geoid === selectedCountyGeoid);
      return c?.name ?? selectedCountyGeoid;
    }
    return 'Region · 11 anchor places';
  })();

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: ramp.accent }}
          />
          <span
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--accent)' }}
          >
            Demographics Map · v1
          </span>
        </div>
        <h1
          className="text-base font-semibold leading-tight"
          style={{ color: 'var(--text-h)' }}
        >
          Roaring Fork & Colorado River Valley
        </h1>
        <div
          className="text-[10px] tracking-wider"
          style={{ color: 'var(--text-dim)' }}
        >
          {bundle.vintageRange.start}–{bundle.vintageRange.end} · ACS 5-Year + CO SDO ·{' '}
          {bundle.places.length} anchor places · {bundle.counties.length} counties
        </div>
      </div>

      {/* About this data */}
      <div
        className="rounded-md p-3 flex flex-col gap-2"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid var(--panel-border)',
        }}
      >
        <div
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-h)' }}
        >
          About this data
        </div>
        <p
          className="text-[11px] leading-snug"
          style={{ color: 'var(--text)' }}
        >
          The American Community Survey 5-Year Estimates pool five years of household
          sample to publish demographic, age, race, household, and income tables.
          Place-level population uses the Colorado State Demography Office's annual
          Vintage estimates — calibrated to local building permits, vital statistics,
          and migration. Counties join three units (Eagle, Garfield, Pitkin)
          covering the study area.
        </p>
      </div>

      {/* Geo level toggle */}
      <Section title="Geographic level">
        <MapToggleSegmented
          options={[
            { value: 'place', label: 'Places' },
            { value: 'county', label: 'Counties' },
          ]}
          value={geoLevel}
          onChange={(v) => onGeoLevelChange(v as GeoLevel)}
          accent={ramp.accent}
          ariaLabel="Geographic level"
        />
      </Section>

      {/* County filter */}
      <Section title="County filter">
        <MapToggleSegmented
          options={[
            { value: null, label: 'All' },
            ...bundle.counties.map((c) => ({
              value: c.geoid,
              label: c.name.replace(/ County$/, ''),
            })),
          ]}
          value={countyFilter}
          onChange={onCountyFilterChange}
          accent={ramp.accent}
          ariaLabel="County filter"
        />
      </Section>

      {/* Metric selector — 2-col grid of accent-bordered tiles. */}
      <Section title="Metric">
        <div className="grid grid-cols-2 gap-1">
          {DEMOGRAPHICS_METRICS.map((m) => (
            <MetricButton
              key={m.id}
              metric={m}
              accent={ramp.accent}
              active={m.id === metricId}
              onClick={() => onMetricChange(m.id)}
            />
          ))}
        </div>
      </Section>

      {/* Map layer toggle */}
      <Section title="Map layer">
        <MapToggleSegmented
          options={[
            { value: 'symbols', label: 'Symbols' },
            { value: 'choropleth', label: 'Choropleth' },
          ]}
          value={mapLayer}
          onChange={(v) => onMapLayerChange(v as MapLayerKind)}
          accent={ramp.accent}
          ariaLabel="Map layer"
        />
        <div
          className="text-[10px] mt-1"
          style={{ color: 'var(--text-dim)' }}
        >
          Symbols: scaled circle at each place centroid. Choropleth: county
          polygons filled by quintile.
        </div>
      </Section>

      {/* Color legend */}
      <Section title="Legend">
        <div className="flex items-stretch gap-px">
          {ramp.palette.map((c, i) => (
            <div
              key={c}
              className="flex-1 flex flex-col items-center gap-1"
            >
              <div
                className="h-3 w-full"
                style={{ background: c }}
                aria-hidden="true"
              />
              <div
                className="text-[9px]"
                style={{ color: 'var(--text-dim)' }}
              >
                {i === 0
                  ? metric.format(distribution[0] ?? null)
                  : i === 4
                  ? metric.format(distribution[distribution.length - 1] ?? null)
                  : metric.format(breaks[i - 1] ?? null)}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Headline mini-strip — active scope */}
      <Section title={activeLabel.toUpperCase()}>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat
            label={metric.label}
            value={
              activeLatest
                ? metric.format(metric.extract(activeLatest))
                : aggregateSnapshot
                ? metric.format(metric.extract(aggregateSnapshot as unknown as ContextLatest))
                : '—'
            }
          />
          <MiniStat
            label="Population"
            value={
              activeLatest
                ? typeof activeLatest.population === 'number'
                  ? Math.round(activeLatest.population).toLocaleString()
                  : '—'
                : aggregateSnapshot
                ? aggregateSnapshot.population.toLocaleString()
                : '—'
            }
          />
          <MiniStat
            label="Median Age"
            value={
              activeLatest
                ? typeof activeLatest.medianAge === 'number'
                  ? activeLatest.medianAge.toFixed(1)
                  : '—'
                : aggregateSnapshot && aggregateSnapshot.medianAge != null
                ? aggregateSnapshot.medianAge.toFixed(1)
                : '—'
            }
          />
          <MiniStat
            label="Median HH Income"
            value={
              activeLatest
                ? typeof activeLatest.medianHhIncome === 'number'
                  ? `$${Math.round(activeLatest.medianHhIncome).toLocaleString()}`
                  : '—'
                : aggregateSnapshot && aggregateSnapshot.medianHhIncome != null
                ? `$${Math.round(aggregateSnapshot.medianHhIncome).toLocaleString()}`
                : '—'
            }
          />
        </div>
      </Section>
    </div>
  );
}

// ---------- Sub-components ----------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--text-dim)' }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function MetricButton({
  metric,
  accent,
  active,
  onClick,
}: {
  metric: DemographicsMetric;
  accent: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={metric.label}
      className="text-left px-2 py-1.5 rounded text-[10px] font-medium uppercase tracking-wider transition-colors focus:outline-none focus-visible:ring-1"
      style={{
        background: active ? `${accent}29` : 'rgba(255,255,255,0.03)',
        border: `1px solid ${active ? accent : 'var(--panel-border)'}`,
        color: active ? accent : 'var(--text-h)',
      }}
    >
      {metric.shortLabel}
    </button>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-md p-2 flex flex-col gap-0.5 min-w-0"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--panel-border)',
      }}
    >
      <div
        className="text-[9px] uppercase tracking-wider truncate"
        style={{ color: 'var(--text-dim)' }}
      >
        {label}
      </div>
      <div
        className="text-[14px] font-semibold truncate"
        style={{ color: 'var(--text-h)' }}
      >
        {value}
      </div>
    </div>
  );
}
