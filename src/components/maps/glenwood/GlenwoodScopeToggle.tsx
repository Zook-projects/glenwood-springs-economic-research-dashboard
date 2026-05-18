// GlenwoodScopeToggle — top-of-panel toggle that switches the Activity Map
// between the regional Placer dataset (current behavior) and the
// Glenwood-specific bundle. Sits above the existing ModeToggle.
//
// When the Glenwood bundle hasn't loaded yet, the Glenwood option renders
// disabled with a tooltip so the user understands why it's not actionable.

import { MapToggleSegmented } from '../MapToggleSegmented';

export type GlenwoodScope = 'region' | 'glenwood';

interface Props {
  scope: GlenwoodScope;
  onChange: (next: GlenwoodScope) => void;
  glenwoodAvailable: boolean;
}

const OPTIONS = [
  { value: 'region' as const, label: 'Region' },
  { value: 'glenwood' as const, label: 'Glenwood' },
];

export function GlenwoodScopeToggle({ scope, onChange, glenwoodAvailable }: Props) {
  const accent = 'var(--accent)';
  if (!glenwoodAvailable) {
    return (
      <div
        title="Glenwood data still loading"
        aria-disabled
        style={{ opacity: 0.55, pointerEvents: 'none' }}
      >
        <MapToggleSegmented<GlenwoodScope>
          options={OPTIONS}
          value="region"
          onChange={() => {}}
          accent={accent}
          ariaLabel="Activity scope"
        />
      </div>
    );
  }
  return (
    <MapToggleSegmented<GlenwoodScope>
      options={OPTIONS}
      value={scope}
      onChange={onChange}
      accent={accent}
      ariaLabel="Activity scope"
    />
  );
}
