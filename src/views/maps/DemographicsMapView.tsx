// DemographicsMapView — top-level composition for the Demographics map.
// Shared map state (geoLevel, countyFilter, mapLayer, selections,
// multi-select) lives in App.tsx so it persists when switching between
// subject views. Subject-specific state (metricId) stays local.

import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { MapShell } from '../../components/MapShell';
import { SubjectMapCanvas } from '../../components/SubjectMapCanvas';
import { DemographicsMapTile } from '../../components/maps/DemographicsMapTile';
import { SubjectMapOverlay } from '../../components/maps/SubjectMapOverlay';
import { DemographicsMapStrip } from '../../components/maps/DemographicsMapStrip';
import { MultiSelectToolbar } from '../../components/maps/MultiSelectToolbar';
import { DEMOGRAPHICS_METRICS, type DemographicsMetricId } from '../../components/maps/demographicsMetrics';
import { useCountyGeometry } from '../../lib/useCountyGeometry';
import { computeWorkforceTotals } from '../../lib/workforceTotals';
import { RAMPS } from '../../lib/subjectColorRamps';
import type { AppOutletContext } from '../../App';

export function DemographicsMapView() {
  const { data, mapState } = useOutletContext<AppOutletContext>();
  const { data: counties } = useCountyGeometry();

  const [metricId, setMetricId] = useState<DemographicsMetricId>('population');

  const bundle = data.contextBundle?.demographics;
  const metric = DEMOGRAPHICS_METRICS.find((m) => m.id === metricId)!;
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
            Demographics context data unavailable
          </div>
        </div>
      </MapShell>
    );
  }

  // Convenience: tile's headline mini-strip uses the single-selection if
  // exactly one entity is selected, else falls back to the aggregate scope.
  const primaryZip = mapState.selectedZips.size === 1 ? [...mapState.selectedZips][0] : null;
  const primaryCountyGeoid =
    mapState.selectedCountyGeoids.size === 1 ? [...mapState.selectedCountyGeoids][0] : null;

  return (
    <MapShell
      leftPanel={
        <DemographicsMapTile
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
        <DemographicsMapStrip
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
          subjectId="demographics"
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
        <div className="absolute left-3 bottom-3 md:bottom-[284px] pointer-events-auto">
          <MultiSelectToolbar
            multiSelect={mapState.multiSelect}
            onMultiSelectChange={mapState.setMultiSelect}
            totalSelected={mapState.selectedZips.size + mapState.selectedCountyGeoids.size}
            onClearSelections={mapState.clearSelections}
            accent={RAMPS.demographics.accent}
          />
        </div>
      </SubjectMapCanvas>
    </MapShell>
  );
}
