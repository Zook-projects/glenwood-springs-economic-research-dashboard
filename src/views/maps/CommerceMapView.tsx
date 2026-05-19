// CommerceMapView — top-level composition for the Commerce map.

import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { MapShell } from '../../components/MapShell';
import { SubjectMapCanvas } from '../../components/SubjectMapCanvas';
import { CommerceMapTile } from '../../components/maps/CommerceMapTile';
import { SubjectMapOverlay } from '../../components/maps/SubjectMapOverlay';
import { CommerceMapStrip } from '../../components/maps/CommerceMapStrip';
import { MultiSelectToolbar } from '../../components/maps/MultiSelectToolbar';
import {
  COMMERCE_METRICS,
  type CommerceVariantId,
  type CommerceCadence,
} from '../../components/maps/commerceMetrics';
import { useCountyGeometry } from '../../lib/useCountyGeometry';
import { computeWorkforceTotals } from '../../lib/workforceTotals';
import { RAMPS } from '../../lib/subjectColorRamps';
import type { AppOutletContext } from '../../App';

export function CommerceMapView() {
  const { data, mapState } = useOutletContext<AppOutletContext>();
  const { data: counties } = useCountyGeometry();

  const [variantId, setVariantId] = useState<CommerceVariantId>('gross');
  const [cadence, setCadence] = useState<CommerceCadence>('annual');

  const bundle = data.contextBundle?.commerce;
  const variant = COMMERCE_METRICS.find((m) => m.id === variantId)!;
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
            Commerce context data unavailable
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
        <CommerceMapTile
          bundle={bundle}
          geoLevel={mapState.geoLevel}
          onGeoLevelChange={mapState.setGeoLevel}
          variantId={variantId}
          onVariantChange={setVariantId}
          cadence={cadence}
          onCadenceChange={setCadence}
          mapLayer={mapState.mapLayer}
          onMapLayerChange={mapState.setMapLayer}
          selectedZip={primaryZip}
          selectedCountyGeoid={primaryCountyGeoid}
          countyFilter={mapState.countyFilter}
          onCountyFilterChange={mapState.setCountyFilter}
        />
      }
      bottomStrip={
        <CommerceMapStrip
          bundle={bundle}
          variantId={variantId}
          cadence={cadence}
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
          subjectId="commerce"
          bundle={bundle}
          metric={variant}
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
            accent={RAMPS.commerce.accent}
          />
        </div>
      </SubjectMapCanvas>
    </MapShell>
  );
}
