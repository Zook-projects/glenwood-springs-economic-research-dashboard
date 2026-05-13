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
//   5. Pass through traffic — LODES east↔west I-70 transits at the anchor
//      (regional context; unchanged from the LODES surface).
//
// Workplace Area Characteristics (Age / Wages / NAICS-3) and the workplace
// total-jobs sparkline are intentionally absent — Placer doesn't publish
// the breakdowns those cards depend on.

import { useMemo } from 'react';
import {
  Card,
  PartnerList,
  PassThroughCard,
  WorkplaceMetricsCard,
} from './BottomCardStrip';
import type {
  CorridorFlowEntry,
  CorridorId,
  CorridorRecord,
  DirectionFilter,
  FlowRow,
  PassThroughFile,
  ZipMeta,
} from '../types/flow';
import type { OdPartner } from '../types/lodes';
import type { DriveDistanceMap } from '../lib/flowQueries';
import { fmtInt, fmtPct } from '../lib/format';

interface Props {
  selectedZip: string;
  scope: string;                        // place label of the selected anchor
  flowsInbound: FlowRow[];              // Placer inbound (origin → anchor)
  flowsOutbound: FlowRow[];             // Placer synthetic outbound (anchor → other anchor)
  zips: ZipMeta[];
  corridorIndex: Map<CorridorId, CorridorRecord>;
  flowIndex: Map<CorridorId, CorridorFlowEntry[]>;
  driveDistance: DriveDistanceMap | null;
  // LODES regional pass-through file — unchanged here; the card surfaces
  // I-70 transits at the anchor regardless of which dataset drives the
  // surrounding flow viz.
  passThrough: PassThroughFile | null;
  directionFilter: DirectionFilter;
  // Pass-through cross-filter state, lifted to the parent so it survives
  // anchor switches.
  passThroughOrigin: { place: string; zips: string[] } | null;
  passThroughDest: { place: string; zips: string[] } | null;
  onPassThroughOriginChange: (sel: { place: string; zips: string[] } | null) => void;
  onPassThroughDestChange: (sel: { place: string; zips: string[] } | null) => void;
}

const TOP_PARTNER_LIMIT = 10;

export function ActivityBottomCardStrip({
  selectedZip,
  scope,
  flowsInbound,
  flowsOutbound,
  zips,
  corridorIndex,
  flowIndex,
  driveDistance,
  passThrough,
  directionFilter,
  passThroughOrigin,
  passThroughDest,
  onPassThroughOriginChange,
  onPassThroughDestChange,
}: Props) {
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
  const topInflowPartners = useMemo<OdPartner[]>(() => {
    const rows = flowsInbound
      .filter((f) => f.destZip === selectedZip && f.originZip !== selectedZip)
      .map((f) => ({
        zip: f.originZip,
        place: zipPlaces.get(f.originZip) ?? f.originPlace,
        workers: f.workerCount,
      }));
    rows.sort((a, b) => b.workers - a.workers);
    return rows.slice(0, TOP_PARTNER_LIMIT);
  }, [flowsInbound, selectedZip, zipPlaces]);

  const topOutflowPartners = useMemo<OdPartner[]>(() => {
    const rows = flowsOutbound
      .filter((f) => f.originZip === selectedZip && f.destZip !== selectedZip)
      .map((f) => ({
        zip: f.destZip,
        place: zipPlaces.get(f.destZip) ?? f.destPlace,
        workers: f.workerCount,
      }));
    rows.sort((a, b) => b.workers - a.workers);
    return rows.slice(0, TOP_PARTNER_LIMIT);
  }, [flowsOutbound, selectedZip, zipPlaces]);

  const topInflowPartner = topInflowPartners.find((p) => p.zip !== 'ALL_OTHER') ?? null;
  const topOutflowPartner = topOutflowPartners.find((p) => p.zip !== 'ALL_OTHER') ?? null;

  return (
    <div className="flex gap-3 px-3 md:px-4 pb-3 pt-2 overflow-x-auto">
      <WorkforceFlowsCard
        scope={scope}
        inflow={inflowTotal}
        outflow={outflowTotal}
        within={withinTotal}
      />
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
      />
      <Card
        title={`${scope} · Top inflow`}
        subtitle="Where workers commute from · Placer 2025"
        width={260}
        maxHeight={320}
      >
        <PartnerList
          partners={topInflowPartners}
          denominator={inflowTotal + withinTotal}
          withinZip={
            withinTotal > 0 ? { zip: selectedZip, workers: withinTotal } : undefined
          }
        />
      </Card>
      <Card
        title={`${scope} · Top outflow`}
        subtitle="Where residents commute to · Placer 2025"
        width={260}
        maxHeight={320}
      >
        <PartnerList
          partners={topOutflowPartners}
          denominator={outflowTotal + withinTotal}
          withinZip={
            withinTotal > 0 ? { zip: selectedZip, workers: withinTotal } : undefined
          }
        />
      </Card>
      {passThrough && passThrough.byAnchor[selectedZip] && (
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
      <div className="relative flex flex-col gap-2">
        <div className="flex items-end justify-around gap-2 h-24">
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
