// All / Regional / Tourist segmented control — replaces the geographic
// DirectionToggle when the Activity map's Visitors metric is active. Bucket
// boundary is a 50-mile crow-flies radius from the visit destination:
//   Regional → origin within 50 mi (likely drive-in / repeat visitors)
//   Tourist  → origin 50 mi or more away (out-of-region travelers)
// "All" passes flows through unchanged. Mirrors DirectionToggle row 1
// visually so the panel layout stays consistent when the user switches
// between metric categories.

import type { VisitorType } from '../lib/flowQueries';

interface Props {
  value: VisitorType;
  onChange: (next: VisitorType) => void;
}

const OPTIONS: ReadonlyArray<{ value: VisitorType; label: string }> = [
  { value: 'all',      label: 'All'      },
  { value: 'regional', label: 'Regional' },
  { value: 'tourist',  label: 'Tourist'  },
];

export function VisitorTypeToggle({ value, onChange }: Props) {
  const panelStyle = {
    background: 'rgba(255,255,255,0.03)',
    borderColor: 'var(--panel-border)',
  };
  return (
    <div
      role="tablist"
      aria-label="Visitor type filter"
      className="flex flex-col gap-1.5"
    >
      <span
        className="text-[10px] font-medium uppercase tracking-wider"
        style={{ color: 'var(--text-dim)' }}
      >
        Visitor Type
      </span>
      <div
        className="grid grid-cols-3 gap-1 p-1 rounded-lg border"
        style={panelStyle}
      >
        {OPTIONS.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              role="tab"
              aria-selected={active}
              onClick={() => onChange(opt.value)}
              className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
              style={{
                background: active ? 'var(--accent)' : 'transparent',
                color: active ? '#1a1207' : 'var(--text)',
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
