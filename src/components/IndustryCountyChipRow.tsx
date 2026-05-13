// IndustryCountyChipRow — 4-chip county selector that appears between the
// Metric (ViewLayer) toggle and the NAICS-20 Sector chip row whenever the
// Workforce map's Industry view is active. Filters the anchor bubbles and
// the bottom Industry strip to anchors whose ZIP centroid sits in the
// selected county. Mirrors `IndustryChipRow`'s visual treatment so the two
// sub-rows read as continuations of the Metric toggle's amber language.

import type { WorkforceCountyFilter } from '../types/flow';

interface Props {
  value: WorkforceCountyFilter;
  onChange: (next: WorkforceCountyFilter) => void;
}

const OPTIONS: ReadonlyArray<{ key: WorkforceCountyFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'garfield', label: 'Garfield' },
  { key: 'pitkin', label: 'Pitkin' },
  { key: 'eagle', label: 'Eagle' },
];

function Chip({
  active,
  onClick,
  children,
  ariaLabel,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className="rounded-md px-2 py-1 text-[10px] tnum transition-colors text-left"
      style={{
        color: active ? 'var(--accent)' : 'var(--text-h)',
        background: active ? 'rgba(245, 158, 11, 0.12)' : 'transparent',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--panel-border)'}`,
      }}
    >
      {children}
    </button>
  );
}

export function IndustryCountyChipRow({ value, onChange }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <span
        className="text-[10px] font-medium uppercase tracking-wider"
        style={{ color: 'var(--text-dim)' }}
      >
        County
      </span>
      <div className="flex flex-wrap gap-1">
        {OPTIONS.map((opt) => (
          <Chip
            key={opt.key}
            active={value === opt.key}
            onClick={() => onChange(opt.key)}
            ariaLabel={
              opt.key === 'all'
                ? 'All counties'
                : `Filter Industry view to ${opt.label} County`
            }
          >
            {opt.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}
