// GlenwoodVisitorTypePie — donut chart with three slices: Local / Regional
// / Tourist. Plus a legend with counts and percentages.

import { fmtCount } from './glenwoodMetrics';
import type { VisitorTierSlice } from './glenwoodMetrics';

interface Props {
  slices: VisitorTierSlice[];
}

const TIER_COLOR: Record<string, string> = {
  Local: '#86b3ee',
  Regional: '#FFB454',
  Tourist: '#6dd182',
};

function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startAngle: number,
  endAngle: number,
): string {
  // Angles in radians, 0 = top (12 o'clock), positive = clockwise.
  const polar = (r: number, a: number) => ({
    x: cx + r * Math.sin(a),
    y: cy - r * Math.cos(a),
  });
  const p0 = polar(rOuter, startAngle);
  const p1 = polar(rOuter, endAngle);
  const p2 = polar(rInner, endAngle);
  const p3 = polar(rInner, startAngle);
  const sweep = endAngle - startAngle;
  const largeArc = sweep > Math.PI ? 1 : 0;
  return [
    `M ${p0.x} ${p0.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${p1.x} ${p1.y}`,
    `L ${p2.x} ${p2.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${p3.x} ${p3.y}`,
    'Z',
  ].join(' ');
}

export function GlenwoodVisitorTypePie({ slices }: Props) {
  const total = slices.reduce((acc, s) => acc + s.visits, 0);
  if (total === 0) {
    return (
      <div
        className="flex-1 min-h-0 flex items-center justify-center text-[10px]"
        style={{ color: 'var(--text-dim)' }}
      >
        Not enough origin data to classify.
      </div>
    );
  }
  // Layout: donut on the left, legend rows on the right.
  const SIZE = 120;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const R_OUTER = SIZE / 2 - 4;
  const R_INNER = R_OUTER * 0.6;

  let cursor = 0;
  const wedges = slices.map((s) => {
    const start = cursor;
    const end = cursor + s.share * Math.PI * 2;
    cursor = end;
    return { tier: s.tier, start, end, share: s.share, visits: s.visits };
  });

  return (
    <div className="flex-1 min-h-0 flex items-center gap-3">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ width: SIZE, height: SIZE, flexShrink: 0 }}
        aria-label="Visitor tier distribution"
      >
        {wedges.map((w) => (
          <path
            key={w.tier}
            d={arcPath(CX, CY, R_OUTER, R_INNER, w.start, w.end)}
            fill={TIER_COLOR[w.tier]}
            stroke="rgba(0,0,0,0.4)"
            strokeWidth={0.5}
          >
            <title>{`${w.tier}: ${fmtCount(w.visits)} (${(w.share * 100).toFixed(1)}%)`}</title>
          </path>
        ))}
      </svg>
      <ul className="flex flex-col gap-1.5 flex-1 min-w-0">
        {slices.map((s) => (
          <li key={s.tier} className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ background: TIER_COLOR[s.tier] }}
            />
            <span
              className="text-[11px] flex-1"
              style={{ color: 'var(--text-h)' }}
            >
              {s.tier}
            </span>
            <span
              className="text-[10px] tabular-nums"
              style={{ color: 'var(--text-dim)' }}
            >
              {fmtCount(s.visits)} · {(s.share * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
