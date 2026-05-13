// HousingMapView — top-level composition for the Housing map.

import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { MapShell } from '../../components/MapShell';
import { SubjectMapCanvas } from '../../components/SubjectMapCanvas';
import { HousingMapTile } from '../../components/maps/HousingMapTile';
import { SubjectMapOverlay } from '../../components/maps/SubjectMapOverlay';
import { HousingMapStrip } from '../../components/maps/HousingMapStrip';
import { HOUSING_METRICS, type HousingMetricId } from '../../components/maps/housingMetrics';
import { useCountyGeometry } from '../../lib/useCountyGeometry';
import { computeWorkforceTotals } from '../../lib/workforceTotals';
import type { AppOutletContext } from '../../App';

export function HousingMapView() {
  const { data, mapState } = useOutletContext<AppOutletContext>();
  const { data: counties } = useCountyGeometry();

  const [metricId, setMetricId] = useState<HousingMetricId>('zhvi');

  const bundle = data.contextBundle?.housing;
  const metric = HOUSING_METRICS.find((m) => m.id === metricId)!;
  const workforce = useMemo(
    () => (bundle ? computeWorkforceTotals(bundle, data.wacFile) : null),
    [bundle, data.wacFile],
  );

  if (!bundle || !workforce) {
    return (
      <MapShell>
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <div
            className="text-[11px] uppercase tracking-wider"
            style={{ color: 'var(--text-dim)' }}
          >
            Housing context data unavailable
          </div>
        </div>
      </MapShell>
    );
  }

  const primaryZip = mapState.selectedZips.size === 1 ? [...mapState.selectedZips][0] : null;
  const primaryCountyGeoid =
    mapState.selectedCountyGeoids.size === 1 ? [...mapState.selectedCountyGeoids][0] : null;

  return (
    <MapShell
      leftPanel={
        <HousingMapTile
          bundle={bundle}
          geoLevel={mapState.geoLevel}
          onGeoLevelChange={mapState.setGeoLevel}
          metricId={metricId}
          onMetricChange={setMetricId}
          mapLayer={mapState.mapLayer}
          onMapLayerChange={mapState.setMapLayer}
          selectedZip={primaryZip}
          selectedCountyGeoid={primaryCountyGeoid}
          countyFilter={mapState.countyFilter}
          onCountyFilterChange={mapState.setCountyFilter}
        />
      }
      bottomStrip={
        <HousingMapStrip
          bundle={bundle}
          metricId={metricId}
          geoLevel={mapState.geoLevel}
          countyFilter={mapState.countyFilter}
          selectedZips={mapState.selectedZips}
          selectedCountyGeoids={mapState.selectedCountyGeoids}
          multiSelect={mapState.multiSelect}
          onMultiSelectChange={mapState.setMultiSelect}
          onToggleZip={mapState.handleToggleZip}
          onToggleCounty={mapState.handleToggleCounty}
          onClearSelections={mapState.clearSelections}
          workforce={workforce}
        />
      }
    >
      <SubjectMapCanvas onClickEmpty={mapState.clearSelections}>
        <SubjectMapOverlay
          subjectId="housing"
          bundle={bundle}
          metric={metric}
          geoLevel={mapState.geoLevel}
          mapLayer={mapState.mapLayer}
          zips={data.zips}
          counties={counties}
          selectedZips={mapState.selectedZips}
          selectedCountyGeoids={mapState.selectedCountyGeoids}
          countyFilter={mapState.countyFilter}
          onSelectZip={mapState.handleSelectZip}
          onSelectCounty={mapState.handleSelectCounty}
        />
      </SubjectMapCanvas>
    </MapShell>
  );
}
