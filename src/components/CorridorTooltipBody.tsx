// CorridorTooltipBody — shared body table rendered inside the corridor
// pinned + hover tooltips on every map view. Lifted out of CommuteView so
// the Activity map can render the same "Places of Residence / Places of
// Work" breakdown without duplicating the table logic.
//
// Rendering rules (unchanged from the original inlined version):
//   - Group rows by `place` so multi-ZIP cities (Eagle 81631+81637, Grand
//     Junction 81501+81505) collapse to a single line.
//   - Rank desc by worker count, place name as a stable tiebreaker.
//   - Top-N rows, the rest roll into "+ X more origins/destinations".
//   - When `onSelectPartner` is provided each row becomes a partner-filter
//     click target; the selected partner highlights via --accent-soft.

import type { ActiveCorridorAggregation, ZipMeta } from '../types/flow';
import { fmtInt, fmtPct } from '../lib/format';

function placeLabel(zips: ZipMeta[], zip: string): string {
  // Gateway sentinels for the East ↔ West pass-through transit synthetic
  // flows have no entry in zips.json — they live only in the corridor
  // graph as off-map I-70 endpoints. Render their human-readable labels
  // instead of leaking the raw 'GW_E' / 'GW_W' identifiers into tooltips.
  if (zip === 'GW_E') return 'Eastern I-70';
  if (zip === 'GW_W') return 'Western I-70';
  const m = zips.find((z) => z.zip === zip);
  return m?.place || zip;
}

interface Props {
  aggregation: ActiveCorridorAggregation;
  // 'residence' renders byOriginZip; 'workplace' renders byDestZip.
  direction: 'residence' | 'workplace';
  zips: ZipMeta[];
  onSelectPartner?: (p: { place: string; zips: string[] }) => void;
  selectedPartner?: { place: string; zips: string[] } | null;
  topN?: number;
}

export function CorridorTooltipBody({
  aggregation,
  direction,
  zips,
  onSelectPartner,
  selectedPartner,
  topN = 8,
}: Props) {
  const map =
    direction === 'workplace' ? aggregation.byDestZip : aggregation.byOriginZip;
  const total = aggregation.total || 1;

  type GroupRow = { place: string; zips: string[]; count: number };
  const groupMap = new Map<string, GroupRow>();
  for (const [zip, count] of map.entries()) {
    const place = placeLabel(zips, zip);
    const existing = groupMap.get(place);
    if (existing) {
      existing.count += count;
      if (!existing.zips.includes(zip)) existing.zips.push(zip);
    } else {
      groupMap.set(place, { place, zips: [zip], count });
    }
  }
  for (const r of groupMap.values()) r.zips.sort();
  const rows = Array.from(groupMap.values()).sort(
    (a, b) => b.count - a.count || a.place.localeCompare(b.place),
  );

  const top = rows.slice(0, topN);
  const rest = rows.slice(topN);
  const restCount = rest.reduce((s, r) => s + r.count, 0);

  const handleRowClick = onSelectPartner
    ? (place: string, zipsInGroup: string[]) =>
        onSelectPartner({ place, zips: zipsInGroup })
    : undefined;

  return (
    <table className="w-full text-[11px] tnum mt-1">
      <tbody>
        {top.map((r) => {
          const isSelected = selectedPartner?.place === r.place;
          const rowClass =
            'transition-colors' +
            (handleRowClick ? ' cursor-pointer hover:bg-white/5' : '');
          return (
            <tr
              key={r.place}
              className={rowClass}
              onClick={
                handleRowClick ? () => handleRowClick(r.place, r.zips) : undefined
              }
              role={handleRowClick ? 'button' : undefined}
              aria-pressed={handleRowClick ? isSelected : undefined}
              aria-label={
                handleRowClick
                  ? `Filter to ${r.place} (${r.zips.length > 1 ? 'multiple ZIPs' : r.zips[0]})`
                  : undefined
              }
              style={{
                background: isSelected ? 'var(--accent-soft)' : undefined,
              }}
            >
              <td
                className="pr-2 align-baseline"
                style={{ color: isSelected ? 'var(--accent)' : 'var(--text-h)' }}
              >
                {r.place}{' '}
                <span style={{ color: 'var(--text-dim)' }}>
                  · {r.zips.length > 1 ? 'multiple' : r.zips[0]}
                </span>
              </td>
              <td className="text-right pr-2" style={{ color: 'var(--text)' }}>
                {fmtInt(r.count)}
              </td>
              <td className="text-right" style={{ color: 'var(--text-dim)' }}>
                {fmtPct(r.count / total)}
              </td>
            </tr>
          );
        })}
        {rest.length > 0 && (
          <tr>
            <td className="pr-2 align-baseline italic" style={{ color: 'var(--text-dim)' }}>
              + {rest.length} more {direction === 'workplace' ? 'destinations' : 'origins'}
            </td>
            <td className="text-right pr-2" style={{ color: 'var(--text)' }}>
              {fmtInt(restCount)}
            </td>
            <td className="text-right" style={{ color: 'var(--text-dim)' }}>
              {fmtPct(restCount / total)}
            </td>
          </tr>
        )}
        <tr style={{ borderTop: '1px solid var(--rule)' }}>
          <td
            className="pr-2 align-baseline pt-1 text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-dim)' }}
          >
            Total
          </td>
          <td className="text-right pr-2 pt-1" style={{ color: 'var(--text-h)' }}>
            {fmtInt(aggregation.total)}
          </td>
          <td className="text-right pt-1" style={{ color: 'var(--text-dim)' }}>
            100%
          </td>
        </tr>
      </tbody>
    </table>
  );
}
