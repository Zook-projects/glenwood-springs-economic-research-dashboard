// CommerceMapTile — left filter / info panel for the Commerce map view.
// Differs from Demographics/Housing tiles by using a 3-button Variant
// toggle (Gross/Retail/Taxable) instead of a metric grid, and by exposing
// a separate Cadence toggle (Annual/Monthly) that affects only the
// bottom-strip trend chart.

import type { ContextEnvelope, ContextLatest } from '../../types/context';
import {
  COMMERCE_METRICS,
  type CommerceCadence,
  type CommerceVariantId,
} from './commerceMetrics';
import { RAMPS, quintileBreaks } from '../../lib/subjectColorRamps';
import type { GeoLevel, MapLayerKind } from './SubjectMapOverlay';
import { MapToggleSegmented } from './MapToggleSegmented';

interface Props {
  bundle: ContextEnvelope;
  geoLevel: GeoLevel;
  onGeoLevelChange: (next: GeoLevel) => void;
  variantId: CommerceVariantId;
  onVariantChange: (next: CommerceVariantId) => void;
  cadence: CommerceCadence;
  onCadenceChange: (next: CommerceCadence) => void;
  mapLayer: MapLayerKind;
  onMapLayerChange: (next: MapLayerKind) => void;
  selectedZip: string | null;
  selectedCountyGeoid: string | null;
  countyFilter: string | null;
  onCountyFilterChange: (next: string | null) => void;
}

export function CommerceMapTile({
  bundle,
  geoLevel,
  onGeoLevelChange,
  variantId,
  onVariantChange,
  cadence,
  onCadenceChange,
  mapLayer,
  onMapLayerChange,
  selectedZip,
  selectedCountyGeoid,
  countyFilter,
  onCountyFilterChange,
}: Props) {
  const variant = COMMERCE_METRICS.find((m) => m.id === variantId)!;
  const ramp = RAMPS.commerce;

  const distribution = (() => {
    const entries = geoLevel === 'place' ? bundle.places : bundle.counties;
    const vals: number[] = [];
    for (const e of entries) {
      const v = variant.extract(e.latest);
      if (v != null) vals.push(v);
    }
    return vals.sort((a, b) => a - b);
  })();
  const breaks = quintileBreaks(distribution);

  const activeLatest: ContextLatest | null = (() => {
    if (selectedZip) return bundle.places.find((p) => p.zip === selectedZip)?.latest ?? null;
    if (selectedCountyGeoid)
      return bundle.counties.find((c) => c.geoid === selectedCountyGeoid)?.latest ?? null;
    return null;
  })();

  const aggregateGross = bundle.counties.reduce(
    (acc, c) => acc + (typeof c.latest?.cdorGrossSales === 'number' ? c.latest.cdorGrossSales : 0),
    0,
  );
  const aggregateRetail = bundle.counties.reduce(
    (acc, c) => acc + (typeof c.latest?.cdorRetailSales === 'number' ? c.latest.cdorRetailSales : 0),
    0,
  );
  const aggregateTaxable = bundle.counties.reduce(
    (acc, c) => acc + (typeof c.latest?.cdorNetTaxableSales === 'number' ? c.latest.cdorNetTaxableSales : 0),
    0,
  );

  const headlineValue = activeLatest
    ? variant.extract(activeLatest)
    : variantId === 'gross'
    ? aggregateGross
    : variantId === 'retail'
    ? aggregateRetail
    : aggregateTaxable;

  const activeLabel = (() => {
    if (selectedZip) return bundle.places.find((p) => p.zip === selectedZip)?.name ?? selectedZip;
    if (selectedCountyGeoid)
      return bundle.counties.find((c) => c.geoid === selectedCountyGeoid)?.name ?? selectedCountyGeoid;
    return `Region · ${bundle.counties.length} counties`;
  })();

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: ramp.accent }} />
          <span
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: ramp.accent }}
          >
            Commerce Map · v1
          </span>
        </div>
        <h1 className="text-base font-semibold leading-tight" style={{ color: 'var(--text-h)' }}>
          Roaring Fork & Colorado River Valley
        </h1>
        <div className="text-[10px] tracking-wider" style={{ color: 'var(--text-dim)' }}>
          {bundle.vintageRange.start}–{bundle.vintageRange.end} · CDOR sales filings ·{' '}
          {bundle.places.length} places · {bundle.counties.length} counties
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
          Colorado Department of Revenue (CDOR) publishes monthly sales filings at city and
          county levels. Three measures: <em>Gross Sales</em> (total business throughput),{' '}
          <em>Retail Sales</em> (merchant-to-consumer subset), and <em>Net Taxable Sales</em>{' '}
          (the state tax base after exemptions like groceries). Place-level coverage spans
          17 municipalities across 3 counties. Old Snowmass and other unincorporated areas
          show as gaps where CDOR doesn't publish a place-level breakout.
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

      <Section title="Variant (sales measure)">
        <MapToggleSegmented
          options={[
            { value: 'gross', label: 'Gross' },
            { value: 'retail', label: 'Retail' },
            { value: 'taxable', label: 'Taxable' },
          ]}
          value={variantId}
          onChange={(v) => onVariantChange(v as CommerceVariantId)}
          accent={ramp.accent}
          ariaLabel="Variant"
        />
      </Section>

      <Section title="Trend cadence">
        <MapToggleSegmented
          options={[
            { value: 'annual', label: 'Annual' },
            { value: 'monthly', label: 'Monthly' },
          ]}
          value={cadence}
          onChange={(v) => onCadenceChange(v as CommerceCadence)}
          accent={ramp.accent}
          ariaLabel="Trend cadence"
        />
        <div
          className="text-[10px] mt-1"
          style={{ color: 'var(--text-dim)' }}
        >
          Affects the bottom-strip trend chart only. The map always shows latest annual.
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
                  ? variant.format(distribution[0] ?? null)
                  : i === 4
                  ? variant.format(distribution[distribution.length - 1] ?? null)
                  : variant.format(breaks[i - 1] ?? null)}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title={activeLabel.toUpperCase()}>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label={`${variant.label}`} value={variant.format(headlineValue)} />
          <MiniStat label="Region · Gross" value={variant.format(aggregateGross)} />
        </div>
      </Section>
    </div>
  );
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
