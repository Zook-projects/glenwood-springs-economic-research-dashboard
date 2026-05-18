// GlenwoodSeriesLegend — clickable chip row that drives the cross-filter
// between a multi-series MiniTrendChart and the day-of-week chart. The
// chart itself is still rendered by MiniTrendChart underneath; this row
// just exposes click semantics for selecting a series.

interface Item {
  key: string;
  label: string;
  color: string;
}

interface Props {
  items: Item[];
  selected: string | null;
  onSelect: (key: string | null) => void;
}

export function GlenwoodSeriesLegend({ items, selected, onSelect }: Props) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((it) => {
        const active = selected === it.key;
        const dim = selected != null && !active;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onSelect(active ? null : it.key)}
            className="text-[10px] px-1.5 py-0.5 rounded transition-colors flex items-center gap-1.5"
            style={{
              background: active ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${active ? it.color : 'var(--panel-border)'}`,
              color: dim ? 'var(--text-dim)' : 'var(--text-h)',
              opacity: dim ? 0.55 : 1,
            }}
            aria-pressed={active}
            title={`Filter to ${it.label}`}
          >
            <span
              className="w-1.5 h-1.5 rounded-sm shrink-0"
              style={{ background: it.color }}
            />
            <span className="truncate max-w-[110px]">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}
