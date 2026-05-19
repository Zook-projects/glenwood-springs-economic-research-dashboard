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
import { PlaceRankingsCard } from './PlaceRankingsCard';
import { fmtInt, fmtPct } from '../lib/format';
import { RAMPS } from '../lib/subjectColorRamps';
import type { FlowRow, ZipMeta } from '../types/flow';

const STRIP_CARD_HEIGHT = 260;

interface PartnerSelection {
  place: string;
  zips: string[];
}

// Top-10 property row computed in the parent (ActivityCommuteView).
// `score` is the visit count attributed to the active scope — anchor's
// contribution when a resident anchor is selected, otherwise the
// property's total visits. `totalVisits` always carries the raw total
// for hover context.
export interface TopShopperPropertyRow {
  address: string;
  property?: string | null;
  destZip: string;
  destPlace: string;
  category: string;
  score: number;
  totalVisits: number;
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
  // Multi-select set of group categories — controls the active rows in
  // CategoryRankings + Pie. Empty array = no category filter. Click-to-
  // toggle on either card adds/removes the category; a "Clear (N)"
  // chip resets the set, mirroring the Top Destinations interaction.
  selectedCategories: string[];
  onSelectCategories: (next: string[]) => void;
  // Selected destination partners (Rifle, Aspen, …) — multi-select set
  // keyed by place name. When non-empty, the cards + map narrow to flows
  // that touch any of the selected places.
  selectedPartners: PartnerSelection[];
  onSelectPartners: (next: PartnerSelection[]) => void;
  // Top 10 properties for the right-rail Property Rankings card.
  // Pre-narrowed by direction / anchor / partner / category in the
  // parent. Same-name-different-city properties retain separate rows
  // (dedup is by address).
  topProperties: TopShopperPropertyRow[];
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
  selectedCategories,
  onSelectCategories,
  selectedPartners,
  onSelectPartners,
  topProperties,
  zips,
  placerYear,
  mode,
}: Props) {
  const selectedCategoriesSet = useMemo(
    () => new Set(selectedCategories),
    [selectedCategories],
  );
  const toggleCategory = (cat: string) => {
    if (selectedCategoriesSet.has(cat)) {
      onSelectCategories(selectedCategories.filter((c) => c !== cat));
    } else {
      onSelectCategories([...selectedCategories, cat]);
    }
  };
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
  // Two layered filters drive the strip:
  //   · partnerFiltered = `flows` narrowed by the multi-select partner
  //     chips (KPIs / breakdowns narrow; Place Rankings stays interactive)
  //   · categoryFiltered = partnerFiltered narrowed by the multi-select
  //     category set (KPIs + Place Rankings narrow; Pie + Category
  //     Rankings keep showing all categories so the user can switch /
  //     add more)
  const categoryFiltered = useMemo(() => {
    if (selectedCategoriesSet.size === 0) return partnerFiltered;
    return partnerFiltered.filter(
      (f) => selectedCategoriesSet.has(f.category || 'Other'),
    );
  }, [partnerFiltered, selectedCategoriesSet]);

  // KPIs reflect both filters — total visits for the active partner +
  // category scope. Each FlowRow's `residents` field counts unique
  // residents *within* its (origin, dest, category) bucket, so summing
  // across rows double-counts (a resident who shops multiple categories
  // or destinations appears in multiple rows). The naive total inflates
  // by ~10–20× on the regional view. Below, avgPerResident is computed
  // as a visit-weighted average of per-row ratios, which sidesteps the
  // cross-row dedupe problem entirely.
  const totalVisits = useMemo(
    () => categoryFiltered.reduce((s, f) => s + f.workerCount, 0),
    [categoryFiltered],
  );
  // Universe total across the partner-filtered set — used as the
  // denominator for the pie / category-ranking percentages so a slice
  // always represents "X% of the partner-filtered total" regardless of
  // whether a category is selected.
  const partnerTotal = useMemo(
    () => partnerFiltered.reduce((s, f) => s + f.workerCount, 0),
    [partnerFiltered],
  );

  const categoryRows = useMemo(() => {
    // Breakdowns intentionally read from partnerFiltered (NOT
    // categoryFiltered) so the pie + rankings keep showing the full
    // category mix. The active category is visually highlighted via
    // selectedCategoriesSet.
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

  // Top-category tile reports the top among the SELECTED categories
  // when any are active (ranked by their breakdown value within the
  // partner-filtered universe); otherwise reports the overall top.
  // Share is always computed against the partner-filtered total so the
  // number reads as "this category accounts for X% of all shopping in
  // scope".
  const topCategoryRow = useMemo(() => {
    if (selectedCategoriesSet.size > 0) {
      const selected = categoryRows.filter((r) => selectedCategoriesSet.has(r.category));
      return selected[0] ?? null;
    }
    return categoryRows[0] ?? null;
  }, [categoryRows, selectedCategoriesSet]);
  const topCategory = topCategoryRow?.category ?? '—';
  const topCategoryShare =
    topCategoryRow && partnerTotal > 0
      ? topCategoryRow.value / partnerTotal
      : 0;

  // Place rankings — aggregate on the configured axis (origin/dest) and
  // read from the un-partner-filtered `flows` so multi-select toggle
  // stays interactive even when partners are active. Layer the
  // category multi-select on top so selecting categories narrows the
  // place counts (e.g., "Top Destinations for Food & Dining + Retail").
  const placeRows = useMemo(() => {
    const source = selectedCategoriesSet.size === 0
      ? flows
      : flows.filter((f) => selectedCategoriesSet.has(f.category || 'Other'));
    type Agg = { place: string; zips: string[]; value: number };
    const byPlace = new Map<string, Agg>();
    for (const f of source) {
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
  }, [flows, zipPlaces, placeAxis, selectedCategoriesSet]);

  const avgPerDay = totalVisits / 365;
  // Visit-weighted average of per-row (visits / residents) ratios.
  // Each row's ratio is locally honest because `residents` counts unique
  // people within that one (origin, dest, category) bucket; weighting by
  // visits keeps busier flows pulling the average more. Skip rows with
  // residents == 0 entirely so they neither inflate nor drag the result.
  const avgPerResident = useMemo(() => {
    let weightedSum = 0;
    let weightTotal = 0;
    for (const f of categoryFiltered) {
      const r = f.residents ?? 0;
      if (r <= 0) continue;
      weightedSum += (f.workerCount * f.workerCount) / r;
      weightTotal += f.workerCount;
    }
    return weightTotal > 0 ? weightedSum / weightTotal : 0;
  }, [categoryFiltered]);

  return (
    <>
      {/* Floating right-rail stack — Property Rankings sits above
          Category Rankings, both pinned above the bottom strip's
          third column. Both cards are content-sized with their own
          internal overflow:auto fallback; the outer wrapper caps the
          combined stack at 85vh so the map breathes on short screens.
          Hidden on mobile where the strip already stacks vertically. */}
      <div
        className="absolute z-20 pointer-events-auto hidden md:flex flex-col gap-2"
        style={{
          // Bottom strip occupies 12 (paddingBottom) + STRIP_CARD_HEIGHT;
          // park this stack immediately above with another 12px gap.
          bottom: STRIP_CARD_HEIGHT + 12 + 12,
          right: 12,
          maxHeight: '85vh',
          width: 'calc((100% - 48px) / 3)',
        }}
      >
        <PropertyRankings
          rows={topProperties}
          selectedZip={selectedZip}
          scope={scope}
          placerYear={placerYear}
        />
        <CategoryRankings
          rows={categoryRows}
          total={partnerTotal}
          selectedCategories={selectedCategories}
          selectedCategoriesSet={selectedCategoriesSet}
          onToggleCategory={toggleCategory}
          onClearCategories={() => onSelectCategories([])}
        />
      </div>

      {/* Bottom strip — three equal-width cards. On desktop, docked at the
          bottom of the map area via absolute positioning. On mobile, falls
          back to normal flow so it can render above the map in source order
          (the parent ActivityCommuteView reorders strip-before-map for the
          mobile vertical stack). The third column is just the Place Rankings
          now; the Category Rankings live in the floating card above. */}
      <div
        className="md:absolute md:left-0 md:right-0 md:bottom-0 md:z-20 pointer-events-auto"
        style={{ paddingBottom: 12 }}
      >
        <div className="px-3 flex flex-col gap-2">
          <div
            className="grid grid-cols-1 md:grid-cols-3 gap-3 md:h-[260px]"
          >
            <ShopperKpis
              scope={scope}
              totalVisits={totalVisits}
              topCategory={topCategory}
              topCategoryShare={topCategoryShare}
              avgPerDay={avgPerDay}
              avgPerResident={avgPerResident}
              selectedCategories={selectedCategories}
            />
            <CategoryPieCard
              rows={categoryRows}
              total={partnerTotal}
              scope={scope}
              placerYear={placerYear}
              selectedCategoriesSet={selectedCategoriesSet}
              onToggleCategory={toggleCategory}
            />
            <PlaceRankingsCard
              rows={placeRows}
              total={totalVisits}
              scope={scope}
              title={placeRankingsTitle}
              selectedPlaces={selectedPartnerKeys}
              selectedCount={selectedPartners.length}
              onClearAll={() => onSelectPartners([])}
              onToggleRow={(row) => {
                if (selectedPartnerKeys.has(row.place)) {
                  onSelectPartners(selectedPartners.filter((p) => p.place !== row.place));
                } else {
                  onSelectPartners([
                    ...selectedPartners,
                    { place: row.place, zips: row.zips },
                  ]);
                }
              }}
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
  selectedCategories,
}: {
  scope: string;
  totalVisits: number;
  topCategory: string;
  topCategoryShare: number;
  avgPerDay: number;
  avgPerResident: number;
  selectedCategories: string[];
}) {
  // Subtitle reflects the active category set: empty → aggregate;
  // single → that category's name; multiple → "N categories".
  const subtitle = selectedCategories.length === 0
    ? 'aggregate'
    : selectedCategories.length === 1
      ? selectedCategories[0]
      : `${selectedCategories.length} categories`;
  return (
    <div className="glass rounded-md p-3 flex flex-col gap-2 min-w-0 min-h-[280px] md:min-h-0 overflow-hidden">
      <div className="flex items-baseline justify-between">
        <div
          className="text-[10px] font-semibold uppercase tracking-wider truncate"
          style={{ color: 'var(--text-h)' }}
        >
          {scope} · Shopping KPIs
        </div>
        <div
          className="text-[9px] tracking-wider truncate"
          style={{ color: 'var(--text-dim)' }}
          title={selectedCategories.join(', ') || undefined}
        >
          {subtitle}
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
          sublabel={avgPerResident > 0 ? 'weighted by visits' : 'no resident count'}
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
  selectedCategoriesSet,
  onToggleCategory,
}: {
  rows: ReadonlyArray<{ category: string; value: number; color: string }>;
  total: number;
  scope: string;
  placerYear: number;
  selectedCategoriesSet: Set<string>;
  onToggleCategory: (cat: string) => void;
}) {
  const hasSelection = selectedCategoriesSet.size > 0;
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
    <div className="glass rounded-md p-3 flex flex-col gap-2 min-w-0 min-h-[280px] md:min-h-0 overflow-hidden">
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
            const active = selectedCategoriesSet.has(cat);
            const dim = hasSelection && !active;
            return (
              <path
                key={cat}
                d={d}
                fill={a.data.color}
                fillOpacity={dim ? 0.25 : active ? 1 : 0.85}
                stroke="rgba(0,0,0,0.25)"
                strokeWidth={0.5}
                style={{ cursor: 'pointer' }}
                onClick={() => onToggleCategory(cat)}
              >
                <title>{`${cat}: ${fmtInt(a.data.value)} trips (${fmtPct(a.data.value / Math.max(total, 1))})`}</title>
              </path>
            );
          })}
        </svg>
        <ul className="flex-1 min-w-0 overflow-y-auto flex flex-col gap-0.5">
          {rows.slice(0, 8).map((r) => {
            const active = selectedCategoriesSet.has(r.category);
            return (
              <li key={r.category}>
                <button
                  type="button"
                  onClick={() => onToggleCategory(r.category)}
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
// Category Rankings — compact rollup card. Multi-select via row click;
// a "Clear (N)" chip in the header resets the set. Mirrors the Top
// Destinations interaction language (PlaceRankings below) so the two
// cross-filters feel identical to a user dragging across them.
// ---------------------------------------------------------------------------
function CategoryRankings({
  rows,
  total,
  selectedCategories,
  selectedCategoriesSet,
  onToggleCategory,
  onClearCategories,
}: {
  rows: ReadonlyArray<{ category: string; value: number; color: string }>;
  total: number;
  selectedCategories: string[];
  selectedCategoriesSet: Set<string>;
  onToggleCategory: (cat: string) => void;
  onClearCategories: () => void;
}) {
  const accent = RAMPS.activity.accent;
  const maxValue = rows[0]?.value ?? 0;
  // Card sizes to its content — the absolute wrapper applies a
  // `maxHeight: 50vh` cap so unusual category counts fall back to
  // scrolling via `overflow-y-auto` on the list.
  return (
    <div className="glass rounded-md p-3 flex flex-col gap-1.5 min-w-0 min-h-[280px] md:min-h-0 overflow-hidden">
      <div className="flex items-baseline justify-between gap-2">
        <div
          className="text-[10px] font-semibold uppercase tracking-wider truncate"
          style={{ color: 'var(--text-h)' }}
        >
          Category Rankings
        </div>
        {selectedCategories.length > 0 && (
          <button
            type="button"
            onClick={onClearCategories}
            className="text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
            style={{ color: accent }}
            title="Clear all selected categories"
          >
            Clear ({selectedCategories.length})
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-0.5 overflow-y-auto pr-0.5">
        {rows.map((row) => {
          const active = selectedCategoriesSet.has(row.category);
          const barPct = maxValue > 0 ? (row.value / maxValue) * 100 : 0;
          return (
            <li key={row.category}>
              <button
                type="button"
                onClick={() => onToggleCategory(row.category)}
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
// Property Rankings — top 10 individual shopping properties by visits.
// Pre-narrowed by the parent (direction / anchor / partner / category).
// Properties with the same display name in different cities keep their
// own row (dedup is by address upstream). The card is display-only:
// clicks on properties don't toggle a filter, but the rendered scope
// reflects every active selection at a glance.
// ---------------------------------------------------------------------------
function PropertyRankings({
  rows,
  selectedZip,
  scope,
  placerYear,
}: {
  rows: ReadonlyArray<TopShopperPropertyRow>;
  selectedZip: string | null;
  scope: string;
  placerYear: number;
}) {
  const accent = RAMPS.activity.accent;
  const maxScore = rows[0]?.score ?? 0;
  // Sub-label clarifies the score's meaning. When an anchor is selected
  // the row count = "X resident's visits to that property"; otherwise
  // it's the property's universe-wide annual visits.
  const scopeBlurb = selectedZip
    ? `${scope} residents · Placer ${placerYear}`
    : `All residents · Placer ${placerYear}`;
  return (
    <div className="glass rounded-md p-3 flex flex-col gap-1.5 min-w-0 min-h-[280px] md:min-h-0 overflow-hidden">
      <div className="flex items-baseline justify-between gap-2">
        <div
          className="text-[10px] font-semibold uppercase tracking-wider truncate"
          style={{ color: 'var(--text-h)' }}
        >
          Top 10 Properties
        </div>
        <div
          className="text-[9px] tracking-wider truncate"
          style={{ color: 'var(--text-dim)' }}
          title={scopeBlurb}
        >
          {scopeBlurb}
        </div>
      </div>
      {rows.length === 0 ? (
        <div
          className="text-[10px] py-2"
          style={{ color: 'var(--text-dim)' }}
        >
          No properties match the active filters.
        </div>
      ) : (
        <ul className="flex flex-col gap-0.5 overflow-y-auto pr-0.5">
          {rows.map((row, idx) => {
            const barPct = maxScore > 0 ? (row.score / maxScore) * 100 : 0;
            const label = row.property?.trim() || row.address;
            return (
              <li key={row.address}>
                <div
                  className="w-full text-left flex items-center gap-2 px-1 py-0.5 rounded"
                  title={`${label} · ${row.address}\nCategory: ${row.category}`}
                >
                  <span
                    className="text-[10px] tabular-nums w-[14px] text-right shrink-0"
                    style={{ color: 'var(--text-dim)' }}
                    aria-hidden
                  >
                    {idx + 1}
                  </span>
                  <span className="flex-1 min-w-0 flex flex-col leading-tight">
                    <span
                      className="text-[10px] truncate"
                      style={{ color: 'var(--text-h)' }}
                    >
                      {label}
                    </span>
                    <span
                      className="text-[9px] truncate"
                      style={{ color: 'var(--text-dim)' }}
                    >
                      {row.destPlace}
                    </span>
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
                    {fmtInt(row.score)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
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
