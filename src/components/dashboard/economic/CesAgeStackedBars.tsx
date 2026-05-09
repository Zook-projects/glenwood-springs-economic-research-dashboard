// CesAgeStackedBars — vertical stacked bar chart for the CES sub-block.
//
// One bar per age cohort (Under 25 → 75+); segments stack the categories
// passed in (Income, Income Tax, or Spending). Y-axis is dollar value with
// a zero baseline (no normalization), preserving the slide's height story:
// the older cohorts visibly earn / pay / spend less in absolute terms even
// though the category mix shifts dramatically.
//
// Hover surfaces a tooltip with category, cohort, value, and share of the
// hovered cohort's stack total. Mirrors the visual language of the
// stacked bars in DemographicsSection (palette swatches, ChartFrame parent,
// tabular-nums).

import { useMemo, useState } from 'react';
import { scaleLinear, scaleBand } from 'd3-scale';
import {
  CES_AGE_COHORT_ORDER,
  CES_AGE_LABELS,
  type CesAgeCohort,
  type CesCategoryValues,
} from '../../../types/context';
import { fmtCompactUSD, fmtInt } from '../../../lib/format';

export interface CesCategorySpec {
  key: string;
  label: string;
  color: string;
  values: CesCategoryValues;
}

export interface CesAgeStackedBarsProps {
  categories: ReadonlyArray<CesCategorySpec>;
  // When true, render a y-axis. Tax bars are an order of magnitude smaller
  // than income/spending bars; an axis on every chart keeps reading easy.
  showYAxis?: boolean;
  // Optional override for the value formatter (axis ticks + tooltip).
  formatY?: (v: number) => string;
}

const W = 460;
const H = 240;
const MARGIN = { top: 10, right: 12, bottom: 28, left: 50 };

export function CesAgeStackedBars({
  categories,
  showYAxis = true,
  formatY = (v) => fmtCompactUSD(v),
}: CesAgeStackedBarsProps) {
  const innerW = W - MARGIN.left - MARGIN.right;
  const innerH = H - MARGIN.top - MARGIN.bottom;

  // Compute per-cohort stack totals + max for y-domain.
  const totals = useMemo(() => {
    const out: Record<CesAgeCohort, number> = {
      u25: 0,
      a25_34: 0,
      a35_44: 0,
      a45_54: 0,
      a55_64: 0,
      a65_74: 0,
      a75plus: 0,
    };
    for (const cohort of CES_AGE_COHORT_ORDER) {
      let sum = 0;
      for (const c of categories) {
        const v = c.values[cohort];
        if (v != null && Number.isFinite(v)) sum += v;
      }
      out[cohort] = sum;
    }
    return out;
  }, [categories]);

  const yMax = useMemo(() => {
    let m = 0;
    for (const cohort of CES_AGE_COHORT_ORDER) {
      if (totals[cohort] > m) m = totals[cohort];
    }
    // Round up to a clean tick. Padding 8% so the tallest bar isn't flush.
    return m * 1.08 || 1;
  }, [totals]);

  const sx = useMemo(
    () =>
      scaleBand<CesAgeCohort>()
        .domain(CES_AGE_COHORT_ORDER as CesAgeCohort[])
        .range([0, innerW])
        .padding(0.18),
    [innerW],
  );
  const sy = useMemo(
    () => scaleLinear().domain([0, yMax]).range([innerH, 0]),
    [yMax, innerH],
  );

  const yTicks = useMemo(() => sy.ticks(4), [sy]);

  // Hover state — tracks which cohort + category is under the cursor.
  const [hover, setHover] = useState<{
    cohort: CesAgeCohort;
    catIdx: number;
  } | null>(null);

  const focused = useMemo(() => {
    if (!hover) return null;
    const cat = categories[hover.catIdx];
    if (!cat) return null;
    const value = cat.values[hover.cohort];
    if (value == null) return null;
    const total = totals[hover.cohort];
    const share = total > 0 ? (value / total) * 100 : 0;
    return {
      cohort: hover.cohort,
      cohortLabel: CES_AGE_LABELS[hover.cohort],
      cat,
      value,
      total,
      share,
    };
  }, [hover, categories, totals]);

  // Tooltip x-position as percentage of viewBox so it lines up regardless
  // of container width.
  const tooltipPct = useMemo(() => {
    if (!focused) return null;
    const bandX = sx(focused.cohort);
    if (bandX == null) return null;
    const cx = MARGIN.left + bandX + sx.bandwidth() / 2;
    return { left: (cx / W) * 100 };
  }, [focused, sx]);

  return (
    <div className="flex flex-col gap-2 flex-1">
      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {categories.map((c) => (
          <span
            key={c.key}
            className="flex items-center gap-1.5 text-[10px]"
            style={{ color: 'var(--text)' }}
          >
            <span
              className="inline-block rounded-sm"
              style={{ width: 10, height: 10, background: c.color }}
            />
            {c.label}
          </span>
        ))}
      </div>

      {/* Chart */}
      <div className="relative w-full flex-1 flex flex-col" style={{ minHeight: 220 }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="w-full h-full"
          style={{ display: 'block', flex: 1, minHeight: 200 }}
          onMouseLeave={() => setHover(null)}
        >
          <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
            {/* Y-axis grid + tick labels */}
            {showYAxis &&
              yTicks.map((t) => (
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

            {/* Bars — one per cohort, stacked from bottom up */}
            {CES_AGE_COHORT_ORDER.map((cohort) => {
              const bandX = sx(cohort);
              if (bandX == null) return null;
              const bw = sx.bandwidth();
              let stackTop = innerH; // running bottom-up offset in pixels
              return (
                <g key={cohort} transform={`translate(${bandX}, 0)`}>
                  {categories.map((cat, catIdx) => {
                    const v = cat.values[cohort];
                    if (v == null || v <= 0) return null;
                    const segH = innerH - sy(v);
                    const y = stackTop - segH;
                    stackTop = y;
                    const isHover =
                      hover?.cohort === cohort && hover?.catIdx === catIdx;
                    return (
                      <rect
                        key={cat.key}
                        x={0}
                        y={y}
                        width={bw}
                        height={Math.max(segH, 0.5)}
                        fill={cat.color}
                        opacity={isHover ? 1 : 0.92}
                        stroke={isHover ? 'rgba(255,255,255,0.6)' : 'none'}
                        strokeWidth={isHover ? 1 : 0}
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={() => setHover({ cohort, catIdx })}
                      />
                    );
                  })}
                </g>
              );
            })}

            {/* X-axis labels */}
            {CES_AGE_COHORT_ORDER.map((cohort) => {
              const bandX = sx(cohort);
              if (bandX == null) return null;
              return (
                <text
                  key={cohort}
                  x={bandX + sx.bandwidth() / 2}
                  y={innerH + 16}
                  fontSize="9"
                  textAnchor="middle"
                  fill="var(--text-dim)"
                >
                  {CES_AGE_LABELS[cohort]}
                </text>
              );
            })}
          </g>
        </svg>

        {/* Tooltip */}
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
            }}
          >
            <div
              className="text-[10px] mb-0.5 pb-0.5"
              style={{
                color: 'var(--text-dim)',
                borderBottom: '1px solid var(--panel-border)',
              }}
            >
              {focused.cohortLabel} · cohort total ${fmtInt(focused.total)}
            </div>
            <div className="flex items-center gap-2 justify-between">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block rounded-full"
                  style={{
                    width: 6,
                    height: 6,
                    background: focused.cat.color,
                  }}
                />
                {focused.cat.label}
              </span>
              <span className="tnum" style={{ color: 'var(--text-h)' }}>
                ${fmtInt(focused.value)}{' '}
                <span style={{ color: 'var(--text-dim)' }}>
                  ({focused.share.toFixed(1)}%)
                </span>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
