// IndustrySectorRankingsCard — right-rail card for the Workforce map's
// Industry metric view. Lists all 20 NAICS sectors ranked by workplace jobs
// in the active scope (region / county-filtered region / selected workplace).
// Sits above the existing "Anchors by sector" card in the bottom strip and
// shares its width via absolute positioning in CommuteView.
//
// Clicking a row sets `industrySector` — identical to clicking a chip in the
// left panel. Clicking the already-active row toggles the filter back to
// 'all', matching the toggle behavior of the anchor rankings card.

import { useMemo } from 'react';
import { fmtInt, fmtPct } from '../../lib/format';
import { NAICS20_SECTORS, sumNaics20 } from '../../lib/naics20';
import type {
  Naics20Block,
  Naics20Key,
  WacFile,
} from '../../types/lodes';
import type { WorkforceCountyFilter, ZipMeta } from '../../types/flow';
import { isAnchorInCounty } from '../../lib/flowQueries';
import { COUNTY_LABEL_BY_FILTER } from '../../lib/workforceCountyScopes';

interface Props {
  wacFile: WacFile;
  zips: ZipMeta[];
  selectedZip: string | null;
  industrySector: Naics20Key | 'all';
  onIndustrySectorChange: (next: Naics20Key | 'all') => void;
  industryCounty?: WorkforceCountyFilter;
}

interface Scope {
  label: string;
  naics20: Naics20Block;
}

export function IndustrySectorRankingsCard({
  wacFile,
  zips,
  selectedZip,
  industrySector,
  onIndustrySectorChange,
  industryCounty = 'all',
}: Props) {
  const scope: Scope = useMemo(() => {
    if (selectedZip) {
      const entry = wacFile.entries.find((e) => e.zip === selectedZip);
      const label =
        zips.find((z) => z.zip === selectedZip)?.place ?? selectedZip;
      return {
        label,
        naics20: entry?.latest.naics20 ?? blankNaics(),
      };
    }
    if (industryCounty !== 'all') {
      const block = blankNaics();
      for (const z of zips) {
        if (!z.isAnchor) continue;
        if (!isAnchorInCounty(z.zip, industryCounty)) continue;
        const entry = wacFile.entries.find((e) => e.zip === z.zip);
        if (!entry) continue;
        for (const s of NAICS20_SECTORS) {
          block[s.key] += entry.latest.naics20[s.key] ?? 0;
        }
      }
      return {
        label: `${COUNTY_LABEL_BY_FILTER[industryCounty]} County`,
        naics20: block,
      };
    }
    return {
      label: 'Region',
      naics20: wacFile.aggregate.latest?.naics20 ?? blankNaics(),
    };
  }, [wacFile, zips, selectedZip, industryCounty]);

  const total = useMemo(() => sumNaics20(scope.naics20), [scope.naics20]);

  const rows = useMemo(() => {
    const r = NAICS20_SECTORS.map((s) => {
      const value = scope.naics20[s.key] ?? 0;
      return {
        key: s.key,
        label: s.shortLabel,
        color: s.color,
        value,
        pct: total > 0 ? value / total : 0,
      };
    });
    r.sort((a, b) => b.value - a.value);
    return r;
  }, [scope.naics20, total]);

  const maxValue = rows[0]?.value ?? 0;

  return (
    <div className="glass rounded-md p-3 flex flex-col gap-2 min-w-0 min-h-0 overflow-hidden h-full">
      <div className="flex items-baseline justify-between gap-2">
        <div
          className="text-[10px] font-semibold uppercase tracking-wider truncate"
          style={{ color: 'var(--text-h)' }}
        >
          Industry Sectors
        </div>
        <div
          className="text-[9px] tracking-wider truncate"
          style={{ color: 'var(--text-dim)' }}
          title={scope.label}
        >
          {scope.label}
        </div>
      </div>
      <ul className="flex flex-col gap-0.5 flex-1 min-h-0 overflow-y-auto pr-0.5">
        {rows.map((row) => {
          const active = industrySector === row.key;
          const barPct = maxValue > 0 ? (row.value / maxValue) * 100 : 0;
          return (
            <li key={row.key}>
              <button
                type="button"
                onClick={() =>
                  onIndustrySectorChange(active ? 'all' : row.key)
                }
                className="w-full text-left flex items-center gap-2 px-1 py-1 rounded transition-colors hover:bg-white/[0.04]"
                style={{
                  background: active ? `${row.color}29` : 'transparent',
                }}
                aria-pressed={active}
                aria-label={`Filter by ${row.label}`}
              >
                <span
                  className="block w-1.5 h-3 rounded-sm shrink-0"
                  style={{ background: row.color }}
                  aria-hidden
                />
                <span
                  className="text-[10px] truncate flex-1 min-w-0"
                  style={{ color: active ? row.color : 'var(--text-h)' }}
                  title={row.label}
                >
                  {row.label}
                </span>
                <span
                  className="hidden lg:block h-2 rounded-full overflow-hidden shrink-0"
                  style={{
                    width: 60,
                    background: 'rgba(255,255,255,0.05)',
                  }}
                >
                  <span
                    className="block h-full"
                    style={{
                      width: `${barPct}%`,
                      background: row.color,
                      opacity: 0.85,
                    }}
                  />
                </span>
                <span
                  className="text-[10px] tabular-nums w-[52px] text-right shrink-0"
                  style={{ color: 'var(--text-h)' }}
                >
                  {fmtInt(row.value)}
                </span>
                <span
                  className="text-[10px] tabular-nums w-[42px] text-right shrink-0"
                  style={{ color: 'var(--text-dim)' }}
                >
                  {fmtPct(row.pct)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function blankNaics(): Naics20Block {
  return Object.fromEntries(
    NAICS20_SECTORS.map((s) => [s.key, 0]),
  ) as Naics20Block;
}
