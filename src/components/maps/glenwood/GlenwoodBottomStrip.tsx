// GlenwoodBottomStrip — switches between the three Glenwood sub-view strips
// and threads the metric (visits / demographics), timeframe, and ranking-
// card cross-filter handlers through to whichever one renders. Each
// downstream strip handles the metric branch internally.

import type { GlenwoodPlacerData } from '../../../types/placer-glenwood';
import type { GlenwoodSubView } from './GlenwoodSubViewTabs';
import type { GlenwoodMetric } from './GlenwoodMetricToggle';
import type { GlenwoodTimeframe } from './GlenwoodTimeframeToggle';
import { GlenwoodVisitationStrip } from './GlenwoodVisitationStrip';
import { GlenwoodRetailHubsStrip } from './GlenwoodRetailHubsStrip';
import { GlenwoodPoisStrip } from './GlenwoodPoisStrip';

export type VisitationFilter = {
  dimension: 'distance' | 'category' | 'overnight';
  // Multi-select within a single dimension. Each key is a specific row
  // label (e.g. "0-25", "Residents") OR the literal "ALL" to indicate a
  // whole-section selection. "ALL" is mutually exclusive with row keys —
  // clicking individual rows replaces "ALL"; clicking the section header
  // replaces any row keys.
  keys: string[];
} | null;

interface Props {
  data: GlenwoodPlacerData;
  subView: GlenwoodSubView;
  metric: GlenwoodMetric;
  timeframe: GlenwoodTimeframe;
  selectedHubs: Set<string>;
  selectedPois: Set<string>;
  visitationFilter: VisitationFilter;
  onVisitationFilterChange: (next: VisitationFilter) => void;
  onToggleHub: (id: string) => void;
  onTogglePoi: (id: string) => void;
}

export function GlenwoodBottomStrip({
  data,
  subView,
  metric,
  timeframe,
  selectedHubs,
  selectedPois,
  visitationFilter,
  onVisitationFilterChange,
  onToggleHub,
  onTogglePoi,
}: Props) {
  if (subView === 'visitation') {
    return (
      <GlenwoodVisitationStrip
        file={data.visitation}
        metric={metric}
        timeframe={timeframe}
        filter={visitationFilter}
        onFilterChange={onVisitationFilterChange}
      />
    );
  }
  if (subView === 'retailHubs') {
    return (
      <GlenwoodRetailHubsStrip
        file={data.hubs}
        selectedIds={selectedHubs}
        onToggleId={onToggleHub}
        metric={metric}
        timeframe={timeframe}
      />
    );
  }
  return (
    <GlenwoodPoisStrip
      file={data.pois}
      selectedIds={selectedPois}
      onToggleId={onTogglePoi}
      metric={metric}
      timeframe={timeframe}
    />
  );
}
