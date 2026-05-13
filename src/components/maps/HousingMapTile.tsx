// HousingMapTile — left filter / info panel for the Housing map view.
// Hosts: about-this-data card, geo-level toggle (place/county), metric
// selector, map-layer toggle (symbols/choropleth), color legend, and a
// small headline-KPI mini-strip for the active scope.

import type { ContextEnvelope, ContextLatest } from '../../types/context';
import {
  HOUSING_METRICS,
  type HousingMetric,
  type HousingMetricId,
} from './housingMetrics';
import { RAMPS, quintileBreaks } from '../../lib/subjectColorRamps';
import type { GeoLevel, MapLayerKind } from './SubjectMapOverlay';
import { MapToggleSegmented } from './MapToggleSegmented';

interface Props {
  bundle: ContextEnvelope;
  geoLevel: GeoLevel;
  onGeoLevelChange: (next: GeoLevel) => void;
  metricId: HousingMetricId;
  onMetricChange: (next: HousingMetricId) => void;
  mapLayer: MapLayerKind;
  onMapLayerChange: (next: MapLayerKind) => void;
  selectedZip: string | null;
  selectedCountyGeoid: string | null;
  countyFilter: string | null;
  onCountyFilterChange: (next: string | null) => void;
}

export function HousingMapTile({
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
  const metric = HOUSING_METRICS.find((m) => m.id === metricId)!;
  const ramp = RAMPS.housing;

  // Filter out the national benchmark place ("US") from the place set we
  // display on the map / use for distributions — it has no Colorado centroid.
  const studyPlaces = bundle.places.filter((p) => p.kind !== 'national');

  const distribution = (() => {
    const entries = geoLevel === 'place' ? studyPlaces : bundle.counties;
    const vals: number[] = [];
    for (const e of entries) {
      const v = metric.extract(e.latest);
      if (v != null) vals.push(v);
    }
    return vals.sort((a, b) => a - b);
  })();
  const breaks = quintileBreaks(distribution);

  const activeLatest: ContextLatest | null = (() => {
    if (selectedZip) return studyPlaces.find((p) => p.zip === selectedZip)?.latest ?? null;
    if (selectedCountyGeoid)
      return bundle.counties.find((c) => c.geoid === selectedCountyGeoid)?.latest ?? null;
    return null;
  })();

  // Aggregate snapshot for the headline mini-strip when nothing selected.
  // For housing, sums where it makes sense (units), unit-weighted means for
  // ZHVI / median rent, ratios over summed counts (owner %, burden %).
  const aggregateSnapshot = (() => {
    if (activeLatest) return null;
    let units = 0;
    let owner = 0;
    let renter = 0;
    let burden = 0;
    let weightedZhvi = 0;
    let weightedZhviDenom = 0;
    let weightedRent = 0;
    let weightedRentDenom = 0;
    for (const p of studyPlaces) {
      const lp = p.latest;
      if (!lp) continue;
      const u = typeof lp.totalHousingUnits === 'number' ? lp.totalHousingUnits : 0;
      units += u;
      owner += typeof lp.ownerOccupied === 'number' ? lp.ownerOccupied : 0;
      renter += typeof lp.renterOccupied === 'number' ? lp.renterOccupied : 0;
      burden += typeof lp.costBurden30 === 'number' ? lp.costBurden30 : 0;
      const zhvi = typeof lp.zhvi === 'number' ? lp.zhvi : null;
      if (zhvi != null && u > 0) {
        weightedZhvi += zhvi * u;
        weightedZhviDenom += u;
      }
      const rent = typeof lp.medianGrossRent === 'number' ? lp.medianGrossRent : null;
      if (rent != null && u > 0) {
        weightedRent += rent * u;
        weightedRentDenom += u;
      }
    }
    return {
      totalHousingUnits: units,
      ownerOccupied: owner,
      renterOccupied: renter,
      costBurden30: burden,
      zhvi: weightedZhviDenom > 0 ? weightedZhvi / weightedZhviDenom : null,
      medianGrossRent: weightedRentDenom > 0 ? weightedRent / weightedRentDenom : null,
    };
  })();

  const activeLabel = (() => {
    if (selectedZip) return studyPlaces.find((p) => p.zip === selectedZip)?.name ?? selectedZip;
    if (selectedCountyGeoid)
      return bundle.counties.find((c) => c.geoid === selectedCountyGeoid)?.name ?? selectedCountyGeoid;
    return `Region · ${studyPlaces.length} anchor places`;
  })();

  // Helpers to derive headline values across active vs. aggregate scopes.
  const ownerPct = (() => {
    const own = num((activeLatest ?? aggregateSnapshot)?.ownerOccupied);
    const rent = num((activeLatest ?? aggregateSnapshot)?.renterOccupied);
    if (own == null || rent == null || own + rent === 0) return null;
    return own / (own + rent);
  })();
  const burdenPct = (() => {
    const burden = num((activeLatest ?? aggregateSnapshot)?.costBurden30);
    const own = num((activeLatest ?? aggregateSnapshot)?.ownerOccupied);
    const rent = num((activeLatest ?? aggregateSnapshot)?.renterOccupied);
    const denom = (own ?? 0) + (rent ?? 0);
    if (burden == null || denom === 0) return null;
    return burden / denom;
  })();
  const zhviHeadline = num((activeLatest ?? aggregateSnapshot)?.zhvi);

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: ramp.accent }} />
          <span
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: ramp.accent }}
          >
            Housing Map · v1
          </span>
        </div>
        <h1 className="text-base font-semibold leading-tight" style={{ color: 'var(--text-h)' }}>
          Roaring Fork & Colorado River Valley
        </h1>
        <div className="text-[10px] tracking-wider" style={{ color: 'var(--text-dim)' }}>
          {bundle.vintageRange.start}–{bundle.vintageRange.end} · Zillow ZHVI + ACS B25 + CO SDO ·{' '}
          {studyPlaces.length} anchor places · {bundle.counties.length} counties
        </div>
      </div>

      <div
        className="rounded-md p-3 flex flex-col gap-2"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--panel-border)' }}
      >
        <div
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-h)' }}
        >
          About this data
        </div>
        <p className="text-[11px] leading-snug" style={{ color: 'var(--text)' }}>
          Combines three authoritative sources at place, county, and state level. Annual unit
          totals, occupancy, and vacancy come from the Colorado SDO Vintage estimates. Median
          home value (B25077), tenure, year-built (B25034), and cost-burden (B25070/B25091)
          come from ACS 5-Year Estimates. Typical home value (ZHVI) and asking rent (ZORI)
          come from Zillow Research's monthly index, annualized.
        </p>
      </div>

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

      <Section title="Metric">
        <div className="grid grid-cols-2 gap-1">
          {HOUSING_METRICS.map((m) => (
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
      </Section>

      <Section title="Legend">
        <div className="flex items-stretch gap-px">
          {ramp.palette.map((c, i) => (
            <div key={c} className="flex-1 flex flex-col items-center gap-1">
              <div className="h-3 w-full" style={{ background: c }} aria-hidden="true" />
              <div className="text-[9px]" style={{ color: 'var(--text-dim)' }}>
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

      <Section title={activeLabel.toUpperCase()}>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label={metric.label} value={metric.format(metric.extract(activeLatest ?? (aggregateSnapshot as ContextLatest | null)))} />
          <MiniStat label="ZHVI" value={zhviHeadline != null ? `$${Math.round(zhviHeadline).toLocaleString()}` : '—'} />
          <MiniStat label="Owner Occ." value={ownerPct != null ? `${(ownerPct * 100).toFixed(0)}%` : '—'} />
          <MiniStat label="Cost Burden" value={burdenPct != null ? `${(burdenPct * 100).toFixed(0)}%` : '—'} />
        </div>
      </Section>
    </div>
  );
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
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
  metric: HousingMetric;
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
    <div className="rounded-md p-2 flex flex-col gap-0.5 min-w-0" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--panel-border)' }}>
      <div className="text-[9px] uppercase tracking-wider truncate" style={{ color: 'var(--text-dim)' }}>
        {label}
      </div>
      <div className="text-[14px] font-semibold truncate" style={{ color: 'var(--text-h)' }}>
        {value}
      </div>
    </div>
  );
}
