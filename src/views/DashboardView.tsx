// DashboardView — sibling to CommuteView. Surfaces the same LEHD LODES
// dataset as a traditional data view (workforce stats, sortable tables,
// charts) plus the regional context bundle, broken out into topical
// sections (demographics, commerce, housing).
//
// Layout: a sticky left menu lists the four sections (Workforce,
// Demographics, Commerce, Housing) and docks the filter group (Mode,
// Direction, ZIP) at its bottom. The main column scrolls all four
// sections; clicking a menu item smooth-scrolls to that section, and an
// IntersectionObserver highlights the section nearest the menu's
// anchor line as the user scrolls.
//
// Map-only chrome (heatmap, view-layer toggle, hover/pinned tooltips,
// pass-through cross-filter) is intentionally absent — those are spatial
// metaphors with no analogue in a tabular view.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { AppOutletContext } from '../App';
import { SUBJECTS, type SubjectId } from '../config/subjects';
import { MapLinkButton } from '../components/MapLinkButton';
import type {
  DirectionFilter,
  FlowRow,
  Mode,
  SegmentFilter,
  WorkforceCountyFilter,
} from '../types/flow';
import {
  ANCHOR_COUNTY,
  ANCHOR_ZIPS,
  applySegmentFilter,
  filterByDirection,
  filterFlowsByAnchorCounty,
  filterForSelection,
  isAnchorInCounty,
  isAnchorZip,
} from '../lib/flowQueries';
import { buildVisibleCorridorMap } from '../lib/corridors';
import type { FlowData } from '../lib/useFlowData';

import { ModeToggle } from '../components/ModeToggle';
import { DirectionToggle } from '../components/DirectionToggle';
import { StatsAggregated } from '../components/StatsAggregated';
import { StatsForZip } from '../components/StatsForZip';
import { ContextCards, type CommerceVariant, type CommerceCadence } from '../components/ContextCards';
import { CommerceComparisons } from '../components/CommerceComparisons';
import {
  BottomCardStrip,
  CardsForOd,
  perZipBlocks,
} from '../components/BottomCardStrip';
import { FlowDataTables } from '../components/dashboard/FlowDataTables';
import { HousingMarketSection } from '../components/dashboard/HousingMarketSection';
import { DemographicsSection } from '../components/dashboard/DemographicsSection';
import { WorkAreaProfileSection } from '../components/dashboard/WorkAreaProfileSection';
import { CommerceTimeSeriesChart } from '../components/dashboard/CommerceTimeSeriesChart';
import { CommerceDataSetTile } from '../components/dashboard/CommerceDataSetTile';
import { EconomicResearchSection } from '../components/dashboard/EconomicResearchSection';

// Section iteration order in the dashboard (sidebar nav + top-to-bottom
// scroll order). Drives off the shared subjects config so any future
// subject reordering/addition flows automatically into both surfaces.
const SECTIONS = SUBJECTS;
type SectionId = SubjectId;

export function DashboardView() {
  const { data } = useOutletContext<AppOutletContext>();
  const {
    flowsInbound: rawFlowsInbound,
    flowsOutbound: rawFlowsOutbound,
    flowsRegional: rawFlowsRegional,
    zips,
    corridorIndex,
    flowIndex,
    racFile,
    wacFile,
    odSummary,
    driveDistance,
    passThrough,
    contextBundle,
    economicBundle,
  } = data;

  // ----- Filter state (independent of CommuteView) ------------------------
  const [mode, setMode] = useState<Mode>('inbound');
  const [selectedZip, setSelectedZip] = useState<string | null>(null);
  const [nonAnchorBundle, setNonAnchorBundle] =
    useState<{ place: string; zips: string[] } | null>(null);
  const [selectedPartner, setSelectedPartner] =
    useState<{ place: string; zips: string[] } | null>(null);
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');
  const [segmentFilter, setSegmentFilter] = useState<SegmentFilter>({
    axis: 'all',
    buckets: [],
  });
  // Workforce-section county filter. Scopes the anchor chip row and the
  // flow data feeding all Workforce panels (StatsAggregated rankings,
  // StatsForZip cards, RAC/WAC strip, Flow Data tables) to commutes
  // whose anchor-side ZIP belongs to the selected county. 'all' = no
  // filter (default).
  const [workforceCounty, setWorkforceCounty] = useState<WorkforceCountyFilter>('all');

  // Apply the county filter at the source so every downstream derivation
  // (directionFiltered* memos, top-corridor calculations, Stats panels)
  // sees the narrowed flow set automatically.
  const flowsInbound = useMemo(
    () => filterFlowsByAnchorCounty(rawFlowsInbound, workforceCounty),
    [rawFlowsInbound, workforceCounty],
  );
  const flowsOutbound = useMemo(
    () => filterFlowsByAnchorCounty(rawFlowsOutbound, workforceCounty),
    [rawFlowsOutbound, workforceCounty],
  );
  const flowsRegional = useMemo(
    () => filterFlowsByAnchorCounty(rawFlowsRegional, workforceCounty),
    [rawFlowsRegional, workforceCounty],
  );

  // Active menu item — driven by the IntersectionObserver below. Clicking
  // a menu item also sets this directly so the highlight responds before
  // the scroll has finished.
  const [activeSection, setActiveSection] = useState<SectionId>('workforce');

  // Commerce section state — lifted here so the Commerce card and the
  // CommerceComparisons bar charts share a single variant + cadence
  // selection. Defaults: gross sales (broadest "business throughput"
  // metric) and annual cadence (cleaner trend lines).
  const [commerceVariant, setCommerceVariant] = useState<CommerceVariant>('gross');
  const [commerceCadence, setCommerceCadence] = useState<CommerceCadence>('annual');
  // County selection scoped to the Commerce section. Drives the line
  // highlight in CommerceTimeSeriesChart and the place filter in
  // CommerceComparisons' pie chart. null = no county filter (default).
  const [commerceCountyGeoid, setCommerceCountyGeoid] = useState<string | null>(null);
  // Section-local place focus for the Anchor Places bar + Pie. Clicks
  // on those surfaces highlight inside Commerce only — they do NOT
  // touch the dashboard-wide `selectedZip` (which is set by the
  // Workforce section's anchor click and continues to scope Commerce
  // through the existing `selectedZip` prop). Multi-select: clicking
  // a row toggles its membership; clicking an active row deselects it.
  const [commerceFocusZips, setCommerceFocusZips] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleCommerceFocus = (zip: string) => {
    setCommerceFocusZips((prev) => {
      const next = new Set(prev);
      if (next.has(zip)) next.delete(zip); else next.add(zip);
      return next;
    });
  };
  // CommerceTimeSeriesChart + ContextCards still expect a single ZIP. With
  // multi-select, pass the first chosen ZIP so the time-series / KPI tile
  // still has one place to highlight. The bar + pie show the full set.
  const firstCommerceFocusZip = commerceFocusZips.size > 0
    ? Array.from(commerceFocusZips)[0]
    : null;

  // ----- Derived state (mirrors the relevant parts of CommuteView) --------
  const selectionKind: 'aggregate' | 'anchor' | 'non-anchor' = useMemo(() => {
    if (!selectedZip || selectedZip === 'ALL_OTHER') return 'aggregate';
    return isAnchorZip(selectedZip) ? 'anchor' : 'non-anchor';
  }, [selectedZip]);

  // effectiveMode = 'regional' when no anchor is selected; otherwise the
  // user's chosen mode. Mirrors CommuteView's logic.
  const effectiveMode: Mode =
    !selectedZip || selectedZip === 'ALL_OTHER' ? 'regional' : mode;

  const flows: FlowRow[] =
    effectiveMode === 'regional'
      ? flowsRegional
      : effectiveMode === 'inbound'
      ? flowsInbound
      : flowsOutbound;

  const directionFilteredInbound = useMemo(
    () =>
      applySegmentFilter(
        filterByDirection(flowsInbound, zips, directionFilter),
        segmentFilter,
      ),
    [flowsInbound, zips, directionFilter, segmentFilter],
  );
  const directionFilteredOutbound = useMemo(
    () =>
      applySegmentFilter(
        filterByDirection(flowsOutbound, zips, directionFilter),
        segmentFilter,
      ),
    [flowsOutbound, zips, directionFilter, segmentFilter],
  );
  const directionFilteredRegional = useMemo(
    () =>
      applySegmentFilter(
        filterByDirection(flowsRegional, zips, directionFilter),
        segmentFilter,
      ),
    [flowsRegional, zips, directionFilter, segmentFilter],
  );
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

  // Top-corridor headlines for both modes — passed to StatsAggregated.
  const topCorridorInbound = useMemo<{ label: string; total: number } | null>(() => {
    let best: { label: string; total: number } | null = null;
    const map = buildVisibleCorridorMap(corridorIndex, flowIndex, directionFilteredInbound, 'inbound');
    for (const agg of map.values()) {
      if (!best || agg.total > best.total) best = { label: agg.corridor.label, total: agg.total };
    }
    return best;
  }, [corridorIndex, flowIndex, directionFilteredInbound]);
  const topCorridorOutbound = useMemo<{ label: string; total: number } | null>(() => {
    let best: { label: string; total: number } | null = null;
    const map = buildVisibleCorridorMap(corridorIndex, flowIndex, directionFilteredOutbound, 'outbound');
    for (const agg of map.values()) {
      if (!best || agg.total > best.total) best = { label: agg.corridor.label, total: agg.total };
    }
    return best;
  }, [corridorIndex, flowIndex, directionFilteredOutbound]);

  // ----- Per-zip block lookup --------------------------------------------
  // Mirrors BottomCardStrip's internal lookup so the WorkplaceMetricsCard
  // can render inline in the Workforce section's left column. Only active
  // when an anchor ZIP is selected.
  const racEntry = useMemo(
    () =>
      selectedZip && selectionKind === 'anchor'
        ? racFile.entries.find((e) => e.zip === selectedZip) ?? null
        : null,
    [selectedZip, selectionKind, racFile],
  );
  const wacEntry = useMemo(
    () =>
      selectedZip && selectionKind === 'anchor'
        ? wacFile.entries.find((e) => e.zip === selectedZip) ?? null
        : null,
    [selectedZip, selectionKind, wacFile],
  );
  const odEntry = useMemo(
    () =>
      selectedZip && selectionKind === 'anchor'
        ? odSummary.entries.find((e) => e.zip === selectedZip) ?? null
        : null,
    [selectedZip, selectionKind, odSummary],
  );
  const perZipBlockData = useMemo(
    () =>
      selectionKind === 'anchor'
        ? perZipBlocks(racEntry, wacEntry, odEntry, segmentFilter)
        : null,
    [selectionKind, racEntry, wacEntry, odEntry, segmentFilter],
  );
  const anchorScope = useMemo(() => {
    if (selectionKind !== 'anchor' || !selectedZip) return '';
    return (
      odEntry?.place ||
      racEntry?.place ||
      wacEntry?.place ||
      zips.find((z) => z.zip === selectedZip)?.place ||
      selectedZip
    );
  }, [selectionKind, selectedZip, odEntry, racEntry, wacEntry, zips]);
  // ----- Handlers ---------------------------------------------------------
  const handleSelectZip = (z: string | null) => {
    setSelectedZip(z);
    setSelectedPartner(null);
    if (!z || z === 'ALL_OTHER' || isAnchorZip(z)) {
      setNonAnchorBundle(null);
      return;
    }
    const meta = zips.find((x) => x.zip === z);
    if (!meta) {
      setNonAnchorBundle(null);
      return;
    }
    const place = meta.place;
    const siblingZips = zips
      .filter((x) => x.place === place && !x.isSynthetic)
      .map((x) => x.zip)
      .sort();
    setNonAnchorBundle({ place, zips: siblingZips.length ? siblingZips : [z] });
    setMode('inbound');
  };

  const handleResetSelection = () => handleSelectZip(null);

  // Auto-clear the selected anchor (and any partner / non-anchor bundle
  // hanging off it) when the county filter no longer covers it. Keeps the
  // chip row and downstream stats consistent with the visible chip set.
  useEffect(() => {
    if (workforceCounty === 'all') return;
    if (!selectedZip || selectedZip === 'ALL_OTHER') return;
    const anchorCounty = ANCHOR_COUNTY[selectedZip];
    if (anchorCounty === workforceCounty) return;
    setSelectedZip(null);
    setSelectedPartner(null);
    setNonAnchorBundle(null);
  }, [workforceCounty, selectedZip]);

  // ----- Section refs + scroll-spy ----------------------------------------
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Record<SectionId, HTMLElement | null>>({
    workforce: null,
    demographics: null,
    commerce: null,
    economic: null,
    housing: null,
  });

  // IntersectionObserver — highlights whichever section's top is closest
  // to the top of the scroll container. Threshold list at every 10% lets
  // us pick the section with the largest visible ratio at any moment.
  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry whose top is closest to (and at-or-above) the
        // root's top. Falls back to the most-visible entry otherwise.
        let best: { id: SectionId; ratio: number } | null = null;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const id = (e.target as HTMLElement).id as SectionId;
          if (!id) continue;
          if (!best || e.intersectionRatio > best.ratio) {
            best = { id, ratio: e.intersectionRatio };
          }
        }
        if (best) setActiveSection(best.id);
      },
      {
        root,
        // Trigger when a section's top crosses ~64px below the top of
        // the scroll container; bottom margin pulls earlier so a section
        // is "active" once its header has scrolled into view.
        rootMargin: '-64px 0px -50% 0px',
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      },
    );
    for (const id of Object.keys(sectionRefs.current) as SectionId[]) {
      const el = sectionRefs.current[id];
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const handleMenuClick = (id: SectionId) => {
    setActiveSection(id);
    const el = sectionRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const setSectionRef = (id: SectionId) => (el: HTMLElement | null) => {
    sectionRefs.current[id] = el;
  };

  // ----- Layout -----------------------------------------------------------
  return (
    <div
      className="w-full flex-1 flex flex-col md:flex-row md:min-h-0"
      style={{ background: 'var(--bg-base)' }}
    >
      {/* Left menu — sticky on desktop, collapses to a horizontal chip
          row + stacked filter group on mobile. */}
      <aside
        className="glass relative z-10 flex flex-col md:w-[240px] md:shrink-0 md:h-[calc(100vh-2.5rem)] md:sticky md:top-10 md:overflow-y-auto"
        style={{ borderRight: '1px solid var(--panel-border)' }}
      >
        <nav
          className="px-2 py-2 md:py-3 flex md:flex-col gap-1 overflow-x-auto md:overflow-x-visible"
          aria-label="Dashboard sections"
        >
          {SECTIONS.map((s) => {
            const active = s.id === activeSection;
            return (
              <div key={s.id} className="flex flex-col gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => handleMenuClick(s.id)}
                  aria-current={active ? 'true' : undefined}
                  className="text-left px-3 py-2 rounded-md text-[11px] font-medium uppercase tracking-wider transition-colors shrink-0 focus:outline-none focus-visible:ring-1"
                  style={{
                    color: active ? 'var(--accent)' : 'var(--text-h)',
                    background: active ? 'rgba(245, 158, 11, 0.16)' : 'transparent',
                    border: `1px solid ${active ? 'var(--accent)' : 'transparent'}`,
                  }}
                >
                  {s.label}
                </button>
                {/* Nested sub-section anchors — always visible on desktop so
                    users can jump anywhere without first clicking the parent.
                    Each click smooth-scrolls to the sub-section's DOM id,
                    which lives on a wrapper div inside the section component.
                    The parent's active state is the visual cue; sub-links
                    inherit a dimmer color while inactive to keep the menu
                    quiet at rest. */}
                {s.subSections && (
                  <ul
                    className="hidden md:flex flex-col pl-3 gap-0.5"
                    aria-label={`${s.label} sub-sections`}
                  >
                    {s.subSections.map((sub) => (
                      <li key={sub.id}>
                        <button
                          type="button"
                          onClick={() => {
                            const el = document.getElementById(sub.id);
                            if (el) {
                              el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }
                          }}
                          className="text-left w-full px-3 py-1 rounded-md text-[10px] font-medium tracking-wider transition-colors focus:outline-none focus-visible:ring-1"
                          style={{
                            color: active ? 'var(--text-h)' : 'var(--text-dim)',
                            background: 'transparent',
                            border: '1px solid transparent',
                          }}
                        >
                          {sub.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        {/* Global filters — workplace + county chips. Source of truth for
            both the Workforce section's StatsForZip drill-down (existing
            behavior) AND the Zillow Home Value Index subsection's active
            geography. Single-select; clicking the active chip clears it.
            Mounts at the bottom of the desktop sidebar; on mobile it
            stacks below the section nav. */}
        <SidebarFiltersCard
          zips={zips}
          selectedZip={selectedZip}
          onSelectZip={handleSelectZip}
          workforceCounty={workforceCounty}
          onWorkforceCountyChange={setWorkforceCounty}
        />
      </aside>

      {/* Main scrolling content. */}
      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 md:overflow-y-auto"
      >
        <div className="px-3 md:px-4 py-4 flex flex-col gap-4 max-w-[1400px] mx-auto">
          {/* Section — Workforce. Existing Workforce, Jobs & OD Flows panel
              + RAC/WAC strip + Flow Data tables, all under one menu item
              per spec. */}
          <section
            id="workforce"
            ref={setSectionRef('workforce')}
            className="scroll-mt-4 flex flex-col gap-4"
          >
            <div
              id="workforce-overview"
              className="rounded-md p-3 scroll-mt-4"
              style={{
                background: 'var(--panel-surface)',
                border: '1px solid var(--panel-border)',
              }}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <h2
                  className="text-base font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--text-h)' }}
                >
                  Workforce
                </h2>
                <MapLinkButton subjectId="workforce" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <WorkforceAboutCard />
                <WorkforceFiltersCard
                  mode={mode}
                  onModeChange={setMode}
                  modeDisabled={selectionKind === 'non-anchor'}
                  modeAggregate={selectionKind === 'aggregate'}
                  directionFilter={directionFilter}
                  onDirectionChange={setDirectionFilter}
                />
              </div>
              {selectedZip == null || selectedZip === 'ALL_OTHER' ? (
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
                  workforceCounty={workforceCounty}
                />
              ) : selectionKind === 'anchor' && perZipBlockData ? (
                // Anchor view: 1/3 left column (totals + Workforce flows OD chart)
                // + 2/3 right column (Top inflow + Top outflow side by side).
                // The Workplace Metrics card now lives in the BottomCardStrip
                // below alongside the other anchor cards. The grid items
                // stretch to equal heights, and the left column's CardsForOd
                // grows to fill the gap between the (short) totals tiles and
                // the (taller) right-column lists.
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
                  <div className="md:col-span-1 flex flex-col gap-3 min-h-0">
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
                      selectionKind={selectionKind}
                      nonAnchorBundle={nonAnchorBundle}
                      visibleFlows={visibleFlows}
                      bundleFlows={[]}
                      mode={mode}
                      selectedPartner={selectedPartner}
                      onSelectPartner={setSelectedPartner}
                      onReset={handleResetSelection}
                      slot="tiles"
                    />
                    <div className="flex-1 min-h-0 flex flex-col">
                      <CardsForOd
                        scope={anchorScope}
                        inflowLatest={perZipBlockData.inflowLatest}
                        inflowTrend={perZipBlockData.inflowTrend}
                        outflowLatest={perZipBlockData.outflowLatest}
                        outflowTrend={perZipBlockData.outflowTrend}
                        withinLatest={perZipBlockData.withinLatest}
                        withinTrend={perZipBlockData.withinTrend}
                        width="100%"
                        minChartHeight={220}
                        expanded
                      />
                    </div>
                  </div>
                  <div className="md:col-span-2">
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
                      selectionKind={selectionKind}
                      nonAnchorBundle={nonAnchorBundle}
                      visibleFlows={visibleFlows}
                      bundleFlows={[]}
                      mode={mode}
                      selectedPartner={selectedPartner}
                      onSelectPartner={setSelectedPartner}
                      onReset={handleResetSelection}
                      slot="lists"
                    />
                  </div>
                </div>
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
                  selectionKind={selectionKind}
                  nonAnchorBundle={nonAnchorBundle}
                  visibleFlows={visibleFlows}
                  bundleFlows={[]}
                  mode={mode}
                  selectedPartner={selectedPartner}
                  onSelectPartner={setSelectedPartner}
                  onReset={handleResetSelection}
                />
              )}

              {/* Workforce / RAC / WAC strip merged into the Workforce section.
                  BottomCardStrip is rendered with `inline` so its outer
                  wrapper flows normally instead of overlay-positioning at
                  the bottom of the map. The wrapping div sizes naturally
                  to the cards' row height — no min-height needed and no
                  growth pressure on the section above as the viewport
                  widens. */}
              <div
                className="mt-3 pt-3 border-t"
                style={{ borderColor: 'var(--rule)' }}
              >
                <BottomCardStrip
                  racFile={racFile}
                  wacFile={wacFile}
                  odSummary={odSummary}
                  selectedZip={selectedZip}
                  selectionKind={selectionKind}
                  nonAnchorBundle={nonAnchorBundle}
                  visibleFlows={visibleFlows}
                  bundleFlows={[]}
                  selectedPartner={selectedPartner}
                  mode={mode}
                  flowsInbound={directionFilteredInbound}
                  flowsOutbound={directionFilteredOutbound}
                  zips={zips}
                  corridorIndex={corridorIndex}
                  flowIndex={flowIndex}
                  driveDistance={driveDistance}
                  segmentFilter={segmentFilter}
                  onSegmentFilterChange={setSegmentFilter}
                  directionFilter={directionFilter}
                  passThrough={passThrough}
                  passThroughOrigin={null}
                  passThroughDest={null}
                  onPassThroughOriginChange={() => {}}
                  onPassThroughDestChange={() => {}}
                  cardLayer="commute"
                  contextBundle={contextBundle}
                  hidePartnerCards
                  hideOdFlows={selectionKind === 'anchor'}
                  hideSegmentFilter={selectionKind === 'aggregate'}
                  inline
                />
              </div>
            </div>

            {/* Work Area Profile — workplace-area employment composition for
                the active scope. Inserted between the BottomCardStrip's
                glanceable 3-bucket NAICS cards and the FlowDataTables so the
                user reads "what does this workplace area look like" before
                "where do its workers come from / go to". */}
            <div id="workforce-wap" className="scroll-mt-4">
              <WorkAreaProfileSection
                wacFile={wacFile}
                selectedZip={selectedZip}
                selectionKind={selectionKind}
                workforceCounty={workforceCounty}
              />
            </div>

            {/* Flow data tables. */}
            <div id="workforce-od" className="scroll-mt-4">
            <FlowDataTables
              flowsInbound={flowsInbound}
              flowsOutbound={flowsOutbound}
              flowsRegional={flowsRegional}
              activeFlows={directionFilteredFlows}
              zips={zips}
              corridorIndex={corridorIndex}
              flowIndex={flowIndex}
              mode={effectiveMode}
              selectedZip={selectedZip}
              onSelectZip={handleSelectZip}
              onSelectPartner={setSelectedPartner}
            />
            </div>

          </section>

          {/* Section — Demographics: full ACS panel modeled on Housing.
              Surfaces what `demographics.json` and `education.json` already
              publish but the prior ContextCards row was hiding — population
              + income trends, age cohort distribution + aging trajectory,
              race composition + Hispanic share, household composition. */}
          <section
            id="demographics"
            ref={setSectionRef('demographics')}
            className="scroll-mt-4 rounded-md p-3"
            style={{
              background: 'var(--panel-surface)',
              border: '1px solid var(--panel-border)',
            }}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <h2
                className="text-base font-semibold uppercase tracking-wider"
                style={{ color: 'var(--text-h)' }}
              >
                Demographics
              </h2>
              <MapLinkButton subjectId="demographics" />
            </div>
            <div id="demographics-us-census" className="scroll-mt-4">
              <DemographicsSection
                bundle={contextBundle}
                selectedZip={selectedZip}
                workforceCounty={workforceCounty}
              />
            </div>
          </section>

          {/* Section — Housing Market: full Zillow ZHVI panel (headline stats,
              time series, radar, type bars, city comparison filter), plus
              SDO/NHGIS housing-units trend, characteristics tile, cost
              burden, and affordability ratio. Sits between Demographics and
              Commerce so the residential picture is grouped with the
              population picture before the economic-activity sections. */}
          <section
            id="housing"
            ref={setSectionRef('housing')}
            className="scroll-mt-4 rounded-md p-3"
            style={{
              background: 'var(--panel-surface)',
              border: '1px solid var(--panel-border)',
            }}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <h2
                className="text-base font-semibold uppercase tracking-wider"
                style={{ color: 'var(--text-h)' }}
              >
                Housing Market
              </h2>
              <MapLinkButton subjectId="housing" />
            </div>
            <HousingMarketSection
              bundle={contextBundle}
              selectedZip={selectedZip}
              workforceCounty={workforceCounty}
            />
          </section>

          {/* Section — Commerce: 2-column grid. Left = real timeseries chart
              (zero y-axis baseline, hover tooltip). Right = headline KPI
              card on top, then Counties bar chart, then (Anchor places +
              Place share of county) side-by-side. All four surfaces share
              the variant + cadence toggle lifted into DashboardView state. */}
          <section
            id="commerce"
            ref={setSectionRef('commerce')}
            className="scroll-mt-4 rounded-md p-3"
            style={{
              background: 'var(--panel-surface)',
              border: '1px solid var(--panel-border)',
            }}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <h2
                className="text-base font-semibold uppercase tracking-wider"
                style={{ color: 'var(--text-h)' }}
              >
                Commerce
              </h2>
              <MapLinkButton subjectId="commerce" />
            </div>
            {/* The section is split into two row-grids that share a column
                template (1fr / 1.2fr — chart narrower so the comparison
                cards on the right have more horizontal room). Row 1 pairs
                the data-set descriptor with the headline KPI strip; both
                cells stretch to a common height (CSS grid default), so the
                two cards visually match. Row 2 pairs the timeseries chart
                with the comparison stack; the chart card flex-grows its
                inner SVG so it fills the comparison stack's height. */}
            <div id="commerce-cdor" className="flex flex-col gap-3 scroll-mt-4">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] grid-cols-1">
                <CommerceDataSetTile />
                <div className="flex flex-wrap gap-3 min-w-0">
                  <ContextCards
                    bundle={contextBundle}
                    selectedZip={firstCommerceFocusZip ?? selectedZip}
                    racFile={racFile}
                    wacFile={wacFile}
                    odSummary={odSummary}
                    topics={['commerce']}
                    commerceVariant={commerceVariant}
                    onCommerceVariantChange={setCommerceVariant}
                    commerceCadence={commerceCadence}
                    onCommerceCadenceChange={setCommerceCadence}
                    hideCommerceSparkline
                    largeCommerce
                  />
                </div>
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] grid-cols-1 items-stretch">
                <CommerceTimeSeriesChart
                  bundle={contextBundle}
                  selectedZip={firstCommerceFocusZip ?? selectedZip}
                  variant={commerceVariant}
                  cadence={commerceCadence}
                  onCadenceChange={setCommerceCadence}
                  highlightCountyGeoid={commerceCountyGeoid}
                />
                <div className="min-w-0">
                  <CommerceComparisons
                    bundle={contextBundle}
                    selectedZip={selectedZip}
                    variant={commerceVariant}
                    commerceFocusZips={commerceFocusZips}
                    onToggleCommerceFocus={toggleCommerceFocus}
                    selectedCountyGeoid={commerceCountyGeoid}
                    onSelectCounty={setCommerceCountyGeoid}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Section — Economic Research: national-only datasets framing
              the long-arc forces shaping local ED strategy. First sub-block
              is BLS CES Table 1300 (income / income tax / spending by age
              cohort) per the NWCCOG Economic Summit framing. */}
          <section
            id="economic"
            ref={setSectionRef('economic')}
            className="scroll-mt-4 rounded-md p-3"
            style={{
              background: 'var(--panel-surface)',
              border: '1px solid var(--panel-border)',
            }}
          >
            <h2
              className="text-base font-semibold uppercase tracking-wider mb-3"
              style={{ color: 'var(--text-h)' }}
            >
              Economic Research
            </h2>
            <div id="economic-ces" className="scroll-mt-4">
              <EconomicResearchSection bundle={economicBundle} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// About-this-data card for the Workforce, Jobs & OD Flows section. Mirrors
// the HousingMarketSection AboutDataCard pattern: a nested rounded panel
// holding a short LODES description plus a compact metadata grid (Source /
// Metric / Cadence / Coverage). Always visible — the deeper methodology
// notes still live in MethodologyFooter beneath the map view.
// ---------------------------------------------------------------------------
function WorkforceAboutCard() {
  return (
    <div
      className="rounded-md p-3 flex flex-col gap-2"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--panel-border)',
      }}
    >
      <div>
        <div
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-h)' }}
        >
          About this data
        </div>
        <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
          LEHD Origin–Destination Employment Statistics (LODES)
        </div>
      </div>
      <p className="text-[11px] leading-snug" style={{ color: 'var(--text)' }}>
        LODES synthesizes Census Bureau unemployment-insurance wage records,
        federal employment files, and demographic data into annual job counts
        paired by residence ZIP and workplace ZIP. Coverage uses job-type
        JT00 — primary plus secondary jobs (a worker holding two jobs is
        counted twice) and federal civilian jobs — but excludes self-employed,
        military, and informal labor. Resort-area workforce (Aspen / Snowmass
        / Basalt corridor) is a known LEHD undercount because seasonal, J-1,
        and 1099 contractor labor falls outside the QCEW UI coverage that
        feeds LODES; figures for 81611, 81615, 81621, and 81654 should be
        read as a floor rather than a census.
      </p>
      <ul className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1 mt-1">
        <li className="flex flex-col">
          <span
            className="text-[9px] uppercase tracking-wider"
            style={{ color: 'var(--text-dim)' }}
          >
            Source
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-h)' }}>
            U.S. Census Bureau · LEHD LODES v8
          </span>
        </li>
        <li className="flex flex-col">
          <span
            className="text-[9px] uppercase tracking-wider"
            style={{ color: 'var(--text-dim)' }}
          >
            Metric
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-h)' }}>
            OD job counts (JT00 · all jobs)
          </span>
        </li>
        <li className="flex flex-col">
          <span
            className="text-[9px] uppercase tracking-wider"
            style={{ color: 'var(--text-dim)' }}
          >
            Cadence
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-h)' }}>
            Annual · ~2-year release lag
          </span>
        </li>
        <li className="flex flex-col">
          <span
            className="text-[9px] uppercase tracking-wider"
            style={{ color: 'var(--text-dim)' }}
          >
            Coverage
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-h)' }}>
            2002 → 2023 · Colorado
          </span>
        </li>
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filters card — sibling of WorkforceAboutCard inside the Workforce section.
// Hosts the Mode + Direction toggles on the left and the Workplaces (anchor
// ZIP chips) on the right. Replaces the sidebar filter dock so all filter
// affordances live next to the data they scope.
// ---------------------------------------------------------------------------
function WorkforceFiltersCard({
  mode,
  onModeChange,
  modeDisabled,
  modeAggregate,
  directionFilter,
  onDirectionChange,
}: {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  modeDisabled: boolean;
  modeAggregate: boolean;
  directionFilter: DirectionFilter;
  onDirectionChange: (d: DirectionFilter) => void;
}) {
  return (
    <div
      className="rounded-md p-3 flex flex-col gap-3"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--panel-border)',
      }}
    >
      <div
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--text-h)' }}
      >
        Filters
      </div>
      <ModeToggle
        mode={mode}
        onChange={onModeChange}
        disabled={modeDisabled}
        aggregate={modeAggregate}
      />
      <DirectionToggle
        value={directionFilter}
        onChange={onDirectionChange}
      />
      <div
        className="text-[10px]"
        style={{ color: 'var(--text-dim)' }}
      >
        Workplace + county filters live in the left sidebar.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SidebarFiltersCard — workplace + county chips mounted at the bottom of the
// left aside. Single source of truth for `selectedZip` (workplace) and
// `workforceCounty` (county). Both Workforce and the Zillow Home Value Index
// subsection read these. Single-select; clicking the active chip clears it.
// ---------------------------------------------------------------------------
const SIDEBAR_COUNTY_OPTIONS: ReadonlyArray<{ key: WorkforceCountyFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'garfield', label: 'Garfield' },
  { key: 'pitkin', label: 'Pitkin' },
  { key: 'eagle', label: 'Eagle' },
];

function SidebarFiltersCard({
  zips,
  selectedZip,
  onSelectZip,
  workforceCounty,
  onWorkforceCountyChange,
}: {
  zips: FlowData['zips'];
  selectedZip: string | null;
  onSelectZip: (z: string | null) => void;
  workforceCounty: WorkforceCountyFilter;
  onWorkforceCountyChange: (c: WorkforceCountyFilter) => void;
}) {
  const anchorChips = ANCHOR_ZIPS
    .map((z) => zips.find((x) => x.zip === z))
    .filter((z): z is FlowData['zips'][number] => !!z)
    .filter((z) => isAnchorInCounty(z.zip, workforceCounty));

  return (
    <div
      className="px-3 py-3 md:mt-auto flex flex-col gap-3"
      style={{ borderTop: '1px solid var(--panel-border)' }}
    >
      <div
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--text-h)' }}
      >
        Filters
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span
            className="text-[10px] font-medium uppercase tracking-wider"
            style={{ color: 'var(--text-dim)' }}
          >
            Workplace · ZIP
          </span>
          {selectedZip && (
            <button
              type="button"
              onClick={() => onSelectZip(null)}
              aria-label="Reset workplace selection"
              className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded focus:outline-none focus-visible:ring-1"
              style={{ color: 'var(--accent)' }}
            >
              Reset
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Workplace ZIPs">
          {anchorChips.map((z) => {
            const active = selectedZip === z.zip;
            return (
              <button
                key={z.zip}
                type="button"
                aria-pressed={active}
                aria-label={`${z.place}, ZIP ${z.zip}${active ? ' (selected)' : ''}`}
                onClick={() => onSelectZip(active ? null : z.zip)}
                className="text-[10px] px-1.5 py-1 rounded-md border transition-colors focus:outline-none focus-visible:ring-1"
                style={{
                  background: active ? 'var(--accent)' : 'rgba(255,255,255,0.04)',
                  color: active ? '#1a1207' : 'var(--text-h)',
                  borderColor: active ? 'var(--accent)' : 'var(--panel-border)',
                }}
                title={`${z.place} (${z.zip})`}
              >
                {z.place}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span
          className="text-[10px] font-medium uppercase tracking-wider"
          style={{ color: 'var(--text-dim)' }}
        >
          County
        </span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="County filter">
          {SIDEBAR_COUNTY_OPTIONS.map((opt) => {
            const active = workforceCounty === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                aria-pressed={active}
                onClick={() => onWorkforceCountyChange(opt.key)}
                className="text-[10px] px-2 py-1 rounded-md border transition-colors focus:outline-none focus-visible:ring-1"
                style={{
                  background: active ? 'var(--accent)' : 'rgba(255,255,255,0.04)',
                  color: active ? '#1a1207' : 'var(--text-h)',
                  borderColor: active ? 'var(--accent)' : 'var(--panel-border)',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
