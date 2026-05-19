// Two-tier metric selector for the Activity map's left panel. Top row picks
// a CATEGORY (Workers / Visitors / Shoppers); the row below shows the
// sub-options for the active category and reflects the user's current
// metric. Each category remembers its last-active sub-option in a ref so
// re-clicking a category restores the prior sub-choice instead of forcing
// the default.
//
// Visual contract matches the Demographics / Housing / Commerce maps' Metric
// section — bordered tiles in a grid, accent-filled when active. The
// Activity map's accent is the Placer purple from RAMPS.activity.
//
// Metric ↔ source-file mapping (applied in ActivityCommuteView):
//   workers                  → Employee Counts, raw annual workers
//   daily-trips              → Employee Visits × 2 / 365 (round-trip × annualization)
//   trips                    → Employee Visits × 2 (annual round-trip volume)
//   visitors                 → Visitor Counts, raw annual visitors (no ×2)
//   daily-visits             → Visitor Visits / 365 (annualization only)
//   visits                   → Visitor Visits, raw annual visit count
//   out-of-market-shopping   → Resident Top Locations, summed visits to ZIPs
//                              outside the resident's home ZIP

import { useRef } from 'react';
import { RAMPS } from '../lib/subjectColorRamps';

export type ActivityCategory = 'workers' | 'visitors' | 'shoppers';

export type ActivityMetric =
  | 'workers'
  | 'daily-trips'
  | 'trips'
  | 'visitors'
  | 'daily-visits'
  | 'visits'
  | 'out-of-market-shopping';

interface Props {
  value: ActivityMetric;
  onChange: (next: ActivityMetric) => void;
}

interface MetricOption {
  value: ActivityMetric;
  label: string;
}

interface CategoryOption {
  value: ActivityCategory;
  label: string;
}

const CATEGORIES: ReadonlyArray<CategoryOption> = [
  { value: 'workers',  label: 'Workers'  },
  { value: 'visitors', label: 'Visitors' },
  { value: 'shoppers', label: 'Shoppers' },
];

const SUB_OPTIONS: Record<ActivityCategory, ReadonlyArray<MetricOption>> = {
  workers: [
    { value: 'workers',     label: 'Workers'          },
    { value: 'daily-trips', label: 'Avg. Daily Trips' },
    { value: 'trips',       label: 'Trips'            },
  ],
  visitors: [
    { value: 'visitors',     label: 'Visitors'          },
    { value: 'daily-visits', label: 'Avg. Daily Visits' },
    { value: 'visits',       label: 'Visits'            },
  ],
  shoppers: [
    { value: 'out-of-market-shopping', label: 'Out of Market Shopping' },
  ],
};

const DEFAULT_METRIC_FOR_CATEGORY: Record<ActivityCategory, ActivityMetric> = {
  workers: 'workers',
  visitors: 'visitors',
  shoppers: 'out-of-market-shopping',
};

export function categoryOf(metric: ActivityMetric): ActivityCategory {
  switch (metric) {
    case 'workers':
    case 'daily-trips':
    case 'trips':
      return 'workers';
    case 'visitors':
    case 'daily-visits':
    case 'visits':
      return 'visitors';
    case 'out-of-market-shopping':
      return 'shoppers';
  }
}

export function metricsInCategory(
  category: ActivityCategory,
): ReadonlyArray<MetricOption> {
  return SUB_OPTIONS[category];
}

export function ActivityMetricToggle({ value, onChange }: Props) {
  // Pull the accent + soft variant from the scoped CSS theme so the
  // metric toggle in the Region view matches the rest of the GPS
  // Activity surface (currently the Regional-tier grey from the visitor
  // palette). Falls back to the static RAMPS value only as a defensive
  // default — `.placer-theme` always wraps this component in practice.
  void RAMPS;
  const accent = 'var(--accent)';
  const accentSoft = 'var(--accent-soft)';
  const activeCategory = categoryOf(value);

  // Per-category last-active sub-metric. Re-clicking a category restores the
  // user's prior sub-choice instead of forcing the default. Updated whenever
  // value flips to a metric in that category — ref so it stays in sync with
  // external prop changes without forcing a re-render.
  const lastMetricByCategory = useRef<Record<ActivityCategory, ActivityMetric>>(
    { ...DEFAULT_METRIC_FOR_CATEGORY },
  );
  lastMetricByCategory.current[activeCategory] = value;

  const handleCategoryClick = (cat: ActivityCategory) => {
    if (cat === activeCategory) return;
    onChange(lastMetricByCategory.current[cat]);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--text-dim)' }}
      >
        Metric
      </div>

      {/* Category row */}
      <div
        role="tablist"
        aria-label="Activity metric category"
        className="grid grid-cols-3 gap-1"
      >
        {CATEGORIES.map((cat) => {
          const active = cat.value === activeCategory;
          return (
            <button
              key={cat.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => handleCategoryClick(cat.value)}
              title={cat.label}
              className="text-left px-2 py-1.5 rounded text-[10px] font-medium uppercase tracking-wider transition-colors focus:outline-none focus-visible:ring-1"
              style={{
                background: active ? accentSoft : 'rgba(255,255,255,0.03)',
                border: `1px solid ${active ? accent : 'var(--panel-border)'}`,
                color: active ? accent : 'var(--text-h)',
              }}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Sub-option row — always renders for the active category. Shoppers
          shows a single tile, styled identically so it doesn't look like a
          degenerate state. */}
      <div
        role="tablist"
        aria-label={`${activeCategory} sub-metric`}
        className="grid grid-cols-3 gap-1"
      >
        {SUB_OPTIONS[activeCategory].map((opt) => {
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
                background: active ? accentSoft : 'rgba(255,255,255,0.03)',
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
