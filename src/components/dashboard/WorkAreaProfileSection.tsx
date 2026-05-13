// WorkAreaProfileSection — workplace-area employment profile for the active
// scope (aggregate region, county subset, or single anchor). Sits in the
// Workforce dashboard section between the BottomCardStrip (3-bucket NAICS
// glanceable cards) and the FlowDataTables (OD tables).
//
// Three sub-charts:
//   1. Jobs by all 20 NAICS sectors (Latest | 22-year trend toggle)
//   2. Workers by age (latest stacked bar + 22-year trend)
//   3. Workers by earnings (latest stacked bar + 22-year trend)
//
// Scope derivation:
//   - aggregate, county === 'all'  → wacFile.aggregate
//   - aggregate, county filter set → sum wacFile.entries whose anchor matches
//   - anchor selected              → wacFile.entries.find(e.zip === selectedZip)

import { useMemo, useState } from 'react';
import { fmtInt, fmtPct } from '../../lib/format';
import { NAICS20_SECTORS, sumNaics20 } from '../../lib/naics20';
import { isAnchorInCounty } from '../../lib/flowQueries';
import type { WorkforceCountyFilter } from '../../types/flow';
import type {
  Naics20Block,
  Naics20Key,
  RacWacLatest,
  RacWacTrend,
  TrendPoint,
  WacFile,
} from '../../types/lodes';
import { ChartFrame } from './HousingMarketSection';
import { MiniTrendChart, type TrendSeries } from '../maps/MiniTrendChart';

// ---------------------------------------------------------------------------
// Palettes (mirror DemographicsSection so the dashboard reads consistently)
// ---------------------------------------------------------------------------
const AGE_PALETTE = ['#7AC4D8', '#4FB3A9', '#C8B273'];
const WAGE_PALETTE = ['#C47979', '#C8B273', '#4FB3A9'];

// ---------------------------------------------------------------------------
// Scope derivation
// ---------------------------------------------------------------------------
interface ScopeSnapshot {
  label: string;
  latest: RacWacLatest;
  trend: RacWacTrend;
}

function sumBlocks(blocks: RacWacLatest[]): RacWacLatest {
  const out: RacWacLatest = {
    totalJobs: 0,
    age: { u29: 0, age30to54: 0, age55plus: 0 },
    wage: { low: 0, mid: 0, high: 0 },
    naics3: { goods: 0, tradeTransUtil: 0, allOther: 0 },
    naics20: Object.fromEntries(
      NAICS20_SECTORS.map((s) => [s.key, 0]),
    ) as Naics20Block,
    // Race / ethnicity / education / sex fields are still required by
    // RacWacLatest but no rendered chart consumes them after the dashboard
    // workforce-section trim — leave them at zero in the synthesized
    // aggregate so the schema stays valid.
    race: { white: 0, black: 0, amInd: 0, asian: 0, nhpi: 0, twoOrMore: 0 },
    ethnicity: { notHispanic: 0, hispanic: 0 },
    education: { lessHs: 0, hs: 0, someCol: 0, bachPlus: 0 },
    sex: { male: 0, female: 0 },
  };
  for (const b of blocks) {
    out.totalJobs += b.totalJobs;
    out.age.u29 += b.age.u29;
    out.age.age30to54 += b.age.age30to54;
    out.age.age55plus += b.age.age55plus;
    out.wage.low += b.wage.low;
    out.wage.mid += b.wage.mid;
    out.wage.high += b.wage.high;
    out.naics3.goods += b.naics3.goods;
    out.naics3.tradeTransUtil += b.naics3.tradeTransUtil;
    out.naics3.allOther += b.naics3.allOther;
    for (const s of NAICS20_SECTORS) out.naics20[s.key] += b.naics20[s.key];
  }
  return out;
}

function sumTrends(trends: RacWacTrend[]): RacWacTrend {
  if (trends.length === 0) return {} as RacWacTrend;
  const dims = Object.keys(trends[0]) as (keyof RacWacTrend)[];
  const out = {} as RacWacTrend;
  for (const dim of dims) {
    const byYear = new Map<number, number>();
    for (const t of trends) {
      for (const p of t[dim] ?? []) {
        byYear.set(p.year, (byYear.get(p.year) ?? 0) + p.value);
      }
    }
    out[dim] = Array.from(byYear.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([year, value]) => ({ year, value }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stacked horizontal bar (single row — one scope, multiple segments)
// ---------------------------------------------------------------------------
function StackedRow({
  segments,
  values,
  palette,
}: {
  segments: ReadonlyArray<{ key: string; label: string }>;
  values: number[];
  palette: readonly string[];
}) {
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {segments.map((s, idx) => (
          <span
            key={s.key}
            className="flex items-center gap-1.5 text-[10px]"
            style={{ color: 'var(--text)' }}
          >
            <span
              className="inline-block rounded-sm"
              style={{ width: 10, height: 10, background: palette[idx % palette.length] }}
            />
            {s.label}
          </span>
        ))}
      </div>
      <div
        className="relative flex w-full overflow-hidden rounded-sm"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid var(--panel-border)',
          height: 28,
        }}
      >
        {values.map((v, idx) => {
          if (v <= 0 || total <= 0) return null;
          const pct = (v / total) * 100;
          return (
            <div
              key={segments[idx].key}
              title={`${segments[idx].label}: ${fmtInt(v)} (${pct.toFixed(1)}%)`}
              style={{
                width: `${pct}%`,
                background: palette[idx % palette.length],
                opacity: 0.92,
              }}
            />
          );
        })}
      </div>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-x-3 gap-y-1">
        {values.map((v, idx) => {
          const pct = total > 0 ? v / total : 0;
          return (
            <div key={segments[idx].key} className="flex flex-col">
              <span
                className="text-[10px] uppercase tracking-wider"
                style={{ color: 'var(--text-dim)' }}
              >
                {segments[idx].label}
              </span>
              <span className="text-[11px] tnum" style={{ color: 'var(--text-h)' }}>
                {fmtInt(v)} <span style={{ color: 'var(--text-dim)' }}>· {fmtPct(pct)}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-line trend chart (compact; up to 4 series)
// ---------------------------------------------------------------------------
function TrendLines({
  series,
  height = 120,
}: {
  series: ReadonlyArray<{ label: string; color: string; points: TrendPoint[] }>;
  height?: number;
}) {
  const dims = useMemo(() => {
    const allPoints = series.flatMap((s) => s.points);
    if (allPoints.length === 0) {
      return { years: [] as number[], min: 0, max: 0 };
    }
    const years = Array.from(new Set(allPoints.map((p) => p.year))).sort((a, b) => a - b);
    const min = Math.min(...allPoints.map((p) => p.value));
    const max = Math.max(...allPoints.map((p) => p.value));
    return { years, min, max };
  }, [series]);

  if (dims.years.length === 0) {
    return (
      <div
        className="text-[10px] italic flex items-center justify-center"
        style={{ height, color: 'var(--text-dim)' }}
      >
        No trend data available.
      </div>
    );
  }

  const W = 320;
  const H = height;
  const padL = 8;
  const padR = 8;
  const padT = 8;
  const padB = 16;
  const xs = (year: number) => {
    const x0 = dims.years[0];
    const x1 = dims.years[dims.years.length - 1];
    if (x0 === x1) return padL + (W - padL - padR) / 2;
    return padL + ((year - x0) / (x1 - x0)) * (W - padL - padR);
  };
  const span = Math.max(1, dims.max - dims.min);
  const ys = (value: number) => padT + (1 - (value - dims.min) / span) * (H - padT - padB);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {series.map((s) => (
          <span
            key={s.label}
            className="flex items-center gap-1.5 text-[10px]"
            style={{ color: 'var(--text)' }}
          >
            <span
              className="inline-block rounded-sm"
              style={{ width: 10, height: 2, background: s.color }}
            />
            {s.label}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        style={{ overflow: 'visible' }}
      >
        {series.map((s) => {
          if (s.points.length === 0) return null;
          const d = s.points
            .sort((a, b) => a.year - b.year)
            .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xs(p.year).toFixed(1)} ${ys(p.value).toFixed(1)}`)
            .join(' ');
          return (
            <path
              key={s.label}
              d={d}
              fill="none"
              stroke={s.color}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
        {/* Axis label — last year only */}
        <text
          x={W - padR}
          y={H - 2}
          textAnchor="end"
          fontSize={9}
          fill="var(--text-dim)"
        >
          {dims.years[dims.years.length - 1]}
        </text>
        <text
          x={padL}
          y={H - 2}
          textAnchor="start"
          fontSize={9}
          fill="var(--text-dim)"
        >
          {dims.years[0]}
        </text>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Jobs by NAICS-20 — sorted horizontal bars (Latest) or small-multiples
// trend sparklines (Trend).
// ---------------------------------------------------------------------------
function NaicsBarChart({ naics20 }: { naics20: Naics20Block }) {
  const rows = useMemo(() => {
    const sorted = NAICS20_SECTORS.map((s) => ({
      sector: s,
      value: naics20[s.key],
    })).sort((a, b) => b.value - a.value);
    const maxVal = sorted.length > 0 ? Math.max(...sorted.map((r) => r.value), 1) : 1;
    const total = sorted.reduce((a, b) => a + b.value, 0);
    return { sorted, maxVal, total };
  }, [naics20]);

  return (
    <div className="flex flex-col gap-1">
      {rows.sorted.map(({ sector, value }) => {
        const w = (value / rows.maxVal) * 100;
        const share = rows.total > 0 ? value / rows.total : 0;
        return (
          <div
            key={sector.key}
            className="grid items-center gap-2"
            style={{ gridTemplateColumns: '128px 1fr 96px' }}
            title={`${sector.label}: ${fmtInt(value)} jobs (${fmtPct(share)})`}
          >
            <div className="text-[11px] truncate" style={{ color: 'var(--text-h)' }}>
              {sector.shortLabel}
            </div>
            <div
              className="relative h-3 rounded-sm overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--panel-border)' }}
            >
              <div
                className="h-full"
                style={{
                  width: `${w}%`,
                  background: sector.color,
                  opacity: 0.9,
                }}
              />
            </div>
            <div className="text-[10px] tnum text-right" style={{ color: 'var(--text-dim)' }}>
              {fmtInt(value)} · {fmtPct(share)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Top-N seed selection — chooses the N largest sectors by latest-year jobs
// so the trend chart opens in a legible (not overcrowded) state. The user
// can toggle other sectors on via the chip row.
const DEFAULT_VISIBLE_SECTORS = 5;

function defaultVisibleKeys(latest: Naics20Block): Set<Naics20Key> {
  const ranked = NAICS20_SECTORS
    .map((s) => ({ key: s.key, value: latest[s.key] }))
    .sort((a, b) => b.value - a.value)
    .slice(0, DEFAULT_VISIBLE_SECTORS)
    .map((r) => r.key);
  return new Set(ranked);
}

// NAICS trend — single multi-line chart with a chip-row selector. Chips
// toggle individual sectors on/off; the chart redraws against the visible
// set. Tooltip + axis ticks come from MiniTrendChart.
function NaicsTrendChart({
  trend,
  latest,
}: {
  trend: RacWacTrend;
  latest: Naics20Block;
}) {
  const [visible, setVisible] = useState<Set<Naics20Key>>(() =>
    defaultVisibleKeys(latest),
  );

  // Recompute the default visible set if the scope changes underfoot
  // (e.g. user switches anchor) and the previously-selected sector no
  // longer has meaningful data. We only reseed when nothing is visible
  // to avoid clobbering user toggles mid-session.
  const visibleArr = useMemo(() => Array.from(visible), [visible]);

  const toggleSector = (key: Naics20Key) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const series: TrendSeries[] = useMemo(() => {
    return NAICS20_SECTORS
      .filter((s) => visible.has(s.key))
      .map((s) => ({
        key: s.key,
        label: s.shortLabel,
        color: s.color,
        points: (trend[s.key] ?? []) as TrendPoint[],
      }));
  }, [trend, visible]);

  return (
    <div className="flex flex-col gap-3">
      {/* Chip row — all 20 sectors. Active chips render in sector color;
          inactive chips dim out so the user can see what's available. */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="NAICS sectors">
        {NAICS20_SECTORS.map((s) => {
          const active = visible.has(s.key);
          const latestVal = latest[s.key];
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={active}
              onClick={() => toggleSector(s.key)}
              title={`${s.label} · ${fmtInt(latestVal)} jobs (latest)`}
              className="text-[10px] px-2 py-1 rounded-md border transition-colors focus:outline-none focus-visible:ring-1 flex items-center gap-1.5"
              style={{
                background: active ? `${s.color}22` : 'rgba(255,255,255,0.03)',
                color: active ? 'var(--text-h)' : 'var(--text-dim)',
                borderColor: active ? s.color : 'var(--panel-border)',
              }}
            >
              <span
                className="inline-block rounded-sm shrink-0"
                style={{
                  width: 8,
                  height: 8,
                  background: s.color,
                  opacity: active ? 1 : 0.35,
                }}
              />
              {s.shortLabel}
            </button>
          );
        })}
      </div>

      {/* Multi-line chart. Height fixed at 240 so the legend + chips don't
          jump as the user toggles series. MiniTrendChart owns the hover
          tooltip, axis ticks, gridlines, and per-series legend. */}
      <div style={{ height: 240 }}>
        {visibleArr.length === 0 ? (
          <div
            className="h-full flex items-center justify-center text-[10px] italic"
            style={{ color: 'var(--text-dim)' }}
          >
            Select one or more sectors above to plot a trend.
          </div>
        ) : (
          <MiniTrendChart
            series={series}
            height="fill"
            yMin="zero"
            valueFormat={(v) => fmtInt(v)}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------
export function WorkAreaProfileSection({
  wacFile,
  selectedZip,
  selectionKind,
  workforceCounty,
}: {
  wacFile: WacFile | null;
  selectedZip: string | null;
  selectionKind: 'aggregate' | 'anchor' | 'non-anchor';
  workforceCounty: WorkforceCountyFilter;
}) {
  const [naicsView, setNaicsView] = useState<'latest' | 'trend'>('latest');

  const scope: ScopeSnapshot | null = useMemo(() => {
    if (!wacFile) return null;
    // Anchor scope — single entry.
    if (selectionKind === 'anchor' && selectedZip) {
      const entry = wacFile.entries.find((e) => e.zip === selectedZip);
      if (!entry) return null;
      return {
        label: entry.place || entry.zip,
        latest: entry.latest,
        trend: entry.trend,
      };
    }
    // County-filtered aggregate — sum the matching anchor entries.
    if (workforceCounty !== 'all') {
      const matching = wacFile.entries.filter(
        (e) => e.zip !== 'ALL_OTHER' && isAnchorInCounty(e.zip, workforceCounty),
      );
      if (matching.length === 0) return null;
      return {
        label: `${workforceCounty} County · ${matching.length} anchors`,
        latest: sumBlocks(matching.map((e) => e.latest)),
        trend: sumTrends(matching.map((e) => e.trend)),
      };
    }
    // Full regional aggregate.
    if (!wacFile.aggregate.latest) return null;
    return {
      label: 'Region · 11 workplace anchors',
      latest: wacFile.aggregate.latest,
      trend: wacFile.aggregate.trend,
    };
  }, [wacFile, selectedZip, selectionKind, workforceCounty]);

  if (!scope) {
    return (
      <div
        className="rounded-md p-3"
        style={{ background: 'var(--panel-surface)', border: '1px solid var(--panel-border)' }}
      >
        <div
          className="text-[10px] uppercase tracking-wider"
          style={{ color: 'var(--text-dim)' }}
        >
          Work Area Profile data unavailable for this selection.
        </div>
      </div>
    );
  }

  const { latest, trend } = scope;
  const naicsTotal = sumNaics20(latest.naics20);

  return (
    <div
      className="rounded-md p-3 flex flex-col gap-4"
      style={{
        background: 'var(--panel-surface)',
        border: '1px solid var(--panel-border)',
      }}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h3
            className="text-sm font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-h)' }}
          >
            Work Area Profile
          </h3>
          <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
            LEHD LODES8 WAC · workplace-area characteristics ·{' '}
            <span style={{ color: 'var(--text-h)' }}>{scope.label}</span> ·{' '}
            {fmtInt(latest.totalJobs)} jobs (latest)
          </div>
        </div>
      </div>

      {/* Row 1 — Jobs by NAICS-20 (full width) */}
      <ChartFrame
        title="Jobs by industry (NAICS-20)"
        subtitle={`${fmtInt(naicsTotal)} jobs across 20 NAICS sectors · sorted by ${naicsView === 'latest' ? 'latest-year share' : 'NAICS code'}`}
      >
        <div className="flex justify-end mb-2">
          <div
            role="tablist"
            aria-label="NAICS chart view"
            className="inline-flex gap-0.5 p-0.5 rounded-md border"
            style={{
              background: 'rgba(255,255,255,0.03)',
              borderColor: 'var(--panel-border)',
            }}
          >
            {(['latest', 'trend'] as const).map((opt) => {
              const active = naicsView === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setNaicsView(opt)}
                  className="px-2 py-0.5 text-[10px] font-medium rounded transition-colors"
                  style={{
                    background: active ? 'var(--accent)' : 'transparent',
                    color: active ? '#1a1207' : 'var(--text-dim)',
                  }}
                >
                  {opt === 'latest' ? 'Latest' : '22-year trend'}
                </button>
              );
            })}
          </div>
        </div>
        {naicsView === 'latest' ? (
          <NaicsBarChart naics20={latest.naics20} />
        ) : (
          <NaicsTrendChart trend={trend} latest={latest.naics20} />
        )}
      </ChartFrame>

      {/* Row 2 — Age + Earnings side-by-side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChartFrame title="Workers by age" subtitle="Under 30 · 30–54 · 55+">
          <div className="flex flex-col gap-4">
            <StackedRow
              segments={[
                { key: 'u29', label: 'Under 30' },
                { key: 'age30to54', label: '30–54' },
                { key: 'age55plus', label: '55+' },
              ]}
              values={[latest.age.u29, latest.age.age30to54, latest.age.age55plus]}
              palette={AGE_PALETTE}
            />
            <TrendLines
              series={[
                { label: 'Under 30', color: AGE_PALETTE[0], points: trend.ageU29 ?? [] },
                { label: '30–54', color: AGE_PALETTE[1], points: trend.age30to54 ?? [] },
                { label: '55+', color: AGE_PALETTE[2], points: trend.age55plus ?? [] },
              ]}
            />
          </div>
        </ChartFrame>

        <ChartFrame title="Workers by earnings" subtitle="≤ $1,250/mo · $1,251–$3,333 · > $3,333">
          <div className="flex flex-col gap-4">
            <StackedRow
              segments={[
                { key: 'low', label: '≤ $1,250' },
                { key: 'mid', label: '$1,251–$3,333' },
                { key: 'high', label: '> $3,333' },
              ]}
              values={[latest.wage.low, latest.wage.mid, latest.wage.high]}
              palette={WAGE_PALETTE}
            />
            <TrendLines
              series={[
                { label: 'Low', color: WAGE_PALETTE[0], points: trend.wageLow ?? [] },
                { label: 'Mid', color: WAGE_PALETTE[1], points: trend.wageMid ?? [] },
                { label: 'High', color: WAGE_PALETTE[2], points: trend.wageHigh ?? [] },
              ]}
            />
          </div>
        </ChartFrame>
      </div>

    </div>
  );
}
