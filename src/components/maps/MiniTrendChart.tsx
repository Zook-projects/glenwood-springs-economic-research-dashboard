// MiniTrendChart — SVG line chart for subject map bottom strips. Supports a
// single series (`data`) OR multiple series (`series`) with a legend chip
// row above the chart. Width AND height are responsive — pass `height='fill'`
// to make the chart grow into its parent container (parent must have a
// determined height). Includes Y-axis ticks + gridlines + hover crosshair.

import { useEffect, useMemo, useRef, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { line as d3line, area as d3area, curveMonotoneX } from 'd3-shape';
import type { TrendPoint } from '../../types/context';

export interface TrendSeries {
  key: string;
  label: string;
  color: string;
  points: TrendPoint[];
}

interface Props {
  // Single-series mode. Supply `data` + optional `color`. Ignored when
  // `series` is provided.
  data?: TrendPoint[];
  series?: TrendSeries[];
  // Pixels (number) or 'fill' to grow with the parent container's height.
  height?: number | 'fill';
  color?: string;
  // Y-axis lower bound. 'auto' = use min of data; 'zero' = start at 0
  // (default, makes the area fill read sensibly for population, sales).
  yMin?: 'auto' | 'zero';
  // Number formatter for hover tooltip + axis labels. Default: locale-string.
  valueFormat?: (v: number) => string;
  // When set, the matching series renders at full emphasis and the rest
  // dim out so the user can read a single line in context. Falsy = all
  // series at normal weight.
  highlightedKey?: string | null;
  // Row label used in the floating tooltip when in single-series mode.
  // Multi-series uses each series.label and ignores this prop.
  name?: string;
}

// Module-level identity formatter so the rendering code can compare against
// the default. Lets the y-axis-tick branch decide whether to apply the
// abbreviator (default) or the caller's custom formatter (percentages, $K).
const defaultValueFormat = (v: number) => v.toLocaleString();

export function MiniTrendChart({
  data,
  series,
  height = 110,
  color = 'var(--accent)',
  yMin = 'zero',
  valueFormat = defaultValueFormat,
  highlightedKey = null,
  name = 'Value',
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 280, h: typeof height === 'number' ? height : 200 });
  const [hoverX, setHoverX] = useState<number | null>(null);

  // Track container size — width always; height only when 'fill'.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = Math.max(120, el.clientWidth);
      const h = height === 'fill' ? Math.max(80, el.clientHeight) : (height as number);
      setSize({ w, h });
    });
    ro.observe(el);
    const w = Math.max(120, el.clientWidth);
    const h = height === 'fill' ? Math.max(80, el.clientHeight) : (height as number);
    setSize({ w, h });
    return () => ro.disconnect();
  }, [height]);

  // Normalize to series-array form. Single-series callers get a
  // synthetic single-element array.
  const effectiveSeries: TrendSeries[] = useMemo(() => {
    if (series && series.length) return series;
    if (data) {
      return [{ key: 'main', label: name, color, points: data }];
    }
    return [];
  }, [series, data, color, name]);

  // Filter each series down to non-null points; drop series that have <2 valid points.
  const renderableSeries = useMemo(() => {
    return effectiveSeries
      .map((s) => ({
        ...s,
        points: s.points
          .filter((p): p is { year: number; value: number } => p.value != null)
          .sort((a, b) => a.year - b.year),
      }))
      .filter((s) => s.points.length >= 2);
  }, [effectiveSeries]);

  // Derive x/y extents across all series.
  const { xMin, xMax, yMaxVal, yMinVal } = useMemo(() => {
    if (renderableSeries.length === 0) {
      return { xMin: 0, xMax: 1, yMaxVal: 1, yMinVal: 0 };
    }
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMax = -Infinity;
    let yMinAll = Infinity;
    for (const s of renderableSeries) {
      for (const p of s.points) {
        if (p.year < xMin) xMin = p.year;
        if (p.year > xMax) xMax = p.year;
        if (p.value > yMax) yMax = p.value;
        if (p.value < yMinAll) yMinAll = p.value;
      }
    }
    return {
      xMin,
      xMax,
      yMaxVal: yMax,
      yMinVal: yMin === 'zero' ? 0 : yMinAll,
    };
  }, [renderableSeries, yMin]);

  const showLegend = !!series && series.length > 0;
  const legendH = showLegend ? 22 : 0;

  if (renderableSeries.length === 0) {
    return (
      <div ref={containerRef} className="w-full h-full flex items-center justify-center" style={{ minHeight: 80 }}>
        <div
          className="text-[10px] uppercase tracking-wider"
          style={{ color: 'var(--text-dim)' }}
        >
          Insufficient trend data
        </div>
      </div>
    );
  }

  // Layout — leave room for axis ticks on left + bottom + legend on top.
  const padTop = 8 + legendH;
  const padRight = 12;
  const padBottom = 18;
  const padLeft = 44;
  const innerW = Math.max(1, size.w - padLeft - padRight);
  const innerH = Math.max(1, size.h - padTop - padBottom);

  const yPad = (yMaxVal - yMinVal) * 0.08 || 1;

  const xScale = scaleLinear().domain([xMin, xMax]).range([padLeft, padLeft + innerW]);
  const yScale = scaleLinear()
    .domain([yMinVal, yMaxVal + yPad])
    .range([padTop + innerH, padTop]);

  const yTicks = yScale.ticks(4);
  const xTickCount = Math.min(4, Math.max(2, Math.floor(innerW / 80)));
  const xTickValues = xScale.ticks(xTickCount);

  // Build line + (single-series only) area paths.
  const isSingle = renderableSeries.length === 1;
  const lineGen = d3line<{ year: number; value: number }>()
    .x((d) => xScale(d.year))
    .y((d) => yScale(d.value))
    .curve(curveMonotoneX);
  const areaGen = d3area<{ year: number; value: number }>()
    .x((d) => xScale(d.year))
    .y0(padTop + innerH)
    .y1((d) => yScale(d.value))
    .curve(curveMonotoneX);

  // Hover: pick the nearest x across all series.
  const hover = (() => {
    if (hoverX == null) return null;
    let bestYear = xMin;
    let bestDist = Infinity;
    const allYears = new Set<number>();
    for (const s of renderableSeries) for (const p of s.points) allYears.add(p.year);
    for (const y of allYears) {
      const px = xScale(y);
      const d = Math.abs(px - hoverX);
      if (d < bestDist) {
        bestDist = d;
        bestYear = y;
      }
    }
    return { year: bestYear };
  })();

  // Pre-compute per-series lookups at the hovered year — used both by the
  // SVG crosshair dots and the floating HTML tooltip.
  type HoverLookup = {
    series: (typeof renderableSeries)[number];
    point: { year: number; value: number };
  };
  const hoverLookups: HoverLookup[] = [];
  if (hover) {
    for (const s of renderableSeries) {
      const pt = s.points.find((p) => p.year === hover.year);
      if (pt) hoverLookups.push({ series: s, point: pt });
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={{ height: height === 'fill' ? '100%' : height, minHeight: 80 }}
    >
      <svg
        width={size.w}
        height={size.h}
        style={{ display: 'block' }}
        onMouseLeave={() => setHoverX(null)}
        onMouseMove={(e) => {
          const rect = (e.target as SVGElement).closest('svg')!.getBoundingClientRect();
          setHoverX(e.clientX - rect.left);
        }}
      >
        {/* Legend chips (multi-series) — single row, evenly spaced across
            the chart width. Labels truncate aggressively when series count
            grows so chips never overflow the card edge. */}
        {showLegend && (() => {
          const legendW = Math.max(60, size.w - padLeft - padRight);
          const chipW = legendW / Math.max(1, renderableSeries.length);
          const maxLabel = Math.max(4, Math.floor((chipW - 18) / 6));
          return (
            <g>
              {renderableSeries.map((s, i) => {
                const cx = padLeft + i * chipW;
                const label =
                  s.label.length > maxLabel
                    ? s.label.slice(0, Math.max(1, maxLabel - 1)) + '…'
                    : s.label;
                return (
                  <g key={s.key} transform={`translate(${cx}, 4)`}>
                    <rect width={10} height={10} fill={s.color} rx={2} />
                    <text
                      x={14}
                      y={9}
                      fontSize={10}
                      fill="var(--text-h)"
                      style={{ paintOrder: 'stroke', stroke: '#000', strokeWidth: 2 }}
                    >
                      {label}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })()}

        {/* Y gridlines + tick labels */}
        {yTicks.map((t) => {
          const y = yScale(t);
          return (
            <g key={'y' + t}>
              <line
                x1={padLeft}
                x2={padLeft + innerW}
                y1={y}
                y2={y}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth={1}
              />
              <text
                x={padLeft - 6}
                y={y + 3}
                fontSize={9}
                fill="var(--text-dim)"
                textAnchor="end"
              >
                {/*
                  Use the caller's `valueFormat` when supplied (percentage /
                  currency formatters need to apply to y-axis ticks, not just
                  tooltips). Fall back to the abbreviator for the default
                  identity formatter so existing large-number axes still
                  read as 50k / 1.2M.
                */}
                {valueFormat === defaultValueFormat
                  ? abbreviateNumber(t)
                  : valueFormat(t)}
              </text>
            </g>
          );
        })}

        {/* X tick labels */}
        {xTickValues.map((t) => (
          <text
            key={'x' + t}
            x={xScale(t)}
            y={size.h - 4}
            fontSize={9}
            fill="var(--text-dim)"
            textAnchor="middle"
          >
            {Math.round(t)}
          </text>
        ))}

        {/* Axis baseline (y=yMinVal) */}
        <line
          x1={padLeft}
          x2={padLeft + innerW}
          y1={yScale(yMinVal)}
          y2={yScale(yMinVal)}
          stroke="rgba(255,255,255,0.18)"
          strokeWidth={1}
        />

        {/* Series — area + line. Area only renders for single-series mode
            so multi-series stacked-fills don't muddy the chart. When
            `highlightedKey` is set, the matching series renders bolder and
            non-matching series dim out so the user can read a single line
            in context. */}
        {renderableSeries.map((s) => {
          const isHighlighted = highlightedKey != null && s.key === highlightedKey;
          const isDimmed = highlightedKey != null && s.key !== highlightedKey;
          const strokeOpacity = isDimmed ? 0.22 : 1;
          const strokeWidth = isHighlighted
            ? 2.5
            : isSingle
              ? 1.75
              : 1.5;
          return (
            <g key={s.key}>
              {isSingle && (
                <path d={areaGen(s.points)!} fill={s.color} fillOpacity={0.18} />
              )}
              <path
                d={lineGen(s.points)!}
                fill="none"
                stroke={s.color}
                strokeWidth={strokeWidth}
                strokeOpacity={strokeOpacity}
              />
              {!isDimmed && s.points.map((p) => (
                <circle
                  key={`${s.key}-${p.year}`}
                  cx={xScale(p.year)}
                  cy={yScale(p.value)}
                  r={isHighlighted ? 2.5 : 2}
                  fill={s.color}
                  fillOpacity={0.85}
                />
              ))}
            </g>
          );
        })}

        {/* Hover crosshair + per-series dots. Tooltip text rendered as a
            floating HTML element outside the SVG (below) so it can use the
            shared .glass treatment and stay legible at any chart size. */}
        {hover && hoverLookups.length > 0 && (
          <g>
            <line
              x1={xScale(hover.year)}
              x2={xScale(hover.year)}
              y1={padTop}
              y2={padTop + innerH}
              stroke="rgba(255,255,255,0.5)"
              strokeDasharray="2 2"
            />
            {hoverLookups.map(({ series: s, point: p }) => (
              <circle
                key={`hover-${s.key}`}
                cx={xScale(hover.year)}
                cy={yScale(p.value)}
                r={3.5}
                fill={s.color}
                stroke="#000"
                strokeWidth={1}
              />
            ))}
          </g>
        )}
      </svg>

      {/* Floating tooltip — year header + one row per series with color
          swatch, label, and formatted value. Flips to the left of the
          cursor when it would overflow the right edge of the chart. */}
      {hover && hoverLookups.length > 0 && hoverX != null && (() => {
        const TOOLTIP_W = 150;
        const flip = hoverX + TOOLTIP_W + 8 > size.w;
        const left = flip
          ? Math.max(0, hoverX - TOOLTIP_W - 8)
          : Math.min(hoverX + 8, Math.max(0, size.w - TOOLTIP_W));
        return (
          <div
            className="glass absolute rounded-md px-2 py-1.5 text-[10px] pointer-events-none z-10"
            style={{
              left,
              top: padTop + 4,
              width: TOOLTIP_W,
            }}
          >
            <div
              className="font-semibold tnum mb-1"
              style={{ color: '#ffffff' }}
            >
              {Math.round(hover.year)}
            </div>
            {hoverLookups.map(({ series: s, point: p }) => (
              <div
                key={s.key}
                className="flex items-center gap-1.5 leading-tight"
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: s.color }}
                />
                <span
                  className="truncate"
                  style={{ color: '#ffffff' }}
                >
                  {s.label || name}
                </span>
                <span
                  className="ml-auto tnum"
                  style={{ color: '#ffffff' }}
                >
                  {valueFormat(p.value)}
                </span>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

// Abbreviate large numbers for tick labels: 50000 → "50k", 1234567 → "1.2M".
function abbreviateNumber(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  if (abs >= 1) return `${Math.round(v)}`;
  return v.toFixed(2);
}
