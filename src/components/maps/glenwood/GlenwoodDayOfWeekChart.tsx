// GlenwoodDayOfWeekChart — vertical bar chart with one bar per weekday
// (Mon-Sun). Click-through cross-filter: a bar can be marked selected to
// dim its siblings and onClick fires with the day index (0=Mon..6=Sun, or
// null when clicking the active bar to clear).

import { fmtCount } from './glenwoodMetrics';

interface Bar {
  day: string;
  value: number;
}

interface Props {
  bars: Bar[];
  accent?: string;
  selectedDay?: number | null;
  onSelect?: (day: number | null) => void;
}

export function GlenwoodDayOfWeekChart({
  bars,
  accent = 'var(--accent)',
  selectedDay = null,
  onSelect,
}: Props) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  // Use a min-max normalized ratio so the lowest-value bar always lands on
  // the alpha floor regardless of how tightly clustered the data is. With
  // `value / max` alone, weekday distributions that hover within a narrow
  // band (e.g. 32K–40K) render as near-identical bars; this normalization
  // restores a visible gradient across the seven bars.
  const minVal = Math.min(...bars.map((b) => b.value));
  const valueRange = Math.max(1e-9, max - minVal);
  const clickable = onSelect != null;
  return (
    <div className="flex flex-1 min-h-0 gap-1 items-stretch">
      {bars.map((b, i) => {
        const pct = (b.value / max) * 100;
        const active = selectedDay === i;
        const dim = selectedDay != null && !active;
        // Value-driven white ramp — bars render as white-on-transparent
        // with the alpha keyed off `b.value / max`. Matches the
        // Workforce/RAC bottom-strip card treatment (white bars with
        // dim variants for lower-value rows). The active selection
        // outline still uses the accent color so the cross-filter cue
        // reads against the white fills.
        const ratio = (b.value - minVal) / valueRange;
        // 35–100% alpha range over the min/max-normalized ratio. The
        // floor keeps low-volume weekdays legible against the dark map
        // background while still leaving a clear gradient from minimum
        // to peak.
        const alphaPct = active ? 100 : Math.round(35 + ratio * 65);
        const fill =
          alphaPct >= 100
            ? '#ffffff'
            : `rgba(255, 255, 255, ${(alphaPct / 100).toFixed(2)})`;
        return (
          <button
            key={b.day}
            type="button"
            disabled={!clickable}
            onClick={
              clickable
                ? () => onSelect!(active ? null : i)
                : undefined
            }
            className="flex flex-col items-stretch flex-1 min-h-0 min-w-0"
            style={{
              cursor: clickable ? 'pointer' : 'default',
              background: 'transparent',
              border: 'none',
              padding: 0,
              opacity: dim ? 0.45 : 1,
            }}
            title={`${b.day}: ${fmtCount(b.value)} avg visits`}
            aria-pressed={active}
          >
            {/* Bar column: grows to fill vertical space; the actual bar
                lives at the bottom of this flex column so heights anchor
                to the X axis. The total label rides on top of the bar so
                each bar reads at a glance. */}
            <div className="flex-1 min-h-0 flex flex-col justify-end">
              <div
                className="text-[9px] tabular-nums text-center mb-0.5"
                style={{
                  color: active ? 'var(--text-h)' : 'var(--text-dim)',
                }}
              >
                {fmtCount(b.value)}
              </div>
              <div
                className="w-full rounded-t"
                style={{
                  background: fill,
                  height: `${pct}%`,
                  minHeight: 2,
                  outline: active ? `1px solid ${accent}` : undefined,
                  outlineOffset: 1,
                }}
              />
            </div>
            <div
              className="text-[9px] mt-1 text-center"
              style={{
                color: active ? 'var(--text-h)' : 'var(--text-dim)',
                fontWeight: active ? 600 : 400,
              }}
            >
              {b.day}
            </div>
          </button>
        );
      })}
    </div>
  );
}
