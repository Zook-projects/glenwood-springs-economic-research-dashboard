// GlenwoodDistributionBar — horizontal bar chart for bucketed shares (HH Size,
// Income brackets). Each bucket is a row: label + filled bar + percent text.
// Rows flex-grow to share the parent card's available vertical space, so the
// bars look proportionally fatter on cards with fewer buckets.

interface Bucket {
  label: string;
  value: number;
}

interface Props {
  buckets: Bucket[];
  accent?: string;
}

export function GlenwoodDistributionBar({ buckets, accent = 'var(--accent)' }: Props) {
  const max = Math.max(0, ...buckets.map((b) => b.value));
  return (
    <ul className="flex flex-col gap-1 flex-1 min-h-0">
      {buckets.map((b) => (
        <li
          key={b.label}
          className="flex items-center gap-2 px-1 flex-1 min-h-0"
        >
          <span
            className="text-[10px] truncate w-[90px] shrink-0"
            style={{ color: 'var(--text-dim)' }}
          >
            {b.label}
          </span>
          <span
            className="flex-1 self-stretch rounded-md"
            style={{ background: 'rgba(255,255,255,0.05)' }}
          >
            <span
              className="block h-full rounded-md"
              style={{
                width: max === 0 ? '0%' : `${(b.value / max) * 100}%`,
                background: accent,
              }}
            />
          </span>
          <span
            className="text-[10px] tabular-nums w-[40px] text-right shrink-0"
            style={{ color: 'var(--text-h)' }}
          >
            {(b.value * 100).toFixed(1)}%
          </span>
        </li>
      ))}
    </ul>
  );
}
