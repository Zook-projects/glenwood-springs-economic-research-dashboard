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
// Stacked horizontal bar (single row — one scope, multiple segments).
// Segments are clickable: clicking a segment selects it (toggling off when
// re-clicked). Selection drives the highlight on the trend chart below.
// ---------------------------------------------------------------------------
function StackedRow({
  segments,
  values,
  palette,
  selectedKey = null,
  onSegmentClick,
}: {
  segments: ReadonlyArray<{ key: string; label: string }>;
  values: number[];
  palette: readonly string[];
  selectedKey?: string | null;
  onSegmentClick?: (key: string) => void;
}) {
  const total = values.reduce((a, b) => a + b, 0);
  const isInteractive = !!onSegmentClick;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {segments.map((s, idx) => {
          const isSelected = selectedKey === s.key;
          const isDimmed = selectedKey != null && !isSelected;
          return (
            <span
              key={s.key}
              className="flex items-center gap-1.5 text-[10px]"
              style={{
                color: isDimmed ? 'var(--text-dim)' : 'var(--text)',
                opacity: isDimmed ? 0.55 : 1,
                fontWeight: isSelected ? 600 : 400,
              }}
            >
              <span
                className="inline-block rounded-sm"
                style={{
                  width: 10,
                  height: 10,
                  background: palette[idx % palette.length],
                  opacity: isDimmed ? 0.45 : 1,
                }}
              />
              {s.label}
            </span>
          );
        })}
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
          const segKey = segments[idx].key;
          const isSelected = selectedKey === segKey;
          const isDimmed = selectedKey != null && !isSelected;
          return (
            <div
              key={segKey}
              role={isInteractive ? 'button' : undefined}
              tabIndex={isInteractive ? 0 : undefined}
              aria-pressed={isInteractive ? isSelected : undefined}
              aria-label={
                isInteractive
                  ? `${segments[idx].label}: ${fmtInt(v)} (${pct.toFixed(1)}%)`
                  : undefined
              }
              onClick={
                isInteractive ? () => onSegmentClick(segKey) : undefined
              }
              onKeyDown={
                isInteractive
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSegmentClick(segKey);
                      }
                    }
                  : undefined
              }
              style={{
                width: `${pct}%`,
                background: palette[idx % palette.length],
                opacity: isDimmed ? 0.35 : 0.92,
                cursor: isInteractive ? 'pointer' : undefined,
                outline: isSelected
                  ? '2px solid rgba(255,255,255,0.55)'
                  : 'none',
                outlineOffset: isSelected ? -2 : 0,
                transition: 'opacity 120ms ease-out',
              }}
            />
          );
        })}
      </div>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-x-3 gap-y-1">
        {values.map((v, idx) => {
          const pct = total > 0 ? v / total : 0;
          const segKey = segments[idx].key;
          const isSelected = selectedKey === segKey;
          const isDimmed = selectedKey != null && !isSelected;
          return (
            <div
              key={segKey}
              className="flex flex-col"
              style={{ opacity: isDimmed ? 0.55 : 1 }}
            >
              <span
                className="text-[10px] uppercase tracking-wider"
                style={{
                  color: 'var(--text-dim)',
                  fontWeight: isSelected ? 600 : 400,
                }}
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
// Jobs by NAICS-20 — sorted horizontal bars (Latest) or small-multiples
// trend sparklines (Trend).
// ---------------------------------------------------------------------------
function NaicsBarChart({
  naics20,
  onSelectSector,
}: {
  naics20: Naics20Block;
  // Click handler — set in the parent so a click swaps the chart over to
  // the 22-year trend view with only that industry's series visible.
  onSelectSector?: (key: Naics20Key) => void;
}) {
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
        const clickable = !!onSelectSector;
        return (
          <button
            key={sector.key}
            type="button"
            disabled={!clickable}
            onClick={() => onSelectSector?.(sector.key)}
            className="grid items-center gap-2 w-full text-left rounded-sm transition-colors focus:outline-none focus-visible:ring-1"
            style={{
              gridTemplateColumns: '128px 1fr 96px',
              cursor: clickable ? 'pointer' : 'default',
              background: 'transparent',
              padding: '2px 4px',
            }}
            title={clickable
              ? `${sector.label}: ${fmtInt(value)} jobs (${fmtPct(share)}) — click to open 22-yr trend`
              : `${sector.label}: ${fmtInt(value)} jobs (${fmtPct(share)})`}
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
          </button>
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

// NAICS trend — single multi-line chart with a chip-row selector. The
// `visible` state is owned by the parent so the latest-view bar chart can
// drive single-select transitions (click a bar → swap to Trend view with
// only that industry's series). Chip-row clicks single-select to the new
// industry; re-clicking the currently-active solo industry restores the
// default top-5 view per spec.
function NaicsTrendChart({
  trend,
  latest,
  visible,
  setVisible,
}: {
  trend: RacWacTrend;
  latest: Naics20Block;
  visible: Set<Naics20Key>;
  setVisible: (next: Set<Naics20Key>) => void;
}) {
  const visibleArr = useMemo(() => Array.from(visible), [visible]);

  const toggleSector = (key: Naics20Key) => {
    // Re-clicking the lone active sector restores the top-5 default so the
    // user has a one-click path back to the overview. Otherwise the click
    // narrows to that single sector.
    if (visible.size === 1 && visible.has(key)) {
      setVisible(defaultVisibleKeys(latest));
      return;
    }
    setVisible(new Set([key]));
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
  // Visible NAICS-20 sectors in the trend chart. Lifted from
  // NaicsTrendChart so the latest-view bar chart can drive the
  // "click an industry → open the 22-year trend with only that industry"
  // affordance. Seed lazily once the scope's latest block is available.
  const [naicsVisible, setNaicsVisible] = useState<Set<Naics20Key> | null>(null);
  // Click-to-highlight state for the Age and Earnings sub-sections. Clicking
  // a segment in the stacked bar sets the matching key here; clicking the
  // same segment again clears it. The selected key drives both the bar's
  // selected/dimmed styling and the trend chart's `highlightedKey`.
  const [ageSelected, setAgeSelected] = useState<string | null>(null);
  const [wageSelected, setWageSelected] = useState<string | null>(null);
  const toggleAge = (key: string) =>
    setAgeSelected((prev) => (prev === key ? null : key));
  const toggleWage = (key: string) =>
    setWageSelected((prev) => (prev === key ? null : key));

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
          <NaicsBarChart
            naics20={latest.naics20}
            onSelectSector={(key) => {
              // Single-industry trend view: narrow `visible` to that one
              // sector and swap the chart over to the 22-year trend.
              setNaicsVisible(new Set([key]));
              setNaicsView('trend');
            }}
          />
        ) : (
          <NaicsTrendChart
            trend={trend}
            latest={latest.naics20}
            visible={naicsVisible ?? defaultVisibleKeys(latest.naics20)}
            setVisible={setNaicsVisible}
          />
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
              selectedKey={ageSelected}
              onSegmentClick={toggleAge}
            />
            {/* Fixed height matches prior TrendLines visual envelope */}
            <div style={{ height: 160 }}>
              <MiniTrendChart
                series={[
                  { key: 'u29', label: 'Under 30', color: AGE_PALETTE[0], points: (trend.ageU29 ?? []) as TrendPoint[] },
                  { key: 'age30to54', label: '30–54', color: AGE_PALETTE[1], points: (trend.age30to54 ?? []) as TrendPoint[] },
                  { key: 'age55plus', label: '55+', color: AGE_PALETTE[2], points: (trend.age55plus ?? []) as TrendPoint[] },
                ]}
                height="fill"
                yMin="zero"
                valueFormat={(v) => fmtInt(v)}
                highlightedKey={ageSelected}
              />
            </div>
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
              selectedKey={wageSelected}
              onSegmentClick={toggleWage}
            />
            <div style={{ height: 160 }}>
              <MiniTrendChart
                series={[
                  { key: 'low', label: 'Low', color: WAGE_PALETTE[0], points: (trend.wageLow ?? []) as TrendPoint[] },
                  { key: 'mid', label: 'Mid', color: WAGE_PALETTE[1], points: (trend.wageMid ?? []) as TrendPoint[] },
                  { key: 'high', label: 'High', color: WAGE_PALETTE[2], points: (trend.wageHigh ?? []) as TrendPoint[] },
                ]}
                height="fill"
                yMin="zero"
                valueFormat={(v) => fmtInt(v)}
                highlightedKey={wageSelected}
              />
            </div>
          </div>
        </ChartFrame>
      </div>

    </div>
  );
}
