// GlenwoodMetricToggle — Visits / Demographics segmented control. Mirrors
// the demographics/housing/commerce maps' metric switcher pattern but
// scoped to two options that drive the three bottom-strip cards.

import { MapToggleSegmented } from '../MapToggleSegmented';

export type GlenwoodMetric = 'visits' | 'demographics';

interface Props {
  value: GlenwoodMetric;
  onChange: (next: GlenwoodMetric) => void;
}

const OPTIONS = [
  { value: 'visits' as const, label: 'Visits' },
  { value: 'demographics' as const, label: 'Demographics' },
];

export function GlenwoodMetricToggle({ value, onChange }: Props) {
  return (
    <MapToggleSegmented<GlenwoodMetric>
      options={OPTIONS}
      value={value}
      onChange={onChange}
      accent="var(--accent)"
      ariaLabel="Glenwood metric"
    />
  );
}
