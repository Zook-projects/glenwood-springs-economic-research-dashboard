// SubjectKpiCard — small KPI card used inside subject map tiles + bottom
// strips. Displays a label, a primary value, and an optional sublabel
// (units, denominator, % of region, etc.). Uniform sizing across the three
// new subject maps so the chrome reads consistently.

import { type ReactNode } from 'react';

interface Props {
  label: string;
  value: string | number | null | undefined;
  sublabel?: string;
  trailing?: ReactNode;
  size?: 'sm' | 'md';
  // When true, the card visually reads as "selected" or "active" — used to
  // highlight the place focus in the bottom strip.
  active?: boolean;
}

export function SubjectKpiCard({
  label,
  value,
  sublabel,
  trailing,
  size = 'md',
  active,
}: Props) {
  const valueText =
    value === null || value === undefined || value === ''
      ? '—'
      : typeof value === 'number'
      ? value.toLocaleString()
      : value;

  return (
    <div
      className="rounded-md p-3 flex flex-col gap-1 min-w-0"
      style={{
        background: active ? 'rgba(245, 158, 11, 0.10)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--panel-border)'}`,
      }}
    >
      <div
        className="text-[9px] font-semibold uppercase tracking-wider truncate"
        style={{ color: 'var(--text-dim)' }}
      >
        {label}
      </div>
      <div
        className={size === 'sm' ? 'text-[16px] font-semibold' : 'text-[20px] font-semibold'}
        style={{ color: 'var(--text-h)' }}
      >
        {valueText}
      </div>
      <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
        {sublabel || ' '}
      </div>
      {trailing}
    </div>
  );
}
