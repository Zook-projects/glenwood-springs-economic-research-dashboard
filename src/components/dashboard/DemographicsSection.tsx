// DemographicsSection — full ACS-driven panel for the Dashboard's
// Demographics section, augmented with Colorado SDO place population
// (current + historical) and decennial state/county historical population.
//
// Layout:
//   Row 1 — About card  ·  Headline KPI strip (4 tiles)
//   Row 2 — Population trend (geo-kind + period toggles, growth annotations)  ·  Median HH income trend
//   Row 3 — Age distribution (stacked bars per geography, 100%-normalized)
//             with Aging Trajectory + Median Age trend stacked alongside
//   Row 4 — Race composition  ·  Hispanic / non-Hispanic share
//   Row 5 — Household composition (Family vs Non-Family)
//   Row 6 — Population Pyramid (active geography only)
//
// Geography selection mirrors Housing: click a bar → set the active
// geography for the headline strip + trend highlight. When the dashboard
// has an anchor selected, the matching place geography is the default.

import { useMemo, useState } from 'react';
import { line as d3Line, area as d3Area } from 'd3-shape';
import { scaleLinear } from 'd3-scale';
import type {
  ContextBundle,
  ContextEnvelope,
  ContextLatest,
  ContextTrend,
  TrendPoint,
} from '../../types/context';
import { ChartFrame } from './HousingMarketSection';
import { fmtInt, fmtCompactUSD } from '../../lib/format';
import type { WorkforceCountyFilter } from '../../types/flow';

// ---------------------------------------------------------------------------
// Geography model
// ---------------------------------------------------------------------------
type GeoKind = 'place' | 'county' | 'state';

interface DemoGeography {
  id: string;
  label: string;
  kind: GeoKind;
  // ACS demographics envelope row (population, age, race, household, income).
  demoLatest: ContextLatest | null;
  demoTrend: ContextTrend;
  // Decennial / SDO historical trend (population). Optional — present when
  // the builder emitted a historical series for this geography.
  demoHistoricalTrend: ContextTrend;
  // ACS education envelope row (eduLessHs..eduGradPlus, pctBachPlus). Joined
  // by id so the headline KPI strip can read Bachelor's+ alongside the
  // demographic metrics.
  eduLatest: ContextLatest | null;
}

function deriveGeographies(
  demo: ContextEnvelope | null,
  edu: ContextEnvelope | null,
): DemoGeography[] {
  if (!demo) return [];

  const eduPlace = (zip: string) => edu?.places.find((p) => p.zip === zip)?.latest ?? null;
  const eduCounty = (geoid: string) =>
    edu?.counties.find((c) => c.geoid === geoid)?.latest ?? null;
  const eduState = () => edu?.state?.latest ?? null;

  const out: DemoGeography[] = [];
  for (const p of demo.places) {
    out.push({
      id: `place:${p.zip}`,
      label: p.name,
      kind: 'place',
      demoLatest: p.latest,
      demoTrend: p.trend,
      demoHistoricalTrend: p.historicalTrend ?? {},
      eduLatest: eduPlace(p.zip),
    });
  }
  for (const c of demo.counties) {
    out.push({
      id: `county:${c.geoid}`,
      label: c.name,
      kind: 'county',
      demoLatest: c.latest,
      demoTrend: c.trend,
      demoHistoricalTrend: c.historicalTrend ?? {},
      eduLatest: eduCounty(c.geoid),
    });
  }
  if (demo.state) {
    out.push({
      id: `state:${demo.state.fips}`,
      label: demo.state.name,
      kind: 'state',
      demoLatest: demo.state.latest,
      demoTrend: demo.state.trend,
      demoHistoricalTrend: demo.state.historicalTrend ?? {},
      eduLatest: eduState(),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Visual tokens — duplicated from HousingMarketSection so both panels use a
// stable, index-keyed palette. Order chosen so adjacent places sit on
// different hues (helps the multi-line trend chart stay legible at small
// scales).
// ---------------------------------------------------------------------------
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
  '#D4B0A0', // peach — Old Snowmass
  '#FFB454', // amber — Eagle County
  '#A8A1C4', // lavender — Garfield County
  '#C4A87C', // tan — Pitkin County
  '#6E7280', // dim grey — Colorado
];

function geoColor(idx: number): string {
  return GEO_PALETTE[idx % GEO_PALETTE.length];
}

// Five-segment age cohort palette. Cool-to-warm progression so the eye
// reads "younger → older" left-to-right without needing labels.
const AGE_PALETTE = ['#7AC4D8', '#4FB3A9', '#9CC479', '#C8B273', '#C47979'];

// Six-segment race composition palette. Distinct hues so adjacent segments
// don't blur into each other in the stacked bar.
const RACE_PALETTE = ['#7AC4D8', '#9FB3C8', '#C29479', '#C8B273', '#94C4B7', '#B79CC4'];

// Two-segment household composition palette. Family households use the
// section accent, non-family the dim companion — keeps the bar readable
// even when one segment dominates.
const HOUSEHOLD_PALETTE = ['#4FB3A9', '#9FB3C8'];

// Population pyramid sex colors. Cyan male / adobe female from the shared
// palette — no semantic gender coding implied beyond the convention used by
// every demographic visualization in the field.
const PYRAMID_MALE = '#7AC4D8';
const PYRAMID_FEMALE = '#C29479';

// ---------------------------------------------------------------------------
// Field bundles
// ---------------------------------------------------------------------------
const AGE_SEGMENTS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'ageU18',     label: 'Under 18' },
  { key: 'age18to34',  label: '18 – 34' },
  { key: 'age35to54',  label: '35 – 54' },
  { key: 'age55to64',  label: '55 – 64' },
  { key: 'age65plus',  label: '65 +' },
];

const RACE_SEGMENTS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'white',      label: 'White' },
  { key: 'black',      label: 'Black' },
  { key: 'amInd',      label: 'Am. Indian / AK Native' },
  { key: 'asian',      label: 'Asian' },
  { key: 'nhpi',       label: 'Native HI / Pacific Is.' },
  { key: 'twoOrMore',  label: 'Two or more' },
];

const HOUSEHOLD_SEGMENTS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'familyHh',     label: 'Family' },
  { key: 'nonFamilyHh',  label: 'Non-family' },
];

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------
function readNum(latest: ContextLatest | null, key: string): number | null {
  if (!latest) return null;
  const v = latest[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function fmtPopulation(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return fmtInt(v);
}

function fmtPercent1(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(1)}%`;
}

function fmtMedianAge(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(1);
}

// ---------------------------------------------------------------------------
// ExpandToggle — small chevron button used in the Race / Hispanic /
// Household ChartFrame rightSlot to flip between the single-row "Region"
// collapsed view and the full geographies expanded view.
// ---------------------------------------------------------------------------
function ExpandToggle({
  expanded,
  onToggle,
  ariaLabel,
}: {
  expanded: boolean;
  onToggle: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={expanded}
      aria-label={ariaLabel}
      title={expanded ? 'Collapse to single row' : 'Expand to all geographies'}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-1"
      style={{
        color: 'var(--text-h)',
        border: '1px solid var(--panel-border)',
        background: 'transparent',
      }}
    >
      <svg
        width="9"
        height="9"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{
          transform: expanded ? 'rotate(180deg)' : 'none',
          transition: 'transform 120ms ease',
        }}
      >
        <path d="M2.5 4.5L6 8l3.5-3.5" />
      </svg>
      {expanded ? 'Collapse' : 'Expand'}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Reusable segmented control
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
// About-this-data tile
// ---------------------------------------------------------------------------
function DemographicsDataSetTile({ vintage }: { vintage: { start: number; end: number } | undefined }) {
  const coverage = vintage ? `${vintage.start} → ${vintage.end}` : '2010 → latest';
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
          U.S. Census ACS 5-Year Estimates · Colorado SDO · NHGIS
        </div>
      </div>
      <p className="text-[11px] leading-snug" style={{ color: 'var(--text)' }}>
        The American Community Survey 5-Year Estimates pool five years of
        rolling household sample to publish demographic, age, race, household,
        and income tables. Place-level population uses the Colorado State
        Demography Office vintage estimates (annual 2010 → 2024 + historical
        decennial 1950 → 2020) for higher precision at small-place scale.
        Education attainment is drawn from the ACS subject table S1501.
      </p>
      <ul className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1 mt-1">
        <li className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            Source
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-h)' }}>
            ACS 5-Year · CO SDO
          </span>
        </li>
        <li className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            Geography
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-h)' }}>
            Place · County · State
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
            Coverage
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-h)' }}>
            {coverage}
          </span>
        </li>
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Headline KPI strip
// ---------------------------------------------------------------------------
function HeadlineStats({ geo, vintageEnd }: { geo: DemoGeography | null; vintageEnd: number | null }) {
  const items: { label: string; value: string }[] = [
    { label: 'Population',         value: fmtPopulation(readNum(geo?.demoLatest ?? null, 'population')) },
    { label: 'Median age',         value: fmtMedianAge(readNum(geo?.demoLatest ?? null, 'medianAge')) },
    { label: 'Median HH income',   value: (() => {
      const v = readNum(geo?.demoLatest ?? null, 'medianHhIncome');
      return v == null ? '—' : `$${fmtInt(v)}`;
    })() },
    { label: "Bachelor's+ share",  value: fmtPercent1(readNum(geo?.eduLatest ?? null, 'pctBachPlus')) },
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
            Demographic Snapshot
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
            {geo?.label ?? '—'} · ACS 5-Year{vintageEnd ? ` ${vintageEnd}` : ''}
          </div>
        </div>
      </div>
      <div className="flex-1 flex items-center">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full justify-items-center text-center">
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
// Multi-line trend chart — generic over the ContextTrend metric key.
// Reused for Population (current/historical, geo-kind filtered) and
// Median HH income.
// ---------------------------------------------------------------------------
function MultiLineTrendChart({
  geographies,
  metricKey,
  trendSource = 'current',
  highlightId,
  onActivate,
  formatY,
  formatTooltip,
  showGrowthAnnotations = false,
}: {
  geographies: DemoGeography[];
  metricKey: string;
  // Which trend block to read from. 'historical' uses demoHistoricalTrend
  // (decennial cadence); 'current' uses demoTrend (annual ACS / SDO).
  trendSource?: 'current' | 'historical';
  highlightId: string | null;
  onActivate: (id: string) => void;
  formatY: (v: number) => string;
  formatTooltip: (v: number) => string;
  // When true, append a growth-since-first-year annotation to each legend
  // entry (used in Historical view of the Population Trend chart).
  showGrowthAnnotations?: boolean;
}) {
  const series = useMemo(() => {
    return geographies
      .map((g, idx) => {
        const src = trendSource === 'historical' ? g.demoHistoricalTrend : g.demoTrend;
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
  // baseline. Each series renders the area + line on top so the chart reads
  // as a series of overlapping ribbons.
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
        // % change since previous data point in this series. For decennial
        // series (historical view) this is decade-over-decade growth; for
        // annual series (current view) it's year-over-year growth.
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
      .filter((x): x is { geo: DemoGeography; color: string; value: number; pctChange: number | null; prevYear: number | null } => x != null)
      .sort((a, b) => b.value - a.value);
    if (rows.length === 0) return null;
    return { year: hoverYear, rows };
  }, [hoverYear, series]);

  const tooltipPct = useMemo(() => {
    if (!focused) return null;
    const cx = M.left + sx(focused.year);
    return { left: (cx / W) * 100 };
  }, [focused, sx, M.left]);

  // F2 — Growth-since-first-year annotation per series. Computed once per
  // series to keep render cheap.
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

  // Render markers (decennial dots) only when point spacing is wide enough
  // that they don't crowd out the line — primarily for the Historical view.
  const showMarkers = trendSource === 'historical';

  return (
    <div className="flex flex-col gap-2 flex-1">
      {/* Legend */}
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
                style={{
                  width: 8,
                  height: 8,
                  background: s.color,
                  boxShadow: isActive ? '0 0 0 2px var(--accent-soft)' : undefined,
                }}
              />
              {s.geo.label}
              {ann && (
                <span style={{ color: 'var(--text-dim)' }}>· {ann}</span>
              )}
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
                <text
                  x={-6}
                  y={sy(t)}
                  fontSize="9"
                  textAnchor="end"
                  dominantBaseline="middle"
                  fill="var(--text-dim)"
                >
                  {formatY(t)}
                </text>
              </g>
            ))}
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
            {series.map((s) => {
              const isActive = highlightId === s.geo.id;
              const isDimmed = highlightId != null && !isActive;
              const path = lineGen(s.trend) ?? '';
              const areaPath = areaGen(s.trend) ?? '';
              // Ribbon = filled area below the line + bold line on top.
              // Translucent area lets overlapping ribbons stay readable
              // when multiple geographies are visible.
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
                        {formatTooltip(r.value)}
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
// Stacked horizontal bar chart — used for Age, Race, and Household
// composition. Each row = one geography, normalized to 100% so smaller
// places aren't visually dwarfed by Colorado's row.
// ---------------------------------------------------------------------------
function StackedBarChart({
  geographies,
  segments,
  palette,
  highlightId,
  onActivate,
  trailingLabel,
  minRowHeight = 18,
  rowGap = 6,
  fixedRowHeight = false,
}: {
  geographies: DemoGeography[];
  segments: ReadonlyArray<{ key: string; label: string }>;
  palette: readonly string[];
  highlightId: string | null;
  onActivate: (id: string) => void;
  trailingLabel?: (geo: DemoGeography) => string | null;
  // Minimum bar height in pixels — bars grow above this to fill available
  // card space via CSS grid `minmax(minRowHeight, 1fr)`.
  minRowHeight?: number;
  rowGap?: number;
  // When true, every row renders at exactly `minRowHeight` (no vertical
  // stretching). Used by the composition cards in their collapsed
  // single-row view so the three cards line up at a consistent thickness.
  fixedRowHeight?: boolean;
}) {
  const rows = useMemo(() => {
    const built = geographies.map((g) => {
      const raw = segments.map((s) => readNum(g.demoLatest, s.key) ?? 0);
      const total = raw.reduce((a, b) => a + b, 0);
      return { geo: g, raw, total };
    });
    return built.filter((r) => r.total > 0);
  }, [geographies, segments]);

  const labelW = 132;
  const trailingW = trailingLabel ? 84 : 0;

  const [hover, setHover] = useState<{ rowId: string; segIdx: number } | null>(null);

  return (
    <div className="flex flex-col gap-2 flex-1 min-h-0">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {segments.map((s, idx) => (
          <span
            key={s.key}
            className="flex items-center gap-1.5 text-[10px]"
            style={{ color: 'var(--text)' }}
          >
            <span
              className="inline-block rounded-sm"
              style={{ width: 10, height: 10, background: palette[idx % palette.length] }}
            />
            {s.label}
          </span>
        ))}
      </div>
      {/* Rows live in a CSS grid with one row per geography. Each row uses
          minmax(minRowHeight, 1fr) so bars grow vertically to fill the
          card without distorting the surrounding labels. */}
      <div
        className="relative grid flex-1 min-h-0"
        style={{
          gridTemplateRows: fixedRowHeight
            ? `repeat(${Math.max(1, rows.length)}, ${minRowHeight}px)`
            : `repeat(${Math.max(1, rows.length)}, minmax(${minRowHeight}px, 1fr))`,
          rowGap,
          minHeight: rows.length * (minRowHeight + rowGap),
        }}
      >
        {rows.map(({ geo, raw, total }) => {
          const isActive = highlightId === geo.id;
          const isDimmed = highlightId != null && !isActive;
          const trailing = trailingLabel ? trailingLabel(geo) : null;
          // `fixedRowHeight` doubles as the collapsed-view signal: rows
          // are non-interactive (the synthetic Region id can't be
          // promoted into activeId without breaking downstream displays).
          const interactive = !fixedRowHeight;
          return (
            <div
              key={geo.id}
              className="grid items-center gap-2"
              style={{
                gridTemplateColumns: `${labelW}px 1fr ${trailingW}px`,
                opacity: isDimmed ? 0.55 : 1,
                cursor: interactive ? 'pointer' : 'default',
              }}
              onClick={interactive ? () => onActivate(geo.id) : undefined}
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
                {raw.map((value, segIdx) => {
                  if (value <= 0) return null;
                  const pct = (value / total) * 100;
                  const seg = segments[segIdx];
                  const isHovered = hover?.rowId === geo.id && hover?.segIdx === segIdx;
                  return (
                    <div
                      key={seg.key}
                      className="relative h-full"
                      style={{
                        width: `${pct}%`,
                        background: palette[segIdx % palette.length],
                        opacity: isHovered ? 1 : 0.92,
                        boxShadow: isHovered ? 'inset 0 0 0 1px rgba(255,255,255,0.5)' : undefined,
                      }}
                      onMouseEnter={() => setHover({ rowId: geo.id, segIdx })}
                      onMouseLeave={() => setHover((h) => (h?.rowId === geo.id && h?.segIdx === segIdx ? null : h))}
                      title={`${geo.label} · ${seg.label}: ${fmtInt(value)} (${pct.toFixed(1)}%)`}
                    />
                  );
                })}
              </div>
              {trailingW > 0 && (
                <div
                  className="text-[10px] tnum text-right"
                  style={{ color: 'var(--text-dim)' }}
                >
                  {trailing ?? ''}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hispanic share chart — single horizontal bar per geography. Hispanic is a
// separate ACS axis from race so it gets its own surface.
// ---------------------------------------------------------------------------
function HispanicShareChart({
  geographies,
  highlightId,
  onActivate,
  rowHeight: rowHeightOverride,
}: {
  geographies: DemoGeography[];
  highlightId: string | null;
  onActivate: (id: string) => void;
  // Optional fixed bar thickness in px. Used by the composition cards in
  // their collapsed single-row view to match the Race + Household bars.
  rowHeight?: number;
}) {
  const rows = useMemo(() => {
    return geographies
      .map((g, idx) => {
        const total = readNum(g.demoLatest, 'population');
        const hisp = readNum(g.demoLatest, 'hispanic');
        const pct = total != null && total > 0 && hisp != null ? (hisp / total) * 100 : null;
        return { geo: g, color: geoColor(idx), pct, hisp, total };
      })
      .filter((r) => r.pct != null)
      .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
  }, [geographies]);

  const xMax = useMemo(() => {
    const m = rows.reduce((acc, r) => Math.max(acc, r.pct ?? 0), 0);
    return Math.max(10, Math.ceil(m / 10) * 10);
  }, [rows]);

  const labelW = 132;
  const trailingW = 56;
  const rowHeight = rowHeightOverride ?? 18;
  const rowGap = 6;

  return (
    <div className="flex flex-col gap-2 flex-1">
      <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
        Hispanic share of total population (any race)
      </div>
      <div
        className="relative flex flex-col"
        style={{ gap: rowGap, minHeight: rows.length * (rowHeight + rowGap) }}
      >
        {rows.map(({ geo, pct, color }) => {
          const isActive = highlightId === geo.id;
          const isDimmed = highlightId != null && !isActive;
          const widthPct = ((pct ?? 0) / xMax) * 100;
          // `rowHeightOverride` doubles as the collapsed-view signal:
          // disable click + pointer cursor so the synthetic Region id
          // can't be promoted into activeId.
          const interactive = rowHeightOverride == null;
          return (
            <div
              key={geo.id}
              className="grid items-center gap-2"
              style={{
                gridTemplateColumns: `${labelW}px 1fr ${trailingW}px`,
                opacity: isDimmed ? 0.55 : 1,
                cursor: interactive ? 'pointer' : 'default',
              }}
              onClick={interactive ? () => onActivate(geo.id) : undefined}
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
                className="relative w-full overflow-hidden rounded-sm"
                style={{
                  height: rowHeight,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--panel-border)',
                }}
              >
                <div
                  className="h-full"
                  style={{
                    width: `${widthPct}%`,
                    background: isActive ? 'var(--accent)' : color,
                    opacity: 0.92,
                  }}
                />
              </div>
              <div className="text-[10px] tnum text-right" style={{ color: 'var(--text-h)' }}>
                {pct == null ? '—' : `${pct.toFixed(1)}%`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aging trajectory mini-chart — share of population under 18 vs. 65+ over
// time for the active geography. Auto-scales to fill its parent without
// distorting axis text.
// ---------------------------------------------------------------------------
function AgingTrajectoryChart({ geo }: { geo: DemoGeography | null }) {
  const series = useMemo(() => {
    if (!geo) return null;
    const pop = geo.demoTrend?.population ?? [];
    const u18 = geo.demoTrend?.ageU18 ?? [];
    const a65 = geo.demoTrend?.age65plus ?? [];
    const popMap = new Map<number, number>();
    for (const p of pop) {
      if (p.value != null && p.value > 0) popMap.set(p.year, p.value);
    }
    const buildShare = (rows: TrendPoint[]) =>
      rows
        .map((r) => {
          const tot = popMap.get(r.year);
          if (!tot || r.value == null) return null;
          return { year: r.year, value: (r.value / tot) * 100 };
        })
        .filter((p): p is { year: number; value: number } => p != null);
    return {
      u18: buildShare(u18),
      a65: buildShare(a65),
    };
  }, [geo]);

  // Year-snap hover state — must live above the early return so React's
  // hook order stays stable across renders (no-data → has-data transitions).
  const [hoverYear, setHoverYear] = useState<number | null>(null);

  // Pre-compute the year domain even when series is empty so the hover
  // helpers below don't have to branch on null. Default range mirrors
  // the empty-state defaults below.
  const allYears = useMemo(() => {
    if (!series) return [] as number[];
    const set = new Set<number>();
    for (const p of series.u18) set.add(p.year);
    for (const p of series.a65) set.add(p.year);
    return Array.from(set).sort((a, b) => a - b);
  }, [series]);

  if (!series || (series.u18.length === 0 && series.a65.length === 0)) {
    return (
      <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
        Aging trajectory unavailable for this geography.
      </div>
    );
  }

  // Aspect-preserving viewBox (xMidYMid meet) with a flexible flex-1
  // wrapper so the chart fills its card height without distorting axis
  // numerals horizontally as the card resizes. Inner SVG margin is generous
  // enough that 9px tick text + 30px y-axis labels never clip.
  const W = 360;
  const H = 220;
  const M = { top: 8, right: 12, bottom: 26, left: 36 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  const xMin = Math.min(...allYears, 2010);
  const xMax = Math.max(...allYears, 2024);
  const yMaxRaw = Math.max(
    ...series.u18.map((p) => p.value),
    ...series.a65.map((p) => p.value),
    0,
  );
  const yMax = Math.max(10, Math.ceil(yMaxRaw / 5) * 5);

  const sx = scaleLinear().domain([xMin, xMax]).range([0, innerW]);
  const sy = scaleLinear().domain([0, yMax]).range([innerH, 0]);
  const lineGen = d3Line<{ year: number; value: number }>()
    .x((d) => sx(d.year))
    .y((d) => sy(d.value));

  const yTicks = sy.ticks(4);
  const xSpan = xMax - xMin;
  const xStep = xSpan > 10 ? 2 : 1;
  const xTicks: number[] = [];
  for (let y = Math.ceil(xMin / xStep) * xStep; y <= xMax; y += xStep) xTicks.push(y);

  // ---- Hover snap + tooltip logic --------------------------------------
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

  const focused = hoverYear == null
    ? null
    : {
        year: hoverYear,
        u18: series.u18.find((p) => p.year === hoverYear)?.value ?? null,
        a65: series.a65.find((p) => p.year === hoverYear)?.value ?? null,
      };
  const tooltipPct = focused
    ? ((M.left + sx(focused.year)) / W) * 100
    : null;

  return (
    <div className="flex flex-col gap-1 flex-1 min-h-0">
      <div className="flex items-center gap-3 text-[10px]" style={{ color: 'var(--text)' }}>
        <span className="flex items-center gap-1">
          <span className="inline-block rounded-full" style={{ width: 8, height: 8, background: AGE_PALETTE[0] }} />
          Under 18 share
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block rounded-full" style={{ width: 8, height: 8, background: AGE_PALETTE[4] }} />
          65+ share
        </span>
      </div>
      <div className="flex-1 min-h-0 flex relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full h-full"
          style={{ display: 'block' }}
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
                <text x={-4} y={sy(t)} fontSize="9" textAnchor="end" dominantBaseline="middle" fill="var(--text-dim)">
                  {t}%
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <text key={t} x={sx(t)} y={innerH + 14} fontSize="9" textAnchor="middle" fill="var(--text-dim)">
                {t}
              </text>
            ))}
            {series.u18.length > 1 && (
              <path d={lineGen(series.u18) ?? ''} fill="none" stroke={AGE_PALETTE[0]} strokeWidth={1.6} />
            )}
            {series.a65.length > 1 && (
              <path d={lineGen(series.a65) ?? ''} fill="none" stroke={AGE_PALETTE[4]} strokeWidth={1.6} />
            )}
            {/* Hover guide + dots at the focused year */}
            {focused && (
              <g pointerEvents="none">
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
                {focused.u18 != null && (
                  <circle
                    cx={sx(focused.year)}
                    cy={sy(focused.u18)}
                    r={3}
                    fill={AGE_PALETTE[0]}
                    stroke="rgba(11,13,16,0.95)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {focused.a65 != null && (
                  <circle
                    cx={sx(focused.year)}
                    cy={sy(focused.a65)}
                    r={3}
                    fill={AGE_PALETTE[4]}
                    stroke="rgba(11,13,16,0.95)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
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
        {focused && tooltipPct != null && (
          <div
            className="pointer-events-none absolute rounded-md px-2 py-1.5 text-[10px]"
            style={{
              left: `${Math.min(95, Math.max(5, tooltipPct))}%`,
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
              {focused.year}
            </div>
            <ul className="flex flex-col gap-0.5">
              <li className="flex items-center gap-2 justify-between">
                <span className="flex items-center gap-1.5" style={{ color: 'var(--text)' }}>
                  <span className="inline-block rounded-full" style={{ width: 6, height: 6, background: AGE_PALETTE[0] }} />
                  Under 18
                </span>
                <span className="tnum" style={{ color: 'var(--text-h)' }}>
                  {focused.u18 != null ? `${focused.u18.toFixed(1)}%` : '—'}
                </span>
              </li>
              <li className="flex items-center gap-2 justify-between">
                <span className="flex items-center gap-1.5" style={{ color: 'var(--text)' }}>
                  <span className="inline-block rounded-full" style={{ width: 6, height: 6, background: AGE_PALETTE[4] }} />
                  65+
                </span>
                <span className="tnum" style={{ color: 'var(--text-h)' }}>
                  {focused.a65 != null ? `${focused.a65.toFixed(1)}%` : '—'}
                </span>
              </li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Median Age Trend chart (F3) — single-line trend for the active geography's
// median age over the ACS 5-Year window.
// ---------------------------------------------------------------------------
function MedianAgeTrendChart({ geo }: { geo: DemoGeography | null }) {
  const series = useMemo(() => {
    if (!geo) return [];
    return (geo.demoTrend?.medianAge ?? [])
      .filter((p): p is TrendPoint & { value: number } => p.value != null);
  }, [geo]);

  // Hover state — declared above the early return so React's hook order
  // stays stable when the geo's data availability changes.
  const [hoverYear, setHoverYear] = useState<number | null>(null);

  if (series.length < 2) {
    return (
      <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
        Median age trend unavailable for this geography.
      </div>
    );
  }

  const W = 360;
  const H = 200;
  const M = { top: 8, right: 12, bottom: 26, left: 36 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  const xMin = series[0].year;
  const xMax = series[series.length - 1].year;
  const yVals = series.map((p) => p.value);
  const yMin = Math.floor(Math.min(...yVals) - 1);
  const yMax = Math.ceil(Math.max(...yVals) + 1);

  const sx = scaleLinear().domain([xMin, xMax]).range([0, innerW]);
  const sy = scaleLinear().domain([yMin, yMax]).range([innerH, 0]);
  const lineGen = d3Line<{ year: number; value: number }>()
    .x((d) => sx(d.year))
    .y((d) => sy(d.value));

  const yTicks = sy.ticks(4);
  const xSpan = xMax - xMin;
  const xStep = xSpan > 10 ? 2 : 1;
  const xTicks: number[] = [];
  for (let y = Math.ceil(xMin / xStep) * xStep; y <= xMax; y += xStep) xTicks.push(y);

  const first = series[0];
  const last = series[series.length - 1];
  const delta = last.value - first.value;
  const sign = delta >= 0 ? '+' : '';

  // ---- Hover snap + tooltip logic --------------------------------------
  const allYears = series.map((p) => p.year);
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
    const idx = series.findIndex((p) => p.year === hoverYear);
    if (idx < 0) return null;
    const pt = series[idx];
    const prev = idx > 0 ? series[idx - 1] : null;
    return {
      year: pt.year,
      value: pt.value,
      prevYear: prev?.year ?? null,
      delta: prev ? pt.value - prev.value : null,
    };
  }, [hoverYear, series]);

  const tooltipPct = focused
    ? ((M.left + sx(focused.year)) / W) * 100
    : null;

  return (
    <div className="flex flex-col gap-1 flex-1 min-h-0">
      <div className="text-[10px] tabular-nums" style={{ color: 'var(--text)' }}>
        <span style={{ color: 'var(--text-h)' }}>{last.value.toFixed(1)} years</span>
        <span style={{ color: 'var(--text-dim)' }}> · {sign}{delta.toFixed(1)} since {first.year}</span>
      </div>
      <div className="flex-1 min-h-0 flex relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full h-full"
          style={{ display: 'block' }}
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
                <text x={-4} y={sy(t)} fontSize="9" textAnchor="end" dominantBaseline="middle" fill="var(--text-dim)">
                  {t.toFixed(0)}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <text key={t} x={sx(t)} y={innerH + 14} fontSize="9" textAnchor="middle" fill="var(--text-dim)">
                {t}
              </text>
            ))}
            <path d={lineGen(series) ?? ''} fill="none" stroke="var(--accent)" strokeWidth={1.8} />
            {series.map((p) => (
              <circle key={p.year} cx={sx(p.year)} cy={sy(p.value)} r={2} fill="var(--accent)" />
            ))}
            {/* Hover guide + dot at focused year */}
            {focused && (
              <g pointerEvents="none">
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
                <circle
                  cx={sx(focused.year)}
                  cy={sy(focused.value)}
                  r={3.5}
                  fill="var(--accent)"
                  stroke="rgba(11,13,16,0.95)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
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
        {focused && tooltipPct != null && (
          <div
            className="pointer-events-none absolute rounded-md px-2 py-1.5 text-[10px]"
            style={{
              left: `${Math.min(95, Math.max(5, tooltipPct))}%`,
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
              {focused.year}
            </div>
            <div className="flex items-center gap-2 justify-between">
              <span style={{ color: 'var(--text)' }}>Median age</span>
              <span className="flex items-center gap-1.5 tnum">
                {focused.delta != null && (
                  <span
                    className="text-[9px]"
                    style={{
                      color:
                        focused.delta >= 0 ? '#9CC479' : '#C47979',
                    }}
                    title={focused.prevYear != null ? `change since ${focused.prevYear}` : undefined}
                  >
                    {focused.delta >= 0 ? '+' : ''}
                    {focused.delta.toFixed(1)}
                  </span>
                )}
                <span style={{ color: 'var(--text-h)' }}>
                  {focused.value.toFixed(1)} yrs
                </span>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Population Pyramid (F5) — back-to-back horizontal bar chart of male × age
// (left) and female × age (right) for the active geography.
//
// Falls back to a 2-cohort condensed pyramid (Male U18 + Male 65+, Female
// U18 + Female 65+) if granular sex×age fields aren't in the bundle. The
// granular fields require expanding fetch-context-census.py to pull the
// 23-segment male/female B01001 breakdown — when that happens, this
// component will surface them automatically.
// ---------------------------------------------------------------------------
function PopulationPyramid({ geo }: { geo: DemoGeography | null }) {
  // Five aggregate cohorts (mirror AGE_SEGMENTS) with male/female totals
  // pulled from `male` / `female` direct fields scaled by each cohort's
  // share of the overall population.
  const data = useMemo(() => {
    if (!geo) return null;
    const latest = geo.demoLatest;
    if (!latest) return null;
    const totalPop = readNum(latest, 'population') ?? 0;
    const totalMale = readNum(latest, 'male') ?? 0;
    const totalFemale = readNum(latest, 'female') ?? 0;
    if (totalPop <= 0 || totalMale + totalFemale <= 0) return null;

    // Without granular sex×age in the bundle, distribute each cohort's
    // total proportionally to the overall male/female ratio. This is an
    // approximation — fine for an at-a-glance silhouette at the 5-cohort
    // resolution, but note in subtitle.
    const malePct = totalMale / (totalMale + totalFemale);
    const femalePct = totalFemale / (totalMale + totalFemale);

    const cohorts = AGE_SEGMENTS.map((s) => {
      const cohortTotal = readNum(latest, s.key) ?? 0;
      return {
        label: s.label,
        male: cohortTotal * malePct,
        female: cohortTotal * femalePct,
      };
    });

    return {
      cohorts,
      totalMale,
      totalFemale,
      totalPop,
      malePct,
      femalePct,
    };
  }, [geo]);

  if (!data || data.cohorts.length === 0) {
    return (
      <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
        Population pyramid unavailable for this geography.
      </div>
    );
  }

  const xMax = Math.max(
    ...data.cohorts.flatMap((c) => [c.male, c.female]),
    1,
  );

  const rowHeight = 16;
  const rowGap = 4;
  const labelW = 56;
  const halfW = 'calc((100% - 56px) / 2)';

  // Reverse so oldest cohort renders at the top — matches the
  // demographic-pyramid convention (younger at the base).
  const cohorts = [...data.cohorts].reverse();

  return (
    <div className="flex flex-col gap-2">
      {/* Header — sex split */}
      <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--text)' }}>
        <span className="flex items-center gap-1">
          <span className="inline-block rounded-sm" style={{ width: 10, height: 10, background: PYRAMID_MALE }} />
          Male {(data.malePct * 100).toFixed(1)}% ({fmtInt(data.totalMale)})
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block rounded-sm" style={{ width: 10, height: 10, background: PYRAMID_FEMALE }} />
          Female {(data.femalePct * 100).toFixed(1)}% ({fmtInt(data.totalFemale)})
        </span>
      </div>
      {/* Rows */}
      <div className="flex flex-col" style={{ gap: rowGap }}>
        {cohorts.map((c) => (
          <div
            key={c.label}
            className="grid items-center"
            style={{ gridTemplateColumns: `1fr ${labelW}px 1fr`, gap: 4 }}
          >
            {/* Male — extends rightward from the centerline */}
            <div className="flex justify-end" style={{ width: '100%' }}>
              <div
                className="h-full rounded-sm"
                style={{
                  height: rowHeight,
                  width: `${(c.male / xMax) * 100}%`,
                  background: PYRAMID_MALE,
                  opacity: 0.9,
                }}
                title={`Male ${c.label}: ${fmtInt(c.male)}`}
              />
            </div>
            {/* Cohort label */}
            <div
              className="text-[10px] text-center"
              style={{ color: 'var(--text-h)' }}
            >
              {c.label}
            </div>
            {/* Female */}
            <div className="flex justify-start" style={{ width: '100%' }}>
              <div
                className="h-full rounded-sm"
                style={{
                  height: rowHeight,
                  width: `${(c.female / xMax) * 100}%`,
                  background: PYRAMID_FEMALE,
                  opacity: 0.9,
                }}
                title={`Female ${c.label}: ${fmtInt(c.female)}`}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="text-[9px]" style={{ color: 'var(--text-dim)' }}>
        Cohorts distributed by overall sex ratio — granular sex×age available with B01001 detail pull.
      </div>
      {/* Half-width spacers (visual ref to where the centerline sits if anyone audits the layout). */}
      <div aria-hidden style={{ display: 'none', width: halfW }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-level section
// ---------------------------------------------------------------------------
// Study-area county GEOIDs used by the Region aggregate in the collapsed
// composition cards. Garfield + Pitkin + Eagle — same trio referenced in
// CommerceComparisons.tsx and ZHVI_COUNTY_FIPS_BY_FILTER in
// HousingMarketSection.tsx.
const REGION_COUNTY_GEOIDS = ['08045', '08097', '08037'] as const;

// Fields summed when building the synthetic "Region" geography for the
// collapsed Race / Hispanic / Household cards. All raw counts — ratios are
// computed downstream.
const REGION_AGGREGATE_KEYS = [
  'population',
  'hispanic',
  'white',
  'black',
  'amInd',
  'asian',
  'nhpi',
  'twoOrMore',
  'familyHh',
  'nonFamilyHh',
] as const;

function buildRegionGeo(geographies: DemoGeography[]): DemoGeography | null {
  const counties = REGION_COUNTY_GEOIDS
    .map((geoid) => geographies.find((g) => g.id === `county:${geoid}`))
    .filter((g): g is DemoGeography => !!g);
  if (counties.length === 0) return null;

  const summed: ContextLatest = {};
  for (const key of REGION_AGGREGATE_KEYS) {
    let total = 0;
    let any = false;
    for (const c of counties) {
      const v = readNum(c.demoLatest, key);
      if (v != null) {
        total += v;
        any = true;
      }
    }
    if (any) summed[key] = total;
  }

  return {
    id: 'region:study-area',
    label: 'Region',
    kind: 'county',
    demoLatest: summed,
    demoTrend: {},
    demoHistoricalTrend: {},
    eduLatest: null,
  };
}

const WORKFORCE_COUNTY_TO_GEOID: Record<'garfield' | 'pitkin', string> = {
  garfield: '08045',
  pitkin: '08097',
};

// Sink for click handlers in the collapsed composition cards. The synthetic
// Region id doesn't correspond to a real geography, so promoting it into
// activeId would break the downstream HeadlineStats / trend highlights.
const noopActivate = (_id: string) => { void _id; };

export function DemographicsSection({
  bundle,
  selectedZip,
  workforceCounty = 'all',
}: {
  bundle: ContextBundle | null;
  selectedZip: string | null;
  workforceCounty?: WorkforceCountyFilter;
}) {
  const demo = bundle?.demographics ?? null;
  const edu = bundle?.education ?? null;
  const geographies = useMemo(() => deriveGeographies(demo, edu), [demo, edu]);

  // Default geography mirrors HousingMarketSection: anchor → matching place;
  // otherwise Glenwood Springs (study-area centroid); otherwise the first
  // geography with a population reading.
  const defaultId = useMemo(() => {
    if (selectedZip) {
      const m = geographies.find((g) => g.kind === 'place' && g.id === `place:${selectedZip}`);
      if (m && readNum(m.demoLatest, 'population') != null) return m.id;
    }
    const gws = geographies.find(
      (g) => g.label === 'Glenwood Springs' && readNum(g.demoLatest, 'population') != null,
    );
    if (gws) return gws.id;
    return geographies.find((g) => readNum(g.demoLatest, 'population') != null)?.id ?? null;
  }, [geographies, selectedZip]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const effectiveActiveId = activeId ?? defaultId;
  const activeGeo = useMemo(
    () => geographies.find((g) => g.id === effectiveActiveId) ?? null,
    [geographies, effectiveActiveId],
  );

  const handleActivate = (id: string) => {
    setActiveId((prev) => (prev === id ? null : id));
  };

  // --- Population Trend toggles ------------------------------------------
  // Historical is the default and only view per the v3 dashboard refresh.
  // Geo-kind toggle still ships, now hosted in the ChartFrame's top-right
  // rightSlot so the chart canvas reclaims that vertical real estate.
  const [popGeoKind, setPopGeoKind] = useState<GeoKind>('place');
  const popGeographies = useMemo(
    () => geographies.filter((g) => g.kind === popGeoKind),
    [geographies, popGeoKind],
  );

  // --- Composition cards: expand/collapse + Region aggregate ------------
  // Race + Hispanic share one expand state per spec; Household has its own.
  // Default = collapsed → single bar for the Region (3-county aggregate,
  // unless the user has filtered to a county or workplace, in which case
  // that one geography is used).
  const [racePairExpanded, setRacePairExpanded] = useState(false);
  const [householdExpanded, setHouseholdExpanded] = useState(false);

  const regionGeo = useMemo(() => buildRegionGeo(geographies), [geographies]);

  // Resolve the single bar shown when a composition card is collapsed.
  // Priority: explicit place selection (sidebar workplace ZIP or active
  // bar) > county filter (sidebar) > region aggregate. Returns an empty
  // list as a defensive fallback when no geography can be resolved (e.g.
  // bundle still loading).
  const collapsedGeo = useMemo<DemoGeography | null>(() => {
    if (selectedZip) {
      const m = geographies.find((g) => g.id === `place:${selectedZip}`);
      if (m) return m;
    }
    if (activeId) {
      const m = geographies.find((g) => g.id === activeId);
      if (m) return m;
    }
    if (workforceCounty !== 'all') {
      const fips = WORKFORCE_COUNTY_TO_GEOID[workforceCounty];
      const m = geographies.find((g) => g.id === `county:${fips}`);
      if (m) return m;
    }
    return regionGeo;
  }, [selectedZip, activeId, workforceCounty, geographies, regionGeo]);
  const collapsedGeos = useMemo(
    () => (collapsedGeo ? [collapsedGeo] : []),
    [collapsedGeo],
  );

  const vintageEnd = demo?.vintageRange?.end ?? null;
  const vintageStart = demo?.vintageRange?.start ?? null;

  if (!demo) {
    return (
      <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
        Loading demographics context…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* Row 1 — About + Headline */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] grid-cols-1">
        <DemographicsDataSetTile vintage={demo.vintageRange} />
        <HeadlineStats geo={activeGeo} vintageEnd={vintageEnd} />
      </div>

      {/* Row 2 — Trend charts (population · median income) */}
      <div className="grid gap-3 lg:grid-cols-2 grid-cols-1 items-stretch">
        <ChartFrame
          title="Population Trend"
          subtitle={`Decennial 1950 → 2020 + ${vintageEnd ?? '2024'} anchor · CO SDO + Census`}
          rightSlot={
            <SegmentedControl<GeoKind>
              ariaLabel="Geography level"
              value={popGeoKind}
              onChange={setPopGeoKind}
              options={[
                { value: 'place',  label: 'Place'  },
                { value: 'county', label: 'County' },
                { value: 'state',  label: 'State'  },
              ]}
            />
          }
        >
          <MultiLineTrendChart
            geographies={popGeographies}
            metricKey="population"
            trendSource="historical"
            highlightId={effectiveActiveId}
            onActivate={handleActivate}
            formatY={(v) => fmtInt(v)}
            formatTooltip={(v) => fmtInt(v)}
            showGrowthAnnotations
          />
        </ChartFrame>
        <ChartFrame
          title="Median Household Income Trend"
          subtitle={`ACS 5-Year · nominal dollars · ${vintageStart ?? 2010} → ${vintageEnd ?? 'latest'}`}
        >
          <MultiLineTrendChart
            geographies={geographies}
            metricKey="medianHhIncome"
            highlightId={effectiveActiveId}
            onActivate={handleActivate}
            formatY={(v) => fmtCompactUSD(v)}
            formatTooltip={(v) => `$${fmtInt(v)}`}
          />
        </ChartFrame>
      </div>

      {/* Row 3 — Age distribution + Aging Trajectory + Median Age */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] grid-cols-1 items-stretch">
        <ChartFrame
          title="Age Distribution"
          subtitle={`Share of population by age cohort · ACS 5-Year ${vintageEnd ?? 'latest'} · click a row to focus`}
        >
          <StackedBarChart
            geographies={geographies}
            segments={AGE_SEGMENTS}
            palette={AGE_PALETTE}
            highlightId={effectiveActiveId}
            onActivate={handleActivate}
          />
        </ChartFrame>
        <div className="grid gap-3 grid-rows-2">
          <ChartFrame
            title="Aging Trajectory"
            subtitle={activeGeo ? `${activeGeo.label} · share Under 18 vs. 65+ · ACS 5-Year ${vintageStart ?? 2010}–${vintageEnd ?? 'latest'}` : '—'}
          >
            <AgingTrajectoryChart geo={activeGeo} />
          </ChartFrame>
          <ChartFrame
            title="Median Age Trend"
            subtitle={activeGeo ? `${activeGeo.label} · ACS 5-Year ${vintageStart ?? 2010}–${vintageEnd ?? 'latest'}` : '—'}
          >
            <MedianAgeTrendChart geo={activeGeo} />
          </ChartFrame>
        </div>
      </div>

      {/* Row 4 — Race composition + Hispanic share (paired expand state).
          Collapsed view = single bar for the resolved Region geo, rendered
          at a fixed 32px thickness, highlighted in amber, and non-interactive
          (clicks would otherwise stamp the synthetic 'region:study-area' id
          into activeId and break downstream displays that key on a real geo). */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] grid-cols-1 items-stretch">
        <ChartFrame
          title="Race Composition"
          subtitle={
            racePairExpanded
              ? `Share of population by race (any ethnicity) · ACS 5-Year ${vintageEnd ?? 'latest'} · click a row to focus`
              : `Share of population by race (any ethnicity) · ACS 5-Year ${vintageEnd ?? 'latest'} · ${collapsedGeo?.label ?? 'Region'}`
          }
          rightSlot={
            <ExpandToggle
              expanded={racePairExpanded}
              onToggle={() => setRacePairExpanded((v) => !v)}
              ariaLabel="Toggle Race + Hispanic expanded view"
            />
          }
        >
          <StackedBarChart
            geographies={racePairExpanded ? geographies : collapsedGeos}
            segments={RACE_SEGMENTS}
            palette={RACE_PALETTE}
            highlightId={racePairExpanded ? effectiveActiveId : collapsedGeo?.id ?? null}
            onActivate={racePairExpanded ? handleActivate : noopActivate}
            minRowHeight={racePairExpanded ? 18 : 32}
            fixedRowHeight={!racePairExpanded}
          />
        </ChartFrame>
        <ChartFrame
          title="Hispanic Share"
          subtitle={
            racePairExpanded
              ? `Hispanic of any race · ACS 5-Year ${vintageEnd ?? 'latest'} · ranked by share`
              : `Hispanic of any race · ACS 5-Year ${vintageEnd ?? 'latest'} · ${collapsedGeo?.label ?? 'Region'}`
          }
          rightSlot={
            <ExpandToggle
              expanded={racePairExpanded}
              onToggle={() => setRacePairExpanded((v) => !v)}
              ariaLabel="Toggle Race + Hispanic expanded view"
            />
          }
        >
          <HispanicShareChart
            geographies={racePairExpanded ? geographies : collapsedGeos}
            highlightId={racePairExpanded ? effectiveActiveId : collapsedGeo?.id ?? null}
            onActivate={racePairExpanded ? handleActivate : noopActivate}
            rowHeight={racePairExpanded ? undefined : 32}
          />
        </ChartFrame>
      </div>

      {/* Row 5 — Household composition */}
      <div className="grid gap-3 grid-cols-1">
        <ChartFrame
          title="Household Composition"
          subtitle={
            householdExpanded
              ? `Family vs. non-family households · ACS 5-Year ${vintageEnd ?? 'latest'} · total households shown on the right`
              : `Family vs. non-family households · ACS 5-Year ${vintageEnd ?? 'latest'} · ${collapsedGeo?.label ?? 'Region'}`
          }
          rightSlot={
            <ExpandToggle
              expanded={householdExpanded}
              onToggle={() => setHouseholdExpanded((v) => !v)}
              ariaLabel="Toggle Household Composition expanded view"
            />
          }
        >
          <StackedBarChart
            geographies={householdExpanded ? geographies : collapsedGeos}
            segments={HOUSEHOLD_SEGMENTS}
            palette={HOUSEHOLD_PALETTE}
            highlightId={householdExpanded ? effectiveActiveId : collapsedGeo?.id ?? null}
            onActivate={householdExpanded ? handleActivate : noopActivate}
            minRowHeight={householdExpanded ? 18 : 32}
            fixedRowHeight={!householdExpanded}
            trailingLabel={(g) => {
              const fam = readNum(g.demoLatest, 'familyHh') ?? 0;
              const non = readNum(g.demoLatest, 'nonFamilyHh') ?? 0;
              const total = fam + non;
              return total > 0 ? `${fmtInt(total)} hh` : null;
            }}
          />
        </ChartFrame>
      </div>

      {/* Row 6 — Population Pyramid */}
      <div className="grid gap-3 grid-cols-1">
        <ChartFrame
          title="Population Pyramid"
          subtitle={activeGeo ? `${activeGeo.label} · sex × age cohort · ACS 5-Year ${vintageEnd ?? 'latest'}` : '—'}
        >
          <PopulationPyramid geo={activeGeo} />
        </ChartFrame>
      </div>
    </div>
  );
}
