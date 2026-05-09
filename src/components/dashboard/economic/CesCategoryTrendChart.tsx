// CesCategoryTrendChart — multi-year line chart for the CES sub-block.
//
// Two display modes:
//   - 'total':      one line per category. The category total at each year
//                   is the sum across all 7 age cohorts.
//   - 'per-cohort': one line per (category × cohort). Color carries the
//                   category; opacity carries the cohort (older = darker)
//                   so the visual telegraphs the aging story.
//
// Adapted from the MultiLineTrendChart pattern in DemographicsSection,
// simplified for a single geography (U.S. national).

import { useMemo, useState } from 'react';
import { line as d3Line } from 'd3-shape';
import { scaleLinear } from 'd3-scale';
import {
  CES_AGE_COHORT_ORDER,
  CES_AGE_LABELS,
  type CesAgeCohort,
  type CesTrend,
  type CesTrendPoint,
} from '../../../types/context';
import { fmtCompactUSD, fmtInt } from '../../../lib/format';

export type CesTrendMode = 'total' | 'per-cohort';

export interface CesCategoryPath {
  path: string; // dotted, e.g. "income.wagesBusiness"
  label: string;
  color: string;
}

export interface CesCategoryTrendChartProps {
  trend: CesTrend;
  categories: ReadonlyArray<CesCategoryPath>;
  mode: CesTrendMode;
}

// Older cohorts darker; younger cohorts ghosted. Matches the "aging story"
// reading — your eye follows the dark lines rising on the right.
const COHORT_OPACITY: Record<CesAgeCohort, number> = {
  u25: 0.32,
  a25_34: 0.45,
  a35_44: 0.58,
  a45_54: 0.72,
  a55_64: 0.85,
  a65_74: 1.0,
  a75plus: 1.0,
};

const W = 460;
const H = 240;
const M = { top: 8, right: 12, bottom: 24, left: 56 };
const innerW = W - M.left - M.right;
const innerH = H - M.top - M.bottom;

interface SeriesRow {
  key: string;        // unique line id
  catKey: string;     // category dotted path
  catLabel: string;
  color: string;
  cohort: CesAgeCohort | null; // null = "Total"
  opacity: number;
  points: { year: number; value: number }[];
}

function buildSeries(
  trend: CesTrend,
  categories: ReadonlyArray<CesCategoryPath>,
  mode: CesTrendMode,
): SeriesRow[] {
  const out: SeriesRow[] = [];
  for (const cat of categories) {
    const points: CesTrendPoint[] = trend[cat.path] ?? [];
    if (mode === 'total') {
      // Sum across cohorts per year
      const byYear = new Map<number, number>();
      for (const p of points) {
        if (p.value == null) continue;
        byYear.set(p.year, (byYear.get(p.year) ?? 0) + p.value);
      }
      const ordered = Array.from(byYear.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([year, value]) => ({ year, value }));
      out.push({
        key: cat.path,
        catKey: cat.path,
        catLabel: cat.label,
        color: cat.color,
        cohort: null,
        opacity: 1,
        points: ordered,
      });
    } else {
      // One line per (category, cohort)
      for (const cohort of CES_AGE_COHORT_ORDER) {
        const pts = points
          .filter((p) => p.cohort === cohort && p.value != null)
          .map((p) => ({ year: p.year, value: p.value as number }))
          .sort((a, b) => a.year - b.year);
        if (pts.length === 0) continue;
        out.push({
          key: `${cat.path}::${cohort}`,
          catKey: cat.path,
          catLabel: cat.label,
          color: cat.color,
          cohort,
          opacity: COHORT_OPACITY[cohort],
          points: pts,
        });
      }
    }
  }
  return out;
}

export function CesCategoryTrendChart({
  trend,
  categories,
  mode,
}: CesCategoryTrendChartProps) {
  const series = useMemo(
    () => buildSeries(trend, categories, mode),
    [trend, categories, mode],
  );

  const { xMin, xMax, yMax } = useMemo(() => {
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMax = 0;
    for (const s of series) {
      for (const p of s.points) {
        if (p.year < xMin) xMin = p.year;
        if (p.year > xMax) xMax = p.year;
        if (p.value > yMax) yMax = p.value;
      }
    }
    if (!Number.isFinite(xMin)) xMin = 2014;
    if (!Number.isFinite(xMax)) xMax = 2023;
    return { xMin, xMax, yMax };
  }, [series]);

  const sx = useMemo(
    () => scaleLinear().domain([xMin, xMax]).range([0, innerW]),
    [xMin, xMax],
  );
  const sy = useMemo(
    () => scaleLinear().domain([0, yMax * 1.05 || 1]).range([innerH, 0]),
    [yMax],
  );

  const lineGen = useMemo(
    () =>
      d3Line<{ year: number; value: number }>()
        .x((d) => sx(d.year))
        .y((d) => sy(d.value)),
    [sx, sy],
  );

  const yTicks = useMemo(() => sy.ticks(4), [sy]);
  const xTicks = useMemo(() => {
    const out: number[] = [];
    const span = xMax - xMin;
    const step = span > 8 ? 2 : 1;
    for (let y = Math.ceil(xMin / step) * step; y <= xMax; y += step) out.push(y);
    return out;
  }, [xMin, xMax]);

  // Hover state — snap to nearest year present in any series.
  const [hoverYear, setHoverYear] = useState<number | null>(null);
  const allYears = useMemo(() => {
    const set = new Set<number>();
    for (const s of series) for (const p of s.points) set.add(p.year);
    return Array.from(set).sort((a, b) => a - b);
  }, [series]);

  const xToYear = (xViewBox: number): number | null => {
    if (allYears.length === 0) return null;
    const xData = sx.invert(xViewBox);
    let best = allYears[0];
    let bestDist = Math.abs(allYears[0] - xData);
    for (let i = 1; i < allYears.length; i++) {
      const d = Math.abs(allYears[i] - xData);
      if (d < bestDist) {
        bestDist = d;
        best = allYears[i];
      }
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
        const pt = s.points.find((p) => p.year === hoverYear);
        if (!pt) return null;
        return { series: s, value: pt.value };
      })
      .filter(
        (x): x is { series: SeriesRow; value: number } => x != null,
      )
      .sort((a, b) => b.value - a.value);
    if (rows.length === 0) return null;
    return { year: hoverYear, rows };
  }, [hoverYear, series]);

  const tooltipPct = useMemo(() => {
    if (!focused) return null;
    const cx = M.left + sx(focused.year);
    return { left: (cx / W) * 100 };
  }, [focused, sx]);

  // Legend — collapses cohort lines into one swatch per category.
  const legendItems = useMemo(
    () =>
      categories.map((c) => ({
        key: c.path,
        label: c.label,
        color: c.color,
      })),
    [categories],
  );

  return (
    <div className="flex flex-col gap-2 flex-1">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {legendItems.map((it) => (
          <span
            key={it.key}
            className="flex items-center gap-1.5 text-[10px]"
            style={{ color: 'var(--text)' }}
          >
            <span
              className="inline-block rounded-full"
              style={{ width: 8, height: 8, background: it.color }}
            />
            {it.label}
          </span>
        ))}
      </div>
      <div className="relative w-full flex-1 flex flex-col" style={{ minHeight: 220 }}>
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
                  {fmtCompactUSD(t)}
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
              const path = lineGen(s.points) ?? '';
              return (
                <path
                  key={s.key}
                  d={path}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={mode === 'total' ? 2.2 : 1.2}
                  opacity={s.opacity}
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
                    key={r.series.key}
                    cx={sx(focused.year)}
                    cy={sy(r.value)}
                    r={mode === 'total' ? 3 : 2}
                    fill={r.series.color}
                    opacity={r.series.opacity}
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
              minWidth: 180,
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
              {focused.rows.slice(0, 12).map((r) => (
                <li
                  key={r.series.key}
                  className="flex items-center gap-2 justify-between"
                  style={{ color: 'var(--text)' }}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block rounded-full"
                      style={{
                        width: 6,
                        height: 6,
                        background: r.series.color,
                        opacity: r.series.opacity,
                      }}
                    />
                    {mode === 'total'
                      ? r.series.catLabel
                      : `${r.series.catLabel} · ${
                          r.series.cohort ? CES_AGE_LABELS[r.series.cohort] : ''
                        }`}
                  </span>
                  <span className="tnum" style={{ color: 'var(--text-h)' }}>
                    ${fmtInt(r.value)}
                  </span>
                </li>
              ))}
              {focused.rows.length > 12 && (
                <li
                  className="text-[9px]"
                  style={{ color: 'var(--text-dim)' }}
                >
                  + {focused.rows.length - 12} more
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
