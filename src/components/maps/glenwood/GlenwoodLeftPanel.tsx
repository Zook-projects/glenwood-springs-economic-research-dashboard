// GlenwoodLeftPanel — left-panel content for the Glenwood scope. Renders
// the sub-view header, KPI grid (2 columns), and selection rail of hub/POI
// chips (visible only on Retail Hubs / POIs sub-views).

import { useMemo } from 'react';
import type {
  GlenwoodPlacerData,
  GlenwoodFeatureEntity,
} from '../../../types/placer-glenwood';
import type { GlenwoodSubView } from './GlenwoodSubViewTabs';
import { SubjectKpiCard } from '../SubjectKpiCard';
import { visitationKpis, hubKpis, poiKpis } from './glenwoodMetrics';

interface Props {
  data: GlenwoodPlacerData;
  subView: GlenwoodSubView;
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
      return visitationKpis(data.visitation, latestYear);
    }
    if (subView === 'retailHubs') {
      const all = data.hubs.hubs.flatMap((h) => Object.keys(h.metrics));
      const latestYear = all.length > 0 ? all.sort().reverse()[0] : new Date().getFullYear().toString();
      return hubKpis(data.hubs, selectedHubs, latestYear);
    }
    const all = data.pois.pois.flatMap((p) => Object.keys(p.metrics));
    const latestYear = all.length > 0 ? all.sort().reverse()[0] : new Date().getFullYear().toString();
    return poiKpis(data.pois, selectedPois, latestYear);
  }, [data, subView, selectedHubs, selectedPois]);

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
