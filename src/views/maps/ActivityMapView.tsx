// ActivityMapView — Placer.ai Employee Origins corridor map. Hosts the
// slim ActivityCommuteView inside MapShell (so it picks up the subject tab
// strip) and wraps it in `.placer-theme` to override the accent triplet to
// Placer purple for the whole view.

import { useOutletContext } from 'react-router-dom';
import { ActivityCommuteView } from '../ActivityCommuteView';
import { MapShell } from '../../components/MapShell';
import type { AppOutletContext } from '../../App';

export function ActivityMapView() {
  const { data, placer, glenwoodPlacer } = useOutletContext<AppOutletContext>();
  return (
    <MapShell>
      <div
        className="placer-theme"
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        }}
      >
        <ActivityCommuteView data={data} placer={placer} glenwoodPlacer={glenwoodPlacer} />
      </div>
    </MapShell>
  );
}
