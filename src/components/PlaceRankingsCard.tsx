// PlaceRankingsCard — shared "Top Destinations" / "Top Visiting Places"
// ranked bar list used by both ShopperBottomCardStrip (multi-select
// partner toggle) and ActivityBottomCardStrip (single-select anchor
// pick for the Visitors metric). The card is a visual primitive — the
// caller decides selection semantics by supplying:
//   selectedPlaces: the set of currently-highlighted row keys
//   onToggleRow:    invoked when a row is clicked (caller adds/removes
//                   from its own selection state)
//   onClearAll:     optional — when present, renders a "Clear (N)"
//                   affordance in the header

import { fmtInt, fmtPct } from '../lib/format';
import { RAMPS } from '../lib/subjectColorRamps';

export interface PlaceRankingRow {
  place: string;
  zips: string[];
  value: number;
}

interface Props {
  rows: ReadonlyArray<PlaceRankingRow>;
  total: number;
  scope: string;
  title: string;
  selectedPlaces: ReadonlySet<string>;
  onToggleRow: (row: PlaceRankingRow) => void;
  onClearAll?: () => void;
  selectedCount?: number;
  // Render up to N rows. Default 12 matches the ShopperBottomCardStrip
  // legacy layout; bump higher for the visitor anchor list if needed.
  limit?: number;
}

export function PlaceRankingsCard({
  rows,
  total,
  scope,
  title,
  selectedPlaces,
  onToggleRow,
  onClearAll,
  selectedCount = 0,
  limit = 12,
}: Props) {
  const accent = RAMPS.activity.accent;
  const maxValue = rows[0]?.value ?? 0;
  return (
    <div className="glass rounded-md p-3 flex flex-col gap-1.5 min-w-0 min-h-0 overflow-hidden flex-1">
      <div className="flex items-baseline justify-between gap-2">
        <div
          className="text-[10px] font-semibold uppercase tracking-wider truncate"
          style={{ color: 'var(--text-h)' }}
        >
          {title}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onClearAll && selectedCount > 0 && (
            <button
              type="button"
              onClick={onClearAll}
              className="text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ color: accent }}
              title="Clear all selections"
            >
              Clear ({selectedCount})
            </button>
          )}
          <div
            className="text-[9px] tracking-wider truncate"
            style={{ color: 'var(--text-dim)' }}
            title={scope}
          >
            {scope}
          </div>
        </div>
      </div>
      <ul className="flex flex-col gap-0.5 flex-1 min-h-0 overflow-y-auto pr-0.5">
        {rows.slice(0, limit).map((row) => {
          const active = selectedPlaces.has(row.place);
          const barPct = maxValue > 0 ? (row.value / maxValue) * 100 : 0;
          return (
            <li key={row.place}>
              <button
                type="button"
                onClick={() => onToggleRow(row)}
                className="w-full text-left flex items-center gap-2 px-1 py-0.5 rounded transition-colors hover:bg-white/[0.04]"
                style={{ background: active ? `${accent}29` : 'transparent' }}
                aria-pressed={active}
              >
                <span
                  className="text-[10px] truncate flex-1 min-w-0"
                  style={{ color: active ? accent : 'var(--text-h)' }}
                  title={row.place}
                >
                  {row.place}
                </span>
                <span
                  className="hidden lg:block h-2 rounded-full overflow-hidden shrink-0"
                  style={{ width: 36, background: 'rgba(255,255,255,0.05)' }}
                >
                  <span
                    className="block h-full"
                    style={{
                      width: `${barPct}%`,
                      background: accent,
                      opacity: 0.85,
                    }}
                  />
                </span>
                <span
                  className="text-[10px] tabular-nums w-[60px] text-right shrink-0"
                  style={{ color: 'var(--text-h)' }}
                >
                  {fmtInt(row.value)}
                </span>
                <span
                  className="text-[10px] tabular-nums w-[36px] text-right shrink-0"
                  style={{ color: 'var(--text-dim)' }}
                >
                  {fmtPct(row.value / Math.max(total, 1))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
