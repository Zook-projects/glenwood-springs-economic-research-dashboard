// ActivityBottomCardStrip — Placer-flavored counterpart to the LODES
// BottomCardStrip rendered beneath the Activity map when an anchor is
// selected. Five cards:
//
//   1. Workforce Flows — bar chart of inflow / outflow / resident (single
//      year; Placer doesn't publish a historical series).
//   2. Workplace Metrics — reuses BottomCardStrip's WorkplaceMetricsCard
//      with Placer-derived counts (wacLatest / racLatest left null so the
//      card falls back to inflow + within for the headline).
//   3. Top inflow — partner ZIPs commuting INTO the selected anchor.
//   4. Top outflow — partner ZIPs the selected anchor's residents commute
//      TO (limited to other Placer destination anchors in v1).
//   5. Pass through traffic — derived from Placer flows whose corridor path
//      passes through the anchor (any intermediate node match). Built
//      client-side via buildPlacerPassThrough so this card reads from the
//      same dataset as the rest of the strip rather than the LODES file.
//
// Workplace Area Characteristics (Age / Wages / NAICS-3) and the workplace
// total-jobs sparkline are intentionally absent — Placer doesn't publish
// the breakdowns those cards depend on.

import { useMemo, useState } from 'react';
import {
  Card,
  PartnerList,
  PassThroughCard,
  WorkplaceMetricsCard,
} from './BottomCardStrip';
import {
  VisitorTypePieChart,
  type VisitorTypeMode,
  type VisitorPieSliceKey,
} from './VisitorTypePieChart';
import { PlaceRankingsCard } from './PlaceRankingsCard';
import type {
  CorridorFlowEntry,
  CorridorId,
  CorridorNode,
  CorridorRecord,
  DirectionFilter,
  FlowRow,
  NodeId,
  ZipMeta,
} from '../types/flow';
import type { OdPartner } from '../types/lodes';
import type { DriveDistanceMap } from '../lib/flowQueries';
import { buildPlacerPassThrough } from '../lib/placerPassThrough';
import { fmtInt, fmtPct } from '../lib/format';

interface Props {
  // null when the Activity map is in aggregate (no-anchor) view. The strip
  // still renders if it has any always-visible card to show (e.g., the
  // visitor-type pie). Anchor-specific cards (Workplace Metrics, Top
  // Inflow / Outflow, Pass Through) are gated on a non-null selectedZip.
  selectedZip: string | null;
  scope: string;                        // place label of the selected anchor (or '')
  flowsInbound: FlowRow[];              // Placer inbound, direction-filtered
  flowsOutbound: FlowRow[];             // Placer synthetic outbound, direction-filtered
  // Full Placer inbound flow set BEFORE the direction filter — drives the
  // pass-through derivation. Direction filtering inside the PassThroughCard
  // (East / West / valley) re-applies at render time against the resulting
  // pair list, so we feed it the unfiltered universe.
  placerFlowsInbound: FlowRow[];
  placerAnchors: readonly string[];
  placerYear: number;
  zips: ZipMeta[];
  corridorIndex: Map<CorridorId, CorridorRecord>;
  corridorNodes: Map<NodeId, CorridorNode>;
  flowIndex: Map<CorridorId, CorridorFlowEntry[]>;
  driveDistance: DriveDistanceMap | null;
  directionFilter: DirectionFilter;
  // Optional override for the WorkplaceMetricsCard's headline label — the
  // view feeds in "Average Daily Trips" when the daily-trips metric is
  // active. Falls through to the LODES default ("Total Workers") when
  // omitted. Visitor / shopper metrics extend with additional noun slots
  // (unitNoun, totalShareNoun, etc.) — see BottomCardStrip's
  // WorkplaceMetricsCard for the full interface.
  workplaceMetricLabels?: {
    total?: string;
    unitNoun?: string;
    totalShareNoun?: string;
    crossShareLabel?: string;
    crossShareVerb?: string;
    distanceWeighting?: string;
  };
  // Round-trip framing for the Average commute distance row. Activity map
  // sets these unconditionally so the card reads "Average roundtrip
  // commute distance · {2 × one-way}".
  workplaceCommuteDistanceMultiplier?: number;
  workplaceCommuteDistanceLabel?: string;
  // Pass-through cross-filter state, lifted to the parent so it survives
  // anchor switches.
  passThroughOrigin: { place: string; zips: string[] } | null;
  passThroughDest: { place: string; zips: string[] } | null;
  onPassThroughOriginChange: (sel: { place: string; zips: string[] } | null) => void;
  onPassThroughDestChange: (sel: { place: string; zips: string[] } | null) => void;
  // When true, suppress the leftmost 3-bar "Workforce Flows" card. The
  // Activity map's Visitors metric passes this — that card's
  // inflow/outflow/within decomposition assumes a workforce framing the
  // visitor data doesn't fit.
  hideWorkforceFlows?: boolean;
  // When true, suppress the trailing Pass-Through Traffic card. Same
  // motivation as above for the Visitors metric — pass-through-of-workers
  // is the framing the card communicates.
  hidePassThrough?: boolean;
  // When true, suppress the Top Outflow partner list. The Activity map's
  // Visitors metric passes this — visitor data only carries inbound
  // origin→anchor flows so a Top Outflow card has nothing meaningful to
  // show (the synthetic anchor↔anchor subset isn't representative).
  hideTopOutflow?: boolean;
  // Optional visitor-type pie data. When provided, renders a "Visitor Type
  // Mix" card at the head of the strip showing the Regional vs Tourist
  // split of the metric's unfiltered universe. Always visible regardless
  // of the Visitor Type chip selection so the user can see the
  // proportional mix at a glance. `unit` follows the active sub-metric
  // ("visitors" / "visits" / "avg. daily visits").
  visitorTypePieData?: {
    regional: number;
    tourist: number;
    unit?: string;
    // 4-band distance breakdown — required so the user can flip the
    // card's header toggle between "Type" (regional/tourist split) and
    // "Distance" (4 distance bands).
    distanceBands?: {
      under50: number;
      band50to100: number;
      band100to250: number;
      over250: number;
    };
  };
  // Optional subtitle overrides for the Top inflow / Top outflow cards.
  // Default: "Where workers commute from · Placer YYYY" /
  // "Where residents commute to · Placer YYYY". Visitor metric uses these
  // to swap "workers / residents" for "visitors". `placerYear` is rendered
  // in both, so callers omit the year piece.
  topInflowSubtitle?: string;
  topOutflowSubtitle?: string;
  // True when the active metric is in the Visitors category. Switches the
  // partner aggregation from per-ZIP to per-city (a big metro spans 20+
  // ZIPs and a per-ZIP partner list fragments the visitor story), and
  // unlocks the Region-view render of the Top Inflow / Place Ranking
  // cards (anchor-specific cards are otherwise gated on selectedZip).
  isVisitorCategory?: boolean;
  // Destination-anchor rows for the Place Ranking card. Computed in the
  // parent so anchor click-to-select can route through the same handler
  // the ZipSelector uses. Provided only for the Visitors metric.
  visitorPlaceRows?: ReadonlyArray<{ place: string; zips: string[]; value: number }>;
  onSelectVisitorAnchor?: (zip: string | null) => void;
  // Current visitor-type filter key — when one of the pie slice keys is
  // active the matching slice highlights and the rest dim. 'all' = no
  // filter active. Provided alongside onVisitorSliceClick so the pie
  // can drive the same filter the left-panel toggle drives.
  visitorTypeFilterKey?: VisitorPieSliceKey | null;
  onVisitorSliceClick?: (key: VisitorPieSliceKey) => void;
}

const TOP_PARTNER_LIMIT = 10;

export function ActivityBottomCardStrip({
  selectedZip,
  scope,
  flowsInbound,
  flowsOutbound,
  placerFlowsInbound,
  placerAnchors,
  placerYear,
  zips,
  corridorIndex,
  corridorNodes,
  flowIndex,
  driveDistance,
  directionFilter,
  workplaceMetricLabels,
  workplaceCommuteDistanceMultiplier,
  workplaceCommuteDistanceLabel,
  passThroughOrigin,
  passThroughDest,
  onPassThroughOriginChange,
  onPassThroughDestChange,
  hideWorkforceFlows = false,
  hidePassThrough = false,
  hideTopOutflow = false,
  topInflowSubtitle,
  topOutflowSubtitle,
  visitorTypePieData,
  isVisitorCategory = false,
  visitorPlaceRows,
  onSelectVisitorAnchor,
  visitorTypeFilterKey,
  onVisitorSliceClick,
}: Props) {
  // Local toggle state for the Visitor Type Mix card's Type / Distance
  // pivot. Type = the 2-slice Regional/Tourist view (default);
  // Distance = the 4-band breakdown (<50, 50–100, 100–250, >250 mi).
  const [visitorTypeMode, setVisitorTypeMode] =
    useState<VisitorTypeMode>('type');
  // Placer-derived pass-through traffic file. Memoized on the full inbound
  // set + corridor graph; direction filtering happens inside the card.
  const passThrough = useMemo(
    () =>
      buildPlacerPassThrough(
        placerFlowsInbound,
        corridorIndex,
        corridorNodes,
        placerAnchors,
        placerYear,
      ),
    [placerFlowsInbound, corridorIndex, corridorNodes, placerAnchors, placerYear],
  );
  // ZIP → place lookup. Reused by the partner lists + pass-through card.
  const zipPlaces = useMemo(() => {
    const m = new Map<string, string>();
    for (const z of zips) m.set(z.zip, z.place);
    return m;
  }, [zips]);

  // Headline totals for the bar chart + WorkplaceMetricsCard. Self-flow
  // (origin === dest) is the within-ZIP bucket; cross-zip rows that touch
  // the selected anchor split into inflow (dest === selectedZip) vs
  // outflow (origin === selectedZip).
  const { inflowTotal, withinTotal } = useMemo(() => {
    let inflow = 0;
    let within = 0;
    for (const f of flowsInbound) {
      if (f.destZip !== selectedZip) continue;
      if (f.originZip === f.destZip) within += f.workerCount;
      else inflow += f.workerCount;
    }
    return { inflowTotal: inflow, withinTotal: within };
  }, [flowsInbound, selectedZip]);

  const outflowTotal = useMemo(() => {
    let out = 0;
    for (const f of flowsOutbound) {
      if (f.originZip !== selectedZip) continue;
      if (f.originZip === f.destZip) continue;
      out += f.workerCount;
    }
    return out;
  }, [flowsOutbound, selectedZip]);

  // Partner lists. Compute on-the-fly from the Placer flow set since
  // Placer doesn't ship a pre-built od-summary index. Each entry mirrors
  // the LODES OdPartner shape so PartnerList renders without changes.
  // `zips` and `trend` are required by the LODES OdPartner shape; the empty
  // trend reflects Placer's single-vintage data (PartnerList ignores it
  // because we don't pass selectedPartner-trend wiring through the card).
  //
  // Visitor rollup: when isVisitorCategory is true the partner key is
  // ${originCity}, ${originState} so a Dallas metro spread across 20+ ZIPs
  // surfaces as one "Dallas, TX" row rather than fragmenting the list.
  // Rows missing a city tag fall back to per-ZIP grouping so they remain
  // visible. The Region view (selectedZip === null) for visitors rolls up
  // every inbound flow in the dataset, so Top Inflow can render before
  // an anchor is selected.
  const topInflowPartners = useMemo<OdPartner[]>(() => {
    type Agg = { key: string; place: string; workers: number; zips: Set<string> };
    const filtered = flowsInbound.filter((f) => {
      if (selectedZip) return f.destZip === selectedZip && f.originZip !== selectedZip;
      // Region view: only meaningful for visitors; other categories pass
      // selectedZip on the same call so this branch is unreachable.
      return isVisitorCategory;
    });
    const agg = new Map<string, Agg>();
    for (const f of filtered) {
      const city = isVisitorCategory ? f.originCity?.trim() : undefined;
      const state = isVisitorCategory ? f.originState?.trim() : undefined;
      const key = city
        ? state
          ? `${city}, ${state}`
          : city
        : f.originZip;
      const place = city
        ? state
          ? `${city}, ${state}`
          : city
        : zipPlaces.get(f.originZip) ?? f.originPlace;
      const existing = agg.get(key);
      if (existing) {
        existing.workers += f.workerCount;
        existing.zips.add(f.originZip);
      } else {
        agg.set(key, {
          key,
          place,
          workers: f.workerCount,
          zips: new Set([f.originZip]),
        });
      }
    }
    const rows: OdPartner[] = Array.from(agg.values()).map((a) => ({
      // PartnerList uses `zip` only for stable React keys and ALL_OTHER
      // detection — pass the aggregation key so city-rolled rows render
      // distinctly even when two cities share an originZip fallback.
      zip: a.key,
      place: a.place,
      workers: a.workers,
      zips: Array.from(a.zips),
      trend: [],
    }));
    rows.sort((a, b) => b.workers - a.workers);
    return rows.slice(0, TOP_PARTNER_LIMIT);
  }, [flowsInbound, selectedZip, zipPlaces, isVisitorCategory]);

  const topOutflowPartners = useMemo<OdPartner[]>(() => {
    const rows: OdPartner[] = flowsOutbound
      .filter((f) => f.originZip === selectedZip && f.destZip !== selectedZip)
      .map((f) => ({
        zip: f.destZip,
        place: zipPlaces.get(f.destZip) ?? f.destPlace,
        workers: f.workerCount,
        zips: [f.destZip],
        trend: [],
      }));
    rows.sort((a, b) => b.workers - a.workers);
    return rows.slice(0, TOP_PARTNER_LIMIT);
  }, [flowsOutbound, selectedZip, zipPlaces]);

  const topInflowPartner = topInflowPartners.find((p) => p.zip !== 'ALL_OTHER') ?? null;
  const topOutflowPartner = topOutflowPartners.find((p) => p.zip !== 'ALL_OTHER') ?? null;

  // Sum of all inbound visits across every anchor in the region. Used as
  // the Top Inflow denominator in the visitor Region view so each city
  // row reads as "X% of all visits to the region."
  const regionInflowTotal = useMemo(() => {
    if (!isVisitorCategory || selectedZip) return 0;
    let sum = 0;
    for (const f of flowsInbound) sum += f.workerCount;
    return sum;
  }, [flowsInbound, isVisitorCategory, selectedZip]);

  // Visitor Top Inflow / Place Ranking cards render in both Region and
  // Visit Destination views. Region view = no anchor (selectedZip null);
  // Visit Destination view = anchor selected, mode locked to inbound.
  const showVisitorRegionCards = isVisitorCategory && !selectedZip;
  const showVisitorPlaceRanking = isVisitorCategory && !!visitorPlaceRows;
  const selectedAnchorPlaces = useMemo(
    () => (selectedZip ? new Set<string>([
      // Match by the place label so highlighting works on both ZIP-keyed
      // and city-keyed rows. The visitor Place Ranking always uses
      // destPlace as the row key, so a single-membership set suffices.
      visitorPlaceRows?.find((r) => r.zips.includes(selectedZip))?.place ?? '',
    ]) : new Set<string>()),
    [selectedZip, visitorPlaceRows],
  );

  // Visitor strip stretches its cards across the map width (the cards
  // fan out evenly via `grow`). Non-visitor strips keep the legacy
  // fixed-width + horizontal-scroll layout so dashboard-style anchor
  // selection on the workforce metric stays unchanged.
  return (
    <div
      className={`flex gap-3 px-3 md:px-4 pb-3 pt-2 ${
        isVisitorCategory ? '' : 'overflow-x-auto'
      }`}
    >
      {/* Visitor-type pie — always-on card (renders even without an anchor
          selected). Placed first so the user reads the proportional mix
          before the anchor-specific cards. */}
      {visitorTypePieData && (
        <Card
          title="Visitor Type Mix"
          width={260}
          grow={isVisitorCategory}
          headerExtra={
            visitorTypePieData.distanceBands ? (
              <VisitorTypeModeToggle
                value={visitorTypeMode}
                onChange={setVisitorTypeMode}
              />
            ) : undefined
          }
        >
          <VisitorTypePieChart
            regionalValue={visitorTypePieData.regional}
            touristValue={visitorTypePieData.tourist}
            unit={visitorTypePieData.unit}
            mode={visitorTypeMode}
            distanceBands={visitorTypePieData.distanceBands}
            activeKey={visitorTypeFilterKey}
            onSliceClick={onVisitorSliceClick}
          />
        </Card>
      )}
      {/* Region-view visitor cards — render when the Visitors metric is
          active and no anchor is selected. The aggregate Top Inflow rolls
          every inbound flow up by origin city; the Place Ranking lists
          destination anchors with click-to-select. */}
      {showVisitorRegionCards && (
        <Card
          title="Region · Top inflow"
          subtitle={`${topInflowSubtitle ?? 'Where visitors to the region come from'} · Placer ${placerYear}`}
          width={260}
          grow
          maxHeight={320}
        >
          <PartnerList
            partners={topInflowPartners}
            denominator={regionInflowTotal}
            totalRow={{ label: 'Total inflow', value: regionInflowTotal }}
          />
        </Card>
      )}
      {showVisitorRegionCards && showVisitorPlaceRanking && (
        <div
          style={{ minWidth: 260, maxHeight: 320 }}
          className="flex-1 flex flex-col min-h-0"
        >
          <PlaceRankingsCard
            rows={visitorPlaceRows!}
            total={regionInflowTotal}
            scope="Region"
            title="Top Destinations"
            selectedPlaces={selectedAnchorPlaces}
            onToggleRow={(row) => {
              const targetZip = row.zips[0];
              if (!targetZip) return;
              onSelectVisitorAnchor?.(targetZip);
            }}
          />
        </div>
      )}
      {/* Anchor-specific cards — only render when an anchor is selected.
          In the visitor metric's aggregate view selectedZip is null and
          only the cards above render. */}
      {selectedZip && (
        <>
          {!hideWorkforceFlows && (
            <WorkforceFlowsCard
              scope={scope}
              inflow={inflowTotal}
              outflow={outflowTotal}
              within={withinTotal}
            />
          )}
          {!isVisitorCategory && (
            <WorkplaceMetricsCard
              scope={scope}
              selectedZip={selectedZip}
              selectedPartner={null}
              mode="inbound"
              wacLatest={null}
              racLatest={null}
              inflowLatest={{ totalJobs: inflowTotal }}
              outflowLatest={{ totalJobs: outflowTotal }}
              withinLatest={{ totalJobs: withinTotal }}
              topInflowPartner={topInflowPartner}
              topOutflowPartner={topOutflowPartner}
              flowsInbound={flowsInbound}
              flowsOutbound={flowsOutbound}
              zips={zips}
              corridorIndex={corridorIndex}
              flowIndex={flowIndex}
              driveDistance={driveDistance}
              segmentFilter={{ axis: 'all', buckets: [] }}
              metricLabels={workplaceMetricLabels}
              commuteDistanceMultiplier={workplaceCommuteDistanceMultiplier}
              commuteDistanceLabel={workplaceCommuteDistanceLabel}
            />
          )}
          <Card
            title={`${scope} · Top inflow`}
            subtitle={`${topInflowSubtitle ?? 'Where workers commute from'} · Placer ${placerYear}`}
            width={260}
            grow={isVisitorCategory}
            maxHeight={320}
          >
            <PartnerList
              partners={topInflowPartners}
              denominator={inflowTotal + withinTotal}
              withinZip={
                withinTotal > 0 ? { zip: selectedZip, workers: withinTotal } : undefined
              }
              totalRow={{ label: 'Total inflow', value: inflowTotal }}
            />
          </Card>
          {showVisitorPlaceRanking && (
            <div
              style={{ minWidth: 260, maxHeight: 320 }}
              className="flex-1 flex flex-col min-h-0"
            >
              <PlaceRankingsCard
                rows={visitorPlaceRows!}
                total={visitorPlaceRows!.reduce((s, r) => s + r.value, 0)}
                scope={scope}
                title="Top Destinations"
                selectedPlaces={selectedAnchorPlaces}
                onToggleRow={(row) => {
                  const targetZip = row.zips[0];
                  if (!targetZip) return;
                  // Click the active anchor row again → clear selection
                  // (regional view); click a different row → switch anchor.
                  if (selectedAnchorPlaces.has(row.place)) {
                    onSelectVisitorAnchor?.(null);
                  } else {
                    onSelectVisitorAnchor?.(targetZip);
                  }
                }}
              />
            </div>
          )}
          {!hideTopOutflow && (
            <Card
              title={`${scope} · Top outflow`}
              subtitle={`${topOutflowSubtitle ?? 'Where residents commute to'} · Placer ${placerYear}`}
              width={260}
              maxHeight={320}
            >
              <PartnerList
                partners={topOutflowPartners}
                denominator={outflowTotal + withinTotal}
                withinZip={
                  withinTotal > 0 ? { zip: selectedZip, workers: withinTotal } : undefined
                }
                totalRow={{ label: 'Total outflow', value: outflowTotal }}
              />
            </Card>
          )}
          {!hidePassThrough && passThrough && passThrough.byAnchor[selectedZip] && (
            <PassThroughCard
              anchorZip={selectedZip}
              anchorPlace={scope}
              passThrough={passThrough}
              zipPlaces={zipPlaces}
              zips={zips}
              directionFilter={directionFilter}
              origin={passThroughOrigin}
              dest={passThroughDest}
              onOriginChange={onPassThroughOriginChange}
              onDestChange={onPassThroughDestChange}
            />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkforceFlowsCard — 3-bar Placer replacement for CardsForOd. Visual style
// mirrors the LODES "Region · Age" AgeBarChart (wide vertical bars scaled to
// the dominant value, count label above the bar, label + percentage below).
// Bar colors come from the LODES OD card palette so this single-vintage card
// reads consistently with the historical Workforce Flows sparkline:
//   Inflow   → var(--accent) (Placer purple in this view)
//   Outflow  → var(--text-h) (white)
//   Resident → #9ca3af        (the LODES RESIDENT_COLOR constant)
// ---------------------------------------------------------------------------
interface WorkforceFlowsCardProps {
  scope: string;
  inflow: number;
  outflow: number;
  within: number;
}

function WorkforceFlowsCard({ scope, inflow, outflow, within }: WorkforceFlowsCardProps) {
  const denom = inflow + outflow + within || 1;
  const max = Math.max(inflow, outflow, within, 1);
  const bars: ReadonlyArray<{
    key: string;
    label: string;
    value: number;
    color: string;
  }> = [
    { key: 'inflow', label: 'Inflow', value: inflow, color: 'var(--accent)' },
    { key: 'outflow', label: 'Outflow', value: outflow, color: 'var(--text-h)' },
    { key: 'within', label: 'Resident', value: within, color: '#9ca3af' },
  ];
  return (
    <Card
      title={`${scope} · Workforce Flows`}
      subtitle="Placer 2025 · single vintage"
      width={260}
    >
      <div className="relative flex flex-col gap-2 flex-1 min-h-0">
        {/* Bar plot fills the remaining vertical space inside the card —
            heights scale against `max`, so the tallest value reaches the
            top of the plot regardless of card height. */}
        <div className="flex items-end justify-around gap-2 flex-1 min-h-0">
          {bars.map((b) => {
            const heightPct = (b.value / max) * 100;
            return (
              <div
                key={b.key}
                className="flex flex-col items-center justify-end flex-1 h-full gap-1"
              >
                <div className="text-[10px] tnum" style={{ color: 'var(--text-h)' }}>
                  {fmtInt(b.value)}
                </div>
                <div
                  className="w-full rounded-sm"
                  style={{
                    height: `${heightPct}%`,
                    background: b.color,
                    minHeight: 2,
                  }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex justify-around gap-2">
          {bars.map((b) => (
            <div
              key={b.key}
              className="flex-1 text-center text-[10px]"
              style={{ color: 'var(--text-dim)' }}
            >
              {b.label}
              <div className="tnum" style={{ color: 'var(--text-dim)' }}>
                {fmtPct(b.value / denom)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// VisitorTypeModeToggle — compact Type / Distance segmented control
// rendered in the Visitor Type Mix card's header (top-right). Mirrors
// the styling of the rankings sort toggle in StatsAggregated so the
// two read as the same UI primitive.
// ---------------------------------------------------------------------------
function VisitorTypeModeToggle({
  value,
  onChange,
}: {
  value: VisitorTypeMode;
  onChange: (next: VisitorTypeMode) => void;
}) {
  const options: ReadonlyArray<{ key: VisitorTypeMode; label: string }> = [
    { key: 'type', label: 'Type' },
    { key: 'distance', label: 'Distance' },
  ];
  return (
    <div
      role="tablist"
      aria-label="Visitor breakdown view"
      className="flex p-0.5 rounded-md border text-[10px]"
      style={{
        background: 'rgba(255,255,255,0.03)',
        borderColor: 'var(--panel-border)',
      }}
    >
      {options.map(({ key, label }) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(key)}
            className="px-2 py-0.5 rounded transition-colors font-medium"
            style={{
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? '#1a1207' : 'var(--text-dim)',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
