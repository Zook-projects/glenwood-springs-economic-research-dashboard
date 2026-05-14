// ActivityWorkforceSection — dashboard counterpart to the Activity map
// view. Lives inside the Workforce <section> in DashboardView as the
// "Activity (Placer)" sub-anchor. Inherits the dashboard's selectedZip /
// directionFilter so the user's place focus carries across the LODES and
// Placer panels. selectedZip is coerced to one of the Placer destination
// anchors (81601 / 81623); any other selection degrades to the aggregate
// view here. The Workforce-mix bottom-card strip (total-jobs sparkline,
// RAC/WAC composition cards) is intentionally absent — those panels read
// data Placer doesn't publish.

import { useMemo } from 'react';
import type {
  ActiveCorridorAggregation,
  DirectionFilter,
  FlowRow,
  Mode,
} from '../../types/flow';
import type { FlowData } from '../../lib/useFlowData';
import type { PlacerData } from '../../types/placer';
import { toFlowRows } from '../../lib/placerAdapters';
import {
  applySegmentFilter,
  filterByDirection,
  filterForSelection,
} from '../../lib/flowQueries';
import { buildCorridorFlowIndex, buildVisibleCorridorMap } from '../../lib/corridors';
import { StatsAggregated } from '../StatsAggregated';
import { StatsForZip } from '../StatsForZip';
import { MapLinkButton } from '../MapLinkButton';

interface Props {
  data: FlowData;
  placer: PlacerData | null;
  // Dashboard-level selections — shared with the LODES Workforce panel so a
  // chip click on Glenwood Springs (81601) lights both panels up at once.
  selectedZip: string | null;
  directionFilter: DirectionFilter;
}

export function ActivityWorkforceSection({
  data,
  placer,
  selectedZip,
  directionFilter,
}: Props) {
  // flowIndex from `data` is LODES-only and would miss Placer-specific OD
  // pairs (out-of-state visitor origins, gateway-routed flows). Rebuild a
  // Placer-scoped index below so corridor strokes pick up every Placer
  // flow rather than leaving the new ones as dashed off-corridor branches.
  const { zips, corridorIndex, flowsByOdKey, driveDistance } = data;

  // Adapt Placer Employee Counts → FlowRow[] every memo downstream.
  // Returns empty array when the bundle isn't loaded so memos stay stable.
  const flowsInbound = useMemo<FlowRow[]>(() => {
    if (!placer) return [];
    return toFlowRows(placer.employeeCounts, zips, flowsByOdKey);
  }, [placer, zips, flowsByOdKey]);

  const placerAnchors = useMemo(
    () => new Set(placer?.summary.destAnchors ?? []),
    [placer],
  );

  // Synthetic outbound — same row universe filtered to rows whose residence
  // (origin) is itself a Placer anchor. See ActivityCommuteView for the
  // canonical derivation; the rationale + ranking implications match.
  const flowsOutbound = useMemo<FlowRow[]>(
    () => flowsInbound.filter((f) => placerAnchors.has(f.originZip)),
    [flowsInbound, placerAnchors],
  );

  // Placer-scoped corridor flow index — see comment on the destructure above.
  const flowIndex = useMemo(
    () => buildCorridorFlowIndex(flowsInbound, flowsOutbound),
    [flowsInbound, flowsOutbound],
  );
  // Coerce the dashboard's global selectedZip — only the Placer anchors are
  // valid here; everything else degrades to aggregate.
  const placerSelectedZip = useMemo(
    () => (selectedZip && placerAnchors.has(selectedZip) ? selectedZip : null),
    [selectedZip, placerAnchors],
  );

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
  const directionFilteredFlows = directionFilteredInbound;

  const mode: Mode = 'inbound';
  const effectiveMode: Mode = placerSelectedZip ? 'inbound' : 'regional';
  const flows = effectiveMode === 'regional' ? flowsInbound : flowsInbound;

  const visibleFlows = useMemo(
    () => filterForSelection(directionFilteredFlows, placerSelectedZip, effectiveMode),
    [directionFilteredFlows, placerSelectedZip, effectiveMode],
  );

  const topCorridorInbound = useMemo<{ label: string; total: number } | null>(() => {
    if (!corridorIndex || !flowIndex) return null;
    const map = buildVisibleCorridorMap(
      corridorIndex,
      flowIndex,
      directionFilteredInbound,
      'inbound',
    );
    if (map.size === 0) return null;
    let best: ActiveCorridorAggregation | null = null;
    for (const agg of map.values()) if (!best || agg.total > best.total) best = agg;
    return best ? { label: best.corridor.label, total: best.total } : null;
  }, [corridorIndex, flowIndex, directionFilteredInbound]);

  const topCorridorOutbound = useMemo<{ label: string; total: number } | null>(() => {
    if (!corridorIndex || !flowIndex || directionFilteredOutbound.length === 0) return null;
    const map = buildVisibleCorridorMap(
      corridorIndex,
      flowIndex,
      directionFilteredOutbound,
      'outbound',
    );
    if (map.size === 0) return null;
    let best: ActiveCorridorAggregation | null = null;
    for (const agg of map.values()) if (!best || agg.total > best.total) best = agg;
    return best ? { label: best.corridor.label, total: best.total } : null;
  }, [corridorIndex, flowIndex, directionFilteredOutbound]);

  // The host <section id="workforce"> already paints the panel chrome;
  // anchor div renders bare so the IntersectionObserver keys off the id
  // and the layout stacks naturally beneath workforce-od.
  return (
    <div
      id="workforce-activity"
      className="rounded-md p-3 scroll-mt-4"
      style={{
        background: 'var(--panel-surface)',
        border: '1px solid var(--panel-border)',
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex flex-col gap-1 min-w-0">
          <h2
            className="text-base font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-h)' }}
          >
            Activity <span style={{ color: 'var(--text-dim)' }}>· Placer.ai</span>
          </h2>
          {placer && (
            <div
              className="text-[10px] uppercase tracking-wider"
              style={{ color: 'var(--text-dim)' }}
            >
              Employee Origins by ZIP · last built {placer.summary.lastBuilt}
              {placerSelectedZip
                ? ` · scoped to ${placerSelectedZip}`
                : ` · anchors ${placer.summary.destAnchors.join(' + ')}`}
            </div>
          )}
        </div>
        <MapLinkButton subjectId="activity" />
      </div>

      {!placer ? (
        <div
          className="text-xs px-3 py-4 rounded"
          style={{
            background: 'rgba(255,255,255,0.03)',
            color: 'var(--text-dim)',
          }}
        >
          Placer.ai bundle not loaded. Run{' '}
          <code className="px-1 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)' }}>
            python scripts/build-placer.py
          </code>{' '}
          after staging the workbook in <code>data/placer/</code>.
        </div>
      ) : placerSelectedZip == null ? (
        <StatsAggregated
          flowsInbound={flowsInbound}
          flowsOutbound={flowsOutbound}
          directionFilteredInbound={directionFilteredInbound}
          directionFilteredOutbound={directionFilteredOutbound}
          directionFilter={directionFilter}
          topCorridorInbound={topCorridorInbound}
          topCorridorOutbound={topCorridorOutbound}
          zips={zips}
          driveDistance={driveDistance}
          layout="side-by-side"
          defaultExpanded
          whiteLabels
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
          selectedZip={placerSelectedZip}
          selectionKind="anchor"
          nonAnchorBundle={null}
          visibleFlows={visibleFlows}
          bundleFlows={[]}
          mode={mode}
          selectedPartner={null}
          onSelectPartner={() => {}}
          onReset={() => {}}
          slot="lists"
        />
      )}
    </div>
  );
}
