// Donut chart for the Activity map's Visitors metric — shows either a
// Regional vs Tourist split (`mode === 'type'`) or a 4-band distance
// breakdown (`mode === 'distance'`) of the full unfiltered visitor
// universe. d3-shape's pie + arc generators handle the geometry;
// everything else is bare SVG.
//
// Layout: the chart fills its parent card via flex — the donut renders
// as a square that takes up the card's full available height (sized
// against the row's flex height), and the legend gets the remaining
// horizontal space with comfortable typography.

import { useMemo } from 'react';
import { arc as d3Arc, pie as d3Pie } from 'd3-shape';
import { RAMPS } from '../lib/subjectColorRamps';
import { fmtInt, fmtPct } from '../lib/format';

export type VisitorTypeMode = 'type' | 'distance';

// Slice keys double as the filter values consumed by filterByVisitorType
// in lib/flowQueries — clicking a slice forwards its key to the caller
// via onSliceClick, and the chart highlights whichever key matches
// activeKey so the active filter reads on the donut. Keep these in
// lockstep with the VisitorType union.
export type VisitorPieSliceKey =
  | 'regional'
  | 'tourist'
  | 'under-50'
  | '50-100'
  | '100-250'
  | 'over-250';

export interface VisitorDistanceBands {
  // <50 mi, 50–100, 100–250, >250 — values are caller-aggregated sums
  // in the active sub-metric's native units (visitors / visits / avg.
  // daily visits).
  under50: number;
  band50to100: number;
  band100to250: number;
  over250: number;
}

interface Props {
  regionalValue: number;   // sum of visit value within 50 mi of GWS
  touristValue: number;    // sum beyond 50 mi
  // Optional total override — when caller wants the chart's denominator
  // pinned to a baseline (e.g., the visitor metric's unfiltered total)
  // instead of regionalValue + touristValue. Defaults to the sum.
  total?: number;
  // Unit word for the tooltip line ("visitors" / "visits"). Default "visits".
  unit?: string;
  // Active breakdown view. Defaults to 'type' (the legacy 2-slice donut).
  mode?: VisitorTypeMode;
  // 4-band breakdown sums; required when mode === 'distance'.
  distanceBands?: VisitorDistanceBands;
  // Optional click-to-filter wiring. When supplied, every slice + legend
  // row becomes a button that calls onSliceClick with the slice's key —
  // clicking the currently-active slice clears the filter (the caller
  // is responsible for resetting to 'all'). activeKey highlights the
  // matching slice and dims the rest.
  activeKey?: VisitorPieSliceKey | null;
  onSliceClick?: (key: VisitorPieSliceKey) => void;
}

interface Slice {
  key: VisitorPieSliceKey;
  label: string;
  value: number;
  color: string;
}

// SVG viewBox uses a fixed coordinate system (`-VB_R`..`VB_R`) so the
// arc geometry is computed once at any scale. The rendered pixel size
// then comes from CSS (the parent flex container), not from these
// constants — making the donut grow with the card.
const VB_R = 54;
const VB_INNER = VB_R * 0.55;

export function VisitorTypePieChart({
  regionalValue,
  touristValue,
  total,
  unit = 'visits',
  mode = 'type',
  distanceBands,
  activeKey,
  onSliceClick,
}: Props) {
  const accent = RAMPS.activity.accent;
  // Tourist gets a muted variant of the accent so the two slices read as
  // related categories rather than competing colors. The 4-band Distance
  // view uses a step-ramp from full-strength to ~15% alpha so the bands
  // visibly grade with distance.
  const touristColor = `${accent}66`; // ~40% alpha

  const slices: Slice[] = useMemo(() => {
    if (mode === 'distance' && distanceBands) {
      return [
        {
          key: 'under-50' as VisitorPieSliceKey,
          label: '< 50 mi',
          value: Math.max(distanceBands.under50, 0),
          color: accent,
        },
        {
          key: '50-100' as VisitorPieSliceKey,
          label: '50–100 mi',
          value: Math.max(distanceBands.band50to100, 0),
          color: `${accent}b3`, // ~70% alpha
        },
        {
          key: '100-250' as VisitorPieSliceKey,
          label: '100–250 mi',
          value: Math.max(distanceBands.band100to250, 0),
          color: `${accent}80`, // ~50% alpha
        },
        {
          key: 'over-250' as VisitorPieSliceKey,
          label: '> 250 mi',
          value: Math.max(distanceBands.over250, 0),
          color: `${accent}40`, // ~25% alpha
        },
      ];
    }
    return [
      {
        key: 'regional' as VisitorPieSliceKey,
        label: 'Regional (≤50 mi)',
        value: Math.max(regionalValue, 0),
        color: accent,
      },
      {
        key: 'tourist' as VisitorPieSliceKey,
        label: 'Tourist (>50 mi)',
        value: Math.max(touristValue, 0),
        color: touristColor,
      },
    ];
  }, [mode, distanceBands, regionalValue, touristValue, accent, touristColor]);

  const denom = total ?? slices.reduce((s, v) => s + v.value, 0);

  const arcGen = useMemo(
    () => d3Arc<{ startAngle: number; endAngle: number }>()
      .innerRadius(VB_INNER)
      .outerRadius(VB_R)
      .padAngle(0.012)
      .cornerRadius(2),
    [],
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

  const ariaLabel = mode === 'distance'
    ? `Visitor distance breakdown: ${slices.map((s) => `${fmtPct(s.value / Math.max(denom, 1))} ${s.label}`).join(', ')}`
    : `Visitor type breakdown: ${fmtPct(slices[0].value / Math.max(denom, 1))} regional, ${fmtPct(slices[1].value / Math.max(denom, 1))} tourist`;
  // When click-to-filter is wired AND a slice is active, dim everything
  // that isn't the active slice so the donut visually reflects the
  // applied filter. No active slice → full opacity for every slice.
  const hasActive = onSliceClick != null && activeKey != null;
  const handleSliceClick = (key: VisitorPieSliceKey) => {
    if (!onSliceClick) return;
    onSliceClick(key);
  };

  return (
    <div className="flex-1 flex items-center gap-4 min-h-0 min-w-0">
      {/* Donut — square aspect, sized to fill the card's height up to
          a 200px ceiling so the legend keeps comfortable room when the
          card stretches very wide. The aspect-square + h-full pair
          locks width = height so the SVG stays circular. */}
      <div
        className="aspect-square h-full shrink-0"
        style={{ maxHeight: 200, maxWidth: 200 }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={`${-VB_R} ${-VB_R} ${VB_R * 2} ${VB_R * 2}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={ariaLabel}
        >
          {arcs.map((a) => {
            const slice = a.data;
            const d = arcGen({
              startAngle: a.startAngle,
              endAngle: a.endAngle,
            });
            if (!d) return null;
            const isActive = activeKey === slice.key;
            const dim = hasActive && !isActive;
            return (
              <path
                key={slice.key}
                d={d}
                fill={slice.color}
                stroke={isActive ? 'var(--text-h)' : 'rgba(0,0,0,0.25)'}
                strokeWidth={isActive ? 1.25 : 0.5}
                opacity={dim ? 0.35 : 1}
                style={{
                  cursor: onSliceClick ? 'pointer' : 'default',
                  transition: 'opacity 120ms ease, stroke-width 120ms ease',
                }}
                onClick={onSliceClick ? () => handleSliceClick(slice.key) : undefined}
                role={onSliceClick ? 'button' : undefined}
                tabIndex={onSliceClick ? 0 : undefined}
                aria-label={onSliceClick
                  ? `${isActive ? 'Clear filter for' : 'Filter to'} ${slice.label}`
                  : undefined}
                onKeyDown={onSliceClick
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSliceClick(slice.key);
                      }
                    }
                  : undefined}
              >
                {onSliceClick && (
                  <title>{isActive
                    ? `Showing ${slice.label} only — click to clear`
                    : `Click to filter to ${slice.label}`}</title>
                )}
              </path>
            );
          })}
          {/* Center label — total visits across both slices. */}
          <text
            x={0}
            y={-1}
            textAnchor="middle"
            style={{
              fill: 'var(--text-h)',
              fontSize: 9,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {fmtInt(denom)}
          </text>
          <text
            x={0}
            y={7}
            textAnchor="middle"
            style={{
              fill: 'var(--text-dim)',
              fontSize: 5,
              textTransform: 'uppercase',
              letterSpacing: 0.6,
            }}
          >
            {unit}
          </text>
        </svg>
      </div>
      {/* Legend — gets the rest of the row. Tighter spacing in 'distance'
          mode so 4 rows fit at the same chart height the 2-row 'type'
          mode uses. */}
      <div
        className={`flex flex-col min-w-0 flex-1 ${mode === 'distance' ? 'gap-1.5' : 'gap-2.5'}`}
      >
        {slices.map((s) => {
          const pct = denom > 0 ? s.value / denom : 0;
          const isActive = activeKey === s.key;
          const dim = hasActive && !isActive;
          const rowClass = onSliceClick
            ? `flex items-center gap-2 rounded px-1 py-0.5 -mx-1 transition-colors text-left ${
                isActive ? '' : 'hover:bg-white/[0.04]'
              }`
            : 'flex items-center gap-2';
          const rowStyle: React.CSSProperties = {
            opacity: dim ? 0.5 : 1,
            background: isActive ? 'rgba(255,255,255,0.06)' : 'transparent',
            transition: 'opacity 120ms ease, background 120ms ease',
          };
          const content = (
            <>
              <span
                aria-hidden="true"
                className="shrink-0"
                style={{
                  display: 'inline-block',
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: s.color,
                  outline: isActive ? '1.5px solid var(--text-h)' : 'none',
                  outlineOffset: 1,
                }}
              />
              <div className="flex-1 min-w-0">
                <div
                  className="text-[11px] font-semibold"
                  style={{ color: 'var(--text-h)' }}
                >
                  {s.label}
                </div>
                <div
                  className="text-[10px] tabular-nums"
                  style={{ color: 'var(--text-dim)' }}
                >
                  {fmtInt(s.value)} {unit} · {fmtPct(pct)}
                </div>
              </div>
            </>
          );
          return onSliceClick ? (
            <button
              key={s.key}
              type="button"
              onClick={() => handleSliceClick(s.key)}
              className={rowClass}
              style={rowStyle}
              aria-pressed={isActive}
              title={isActive
                ? `Showing ${s.label} only — click to clear`
                : `Click to filter to ${s.label}`}
            >
              {content}
            </button>
          ) : (
            <div key={s.key} className={rowClass} style={rowStyle}>
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
