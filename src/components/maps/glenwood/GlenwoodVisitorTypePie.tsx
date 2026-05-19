// GlenwoodVisitorTypePie — donut chart with one slice per `VisitorPieSlice`.
// Layout: title (rendered by the card wrapper) → legend chips → donut fills
// the remaining card space. Values and percentages live in a glass-styled
// hover tooltip rather than the legend.
//
// When `onSelectKey` is provided, both slices AND legend chips act as a
// cross-filter — clicking calls back with the slice key; the consumer
// handles the resulting selection state (toggle, multi-select, etc.).

import { useRef, useState } from 'react';
import { fmtCount } from './glenwoodMetrics';

export interface VisitorPieSlice {
  // Unique identifier — used as the React key and as the selection key
  // passed to onSelectKey / matched against selectedKeys.
  key: string;
  label: string;
  color: string;
  value: number;
  share: number;
}

interface Props {
  slices: VisitorPieSlice[];
  // Slice keys currently emphasized. When null/empty, no slice is dimmed.
  // When non-empty AND smaller than slices.length, non-matching slices are
  // dimmed and matching slices get an accent outline. When size equals
  // slices.length (whole dimension is the active state), the pie renders
  // the same as the default — the content swap itself is the signal.
  selectedKeys?: ReadonlySet<string> | null;
  onSelectKey?: (key: string) => void;
}

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

export function GlenwoodVisitorTypePie({
  slices,
  selectedKeys = null,
  onSelectKey,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number } | null>(null);

  const total = slices.reduce((acc, s) => acc + s.value, 0);
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
  const interactive = onSelectKey != null;
  const activeSelection =
    selectedKeys != null &&
    selectedKeys.size > 0 &&
    selectedKeys.size < slices.length;

  const handleClick = (key: string) => {
    if (!interactive) return;
    onSelectKey!(key);
  };

  // Use a 100x100 viewBox so the donut scales to whatever box the
  // container hands it. preserveAspectRatio + aspect-ratio:1 keep the
  // circle round when the container is wider than it is tall.
  const VB = 100;
  const CX = VB / 2;
  const CY = VB / 2;
  const R_OUTER = VB / 2 - 2;
  const R_INNER = R_OUTER * 0.6;

  let cursor = 0;
  const wedges = slices.map((s) => {
    const start = cursor;
    const end = cursor + s.share * Math.PI * 2;
    cursor = end;
    return {
      key: s.key,
      label: s.label,
      color: s.color,
      value: s.value,
      share: s.share,
      start,
      end,
    };
  });

  const hovered = hoverKey ? slices.find((s) => s.key === hoverKey) ?? null : null;

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    if (rect.width !== containerSize?.w || rect.height !== containerSize?.h) {
      setContainerSize({ w: rect.width, h: rect.height });
    }
  };

  const handleMouseLeave = () => {
    setHoverKey(null);
    setMousePos(null);
  };

  // Tooltip flips to the left/above the cursor when it would overflow the
  // container edges. Matches the Mini trend chart's behavior so the two
  // hover affordances feel consistent.
  const TOOLTIP_W = 150;
  const tooltipLeft = mousePos && containerSize
    ? mousePos.x + TOOLTIP_W + 12 > containerSize.w
      ? Math.max(0, mousePos.x - TOOLTIP_W - 8)
      : mousePos.x + 8
    : 0;
  const tooltipTop = mousePos
    ? Math.max(0, mousePos.y - 28)
    : 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      <ul
        className="flex flex-wrap items-center gap-x-3 gap-y-1"
        aria-label="Visitor tier legend"
      >
        {slices.map((s) => {
          const isSelected = activeSelection && selectedKeys!.has(s.key);
          const isDimmed = activeSelection && !isSelected;
          const ChipTag = (interactive ? 'button' : 'div') as 'button' | 'div';
          return (
            <li key={s.key}>
              <ChipTag
                type={interactive ? 'button' : undefined}
                onClick={interactive ? () => handleClick(s.key) : undefined}
                aria-pressed={interactive ? isSelected : undefined}
                onMouseEnter={() => setHoverKey(s.key)}
                onMouseLeave={() => setHoverKey(null)}
                className={
                  'flex items-center gap-1.5 rounded transition-colors' +
                  (interactive ? ' cursor-pointer hover:bg-white/[0.04] px-1' : '')
                }
                style={{
                  opacity: isDimmed ? 0.45 : 1,
                  background: isSelected ? 'rgba(255,255,255,0.06)' : 'transparent',
                  outline: isSelected ? '1px solid var(--accent)' : 'none',
                  outlineOffset: -1,
                  border: 'none',
                  textAlign: 'left',
                }}
              >
                <span
                  className="w-2 h-2 rounded-sm shrink-0"
                  style={{ background: s.color }}
                />
                <span
                  className="text-[11px]"
                  style={{ color: 'var(--text-h)' }}
                >
                  {s.label}
                </span>
              </ChipTag>
            </li>
          );
        })}
      </ul>

      <div
        ref={containerRef}
        className="flex-1 min-h-0 relative flex items-center justify-center"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <svg
          viewBox={`0 0 ${VB} ${VB}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ maxWidth: '100%', maxHeight: '100%', aspectRatio: '1' }}
          aria-label="Visitor tier distribution"
        >
          {wedges.map((w) => {
            const isSelected = activeSelection && selectedKeys!.has(w.key);
            const isDimmed = activeSelection && !isSelected;
            const isHover = hoverKey === w.key;
            return (
              <path
                key={w.key}
                d={arcPath(CX, CY, R_OUTER, R_INNER, w.start, w.end)}
                fill={w.color}
                stroke={isSelected ? 'var(--accent)' : 'rgba(0,0,0,0.4)'}
                strokeWidth={isSelected ? 1.5 : 0.5}
                opacity={isDimmed ? 0.4 : isHover ? 0.92 : 1}
                style={{ cursor: interactive ? 'pointer' : 'default', transition: 'opacity 120ms' }}
                onClick={interactive ? () => handleClick(w.key) : undefined}
                onMouseEnter={() => setHoverKey(w.key)}
                aria-pressed={interactive ? isSelected : undefined}
              />
            );
          })}
        </svg>

        {hovered && mousePos && (
          <div
            className="glass absolute rounded-md px-2 py-1.5 text-[10px] pointer-events-none z-10"
            style={{
              left: tooltipLeft,
              top: tooltipTop,
              width: TOOLTIP_W,
            }}
          >
            <div className="flex items-center gap-1.5 leading-tight">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: hovered.color }}
              />
              <span className="truncate" style={{ color: '#ffffff' }}>
                {hovered.label}
              </span>
            </div>
            <div
              className="tnum mt-0.5"
              style={{ color: '#ffffff' }}
            >
              {fmtCount(hovered.value)}
              <span style={{ opacity: 0.7 }}> · {(hovered.share * 100).toFixed(1)}%</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
