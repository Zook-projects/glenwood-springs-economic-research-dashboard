// Workers / Avg. Daily Trips / Trips metric selector for the Activity map's
// left panel. Visual contract matches the Demographics / Housing / Commerce
// maps' Metric section — bordered tiles in a grid, accent-filled when
// active. The Activity map's accent is the Placer purple from RAMPS.activity.
//
// Modes:
//   - workers     → Employee Counts, raw annual workers
//   - daily-trips → Employee Visits × 2 / 365 (round-trip × annualization)
//   - trips       → Employee Visits, raw annual visit count
// All scaling is applied upstream in ActivityCommuteView; this component is
// presentation-only.

import { RAMPS } from '../lib/subjectColorRamps';

export type ActivityMetric = 'workers' | 'daily-trips' | 'trips';

interface Props {
  value: ActivityMetric;
  onChange: (next: ActivityMetric) => void;
}

const OPTIONS: ReadonlyArray<{ value: ActivityMetric; label: string }> = [
  { value: 'workers', label: 'Workers' },
  { value: 'daily-trips', label: 'Avg. Daily Trips' },
  { value: 'trips', label: 'Trips' },
];

export function ActivityMetricToggle({ value, onChange }: Props) {
  const accent = RAMPS.activity.accent;
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--text-dim)' }}
      >
        Metric
      </div>
      <div
        role="tablist"
        aria-label="Activity metric"
        className="grid grid-cols-3 gap-1"
      >
        {OPTIONS.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(opt.value)}
              title={opt.label}
              className="text-left px-2 py-1.5 rounded text-[10px] font-medium uppercase tracking-wider transition-colors focus:outline-none focus-visible:ring-1"
              style={{
                background: active ? `${accent}29` : 'rgba(255,255,255,0.03)',
                border: `1px solid ${active ? accent : 'var(--panel-border)'}`,
                color: active ? accent : 'var(--text-h)',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
