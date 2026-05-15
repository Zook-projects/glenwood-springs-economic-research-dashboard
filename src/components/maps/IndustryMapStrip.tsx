// IndustryMapStrip — bottom card strip for the Workforce map when the
// Industry metric is active. Mirrors the 3-card pattern used by the
// Demographics / Housing / Commerce strips: overview KPIs, trend chart,
// rankings list — but read off `wacFile` instead of the context bundle.
//
// Scope:
//   - aggregate (no anchor selected) → wacFile.aggregate
//   - anchor selected               → wacFile.entries[zip]
//
// Sector behavior:
//   - 'all'           → bubble + KPI + trend show the union (totalJobs)
//   - <NAICS-20 key>  → values narrow to that sector; rankings flip to
//                       anchors-by-sector when an anchor is NOT selected

import { useMemo } from 'react';
import { fmtInt, fmtPct } from '../../lib/format';
import { NAICS20_BY_KEY, NAICS20_SECTORS, sumNaics20 } from '../../lib/naics20';
import type {
  Naics20Block,
  Naics20Key,
  TrendPoint,
  WacFile,
} from '../../types/lodes';
import type { WorkforceCountyFilter, ZipMeta } from '../../types/flow';
import { isAnchorInCounty } from '../../lib/flowQueries';
import { SubjectKpiCard } from './SubjectKpiCard';
import { MiniTrendChart } from './MiniTrendChart';

export const INDUSTRY_STRIP_CARD_HEIGHT = 220;

interface Props {
  wacFile: WacFile;
  zips: ZipMeta[];
  selectedZip: string | null;
  industrySector: Naics20Key | 'all';
  onIndustrySectorChange: (next: Naics20Key | 'all') => void;
  // County filter sourced from the DashboardTile chip row above this strip.
  // 'all' = unscoped (default). Narrowing restricts the anchor rankings,
  // region totals, and the bottom-row map overlay to anchors in the named
  // county. Optional so legacy callers remain compatible.
  industryCounty?: WorkforceCountyFilter;
  onSelectZip: (zip: string | null) => void;
}

interface ScopeData {
  label: string;
  totalJobs: number;
  naics20: Naics20Block;
  trendForSector: TrendPoint[];
  trendForTotal: TrendPoint[];
}

export function IndustryMapStrip({
  wacFile,
  zips,
  selectedZip,
  industrySector,
  onIndustrySectorChange,
  industryCounty = 'all',
  onSelectZip,
}: Props) {
  const sectorMeta =
    industrySector === 'all' ? null : NAICS20_BY_KEY[industrySector];
  const sectorColor = sectorMeta ? sectorMeta.color : 'var(--accent)';

  // Per-anchor totals across every workplace ZIP. Used by the rankings card
  // and the headline "% of region" denominator. Recomputed only when the
  // active sector OR the county filter changes — the latter narrows the
  // anchor universe.
  const anchorRows = useMemo(() => {
    const rows: { zip: string; place: string; value: number }[] = [];
    for (const z of zips) {
      if (!z.isAnchor) continue;
      if (!isAnchorInCounty(z.zip, industryCounty)) continue;
      const entry = wacFile.entries.find((e) => e.zip === z.zip);
      if (!entry) continue;
      const v =
        industrySector === 'all'
          ? sumNaics20(entry.latest.naics20)
          : entry.latest.naics20[industrySector] ?? 0;
      rows.push({ zip: z.zip, place: z.place || z.zip, value: v });
    }
    rows.sort((a, b) => b.value - a.value);
    return rows;
  }, [zips, wacFile, industrySector, industryCounty]);

  const regionTotal = useMemo(
    () => anchorRows.reduce((s, r) => s + r.value, 0),
    [anchorRows],
  );

  // Active scope (aggregate vs. one anchor).
  const scope: ScopeData = useMemo(() => {
    if (selectedZip) {
      const entry = wacFile.entries.find((e) => e.zip === selectedZip);
      const label =
        zips.find((z) => z.zip === selectedZip)?.place ?? selectedZip;
      if (!entry) {
        return {
          label,
          totalJobs: 0,
          naics20: blankNaics(),
          trendForSector: [],
          trendForTotal: [],
        };
      }
      return {
        label,
        totalJobs: entry.latest.totalJobs,
        naics20: entry.latest.naics20,
        trendForSector:
          industrySector === 'all'
            ? entry.trend.totalJobs ?? []
            : entry.trend[industrySector] ?? [],
        trendForTotal: entry.trend.totalJobs ?? [],
      };
    }
    const agg = wacFile.aggregate.latest;
    return {
      label: `Region · ${anchorRows.length} workplace anchors`,
      totalJobs: agg?.totalJobs ?? 0,
      naics20: agg?.naics20 ?? blankNaics(),
      trendForSector:
        industrySector === 'all'
          ? wacFile.aggregate.trend.totalJobs ?? []
          : wacFile.aggregate.trend[industrySector] ?? [],
      trendForTotal: wacFile.aggregate.trend.totalJobs ?? [],
    };
  }, [selectedZip, wacFile, zips, industrySector, anchorRows.length]);

  const sectorValueInScope =
    industrySector === 'all'
      ? scope.totalJobs
      : scope.naics20[industrySector] ?? 0;

  // Top sector at the active scope — the largest NAICS-20 bucket within the
  // selected anchor (or region). Independent from `industrySector`; this is a
  // descriptive headline, not a filter.
  const topSector = useMemo(() => {
    let best: { key: Naics20Key; label: string; value: number } | null = null;
    for (const s of NAICS20_SECTORS) {
      const v = scope.naics20[s.key];
      if (best == null || v > best.value) {
        best = { key: s.key, label: s.shortLabel, value: v };
      }
    }
    return best;
  }, [scope.naics20]);

  const headlinePctOfScope =
    scope.totalJobs > 0 ? sectorValueInScope / scope.totalJobs : null;
  const headlinePctOfRegion =
    regionTotal > 0 && industrySector !== 'all'
      ? sectorValueInScope / regionTotal
      : null;

  return (
    <div className="px-3 flex flex-col gap-2">
      <div
        className="grid grid-cols-1 md:grid-cols-3 gap-3"
        style={{ height: INDUSTRY_STRIP_CARD_HEIGHT }}
      >
        {/* Overview card */}
        <div
          className="glass rounded-md p-3 flex flex-col gap-2 min-w-0 min-h-0 overflow-hidden"
          style={{ borderColor: sectorMeta ? sectorColor : undefined }}
        >
          <div className="flex items-baseline justify-between gap-2">
            <div
              className="text-[10px] font-semibold uppercase tracking-wider truncate"
              style={{ color: sectorMeta ? sectorColor : 'var(--text-h)' }}
              title={scope.label}
            >
              {scope.label}
            </div>
            <div
              className="text-[9px] tracking-wider"
              style={{ color: 'var(--text-dim)' }}
            >
              {industrySector === 'all' ? 'all sectors' : 'sector'}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 flex-1 min-h-0">
            <SubjectKpiCard
              label={sectorMeta ? sectorMeta.shortLabel : 'Total jobs'}
              value={fmtInt(sectorValueInScope)}
              sublabel={
                headlinePctOfScope != null && industrySector !== 'all'
                  ? `${(headlinePctOfScope * 100).toFixed(1)}% of scope jobs`
                  : 'workplace jobs (latest)'
              }
              active={!!sectorMeta}
            />
            <SubjectKpiCard
              label="Top sector"
              value={topSector ? topSector.label : '—'}
              sublabel={topSector ? `${fmtInt(topSector.value)} jobs` : undefined}
            />
            <SubjectKpiCard
              label="All-sector total"
              value={fmtInt(scope.totalJobs)}
              size="sm"
            />
            <SubjectKpiCard
              label={industrySector === 'all' ? 'Sectors covered' : '% of region'}
              value={
                industrySector === 'all'
                  ? `${NAICS20_SECTORS.length}`
                  : headlinePctOfRegion != null
                  ? `${(headlinePctOfRegion * 100).toFixed(1)}%`
                  : '—'
              }
              size="sm"
            />
          </div>
        </div>

        {/* Trend card */}
        <div className="glass rounded-md p-3 flex flex-col gap-2 min-w-0 min-h-0 overflow-hidden">
          <div className="flex items-baseline justify-between gap-2">
            <div
              className="text-[10px] font-semibold uppercase tracking-wider truncate"
              style={{ color: 'var(--text-h)' }}
            >
              {sectorMeta
                ? `${sectorMeta.shortLabel} trend`
                : 'Total jobs trend'}
            </div>
            <div
              className="text-[9px] tracking-wider truncate"
              style={{ color: 'var(--text-dim)' }}
            >
              {scope.trendForSector.length > 0
                ? `${scope.trendForSector[0].year}–${scope.trendForSector[scope.trendForSector.length - 1].year}`
                : '—'}
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <MiniTrendChart
              data={scope.trendForSector.map((p) => ({
                year: p.year,
                value: p.value,
              }))}
              color={sectorColor}
              height="fill"
              yMin="zero"
            />
          </div>
        </div>

        {/* Rankings card — anchors ranked by jobs in the active sector
            (or by total jobs when sector is 'all'). Click a row to focus the
            anchor on the map; click a sector chip in the left panel to swap
            the metric. */}
        <div className="glass rounded-md p-3 flex flex-col gap-2 min-w-0 min-h-0 overflow-hidden">
          <div
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-h)' }}
          >
            Anchors by {sectorMeta ? sectorMeta.shortLabel.toLowerCase() : 'total jobs'}
          </div>
          <ul className="flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto">
            {anchorRows.map((row) => {
              const max = anchorRows[0]?.value ?? 1;
              const pct = max > 0 ? row.value / max : 0;
              const sharePct = regionTotal > 0 ? row.value / regionTotal : 0;
              const active = selectedZip === row.zip;
              return (
                <li key={row.zip}>
                  <button
                    type="button"
                    onClick={() => onSelectZip(active ? null : row.zip)}
                    className="w-full text-left flex items-center gap-2 px-1 py-1 rounded transition-colors"
                    style={{
                      background: active ? `${sectorColor}29` : 'transparent',
                    }}
                  >
                    <span
                      className="text-[10px] truncate w-[90px] shrink-0"
                      style={{ color: active ? sectorColor : 'var(--text-h)' }}
                      title={row.place}
                    >
                      {row.place}
                    </span>
                    <span
                      className="flex-1 h-2 rounded-full overflow-hidden"
                      style={{ background: 'rgba(255,255,255,0.05)' }}
                    >
                      <span
                        className="block h-full"
                        style={{
                          width: `${pct * 100}%`,
                          background: sectorColor,
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
                      {fmtPct(sharePct)}
                    </span>
                  </button>
                </li>
              );
            })}
            {/* Helper hint pointing the user at the chip row in the left panel
                when sector is the dimension they want to vary. */}
            {industrySector === 'all' && (
              <li
                className="text-[9px] italic mt-1"
                style={{ color: 'var(--text-dim)' }}
              >
                Use the Sector chips in the left panel to filter by industry.
              </li>
            )}
            {industrySector !== 'all' && (
              <li className="mt-1">
                <button
                  type="button"
                  onClick={() => onIndustrySectorChange('all')}
                  className="text-[10px] underline-offset-2 hover:underline"
                  style={{ color: 'var(--accent)' }}
                >
                  Clear sector filter
                </button>
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

function blankNaics(): Naics20Block {
  return Object.fromEntries(NAICS20_SECTORS.map((s) => [s.key, 0])) as Naics20Block;
}
