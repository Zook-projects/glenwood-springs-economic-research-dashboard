// ActivityCommuteView — Placer.ai "Employee Origins" corridor map. Slim
// parallel of CommuteView focused on the corridor + per-anchor stats
// surfaces. Block selection, segment filter, heatmap, industry layer, and
// the LODES Workforce mix bottom-card strip are intentionally absent (per
// the v1 spec) — the dataset doesn't carry the LODES segmentations those
// surfaces depend on.
//
// Data path: PlacerData.employeeCounts is projected into FlowRow[] by
// placerAdapters.toFlowRows so the downstream pipeline (MapCanvas,
// corridor index, StatsAggregated, StatsForZip) consumes it unchanged.

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapCanvas } from '../components/MapCanvas';
import { ActiveFiltersOverlay } from '../components/ActiveFiltersOverlay';
import { ZipSelector } from '../components/ZipSelector';
import { DirectionToggle } from '../components/DirectionToggle';
import { VisitorTypeToggle } from '../components/VisitorTypeToggle';
import {
  ShopperViewToggle,
  type ShopperViewLayer,
} from '../components/ShopperViewToggle';
import { ModeToggle } from '../components/ModeToggle';
import {
  ActivityMetricToggle,
  categoryOf,
  type ActivityCategory,
  type ActivityMetric,
} from '../components/ActivityMetricToggle';
import { StatsAggregated } from '../components/StatsAggregated';
import { StatsForZip } from '../components/StatsForZip';
import { CorridorTooltipBody } from '../components/CorridorTooltipBody';
import { ActivityBottomCardStrip } from '../components/ActivityBottomCardStrip';
import { ShopperBottomCardStrip } from '../components/ShopperBottomCardStrip';
import type {
  ActiveCorridorAggregation,
  ActiveOdAggregation,
  CorridorId,
  DirectionFilter,
  FlowRow,
  Mode,
} from '../types/flow';
import type { FlowData } from '../lib/useFlowData';
import type { PlacerData } from '../types/placer';
import { toFlowRows } from '../lib/placerAdapters';
import {
  applySegmentFilter,
  classifyVisitorType,
  detailForZip,
  filterByDirection,
  filterByVisitorType,
  filterForSelection,
  isAnchorZip,
  meanCommuteMiles,
  sumDistanceWeightedMiles,
  VISITOR_TYPE_REFERENCE_ZIP,
  type VisitorType,
} from '../lib/flowQueries';
import {
  buildCorridorFlowIndex,
  buildVisibleCorridorMap,
  flowIdOf,
} from '../lib/corridors';
import { computeBucketBreaks } from '../lib/arcMath';
import { fmtInt, fmtPct } from '../lib/format';
import { quintileBinPoints } from '../lib/heatmapBinning';

interface HoverState {
  corridorId: CorridorId;
  aggregation: ActiveCorridorAggregation;
  clientX: number;
  clientY: number;
}

// Off-corridor (spaghetti) tooltip state — mirrors HoverState but keyed
// to a single origin → destination ZIP pair.
interface OdHoverState {
  originZip: string;
  destZip: string;
  aggregation: ActiveOdAggregation;
  clientX: number;
  clientY: number;
}

interface Props {
  data: FlowData;       // existing LODES bundle (zips, corridor index, etc.)
  placer: PlacerData | null;
}

function clampTooltipAnchor(
  clientX: number,
  clientY: number,
  estWidth: number,
  estHeight: number,
): { left: number; top: number } {
  const margin = 12;
  const offset = 14;
  const vw =
    typeof window !== 'undefined' ? window.innerWidth : estWidth + offset * 2;
  const vh =
    typeof window !== 'undefined' ? window.innerHeight : estHeight + offset * 2;
  let left = clientX + offset;
  let top = clientY + offset;
  if (left + estWidth + margin > vw) left = clientX - offset - estWidth;
  if (top + estHeight + margin > vh) top = clientY - offset - estHeight;
  left = Math.max(margin, Math.min(left, vw - estWidth - margin));
  top = Math.max(margin, Math.min(top, vh - estHeight - margin));
  return { left, top };
}

// Drag-to-move helper for pinned tooltip panels. Returns a transform
// offset that the caller applies via style, plus a mousedown handler
// to attach to the panel's drag handle (typically the header row).
// Resets the offset when `resetKey` changes — i.e., each new pin
// starts at its default position.
function useDraggable(resetKey: string | null) {
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  useEffect(() => {
    setOffset({ x: 0, y: 0 });
  }, [resetKey]);
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Buttons inside the drag handle (e.g. close X) keep their own
    // click semantics — don't hijack them with a drag.
    if ((e.target as Element).closest('button')) return;
    e.preventDefault();
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y };
    const move = (mv: MouseEvent) => {
      if (!dragRef.current) return;
      setOffset({
        x: dragRef.current.ox + (mv.clientX - dragRef.current.sx),
        y: dragRef.current.oy + (mv.clientY - dragRef.current.sy),
      });
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return { offset, onMouseDown };
}

export function ActivityCommuteView({ data, placer }: Props) {
  // flowIndex from `data` is built from LODES flows only — it doesn't know
  // about Placer-specific OD pairs (e.g., out-of-state visitor origins
  // routed through GW_E / GW_W). We rebuild a Placer-scoped flowIndex
  // below so every Placer flow with a baked corridorPath shows up on the
  // corridor strokes rather than falling through to the dashed
  // off-corridor branches.
  const { zips, corridorIndex, corridorNodes, flowsByOdKey, driveDistance } = data;

  // Activity metric the left-panel toggle drives. Categories + sub-options:
  //   workers     → Employee Counts (raw annual workers)
  //   daily-trips → Employee Visits × 2 / 365
  //   trips       → Employee Visits × 2
  //   visitors    → Visitor Counts (raw annual visitors, no ×2)
  //   daily-visits→ Visitor Visits / 365
  //   visits      → Visitor Visits (raw)
  //   out-of-market-shopping → Resident Top Locations, visits to dest ZIP
  //                            ≠ resident's home ZIP (flow axis flipped:
  //                            origin = resident anchor, dest = leakage ZIP)
  const [metric, setMetric] = useState<ActivityMetric>('workers');
  const activeCategory: ActivityCategory = categoryOf(metric);
  const isShopperMetric = metric === 'out-of-market-shopping';

  const placerMetricFile = useMemo(() => {
    if (!placer) return null;
    switch (metric) {
      case 'workers':
        return placer.employeeCounts;
      case 'daily-trips':
      case 'trips':
        return placer.employeeVisits;
      case 'visitors':
        return placer.visitorCounts;
      case 'daily-visits':
      case 'visits':
        return placer.visitorVisits;
      case 'out-of-market-shopping':
        return placer.shoppersTopLocations;
    }
  }, [placer, metric]);

  // Stats-panel label + copy overrides used by StatsAggregated, StatsForZip,
  // and the WorkplaceMetricsCard. Re-frames "workforce" / "workers" headlines
  // as visits / trips / shoppers depending on the active metric. Every slot
  // must be overridden for non-workers metrics or the LODES default copy
  // leaks through.
  const statsMetricLabels = useMemo(() => {
    switch (metric) {
      case 'workers':
        return undefined;
      case 'daily-trips': {
        const unit = 'avg. daily trips';
        return {
          total: 'Average Daily Trips',
          inbound: 'Average Daily Inbound Trips',
          outbound: 'Average Daily Outbound Trips',
          sub: 'avg. daily trips by workers',
          descriptor: unit,
          shareUnitInbound: unit,
          shareUnitOutbound: unit,
          directionInbound: 'avg. daily trips into',
          directionOutbound: 'avg. daily trips out of',
          liveAndWorkPhrase: 'avg. daily trips within',
          vehicleMiles: {
            label: 'Average Daily Vehicle Miles',
            sub: 'avg. daily trips × one-way distance · cross-ZIP only',
          },
        };
      }
      case 'trips': {
        const unit = 'trips';
        return {
          total: 'Total Trips',
          inbound: 'Total Inbound Trips',
          outbound: 'Total Outbound Trips',
          sub: 'annual round-trips by workers',
          descriptor: unit,
          shareUnitInbound: unit,
          shareUnitOutbound: unit,
          directionInbound: 'trips into',
          directionOutbound: 'trips out of',
          liveAndWorkPhrase: 'annual round-trips within',
          vehicleMiles: {
            label: 'Total Vehicle Miles',
            sub: 'annual trips × one-way distance · cross-ZIP only',
          },
        };
      }
      case 'visitors': {
        const unit = 'visitors';
        return {
          total: 'Total Visitors',
          inbound: 'Total Inbound Visitors',
          outbound: 'Total Outbound Visitors',
          sub: 'annual unique visitors',
          descriptor: unit,
          shareUnitInbound: unit,
          shareUnitOutbound: unit,
          directionInbound: 'visitors to',
          directionOutbound: 'visitors from',
          liveAndWorkPhrase: 'visitors within',
          crossZipLabel: 'Cross-ZIP visitors',
          avgDistanceLabel: 'Average visit distance',
          distanceWeighting: 'visitor-weighted',
          rankingsTitle: 'Visitor destination rankings',
          rankingsHelp: {
            total: {
              primary: 'Total visitors at each destination = inbound + within-ZIP',
              secondary: '% of all destinations’ combined visitors',
            },
          },
          heroByAxis: {
            inbound: { label: 'Inbound Visitors', sub: 'visitors arriving from elsewhere', secondaryDescriptor: 'regional inbound visitors' },
            outbound: { label: 'Outbound Visitors', sub: 'visitors departing for elsewhere', secondaryDescriptor: 'regional outbound visitors' },
            local: { label: 'Local Visitors', sub: 'visitors whose origin and destination ZIPs match', secondaryDescriptor: 'regional local visitors' },
          },
          totalTileSub: (place: string) => `by visitors at ${place}`,
          partnerOfNoun: (place: string) => `${place} visitors`,
        };
      }
      case 'daily-visits': {
        const unit = 'avg. daily visits';
        return {
          total: 'Average Daily Visits',
          inbound: 'Average Daily Inbound Visits',
          outbound: 'Average Daily Outbound Visits',
          sub: 'avg. daily visits',
          descriptor: unit,
          shareUnitInbound: unit,
          shareUnitOutbound: unit,
          directionInbound: 'avg. daily visits to',
          directionOutbound: 'avg. daily visits from',
          liveAndWorkPhrase: 'avg. daily visits within',
          vehicleMiles: {
            label: 'Average Daily Vehicle Miles',
            sub: 'avg. daily visits × one-way distance · cross-ZIP only',
          },
          crossZipLabel: 'Cross-ZIP avg. daily visits',
          avgDistanceLabel: 'Average visit distance',
          distanceWeighting: 'visit-weighted',
          rankingsTitle: 'Visitor destination rankings',
          rankingsHelp: {
            total: {
              primary: 'Avg. daily visits at each destination = inbound + within-ZIP',
              secondary: '% of all destinations’ combined avg. daily visits',
            },
          },
          totalTileSub: (place: string) => `by avg. daily visits at ${place}`,
          partnerOfNoun: (place: string) => `${place} avg. daily visits`,
        };
      }
      case 'visits': {
        const unit = 'visits';
        return {
          total: 'Total Visits',
          inbound: 'Total Inbound Visits',
          outbound: 'Total Outbound Visits',
          sub: 'annual visit count',
          descriptor: unit,
          shareUnitInbound: unit,
          shareUnitOutbound: unit,
          directionInbound: 'visits to',
          directionOutbound: 'visits from',
          liveAndWorkPhrase: 'visits within',
          vehicleMiles: {
            label: 'Total Vehicle Miles',
            sub: 'annual visits × one-way distance · cross-ZIP only',
          },
          crossZipLabel: 'Cross-ZIP visits',
          avgDistanceLabel: 'Average visit distance',
          distanceWeighting: 'visit-weighted',
          rankingsTitle: 'Visitor destination rankings',
          rankingsHelp: {
            total: {
              primary: 'Total visits at each destination = inbound + within-ZIP',
              secondary: '% of all destinations’ combined visits',
            },
          },
          totalTileSub: (place: string) => `by total visits at ${place}`,
          partnerOfNoun: (place: string) => `${place} visits`,
        };
      }
      case 'out-of-market-shopping': {
        // Shopper data: origin = resident anchor, dest = out-of-market ZIP.
        // Direction is always outbound from the resident's perspective, but
        // the data is plumbed through flowsInbound to reuse the aggregate
        // pipeline (StatsAggregated is inbound-only by editorial choice).
        // EVERY slot needs an override so the word "workforce" / "inbound"
        // never leaks into shopper copy.
        const unit = 'out-of-market visits';
        return {
          total: 'Out-of-Market Shopping Visits',
          inbound: 'Out-of-Market Visits',
          outbound: 'Out-of-Market Visits',
          sub: 'visits by valley residents to ZIPs outside their home',
          descriptor: unit,
          shareUnitInbound: unit,
          shareUnitOutbound: unit,
          directionInbound: 'out-of-market visits from residents of',
          directionOutbound: 'out-of-market visits from residents of',
          liveAndWorkPhrase: 'out-of-market visits originating in',
          crossZipLabel: 'Cross-ZIP shopping visits',
          avgDistanceLabel: 'Average shopping trip distance',
          distanceWeighting: 'visit-weighted',
          rankingsTitle: 'Resident origin rankings',
          rankingsHelp: {
            total: {
              primary: 'Out-of-market shopping visits originating in each resident ZIP',
              secondary: '% of all resident origins’ combined out-of-market visits',
            },
          },
          heroByAxis: {
            inbound: { label: 'Out-of-Market Visits', sub: 'visits to ZIPs outside the resident’s home', secondaryDescriptor: 'regional out-of-market visits' },
            outbound: { label: 'Out-of-Market Visits', sub: 'visits to ZIPs outside the resident’s home', secondaryDescriptor: 'regional out-of-market visits' },
            local: { label: 'In-Market Visits', sub: 'visits within the resident’s own ZIP (filtered out in v1)', secondaryDescriptor: 'regional in-market visits' },
          },
          totalTileSub: (place: string) => `by out-of-market visits originating in ${place}`,
          partnerOfNoun: (place: string) => `${place} out-of-market visits`,
        };
      }
    }
  }, [metric]);

  // Adapt the chosen Placer metric into the FlowRow shape every
  // downstream surface consumes. Employee/Visitor workbooks publish one
  // direction (origin = residence, dest = anchor-workplace/anchor-visit),
  // so for those metrics flowsInbound is the canonical projection.
  // Shopper data is direction-flipped (origin = resident anchor, dest =
  // out-of-market ZIP) and is plumbed through flowsOutbound below;
  // flowsInbound returns [] for the shopper metric.
  //
  // Per-metric scaling:
  //   workers, visitors, visits, out-of-market-shopping → raw pass-through
  //   daily-trips → × 2 / 365 (round-trip × annualize daily)
  //   trips       → × 2      (annual round-trip volume)
  //   daily-visits→ / 365    (annualize daily; visits are one-way arrivals,
  //                            no ×2 — Jake's choice; matches "Visits" label)
  // Stored as floats; fmtInt rounds at display time so aggregations stay
  // precise at corridor-level rollups.
  const flowsInbound = useMemo<FlowRow[]>(() => {
    if (!placerMetricFile) return [];
    // Shopper data is single-directional in the source (origin = resident
    // anchor, dest = shopping location), but the user can read the same
    // dataset from either side: Outbound = "where do these residents
    // shop", Inbound = "who shops here from elsewhere". Pass the full
    // shopper dataset into BOTH flowsInbound and flowsOutbound; the
    // mode-aware filterForSelection downstream pivots on selectedZip ±
    // origin/dest to surface the right slice.
    if (isShopperMetric) {
      return toFlowRows(placerMetricFile, zips, flowsByOdKey);
    }
    const rows = toFlowRows(placerMetricFile, zips, flowsByOdKey);
    switch (metric) {
      case 'workers':
      case 'visitors':
      case 'visits':
        return rows;
      case 'daily-trips':
        return rows.map((r) => ({ ...r, workerCount: (r.workerCount * 2) / 365 }));
      case 'trips':
        return rows.map((r) => ({ ...r, workerCount: r.workerCount * 2 }));
      case 'daily-visits':
        return rows.map((r) => ({ ...r, workerCount: r.workerCount / 365 }));
      default:
        return rows;
    }
  }, [placerMetricFile, zips, flowsByOdKey, metric, isShopperMetric]);

  // destAnchors semantics depend on the active metric. Each metric file
  // carries its own destAnchors list, which is the right scope for the
  // ZipSelector chip row — summary.destAnchors is a union across all five
  // metric files and would incorrectly include the 11 shopper-origin ZIPs
  // when workers/visitors are active.
  //   workers / visitors → DESTINATION anchors (typically GWS 81601 +
  //     81623, depending on the workbook's destination scope).
  //   shoppers           → ORIGIN anchors (the 11 valley resident ZIPs).
  //     The selection axis flips: the chip row represents resident bases
  //     whose outbound shopping leakage you can inspect. All 11 happen to
  //     live in the global ANCHOR_ZIPS list in flowQueries.ts — load-bearing
  //     coincidence; if Placer ever publishes shopper data for a different
  //     anchor set, ZipSelector's intersection-with-ANCHOR_ZIPS filter and
  //     computeAnchorRankings will both need updates.
  const destAnchors = useMemo<readonly string[]>(
    () => placerMetricFile?.destAnchors ?? [],
    [placerMetricFile],
  );

  // Data vintage from the workbook's Year column (e.g., 2025). Used by the
  // Placer pass-through card so its subtitle matches the surrounding cards
  // ("Placer 2025"). Falls back to the lastBuilt year, then to the calendar
  // year, for legacy summary files that lack `dataYear`.
  const placerYear = useMemo<number>(() => {
    const explicit = placer?.summary.dataYear;
    if (typeof explicit === 'number' && explicit > 1900 && explicit < 3000) {
      return explicit;
    }
    const iso = placer?.summary.lastBuilt;
    if (iso) {
      const y = Number(iso.slice(0, 4));
      if (Number.isFinite(y) && y > 1900 && y < 3000) return y;
    }
    return new Date().getUTCFullYear();
  }, [placer]);

  // flowsOutbound semantics:
  //   workers / visitors → synthetic anchor-to-anchor subset. Filters
  //     flowsInbound (origin = residence, dest = anchor) down to rows where
  //     origin is itself an anchor, surfacing each Placer anchor's outbound
  //     commute count to the OTHER Placer anchor(s).
  //   shoppers           → the actual data. Resident anchor → out-of-market
  //     ZIP is the natural outbound direction for shoppers. flowsInbound
  //     is empty for this metric, so the regional/aggregate view reads
  //     from flowsOutbound and the inbound/outbound toggle is hidden.
  const flowsOutbound = useMemo<FlowRow[]>(() => {
    if (!placerMetricFile) return [];
    if (isShopperMetric) {
      const rows = toFlowRows(placerMetricFile, zips, flowsByOdKey);
      return rows;
    }
    if (destAnchors.length === 0) return [];
    const anchorSet = new Set(destAnchors);
    return flowsInbound.filter((f) => anchorSet.has(f.originZip));
  }, [flowsInbound, destAnchors, placerMetricFile, zips, flowsByOdKey, isShopperMetric]);
  // For shoppers the aggregate view reads from the outbound axis (no inbound
  // data exists for that metric). Everywhere else, regional = inbound.
  const flowsRegional = isShopperMetric ? flowsOutbound : flowsInbound;

  // Placer-scoped corridor flow index. Mirrors the LODES flowIndex built in
  // useFlowData but spans the Placer flows so corridor aggregation finds
  // gateway-routed visitor origins (NYC → Aspen via GW_E_GWS, etc).
  // Without this, only Placer flows whose OD pair LODES happens to share
  // would land on a corridor; everything else fell through to the dashed
  // off-corridor branches.
  const flowIndex = useMemo(
    () => buildCorridorFlowIndex(flowsInbound, flowsOutbound),
    [flowsInbound, flowsOutbound],
  );

  // Selection + filter state. Mode = user's Inbound / Outbound choice when
  // an anchor is selected; in the no-selection (aggregate) view effectiveMode
  // collapses to 'regional' and the ModeToggle renders the static "Aggregate
  // Regional Flows" label.
  const [selectedZip, setSelectedZip] = useState<string | null>(null);
  const [selectedPartner, setSelectedPartner] = useState<
    { place: string; zips: string[] } | null
  >(null);
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');
  // Visitor-type filter — only consumed by the Visitors metric. Replaces the
  // geographic DirectionToggle in that view with a Regional / Tourist split
  // (50-mile crow-flies radius from the destination).
  const [visitorType, setVisitorType] = useState<VisitorType>('all');
  const [mode, setMode] = useState<Mode>('inbound');
  const [hover, setHover] = useState<HoverState | null>(null);
  const [pinned, setPinned] = useState<HoverState | null>(null);
  const [suppressedHover, setSuppressedHover] = useState<CorridorId | null>(null);
  // Off-corridor (spaghetti) tooltip state — same UX pattern as the
  // corridor hover/pinned, but keyed to a single OD pair.
  const [odHover, setOdHover] = useState<OdHoverState | null>(null);
  const [odPinned, setOdPinned] = useState<OdHoverState | null>(null);

  // Drag-to-move offsets for the two pinned tooltip panels. Each
  // resets to (0, 0) when a new selection is pinned so the user
  // always starts from the default placement.
  const corridorPinnedDrag = useDraggable(pinned?.corridorId ?? null);
  const odPinnedDrag = useDraggable(
    odPinned ? `${odPinned.originZip}-${odPinned.destZip}` : null,
  );

  // Derived cross-filter from the pinned corridor or OD branch. When a
  // shopper user pins a corridor or a spaghetti branch, the strip cards
  // (KPIs / Pie / Category Rankings / Top Destinations) + Top 10
  // Properties + heatmap narrow to flows touching that selection so the
  // numbers match the visual context. Cleared when the tooltip is
  // dismissed.
  const pinnedFlowFilter = useMemo<
    | { kind: 'corridor'; flowIds: Set<string>; destZips: Set<string>; originZips: Set<string> }
    | { kind: 'od'; originZip: string; destZip: string }
    | null
  >(() => {
    if (odPinned) {
      return { kind: 'od', originZip: odPinned.originZip, destZip: odPinned.destZip };
    }
    if (pinned) {
      const flowIds = new Set<string>();
      const destZips = new Set<string>();
      const originZips = new Set<string>();
      for (const f of pinned.aggregation.flows) {
        flowIds.add(f.flowId);
        destZips.add(f.destZip);
        originZips.add(f.originZip);
      }
      return { kind: 'corridor', flowIds, destZips, originZips };
    }
    return null;
  }, [pinned, odPinned]);

  // Helper — apply the pinned filter to an arbitrary FlowRow set.
  // Defined as a pure useMemo factory so consumers can call it from
  // their own deps lists without re-running on every render.
  const applyPinnedFlowFilter = useMemo(() => {
    return (rows: FlowRow[]): FlowRow[] => {
      if (!pinnedFlowFilter) return rows;
      if (pinnedFlowFilter.kind === 'od') {
        return rows.filter(
          (r) =>
            r.originZip === pinnedFlowFilter.originZip
            && r.destZip === pinnedFlowFilter.destZip,
        );
      }
      return rows.filter((r) => pinnedFlowFilter.flowIds.has(flowIdOf(r)));
    };
  }, [pinnedFlowFilter]);
  // Pass-through cross-filter state for the ActivityBottomCardStrip's
  // PassThroughCard. Shape mirrors LODES — clearing on anchor change keeps
  // the filter from carrying stale selections across switches.
  const [passThroughOrigin, setPassThroughOrigin] = useState<
    { place: string; zips: string[] } | null
  >(null);
  const [passThroughDest, setPassThroughDest] = useState<
    { place: string; zips: string[] } | null
  >(null);
  // Shopper category cross-filter — multi-select set of group categories
  // active in the Category Rankings / Pie cards. When non-empty the
  // corridor render, KPIs, place rankings, and property heatmap narrow
  // to flows / properties whose category is in the set. Empty array =
  // no filter.
  const [selectedShopperCategories, setSelectedShopperCategories] = useState<
    string[]
  >([]);
  // Multi-select shopper partners (destinations in outbound mode, origins
  // in inbound mode). When non-empty, KPI / Pie / Category cards + the
  // map narrow to flows whose pivot side matches any selected place.
  const [selectedShopperPartners, setSelectedShopperPartners] = useState<
    Array<{ place: string; zips: string[] }>
  >([]);
  // Shopper view layer — Corridor (default) routes flows on the corridor
  // graph; Spaghetti renders direct dashed lines from each resident anchor
  // to each destination's ZIP centroid (suppresses corridor strokes); the
  // Heatmap option swaps the corridor render for a heat-blob layer
  // weighted by visit volume per destination ZIP.
  const [shopperViewLayer, setShopperViewLayer] =
    useState<ShopperViewLayer>('corridor');

  const effectiveMode: Mode = !selectedZip ? 'regional' : mode;
  const selectionKind: 'aggregate' | 'anchor' = selectedZip ? 'anchor' : 'aggregate';

  const flows =
    effectiveMode === 'regional'
      ? flowsRegional
      : effectiveMode === 'inbound'
        ? flowsInbound
        : flowsOutbound;

  // Filter strategy depends on the active metric category:
  //   workers / shoppers → geographic DirectionFilter (East/West/Up/Down)
  //   visitors           → VisitorType (Regional/Tourist by crow-flies dist)
  // The two filters are mutually exclusive in the UI (only one toggle renders
  // at a time), and each branch leaves the other filter inert. applySegment
  // is called with an inert filter so the call surface mirrors the LODES
  // view even though segment filtering isn't exposed in this UI.
  const isVisitorCategory = activeCategory === 'visitors';
  const directionFilteredInbound = useMemo(() => {
    const base = isVisitorCategory
      ? filterByVisitorType(flowsInbound, zips, visitorType)
      : filterByDirection(flowsInbound, zips, directionFilter);
    return applySegmentFilter(base, { axis: 'all', buckets: [] });
  }, [flowsInbound, zips, directionFilter, visitorType, isVisitorCategory]);
  const directionFilteredOutbound = useMemo(() => {
    const base = isVisitorCategory
      ? filterByVisitorType(flowsOutbound, zips, visitorType)
      : filterByDirection(flowsOutbound, zips, directionFilter);
    return applySegmentFilter(base, { axis: 'all', buckets: [] });
  }, [flowsOutbound, zips, directionFilter, visitorType, isVisitorCategory]);
  const directionFilteredRegional = isShopperMetric
    ? directionFilteredOutbound
    : directionFilteredInbound;
  const directionFilteredFlows =
    effectiveMode === 'regional'
      ? directionFilteredRegional
      : effectiveMode === 'inbound'
        ? directionFilteredInbound
        : directionFilteredOutbound;

  // Shopper category cross-filter — when a category is selected via the
  // Category Rankings or Pie cards, the map + stats narrow to flows in
  // that group category. Pie + Category Rankings themselves continue to
  // read off the unfiltered `directionFiltered*` datasets so the
  // breakdown stays visible and the user can switch categories.
  const categoryFilteredOutbound = useMemo(() => {
    if (!isShopperMetric || selectedShopperCategories.length === 0) {
      return directionFilteredOutbound;
    }
    const set = new Set(selectedShopperCategories);
    return directionFilteredOutbound.filter(
      (f) => set.has(f.category || 'Other'),
    );
  }, [directionFilteredOutbound, isShopperMetric, selectedShopperCategories]);
  const categoryFilteredInbound = useMemo(() => {
    if (!isShopperMetric || selectedShopperCategories.length === 0) {
      return directionFilteredInbound;
    }
    const set = new Set(selectedShopperCategories);
    return directionFilteredInbound.filter(
      (f) => set.has(f.category || 'Other'),
    );
  }, [directionFilteredInbound, isShopperMetric, selectedShopperCategories]);
  const categoryFilteredRegional = isShopperMetric
    ? categoryFilteredOutbound
    : categoryFilteredInbound;
  const categoryFilteredFlows =
    effectiveMode === 'regional'
      ? categoryFilteredRegional
      : effectiveMode === 'inbound'
        ? categoryFilteredInbound
        : categoryFilteredOutbound;

  const visibleFlows = useMemo(() => {
    const base = filterForSelection(categoryFilteredFlows, selectedZip, effectiveMode);
    // Shopper multi-select partner filter — pivot axis follows mode:
    // inbound + anchor view → match on origin place (which resident
    // anchors visit this shopping place); otherwise → match on dest
    // place (the canonical "Top Destinations" pivot).
    if (isShopperMetric && selectedShopperPartners.length > 0) {
      const partnerKeys = new Set(
        selectedShopperPartners.map((p) => p.place),
      );
      const pivotOrigin = selectedZip != null && effectiveMode === 'inbound';
      return base.filter((f) => {
        const side = pivotOrigin ? f.originPlace : f.destPlace;
        return partnerKeys.has(side ?? '');
      });
    }
    return base;
  }, [
    categoryFilteredFlows,
    selectedZip,
    effectiveMode,
    isShopperMetric,
    selectedShopperPartners,
  ]);

  // Per-anchor distance / vehicle-miles tile shown below the inbound tile in
  // the left panel. Content varies by metric:
  //   workers      → "Average Commute Distance" (round-trip miles)
  //   daily-trips  → "Average Daily Vehicle Miles" (trips × one-way miles)
  //   trips        → "Total Vehicle Miles" (trips × one-way miles)
  //   visitors     → "Average Visit Distance" (visitor-weighted one-way miles)
  //   daily-visits → "Average Daily Vehicle Miles" (visits × one-way miles)
  //   visits       → "Total Vehicle Miles" (visits × one-way miles)
  //   out-of-market-shopping → null (source data has its own home-distance
  //                                  column; v2 can surface it directly)
  const distanceTile = useMemo(() => {
    if (!selectedZip) return null;
    if (isShopperMetric) return null;
    const dataset = mode === 'inbound' ? directionFilteredInbound : directionFilteredOutbound;
    let anchorFlows = dataset.filter((f) =>
      mode === 'inbound' ? f.destZip === selectedZip : f.originZip === selectedZip,
    );
    // Cross-filter by the partner row clicked in the top inflow/outflow
    // list — matches the narrowing the headline tiles above already
    // apply when a partner is active.
    if (selectedPartner) {
      const partnerSet = new Set(selectedPartner.zips);
      anchorFlows = anchorFlows.filter((f) =>
        mode === 'inbound' ? partnerSet.has(f.originZip) : partnerSet.has(f.destZip),
      );
    }
    const dd = driveDistance ?? undefined;
    if (metric === 'workers') {
      const roundTrip = meanCommuteMiles(anchorFlows, zips, dd) * 2;
      return {
        label: 'Average Commute Distance',
        value: roundTrip > 0 ? `${roundTrip.toFixed(1)} mi` : '—',
        sub: 'worker-weighted, round-trip · cross-ZIP only',
      };
    }
    if (metric === 'visitors') {
      const oneWay = meanCommuteMiles(anchorFlows, zips, dd);
      return {
        label: 'Average Visit Distance',
        value: oneWay > 0 ? `${oneWay.toFixed(1)} mi` : '—',
        sub: 'visitor-weighted, one-way · cross-ZIP only',
      };
    }
    const totalVMT = sumDistanceWeightedMiles(anchorFlows, zips, dd);
    if (metric === 'daily-trips' || metric === 'daily-visits') {
      const unit = metric === 'daily-trips' ? 'avg. daily trips' : 'avg. daily visits';
      return {
        label: 'Average Daily Vehicle Miles',
        value: totalVMT > 0 ? `${fmtInt(totalVMT)} mi` : '—',
        sub: `${unit} × one-way distance · cross-ZIP only`,
      };
    }
    // 'trips' or 'visits' — annual volumes × one-way distance.
    const unit = metric === 'trips' ? 'annual trips' : 'annual visits';
    return {
      label: 'Total Vehicle Miles',
      value: totalVMT > 0 ? `${fmtInt(totalVMT)} mi` : '—',
      sub: `${unit} × one-way distance · cross-ZIP only`,
    };
  }, [
    selectedZip,
    selectedPartner,
    mode,
    metric,
    isShopperMetric,
    directionFilteredInbound,
    directionFilteredOutbound,
    zips,
    driveDistance,
  ]);

  const referenceCorridorMap = useMemo(() => {
    if (!corridorIndex || !flowIndex) return null;
    // For shoppers, flowsInbound is empty — use the outbound axis as the
    // reference distribution so bucket breaks reflect actual data.
    const referenceFlows = isShopperMetric ? flowsOutbound : flowsInbound;
    const referenceMode: Mode = isShopperMetric ? 'outbound' : 'inbound';
    return buildVisibleCorridorMap(corridorIndex, flowIndex, referenceFlows, referenceMode);
  }, [corridorIndex, flowIndex, flowsInbound, flowsOutbound, isShopperMetric]);

  // Same two-tier bucket strategy as CommuteView: aggregate breaks scaled
  // against the corridor-edge total distribution; anchor breaks scaled
  // against per-corridor × per-anchor partitions so a single anchor's view
  // doesn't bucket every corridor as "quiet".
  const aggregateBreaks = useMemo<[number, number, number, number]>(() => {
    if (!referenceCorridorMap) return [1, 2, 3, 4];
    const totals: number[] = [];
    for (const agg of referenceCorridorMap.values()) totals.push(agg.total);
    return computeBucketBreaks(totals);
  }, [referenceCorridorMap]);
  const anchorBreaks = useMemo<[number, number, number, number]>(() => {
    if (!referenceCorridorMap) return [1, 2, 3, 4];
    const totals: number[] = [];
    for (const agg of referenceCorridorMap.values()) {
      for (const v of agg.byDestZip.values()) totals.push(v);
    }
    return computeBucketBreaks(totals);
  }, [referenceCorridorMap]);
  const bucketBreaks = selectedZip == null ? aggregateBreaks : anchorBreaks;

  const visibleCorridorMap = useMemo(() => {
    if (!corridorIndex || !flowIndex) return new Map<CorridorId, ActiveCorridorAggregation>();
    // For visitors, corridor strokes are replaced by origin symbols (we
    // don't know if visitors drove or flew, so a corridor route would
    // misrepresent the data). Return an empty map so the corridor render
    // branch is a no-op while the symbol overlay paints in its place.
    if (isVisitorCategory) return new Map<CorridorId, ActiveCorridorAggregation>();
    // For shoppers in Spaghetti / Heatmap view modes, suppress corridor
    // strokes too — Spaghetti relies on the off-corridor render to draw
    // direct dashed lines, Heatmap replaces the corridor layer with the
    // MapLibre heat-blob layer entirely.
    if (isShopperMetric && shopperViewLayer !== 'corridor') {
      return new Map<CorridorId, ActiveCorridorAggregation>();
    }
    return buildVisibleCorridorMap(corridorIndex, flowIndex, visibleFlows, effectiveMode);
  }, [corridorIndex, flowIndex, visibleFlows, effectiveMode, isVisitorCategory, isShopperMetric, shopperViewLayer]);

  // Origin-symbol overlay for the Visitors metric. Aggregates the
  // post-filter (selection + visitor-type) visibleFlows by ORIGIN CITY
  // (state-qualified) rather than ZIP — a big metro like Dallas spreads
  // across 20+ ZIPs and per-ZIP bubbles fragment the visual story. Each
  // bubble's position is the visit-weighted mean of its underlying ZIPs'
  // centroids so a multi-ZIP city anchors near its population mass. Rows
  // missing a city tag (legacy or non-visitor sneak-throughs) fall back
  // to per-ZIP grouping so they remain visible. Cap to the top
  // ORIGIN_SYMBOL_LIMIT by value to keep the SVG performant; the long
  // tail is omitted (the headline tile still tracks the full universe).
  const originSymbols = useMemo(() => {
    if (!isVisitorCategory) return undefined;
    const ORIGIN_SYMBOL_LIMIT = 300;
    interface SymbolAgg {
      key: string;          // city-state or ZIP fallback
      label: string;        // human-readable place label
      latWeighted: number;  // running sum of lat × value (for weighted mean)
      lngWeighted: number;  // running sum of lng × value
      value: number;        // sum of visits
      sampleZip: string;    // representative ZIP for tooltip
    }
    const agg = new Map<string, SymbolAgg>();
    for (const f of visibleFlows) {
      if (f.originLat == null || f.originLng == null) continue;
      const city = f.originCity?.trim();
      const state = f.originState?.trim();
      // Group by "{city}, {state}" when both are present; fall back to
      // origin ZIP otherwise so rows missing city tags still surface.
      const key = city
        ? state
          ? `${city}, ${state}`
          : city
        : f.originZip;
      const label = city
        ? state
          ? `${city}, ${state}`
          : city
        : f.originPlace || f.originZip;
      const existing = agg.get(key);
      if (existing) {
        existing.latWeighted += f.originLat * f.workerCount;
        existing.lngWeighted += f.originLng * f.workerCount;
        existing.value += f.workerCount;
      } else {
        agg.set(key, {
          key,
          label,
          latWeighted: f.originLat * f.workerCount,
          lngWeighted: f.originLng * f.workerCount,
          value: f.workerCount,
          sampleZip: f.originZip,
        });
      }
    }
    const all = Array.from(agg.values()).map((a) => ({
      originZip: a.sampleZip,
      originPlace: a.label,
      lat: a.latWeighted / Math.max(a.value, 1),
      lng: a.lngWeighted / Math.max(a.value, 1),
      value: a.value,
    }));
    all.sort((a, b) => b.value - a.value);
    return all.slice(0, ORIGIN_SYMBOL_LIMIT);
  }, [isVisitorCategory, visibleFlows]);

  // Tooltip unit follows the active visitor sub-metric so the hover panel
  // reads "12,345 visitors" (Visitors) / "12,345 visits" (Visits) /
  // "34 avg. daily visits" (Avg. Daily Visits).
  const originSymbolUnit =
    metric === 'visitors'
      ? 'visitors'
      : metric === 'daily-visits'
        ? 'avg. daily visits'
        : 'visits';

  // Shopper heatmap GeoJSON — when the shopper metric publishes
  // geocoded property points (placerMetricFile.properties), build the
  // heatmap from per-property coords so each shopping location lights
  // up individually. Falls back to dest-ZIP centroid for properties
  // whose addresses haven't been geocoded yet (run
  // scripts/geocode-properties.py to fill the cache). The point list is
  // handed to quintileBinPoints() so the resulting weights land in the
  // same 5 discrete bands the Workforce heatmap uses — both maps then
  // read with the same LEHD-style visual language.
  const shopperHeatmapData = useMemo(() => {
    if (!isShopperMetric || shopperViewLayer !== 'heatmap') return null;
    const zipIndex = new Map<string, typeof zips[number]>();
    for (const z of zips) zipIndex.set(z.zip, z);
    const rawProperties = placerMetricFile?.properties ?? [];

    // Anchor + mode pivot determines the heatmap's scope and per-property
    // weight. Same semantics as the corridor map's inbound/outbound axis:
    //   no anchor (aggregate) → universe view, weight = property.visits
    //   anchor X + outbound   → properties X's residents visit;
    //                           weight = visitsByAnchor[X]
    //   anchor X + inbound    → properties IN X visited by other anchors
    //                           (destZip = X); weight = property.visits
    //                           (the sum across all other anchors, since
    //                           the source data is strictly out-of-market)
    const anchor = selectedZip;
    const anchorMode: 'inbound' | 'outbound' | null =
      anchor != null
        ? (effectiveMode === 'inbound' ? 'inbound' : 'outbound')
        : null;

    const allowedPlaces: Set<string> | null =
      selectedShopperPartners.length > 0
        ? new Set(selectedShopperPartners.map((p) => p.place))
        : null;
    const allowedPartnerZips: Set<string> | null =
      selectedShopperPartners.length > 0
        ? new Set(selectedShopperPartners.flatMap((p) => p.zips))
        : null;
    const allowedCategories: Set<string> | null =
      selectedShopperCategories.length > 0
        ? new Set(selectedShopperCategories)
        : null;
    // Pinned-flow narrowing — limit properties to destZips on the
    // pinned corridor/OD, and weight by visits from contributing
    // origins only (so the heatmap reads as "the flow we clicked").
    let pinnedDestZips: Set<string> | null = null;
    let pinnedOriginZips: Set<string> | null = null;
    if (pinnedFlowFilter) {
      if (pinnedFlowFilter.kind === 'od') {
        pinnedDestZips = new Set([pinnedFlowFilter.destZip]);
        pinnedOriginZips = new Set([pinnedFlowFilter.originZip]);
      } else {
        pinnedDestZips = pinnedFlowFilter.destZips;
        pinnedOriginZips = pinnedFlowFilter.originZips;
      }
    }

    // Score-origin set — which anchors' visitsByAnchor sum into the
    // property weight. Mirrors the top 10 logic so the heatmap reads
    // consistently with the strip cards:
    //   pin + inbound + partner → intersection
    //   pin alone               → pinned origins
    //   inbound + partner       → partner zips
    //   else                    → null (mode-default weighting below)
    let scoreOriginZips: Set<string> | null = null;
    if (pinnedOriginZips && anchorMode === 'inbound' && allowedPartnerZips) {
      scoreOriginZips = new Set(
        [...pinnedOriginZips].filter((z) => allowedPartnerZips.has(z)),
      );
    } else if (pinnedOriginZips) {
      scoreOriginZips = pinnedOriginZips;
    } else if (anchorMode === 'inbound' && allowedPartnerZips) {
      scoreOriginZips = allowedPartnerZips;
    }

    type Pt = { lat: number; lng: number; weight: number; key: string };
    const points: Pt[] = [];

    for (const p of rawProperties) {
      if (
        allowedCategories
        && !allowedCategories.has(p.category || 'Other')
      ) {
        continue;
      }
      // Anchor + mode scope filter applies regardless of pin: inbound
      // at anchor X means "properties IN X" no matter which corridor
      // or branch is pinned.
      if (anchorMode === 'inbound' && p.destZip !== anchor) continue;
      if (pinnedDestZips && !pinnedDestZips.has(p.destZip)) continue;
      // Outbound + aggregate partner filter — dest-place side.
      if (allowedPlaces && anchorMode !== 'inbound') {
        const meta = zipIndex.get(p.destZip);
        if (!meta || !allowedPlaces.has(meta.place)) continue;
      }

      // Weight: scoreOriginZips wins when set (sum over the resolved
      // origin set above). Otherwise the anchor/mode pivot.
      let weight: number;
      if (scoreOriginZips) {
        if (scoreOriginZips.size === 0) continue;
        let s = 0;
        for (const oz of scoreOriginZips) s += p.visitsByAnchor?.[oz] ?? 0;
        if (s <= 0) continue;
        weight = s;
      } else if (anchorMode === 'outbound') {
        const v = p.visitsByAnchor?.[anchor!] ?? 0;
        if (v <= 0) continue;
        weight = v;
      } else if (anchorMode === 'inbound') {
        // destZip restriction already applied above.
        weight = p.visits;
      } else {
        weight = p.visits;
      }

      // Resolve to lat/lng — property coords when geocoded, else dest-ZIP
      // centroid fallback. Ungeocoded properties still contribute weight
      // (pile up on the ZIP centroid until scripts/geocode-properties.py
      // resolves them).
      let lat = p.lat;
      let lng = p.lng;
      if (lat == null || lng == null) {
        const meta = zipIndex.get(p.destZip);
        if (!meta || meta.lat == null || meta.lng == null) continue;
        lat = meta.lat;
        lng = meta.lng;
      }
      points.push({ lat, lng, weight, key: p.address });
    }

    // Legacy fallback — no properties array on the file (older builds).
    // Coarse aggregate by dest-ZIP centroid; honors the same anchor/mode
    // pivot via visibleFlows (which already encodes selection).
    if (rawProperties.length === 0) {
      const byDest = new Map<string, number>();
      for (const f of visibleFlows) {
        byDest.set(f.destZip, (byDest.get(f.destZip) ?? 0) + f.workerCount);
      }
      for (const [destZip, weight] of byDest) {
        const meta = zipIndex.get(destZip);
        if (!meta || meta.lat == null || meta.lng == null) continue;
        points.push({
          lat: meta.lat,
          lng: meta.lng,
          weight,
          key: destZip,
        });
      }
    }
    return quintileBinPoints(points);
  }, [
    isShopperMetric,
    shopperViewLayer,
    effectiveMode,
    selectedZip,
    placerMetricFile,
    visibleFlows,
    zips,
    selectedShopperCategories,
    selectedShopperPartners,
    pinnedFlowFilter,
  ]);

  // Top 10 properties for the right-rail card. Reflects ALL active
  // filters: direction (via directionFilteredOutbound's destZip
  // universe), anchor + mode pivot (outbound at X → X's contributions;
  // inbound at X → properties IN X visited by other anchors), partner
  // places (Top Destinations multi-select), and category (Category
  // Rankings / Pie). Properties with the same display name in
  // different cities (e.g. City Market in Rifle vs Carbondale) keep
  // their own row — dedup is by `address`, never by `property`.
  const topShopperProperties = useMemo(() => {
    if (!isShopperMetric) return [];
    const allProps = placerMetricFile?.properties ?? [];
    if (allProps.length === 0) return [];

    const anchor = selectedZip;
    const anchorMode: 'inbound' | 'outbound' | null =
      anchor != null
        ? (effectiveMode === 'inbound' ? 'inbound' : 'outbound')
        : null;

    // In-scope destZip universe depends on the anchor + mode pivot:
    //   aggregate          → every destZip the direction filter retains
    //   outbound + anchor X → destinations X's residents visit
    //   inbound  + anchor X → just {X} (properties IN X visited by others)
    let inScopeDestZips: Set<string>;
    if (anchorMode === 'inbound') {
      inScopeDestZips = new Set([anchor!]);
    } else if (anchorMode === 'outbound') {
      inScopeDestZips = new Set();
      for (const f of directionFilteredOutbound) {
        if (f.originZip === anchor) inScopeDestZips.add(f.destZip);
      }
    } else {
      inScopeDestZips = new Set();
      for (const f of directionFilteredOutbound) inScopeDestZips.add(f.destZip);
    }

    // Pinned-flow narrowing — limit the destZip universe to whatever the
    // pinned corridor or OD touches. Also drives per-property score
    // weighting (corridor: sum visits from contributing origins;
    // OD: visits from the one origin anchor).
    let pinnedDestZips: Set<string> | null = null;
    let pinnedOriginZips: Set<string> | null = null;
    if (pinnedFlowFilter) {
      if (pinnedFlowFilter.kind === 'od') {
        pinnedDestZips = new Set([pinnedFlowFilter.destZip]);
        pinnedOriginZips = new Set([pinnedFlowFilter.originZip]);
      } else {
        pinnedDestZips = pinnedFlowFilter.destZips;
        pinnedOriginZips = pinnedFlowFilter.originZips;
      }
    }

    const allowedPlaces: Set<string> | null =
      selectedShopperPartners.length > 0
        ? new Set(selectedShopperPartners.map((p) => p.place))
        : null;
    const allowedPartnerZips: Set<string> | null =
      selectedShopperPartners.length > 0
        ? new Set(selectedShopperPartners.flatMap((p) => p.zips))
        : null;
    const allowedCategories: Set<string> | null =
      selectedShopperCategories.length > 0
        ? new Set(selectedShopperCategories)
        : null;
    const zipPlace = new Map<string, string>();
    for (const z of zips) zipPlace.set(z.zip, z.place);

    // Score-origin set determines which anchors' visitsByAnchor sum into
    // the property score. Mirrors the strip's flow narrowing:
    //   pin + inbound + partner → intersection (flows on the corridor
    //                              that touch a partner anchor)
    //   pin alone               → pinned origins
    //   inbound + partner       → partner zips (which anchors visit X)
    //   else                    → null (use mode-default scoring below)
    let scoreOriginZips: Set<string> | null = null;
    if (pinnedOriginZips && anchorMode === 'inbound' && allowedPartnerZips) {
      scoreOriginZips = new Set(
        [...pinnedOriginZips].filter((z) => allowedPartnerZips.has(z)),
      );
    } else if (pinnedOriginZips) {
      scoreOriginZips = pinnedOriginZips;
    } else if (anchorMode === 'inbound' && allowedPartnerZips) {
      scoreOriginZips = allowedPartnerZips;
    }

    type Scored = {
      address: string;
      property: string | null | undefined;
      destZip: string;
      destPlace: string;
      category: string;
      score: number;        // visits attributed to active scope (anchor or total)
      totalVisits: number;  // raw total visits (for share denominator hints)
    };
    const scored: Scored[] = [];
    for (const p of allProps) {
      if (
        allowedCategories
        && !allowedCategories.has(p.category || 'Other')
      ) {
        continue;
      }
      if (!inScopeDestZips.has(p.destZip)) continue;
      if (pinnedDestZips && !pinnedDestZips.has(p.destZip)) continue;
      const destPlace = zipPlace.get(p.destZip) ?? p.destZip;
      // Partner filter pivots on mode:
      //   outbound / aggregate → partner = destination place; filter the
      //                          property's destPlace against it
      //   inbound + anchor X   → partner = origin anchor (which residents
      //                          come to X); enforced via scoreOriginZips
      //                          below (a property with 0 visits from any
      //                          partner anchor falls out)
      if (allowedPlaces && anchorMode !== 'inbound') {
        if (!allowedPlaces.has(destPlace)) continue;
      }
      let score: number;
      if (scoreOriginZips) {
        if (scoreOriginZips.size === 0) continue;
        let s = 0;
        for (const oz of scoreOriginZips) {
          s += p.visitsByAnchor?.[oz] ?? 0;
        }
        if (s <= 0) continue;
        score = s;
      } else if (anchorMode === 'outbound') {
        // Outbound at X: X's contribution to the property.
        score = p.visitsByAnchor?.[anchor!] ?? 0;
        if (score <= 0) continue;
      } else if (anchorMode === 'inbound') {
        // Inbound at X: properties IN X visited by every other anchor.
        // `p.visits` already sums across the contributing anchors since
        // the source data is strictly out-of-market (X→X excluded), so
        // it equals "all visits to this property from elsewhere".
        score = p.visits;
        if (score <= 0) continue;
      } else {
        score = p.visits;
      }
      scored.push({
        address: p.address,
        property: p.property,
        destZip: p.destZip,
        destPlace,
        category: p.category || 'Other',
        score,
        totalVisits: p.visits,
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 10);
  }, [
    isShopperMetric,
    placerMetricFile,
    directionFilteredOutbound,
    effectiveMode,
    selectedZip,
    selectedShopperCategories,
    selectedShopperPartners,
    pinnedFlowFilter,
    zips,
  ]);

  // Visitor-type pie data — Regional vs Tourist split of the UNFILTERED
  // visitor universe (ignores the active visitor-type chip so the user
  // can always see the proportional mix). Uses the same GWS-centroid
  // threshold the filter applies (50 mi crow-flies). Computed from
  // flowsInbound before any direction/segment/selection narrowing —
  // mirrors the framing of the headline "Total Visitors" tile so the
  // pie always reads as "what's the full breakdown of this metric".
  const visitorTypePieData = useMemo(() => {
    if (!isVisitorCategory) return null;
    const ref = zips.find((z) => z.zip === VISITOR_TYPE_REFERENCE_ZIP);
    if (!ref || ref.lat == null || ref.lng == null) return null;
    const reference = { lat: ref.lat, lng: ref.lng };
    const zipIndex = new Map<string, typeof zips[number]>();
    for (const z of zips) zipIndex.set(z.zip, z);
    let regional = 0;
    let tourist = 0;
    for (const f of flowsInbound) {
      let lat: number | null = f.originLat ?? null;
      let lng: number | null = f.originLng ?? null;
      if (lat == null || lng == null) {
        const o = zipIndex.get(f.originZip);
        if (o && o.lat != null && o.lng != null) {
          lat = o.lat;
          lng = o.lng;
        }
      }
      const cls = classifyVisitorType(lat, lng, reference);
      // Origin with no centroid → treat as Tourist, matching the filter's
      // default for remote/national origins.
      if (cls === 'regional') regional += f.workerCount;
      else tourist += f.workerCount;
    }
    return { regional, tourist };
  }, [isVisitorCategory, flowsInbound, zips]);

  // Top corridor across the active direction filter (no selection narrowing)
  // — drives the inbound + outbound "Top corridor" tiles in StatsAggregated.
  const topCorridorInbound = useMemo<{ label: string; total: number } | null>(() => {
    if (!corridorIndex || !flowIndex) return null;
    const map = buildVisibleCorridorMap(corridorIndex, flowIndex, directionFilteredInbound, 'inbound');
    if (map.size === 0) return null;
    let best: ActiveCorridorAggregation | null = null;
    for (const agg of map.values()) if (!best || agg.total > best.total) best = agg;
    return best ? { label: best.corridor.label, total: best.total } : null;
  }, [corridorIndex, flowIndex, categoryFilteredInbound]);

  const topCorridorOutbound = useMemo<{ label: string; total: number } | null>(() => {
    if (!corridorIndex || !flowIndex || categoryFilteredOutbound.length === 0) return null;
    const map = buildVisibleCorridorMap(corridorIndex, flowIndex, categoryFilteredOutbound, 'outbound');
    if (map.size === 0) return null;
    let best: ActiveCorridorAggregation | null = null;
    for (const agg of map.values()) if (!best || agg.total > best.total) best = agg;
    return best ? { label: best.corridor.label, total: best.total } : null;
  }, [corridorIndex, flowIndex, categoryFilteredOutbound]);

  // Direction-chip counts mirror the LODES view's overlay so the
  // "X of Y flows shown" sub-label stays accurate against the Placer
  // universe.
  const directionChipCounts = useMemo<{ numerator: number; denominator: number }>(() => {
    const countCrossZip = (rows: FlowRow[]) => {
      let n = 0;
      for (const f of rows) {
        if (f.originZip === f.destZip) continue;
        if (f.originZip === 'ALL_OTHER' || f.destZip === 'ALL_OTHER') continue;
        n += 1;
      }
      return n;
    };
    if (selectedZip == null) {
      return {
        numerator: countCrossZip(directionFilteredRegional),
        denominator: countCrossZip(flowsRegional),
      };
    }
    const meta = zips.find((z) => z.zip === selectedZip);
    if (!meta) return { numerator: 0, denominator: 0 };
    return {
      numerator: detailForZip(directionFilteredFlows, meta, mode).flows.length,
      denominator: detailForZip(flows, meta, mode).flows.length,
    };
  }, [
    selectedZip,
    zips,
    flows,
    directionFilteredFlows,
    directionFilteredRegional,
    flowsRegional,
  ]);

  // ESC closes the pinned tooltip (corridor or OD) from anywhere on the page.
  useEffect(() => {
    if (!pinned && !odPinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPinned(null);
        setOdPinned(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinned, odPinned]);

  // Clear OD hover + pinned state when leaving the spaghetti view layer
  // (or the shopper metric entirely) so stale tooltips don't linger over
  // the corridor / heatmap renders.
  useEffect(() => {
    if (!isShopperMetric || shopperViewLayer !== 'spaghetti') {
      setOdHover(null);
      setOdPinned(null);
    }
  }, [isShopperMetric, shopperViewLayer]);

  // Visitor metrics have only inbound data (origin = visitor home, dest =
  // anchor), so when a visitor metric is active LOCK mode='inbound' to
  // keep the underlying selection state aligned with what the UI shows.
  useEffect(() => {
    if (activeCategory === 'visitors' && mode !== 'inbound') {
      setMode('inbound');
    }
  }, [activeCategory, mode]);

  // The shopper metric exposes the full Inbound/Outbound toggle in anchor
  // view so the user can switch between "who shops here" (inbound) and
  // "where do residents shop elsewhere" (outbound). On first entry to
  // shopper view, default mode to 'outbound' so the landing experience
  // matches the source-data orientation; afterwards the user is free to
  // toggle. Tracked via a ref so within-session toggles aren't clobbered.
  const wasShopperRef = useRef(isShopperMetric);
  useEffect(() => {
    if (isShopperMetric && !wasShopperRef.current) {
      setMode('outbound');
    }
    wasShopperRef.current = isShopperMetric;
  }, [isShopperMetric]);

  // Clear shopper-only filters when metric leaves shoppers — keeps them
  // from carrying state into other metric views that don't surface those
  // controls.
  useEffect(() => {
    if (!isShopperMetric) {
      if (selectedShopperCategories.length > 0) setSelectedShopperCategories([]);
      if (selectedShopperPartners.length > 0) setSelectedShopperPartners([]);
    }
  }, [isShopperMetric, selectedShopperCategories.length, selectedShopperPartners.length]);

  // When mode changes (Inbound ↔ Outbound) inside the shopper view, clear
  // the partner multi-select — the pivot axis is now origin-vs-dest, so
  // a "Rifle" destination selection makes no sense in inbound mode (where
  // Rifle would mean origin).
  useEffect(() => {
    if (isShopperMetric && selectedShopperPartners.length > 0) {
      setSelectedShopperPartners([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only fire when mode flips
  }, [mode, isShopperMetric]);

  // When the destAnchors set changes (workers/visitors → shoppers or back),
  // clear any stale selection that no longer belongs to the active anchor
  // set. e.g. switching from Shoppers (with Aspen 81611 selected) back to
  // Workers (anchors = 81601/81623 only) should drop the selection rather
  // than carry an unselectable chip into the new view.
  useEffect(() => {
    if (selectedZip && !destAnchors.includes(selectedZip)) {
      setSelectedZip(null);
      setSelectedPartner(null);
      setPassThroughOrigin(null);
      setPassThroughDest(null);
      setHover(null);
      setPinned(null);
    }
  }, [destAnchors, selectedZip]);

  const handleSelectZip = (z: string | null) => {
    setHover(null);
    setPinned(null);
    setSelectedPartner(null);
    setPassThroughOrigin(null);
    setPassThroughDest(null);
    // Placer dataset only covers the destination anchors — silently coerce
    // any non-anchor / non-Placer-anchor selection back to null. The chip
    // row already filters to those anchors so this is defensive.
    if (z && (!isAnchorZip(z) || !destAnchors.includes(z))) {
      setSelectedZip(null);
      return;
    }
    setSelectedZip(z);
  };
  const handleDirectionChange = (d: DirectionFilter) => {
    setHover(null);
    setDirectionFilter(d);
    setSelectedPartner(null);
  };
  const handleVisitorTypeChange = (v: VisitorType) => {
    setHover(null);
    setVisitorType(v);
    setSelectedPartner(null);
  };
  const handleModeChange = (m: Mode) => {
    setHover(null);
    setMode(m);
    // Partner selection is anchor + mode + direction scoped; flush so an
    // inbound partner doesn't carry into an outbound view where it no
    // longer matches a corridor on the map.
    setSelectedPartner(null);
    setPassThroughOrigin(null);
    setPassThroughDest(null);
  };
  const handleSelectPartner = (
    p: { place: string; zips: string[] } | null,
  ) => {
    setHover(null);
    setPinned(null);
    setSelectedPartner(p);
  };

  if (!placer) {
    return (
      <div
        className="flex items-center justify-center w-full h-full px-6 text-center"
        style={{ color: 'var(--text-dim)' }}
      >
        <div>
          <div
            className="text-[11px] uppercase tracking-widest mb-2"
            style={{ color: 'var(--accent)' }}
          >
            Placer.ai · GPS Activity Map V1
          </div>
          <div className="text-xs normal-case">
            Placer.ai bundle not loaded. Run{' '}
            <code className="px-1 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)' }}>
              python scripts/build-placer.py
            </code>{' '}
            after staging the workbook at{' '}
            <code className="px-1 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)' }}>
              data/placer/Placer.ai - Regional Activity .xlsx
            </code>
            .
          </div>
        </div>
      </div>
    );
  }

  const partnerHeader =
    selectedPartner != null
      ? `${selectedPartner.place} · ${selectedPartner.zips.length === 1 ? selectedPartner.zips[0] : 'multiple'}`
      : null;
  void partnerHeader; // currently surfaced only via ActiveFiltersOverlay

  // Category-driven copy for the left-panel header + corridor tooltip text.
  // Headline noun follows the category; subtitle prefix follows the metric
  // role (Origins vs. Destinations).
  const headlineNoun =
    activeCategory === 'workers'
      ? 'Valley Commuters'
      : activeCategory === 'visitors'
        ? 'Valley Visitors'
        : 'Valley Shoppers';
  const subtitleCategory =
    activeCategory === 'workers'
      ? 'Employee Origins by ZIP'
      : activeCategory === 'visitors'
        ? 'Visitor Origins by ZIP'
        : 'Out-of-Market Shopping Destinations';

  // Hover/pinned tooltip header. Unit word follows the active metric so the
  // corridor count reads correctly across categories.
  const tooltipUnit =
    activeCategory === 'workers'
      ? statsMetricLabels?.descriptor ?? 'employees'
      : activeCategory === 'visitors'
        ? statsMetricLabels?.descriptor ?? 'visitors'
        : 'visits';
  const headerFor = (s: HoverState) =>
    `${s.aggregation.corridor.label} — ${fmtInt(s.aggregation.total)} ${tooltipUnit}`;
  const subheadForDirection = (
    s: HoverState,
    direction: 'residence' | 'workplace',
  ): string => {
    if (activeCategory === 'workers') {
      return direction === 'residence'
        ? `Employees come from ${s.aggregation.byOriginZip.size} home ZIP(s) through this segment`
        : `Employees travel through here to ${s.aggregation.byDestZip.size} workplace ZIP(s)`;
    }
    if (activeCategory === 'visitors') {
      return direction === 'residence'
        ? `Visitors come from ${s.aggregation.byOriginZip.size} home ZIP(s) through this segment`
        : `Visitors travel through here to ${s.aggregation.byDestZip.size} destination ZIP(s)`;
    }
    // shoppers — origin = resident ZIP, dest = out-of-market property ZIP
    return direction === 'residence'
      ? `Residents come from ${s.aggregation.byOriginZip.size} home ZIP(s) through this segment`
      : `Residents travel through here to ${s.aggregation.byDestZip.size} out-of-market ZIP(s)`;
  };

  const showHover =
    hover &&
    (!pinned || hover.corridorId !== pinned.corridorId) &&
    hover.corridorId !== suppressedHover;

  return (
    <div
      className="w-full flex flex-col relative md:flex-row md:flex-1 md:min-h-0"
      style={{ background: 'var(--bg-base)' }}
    >
      {/* Left panel — slim. ZipSelector restricted to Placer destination
          anchors, DirectionToggle, and the stats panels. Workplace metrics
          / heatmap / industry / segment-filter / block-selection toggles
          are intentionally absent (v1 spec). */}
      <aside
        className="glass shrink-0 w-full md:w-[380px] md:h-full md:overflow-y-auto"
        style={{ borderRight: '1px solid var(--panel-border)' }}
      >
        <div className="px-3 md:px-4 py-4 flex flex-col gap-4">
          <header className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: 'var(--accent)' }}
              />
              <span
                className="text-[10px] font-semibold uppercase tracking-[0.18em]"
                style={{ color: 'var(--accent)' }}
              >
                Placer.ai · GPS Activity Map V1
              </span>
            </div>
            <h1
              className="text-[19px] font-semibold leading-tight"
              style={{ color: 'var(--text-h)', letterSpacing: '-0.01em' }}
            >
              Roaring Fork & Colorado River
              <br />
              {headlineNoun}
            </h1>
            <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
              {subtitleCategory} — {placerYear}
            </div>
          </header>

          {/* Mode toggle behavior is metric-aware:
              · Workers           — aggregate label / Inbound|Outbound toggle (default).
              · Visitors aggregate— aggregate label (no toggle).
              · Visitors workplace— static "Inbound (To)" (outbound has no data).
              · Shoppers aggregate— static "Outbound (From)" (flows are valley-out).
              · Shoppers workplace— interactive Inbound|Outbound toggle so
                the user can read the same source rows from either side
                ("who shops here" vs. "where do residents shop"). */}
          <ModeToggle
            mode={mode}
            onChange={handleModeChange}
            aggregate={selectionKind === 'aggregate' && !isShopperMetric}
            staticDirection={
              isShopperMetric && selectionKind === 'aggregate'
                ? 'outbound'
                : activeCategory === 'visitors' && selectionKind === 'anchor'
                  ? 'inbound'
                  : undefined
            }
          />

          <ActivityMetricToggle value={metric} onChange={setMetric} />

          {isVisitorCategory ? (
            <VisitorTypeToggle value={visitorType} onChange={handleVisitorTypeChange} />
          ) : (
            <DirectionToggle value={directionFilter} onChange={handleDirectionChange} />
          )}

          {isShopperMetric && (
            <ShopperViewToggle
              value={shopperViewLayer}
              onChange={setShopperViewLayer}
            />
          )}

          <ZipSelector
            zips={zips}
            selectedZip={selectedZip}
            onSelectZip={handleSelectZip}
            hideSearch
            anchorAllowList={destAnchors}
            label={
              isShopperMetric
                ? 'Resident - ZIP Codes'
                : isVisitorCategory
                  ? 'Visit Destinations - ZIP Codes'
                  : 'Workplaces - Zip Codes'
            }
            groupAriaLabel={
              isShopperMetric
                ? 'Resident anchor ZIPs'
                : isVisitorCategory
                  ? 'Visit destination ZIPs'
                  : 'Workplace ZIPs'
            }
          />

          {selectedZip == null ? (
            // StatsAggregated reads exclusively from its `*Inbound` slots
            // (inbound-only by editorial choice). For the shopper metric the
            // direction axis is flipped — origin = resident anchor, dest =
            // out-of-market ZIP — so we feed the outbound dataset into the
            // inbound slots. The metricLabels override every string slot so
            // the copy reads correctly regardless of which dataset arrived.
            <StatsAggregated
              flowsInbound={isShopperMetric ? flowsOutbound : flowsInbound}
              flowsOutbound={flowsOutbound}
              directionFilteredInbound={
                isShopperMetric ? categoryFilteredOutbound : categoryFilteredInbound
              }
              directionFilteredOutbound={categoryFilteredOutbound}
              directionFilter={directionFilter}
              topCorridorInbound={
                isShopperMetric ? topCorridorOutbound : topCorridorInbound
              }
              topCorridorOutbound={topCorridorOutbound}
              metricLabels={statsMetricLabels}
              commuteDistanceMultiplier={isShopperMetric ? 1 : 2}
              zips={zips}
              driveDistance={driveDistance}
              layout="stacked"
            />
          ) : (
            <StatsForZip
              flows={flows}
              directionFilteredFlows={categoryFilteredFlows}
              flowsInbound={isShopperMetric ? flowsOutbound : flowsInbound}
              flowsOutbound={flowsOutbound}
              directionFilteredInbound={
                isShopperMetric ? categoryFilteredOutbound : categoryFilteredInbound
              }
              directionFilteredOutbound={categoryFilteredOutbound}
              directionFilter={directionFilter}
              zips={zips}
              selectedZip={selectedZip}
              selectionKind="anchor"
              nonAnchorBundle={null}
              visibleFlows={visibleFlows}
              bundleFlows={[]}
              mode={mode}
              selectedPartner={selectedPartner}
              onSelectPartner={handleSelectPartner}
              onReset={() => handleSelectZip(null)}
              metricLabels={statsMetricLabels}
              distanceTile={distanceTile ?? undefined}
            />
          )}
        </div>
      </aside>

      <main className="relative w-full md:flex-1">
        <div className="relative w-full h-[80vh] md:h-auto md:absolute md:inset-0">
          <MapCanvas
            flows={isShopperMetric ? flowsOutbound : flowsInbound}
            zips={zips}
            visibleFlows={visibleFlows}
            bundleFlows={[]}
            nonAnchorBundle={null}
            visibleCorridorMap={visibleCorridorMap}
            bucketBreaks={bucketBreaks}
            selectedZip={selectedZip}
            selectedPartner={selectedPartner}
            mode={effectiveMode}
            onSelectZip={handleSelectZip}
            hoveredCorridorId={hover?.corridorId ?? null}
            onHoverCorridor={(corridorId, payload) => {
              if (!corridorId || !payload) {
                setHover(null);
                setSuppressedHover(null);
                return;
              }
              setHover({ corridorId, ...payload });
            }}
            onClickCorridor={(corridorId, payload) => {
              setPinned({ corridorId, ...payload });
              setSuppressedHover(null);
              setOdPinned(null);
            }}
            onHoverOffCorridor={
              isShopperMetric && shopperViewLayer === 'spaghetti'
                ? (od, payload) => {
                    if (!od || !payload) {
                      setOdHover(null);
                      return;
                    }
                    setOdHover({ ...od, ...payload });
                  }
                : undefined
            }
            onClickOffCorridor={
              isShopperMetric && shopperViewLayer === 'spaghetti'
                ? (od, payload) => {
                    setOdPinned({ ...od, ...payload });
                    setOdHover(null);
                    setPinned(null);
                  }
                : undefined
            }
            onClickEmpty={() => {
              setPinned(null);
              setOdPinned(null);
              setSuppressedHover(hover?.corridorId ?? null);
            }}
            heatmapData={shopperHeatmapData}
            selectionData={null}
            viewLayer={
              isShopperMetric && shopperViewLayer === 'heatmap'
                ? 'heatmap'
                : 'corridor'
            }
            industrySector="all"
            industryCounty="all"
            wacFile={null}
            blockSelectionActive={false}
            selectedBlocks={new Set()}
            onSelectedBlocksChange={() => {}}
            blockScopeActive={false}
            blocksHidden={false}
            odBlocks={null}
            originSymbols={originSymbols}
            originSymbolUnit={originSymbolUnit}
            hideAnchorMarkers={isVisitorCategory}
            keepRegionalBounds={isVisitorCategory}
            hideOffCorridor={isShopperMetric && shopperViewLayer === 'heatmap'}
          />

          <ActiveFiltersOverlay
            // For visitors the geographic direction filter isn't surfaced —
            // suppress its chip so the overlay doesn't reflect a stale East /
            // West / Up Valley selection left over from a workers session.
            // (visitor-type chip is a v2 enhancement.)
            directionFilter={isVisitorCategory ? 'all' : directionFilter}
            onClearDirection={() => handleDirectionChange('all')}
            selectedPartner={selectedPartner}
            onClearPartner={() => handleSelectPartner(null)}
            directionNumerator={directionChipCounts.numerator}
            directionDenominator={directionChipCounts.denominator}
            segmentFilter={{ axis: 'all', buckets: [] }}
            onClearSegmentFilter={() => {}}
            selectedBlockCount={0}
            onClearSelectedBlocks={() => {}}
          />

          {/* Shopper bottom strip — KPI / Pie / Place Rankings docked at
              the bottom of the map area, plus a floating Category Rankings
              card pinned to the right rail above the strip's third column
              (the strip itself renders both elements via absolute
              positioning). Renders for the shopper metric whether or not
              an anchor is selected; when an anchor is selected the cards
              scope to that resident anchor's outbound shopping. */}
          {isShopperMetric && (
            <ShopperBottomCardStrip
              // Pass the SELECTION-narrowed flows (not partner-narrowed)
              // so Place Rankings can list the full set of clickable
              // partners; the strip applies its own partner filter for
              // the KPI / Pie / Category cards. When a corridor or OD
              // branch is pinned, layer the click-to-filter on top so
              // every card reads against the pinned flow.
              flows={applyPinnedFlowFilter(
                filterForSelection(directionFilteredFlows, selectedZip, effectiveMode),
              )}
              selectedZip={selectedZip}
              scope={selectedZip ? zips.find((z) => z.zip === selectedZip)?.place ?? selectedZip : 'All Residents'}
              selectedCategories={selectedShopperCategories}
              onSelectCategories={setSelectedShopperCategories}
              selectedPartners={selectedShopperPartners}
              onSelectPartners={setSelectedShopperPartners}
              topProperties={topShopperProperties}
              zips={zips}
              placerYear={placerYear}
              mode={effectiveMode}
            />
          )}

          {/* Bottom card strip (Workers / Visitors).
              · Workers / Visitors with an anchor selected → full anchor
                card set (Workplace Metrics + Top Inflow [+ Outflow / Pass
                Through depending on metric guards]).
              · Visitors with NO anchor selected → strip still renders so
                the Visitor-Type Mix pie card stays visible (anchor-
                specific cards are gated inside the strip on selectedZip).
              · Shoppers → uses ShopperBottomCardStrip above. */}
          {!isShopperMetric && (selectedZip || isVisitorCategory) && (
            <div
              className="absolute left-0 right-0 bottom-0 z-20 pointer-events-auto"
              style={{ paddingBottom: 8 }}
            >
              <ActivityBottomCardStrip
                selectedZip={selectedZip}
                scope={selectedZip ? zips.find((z) => z.zip === selectedZip)?.place ?? selectedZip : ''}
                flowsInbound={directionFilteredInbound}
                flowsOutbound={directionFilteredOutbound}
                placerFlowsInbound={flowsInbound}
                placerAnchors={destAnchors}
                placerYear={placerYear}
                visitorTypePieData={
                  isVisitorCategory && visitorTypePieData
                    ? {
                        regional: visitorTypePieData.regional,
                        tourist: visitorTypePieData.tourist,
                        unit: originSymbolUnit,
                      }
                    : undefined
                }
                workplaceMetricLabels={
                  statsMetricLabels
                    ? isVisitorCategory
                      ? {
                          total: statsMetricLabels.total,
                          unitNoun: metric === 'visitors' ? 'visitors' : 'visits',
                          totalShareNoun:
                            metric === 'visitors' ? 'visitors' : 'visits',
                          crossShareLabel: 'Cross-ZIP visit share',
                          crossShareVerb: 'arrive at',
                          distanceWeighting:
                            metric === 'visitors' ? 'Visitor-weighted' : 'Visit-weighted',
                        }
                      : { total: statsMetricLabels.total }
                    : undefined
                }
                workplaceCommuteDistanceMultiplier={isVisitorCategory ? 1 : 2}
                workplaceCommuteDistanceLabel={
                  isVisitorCategory
                    ? 'Average one-way visit distance'
                    : 'Average roundtrip commute distance'
                }
                zips={zips}
                corridorIndex={corridorIndex}
                corridorNodes={corridorNodes}
                flowIndex={flowIndex}
                driveDistance={driveDistance}
                directionFilter={directionFilter}
                passThroughOrigin={passThroughOrigin}
                passThroughDest={passThroughDest}
                onPassThroughOriginChange={setPassThroughOrigin}
                onPassThroughDestChange={setPassThroughDest}
                hideWorkforceFlows={isVisitorCategory}
                hidePassThrough={isVisitorCategory}
                hideTopOutflow={isVisitorCategory}
                topInflowSubtitle={
                  isVisitorCategory ? 'Where visitors come from' : undefined
                }
                topOutflowSubtitle={
                  isVisitorCategory ? 'Where this destination’s visitors also go' : undefined
                }
              />
            </div>
          )}
        </div>

        {/* Pinned tooltip — full breakdown, docked top-right. Mirrors the
            LODES Workforce map layout: two cards (Places of Residence +
            Places of Work) rendering the same CorridorTooltipBody. The
            aggregation re-derives from the current visibleCorridorMap so
            mode/direction toggles update the panel without dismissing it.
            Partner-click filtering scopes to the residence (origin) side
            since Placer is anchor-destination only. */}
        {pinned && (() => {
          const live =
            visibleCorridorMap.get(pinned.corridorId) ?? pinned.aggregation;
          const partnerClickHandler = selectedZip
            ? (p: { place: string; zips: string[] }) => {
                const isSame = selectedPartner?.place === p.place;
                setHover(null);
                setSelectedPartner(isSame ? null : p);
              }
            : undefined;
          // Shopper view docks the pinned tooltip to the LEFT side of
          // the map (directly to the right of the left-rail panel) so
          // the floating Property/Category Rankings + bottom strip
          // stay visible. Other metrics keep the canonical top-right
          // dock. The user can drag from the header to reposition.
          const dockClass = isShopperMetric
            ? "absolute glass rounded-md px-3 py-2 text-[11px] z-50 top-3 left-3 md:w-[320px] max-h-[70vh] md:max-h-[calc(100vh-280px)] overflow-y-auto"
            : "fixed glass rounded-md px-3 py-2 text-[11px] z-50 top-12 left-2 right-2 md:top-[60px] md:right-4 md:left-auto md:w-[320px] max-h-[70vh] md:max-h-[calc(100vh-280px)] overflow-y-auto";
          return (
            <div
              className={dockClass}
              role="dialog"
              aria-label="Corridor breakdown"
              style={{
                border: '1px solid var(--accent)',
                transform: `translate(${corridorPinnedDrag.offset.x}px, ${corridorPinnedDrag.offset.y}px)`,
              }}
            >
              <div
                className="flex items-start justify-between gap-2 mb-2"
                style={{ cursor: 'move', userSelect: 'none' }}
                onMouseDown={corridorPinnedDrag.onMouseDown}
                title="Drag to reposition"
              >
                <div className="flex-1 min-w-0">
                  <div
                    className="text-[9px] font-semibold uppercase tracking-wider mb-0.5"
                    style={{ color: 'var(--accent)' }}
                  >
                    {selectedZip ? 'Pinned · click ZIP to filter' : 'Pinned'}
                  </div>
                  <span className="font-medium" style={{ color: 'var(--text-h)' }}>
                    {headerFor({ ...pinned, aggregation: live })}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setPinned(null)}
                  aria-label="Close pinned tooltip"
                  className="-mr-1 -mt-1 px-2 py-1 rounded text-xl hover:bg-white/10 shrink-0"
                  style={{ color: 'var(--text-h)', lineHeight: 1 }}
                >
                  ×
                </button>
              </div>

              {/* Card 1 — origin side. Always "Places of Residence" for
                  visitors/workers (origin = home ZIP). For shoppers the
                  origin is the resident anchor that the visitor lives in,
                  so the label still describes residences. */}
              <div
                className="rounded px-2 py-1.5 mb-2"
                style={{
                  background: 'var(--bg-card, rgba(255,255,255,0.03))',
                  border: '1px solid var(--border-soft, rgba(255,255,255,0.08))',
                }}
              >
                <div
                  className="text-[9px] font-semibold uppercase tracking-wider mb-0.5"
                  style={{ color: 'var(--text-h)' }}
                >
                  Places of Residence
                </div>
                <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                  {subheadForDirection({ ...pinned, aggregation: live }, 'residence')}
                </div>
                <CorridorTooltipBody
                  aggregation={live}
                  direction="residence"
                  zips={zips}
                  selectedPartner={selectedPartner}
                  onSelectPartner={partnerClickHandler}
                />
              </div>

              {/* Card 2 — destination side. Workers/visitors → places of
                  work (commute / visit destinations). Shoppers → shopping
                  locations (where the residents are spending). */}
              <div
                className="rounded px-2 py-1.5"
                style={{
                  background: 'var(--bg-card, rgba(255,255,255,0.03))',
                  border: '1px solid var(--border-soft, rgba(255,255,255,0.08))',
                }}
              >
                <div
                  className="text-[9px] font-semibold uppercase tracking-wider mb-0.5"
                  style={{ color: 'var(--text-h)' }}
                >
                  {isShopperMetric ? 'Shopping Locations' : 'Places of Work'}
                </div>
                <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                  {subheadForDirection({ ...pinned, aggregation: live }, 'workplace')}
                </div>
                <CorridorTooltipBody
                  aggregation={live}
                  direction="workplace"
                  zips={zips}
                  selectedPartner={selectedPartner}
                />
              </div>

              <div className="mt-2 text-[10px]" style={{ color: 'var(--text-dim)' }}>
                {live.flows.length} flow{live.flows.length === 1 ? '' : 's'} traverse this corridor
              </div>
            </div>
          );
        })()}

        {/* Hover tooltip — single-line chip showing the corridor + total. */}
        {showHover && hover && (() => {
          const anchor = clampTooltipAnchor(hover.clientX, hover.clientY, 260, 36);
          return (
            <div
              className="fixed glass rounded-md px-3 py-1.5 text-[11px] z-40 pointer-events-none"
              style={{
                left: anchor.left,
                top: anchor.top,
                border: '1px solid var(--accent)',
                color: 'var(--text-h)',
              }}
            >
              {headerFor(hover)}
              <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                Click corridor for breakdown
              </div>
            </div>
          );
        })()}

        {/* Spaghetti hover chip — single-line "Origin → Destination: N
            visits" + nudge to click for breakdown. Suppressed when an OD
            tooltip is pinned to keep the click experience uncluttered. */}
        {odHover && !odPinned && (() => {
          const a = clampTooltipAnchor(odHover.clientX, odHover.clientY, 280, 36);
          return (
            <div
              className="fixed glass rounded-md px-3 py-1.5 text-[11px] z-40 pointer-events-none"
              style={{
                left: a.left,
                top: a.top,
                border: '1px solid var(--accent)',
                color: 'var(--text-h)',
              }}
            >
              <div className="font-medium">
                {odHover.aggregation.originPlace} → {odHover.aggregation.destPlace}
                {' '}— {fmtInt(odHover.aggregation.total)} {tooltipUnit}
              </div>
              <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                Click branch for breakdown
              </div>
            </div>
          );
        })()}

        {/* Spaghetti pinned tooltip — substantive panel anchored near the
            click point with a category breakdown table. Mirrors the
            corridor pinned tooltip's chrome (Pinned label + X to close +
            card containers) so the two views feel like one interaction. */}
        {odPinned && (() => {
          const total = Math.max(odPinned.aggregation.total, 1);
          // Roll the OD's per-category flows into a sorted breakdown.
          const catMap = new Map<string, number>();
          for (const f of odPinned.aggregation.flows) {
            const cat = f.category || 'Other';
            catMap.set(cat, (catMap.get(cat) ?? 0) + f.workerCount);
          }
          const categoryRows = Array.from(catMap.entries())
            .map(([category, value]) => ({ category, value }))
            .sort((x, y) => y.value - x.value);
          // Spaghetti view only exists in shopper mode, so the OD pinned
          // tooltip always docks to the LEFT of the map (same rationale
          // as the corridor pinned override above — keep the floating
          // right-rail cards readable). Drag handle on the header lets
          // the user move it anywhere.
          return (
            <div
              className="absolute glass rounded-md p-3 text-[11px] z-50 top-3 left-3 md:w-[320px] max-h-[70vh] md:max-h-[calc(100vh-280px)] overflow-y-auto"
              role="dialog"
              aria-label="Branch breakdown"
              style={{
                border: '1px solid var(--accent)',
                color: 'var(--text-h)',
                transform: `translate(${odPinnedDrag.offset.x}px, ${odPinnedDrag.offset.y}px)`,
              }}
            >
              <div
                className="flex items-start justify-between gap-2 mb-2"
                style={{ cursor: 'move', userSelect: 'none' }}
                onMouseDown={odPinnedDrag.onMouseDown}
                title="Drag to reposition"
              >
                <div className="min-w-0">
                  <div
                    className="text-[9px] font-semibold uppercase tracking-wider mb-0.5"
                    style={{ color: 'var(--accent)' }}
                  >
                    Pinned
                  </div>
                  <span className="font-medium" style={{ color: 'var(--text-h)' }}>
                    {odPinned.aggregation.originPlace} → {odPinned.aggregation.destPlace}
                    {' '}— {fmtInt(odPinned.aggregation.total)} {tooltipUnit}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setOdPinned(null)}
                  aria-label="Close pinned tooltip"
                  className="-mr-1 -mt-1 px-2 py-1 rounded text-xl hover:bg-white/10 shrink-0"
                  style={{ color: 'var(--text-h)', lineHeight: 1 }}
                >
                  ×
                </button>
              </div>
              <div
                className="rounded px-2 py-1.5"
                style={{
                  background: 'var(--bg-card, rgba(255,255,255,0.03))',
                  border: '1px solid var(--border-soft, rgba(255,255,255,0.08))',
                }}
              >
                <div
                  className="text-[9px] font-semibold uppercase tracking-wider mb-1"
                  style={{ color: 'var(--text-h)' }}
                >
                  Categories
                </div>
                {categoryRows.length === 0 ? (
                  <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                    No category data for this branch.
                  </div>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {categoryRows.map((r) => (
                      <li
                        key={r.category}
                        className="flex items-center gap-2 px-1 py-0.5 rounded"
                      >
                        <span
                          className="text-[10px] truncate flex-1 min-w-0"
                          style={{ color: 'var(--text-h)' }}
                          title={r.category}
                        >
                          {r.category}
                        </span>
                        <span
                          className="text-[10px] tabular-nums w-[60px] text-right shrink-0"
                          style={{ color: 'var(--text-h)' }}
                        >
                          {fmtInt(r.value)}
                        </span>
                        <span
                          className="text-[10px] tabular-nums w-[36px] text-right shrink-0"
                          style={{ color: 'var(--text-dim)' }}
                        >
                          {fmtPct(r.value / total)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })()}
      </main>
    </div>
  );
}

