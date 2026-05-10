// WorkforceMapView — thin wrapper that hosts the existing CommuteView
// (LODES employment-flow corridors) inside the shared MapShell so it
// gets the subject tab strip on top.

import { useOutletContext } from 'react-router-dom';
import { CommuteView } from '../CommuteView';
import { MapShell } from '../../components/MapShell';
import type { FlowData } from '../../lib/useFlowData';

interface OutletCtx {
  data: FlowData;
}

export function WorkforceMapView() {
  const { data } = useOutletContext<OutletCtx>();
  return (
    <MapShell>
      <CommuteView data={data} />
    </MapShell>
  );
}
