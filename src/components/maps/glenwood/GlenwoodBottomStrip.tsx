// GlenwoodBottomStrip — switches between the three Glenwood sub-view strips
// and threads the metric (visits / demographics) through to whichever one
// renders. Each downstream strip handles the metric branch internally.

import type { GlenwoodPlacerData } from '../../../types/placer-glenwood';
import type { GlenwoodSubView } from './GlenwoodSubViewTabs';
import type { GlenwoodMetric } from './GlenwoodMetricToggle';
import { GlenwoodVisitationStrip } from './GlenwoodVisitationStrip';
import { GlenwoodRetailHubsStrip } from './GlenwoodRetailHubsStrip';
import { GlenwoodPoisStrip } from './GlenwoodPoisStrip';

interface Props {
  data: GlenwoodPlacerData;
  subView: GlenwoodSubView;
  metric: GlenwoodMetric;
  selectedHubs: Set<string>;
  selectedPois: Set<string>;
}

export function GlenwoodBottomStrip({
  data,
  subView,
  metric,
  selectedHubs,
  selectedPois,
}: Props) {
  if (subView === 'visitation') {
    return <GlenwoodVisitationStrip file={data.visitation} metric={metric} />;
  }
  if (subView === 'retailHubs') {
    return (
      <GlenwoodRetailHubsStrip
        file={data.hubs}
        selectedIds={selectedHubs}
        metric={metric}
      />
    );
  }
  return (
    <GlenwoodPoisStrip
      file={data.pois}
      selectedIds={selectedPois}
      metric={metric}
    />
  );
}
