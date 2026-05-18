// GlenwoodSubViewTabs — three-way segmented tab for the Glenwood scope.
// Visitation = city-wide overview, Retail Hubs = 8 hubs detail,
// POIs = 8 tourism attractions detail.

import { MapToggleSegmented } from '../MapToggleSegmented';

export type GlenwoodSubView = 'visitation' | 'retailHubs' | 'pois';

interface Props {
  value: GlenwoodSubView;
  onChange: (next: GlenwoodSubView) => void;
}

const OPTIONS = [
  { value: 'visitation' as const, label: 'Visitation' },
  { value: 'retailHubs' as const, label: 'Retail Hubs' },
  { value: 'pois' as const, label: 'POIs' },
];

export function GlenwoodSubViewTabs({ value, onChange }: Props) {
  return (
    <MapToggleSegmented<GlenwoodSubView>
      options={OPTIONS}
      value={value}
      onChange={onChange}
      accent="var(--accent)"
      ariaLabel="Glenwood sub-view"
    />
  );
}
