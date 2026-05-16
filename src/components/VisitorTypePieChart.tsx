// Donut chart for the Activity map's Visitors metric — shows the
// Regional vs Tourist split of the full unfiltered visitor universe so
// the user can see the proportional mix regardless of which visitor-type
// chip is currently selected. d3-shape's pie + arc generators handle the
// geometry; everything else is bare SVG.

import { useMemo } from 'react';
import { arc as d3Arc, pie as d3Pie } from 'd3-shape';
import { RAMPS } from '../lib/subjectColorRamps';
import { fmtInt, fmtPct } from '../lib/format';

interface Props {
  regionalValue: number;   // sum of visit value within 50 mi of GWS
  touristValue: number;    // sum beyond 50 mi
  // Optional total override — when caller wants the chart's denominator
  // pinned to a baseline (e.g., the visitor metric's unfiltered total)
  // instead of regionalValue + touristValue. Defaults to the sum.
  total?: number;
  // Unit word for the tooltip line ("visitors" / "visits"). Default "visits".
  unit?: string;
  // Optional size override (px). Default 120 (compact for left-panel use).
  size?: number;
}

interface Slice {
  key: 'regional' | 'tourist';
  label: string;
  value: number;
  color: string;
}

export function VisitorTypePieChart({
  regionalValue,
  touristValue,
  total,
  unit = 'visits',
  size = 120,
}: Props) {
  const accent = RAMPS.activity.accent;
  // Tourist gets a muted variant of the accent so the two slices read as
  // related categories rather than competing colors.
  const touristColor = `${accent}66`; // ~40% alpha

  const slices: Slice[] = useMemo(
    () => [
      {
        key: 'regional',
        label: 'Regional (≤50 mi)',
        value: Math.max(regionalValue, 0),
        color: accent,
      },
      {
        key: 'tourist',
        label: 'Tourist (>50 mi)',
        value: Math.max(touristValue, 0),
        color: touristColor,
      },
    ],
    [regionalValue, touristValue, accent, touristColor],
  );

  const denom = total ?? slices.reduce((s, v) => s + v.value, 0);
  const radius = size / 2;
  const innerRadius = radius * 0.55;

  const arcGen = useMemo(
    () => d3Arc<{ startAngle: number; endAngle: number }>()
      .innerRadius(innerRadius)
      .outerRadius(radius)
      .padAngle(0.012)
      .cornerRadius(2),
    [innerRadius, radius],
  );

  const pieGen = useMemo(
    () => d3Pie<Slice>().value((d) => d.value).sort(null),
    [],
  );

  const arcs = useMemo(() => {
    const slicesWithValue = slices.filter((s) => s.value > 0);
    if (slicesWithValue.length === 0) return [];
    return pieGen(slicesWithValue);
  }, [pieGen, slices]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <svg
          width={size}
          height={size}
          viewBox={`${-radius} ${-radius} ${size} ${size}`}
          role="img"
          aria-label={`Visitor type breakdown: ${fmtPct(slices[0].value / Math.max(denom, 1))} regional, ${fmtPct(slices[1].value / Math.max(denom, 1))} tourist`}
        >
          {arcs.map((a) => {
            const slice = a.data;
            const d = arcGen({
              startAngle: a.startAngle,
              endAngle: a.endAngle,
            });
            if (!d) return null;
            return (
              <path
                key={slice.key}
                d={d}
                fill={slice.color}
                stroke="rgba(0,0,0,0.25)"
                strokeWidth={0.5}
              />
            );
          })}
          {/* Center label — total visits across both slices. */}
          <text
            x={0}
            y={-3}
            textAnchor="middle"
            style={{
              fill: 'var(--text-h)',
              fontSize: 13,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {fmtInt(denom)}
          </text>
          <text
            x={0}
            y={11}
            textAnchor="middle"
            style={{
              fill: 'var(--text-dim)',
              fontSize: 8,
              textTransform: 'uppercase',
              letterSpacing: 0.6,
            }}
          >
            {unit}
          </text>
        </svg>
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          {slices.map((s) => {
            const pct = denom > 0 ? s.value / denom : 0;
            return (
              <div key={s.key} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="shrink-0"
                  style={{
                    display: 'inline-block',
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: s.color,
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div
                    className="text-[10px] font-medium"
                    style={{ color: 'var(--text-h)' }}
                  >
                    {s.label}
                  </div>
                  <div
                    className="text-[9px] tabular-nums"
                    style={{ color: 'var(--text-dim)' }}
                  >
                    {fmtInt(s.value)} {unit} · {fmtPct(pct)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
