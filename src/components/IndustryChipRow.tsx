// IndustryChipRow — 21-chip selector beneath ViewLayerToggle, visible only
// when the Industry metric mode is active. "All Sectors" + every NAICS-20
// sector. Chips wrap to fit the 380-px DashboardTile column.
//
// Visual treatment matches SegmentFilterPanel's Chip primitive (amber accent
// for active, panel-border outline for inactive) so the Industry sub-row
// reads as a continuation of the Metric toggle's amber language.

import type { Naics20Key } from '../types/lodes';
import { NAICS20_SECTORS } from '../lib/naics20';

interface Props {
  value: Naics20Key | 'all';
  onChange: (next: Naics20Key | 'all') => void;
}

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

export function IndustryChipRow({ value, onChange }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <span
        className="text-[10px] font-medium uppercase tracking-wider"
        style={{ color: 'var(--text-dim)' }}
      >
        Sector
      </span>
      <div className="flex flex-wrap gap-1">
        <Chip
          active={value === 'all'}
          onClick={() => onChange('all')}
          ariaLabel="All sectors"
        >
          All Sectors
        </Chip>
        {NAICS20_SECTORS.map((s) => (
          <Chip
            key={s.key}
            active={value === s.key}
            onClick={() => onChange(s.key)}
            ariaLabel={`Filter by ${s.label}`}
          >
            {s.shortLabel}
          </Chip>
        ))}
      </div>
    </div>
  );
}
