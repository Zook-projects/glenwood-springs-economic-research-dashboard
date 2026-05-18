// GlenwoodDimToggle — compact 2-up segmented control rendered in card
// headers (e.g., the Visitation strip's Visit Trends card). Smaller than
// the panel-level MapToggleSegmented so it tucks into the top-right of a
// 260px card without dominating the chrome.

import type { ReactNode } from 'react';

interface Option<T extends string> {
  value: T;
  label: ReactNode;
}

interface Props<T extends string> {
  options: ReadonlyArray<Option<T>>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
}

export function GlenwoodDimToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: Props<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex p-0.5 rounded-md border"
      style={{
        background: 'rgba(255,255,255,0.04)',
        borderColor: 'var(--panel-border)',
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-sm transition-colors"
            style={{
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? '#1a1207' : 'var(--text-dim)',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
