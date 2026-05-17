// Corridor / Flow Lines / Heatmap segmented control for the Activity
// map's Shoppers metric. Renders below the Direction block in the left
// panel.
//   · Corridor — flows ride the I-70 / Hwy 82 corridor graph (default).
//   · Flow Lines — direct dashed lines from each resident anchor to
//     each destination property's ZIP centroid (skips the corridor
//     graph so the user can see un-routed reach). Internal id stays
//     `spaghetti` so existing code paths keep matching.
//   · Heatmap — destination heat blobs weighted by visit volume;
//     mirrors the Workforce map's heatmap rendering primitive.

export type ShopperViewLayer = 'corridor' | 'spaghetti' | 'heatmap';

interface Props {
  value: ShopperViewLayer;
  onChange: (next: ShopperViewLayer) => void;
}

const OPTIONS: ReadonlyArray<{ value: ShopperViewLayer; label: string }> = [
  { value: 'corridor',  label: 'Corridor'   },
  { value: 'spaghetti', label: 'Flow Lines' },
  { value: 'heatmap',   label: 'Heatmap'    },
];

export function ShopperViewToggle({ value, onChange }: Props) {
  const panelStyle = {
    background: 'rgba(255,255,255,0.03)',
    borderColor: 'var(--panel-border)',
  };
  return (
    <div
      role="tablist"
      aria-label="Shopper view layer"
      className="flex flex-col gap-1.5"
    >
      <span
        className="text-[10px] font-medium uppercase tracking-wider"
        style={{ color: 'var(--text-dim)' }}
      >
        View
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
