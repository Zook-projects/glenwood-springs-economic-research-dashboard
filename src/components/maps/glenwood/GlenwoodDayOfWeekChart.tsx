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
  const clickable = onSelect != null;
  return (
    <div className="flex flex-1 min-h-0 gap-1 items-stretch">
      {bars.map((b, i) => {
        const pct = (b.value / max) * 100;
        const active = selectedDay === i;
        const dim = selectedDay != null && !active;
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
                  background: accent,
                  opacity: 0.65 + (b.value / max) * 0.35,
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
