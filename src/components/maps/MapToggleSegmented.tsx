// MapToggleSegmented — full-width segmented toggle. Mirrors the Workforce
// View / Direction toggle (DirectionToggle.tsx) so the Demographics /
// Housing / Commerce tile sections (Geographic level, County filter, Map
// layer, Variant, Trend cadence) share the same visual language: a
// bordered light-bg container with N equal-width buttons that highlight
// the active option in the subject accent.

interface Option<T extends string | null> {
  value: T;
  label: string;
}

interface Props<T extends string | null> {
  options: ReadonlyArray<Option<T>>;
  value: T;
  onChange: (next: T) => void;
  accent: string;
  ariaLabel?: string;
}

export function MapToggleSegmented<T extends string | null>({
  options,
  value,
  onChange,
  accent,
  ariaLabel,
}: Props<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="grid gap-1 p-1 rounded-lg border"
      style={{
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
        background: 'rgba(255,255,255,0.03)',
        borderColor: 'var(--panel-border)',
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.label}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className="px-2 py-1.5 text-xs font-medium rounded-md transition-colors focus:outline-none focus-visible:ring-1 truncate"
            style={{
              background: active ? accent : 'transparent',
              color: active ? '#1a1207' : 'var(--text)',
            }}
            title={o.label}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
