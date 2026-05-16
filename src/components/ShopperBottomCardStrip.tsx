// ShopperBottomCardStrip — bottom-row layout for the Activity map's
// Shoppers metric. Renders TWO sibling absolute-positioned elements that
// the caller drops inside the map area's relative container:
//
//   1. A floating "Category Rankings" right-rail card that sits ABOVE the
//      bottom strip's third column — mirrors the Workforce map's
//      IndustrySectorRankingsCard placement so the user can read category
//      shares without scrolling.
//   2. A 3-column bottom strip:
//        · KPI card (Total Trips, Top Category, Avg/Day, Avg/Resident) —
//          shared SubjectKpiCard tiles inside a 2×2 grid.
//        · Category Pie card (trips per group category) — donut + legend.
//        · Top Destinations (place rankings, click-to-filter).
//
// The strip's grid is fixed-height (STRIP_CARD_HEIGHT) so the floating
// card can compute its bottom offset by stacking that height + the strip
// padding gap.

import { useMemo } from 'react';
import { arc as d3Arc, pie as d3Pie } from 'd3-shape';
import { SubjectKpiCard } from './maps/SubjectKpiCard';
import { fmtInt, fmtPct } from '../lib/format';
import { RAMPS } from '../lib/subjectColorRamps';
import type { FlowRow, ZipMeta } from '../types/flow';

const STRIP_CARD_HEIGHT = 220;
// Category Rankings sits as a floating right-rail card above the bottom
// strip. Taller than STRIP_CARD_HEIGHT so all ~11 group categories fit
// without scrolling.
const CATEGORY_RANKINGS_HEIGHT = 320;

interface PartnerSelection {
  place: string;
  zips: string[];
}

interface Props {
  // Anchor-scoped flows for the active resident anchor (or all anchors when
  // none selected). Already filtered by visitor-type / direction by the
  // parent; this strip computes its own per-category and per-place rollups
  // off this dataset.
  flows: FlowRow[];
  // Selected resident anchor — drives the headline scope on each card.
  selectedZip: string | null;
  // Place label of the selected resident anchor.
  scope: string;
  // Selected category filter (group category string) — controls the
  // active row in CategoryRankings. null = no category filter.
  selectedCategory: string | null;
  onSelectCategory: (next: string | null) => void;
  // Selected destination partners (Rifle, Aspen, …) — multi-select set
  // keyed by place name. When non-empty, the cards + map narrow to flows
  // that touch any of the selected places.
  selectedPartners: PartnerSelection[];
  onSelectPartners: (next: PartnerSelection[]) => void;
  // ZipMeta lookup for place names.
  zips: ZipMeta[];
  placerYear: number;
  // Mode pivot. When 'inbound' with an anchor selected, the strip swaps
  // place-ranking aggregation from destination side to origin side
  // ("who comes here to shop"). Outbound + regional → destination side
  // ("where do residents shop").
  mode: 'inbound' | 'outbound' | 'regional';
}

const DEFAULT_CATEGORY_COLORS: ReadonlyArray<string> = [
  '#c084fc', // purple-400 (accent base)
  '#a78bfa', // purple-300
  '#f0abfc', // pink-300
  '#fb7185', // rose-400
  '#fbbf24', // amber-400
  '#34d399', // emerald-400
  '#60a5fa', // blue-400
  '#22d3ee', // cyan-400
  '#a3e635', // lime-400
  '#f97316', // orange-500
  '#e879f9', // fuchsia-400
  '#94a3b8', // slate-400 — used for "Other"
];

function colorForCategoryIndex(i: number): string {
  return DEFAULT_CATEGORY_COLORS[i % DEFAULT_CATEGORY_COLORS.length];
}

export function ShopperBottomCardStrip({
  flows,
  selectedZip,
  scope,
  selectedCategory,
  onSelectCategory,
  selectedPartners,
  onSelectPartners,
  zips,
  placerYear,
  mode,
}: Props) {
  // Pivot axis: in inbound + anchor view we rank by origin (which resident
  // anchors visit this place); otherwise rank by destination (the
  // canonical "Top Destinations" view).
  const placeAxis: 'origin' | 'dest' =
    selectedZip && mode === 'inbound' ? 'origin' : 'dest';
  const placeRankingsTitle =
    placeAxis === 'origin' ? 'Top Visiting Places' : 'Top Destinations';
  // Multi-select active = at least one partner. Used to filter all four
  // cards + display the multi-select chrome.
  const selectedPartnerKeys = new Set(selectedPartners.map((p) => p.place));
  const partnerFiltered = selectedPartners.length === 0
    ? flows
    : flows.filter((f) => {
        const sidePlace = placeAxis === 'origin' ? f.originPlace : f.destPlace;
        return selectedPartnerKeys.has(sidePlace ?? '');
      });
  const zipPlaces = useMemo(() => {
    const m = new Map<string, string>();
    for (const z of zips) m.set(z.zip, z.place);
    return m;
  }, [zips]);

  // ---- Aggregates --------------------------------------------------------
  // KPI / Pie / Category Rankings honor the multi-select partner filter
  // so the headline KPIs and category breakdowns narrow to the selected
  // destinations. Place Rankings reads off the un-filtered `flows` so
  // the full list of clickable destinations remains visible (the user
  // toggles selections by clicking rows).
  const totalVisits = useMemo(
    () => partnerFiltered.reduce((s, f) => s + f.workerCount, 0),
    [partnerFiltered],
  );
  const totalResidents = useMemo(
    () => partnerFiltered.reduce((s, f) => s + (f.residents ?? 0), 0),
    [partnerFiltered],
  );

  const categoryRows = useMemo(() => {
    const agg = new Map<string, number>();
    for (const f of partnerFiltered) {
      const cat = f.category || 'Other';
      agg.set(cat, (agg.get(cat) ?? 0) + f.workerCount);
    }
    const rows = Array.from(agg.entries()).map(([category, value]) => ({
      category,
      value,
      color: colorForCategoryIndex(hashCategory(category)),
    }));
    rows.sort((a, b) => b.value - a.value);
    return rows;
  }, [partnerFiltered]);

  const topCategory = categoryRows[0]?.category ?? '—';
  const topCategoryShare =
    categoryRows[0] && totalVisits > 0
      ? categoryRows[0].value / totalVisits
      : 0;

  // Place rankings — aggregate on the configured axis (origin/dest) and
  // read from the un-filtered `flows` so multi-select toggle stays
  // interactive even when partners are active.
  const placeRows = useMemo(() => {
    type Agg = { place: string; zips: string[]; value: number };
    const byPlace = new Map<string, Agg>();
    for (const f of flows) {
      const side = placeAxis === 'origin' ? f.originZip : f.destZip;
      const sidePlace =
        placeAxis === 'origin'
          ? (zipPlaces.get(f.originZip) ?? f.originPlace ?? f.originZip)
          : (zipPlaces.get(f.destZip) ?? f.destPlace ?? f.destZip);
      const existing = byPlace.get(sidePlace);
      if (existing) {
        existing.value += f.workerCount;
        if (!existing.zips.includes(side)) existing.zips.push(side);
      } else {
        byPlace.set(sidePlace, {
          place: sidePlace,
          zips: [side],
          value: f.workerCount,
        });
      }
    }
    const rows = Array.from(byPlace.values());
    rows.sort((a, b) => b.value - a.value);
    return rows;
  }, [flows, zipPlaces, placeAxis]);

  const avgPerDay = totalVisits / 365;
  const avgPerResident = totalResidents > 0 ? totalVisits / totalResidents : 0;

  return (
    <>
      {/* Floating Category Rankings — sits in the bottom-right of the
          map area, directly above the Top Destinations card. Same width
          as one strip column ((100% - 2×outer-padding − 2×inter-card-gap)/3)
          and the same fixed height as the strip cards, so the two cards
          stack as a tidy right-rail without dominating the map. Hidden
          on mobile where the strip already stacks vertically. */}
      <div
        className="absolute z-20 pointer-events-auto hidden md:block"
        style={{
          // Bottom strip occupies 12 (paddingBottom) + STRIP_CARD_HEIGHT;
          // park this card immediately above with another 12px gap.
          bottom: STRIP_CARD_HEIGHT + 12 + 12,
          right: 12,
          height: CATEGORY_RANKINGS_HEIGHT,
          width: 'calc((100% - 48px) / 3)',
        }}
      >
        <CategoryRankings
          rows={categoryRows}
          total={totalVisits}
          selectedCategory={selectedCategory}
          onSelectCategory={onSelectCategory}
        />
      </div>

      {/* Bottom strip — three equal-width cards docked at the bottom of
          the map area. The third column is just the Place Rankings now;
          the Category Rankings live in the floating card above. */}
      <div
        className="absolute left-0 right-0 bottom-0 z-20 pointer-events-auto"
        style={{ paddingBottom: 12 }}
      >
        <div className="px-3 flex flex-col gap-2">
          <div
            className="grid grid-cols-1 md:grid-cols-3 gap-3"
            style={{ height: STRIP_CARD_HEIGHT }}
          >
            <ShopperKpis
              scope={scope}
              totalVisits={totalVisits}
              topCategory={topCategory}
              topCategoryShare={topCategoryShare}
              avgPerDay={avgPerDay}
              avgPerResident={avgPerResident}
              totalResidents={totalResidents}
            />
            <CategoryPieCard
              rows={categoryRows}
              total={totalVisits}
              scope={scope}
              placerYear={placerYear}
              selectedCategory={selectedCategory}
              onSelectCategory={onSelectCategory}
            />
            <PlaceRankings
              rows={placeRows}
              total={totalVisits}
              scope={scope}
              title={placeRankingsTitle}
              selectedPartners={selectedPartners}
              onSelectPartners={onSelectPartners}
            />
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shopping KPIs — header + 2×2 grid of SubjectKpiCard tiles.
// Mirrors the Demographics RegionKpis pattern so the chrome reads
// consistently with the other subject maps.
// ---------------------------------------------------------------------------
function ShopperKpis({
  scope,
  totalVisits,
  topCategory,
  topCategoryShare,
  avgPerDay,
  avgPerResident,
  totalResidents,
}: {
  scope: string;
  totalVisits: number;
  topCategory: string;
  topCategoryShare: number;
  avgPerDay: number;
  avgPerResident: number;
  totalResidents: number;
}) {
  return (
    <div className="glass rounded-md p-3 flex flex-col gap-2 min-w-0 min-h-0 overflow-hidden">
      <div className="flex items-baseline justify-between">
        <div
          className="text-[10px] font-semibold uppercase tracking-wider truncate"
          style={{ color: 'var(--text-h)' }}
        >
          {scope} · Shopping KPIs
        </div>
        <div
          className="text-[9px] tracking-wider"
          style={{ color: 'var(--text-dim)' }}
        >
          aggregate
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 flex-1 min-h-0">
        <SubjectKpiCard
          label="Total Shopping Trips"
          value={fmtInt(totalVisits)}
          sublabel="annual visits"
          size="md"
        />
        <SubjectKpiCard
          label="Top Category"
          value={topCategory}
          sublabel={
            topCategoryShare > 0
              ? `${fmtPct(topCategoryShare)} of trips`
              : undefined
          }
          size="sm"
        />
        <SubjectKpiCard
          label="Avg. Trips / Day"
          value={fmtInt(avgPerDay)}
          sublabel="annual ÷ 365"
          size="sm"
        />
        <SubjectKpiCard
          label="Avg. Trips / Resident"
          value={avgPerResident > 0 ? avgPerResident.toFixed(1) : '—'}
          sublabel={
            totalResidents > 0
              ? `${fmtInt(totalResidents)} residents`
              : 'no resident count'
          }
          size="sm"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category Pie — donut + side legend. No center text per design feedback;
// the chart reads as a proportional ring with category labels alongside.
// ---------------------------------------------------------------------------
function CategoryPieCard({
  rows,
  total,
  scope,
  placerYear,
  selectedCategory,
  onSelectCategory,
}: {
  rows: ReadonlyArray<{ category: string; value: number; color: string }>;
  total: number;
  scope: string;
  placerYear: number;
  selectedCategory: string | null;
  onSelectCategory: (next: string | null) => void;
}) {
  const size = 130;
  const radius = size / 2;
  const innerRadius = radius * 0.58;

  const arcGen = useMemo(
    () => d3Arc<{ startAngle: number; endAngle: number }>()
      .innerRadius(innerRadius)
      .outerRadius(radius)
      .padAngle(0.01)
      .cornerRadius(2),
    [innerRadius, radius],
  );
  const pieGen = useMemo(
    () => d3Pie<{ category: string; value: number; color: string }>()
      .value((d) => d.value)
      .sort(null),
    [],
  );
  const arcs = useMemo(() => pieGen(rows.filter((r) => r.value > 0)), [pieGen, rows]);

  return (
    <div className="glass rounded-md p-3 flex flex-col gap-2 min-w-0 min-h-0 overflow-hidden">
      <div className="flex items-baseline justify-between gap-2">
        <div
          className="text-[10px] font-semibold uppercase tracking-wider truncate"
          style={{ color: 'var(--text-h)' }}
        >
          Trips by Category
        </div>
        <div
          className="text-[9px] tracking-wider truncate"
          style={{ color: 'var(--text-dim)' }}
        >
          {scope} · Placer {placerYear}
        </div>
      </div>
      <div className="flex items-center gap-3 flex-1 min-h-0">
        <svg
          width={size}
          height={size}
          viewBox={`${-radius} ${-radius} ${size} ${size}`}
          role="img"
          aria-label="Trips by category donut chart"
          className="shrink-0"
        >
          {arcs.map((a) => {
            const cat = a.data.category;
            const d = arcGen({ startAngle: a.startAngle, endAngle: a.endAngle });
            if (!d) return null;
            const active = selectedCategory === cat;
            const dim = selectedCategory != null && !active;
            return (
              <path
                key={cat}
                d={d}
                fill={a.data.color}
                fillOpacity={dim ? 0.25 : active ? 1 : 0.85}
                stroke="rgba(0,0,0,0.25)"
                strokeWidth={0.5}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelectCategory(active ? null : cat)}
              >
                <title>{`${cat}: ${fmtInt(a.data.value)} trips (${fmtPct(a.data.value / Math.max(total, 1))})`}</title>
              </path>
            );
          })}
        </svg>
        <ul className="flex-1 min-w-0 overflow-y-auto flex flex-col gap-0.5">
          {rows.slice(0, 8).map((r) => {
            const active = selectedCategory === r.category;
            return (
              <li key={r.category}>
                <button
                  type="button"
                  onClick={() => onSelectCategory(active ? null : r.category)}
                  className="w-full text-left flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-white/[0.04]"
                  style={{ background: active ? `${r.color}26` : 'transparent' }}
                >
                  <span
                    aria-hidden="true"
                    className="shrink-0 block"
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: r.color,
                    }}
                  />
                  <span
                    className="text-[10px] truncate flex-1 min-w-0"
                    style={{ color: active ? r.color : 'var(--text-h)' }}
                  >
                    {r.category}
                  </span>
                  <span
                    className="text-[10px] tabular-nums shrink-0"
                    style={{ color: 'var(--text-dim)' }}
                  >
                    {fmtPct(r.value / Math.max(total, 1))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category Rankings — compact rollup card (top of right column). Mirrors
// the Workforce map's IndustrySectorRankingsCard visual + interaction
// language: row click toggles the filter on/off.
// ---------------------------------------------------------------------------
function CategoryRankings({
  rows,
  total,
  selectedCategory,
  onSelectCategory,
}: {
  rows: ReadonlyArray<{ category: string; value: number; color: string }>;
  total: number;
  selectedCategory: string | null;
  onSelectCategory: (next: string | null) => void;
}) {
  const maxValue = rows[0]?.value ?? 0;
  // `h-full` (not `flex-1`) so this card respects the wrapping
  // absolute-positioned container's fixed height — `flex-1` only fills
  // when the parent is display:flex, which the absolute wrapper isn't.
  return (
    <div className="glass rounded-md p-3 flex flex-col gap-1.5 min-w-0 min-h-0 overflow-hidden h-full">
      <div
        className="text-[10px] font-semibold uppercase tracking-wider truncate"
        style={{ color: 'var(--text-h)' }}
      >
        Category Rankings
      </div>
      <ul className="flex flex-col gap-0.5 flex-1 min-h-0 overflow-y-auto pr-0.5">
        {rows.map((row) => {
          const active = selectedCategory === row.category;
          const barPct = maxValue > 0 ? (row.value / maxValue) * 100 : 0;
          return (
            <li key={row.category}>
              <button
                type="button"
                onClick={() => onSelectCategory(active ? null : row.category)}
                className="w-full text-left flex items-center gap-2 px-1 py-0.5 rounded transition-colors hover:bg-white/[0.04]"
                style={{ background: active ? `${row.color}29` : 'transparent' }}
                aria-pressed={active}
              >
                <span
                  className="block w-1.5 h-3 rounded-sm shrink-0"
                  style={{ background: row.color }}
                  aria-hidden
                />
                <span
                  className="text-[10px] truncate flex-1 min-w-0"
                  style={{ color: active ? row.color : 'var(--text-h)' }}
                  title={row.category}
                >
                  {row.category}
                </span>
                <span
                  className="hidden lg:block h-2 rounded-full overflow-hidden shrink-0"
                  style={{ width: 36, background: 'rgba(255,255,255,0.05)' }}
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

// ---------------------------------------------------------------------------
// Place Rankings — top destinations (outbound mode) or top visiting
// places (inbound mode). Multi-select: clicking a row toggles its
// inclusion in selectedPartners; the headline / pie / category cards +
// the map narrow to the union. A "Clear (N)" button resets when ≥1
// partner is active.
// ---------------------------------------------------------------------------
function PlaceRankings({
  rows,
  total,
  scope,
  title,
  selectedPartners,
  onSelectPartners,
}: {
  rows: ReadonlyArray<{ place: string; zips: string[]; value: number }>;
  total: number;
  scope: string;
  title: string;
  selectedPartners: PartnerSelection[];
  onSelectPartners: (next: PartnerSelection[]) => void;
}) {
  const accent = RAMPS.activity.accent;
  const maxValue = rows[0]?.value ?? 0;
  const selectedKeys = new Set(selectedPartners.map((p) => p.place));
  const toggle = (row: { place: string; zips: string[] }) => {
    if (selectedKeys.has(row.place)) {
      onSelectPartners(selectedPartners.filter((p) => p.place !== row.place));
    } else {
      onSelectPartners([
        ...selectedPartners,
        { place: row.place, zips: row.zips },
      ]);
    }
  };
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
          {selectedPartners.length > 0 && (
            <button
              type="button"
              onClick={() => onSelectPartners([])}
              className="text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ color: accent }}
              title="Clear all selections"
            >
              Clear ({selectedPartners.length})
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
        {rows.slice(0, 12).map((row) => {
          const active = selectedKeys.has(row.place);
          const barPct = maxValue > 0 ? (row.value / maxValue) * 100 : 0;
          return (
            <li key={row.place}>
              <button
                type="button"
                onClick={() => toggle(row)}
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

function hashCategory(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
