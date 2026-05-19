// GlenwoodLeftPanel — left-panel content for the Glenwood scope. Renders
// the sub-view header, KPI grid (2 columns), and selection rail of hub/POI
// chips (visible only on Retail Hubs / POIs sub-views).

import { useMemo } from 'react';
import type {
  GlenwoodPlacerData,
  GlenwoodFeatureEntity,
} from '../../../types/placer-glenwood';
import type { GlenwoodSubView } from './GlenwoodSubViewTabs';
import type { GlenwoodTimeframe } from './GlenwoodTimeframeToggle';
import type { VisitationFilter } from './GlenwoodBottomStrip';
import { SubjectKpiCard } from '../SubjectKpiCard';
import {
  visitationKpis,
  hubKpis,
  poiKpis,
  findLatestDate,
  timeframeWindows,
  sumInWindow,
  fmtCount,
  poiMonthlyFromOrigins,
} from './glenwoodMetrics';

interface Props {
  data: GlenwoodPlacerData;
  subView: GlenwoodSubView;
  timeframe: GlenwoodTimeframe;
  visitationFilter: VisitationFilter;
  selectedHubs: Set<string>;
  selectedPois: Set<string>;
  onToggleHub: (id: string) => void;
  onTogglePoi: (id: string) => void;
  onClearSelection: () => void;
}

const SUB_VIEW_BLURB: Record<GlenwoodSubView, { title: string; subtitle: string }> = {
  visitation: {
    title: 'Visitation — Glenwood Springs',
    subtitle: 'City-wide visitor demographic profile',
  },
  retailHubs: {
    title: 'Retail Hubs',
    subtitle: 'Eight defined shopping districts',
  },
  pois: {
    title: 'Points of Interest',
    subtitle: 'Eight tourism-focused destinations',
  },
};

function SelectionChips({
  features,
  selected,
  onToggle,
  onClearAll,
  label,
}: {
  features: GlenwoodFeatureEntity[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onClearAll: () => void;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-dim)' }}
        >
          {label}
        </div>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={onClearAll}
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--accent)' }}
          >
            Clear {selected.size}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {features.map((f) => {
          const active = selected.has(f.id);
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onToggle(f.id)}
              className="text-[11px] px-2 py-1 rounded-md transition-colors"
              style={{
                background: active ? 'var(--accent)' : 'rgba(255,255,255,0.04)',
                color: active ? '#1a1207' : 'var(--text)',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--panel-border)'}`,
              }}
              title={f.name}
            >
              {f.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function GlenwoodLeftPanel({
  data,
  subView,
  timeframe,
  visitationFilter,
  selectedHubs,
  selectedPois,
  onToggleHub,
  onTogglePoi,
  onClearSelection,
}: Props) {
  const blurb = SUB_VIEW_BLURB[subView];

  const kpis = useMemo(() => {
    if (subView === 'visitation') {
      const years = data.visitation.annualMetrics.map((m) => m.year);
      const latestYear = years.length > 0 ? Math.max(...years) : new Date().getFullYear();
      const latestDate = findLatestDate(data.visitation.dailyVisits.byType);
      const tw = latestDate ? timeframeWindows(latestDate, timeframe) : null;
      // Match the rankings card subtitle style — present window only, no
      // "vs prior" tail. The YoY chip on each ranking row already conveys
      // the comparison.
      const presentLabel = tw?.subtitle
        ? tw.subtitle.includes(' vs ')
          ? tw.subtitle.split(' vs ')[0]
          : tw.subtitle
        : undefined;
      const base = visitationKpis(
        data.visitation,
        latestYear,
        tw?.window,
        presentLabel,
      );
      // When a ranking row is selected, overwrite Total Visits with the
      // narrowed sum for that row's dimension+key. Other KPIs (median
      // income, household size) are visitor-profile scalars that don't
      // break down by segment, so they stay.
      if (visitationFilter && tw) {
        const keys = visitationFilter.keys;
        const isWholeSection = keys.includes('ALL');
        const rowKeys = keys.filter((k) => k !== 'ALL');
        const keep = (label: string) =>
          isWholeSection || rowKeys.includes(label);
        let filteredRows: { date: string; value: number }[] = [];
        if (visitationFilter.dimension === 'distance') {
          filteredRows = data.visitation.dailyVisits.byDistance
            .filter((r) => keep(r.distance))
            .map((r) => ({ date: r.date, value: r.value }));
        } else if (visitationFilter.dimension === 'category') {
          filteredRows = data.visitation.dailyVisits.byType
            .filter((r) => keep(r.type))
            .map((r) => ({ date: r.date, value: r.value }));
        } else {
          // overnight: only overnight=1 rows exist in the feed
          filteredRows = (data.visitation.dailyVisits.byOvernight ?? []).map((r) => ({
            date: r.date,
            value: r.value,
          }));
        }
        const filteredTotal = sumInWindow(filteredRows, tw.window);
        const sectionTitle: Record<'distance' | 'category' | 'overnight', string> = {
          distance: 'Distance',
          category: 'Category',
          overnight: 'Overnight',
        };
        const segLabel = isWholeSection
          ? `All ${sectionTitle[visitationFilter.dimension]}`
          : rowKeys.length > 1
            ? `${rowKeys.length} ${sectionTitle[visitationFilter.dimension]} selected`
            : visitationFilter.dimension === 'distance'
              ? `${rowKeys[0]} mi`
              : rowKeys[0];
        // Look up the corresponding distance entry for the new
        // distance-aware KPIs. Distance row clicks (single key) and the
        // Overnight row resolve to their own bucket; multi-row, section,
        // and category selections fall back to the 'All' value.
        const daysMap = data.visitation.daysInMarketByDistance ?? {};
        const familyMap = data.visitation.familyHouseholdsPctByDistance ?? {};
        let distanceKey: string | null = null;
        let distanceLabel = 'All distances';
        if (
          visitationFilter.dimension === 'distance' &&
          !isWholeSection &&
          rowKeys.length === 1
        ) {
          distanceKey = `${rowKeys[0]} mi`;
          distanceLabel = distanceKey;
        } else if (visitationFilter.dimension === 'overnight') {
          distanceKey = 'Overnight';
          distanceLabel = 'Overnight';
        }
        const daysVal = distanceKey != null ? daysMap[distanceKey] : undefined;
        const familyVal = distanceKey != null ? familyMap[distanceKey] : undefined;

        return base.map((k) => {
          if (k.label === 'Total Visits') {
            return { ...k, value: fmtCount(filteredTotal), sublabel: `${segLabel} · ${presentLabel ?? tw.subtitle}` };
          }
          if (k.label === 'Avg Days in Market' && daysVal != null) {
            return { ...k, value: `${daysVal.toFixed(1)} days`, sublabel: distanceLabel };
          }
          if (k.label === 'Family HH' && familyVal != null) {
            return { ...k, value: `${(familyVal * 100).toFixed(1)}%`, sublabel: distanceLabel };
          }
          return k;
        });
      }
      return base;
    }
    if (subView === 'retailHubs') {
      const all = data.hubs.hubs.flatMap((h) => Object.keys(h.metrics));
      const latestYear = all.length > 0 ? all.sort().reverse()[0] : new Date().getFullYear().toString();
      const dailyRows = data.hubs.hubs.flatMap((h) => h.dailyVisits ?? []);
      const latestDate = findLatestDate(dailyRows);
      const tw = latestDate ? timeframeWindows(latestDate, timeframe) : null;
      return hubKpis(data.hubs, selectedHubs, latestYear, tw?.window);
    }
    const all = data.pois.pois.flatMap((p) => Object.keys(p.metrics));
    const latestYear = all.length > 0 ? all.sort().reverse()[0] : new Date().getFullYear().toString();
    // POI monthly grain comes from POI_Zipcodes_Visits (origins) rather
    // than the standalone Visits sheet, so window anchoring picks up the
    // longer date range.
    const monthlyRows = data.pois.pois.flatMap((p) => poiMonthlyFromOrigins(p));
    const latestDate = findLatestDate(monthlyRows);
    const tw = latestDate ? timeframeWindows(latestDate, timeframe) : null;
    return poiKpis(data.pois, selectedPois, latestYear, tw?.window);
  }, [data, subView, timeframe, visitationFilter, selectedHubs, selectedPois]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div
          className="text-[13px] font-semibold"
          style={{ color: 'var(--text-h)' }}
        >
          {blurb.title}
        </div>
        <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
          {blurb.subtitle} · Data sourced by Placer.ai
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {kpis.map((k) => (
          <SubjectKpiCard
            key={k.label}
            label={k.label}
            value={k.value}
            sublabel={k.sublabel}
            size="sm"
          />
        ))}
      </div>

      {subView === 'retailHubs' && (
        <SelectionChips
          features={data.hubs.hubs}
          selected={selectedHubs}
          onToggle={onToggleHub}
          onClearAll={onClearSelection}
          label="Retail Hubs"
        />
      )}
      {subView === 'pois' && (
        <SelectionChips
          features={data.pois.pois}
          selected={selectedPois}
          onToggle={onTogglePoi}
          onClearAll={onClearSelection}
          label="Points of Interest"
        />
      )}
    </div>
  );
}
