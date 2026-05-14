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

import { useEffect, useMemo, useState } from 'react';
import { MapCanvas } from '../components/MapCanvas';
import { ActiveFiltersOverlay } from '../components/ActiveFiltersOverlay';
import { ZipSelector } from '../components/ZipSelector';
import { DirectionToggle } from '../components/DirectionToggle';
import { ModeToggle } from '../components/ModeToggle';
import {
  ActivityMetricToggle,
  type ActivityMetric,
} from '../components/ActivityMetricToggle';
import { StatsAggregated } from '../components/StatsAggregated';
import { StatsForZip } from '../components/StatsForZip';
import { CorridorTooltipBody } from '../components/CorridorTooltipBody';
import { ActivityBottomCardStrip } from '../components/ActivityBottomCardStrip';
import type {
  ActiveCorridorAggregation,
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
  detailForZip,
  filterByDirection,
  filterForSelection,
  isAnchorZip,
  meanCommuteMiles,
  sumDistanceWeightedMiles,
} from '../lib/flowQueries';
import { buildCorridorFlowIndex, buildVisibleCorridorMap } from '../lib/corridors';
import { computeBucketBreaks } from '../lib/arcMath';
import { fmtInt } from '../lib/format';

interface HoverState {
  corridorId: CorridorId;
  aggregation: ActiveCorridorAggregation;
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

export function ActivityCommuteView({ data, placer }: Props) {
  // flowIndex from `data` is built from LODES flows only — it doesn't know
  // about Placer-specific OD pairs (e.g., out-of-state visitor origins
  // routed through GW_E / GW_W). We rebuild a Placer-scoped flowIndex
  // below so every Placer flow with a baked corridorPath shows up on the
  // corridor strokes rather than falling through to the dashed
  // off-corridor branches.
  const { zips, corridorIndex, corridorNodes, flowsByOdKey, driveDistance } = data;

  // Activity metric the left-panel toggle drives:
  //   - workers     → Employee Counts (annual unique workers per OD pair)
  //   - daily-trips → Employee Visits × 2 / 365 (round-trip × annualization)
  //   - trips       → Employee Visits (annual visit count, unscaled)
  // Both source sheets share the same row structure, so the pipeline
  // downstream doesn't care which is active.
  const [metric, setMetric] = useState<ActivityMetric>('workers');

  const placerMetricFile = useMemo(() => {
    if (!placer) return null;
    return metric === 'workers' ? placer.employeeCounts : placer.employeeVisits;
  }, [placer, metric]);

  // Stats-panel label + copy overrides used by StatsAggregated, StatsForZip,
  // and the WorkplaceMetricsCard. Both trip metrics reframe the
  // worker-counting headlines and sub-lines as trip volumes; workers keeps
  // the LODES-style copy. `descriptor` is the unit word that replaces
  // "workforce" / "residents" in cross-zip / outside-* sub-lines (the
  // "of mapped workforce" / "inbound workforce with residence outside…"
  // copy is awkward when the values are trips not workers).
  const statsMetricLabels = useMemo(() => {
    if (metric === 'workers') return undefined;
    if (metric === 'daily-trips') {
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
    // metric === 'trips' — raw annual round-trip volumes.
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
  }, [metric]);

  // Adapt the chosen Placer metric into the FlowRow shape every
  // downstream surface consumes. Placer's workbook publishes one direction
  // (origin = residence, dest = anchor-workplace), so flowsInbound is the
  // canonical projection.
  //
  // Trip scaling: Employee Visits publishes an annual one-way visit count.
  // Both trip metrics multiply by 2 to capture the return leg of each
  // round-trip commute; daily-trips additionally divides by 365 to
  // surface an average-daily volume — the framing TMB / transportation
  // partners actually use. Workers mode passes the raw values through.
  // Stored as floats; fmtInt rounds at display time so aggregations stay
  // precise even at corridor-level rollups.
  const flowsInbound = useMemo<FlowRow[]>(() => {
    if (!placerMetricFile) return [];
    const rows = toFlowRows(placerMetricFile, zips, flowsByOdKey);
    if (metric === 'workers') return rows;
    const denom = metric === 'daily-trips' ? 365 : 1;
    return rows.map((r) => ({
      ...r,
      workerCount: (r.workerCount * 2) / denom,
    }));
  }, [placerMetricFile, zips, flowsByOdKey, metric]);

  const destAnchors = useMemo<readonly string[]>(
    () => placer?.summary.destAnchors ?? [],
    [placer],
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

  // Synthetic outbound dataset — same row universe as flowsInbound, but
  // filtered to rows whose origin (= residence) is itself one of Placer's
  // destination anchors. computeAnchorRankings consumes flowsOutbound by
  // origin, so this yields each Placer anchor's outbound commute count to
  // the other Placer anchor(s). Example: with destAnchors = [81601, 81623],
  // the row (origin = 81601, dest = 81623, value = V) contributes V to
  // 81601's outbound ranking total.
  const flowsOutbound = useMemo<FlowRow[]>(() => {
    if (destAnchors.length === 0) return [];
    const anchorSet = new Set(destAnchors);
    return flowsInbound.filter((f) => anchorSet.has(f.originZip));
  }, [flowsInbound, destAnchors]);
  const flowsRegional = flowsInbound;

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
  const [mode, setMode] = useState<Mode>('inbound');
  const [hover, setHover] = useState<HoverState | null>(null);
  const [pinned, setPinned] = useState<HoverState | null>(null);
  const [suppressedHover, setSuppressedHover] = useState<CorridorId | null>(null);
  // Pass-through cross-filter state for the ActivityBottomCardStrip's
  // PassThroughCard. Shape mirrors LODES — clearing on anchor change keeps
  // the filter from carrying stale selections across switches.
  const [passThroughOrigin, setPassThroughOrigin] = useState<
    { place: string; zips: string[] } | null
  >(null);
  const [passThroughDest, setPassThroughDest] = useState<
    { place: string; zips: string[] } | null
  >(null);

  const effectiveMode: Mode = !selectedZip ? 'regional' : mode;
  const selectionKind: 'aggregate' | 'anchor' = selectedZip ? 'anchor' : 'aggregate';

  const flows =
    effectiveMode === 'regional'
      ? flowsRegional
      : effectiveMode === 'inbound'
        ? flowsInbound
        : flowsOutbound;

  // Direction filter pre-applied to both datasets. applySegmentFilter is
  // called with an inert filter so the call surface mirrors the LODES view
  // even though segment filtering isn't exposed in this UI.
  const directionFilteredInbound = useMemo(
    () =>
      applySegmentFilter(
        filterByDirection(flowsInbound, zips, directionFilter),
        { axis: 'all', buckets: [] },
      ),
    [flowsInbound, zips, directionFilter],
  );
  const directionFilteredOutbound = useMemo(
    () =>
      applySegmentFilter(
        filterByDirection(flowsOutbound, zips, directionFilter),
        { axis: 'all', buckets: [] },
      ),
    [flowsOutbound, zips, directionFilter],
  );
  const directionFilteredRegional = directionFilteredInbound;
  const directionFilteredFlows =
    effectiveMode === 'regional'
      ? directionFilteredRegional
      : effectiveMode === 'inbound'
        ? directionFilteredInbound
        : directionFilteredOutbound;

  const visibleFlows = useMemo(
    () => filterForSelection(directionFilteredFlows, selectedZip, effectiveMode),
    [directionFilteredFlows, selectedZip, effectiveMode],
  );

  // Per-anchor distance / vehicle-miles tile shown below the inbound tile in
  // the left panel. Content varies by metric:
  //   workers     → "Average Commute Distance" (round-trip, miles)
  //   daily-trips → "Average Daily Vehicle Miles" (sum trips × one-way miles)
  //   trips       → "Total Vehicle Miles" (sum trips × one-way miles)
  // Scoped to the selected anchor's flows in the active mode so the tile
  // tracks the headline above it.
  const distanceTile = useMemo(() => {
    if (!selectedZip) return null;
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
    const totalVMT = sumDistanceWeightedMiles(anchorFlows, zips, dd);
    if (metric === 'daily-trips') {
      return {
        label: 'Average Daily Vehicle Miles',
        value: totalVMT > 0 ? `${fmtInt(totalVMT)} mi` : '—',
        sub: 'avg. daily trips × one-way distance · cross-ZIP only',
      };
    }
    // metric === 'trips' — annual round-trip volumes × one-way distance.
    return {
      label: 'Total Vehicle Miles',
      value: totalVMT > 0 ? `${fmtInt(totalVMT)} mi` : '—',
      sub: 'annual trips × one-way distance · cross-ZIP only',
    };
  }, [
    selectedZip,
    selectedPartner,
    mode,
    metric,
    directionFilteredInbound,
    directionFilteredOutbound,
    zips,
    driveDistance,
  ]);

  const referenceCorridorMap = useMemo(() => {
    if (!corridorIndex || !flowIndex) return null;
    return buildVisibleCorridorMap(corridorIndex, flowIndex, flowsInbound, 'inbound');
  }, [corridorIndex, flowIndex, flowsInbound]);

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
    return buildVisibleCorridorMap(corridorIndex, flowIndex, visibleFlows, effectiveMode);
  }, [corridorIndex, flowIndex, visibleFlows, effectiveMode]);

  // Top corridor across the active direction filter (no selection narrowing)
  // — drives the inbound + outbound "Top corridor" tiles in StatsAggregated.
  const topCorridorInbound = useMemo<{ label: string; total: number } | null>(() => {
    if (!corridorIndex || !flowIndex) return null;
    const map = buildVisibleCorridorMap(corridorIndex, flowIndex, directionFilteredInbound, 'inbound');
    if (map.size === 0) return null;
    let best: ActiveCorridorAggregation | null = null;
    for (const agg of map.values()) if (!best || agg.total > best.total) best = agg;
    return best ? { label: best.corridor.label, total: best.total } : null;
  }, [corridorIndex, flowIndex, directionFilteredInbound]);

  const topCorridorOutbound = useMemo<{ label: string; total: number } | null>(() => {
    if (!corridorIndex || !flowIndex || directionFilteredOutbound.length === 0) return null;
    const map = buildVisibleCorridorMap(corridorIndex, flowIndex, directionFilteredOutbound, 'outbound');
    if (map.size === 0) return null;
    let best: ActiveCorridorAggregation | null = null;
    for (const agg of map.values()) if (!best || agg.total > best.total) best = agg;
    return best ? { label: best.corridor.label, total: best.total } : null;
  }, [corridorIndex, flowIndex, directionFilteredOutbound]);

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

  // ESC closes the pinned tooltip from anywhere on the page.
  useEffect(() => {
    if (!pinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPinned(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinned]);

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

  const headerFor = (s: HoverState) =>
    `${s.aggregation.corridor.label} — ${fmtInt(s.aggregation.total)} employees`;
  const subheadForDirection = (
    s: HoverState,
    direction: 'residence' | 'workplace',
  ) =>
    direction === 'residence'
      ? `Employees come from ${s.aggregation.byOriginZip.size} home ZIP(s) through this segment`
      : `Employees travel through here to ${s.aggregation.byDestZip.size} workplace ZIP(s)`;

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
              Valley Commuters
            </h1>
            <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
              Employee Origins by ZIP — 2025
            </div>
          </header>

          <ModeToggle
            mode={mode}
            onChange={handleModeChange}
            aggregate={selectionKind === 'aggregate'}
          />

          <ActivityMetricToggle value={metric} onChange={setMetric} />

          <DirectionToggle value={directionFilter} onChange={handleDirectionChange} />

          <ZipSelector
            zips={zips}
            selectedZip={selectedZip}
            onSelectZip={handleSelectZip}
            hideSearch
            anchorAllowList={destAnchors}
          />

          {selectedZip == null ? (
            <StatsAggregated
              flowsInbound={flowsInbound}
              flowsOutbound={flowsOutbound}
              directionFilteredInbound={directionFilteredInbound}
              directionFilteredOutbound={directionFilteredOutbound}
              directionFilter={directionFilter}
              topCorridorInbound={topCorridorInbound}
              topCorridorOutbound={topCorridorOutbound}
              metricLabels={statsMetricLabels}
              commuteDistanceMultiplier={2}
              zips={zips}
              driveDistance={driveDistance}
              layout="stacked"
            />
          ) : (
            <StatsForZip
              flows={flows}
              directionFilteredFlows={directionFilteredFlows}
              flowsInbound={flowsInbound}
              flowsOutbound={flowsOutbound}
              directionFilteredInbound={directionFilteredInbound}
              directionFilteredOutbound={directionFilteredOutbound}
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
            flows={flowsInbound}
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
            }}
            onClickEmpty={() => {
              setPinned(null);
              setSuppressedHover(hover?.corridorId ?? null);
            }}
            heatmapData={null}
            selectionData={null}
            viewLayer="corridor"
            industrySector="all"
            industryCounty="all"
            wacFile={null}
            blockSelectionActive={false}
            selectedBlocks={new Set()}
            onSelectedBlocksChange={() => {}}
            blockScopeActive={false}
            blocksHidden={false}
            odBlocks={null}
          />

          <ActiveFiltersOverlay
            directionFilter={directionFilter}
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

          {/* Bottom card strip — visible only when an anchor is selected.
              Mirrors the LODES BottomCardStrip layout: 5 cards (Workforce
              Flows, Workplace Metrics, Top Inflow, Top Outflow, Pass
              Through) docked at the bottom of the map, glass-backed so
              the corridor render shows through. */}
          {selectedZip && (
            <div
              className="absolute left-0 right-0 bottom-0 z-20 pointer-events-auto"
              style={{ paddingBottom: 8 }}
            >
              <ActivityBottomCardStrip
                selectedZip={selectedZip}
                scope={zips.find((z) => z.zip === selectedZip)?.place ?? selectedZip}
                flowsInbound={directionFilteredInbound}
                flowsOutbound={directionFilteredOutbound}
                placerFlowsInbound={flowsInbound}
                placerAnchors={destAnchors}
                placerYear={placerYear}
                workplaceMetricLabels={
                  statsMetricLabels && { total: statsMetricLabels.total }
                }
                workplaceCommuteDistanceMultiplier={2}
                workplaceCommuteDistanceLabel="Average roundtrip commute distance"
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
          return (
            <div
              className="fixed glass rounded-md px-3 py-2 text-[11px] z-50 top-12 left-2 right-2 md:top-[60px] md:right-4 md:left-auto md:w-[320px] max-h-[70vh] md:max-h-[calc(100vh-280px)] overflow-y-auto"
              role="dialog"
              aria-label="Corridor breakdown"
              style={{ border: '1px solid var(--accent)' }}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
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

              {/* Card 1 — Places of Residence (byOriginZip). */}
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

              {/* Card 2 — Places of Work (byDestZip). */}
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
                  Places of Work
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
      </main>
    </div>
  );
}

