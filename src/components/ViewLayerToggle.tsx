// Corridor / Heatmap / Industry segmented control. Picks which spatial
// visualization the map area renders: the flow-arc corridor view (default),
// the block-level density heatmap, or the workplace-anchor Industry bubble
// view. Sits below DirectionToggle in DashboardTile.
//
// Uses the shared MapToggleSegmented primitive so its styling matches the
// metric toggles on the Demographics / Housing / Commerce maps.

import { MapToggleSegmented } from './maps/MapToggleSegmented';

export type ViewLayer = 'corridor' | 'heatmap' | 'industry';

interface Props {
  value: ViewLayer;
  onChange: (next: ViewLayer) => void;
}

const OPTIONS: ReadonlyArray<{ value: ViewLayer; label: string }> = [
  { value: 'corridor', label: 'Corridor' },
  { value: 'heatmap', label: 'Heatmap' },
  { value: 'industry', label: 'Industry' },
];

export function ViewLayerToggle({ value, onChange }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <span
        className="text-[10px] font-medium uppercase tracking-wider"
        style={{ color: 'var(--text-dim)' }}
      >
        Metric
      </span>
      <MapToggleSegmented
        options={OPTIONS}
        value={value}
        onChange={onChange}
        accent="var(--accent)"
        ariaLabel="Map visualization metric"
      />
    </div>
  );
}
