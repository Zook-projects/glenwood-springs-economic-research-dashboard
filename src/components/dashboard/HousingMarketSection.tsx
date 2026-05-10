// HousingMarketSection — full Zillow ZHVI panel for the Dashboard's Housing
// section. Renders five charts driven by the regional housing context bundle:
//
//   1. Headline statistics — Typical Home Value, Single Family, Condo for the
//      currently selected geography.
//   2. Typical Home Value by City — multi-line time series, 2000 → latest,
//      one line per geography (cities, counties, state, US benchmark).
//   3. Housing Type Comparison (radar) — 8-axis polygon for the active
//      geography across 1BR / 2BR / 3BR / 4BR / 5+BR / Average / Condo /
//      Single Family.
//   4. Housing Type Comparison (bars) — same eight values, vertical bars.
//   5. Typical Home Value by City Comparison — sortable bar chart across all
//      geographies. Doubles as the geography filter: clicking a bar sets the
//      active geography for the headline stats / radar / housing-type bars.
//
// Pure SVG + d3-shape / d3-scale, mirroring the rendering style used across
// the rest of the dashboard. No new dependencies.

import { useEffect, useMemo, useState } from 'react';
import { line as d3Line, area as d3Area } from 'd3-shape';
import { scaleLinear, scaleBand } from 'd3-scale';
import type {
  ContextBundle,
  ContextEnvelope,
  ContextLatest,
  ContextTrend,
  TrendPoint,
} from '../../types/context';
import { fmtInt } from '../../lib/format';

// ---------------------------------------------------------------------------
// Geography model
// ---------------------------------------------------------------------------
type GeoKind = 'place' | 'county' | 'state' | 'national';

interface Geography {
  id: string;
  label: string;
  kind: GeoKind;
  latest: ContextLatest | null;
  trend: ContextTrend;
  historicalTrend: ContextTrend;
}

function deriveGeographies(housing: ContextEnvelope | null): Geography[] {
  if (!housing) return [];
  const out: Geography[] = [];
  for (const p of housing.places) {
    if (p.kind === 'national') {
      out.push({
        id: `national:${p.zip}`, label: p.name, kind: 'national',
        latest: p.latest, trend: p.trend, historicalTrend: p.historicalTrend ?? {},
      });
    } else {
      out.push({
        id: `place:${p.zip}`, label: p.name, kind: 'place',
        latest: p.latest, trend: p.trend, historicalTrend: p.historicalTrend ?? {},
      });
    }
  }
  for (const c of housing.counties) {
    out.push({
      id: `county:${c.geoid}`, label: c.name, kind: 'county',
      latest: c.latest, trend: c.trend, historicalTrend: c.historicalTrend ?? {},
    });
  }
  if (housing.state) {
    out.push({
      id: `state:${housing.state.fips}`, label: housing.state.name, kind: 'state',
      latest: housing.state.latest, trend: housing.state.trend,
      historicalTrend: housing.state.historicalTrend ?? {},
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Visual tokens
// ---------------------------------------------------------------------------
// Palette tuned for the dashboard's near-black background. 16 colors covers
// the ~10 places + 4 counties + state + US benchmark superset. Geographies
// receive a stable color via index modulo palette length so the legend stays
// consistent across renders.
const GEO_PALETTE = [
  '#4FB3A9', // teal — Glenwood Springs
  '#7AC4D8', // cyan — Aspen
  '#9FB3C8', // periwinkle — Snowmass
  '#C8B273', // wheat — Basalt
  '#9CC479', // sage — Carbondale
  '#C29479', // adobe — De Beque
  '#B79CC4', // mauve — Parachute
  '#7C9DC4', // slate-blue — New Castle
  '#C47979', // brick — Rifle
  '#94C4B7', // mint — Silt
  '#FFB454', // amber accent — Garfield County
  '#A8A1C4', // lavender — Pitkin County
  '#A8C49C', // celadon — Eagle County
  '#C4A87C', // tan — Mesa County
  '#6E7280', // dim grey — Colorado
  '#9CA0A8', // lighter grey — United States
];

function geoColor(idx: number): string {
  return GEO_PALETTE[idx % GEO_PALETTE.length];
}

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------
const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const dollarFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function fmtDollarsCompact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}

function fmtDollars(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return dollarFmt.format(v);
}

// ---------------------------------------------------------------------------
// Housing-type axes (radar + bar chart)
// ---------------------------------------------------------------------------
// Order mirrors the Power BI mock: starts at 12 o'clock with Single Family,
// rotates clockwise (Condo, Average, 5+BR, 4BR, 3BR, 2BR, 1BR).
const TYPE_AXES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'zhviSfr',   label: 'Single Family' },
  { key: 'zhviCondo', label: 'Condo' },
  { key: 'zhviAvg',   label: 'Average' },
  { key: 'zhvi5br',   label: '5+ Bedroom' },
  { key: 'zhvi4br',   label: '4 Bedroom' },
  { key: 'zhvi3br',   label: '3 Bedroom' },
  { key: 'zhvi2br',   label: '2 Bedroom' },
  { key: 'zhvi1br',   label: '1 Bedroom' },
];

// The bar chart uses the same eight categories but in a more natural
// left-to-right reading order: bedroom counts ascending, then Average,
// Condo, Single Family.
const TYPE_BAR_ORDER: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'zhvi1br',   label: '1 Bedroom' },
  { key: 'zhvi2br',   label: '2 Bedroom' },
  { key: 'zhvi3br',   label: '3 Bedroom' },
  { key: 'zhvi4br',   label: '4 Bedroom' },
  { key: 'zhvi5br',   label: '5+ Bedroom' },
  { key: 'zhviAvg',   label: 'Average' },
  { key: 'zhviCondo', label: 'Condo' },
  { key: 'zhviSfr',   label: 'Single Family' },
];

const TYPE_KEY_MAP: Record<string, string> = {
  zhvi1br: 'zhviBr1',
  zhvi2br: 'zhviBr2',
  zhvi3br: 'zhviBr3',
  zhvi4br: 'zhviBr4',
  zhvi5br: 'zhviBr5',
  zhviAvg: 'zhvi',
  zhviCondo: 'zhviCondo',
  zhviSfr: 'zhviSfr',
};

function typeValue(latest: ContextLatest | null, axisKey: string): number | null {
  if (!latest) return null;
  const realKey = TYPE_KEY_MAP[axisKey];
  const v = latest[realKey];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// ---------------------------------------------------------------------------
// Shared chart frame (mirrors FlowCharts.ChartFrame)
// ---------------------------------------------------------------------------
export function ChartFrame({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-md p-3 flex flex-col gap-2 ${className ?? ''}`}
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--panel-border)',
      }}
    >
      <div>
        <div
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-h)' }}
        >
          {title}
        </div>
        {subtitle && (
          <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
            {subtitle}
          </div>
        )}
      </div>
      <div className="flex-1 flex flex-col">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Housing-section "About" tile — describes the non-Zillow data sources that
// drive the upper half of the section (SDO, ACS B25 series, NHGIS). Lives at
// the very top of the section so a casual reader knows what they're looking
// at. The Zillow subsection at the bottom of the section gets its own
// dedicated About tile (ZillowDataSetTile below).
// ---------------------------------------------------------------------------
function HousingDataSetTile() {
  return (
    <div
      className="rounded-md p-3 flex flex-col gap-2"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--panel-border)',
      }}
    >
      <div>
        <div
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-h)' }}
        >
          About this data
        </div>
        <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
          CO SDO Vintage 2024 · U.S. Census ACS B25 · NHGIS decennial
        </div>
      </div>
      <p className="text-[11px] leading-snug" style={{ color: 'var(--text)' }}>
        This section synthesizes three authoritative sources to characterize
        the housing stock at place, county, and state level. Annual unit
        totals, occupancy, vacancy, and household size come from the Colorado
        State Demography Office&rsquo;s Vintage 2024 estimates — calibrated
        to local building permits, vital statistics, and migration. Median
        home value, rent, tenure, year built (B25034), and cost burden
        (B25070 / B25091) come from the U.S. Census ACS 5-Year Estimates.
        Decennial housing-unit history (1970 → 2020) comes from IPUMS
        NHGIS reconciled to current geographic boundaries.
      </p>
      <ul className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1 mt-1">
        <li className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            Sources
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-h)' }}>CO SDO · Census ACS · NHGIS</span>
        </li>
        <li className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            Geography
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-h)' }}>Place · County · State</span>
        </li>
        <li className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            Cadence
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-h)' }}>Annual + decennial</span>
        </li>
        <li className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            Coverage
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-h)' }}>1970 → latest</span>
        </li>
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Headline statistics — ACS-derived KPIs for the active geography. Surfaces
// the affordability ratio (median home value ÷ median HH income),
// owner-occupied share, and cost-burdened share so the section opens with
// a three-metric snapshot independent of Zillow ZHVI (Zillow's own
// headline lives in the dedicated Zillow subsection at the bottom).
// ---------------------------------------------------------------------------
function HeadlineStats({
  geo,
  vintageEnd,
  medianHhIncome,
}: {
  geo: Geography | null;
  vintageEnd: number | null;
  // Active geography's median household income, joined from the
  // demographics envelope by the parent section. Used to compute the
  // affordability ratio inline; null when income data is unavailable for
  // this geography.
  medianHhIncome: number | null;
}) {
  const latest = geo?.latest ?? null;
  const medValue = readNum(latest, 'medianHomeValueAcs');
  const ratio = medValue != null && medianHhIncome != null && medianHhIncome > 0
    ? medValue / medianHhIncome
    : null;
  const owner = readNum(latest, 'ownerOccupied') ?? 0;
  const renter = readNum(latest, 'renterOccupied') ?? 0;
  const tenureUniverse = owner + renter;
  const ownerShare = tenureUniverse > 0 ? (owner / tenureUniverse) * 100 : null;
  const cb30 = readNum(latest, 'costBurden30');
  const burdenedShare = tenureUniverse > 0 && cb30 != null
    ? (cb30 / tenureUniverse) * 100
    : null;

  const items: { label: string; value: string }[] = [
    {
      label: 'Affordability ratio',
      value: ratio != null ? `${ratio.toFixed(1)}×` : '—',
    },
    {
      label: 'Owner-occupied',
      value: ownerShare != null ? `${ownerShare.toFixed(0)}%` : '—',
    },
    {
      label: 'Cost-burdened',
      value: burdenedShare != null ? `${burdenedShare.toFixed(0)}%` : '—',
    },
  ];

  return (
    <div
      className="rounded-md p-3 flex flex-col gap-2"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--panel-border)',
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-h)' }}
          >
            Housing Snapshot
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
            {geo?.label ?? '—'} · ACS 5-Year{vintageEnd ? ` ${vintageEnd}` : ''}
          </div>
        </div>
      </div>
      <div className="flex-1 flex items-center">
        <div className="grid grid-cols-3 gap-3 w-full justify-items-center text-center">
          {items.map((it) => (
            <div key={it.label} className="flex flex-col items-center">
              <div
                className="text-xl font-semibold tabular-nums"
                style={{ color: 'var(--text-h)' }}
              >
                {it.value}
              </div>
              <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                {it.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zillow subsection — dedicated About tile + headline stats for the ZHVI /
// type comparison block at the bottom of the section.
// ---------------------------------------------------------------------------
function ZillowDataSetTile() {
  return (
    <div
      className="rounded-md p-3 flex flex-col gap-2"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--panel-border)',
      }}
    >
      <div>
        <div
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-h)' }}
        >
          About this data
        </div>
        <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
          Zillow Home Value Index (ZHVI)
        </div>
      </div>
      <p className="text-[11px] leading-snug" style={{ color: 'var(--text)' }}>
        ZHVI is a smoothed, seasonally adjusted measure of typical home value
        across a region and housing type. It reflects the 35th–65th percentile
        of homes — neither the cheapest nor the most expensive — so it tracks
        the value of a middle-of-the-market home rather than a sale-price
        average skewed by listings at the extremes. Use ZHVI alongside the
        ACS median home value (above) for cross-validation: ZHVI updates
        monthly with ~1-month lag, while the ACS estimate uses a 5-year
        rolling sample with ~2-year lag.
      </p>
      <ul className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1 mt-1">
        <li className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            Source
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-h)' }}>Zillow Research</span>
        </li>
        <li className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            Metric
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-h)' }}>ZHVI ($USD)</span>
        </li>
        <li className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            Cadence
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-h)' }}>Monthly · annualized</span>
        </li>
        <li className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            Coverage
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-h)' }}>2000 → latest</span>
        </li>
      </ul>
    </div>
  );
}

function ZillowHeadlineStats({ geo }: { geo: Geography | null }) {
  const latest = geo?.latest ?? null;
  const items: { label: string; value: number | null }[] = [
    { label: 'Typical Home Value', value: typeValue(latest, 'zhviAvg') },
    { label: 'Single Family',      value: typeValue(latest, 'zhviSfr') },
    { label: 'Condo',              value: typeValue(latest, 'zhviCondo') },
  ];
  return (
    <div
      className="rounded-md p-3 flex flex-col gap-2"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--panel-border)',
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-h)' }}
          >
            ZHVI Snapshot
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
            {geo?.label ?? '—'} · Zillow ZHVI
          </div>
        </div>
      </div>
      <div className="flex-1 flex items-center">
        <div className="grid grid-cols-3 gap-3 w-full justify-items-center text-center">
          {items.map((it) => (
            <div key={it.label} className="flex flex-col items-center">
              <div
                className="text-xl font-semibold tabular-nums"
                style={{ color: 'var(--text-h)' }}
              >
                {fmtDollars(it.value)}
              </div>
              <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                {it.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time-series chart — Typical Home Value by City
// ---------------------------------------------------------------------------
function TimeSeriesChart({
  geographies,
  activeId,
  highlightId,
  onActivate,
  typeKey = 'zhviAvg',
}: {
  geographies: Geography[];
  // Non-null when the user has clicked a city — narrows the rendered set
  // to ONLY that city's line. Null = render all cities.
  activeId: string | null;
  // Which city is visually highlighted in the legend / dots / tooltip.
  // Falls back to the section's default city even when no filter is
  // active, so the legend still shows a primary anchor.
  highlightId: string | null;
  onActivate: (id: string) => void;
  // Trend metric key (matches TYPE_AXES.key). Default is the average
  // ZHVI trend; passing 'zhviSfr', 'zhvi3br', etc. retargets every line
  // onto that housing-type's trend.
  typeKey?: string;
}) {
  // Compute year domain + value domain across all visible series. Filters
  // out geographies that lack a trend for the active type key so the
  // legend stays meaningful. When activeId is set we additionally filter
  // to that city — clicking a bar in the city-comparison chart narrows
  // the time series to a single line.
  const series = useMemo(() => {
    const trendKey = TYPE_KEY_MAP[typeKey] ?? 'zhvi';
    return geographies
      .map((g, idx) => {
        const trend = (g.trend?.[trendKey] ?? []).filter((p): p is TrendPoint & { value: number } => p.value != null);
        return { geo: g, color: geoColor(idx), trend };
      })
      .filter((s) => s.trend.length > 0)
      .filter((s) => activeId == null || s.geo.id === activeId);
  }, [geographies, typeKey, activeId]);

  const { xMin, xMax, yMax } = useMemo(() => {
    let xMin = Infinity, xMax = -Infinity, yMax = 0;
    for (const s of series) {
      for (const p of s.trend) {
        if (p.year < xMin) xMin = p.year;
        if (p.year > xMax) xMax = p.year;
        if (p.value > yMax) yMax = p.value;
      }
    }
    if (!Number.isFinite(xMin)) xMin = 2000;
    if (!Number.isFinite(xMax)) xMax = 2024;
    return { xMin, xMax, yMax };
  }, [series]);

  // Layout — viewBox-based. The container scales the SVG to its parent.
  const W = 720;
  const H = 280;
  const M = { top: 8, right: 12, bottom: 24, left: 52 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  const sx = useMemo(() => scaleLinear().domain([xMin, xMax]).range([0, innerW]), [xMin, xMax, innerW]);
  const sy = useMemo(() => scaleLinear().domain([0, yMax * 1.05 || 1]).range([innerH, 0]), [yMax, innerH]);

  const lineGen = useMemo(
    () =>
      d3Line<TrendPoint & { value: number }>()
        .x((d) => sx(d.year))
        .y((d) => sy(d.value)),
    [sx, sy],
  );

  // Y-axis ticks (round to nice $0.5M increments).
  const yTicks = useMemo(() => sy.ticks(4), [sy]);
  const xTicks = useMemo(() => {
    // 5–7 ticks across the year range, prefer multiples of 5.
    const span = xMax - xMin;
    const step = span > 20 ? 5 : span > 10 ? 2 : 1;
    const out: number[] = [];
    for (let y = Math.ceil(xMin / step) * step; y <= xMax; y += step) out.push(y);
    return out;
  }, [xMin, xMax]);

  // Hover state — year currently focused by the user's cursor. The tooltip
  // surfaces the value for every visible series at that year.
  const [hoverYear, setHoverYear] = useState<number | null>(null);

  // Legend-driven highlight. Independent of the section-wide `activeId`
  // filter (which is driven by the City Comparison bar chart). Clicking a
  // legend item emphasizes that series without removing the others, so
  // peers stay in view for context. Clicking the same item toggles it off.
  const [legendHighlight, setLegendHighlight] = useState<string | null>(null);
  // When an external filter is applied or cleared, drop any local legend
  // highlight so the two states don't desync.
  useEffect(() => {
    setLegendHighlight(null);
  }, [activeId]);
  const effectiveHighlight = legendHighlight ?? highlightId;

  // Map a viewBox-space x coord (within plot bounds) → nearest integer year
  // that has data on at least one series. Snapping keeps the tooltip aligned
  // with the actual data points instead of interpolating between them.
  const allYears = useMemo(() => {
    const set = new Set<number>();
    for (const s of series) for (const p of s.trend) set.add(p.year);
    return Array.from(set).sort((a, b) => a - b);
  }, [series]);

  const xToYear = (xViewBox: number): number | null => {
    if (allYears.length === 0) return null;
    const xData = sx.invert(xViewBox);
    let best = allYears[0];
    let bestDist = Math.abs(allYears[0] - xData);
    for (let i = 1; i < allYears.length; i++) {
      const d = Math.abs(allYears[i] - xData);
      if (d < bestDist) { bestDist = d; best = allYears[i]; }
    }
    return best;
  };

  const handleMove = (e: React.MouseEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const local = pt.matrixTransform(ctm.inverse());
    const xInPlot = local.x - M.left;
    if (xInPlot < 0 || xInPlot > innerW) return;
    const yr = xToYear(xInPlot);
    if (yr != null) setHoverYear(yr);
  };

  // Per-series value at the focused year (used for the dots + tooltip rows).
  const focused = useMemo(() => {
    if (hoverYear == null) return null;
    const rows = series
      .map((s) => {
        const pt = s.trend.find((p) => p.year === hoverYear);
        if (!pt) return null;
        return { geo: s.geo, color: s.color, value: pt.value };
      })
      .filter((x): x is { geo: Geography; color: string; value: number } => x != null)
      .sort((a, b) => b.value - a.value);
    if (rows.length === 0) return null;
    return { year: hoverYear, rows };
  }, [hoverYear, series]);

  // Tooltip x in % of viewBox so the floating HTML label can absolutely
  // position itself relative to the SVG container.
  const tooltipPct = useMemo(() => {
    if (!focused) return null;
    const cx = M.left + sx(focused.year);
    return { left: (cx / W) * 100 };
  }, [focused, sx, M.left]);

  return (
    <div className="flex flex-col gap-2 flex-1">
      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {series.map((s) => {
          const isActive = effectiveHighlight === s.geo.id;
          return (
            <button
              key={s.geo.id}
              onClick={() =>
                setLegendHighlight((prev) =>
                  prev === s.geo.id ? null : s.geo.id,
                )
              }
              className="flex items-center gap-1.5 text-[10px] tabular-nums"
              style={{
                color: isActive ? 'var(--accent)' : 'var(--text)',
                opacity: isActive || effectiveHighlight == null ? 1 : 0.6,
              }}
            >
              <span
                className="inline-block rounded-full"
                style={{
                  width: 8,
                  height: 8,
                  background: s.color,
                  boxShadow: isActive ? '0 0 0 2px var(--accent-soft)' : undefined,
                }}
              />
              {s.geo.label}
            </button>
          );
        })}
      </div>
      <div className="relative w-full flex-1 flex flex-col" style={{ minHeight: 240 }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="w-full h-full"
          style={{ display: 'block', flex: 1, minHeight: 200 }}
          onMouseLeave={() => setHoverYear(null)}
        >
          <g transform={`translate(${M.left}, ${M.top})`}>
            {/* Y gridlines + tick labels */}
            {yTicks.map((t) => (
              <g key={t}>
                <line
                  x1={0}
                  x2={innerW}
                  y1={sy(t)}
                  y2={sy(t)}
                  stroke="var(--panel-border)"
                  strokeDasharray="2 3"
                />
                <text
                  x={-6}
                  y={sy(t)}
                  fontSize="9"
                  textAnchor="end"
                  dominantBaseline="middle"
                  fill="var(--text-dim)"
                >
                  {fmtDollarsCompact(t)}
                </text>
              </g>
            ))}
            {/* X tick labels */}
            {xTicks.map((t) => (
              <text
                key={t}
                x={sx(t)}
                y={innerH + 14}
                fontSize="9"
                textAnchor="middle"
                fill="var(--text-dim)"
              >
                {t}
              </text>
            ))}
            {/* Series lines */}
            {series.map((s) => {
              const isActive = effectiveHighlight === s.geo.id;
              const isDimmed = effectiveHighlight != null && !isActive;
              const path = lineGen(s.trend) ?? '';
              return (
                <path
                  key={s.geo.id}
                  d={path}
                  fill="none"
                  stroke={isActive ? 'var(--accent)' : s.color}
                  strokeWidth={isActive ? 2.4 : 1.4}
                  opacity={isDimmed ? 0.32 : 0.95}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onActivate(s.geo.id)}
                />
              );
            })}
            {/* Hover guide + per-series dots */}
            {focused && (
              <g>
                <line
                  x1={sx(focused.year)}
                  x2={sx(focused.year)}
                  y1={0}
                  y2={innerH}
                  stroke="var(--accent)"
                  strokeOpacity={0.5}
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
                {focused.rows.map((r) => (
                  <circle
                    key={r.geo.id}
                    cx={sx(focused.year)}
                    cy={sy(r.value)}
                    r={3}
                    fill={effectiveHighlight === r.geo.id ? 'var(--accent)' : r.color}
                    stroke="rgba(11,13,16,0.95)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>
            )}
            {/* Transparent capture rect for hover events */}
            <rect
              x={0}
              y={0}
              width={innerW}
              height={innerH}
              fill="transparent"
              pointerEvents="all"
              onMouseMove={handleMove}
            />
          </g>
        </svg>
        {/* Floating tooltip — multi-series at the focused year. Sorted
            descending by value so the user reads the leaderboard from the
            top down. */}
        {focused && tooltipPct && (
          <div
            className="pointer-events-none absolute rounded-md px-2 py-1.5 text-[10px]"
            style={{
              left: `${Math.min(95, Math.max(5, tooltipPct.left))}%`,
              top: 4,
              transform: 'translateX(-50%)',
              background: 'rgba(11, 13, 16, 0.94)',
              border: '1px solid var(--panel-border)',
              color: 'var(--text-h)',
              whiteSpace: 'nowrap',
              lineHeight: 1.4,
              maxHeight: 'calc(100% - 8px)',
              overflowY: 'auto',
            }}
          >
            <div
              className="text-[10px] mb-0.5 pb-0.5"
              style={{
                color: 'var(--text-dim)',
                borderBottom: '1px solid var(--panel-border)',
              }}
            >
              {focused.year}
            </div>
            <ul className="flex flex-col gap-0.5">
              {focused.rows.slice(0, 8).map((r) => {
                const isActive = effectiveHighlight === r.geo.id;
                return (
                  <li
                    key={r.geo.id}
                    className="flex items-center gap-2 justify-between"
                    style={{ color: isActive ? 'var(--accent)' : 'var(--text)' }}
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className="inline-block rounded-full"
                        style={{ width: 6, height: 6, background: r.color }}
                      />
                      {r.geo.label}
                    </span>
                    <span className="tnum" style={{ color: 'var(--text-h)' }}>
                      {fmtDollarsCompact(r.value)}
                    </span>
                  </li>
                );
              })}
              {focused.rows.length > 8 && (
                <li className="text-[9px]" style={{ color: 'var(--text-dim)' }}>
                  + {focused.rows.length - 8} more
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Radar chart — Housing Type Comparison
// ---------------------------------------------------------------------------
function HousingTypeRadar({
  geo,
  selectedTypeKey,
  onSelectType,
}: {
  geo: Geography | null;
  selectedTypeKey?: string | null;
  onSelectType?: (key: string) => void;
}) {
  const values = useMemo(() => {
    return TYPE_AXES.map((a) => ({ ...a, value: typeValue(geo?.latest ?? null, a.key) }));
  }, [geo]);
  const maxVal = useMemo(() => {
    return values.reduce((m, v) => (v.value != null && v.value > m ? v.value : m), 0);
  }, [values]);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Wider-than-tall viewBox leaves horizontal room for labels like
  // "Single Family" on the left and "5+ Bedroom" on the right without
  // clipping at the SVG edge. Radar radius is bounded by the height.
  const W = 380;
  const H = 280;
  const cx = W / 2;
  const cy = H / 2;
  const r = H / 2 - 36;
  const n = TYPE_AXES.length;

  // Angle setup: axis 0 (1 Bedroom) at top-left, rotating clockwise so that
  // Single Family ends up at the top-right. -π/2 puts axis 0 at 12 o'clock;
  // we shift by an extra step so labels match the screenshot order.
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const point = (i: number, magnitude: number) => {
    const a = angle(i);
    const radius = maxVal > 0 ? (magnitude / maxVal) * r : 0;
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)] as const;
  };
  const axisEnd = (i: number) => {
    const a = angle(i);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  };
  const labelPoint = (i: number) => {
    const a = angle(i);
    return [cx + (r + 18) * Math.cos(a), cy + (r + 18) * Math.sin(a)] as const;
  };

  const gridLevels = [0.25, 0.5, 0.75, 1];

  // Polygon path for the data
  const polyPoints = values
    .map((v, i) => {
      const [x, y] = point(i, v.value ?? 0);
      return `${x},${y}`;
    })
    .join(' ');

  // Tooltip metrics — positioned in the SVG's viewBox coordinate space so
  // the placement scales with the chart. Pinned slightly above the hovered
  // dot, with overflow handling at the SVG edges.
  const hover = hoverIdx != null ? values[hoverIdx] : null;
  const hoverPoint = hoverIdx != null ? point(hoverIdx, hover?.value ?? 0) : null;
  const tipW = 120;
  const tipH = 32;
  let tipX = 0;
  let tipY = 0;
  if (hoverPoint) {
    tipX = Math.min(W - tipW - 4, Math.max(4, hoverPoint[0] - tipW / 2));
    tipY = Math.max(4, hoverPoint[1] - tipH - 12);
  }

  return (
    <div className="flex flex-1 items-center justify-center w-full h-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full mx-auto block"
        style={{ maxWidth: 380, maxHeight: 320 }}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Housing type comparison radar"
      >
        {/* Concentric grid (octagons) */}
        {gridLevels.map((lvl) => {
          const pts = TYPE_AXES.map((_, i) => {
            const a = angle(i);
            return `${cx + r * lvl * Math.cos(a)},${cy + r * lvl * Math.sin(a)}`;
          }).join(' ');
          return (
            <polygon
              key={lvl}
              points={pts}
              fill="none"
              stroke="var(--panel-border)"
              strokeDasharray="2 3"
            />
          );
        })}
        {/* Axis lines */}
        {TYPE_AXES.map((_, i) => {
          const [x, y] = axisEnd(i);
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--panel-border)" />;
        })}
        {/* Data polygon */}
        <polygon
          points={polyPoints}
          fill="rgba(255, 255, 255, 0.18)"
          stroke="#FFFFFF"
          strokeWidth={1.6}
        />
        {/* Data dots — invisible larger hit-target sits below each
            visible dot so hover doesn't require pixel-perfect aim, and
            clicks toggle the section's selected housing type. */}
        {values.map((v, i) => {
          const [x, y] = point(i, v.value ?? 0);
          const active = hoverIdx === i;
          const selected = selectedTypeKey === v.key;
          return (
            <g key={v.key}>
              <circle
                cx={x}
                cy={y}
                r={12}
                fill="transparent"
                style={{ cursor: onSelectType ? 'pointer' : 'default' }}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
                onClick={() => onSelectType?.(v.key)}
              />
              <circle
                cx={x}
                cy={y}
                r={selected ? 6 : active ? 5 : 3}
                fill={selected ? 'var(--accent)' : '#FFFFFF'}
                stroke={selected || active ? 'var(--text-h)' : 'none'}
                strokeWidth={selected ? 1.5 : active ? 1 : 0}
                pointerEvents="none"
              />
            </g>
          );
        })}
        {/* Axis labels */}
        {TYPE_AXES.map((a, i) => {
          const [x, y] = labelPoint(i);
          // Anchor based on x position so labels don't overlap the polygon.
          const anchor = x < cx - 4 ? 'end' : x > cx + 4 ? 'start' : 'middle';
          const selected = selectedTypeKey === a.key;
          return (
            <text
              key={a.key}
              x={x}
              y={y}
              fontSize="9.5"
              textAnchor={anchor}
              dominantBaseline="middle"
              fill={selected ? 'var(--accent)' : 'var(--text)'}
              fontWeight={selected ? 600 : 400}
              style={{ cursor: onSelectType ? 'pointer' : 'default' }}
              onClick={() => onSelectType?.(a.key)}
            >
              {a.label}
            </text>
          );
        })}
        {/* Tooltip — rendered last so it sits above all other layers. */}
        {hover && hoverPoint && (
          <g pointerEvents="none">
            <rect
              x={tipX}
              y={tipY}
              width={tipW}
              height={tipH}
              rx={4}
              ry={4}
              fill="rgba(15, 18, 24, 0.95)"
              stroke="var(--panel-border)"
              strokeWidth={1}
            />
            <text
              x={tipX + tipW / 2}
              y={tipY + 12}
              fontSize="9"
              textAnchor="middle"
              fill="var(--text-dim)"
            >
              {hover.label}
            </text>
            <text
              x={tipX + tipW / 2}
              y={tipY + 24}
              fontSize="11"
              fontWeight={600}
              textAnchor="middle"
              fill="var(--text-h)"
            >
              {fmtDollarsCompact(hover.value)}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Housing-type bar chart — same eight categories
// ---------------------------------------------------------------------------
function HousingTypeBars({
  geo,
  selectedTypeKey,
  onSelectType,
}: {
  geo: Geography | null;
  selectedTypeKey?: string | null;
  onSelectType?: (key: string) => void;
}) {
  const data = useMemo(() => {
    return TYPE_BAR_ORDER.map((a) => ({ ...a, value: typeValue(geo?.latest ?? null, a.key) }));
  }, [geo]);

  const W = 480;
  const H = 240;
  const M = { top: 28, right: 12, bottom: 38, left: 12 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  const x = useMemo(
    () => scaleBand<string>().domain(data.map((d) => d.key)).range([0, innerW]).padding(0.18),
    [data, innerW],
  );
  const yMax = useMemo(() => data.reduce((m, d) => (d.value != null && d.value > m ? d.value : m), 0), [data]);
  const y = useMemo(() => scaleLinear().domain([0, yMax * 1.18 || 1]).range([innerH, 0]), [yMax, innerH]);

  // Value-based gradient: bars brighten as their value increases. Map the
  // smallest non-null value to a medium grey and the largest to white,
  // interpolating linearly in RGB space.
  const yMin = useMemo(
    () => data.reduce(
      (m, d) => (d.value != null && (m == null || d.value < m) ? d.value : m),
      null as number | null,
    ),
    [data],
  );
  const colorForValue = (v: number | null): string => {
    if (v == null || yMax <= 0) return '#6B7280';
    const lo = yMin ?? v;
    const span = Math.max(1, yMax - lo);
    const t = Math.min(1, Math.max(0, (v - lo) / span));
    // Low end (low value): medium grey #6B7280
    // High end (high value): white #FFFFFF
    const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
    const rgb = (r: number, g: number, b: number) => `rgb(${r}, ${g}, ${b})`;
    return rgb(lerp(0x6B, 0xFF), lerp(0x72, 0xFF), lerp(0x80, 0xFF));
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: 240 }}>
      <g transform={`translate(${M.left}, ${M.top})`}>
        {data.map((d) => {
          const v = d.value ?? 0;
          const xPos = x(d.key) ?? 0;
          const bw = x.bandwidth();
          const bh = innerH - y(v);
          const selected = selectedTypeKey === d.key;
          return (
            <g
              key={d.key}
              style={{ cursor: onSelectType ? 'pointer' : 'default' }}
              onClick={() => onSelectType?.(d.key)}
            >
              {/* Hit-target — full column so the user can click anywhere
                  in the bar's column band, not just on the colored bar. */}
              <rect
                x={xPos}
                y={0}
                width={bw}
                height={innerH}
                fill="transparent"
                pointerEvents="all"
              />
              <rect
                x={xPos}
                y={y(v)}
                width={bw}
                height={Math.max(0, bh)}
                fill={colorForValue(d.value)}
                opacity={selected ? 1 : 0.95}
                stroke={selected ? 'var(--accent)' : 'none'}
                strokeWidth={selected ? 2 : 0}
                rx={1}
              />
              {/* Value label on top of each bar */}
              <text
                x={xPos + bw / 2}
                y={y(v) - 4}
                fontSize="9"
                textAnchor="middle"
                fill="var(--text)"
              >
                {fmtDollarsCompact(d.value)}
              </text>
              {/* Category label under each bar */}
              <text
                x={xPos + bw / 2}
                y={innerH + 12}
                fontSize="9"
                textAnchor="middle"
                fill="var(--text-dim)"
              >
                {d.label.replace(' Bedroom', ' BR').replace('Single Family', 'Single Fam.')}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// City-comparison bar chart — sortable, doubles as the geography filter
// ---------------------------------------------------------------------------
function CityComparisonBars({
  geographies,
  activeId,
  onActivate,
  typeKey = 'zhviAvg',
}: {
  geographies: Geography[];
  activeId: string | null;
  onActivate: (id: string) => void;
  // Which housing-type metric drives the bar lengths. Defaults to the
  // average ZHVI; switching to 'zhviSfr', 'zhvi3br', etc. retargets the
  // ranking to that type so the section can pivot on housing type.
  typeKey?: string;
}) {
  const sorted = useMemo(() => {
    return geographies
      .map((g, idx) => ({ geo: g, value: typeValue(g.latest, typeKey), color: geoColor(idx) }))
      .filter((d) => d.value != null && Number.isFinite(d.value))
      .sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
  }, [geographies, typeKey]);

  const W = 720;
  const H = 220;
  const M = { top: 24, right: 12, bottom: 56, left: 12 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  const x = useMemo(
    () => scaleBand<string>().domain(sorted.map((d) => d.geo.id)).range([0, innerW]).padding(0.16),
    [sorted, innerW],
  );
  const yMax = useMemo(() => sorted.reduce((m, d) => ((d.value ?? 0) > m ? (d.value ?? 0) : m), 0), [sorted]);
  const y = useMemo(() => scaleLinear().domain([0, yMax * 1.18 || 1]).range([innerH, 0]), [yMax, innerH]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: 220 }}>
      <g transform={`translate(${M.left}, ${M.top})`}>
        {sorted.map((d) => {
          const xPos = x(d.geo.id) ?? 0;
          const bw = x.bandwidth();
          const v = d.value ?? 0;
          const bh = innerH - y(v);
          const isActive = activeId === d.geo.id;
          return (
            <g key={d.geo.id} style={{ cursor: 'pointer' }} onClick={() => onActivate(d.geo.id)}>
              <rect
                x={xPos}
                y={y(v)}
                width={bw}
                height={Math.max(0, bh)}
                fill={isActive ? 'var(--accent)' : d.color}
                opacity={isActive ? 1 : 0.85}
                rx={1}
              />
              <text
                x={xPos + bw / 2}
                y={y(v) - 4}
                fontSize="9"
                textAnchor="middle"
                fill={isActive ? 'var(--accent)' : 'var(--text)'}
              >
                {fmtDollarsCompact(d.value)}
              </text>
              <g transform={`translate(${xPos + bw / 2}, ${innerH + 8})`}>
                <text
                  fontSize="9"
                  textAnchor="end"
                  fill={isActive ? 'var(--accent)' : 'var(--text-dim)'}
                  transform="rotate(-32)"
                >
                  {d.geo.label}
                </text>
              </g>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Reusable segmented control (mirrors DemographicsSection)
// ---------------------------------------------------------------------------
interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}
function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex gap-0.5 p-0.5 rounded-md border"
      style={{
        background: 'rgba(255,255,255,0.03)',
        borderColor: 'var(--panel-border)',
      }}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className="px-2 py-0.5 text-[10px] font-medium rounded transition-colors"
            style={{
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? '#1a1207' : 'var(--text-dim)',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Number helpers (housing-section-local)
// ---------------------------------------------------------------------------
function readNum(latest: ContextLatest | null, key: string): number | null {
  if (!latest) return null;
  const v = latest[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// ---------------------------------------------------------------------------
// Housing Characteristics tile — surfaces SDO 2024 vintage characteristics
// (units, occupancy, vacancy, household size) and the year-built cohort
// distribution (B25034). Year-built data is gracefully absent until the
// fetcher pulls B25034 with a Census API key.
// ---------------------------------------------------------------------------
const YEAR_BUILT_COHORTS: ReadonlyArray<{ key: string; label: string; short: string }> = [
  { key: 'yearBuilt2020plus',  label: '2020 or later',  short: "'20+" },
  { key: 'yearBuilt2010to19',  label: '2010 – 2019',    short: "'10s" },
  { key: 'yearBuilt2000to09',  label: '2000 – 2009',    short: "'00s" },
  { key: 'yearBuilt1990to99',  label: '1990 – 1999',    short: "'90s" },
  { key: 'yearBuilt1980to89',  label: '1980 – 1989',    short: "'80s" },
  { key: 'yearBuilt1970to79',  label: '1970 – 1979',    short: "'70s" },
  { key: 'yearBuilt1960to69',  label: '1960 – 1969',    short: "'60s" },
  { key: 'yearBuilt1950to59',  label: '1950 – 1959',    short: "'50s" },
  { key: 'yearBuilt1940to49',  label: '1940 – 1949',    short: "'40s" },
  { key: 'yearBuiltPre1940',   label: 'Pre-1940',       short: '<\'40' },
];

const YEAR_BUILT_PALETTE = [
  '#7AC4D8', '#4FB3A9', '#94C4B7', '#9CC479',
  '#C8B273', '#FFB454', '#C29479', '#C47979',
  '#B79CC4', '#9FB3C8',
];

function HousingCharacteristicsTile({ geo }: { geo: Geography | null }) {
  const latest = geo?.latest ?? null;
  const total = readNum(latest, 'housingUnitsTotal');
  const occ = readNum(latest, 'housingUnitsOccupied');
  const vacPct = readNum(latest, 'vacancyPct');
  const hhSize = readNum(latest, 'householdSize');

  return (
    <div
      className="rounded-md p-3 flex flex-col gap-3"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--panel-border)',
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-h)' }}
          >
            Housing Characteristics
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
            {geo?.label ?? '—'} · CO SDO Vintage 2024
          </div>
        </div>
      </div>

      {/* Top metrics — 4 KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 justify-items-center text-center">
        <div className="flex flex-col items-center">
          <div className="text-xl font-semibold tabular-nums" style={{ color: 'var(--text-h)' }}>
            {total != null ? fmtInt(total) : '—'}
          </div>
          <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
            Total housing units
          </div>
        </div>
        <div className="flex flex-col items-center">
          <div className="text-xl font-semibold tabular-nums" style={{ color: 'var(--text-h)' }}>
            {vacPct != null ? `${vacPct.toFixed(1)}%` : '—'}
          </div>
          <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
            Vacancy rate
          </div>
        </div>
        <div className="flex flex-col items-center">
          <div className="text-xl font-semibold tabular-nums" style={{ color: 'var(--text-h)' }}>
            {hhSize != null ? hhSize.toFixed(2) : '—'}
          </div>
          <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
            Household size
          </div>
        </div>
        <div className="flex flex-col items-center">
          <div className="text-xl font-semibold tabular-nums" style={{ color: 'var(--text-h)' }}>
            {occ != null ? fmtInt(occ) : '—'}
          </div>
          <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
            Occupied units
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HousingVintageCard — dedicated card for ACS B25034 year-built data.
// Surfaces three derived KPIs (median stock age, share pre-1980, share built
// since 2010) plus a vertical bar chart of units by decade with the peak
// decade highlighted.
//
// "Median stock age" is computed as a weighted median across the 10 cohorts:
// each cohort contributes its midpoint year × its unit count, then we find
// the cohort containing the 50th-percentile cumulative unit count and
// approximate stock age as (vintageEnd - midpoint of that cohort).
//
// "Pre-1980 share" is planner-relevant: pre-1980 housing typically carries
// lead paint, knob-and-tube wiring, lower energy performance, and deferred
// maintenance. A high share signals retrofit / weatherization opportunity.
//
// "Built since 2010" surfaces recent construction pace at a glance — useful
// for tracking whether housing supply is keeping up with population growth.
// ---------------------------------------------------------------------------
function HousingVintageCard({
  geo,
  vintageEnd,
}: {
  geo: Geography | null;
  vintageEnd: number | null;
}) {
  const latest = geo?.latest ?? null;
  const cohorts = useMemo(() => {
    return YEAR_BUILT_COHORTS.map((c, idx) => ({
      ...c,
      value: readNum(latest, c.key) ?? 0,
      color: YEAR_BUILT_PALETTE[idx % YEAR_BUILT_PALETTE.length],
    }));
  }, [latest]);

  const totalUnits = useMemo(
    () => cohorts.reduce((a, c) => a + c.value, 0),
    [cohorts],
  );

  // Cohort midpoints (approximate construction year). Used for weighted
  // median age and any other midpoint-based stats.
  const cohortMidpoints: Record<string, number> = {
    yearBuiltPre1940:   1925,
    yearBuilt1940to49:  1944,
    yearBuilt1950to59:  1954,
    yearBuilt1960to69:  1964,
    yearBuilt1970to79:  1974,
    yearBuilt1980to89:  1984,
    yearBuilt1990to99:  1994,
    yearBuilt2000to09:  2004,
    yearBuilt2010to19:  2014,
    yearBuilt2020plus:  vintageEnd != null ? Math.round((2020 + vintageEnd) / 2) : 2022,
  };

  // KPIs — only computed when there's data.
  const kpis = useMemo(() => {
    if (totalUnits <= 0) return null;
    // Pre-1980 share
    const pre1980Keys = [
      'yearBuiltPre1940', 'yearBuilt1940to49', 'yearBuilt1950to59',
      'yearBuilt1960to69', 'yearBuilt1970to79',
    ];
    const pre1980Units = cohorts
      .filter((c) => pre1980Keys.includes(c.key))
      .reduce((a, c) => a + c.value, 0);
    const pre1980Share = (pre1980Units / totalUnits) * 100;

    // Since-2010 share
    const since2010Keys = ['yearBuilt2010to19', 'yearBuilt2020plus'];
    const since2010Units = cohorts
      .filter((c) => since2010Keys.includes(c.key))
      .reduce((a, c) => a + c.value, 0);
    const since2010Share = (since2010Units / totalUnits) * 100;

    // Weighted median age — find the cohort containing the 50th-percentile
    // cumulative unit count (oldest → newest), then return vintageEnd minus
    // that cohort's midpoint year.
    const sortedOldFirst = [...cohorts]; // YEAR_BUILT_COHORTS is newest-first
    sortedOldFirst.reverse();
    const halfTotal = totalUnits / 2;
    let cum = 0;
    let medianMidpoint = cohortMidpoints[sortedOldFirst[0].key] ?? 1980;
    for (const c of sortedOldFirst) {
      cum += c.value;
      if (cum >= halfTotal) {
        medianMidpoint = cohortMidpoints[c.key] ?? 1980;
        break;
      }
    }
    const referenceYear = vintageEnd ?? new Date().getFullYear();
    const medianAge = referenceYear - medianMidpoint;

    // Peak cohort (largest single decade)
    const peak = cohorts.reduce(
      (best, c) => (c.value > (best?.value ?? -1) ? c : best),
      cohorts[0],
    );

    return { pre1980Share, since2010Share, medianAge, peak };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cohorts, totalUnits, vintageEnd]);

  // Vertical bar chart — render even when totalUnits === 0 so the empty
  // state shows the explanatory line.
  // ---- Bar chart layout (oldest → newest left-to-right) ------------------
  const chartCohorts = useMemo(() => [...cohorts].reverse(), [cohorts]);
  const yMax = useMemo(
    () => chartCohorts.reduce((m, c) => Math.max(m, c.value), 0),
    [chartCohorts],
  );

  // Tooltip state
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Layout constants for the SVG bar chart. Wider-than-tall ratio so 10
  // decade labels fit comfortably without rotation.
  const W = 720;
  const H = 220;
  const M = { top: 16, right: 12, bottom: 32, left: 36 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const barW = innerW / chartCohorts.length;

  return (
    <div
      className="rounded-md p-3 flex flex-col gap-3"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--panel-border)',
      }}
    >
      {/* Header */}
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-h)' }}
          >
            Housing Stock by Year Built
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
            {geo?.label ?? '—'} · ACS 5-Year{vintageEnd ? ` ${vintageEnd}` : ''} · table B25034
          </div>
        </div>
      </div>

      {/* KPI strip */}
      {kpis ? (
        <div className="grid grid-cols-3 gap-3 justify-items-center text-center">
          <div className="flex flex-col items-center">
            <div
              className="text-xl font-semibold tabular-nums"
              style={{ color: 'var(--text-h)' }}
            >
              {kpis.medianAge.toFixed(0)} yrs
            </div>
            <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
              Median stock age
            </div>
          </div>
          <div className="flex flex-col items-center">
            <div
              className="text-xl font-semibold tabular-nums"
              style={{ color: 'var(--text-h)' }}
            >
              {kpis.pre1980Share.toFixed(0)}%
            </div>
            <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
              Built before 1980
            </div>
          </div>
          <div className="flex flex-col items-center">
            <div
              className="text-xl font-semibold tabular-nums"
              style={{ color: 'var(--text-h)' }}
            >
              {kpis.since2010Share.toFixed(0)}%
            </div>
            <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
              Built since 2010
            </div>
          </div>
        </div>
      ) : (
        <div className="text-[10px] italic" style={{ color: 'var(--text-dim)' }}>
          B25034 not yet in cache — re-run fetch-context-census.py with CENSUS_API_KEY.
        </div>
      )}

      {/* Vertical bar chart by decade */}
      {totalUnits > 0 && (
        <div className="relative w-full">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="w-full"
            style={{ display: 'block', height: 220 }}
            onMouseLeave={() => setHoverIdx(null)}
          >
            <g transform={`translate(${M.left}, ${M.top})`}>
              {/* y-axis baseline */}
              <line
                x1={0}
                x2={innerW}
                y1={innerH}
                y2={innerH}
                stroke="var(--panel-border)"
              />
              {chartCohorts.map((c, idx) => {
                const v = c.value;
                const h = yMax > 0 ? (v / yMax) * innerH : 0;
                const x = idx * barW;
                const y = innerH - h;
                const isPeak = kpis?.peak?.key === c.key;
                const isHovered = hoverIdx === idx;
                const pct = totalUnits > 0 ? (v / totalUnits) * 100 : 0;
                return (
                  <g
                    key={c.key}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHoverIdx(idx)}
                    onMouseLeave={() => setHoverIdx((cur) => (cur === idx ? null : cur))}
                  >
                    {/* Hit-target — full column so hover doesn't require
                        pixel-perfect aim on short bars. */}
                    <rect
                      x={x}
                      y={0}
                      width={barW}
                      height={innerH}
                      fill="transparent"
                    />
                    <rect
                      x={x + 2}
                      y={y}
                      width={Math.max(0, barW - 4)}
                      height={Math.max(0, h)}
                      fill={isPeak ? 'var(--accent)' : c.color}
                      stroke={isPeak ? 'var(--accent)' : 'none'}
                      strokeWidth={isPeak ? 1 : 0}
                      opacity={isHovered ? 1 : 0.92}
                      rx={1}
                    />
                    {/* Value label on top of each bar (units count) */}
                    {v > 0 && (
                      <text
                        x={x + barW / 2}
                        y={y - 4}
                        fontSize="9"
                        textAnchor="middle"
                        fill={isPeak ? 'var(--accent)' : 'var(--text)'}
                      >
                        {fmtInt(v)}
                      </text>
                    )}
                    {/* Decade label below x-axis */}
                    <text
                      x={x + barW / 2}
                      y={innerH + 12}
                      fontSize="9"
                      textAnchor="middle"
                      fill={isPeak ? 'var(--accent)' : 'var(--text-dim)'}
                    >
                      {c.short}
                    </text>
                    {/* Share % below decade label */}
                    <text
                      x={x + barW / 2}
                      y={innerH + 24}
                      fontSize="8"
                      textAnchor="middle"
                      fill="var(--text-dim)"
                    >
                      {pct.toFixed(0)}%
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
          {/* Hover tooltip — anchors above the hovered bar with full
              cohort label, exact unit count, and share. */}
          {hoverIdx != null && chartCohorts[hoverIdx] && (
            <div
              className="pointer-events-none absolute rounded-md px-2 py-1.5 text-[10px]"
              style={{
                left: `${((M.left + hoverIdx * barW + barW / 2) / W) * 100}%`,
                top: 4,
                transform: 'translateX(-50%)',
                background: 'rgba(11, 13, 16, 0.94)',
                border: '1px solid var(--panel-border)',
                color: 'var(--text-h)',
                whiteSpace: 'nowrap',
                lineHeight: 1.4,
              }}
            >
              <div
                className="text-[10px] mb-0.5 pb-0.5"
                style={{
                  color: 'var(--text-dim)',
                  borderBottom: '1px solid var(--panel-border)',
                }}
              >
                {chartCohorts[hoverIdx].label}
              </div>
              <div className="tnum">
                <span style={{ color: 'var(--text-h)' }}>
                  {fmtInt(chartCohorts[hoverIdx].value)}
                </span>{' '}
                units
                <span style={{ color: 'var(--text-dim)' }}>
                  {' '}·{' '}
                  {totalUnits > 0
                    ? `${((chartCohorts[hoverIdx].value / totalUnits) * 100).toFixed(1)}%`
                    : '—'}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Peak-decade callout under the chart */}
      {kpis?.peak && kpis.peak.value > 0 && (
        <div
          className="text-[10px] italic"
          style={{ color: 'var(--text-dim)' }}
        >
          Peak construction decade:{' '}
          <span style={{ color: 'var(--accent)', fontStyle: 'normal', fontWeight: 600 }}>
            {kpis.peak.label}
          </span>{' '}
          ·{' '}
          <span style={{ color: 'var(--text-h)', fontStyle: 'normal' }}>
            {fmtInt(kpis.peak.value)} units
          </span>{' '}
          (
          {totalUnits > 0
            ? `${((kpis.peak.value / totalUnits) * 100).toFixed(1)}%`
            : '—'}
          {' '}of stock)
        </div>
      )}

      {/* About this data — methodology + analytical framing. Mirrors the
          existing About-this-data tiles in the section: prose summary at
          top, structured key/value grid below. Lives at the bottom of the
          card so casual readers see the chart first, but analysts get the
          source context they need to interpret the numbers. */}
      <div
        className="rounded-md p-3 flex flex-col gap-2 mt-1"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid var(--panel-border)',
        }}
      >
        <div>
          <div
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-h)' }}
          >
            About this data
          </div>
          <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
            U.S. Census ACS 5-Year Estimates · table B25034 (Year Structure Built)
          </div>
        </div>
        <p className="text-[11px] leading-snug" style={{ color: 'var(--text)' }}>
          Year-built counts come from ACS table B25034, which records the year
          construction was completed for every occupied or vacant housing unit
          in the geography. The figure is self-reported by householders during
          the rolling 5-year ACS sample window, then bucketed into 10
          construction-decade cohorts (Pre-1940 through 2020+). Pre-1940 is a
          single open-ended bucket — finer resolution isn&rsquo;t published.
          Demolitions drop out naturally (only currently-existing units are
          counted), and substantial renovations don&rsquo;t reset the year
          built — a 1925 building gut-rehabbed in 2010 still counts as
          Pre-1940.
        </p>
        <p className="text-[11px] leading-snug" style={{ color: 'var(--text)' }}>
          The three KPIs are derived from the cohort distribution:{' '}
          <strong style={{ color: 'var(--text-h)' }}>median stock age</strong>{' '}
          uses a weighted median across cohort midpoints (a 1925 midpoint for
          Pre-1940, a 2022 midpoint for 2020+, etc.) and is approximate at
          decade resolution. <strong style={{ color: 'var(--text-h)' }}>Built before 1980</strong>{' '}
          is a planner-relevant threshold — units built earlier carry a
          materially higher risk of lead paint (banned 1978), knob-and-tube
          wiring, asbestos, lower thermal envelope performance, and pre-modern
          seismic / fire code.{' '}
          <strong style={{ color: 'var(--text-h)' }}>Built since 2010</strong>{' '}
          is a supply-side indicator — pair it with the Population Trend chart
          to see whether construction pace is keeping up with population
          growth.
        </p>
        <ul className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1 mt-1">
          <li className="flex flex-col">
            <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
              Source
            </span>
            <span className="text-[11px]" style={{ color: 'var(--text-h)' }}>
              U.S. Census · ACS 5-Year
            </span>
          </li>
          <li className="flex flex-col">
            <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
              Table
            </span>
            <span className="text-[11px]" style={{ color: 'var(--text-h)' }}>
              B25034 (vars _002E – _011E)
            </span>
          </li>
          <li className="flex flex-col">
            <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
              Cadence
            </span>
            <span className="text-[11px]" style={{ color: 'var(--text-h)' }}>
              Annual · ~2-year lag
            </span>
          </li>
          <li className="flex flex-col">
            <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
              Vintage
            </span>
            <span className="text-[11px]" style={{ color: 'var(--text-h)' }}>
              {vintageEnd ? `5-Year ending ${vintageEnd}` : 'latest available'}
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-line trend chart — generic over Geography[] and a metric key. Used
// for the new Housing Units Trend chart with current/historical toggle.
// (Mirrors DemographicsSection.MultiLineTrendChart but reads from
// Geography rather than DemoGeography.)
// ---------------------------------------------------------------------------
function HousingTrendChart({
  geographies,
  metricKey,
  trendSource = 'current',
  highlightId,
  onActivate,
  showGrowthAnnotations = false,
}: {
  geographies: Geography[];
  metricKey: string;
  trendSource?: 'current' | 'historical';
  highlightId: string | null;
  onActivate: (id: string) => void;
  showGrowthAnnotations?: boolean;
}) {
  const series = useMemo(() => {
    return geographies
      .map((g, idx) => {
        const src = trendSource === 'historical' ? g.historicalTrend : g.trend;
        const trend = (src?.[metricKey] ?? []).filter(
          (p): p is TrendPoint & { value: number } => p.value != null,
        );
        return { geo: g, color: geoColor(idx), trend };
      })
      .filter((s) => s.trend.length > 0);
  }, [geographies, metricKey, trendSource]);

  const { xMin, xMax, yMax } = useMemo(() => {
    let xMin = Infinity, xMax = -Infinity, yMax = 0;
    for (const s of series) {
      for (const p of s.trend) {
        if (p.year < xMin) xMin = p.year;
        if (p.year > xMax) xMax = p.year;
        if (p.value > yMax) yMax = p.value;
      }
    }
    if (!Number.isFinite(xMin)) xMin = 2010;
    if (!Number.isFinite(xMax)) xMax = 2024;
    return { xMin, xMax, yMax };
  }, [series]);

  const W = 720;
  const H = 260;
  const M = { top: 8, right: 12, bottom: 24, left: 60 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  const sx = useMemo(() => scaleLinear().domain([xMin, xMax]).range([0, innerW]), [xMin, xMax, innerW]);
  const sy = useMemo(() => scaleLinear().domain([0, yMax * 1.05 || 1]).range([innerH, 0]), [yMax, innerH]);

  const lineGen = useMemo(
    () =>
      d3Line<TrendPoint & { value: number }>()
        .x((d) => sx(d.year))
        .y((d) => sy(d.value)),
    [sx, sy],
  );

  // Ribbon area generator — filled area between the line and the x-axis
  // baseline. Each series draws the area + line on top.
  const areaGen = useMemo(
    () =>
      d3Area<TrendPoint & { value: number }>()
        .x((d) => sx(d.year))
        .y0(innerH)
        .y1((d) => sy(d.value)),
    [sx, sy, innerH],
  );

  const yTicks = useMemo(() => sy.ticks(4), [sy]);
  const xTicks = useMemo(() => {
    const span = xMax - xMin;
    const step = span > 50 ? 10 : span > 20 ? 5 : span > 10 ? 2 : 1;
    const out: number[] = [];
    for (let y = Math.ceil(xMin / step) * step; y <= xMax; y += step) out.push(y);
    return out;
  }, [xMin, xMax]);

  const growthAnnotations = useMemo(() => {
    if (!showGrowthAnnotations) return new Map<string, string>();
    const m = new Map<string, string>();
    for (const s of series) {
      if (s.trend.length < 2) continue;
      const first = s.trend[0];
      const last = s.trend[s.trend.length - 1];
      if (!first.value) continue;
      const pct = ((last.value - first.value) / first.value) * 100;
      const sign = pct >= 0 ? '+' : '';
      m.set(s.geo.id, `${sign}${pct.toFixed(0)}% since ${first.year}`);
    }
    return m;
  }, [series, showGrowthAnnotations]);

  const showMarkers = trendSource === 'historical';

  // Year-snap hover for the value/% change tooltip.
  const [hoverYear, setHoverYear] = useState<number | null>(null);
  const allYears = useMemo(() => {
    const set = new Set<number>();
    for (const s of series) for (const p of s.trend) set.add(p.year);
    return Array.from(set).sort((a, b) => a - b);
  }, [series]);

  const xToYear = (xViewBox: number): number | null => {
    if (allYears.length === 0) return null;
    const xData = sx.invert(xViewBox);
    let best = allYears[0];
    let bestDist = Math.abs(allYears[0] - xData);
    for (let i = 1; i < allYears.length; i++) {
      const d = Math.abs(allYears[i] - xData);
      if (d < bestDist) { bestDist = d; best = allYears[i]; }
    }
    return best;
  };

  const handleMove = (e: React.MouseEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const local = pt.matrixTransform(ctm.inverse());
    const xInPlot = local.x - M.left;
    if (xInPlot < 0 || xInPlot > innerW) return;
    const yr = xToYear(xInPlot);
    if (yr != null) setHoverYear(yr);
  };

  const focused = useMemo(() => {
    if (hoverYear == null) return null;
    const rows = series
      .map((s) => {
        const ptIdx = s.trend.findIndex((p) => p.year === hoverYear);
        if (ptIdx < 0) return null;
        const pt = s.trend[ptIdx];
        const prev = ptIdx > 0 ? s.trend[ptIdx - 1] : null;
        const pctChange = prev && prev.value
          ? ((pt.value - prev.value) / prev.value) * 100
          : null;
        return {
          geo: s.geo,
          color: s.color,
          value: pt.value,
          pctChange,
          prevYear: prev?.year ?? null,
        };
      })
      .filter((x): x is { geo: Geography; color: string; value: number; pctChange: number | null; prevYear: number | null } => x != null)
      .sort((a, b) => b.value - a.value);
    if (rows.length === 0) return null;
    return { year: hoverYear, rows };
  }, [hoverYear, series]);

  const tooltipPct = useMemo(() => {
    if (!focused) return null;
    const cx = M.left + sx(focused.year);
    return { left: (cx / W) * 100 };
  }, [focused, sx, M.left]);

  return (
    <div className="flex flex-col gap-2 flex-1">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {series.map((s) => {
          const isActive = highlightId === s.geo.id;
          const ann = growthAnnotations.get(s.geo.id);
          return (
            <button
              key={s.geo.id}
              type="button"
              onClick={() => onActivate(s.geo.id)}
              className="flex items-center gap-1.5 text-[10px] tabular-nums"
              style={{
                color: isActive ? 'var(--accent)' : 'var(--text)',
                opacity: isActive || highlightId == null ? 1 : 0.6,
              }}
            >
              <span
                className="inline-block rounded-full"
                style={{ width: 8, height: 8, background: s.color }}
              />
              {s.geo.label}
              {ann && <span style={{ color: 'var(--text-dim)' }}>· {ann}</span>}
            </button>
          );
        })}
      </div>
      <div className="relative w-full flex-1 flex flex-col" style={{ minHeight: 240 }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="w-full h-full"
          style={{ display: 'block', flex: 1, minHeight: 200 }}
          onMouseLeave={() => setHoverYear(null)}
        >
          <g transform={`translate(${M.left}, ${M.top})`}>
            {yTicks.map((t) => (
              <g key={t}>
                <line
                  x1={0}
                  x2={innerW}
                  y1={sy(t)}
                  y2={sy(t)}
                  stroke="var(--panel-border)"
                  strokeDasharray="2 3"
                />
                <text x={-6} y={sy(t)} fontSize="9" textAnchor="end" dominantBaseline="middle" fill="var(--text-dim)">
                  {fmtInt(t)}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <text key={t} x={sx(t)} y={innerH + 14} fontSize="9" textAnchor="middle" fill="var(--text-dim)">
                {t}
              </text>
            ))}
            {series.map((s) => {
              const isActive = highlightId === s.geo.id;
              const isDimmed = highlightId != null && !isActive;
              const path = lineGen(s.trend) ?? '';
              const areaPath = areaGen(s.trend) ?? '';
              const baseAreaOpacity = isActive ? 0.32 : 0.18;
              const areaOpacity = isDimmed ? 0.06 : baseAreaOpacity;
              return (
                <g key={s.geo.id}>
                  <path
                    d={areaPath}
                    fill={isActive ? 'var(--accent)' : s.color}
                    opacity={areaOpacity}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onActivate(s.geo.id)}
                  />
                  <path
                    d={path}
                    fill="none"
                    stroke={isActive ? 'var(--accent)' : s.color}
                    strokeWidth={isActive ? 2.4 : 1.4}
                    opacity={isDimmed ? 0.32 : 0.95}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onActivate(s.geo.id)}
                  />
                  {showMarkers && s.trend.map((p) => (
                    <circle
                      key={p.year}
                      cx={sx(p.year)}
                      cy={sy(p.value)}
                      r={isActive ? 3 : 2.2}
                      fill={isActive ? 'var(--accent)' : s.color}
                      opacity={isDimmed ? 0.32 : 0.95}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </g>
              );
            })}
            {focused && (
              <g>
                <line
                  x1={sx(focused.year)}
                  x2={sx(focused.year)}
                  y1={0}
                  y2={innerH}
                  stroke="var(--accent)"
                  strokeOpacity={0.5}
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
                {focused.rows.map((r) => (
                  <circle
                    key={r.geo.id}
                    cx={sx(focused.year)}
                    cy={sy(r.value)}
                    r={3}
                    fill={highlightId === r.geo.id ? 'var(--accent)' : r.color}
                    stroke="rgba(11,13,16,0.95)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>
            )}
            <rect
              x={0}
              y={0}
              width={innerW}
              height={innerH}
              fill="transparent"
              pointerEvents="all"
              onMouseMove={handleMove}
            />
          </g>
        </svg>
        {focused && tooltipPct && (
          <div
            className="pointer-events-none absolute rounded-md px-2 py-1.5 text-[10px]"
            style={{
              left: `${Math.min(95, Math.max(5, tooltipPct.left))}%`,
              top: 4,
              transform: 'translateX(-50%)',
              background: 'rgba(11, 13, 16, 0.94)',
              border: '1px solid var(--panel-border)',
              color: 'var(--text-h)',
              whiteSpace: 'nowrap',
              lineHeight: 1.4,
              maxHeight: 'calc(100% - 8px)',
              overflowY: 'auto',
            }}
          >
            <div
              className="text-[10px] mb-0.5 pb-0.5"
              style={{
                color: 'var(--text-dim)',
                borderBottom: '1px solid var(--panel-border)',
              }}
            >
              {focused.year}
            </div>
            <ul className="flex flex-col gap-0.5">
              {focused.rows.slice(0, 8).map((r) => {
                const isActive = highlightId === r.geo.id;
                const pctText = r.pctChange != null
                  ? `${r.pctChange >= 0 ? '+' : ''}${r.pctChange.toFixed(1)}%`
                  : null;
                const pctColor = r.pctChange == null
                  ? 'var(--text-dim)'
                  : r.pctChange >= 0
                    ? '#9CC479'
                    : '#C47979';
                return (
                  <li
                    key={r.geo.id}
                    className="flex items-center gap-2 justify-between"
                    style={{ color: isActive ? 'var(--accent)' : 'var(--text)' }}
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className="inline-block rounded-full"
                        style={{ width: 6, height: 6, background: r.color }}
                      />
                      {r.geo.label}
                    </span>
                    <span className="flex items-center gap-1.5 tnum">
                      {pctText && (
                        <span
                          className="text-[9px]"
                          style={{ color: pctColor }}
                          title={r.prevYear != null ? `change since ${r.prevYear}` : undefined}
                        >
                          {pctText}
                        </span>
                      )}
                      <span style={{ color: 'var(--text-h)' }}>
                        {fmtInt(r.value)} units
                      </span>
                    </span>
                  </li>
                );
              })}
              {focused.rows.length > 8 && (
                <li className="text-[9px]" style={{ color: 'var(--text-dim)' }}>
                  + {focused.rows.length - 8} more
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cost Burden chart — 100%-normalized stacked bars across geographies.
// Each bar shows three segments summing to 100% of total occupied housing
// units (B25003: ownerOccupied + renterOccupied):
//   - Affordable (< 30% of HHI on housing) — derived as universe − costBurden30
//   - Cost-burdened (30 – 49% of HHI) — costBurden30 minus costBurden50
//   - Severely cost-burdened (≥ 50% of HHI) — costBurden50
//
// Normalizing to share rather than absolute count makes Glenwood Springs
// (~10K hh) directly comparable to Garfield County (~25K hh) and Colorado
// (~2.4M hh). Sorted by combined burden share descending so the most
// stressed geographies surface first.
//
// Universe note: ownerOccupied + renterOccupied is a slightly broader
// denominator than the strict B25070 + B25091 cost-burden universe (which
// excludes owners without mortgages). Owners-without-mortgage are
// effectively never cost-burdened, so categorizing them inside Affordable
// matches how HUD and most planners report this metric.
// ---------------------------------------------------------------------------
function CostBurdenChart({
  geographies,
  highlightId,
  onActivate,
}: {
  geographies: Geography[];
  highlightId: string | null;
  onActivate: (id: string) => void;
}) {
  const rows = useMemo(() => {
    return geographies
      .map((g, idx) => {
        const owner = readNum(g.latest, 'ownerOccupied') ?? 0;
        const renter = readNum(g.latest, 'renterOccupied') ?? 0;
        const universe = owner + renter;
        const cb30 = readNum(g.latest, 'costBurden30'); // includes severe
        const cb50 = readNum(g.latest, 'costBurden50');
        if (universe <= 0 || cb30 == null) return null;
        const severe = cb50 ?? 0;
        const moderate = Math.max(0, cb30 - severe);
        const affordable = Math.max(0, universe - cb30);
        const totalBurdenShare = universe > 0 ? cb30 / universe : 0;
        return {
          geo: g,
          color: geoColor(idx),
          universe,
          affordable,
          moderate,
          severe,
          totalBurdenShare,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r != null)
      .sort((a, b) => b.totalBurdenShare - a.totalBurdenShare);
  }, [geographies]);

  const labelW = 132;
  const trailingW = 96;
  const rowGap = 6;
  // Rows fill available vertical space — bar height grows with the card.
  const minRowHeight = 18;

  return (
    <div className="flex flex-col gap-2 flex-1 min-h-0">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--text)' }}>
          <span className="inline-block rounded-sm" style={{ width: 10, height: 10, background: '#9CC479' }} />
          Affordable (&lt; 30% of HHI)
        </span>
        <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--text)' }}>
          <span className="inline-block rounded-sm" style={{ width: 10, height: 10, background: '#C8B273' }} />
          Cost-burdened (30 – 49% of HHI)
        </span>
        <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--text)' }}>
          <span className="inline-block rounded-sm" style={{ width: 10, height: 10, background: '#C47979' }} />
          Severely cost-burdened (≥ 50% of HHI)
        </span>
      </div>
      <div
        className="relative grid flex-1 min-h-0"
        style={{
          gridTemplateRows: `repeat(${Math.max(1, rows.length)}, minmax(${minRowHeight}px, 1fr))`,
          rowGap,
          minHeight: rows.length * (minRowHeight + rowGap),
        }}
      >
        {rows.map(({ geo, universe, affordable, moderate, severe, totalBurdenShare }) => {
          const isActive = highlightId === geo.id;
          const isDimmed = highlightId != null && !isActive;
          const affordablePct = (affordable / universe) * 100;
          const moderatePct = (moderate / universe) * 100;
          const severePct = (severe / universe) * 100;
          return (
            <div
              key={geo.id}
              className="grid items-center gap-2"
              style={{
                gridTemplateColumns: `${labelW}px 1fr ${trailingW}px`,
                opacity: isDimmed ? 0.55 : 1,
                cursor: 'pointer',
              }}
              onClick={() => onActivate(geo.id)}
            >
              <div
                className="text-[11px] truncate"
                style={{
                  color: isActive ? 'var(--accent)' : 'var(--text-h)',
                  fontWeight: isActive ? 600 : 400,
                }}
                title={geo.label}
              >
                {geo.label}
              </div>
              <div
                className="relative flex w-full overflow-hidden rounded-sm h-full"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--panel-border)',
                  minHeight: minRowHeight,
                }}
              >
                <div
                  style={{
                    width: `${affordablePct}%`,
                    background: '#9CC479',
                    opacity: 0.92,
                  }}
                  title={`${geo.label} · Affordable (<30% HHI): ${fmtInt(affordable)} units (${affordablePct.toFixed(1)}%)`}
                />
                <div
                  style={{
                    width: `${moderatePct}%`,
                    background: '#C8B273',
                    opacity: 0.92,
                  }}
                  title={`${geo.label} · Cost-burdened (30-49% HHI): ${fmtInt(moderate)} units (${moderatePct.toFixed(1)}%)`}
                />
                <div
                  style={{
                    width: `${severePct}%`,
                    background: '#C47979',
                    opacity: 0.92,
                  }}
                  title={`${geo.label} · Severely cost-burdened (≥50% HHI): ${fmtInt(severe)} units (${severePct.toFixed(1)}%)`}
                />
              </div>
              <div className="text-[10px] tnum text-right" style={{ color: 'var(--text-dim)' }}>
                <span style={{ color: isActive ? 'var(--accent)' : 'var(--text-h)' }}>
                  {(totalBurdenShare * 100).toFixed(0)}%
                </span>
                {' burdened'}
                <div className="text-[9px]" style={{ color: 'var(--text-dim)' }}>
                  {fmtInt(universe)} units
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Affordability Ratio chart (F1) — median home value ÷ median HH income
// across geographies. Demographics envelope supplies medianHhIncome; the
// housing envelope supplies medianHomeValueAcs. Reference line at 5.0
// marks the conventional "moderately unaffordable" threshold.
// ---------------------------------------------------------------------------
function AffordabilityRatioChart({
  geographies,
  highlightId,
  onActivate,
  incomeByGeoId,
}: {
  geographies: Geography[];
  highlightId: string | null;
  onActivate: (id: string) => void;
  incomeByGeoId: Map<string, number>;
}) {
  const rows = useMemo(() => {
    return geographies
      .map((g, idx) => {
        const value = readNum(g.latest, 'medianHomeValueAcs');
        const income = incomeByGeoId.get(g.id);
        if (value == null || income == null || income <= 0) return null;
        const ratio = value / income;
        return { geo: g, color: geoColor(idx), value, income, ratio };
      })
      .filter((r): r is NonNullable<typeof r> => r != null)
      .sort((a, b) => b.ratio - a.ratio);
  }, [geographies, incomeByGeoId]);

  const xMax = useMemo(() => {
    const m = rows.reduce((acc, r) => Math.max(acc, r.ratio), 0);
    return Math.max(8, Math.ceil(m + 1));
  }, [rows]);

  // Match CostBurdenChart row geometry exactly so the two cards' rows
  // line up vertically when rendered side-by-side.
  const labelW = 132;
  const trailingW = 96;
  const rowGap = 6;
  const minRowHeight = 18;

  return (
    <div className="flex flex-col gap-2 flex-1 min-h-0">
      {/* Match CostBurdenChart's 3-segment legend so the two cards have
          identical above-grid header heights — guarantees row-by-row
          vertical alignment when rendered side-by-side. */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--text)' }}>
          <span className="inline-block rounded-sm" style={{ width: 10, height: 10, background: '#9CC479' }} />
          Affordable (&lt; 4×)
        </span>
        <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--text)' }}>
          <span className="inline-block rounded-sm" style={{ width: 10, height: 10, background: '#C8B273' }} />
          Strained (4 – 6×)
        </span>
        <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--text)' }}>
          <span className="inline-block rounded-sm" style={{ width: 10, height: 10, background: '#C47979' }} />
          Severely unaffordable (≥ 6×)
        </span>
      </div>
      <div
        className="relative grid flex-1 min-h-0"
        style={{
          gridTemplateRows: `repeat(${Math.max(1, rows.length)}, minmax(${minRowHeight}px, 1fr))`,
          rowGap,
          minHeight: rows.length * (minRowHeight + rowGap),
        }}
      >
        {rows.map(({ geo, ratio, value, income }) => {
          const isActive = highlightId === geo.id;
          const isDimmed = highlightId != null && !isActive;
          const widthPct = (ratio / xMax) * 100;
          const refPct = (5 / xMax) * 100;
          // Color-code by severity: < 4.0 sage; 4.0-6.0 wheat; ≥ 6.0 brick.
          let barColor = '#9CC479';
          if (ratio >= 6) barColor = '#C47979';
          else if (ratio >= 4) barColor = '#C8B273';
          return (
            <div
              key={geo.id}
              className="grid items-center gap-2"
              style={{
                gridTemplateColumns: `${labelW}px 1fr ${trailingW}px`,
                opacity: isDimmed ? 0.55 : 1,
                cursor: 'pointer',
              }}
              onClick={() => onActivate(geo.id)}
            >
              <div
                className="text-[11px] truncate"
                style={{
                  color: isActive ? 'var(--accent)' : 'var(--text-h)',
                  fontWeight: isActive ? 600 : 400,
                }}
                title={geo.label}
              >
                {geo.label}
              </div>
              <div
                className="relative w-full overflow-hidden rounded-sm h-full"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--panel-border)',
                  minHeight: minRowHeight,
                }}
              >
                <div
                  className="h-full"
                  style={{
                    width: `${widthPct}%`,
                    background: isActive ? 'var(--accent)' : barColor,
                    opacity: 0.92,
                  }}
                  title={`${geo.label}: ${ratio.toFixed(2)}× ($${fmtInt(value)} ÷ $${fmtInt(income)})`}
                />
                {/* Reference line at 5× */}
                <div
                  className="absolute top-0 bottom-0"
                  style={{
                    left: `${refPct}%`,
                    width: 1,
                    background: 'rgba(255,255,255,0.4)',
                  }}
                />
              </div>
              <div className="text-[10px] tnum text-right" style={{ color: 'var(--text-h)' }}>
                {ratio.toFixed(1)}×
              </div>
            </div>
          );
        })}
      </div>
      {rows.length === 0 && (
        <div className="text-[10px] italic" style={{ color: 'var(--text-dim)' }}>
          Affordability ratio unavailable — both medianHomeValueAcs and medianHhIncome required.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-level section
// ---------------------------------------------------------------------------
export function HousingMarketSection({
  bundle,
  selectedZip,
}: {
  bundle: ContextBundle | null;
  selectedZip: string | null;
}) {
  const housing = bundle?.housing ?? null;
  const geographies = useMemo(() => deriveGeographies(housing), [housing]);

  // Default the active geography to the user's current ZIP selection if it
  // resolves to a place; otherwise default to Glenwood Springs; otherwise
  // the first geography with a Typical Home Value.
  const defaultId = useMemo(() => {
    if (selectedZip) {
      const m = geographies.find((g) => g.kind === 'place' && g.id === `place:${selectedZip}`);
      if (m && typeValue(m.latest, 'zhviAvg') != null) return m.id;
    }
    const gws = geographies.find((g) => g.label === 'Glenwood Springs' && typeValue(g.latest, 'zhviAvg') != null);
    if (gws) return gws.id;
    return geographies.find((g) => typeValue(g.latest, 'zhviAvg') != null)?.id ?? null;
  }, [geographies, selectedZip]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const effectiveActiveId = activeId ?? defaultId;
  const activeGeo = useMemo(
    () => geographies.find((g) => g.id === effectiveActiveId) ?? null,
    [geographies, effectiveActiveId],
  );
  // Selected housing type (null = use the average ZHVI metric). When set,
  // the time-series chart and the city-comparison chart both retarget to
  // this metric so the user can pivot the section between Average,
  // Single Family, Condo, or any of the bedroom buckets.
  const [selectedTypeKey, setSelectedTypeKey] = useState<string | null>(null);
  const typeKey = selectedTypeKey ?? 'zhviAvg';
  const typeLabel = useMemo(
    () => TYPE_AXES.find((t) => t.key === typeKey)?.label ?? 'Average',
    [typeKey],
  );
  // Toggle handlers — clicking the active selection clears it back to the
  // default. Mirrors the segmented-control style cross-filter the user
  // expects from the rankings panel.
  const handleSelectCity = (id: string) => {
    setActiveId((prev) => (prev === id ? null : id));
  };
  const handleSelectType = (key: string) => {
    setSelectedTypeKey((prev) => (prev === key ? null : key));
  };

  // Housing Units Trend toggles (mirror Population Trend in DemographicsSection).
  const [huPeriod, setHuPeriod] = useState<'current' | 'historical'>('current');
  const [huGeoKind, setHuGeoKind] = useState<'place' | 'county' | 'state'>('place');
  const huGeographies = useMemo(
    () => geographies.filter((g) => g.kind === huGeoKind),
    [geographies, huGeoKind],
  );

  // Median household income lookup for the Affordability Ratio chart —
  // joined from the demographics envelope by geography ID. Each Geography in
  // this section has the same id format ('place:81601', 'county:08045',
  // 'state:08') used in DemographicsSection, so the join is direct.
  const incomeByGeoId = useMemo(() => {
    const m = new Map<string, number>();
    const demo = bundle?.demographics;
    if (!demo) return m;
    for (const p of demo.places) {
      const inc = typeof p.latest?.medianHhIncome === 'number' ? p.latest.medianHhIncome : null;
      if (inc != null) {
        m.set(`place:${p.zip}`, inc);
        // Housing section also uses 'national:US' for the United States
        // benchmark; demographics doesn't carry that geography. Skip cleanly.
      }
    }
    for (const c of demo.counties) {
      const inc = typeof c.latest?.medianHhIncome === 'number' ? c.latest.medianHhIncome : null;
      if (inc != null) m.set(`county:${c.geoid}`, inc);
    }
    if (demo.state) {
      const inc = typeof demo.state.latest?.medianHhIncome === 'number' ? demo.state.latest.medianHhIncome : null;
      if (inc != null) m.set(`state:${demo.state.fips}`, inc);
    }
    return m;
  }, [bundle?.demographics]);

  if (!housing) {
    return (
      <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
        Loading housing context…
      </div>
    );
  }

  const vintageEnd = housing.vintageRange?.end ?? null;
  const vintageStart = housing.vintageRange?.start ?? null;

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* === Section opener: ACS/SDO/NHGIS-driven housing metrics ===
          About-this-data tile + ACS-derived headline KPIs (median home
          value, gross rent, owner-occupied %, cost-burdened %). The Zillow
          ZHVI block is moved to its own dedicated subsection at the bottom
          of the section so users see the authoritative public-source data
          first and can use Zillow as a complementary higher-frequency
          cross-check. */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] grid-cols-1">
        <HousingDataSetTile />
        <HeadlineStats
          geo={activeGeo}
          vintageEnd={vintageEnd}
          medianHhIncome={
            activeGeo ? incomeByGeoId.get(activeGeo.id) ?? null : null
          }
        />
      </div>

      {/* Housing characteristics tile — SDO 2024 vintage characteristics. */}
      <div className="grid gap-3 grid-cols-1">
        <HousingCharacteristicsTile geo={activeGeo} />
      </div>

      {/* Housing stock by year built — derived KPI strip + decade bars
          (ACS B25034). */}
      <div className="grid gap-3 grid-cols-1">
        <HousingVintageCard geo={activeGeo} vintageEnd={vintageEnd} />
      </div>

      {/* Housing Units Trend (current annual / historical decennial toggle).
          Mirrors the Population Trend chart in DemographicsSection so users
          have a consistent toggle pattern across both sections. */}
      <div className="grid gap-3 grid-cols-1">
        <ChartFrame
          title="Housing Units Trend"
          subtitle={
            huPeriod === 'historical'
              ? `Decennial 1970 → 2020 + ${vintageEnd ?? '2024'} anchor · NHGIS + CO SDO · click a line or legend item to highlight`
              : `Annual ${vintageStart ?? 2010} → ${vintageEnd ?? 'latest'} · CO SDO (places) + ACS B25001 (county/state)`
          }
        >
          <div className="flex items-center gap-2 flex-wrap">
            <SegmentedControl<'place' | 'county' | 'state'>
              ariaLabel="Geography level"
              value={huGeoKind}
              onChange={setHuGeoKind}
              options={[
                { value: 'place',  label: 'Place'  },
                { value: 'county', label: 'County' },
                { value: 'state',  label: 'State'  },
              ]}
            />
            <SegmentedControl<'current' | 'historical'>
              ariaLabel="Time period"
              value={huPeriod}
              onChange={setHuPeriod}
              options={[
                { value: 'current',    label: 'Current'    },
                { value: 'historical', label: 'Historical' },
              ]}
            />
          </div>
          <HousingTrendChart
            geographies={huGeographies}
            metricKey="housingUnits"
            trendSource={huPeriod}
            highlightId={effectiveActiveId}
            onActivate={handleSelectCity}
            showGrowthAnnotations={huPeriod === 'historical'}
          />
        </ChartFrame>
      </div>

      {/* Cost Burden + Affordability Ratio — ACS-derived affordability
          indicators across all geographies. Click a row to retarget the
          active geography for the rest of the section. */}
      <div className="grid gap-3 lg:grid-cols-2 grid-cols-1 items-stretch">
        <ChartFrame
          title="Housing Cost Burden"
          subtitle={`Households paying 30%+ of HHI on housing · ACS 5-Year ${vintageEnd ?? 'latest'} (B25070 + B25091)`}
        >
          <CostBurdenChart
            geographies={geographies}
            highlightId={effectiveActiveId}
            onActivate={handleSelectCity}
          />
        </ChartFrame>
        <ChartFrame
          title="Affordability Ratio"
          subtitle={`Median home value ÷ median HH income · ACS 5-Year ${vintageEnd ?? 'latest'} · vertical line at 5×`}
        >
          <AffordabilityRatioChart
            geographies={geographies}
            highlightId={effectiveActiveId}
            onActivate={handleSelectCity}
            incomeByGeoId={incomeByGeoId}
          />
        </ChartFrame>
      </div>

      {/* === Zillow Home Value Index subsection ===
          Dedicated subsection housing every ZHVI-driven visualization.
          Sits at the bottom of the Housing section so the
          authoritative-public-source content (ACS / SDO / NHGIS) leads
          and Zillow's higher-frequency proprietary index follows as a
          complementary cross-check. Visual divider + h3 header signal
          the subsection break. */}
      <div className="flex items-center gap-3 mt-2">
        <h3
          className="text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
          style={{ color: 'var(--text-h)' }}
        >
          Zillow Home Value Index
        </h3>
        <div
          className="flex-1"
          style={{ height: 1, background: 'var(--panel-border)' }}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] grid-cols-1">
        <ZillowDataSetTile />
        <ZillowHeadlineStats geo={activeGeo} />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] grid-cols-1 items-stretch">
        <ChartFrame
          title="Typical Home Value by City"
          subtitle={`Zillow ZHVI · ${typeLabel} · annual, 2000 → latest · hover for values${activeId ? ` · filtered to ${activeGeo?.label ?? ''}` : ''}`}
        >
          <TimeSeriesChart
            geographies={geographies}
            activeId={activeId}
            highlightId={effectiveActiveId}
            onActivate={handleSelectCity}
            typeKey={typeKey}
          />
        </ChartFrame>

        <ChartFrame
          title="Housing Type Comparison"
          subtitle={activeGeo ? `${activeGeo.label} · radar · click an axis to pivot` : 'radar'}
        >
          <HousingTypeRadar
            geo={activeGeo}
            selectedTypeKey={selectedTypeKey}
            onSelectType={handleSelectType}
          />
        </ChartFrame>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] grid-cols-1">
        <ChartFrame
          title="Typical Home City Comparison"
          subtitle={`Click a bar to filter the time series · metric: ${typeLabel}`}
        >
          <CityComparisonBars
            geographies={geographies}
            activeId={effectiveActiveId}
            onActivate={handleSelectCity}
            typeKey={typeKey}
          />
        </ChartFrame>

        <ChartFrame
          title="Housing Type Comparison"
          subtitle={activeGeo ? `${activeGeo.label} · bars · click to pivot` : 'bars'}
        >
          <HousingTypeBars
            geo={activeGeo}
            selectedTypeKey={selectedTypeKey}
            onSelectType={handleSelectType}
          />
        </ChartFrame>
      </div>
    </div>
  );
}

// Suppress unused-imports lint when intFmt is only referenced inside the
// Intl.NumberFormat instance above.
void intFmt;
