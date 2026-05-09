// DemographicsSection — full ACS-driven panel for the Dashboard's
// Demographics section. Mirrors HousingMarketSection in structure: a
// dataset descriptor card + headline KPI strip on top, then a series of
// charts that surface what `public/data/context/demographics.json` and
// `education.json` already publish but the prior ContextCards-row was
// hiding (median age, age cohorts, income, race/ethnicity, household
// composition).
//
// Layout:
//   Row 1 — About card  ·  Headline KPI strip (4 tiles)
//   Row 2 — Population trend  ·  Median household income trend
//   Row 3 — Age distribution (stacked bars per geography, 100%-normalized)
//   Row 4 — Race composition  ·  Hispanic / non-Hispanic share
//   Row 5 — Household composition (Family vs Non-Family)
//
// Geography selection mirrors Housing: click a bar → set the active
// geography for the headline strip + trend highlight. When the dashboard
// has an anchor selected, the matching place geography is the default.

import { useMemo, useState } from 'react';
import { line as d3Line } from 'd3-shape';
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
  '#A8C49C', // celadon — Mesa County
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
          U.S. Census ACS 5-Year Estimates
        </div>
      </div>
      <p className="text-[11px] leading-snug" style={{ color: 'var(--text)' }}>
        The American Community Survey 5-Year Estimates pool five years of
        rolling household sample to publish demographic, age, race, household,
        and income tables down to ZIP-code-level geographies. Estimates are
        released annually and reflect the average conditions across the
        five-year window — they smooth out year-to-year noise but lag the
        present by roughly two years. Education attainment is drawn from the
        ACS subject table S1501.
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
function HeadlineStats({ geo }: { geo: DemoGeography | null }) {
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
            {geo?.label ?? '—'} · ACS 5-Year
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
// Reused for Population and Median HH Income.
// ---------------------------------------------------------------------------
function MultiLineTrendChart({
  geographies,
  metricKey,
  highlightId,
  onActivate,
  formatY,
  formatTooltip,
}: {
  geographies: DemoGeography[];
  metricKey: string;
  highlightId: string | null;
  onActivate: (id: string) => void;
  formatY: (v: number) => string;
  formatTooltip: (v: number) => string;
}) {
  const series = useMemo(() => {
    return geographies
      .map((g, idx) => {
        const trend = (g.demoTrend?.[metricKey] ?? []).filter(
          (p): p is TrendPoint & { value: number } => p.value != null,
        );
        return { geo: g, color: geoColor(idx), trend };
      })
      .filter((s) => s.trend.length > 0);
  }, [geographies, metricKey]);

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

  const yTicks = useMemo(() => sy.ticks(4), [sy]);
  const xTicks = useMemo(() => {
    const span = xMax - xMin;
    const step = span > 10 ? 2 : 1;
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
        const pt = s.trend.find((p) => p.year === hoverYear);
        if (!pt) return null;
        return { geo: s.geo, color: s.color, value: pt.value };
      })
      .filter((x): x is { geo: DemoGeography; color: string; value: number } => x != null)
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
      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {series.map((s) => {
          const isActive = highlightId === s.geo.id;
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
                      {formatTooltip(r.value)}
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
  rowHeight = 18,
  rowGap = 6,
}: {
  geographies: DemoGeography[];
  segments: ReadonlyArray<{ key: string; label: string }>;
  palette: readonly string[];
  highlightId: string | null;
  onActivate: (id: string) => void;
  // Optional accessor for a trailing right-side label (e.g. total household
  // count rendered after the bar). Returns formatted string, or null to
  // suppress for that row.
  trailingLabel?: (geo: DemoGeography) => string | null;
  rowHeight?: number;
  rowGap?: number;
}) {
  // Build per-row segment percentages. Hide rows whose segments all
  // evaluate to zero/null so empty rows don't take vertical space.
  const rows = useMemo(() => {
    const built = geographies.map((g) => {
      const raw = segments.map((s) => readNum(g.demoLatest, s.key) ?? 0);
      const total = raw.reduce((a, b) => a + b, 0);
      return { geo: g, raw, total };
    });
    return built.filter((r) => r.total > 0);
  }, [geographies, segments]);

  // Layout — fixed left label gutter so rows align. The right-side trailing
  // label is reserved when trailingLabel is provided.
  const labelW = 132;
  const trailingW = trailingLabel ? 84 : 0;
  const trackHeight = rows.length * (rowHeight + rowGap);

  // Hover state for tooltip — track the active row + segment under cursor.
  const [hover, setHover] = useState<{ rowId: string; segIdx: number } | null>(null);

  return (
    <div className="flex flex-col gap-2 flex-1">
      {/* Legend */}
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
      {/* Bars — pure HTML/CSS; each row renders a flex track filled with
          percentage-width segments. Click handler bubbles up to setActiveId. */}
      <div
        className="relative flex flex-col"
        style={{ gap: rowGap, minHeight: trackHeight }}
      >
        {rows.map(({ geo, raw, total }) => {
          const isActive = highlightId === geo.id;
          const isDimmed = highlightId != null && !isActive;
          const trailing = trailingLabel ? trailingLabel(geo) : null;
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
                className="relative flex w-full overflow-hidden rounded-sm"
                style={{
                  height: rowHeight,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--panel-border)',
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
}: {
  geographies: DemoGeography[];
  highlightId: string | null;
  onActivate: (id: string) => void;
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
    // Pad to nearest multiple of 10 so the axis ticks read cleanly.
    return Math.max(10, Math.ceil(m / 10) * 10);
  }, [rows]);

  const labelW = 132;
  const trailingW = 56;
  const rowHeight = 18;
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
      {/* Axis hint */}
      <div className="flex justify-between text-[9px]" style={{ color: 'var(--text-dim)', paddingLeft: labelW + 8, paddingRight: trailingW + 8 }}>
        <span>0%</span>
        <span>{xMax}%</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aging trajectory mini-chart — share of population under 18 vs. 65+ over
// time for the active geography. Limited to those two cohorts because they
// are the only age fields with trend data published in ACS context bundle.
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

  if (!series || (series.u18.length === 0 && series.a65.length === 0)) {
    return (
      <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
        Aging trajectory unavailable for this geography.
      </div>
    );
  }

  const W = 360;
  const H = 140;
  const M = { top: 8, right: 8, bottom: 22, left: 32 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  const allYears = [
    ...series.u18.map((p) => p.year),
    ...series.a65.map((p) => p.year),
  ];
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

  const yTicks = sy.ticks(3);
  const xSpan = xMax - xMin;
  const xStep = xSpan > 10 ? 2 : 1;
  const xTicks: number[] = [];
  for (let y = Math.ceil(xMin / xStep) * xStep; y <= xMax; y += xStep) xTicks.push(y);

  return (
    <div className="flex flex-col gap-1">
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
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: 140 }}>
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
              <text x={-4} y={sy(t)} fontSize="8" textAnchor="end" dominantBaseline="middle" fill="var(--text-dim)">
                {t}%
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={sx(t)} y={innerH + 12} fontSize="8" textAnchor="middle" fill="var(--text-dim)">
              {t}
            </text>
          ))}
          {series.u18.length > 1 && (
            <path d={lineGen(series.u18) ?? ''} fill="none" stroke={AGE_PALETTE[0]} strokeWidth={1.6} />
          )}
          {series.a65.length > 1 && (
            <path d={lineGen(series.a65) ?? ''} fill="none" stroke={AGE_PALETTE[4]} strokeWidth={1.6} />
          )}
        </g>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-level section
// ---------------------------------------------------------------------------
export function DemographicsSection({
  bundle,
  selectedZip,
}: {
  bundle: ContextBundle | null;
  selectedZip: string | null;
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
        <HeadlineStats geo={activeGeo} />
      </div>

      {/* Row 2 — Trend charts */}
      <div className="grid gap-3 lg:grid-cols-2 grid-cols-1 items-stretch">
        <ChartFrame
          title="Population Trend"
          subtitle={`ACS 5-Year · ${demo.vintageRange?.start ?? 2010} → ${demo.vintageRange?.end ?? 'latest'} · click a line or legend item to highlight`}
        >
          <MultiLineTrendChart
            geographies={geographies}
            metricKey="population"
            highlightId={effectiveActiveId}
            onActivate={handleActivate}
            formatY={(v) => fmtInt(v)}
            formatTooltip={(v) => fmtInt(v)}
          />
        </ChartFrame>
        <ChartFrame
          title="Median Household Income Trend"
          subtitle={`ACS 5-Year · nominal dollars · ${demo.vintageRange?.start ?? 2010} → ${demo.vintageRange?.end ?? 'latest'}`}
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

      {/* Row 3 — Age distribution + aging trajectory */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] grid-cols-1 items-stretch">
        <ChartFrame
          title="Age Distribution"
          subtitle="Share of population by age cohort · click a row to focus"
        >
          <StackedBarChart
            geographies={geographies}
            segments={AGE_SEGMENTS}
            palette={AGE_PALETTE}
            highlightId={effectiveActiveId}
            onActivate={handleActivate}
          />
        </ChartFrame>
        <ChartFrame
          title="Aging Trajectory"
          subtitle={activeGeo ? `${activeGeo.label} · share Under 18 vs. 65+ over time` : '—'}
        >
          <AgingTrajectoryChart geo={activeGeo} />
        </ChartFrame>
      </div>

      {/* Row 4 — Race composition + Hispanic share */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] grid-cols-1 items-stretch">
        <ChartFrame
          title="Race Composition"
          subtitle="Share of population by race (any ethnicity) · click a row to focus"
        >
          <StackedBarChart
            geographies={geographies}
            segments={RACE_SEGMENTS}
            palette={RACE_PALETTE}
            highlightId={effectiveActiveId}
            onActivate={handleActivate}
          />
        </ChartFrame>
        <ChartFrame
          title="Hispanic Share"
          subtitle="Hispanic of any race · ranked by share"
        >
          <HispanicShareChart
            geographies={geographies}
            highlightId={effectiveActiveId}
            onActivate={handleActivate}
          />
        </ChartFrame>
      </div>

      {/* Row 5 — Household composition */}
      <div className="grid gap-3 grid-cols-1">
        <ChartFrame
          title="Household Composition"
          subtitle="Family vs. non-family households · total households shown on the right"
        >
          <StackedBarChart
            geographies={geographies}
            segments={HOUSEHOLD_SEGMENTS}
            palette={HOUSEHOLD_PALETTE}
            highlightId={effectiveActiveId}
            onActivate={handleActivate}
            trailingLabel={(g) => {
              const fam = readNum(g.demoLatest, 'familyHh') ?? 0;
              const non = readNum(g.demoLatest, 'nonFamilyHh') ?? 0;
              const total = fam + non;
              return total > 0 ? `${fmtInt(total)} hh` : null;
            }}
          />
        </ChartFrame>
      </div>
    </div>
  );
}
