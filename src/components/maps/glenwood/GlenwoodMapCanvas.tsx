// GlenwoodMapCanvas — Glenwood-scoped basemap with hand-digitized hub/POI
// polygons. Reuses SubjectMapCanvas for the basemap + style and pushes the
// feature layers in via map-context once the map is ready.
//
// Layer visibility is driven by the active sub-view:
//   - visitation: city boundary + hub outlines + POI outlines + POI pins + labels
//   - retailHubs: city boundary + hub fills + hub labels
//   - pois:       city boundary + POI fills + POI pins + POI labels + (selected) origins
//
// Selection state is mirrored into MapLibre feature-state on the
// `glenwood-features` source; paint expressions read from there.

import { useEffect, useMemo } from 'react';
import type { LngLatBoundsLike } from 'maplibre-gl';
import { SubjectMapCanvas, useMapProjection } from '../../SubjectMapCanvas';
import type { GlenwoodPlacerData, GlenwoodFeatures } from '../../../types/placer-glenwood';
import type { GlenwoodSubView } from './GlenwoodSubViewTabs';

const GLENWOOD_BOUNDS: LngLatBoundsLike = [
  [-107.45, 39.46],
  [-107.20, 39.62],
];

const COLOR_BOUNDARY = 'rgba(183, 148, 244, 0.85)';
const COLOR_BOUNDARY_FILL = 'rgba(183, 148, 244, 0.05)';
const COLOR_HUB_ACCENT = '#86b3ee';
const COLOR_HUB_FILL_SELECTED = 'rgba(134, 179, 238, 0.45)';
const COLOR_HUB_FILL_DEFAULT = 'rgba(134, 179, 238, 0.12)';
const COLOR_POI_ACCENT = '#FFB454';
const COLOR_POI_FILL_SELECTED = 'rgba(255, 180, 84, 0.45)';
const COLOR_POI_FILL_DEFAULT = 'rgba(255, 180, 84, 0.10)';
const COLOR_ORIGIN_DOT = 'rgba(183, 148, 244, 0.6)';

interface Props {
  data: GlenwoodPlacerData;
  subView: GlenwoodSubView;
  selectedHubs: Set<string>;
  selectedPois: Set<string>;
  onToggleHub: (id: string) => void;
  onTogglePoi: (id: string) => void;
}

// Layer visibility matrix per sub-view.
const LAYER_VISIBILITY: Record<GlenwoodSubView, Record<string, boolean>> = {
  visitation: {
    'gw-boundary-fill': true,
    'gw-boundary-outline': true,
    'gw-hubs-fill': false,
    'gw-hubs-outline': true,
    'gw-hubs-label': true,
    'gw-pois-fill': false,
    'gw-pois-outline': true,
    'gw-pois-pin': true,
    'gw-pois-label': true,
    'gw-poi-origins': false,
  },
  retailHubs: {
    'gw-boundary-fill': true,
    'gw-boundary-outline': true,
    'gw-hubs-fill': true,
    'gw-hubs-outline': true,
    'gw-hubs-label': true,
    'gw-pois-fill': false,
    'gw-pois-outline': false,
    'gw-pois-pin': false,
    'gw-pois-label': false,
    'gw-poi-origins': false,
  },
  pois: {
    'gw-boundary-fill': true,
    'gw-boundary-outline': true,
    'gw-hubs-fill': false,
    'gw-hubs-outline': false,
    'gw-hubs-label': false,
    'gw-pois-fill': true,
    'gw-pois-outline': true,
    'gw-pois-pin': true,
    'gw-pois-label': true,
    'gw-poi-origins': true,
  },
};

function GlenwoodLayerManager({
  features,
  poiOrigins,
  subView,
  selectedIds,
  onClickHub,
  onClickPoi,
}: {
  features: GlenwoodFeatures | null;
  poiOrigins: GeoJSON.FeatureCollection<GeoJSON.Point, { zip: string; visits: number }>;
  subView: GlenwoodSubView;
  selectedIds: Set<string>;
  onClickHub: (id: string) => void;
  onClickPoi: (id: string) => void;
}) {
  const { map } = useMapProjection();

  // One-time: add sources + layers when both the map and the GeoJSON are ready.
  useEffect(() => {
    if (!map || !features) return;
    const ready = () => {
      if (!map.isStyleLoaded()) return false;
      if (!map.getSource('glenwood-features')) {
        map.addSource('glenwood-features', {
          type: 'geojson',
          data: features,
          generateId: true,
        });
      }
      if (!map.getSource('glenwood-poi-origins')) {
        map.addSource('glenwood-poi-origins', {
          type: 'geojson',
          data: poiOrigins,
        });
      }

      const addOnce = (
        id: string,
        spec: maplibregl.LayerSpecification,
      ): void => {
        if (!map.getLayer(id)) map.addLayer(spec);
      };

      addOnce('gw-boundary-fill', {
        id: 'gw-boundary-fill',
        source: 'glenwood-features',
        type: 'fill',
        filter: ['==', ['get', 'kind'], 'city-boundary'],
        paint: { 'fill-color': COLOR_BOUNDARY_FILL },
      });
      addOnce('gw-boundary-outline', {
        id: 'gw-boundary-outline',
        source: 'glenwood-features',
        type: 'line',
        filter: ['==', ['get', 'kind'], 'city-boundary'],
        paint: { 'line-color': COLOR_BOUNDARY, 'line-width': 1.4 },
      });
      addOnce('gw-hubs-fill', {
        id: 'gw-hubs-fill',
        source: 'glenwood-features',
        type: 'fill',
        filter: ['==', ['get', 'kind'], 'hub'],
        paint: {
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            COLOR_HUB_FILL_SELECTED,
            COLOR_HUB_FILL_DEFAULT,
          ],
        },
      });
      addOnce('gw-hubs-outline', {
        id: 'gw-hubs-outline',
        source: 'glenwood-features',
        type: 'line',
        filter: ['==', ['get', 'kind'], 'hub'],
        paint: {
          'line-color': COLOR_HUB_ACCENT,
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            2.4,
            1.2,
          ],
        },
      });
      addOnce('gw-hubs-label', {
        id: 'gw-hubs-label',
        source: 'glenwood-features',
        type: 'symbol',
        filter: ['==', ['get', 'kind'], 'hub'],
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-anchor': 'top',
          'text-offset': [0, 0.4],
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#f5f6f8',
          'text-halo-color': 'rgba(0,0,0,0.85)',
          'text-halo-width': 1.5,
        },
      });
      addOnce('gw-pois-fill', {
        id: 'gw-pois-fill',
        source: 'glenwood-features',
        type: 'fill',
        filter: ['all', ['==', ['get', 'kind'], 'poi'], ['==', ['geometry-type'], 'Polygon']],
        paint: {
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            COLOR_POI_FILL_SELECTED,
            COLOR_POI_FILL_DEFAULT,
          ],
        },
      });
      addOnce('gw-pois-outline', {
        id: 'gw-pois-outline',
        source: 'glenwood-features',
        type: 'line',
        filter: ['all', ['==', ['get', 'kind'], 'poi'], ['==', ['geometry-type'], 'Polygon']],
        paint: {
          'line-color': COLOR_POI_ACCENT,
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            2.4,
            1.2,
          ],
        },
      });
      addOnce('gw-pois-pin', {
        id: 'gw-pois-pin',
        source: 'glenwood-features',
        type: 'circle',
        filter: ['==', ['get', 'kind'], 'poi'],
        paint: {
          'circle-color': COLOR_POI_ACCENT,
          'circle-stroke-color': '#000',
          'circle-stroke-width': 1,
          'circle-radius': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            9,
            6,
          ],
        },
      });
      addOnce('gw-pois-label', {
        id: 'gw-pois-label',
        source: 'glenwood-features',
        type: 'symbol',
        filter: ['==', ['get', 'kind'], 'poi'],
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-anchor': 'top',
          'text-offset': [0, 0.7],
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#f5f6f8',
          'text-halo-color': 'rgba(0,0,0,0.85)',
          'text-halo-width': 1.5,
        },
      });
      addOnce('gw-poi-origins', {
        id: 'gw-poi-origins',
        source: 'glenwood-poi-origins',
        type: 'circle',
        paint: {
          'circle-color': COLOR_ORIGIN_DOT,
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['get', 'visits'],
            0, 2,
            100, 4,
            1000, 7,
            10000, 11,
            50000, 16,
          ],
          'circle-opacity': 0.85,
          'circle-stroke-color': 'rgba(0,0,0,0.4)',
          'circle-stroke-width': 0.5,
        },
      });

      return true;
    };

    if (!ready()) {
      const onLoad = () => {
        if (ready()) map.off('style.load', onLoad);
      };
      map.on('style.load', onLoad);
      return () => {
        map.off('style.load', onLoad);
      };
    }
    return undefined;
  }, [map, features, poiOrigins]);

  // Update sub-view visibility.
  useEffect(() => {
    if (!map) return;
    const vis = LAYER_VISIBILITY[subView];
    for (const [layerId, visible] of Object.entries(vis)) {
      if (!map.getLayer(layerId)) continue;
      try {
        map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
      } catch {
        /* skip */
      }
    }
  }, [map, subView]);

  // Update GeoJSON sources when inputs change (e.g., features arrive late).
  useEffect(() => {
    if (!map || !features) return;
    const src = map.getSource('glenwood-features') as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(features);
  }, [map, features]);

  useEffect(() => {
    if (!map) return;
    const src = map.getSource('glenwood-poi-origins') as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(poiOrigins);
  }, [map, poiOrigins]);

  // Mirror selection into feature-state. Since the source uses generateId,
  // we have to look up feature ids each time the data or selection changes.
  useEffect(() => {
    if (!map || !features) return;
    if (!map.getSource('glenwood-features')) return;
    const allIds = features.features.map((f) => f.properties.id);
    for (const id of allIds) {
      const feat = map.querySourceFeatures('glenwood-features').find(
        (f) => f.properties?.id === id,
      );
      if (!feat || feat.id == null) continue;
      map.setFeatureState(
        { source: 'glenwood-features', id: feat.id },
        { selected: selectedIds.has(id) },
      );
    }
  }, [map, features, selectedIds]);

  // Click handlers.
  useEffect(() => {
    if (!map) return;
    const handleHub = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === 'string') onClickHub(id);
    };
    const handlePoi = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === 'string') onClickPoi(id);
    };
    map.on('click', 'gw-hubs-fill', handleHub);
    map.on('click', 'gw-pois-pin', handlePoi);
    map.on('click', 'gw-pois-fill', handlePoi);
    const setPointer = () => (map.getCanvas().style.cursor = 'pointer');
    const clearPointer = () => (map.getCanvas().style.cursor = '');
    map.on('mouseenter', 'gw-hubs-fill', setPointer);
    map.on('mouseleave', 'gw-hubs-fill', clearPointer);
    map.on('mouseenter', 'gw-pois-pin', setPointer);
    map.on('mouseleave', 'gw-pois-pin', clearPointer);
    return () => {
      map.off('click', 'gw-hubs-fill', handleHub);
      map.off('click', 'gw-pois-pin', handlePoi);
      map.off('click', 'gw-pois-fill', handlePoi);
      map.off('mouseenter', 'gw-hubs-fill', setPointer);
      map.off('mouseleave', 'gw-hubs-fill', clearPointer);
      map.off('mouseenter', 'gw-pois-pin', setPointer);
      map.off('mouseleave', 'gw-pois-pin', clearPointer);
    };
  }, [map, onClickHub, onClickPoi]);

  return null;
}

export function GlenwoodMapCanvas({
  data,
  subView,
  selectedHubs,
  selectedPois,
  onToggleHub,
  onTogglePoi,
}: Props) {
  // Build the POI-origins FeatureCollection from currently selected POIs.
  const poiOrigins = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point, { zip: string; visits: number }>>(() => {
    if (subView !== 'pois' || selectedPois.size === 0) {
      return { type: 'FeatureCollection', features: [] };
    }
    const features: GeoJSON.Feature<GeoJSON.Point, { zip: string; visits: number }>[] = [];
    for (const poi of data.pois.pois) {
      if (!selectedPois.has(poi.id)) continue;
      for (const o of poi.originsLatLng ?? []) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [o.lng, o.lat] },
          properties: { zip: o.zip, visits: o.totalVisits },
        });
      }
    }
    return { type: 'FeatureCollection', features };
  }, [data, subView, selectedPois]);

  // Selected ids = union across hubs/pois — both maps share the same source
  // so we can set feature-state in one pass.
  const selectedIds = useMemo(() => {
    const out = new Set<string>();
    selectedHubs.forEach((id) => out.add(id));
    selectedPois.forEach((id) => out.add(id));
    return out;
  }, [selectedHubs, selectedPois]);

  return (
    <SubjectMapCanvas bounds={GLENWOOD_BOUNDS}>
      <GlenwoodLayerManager
        features={data.features}
        poiOrigins={poiOrigins}
        subView={subView}
        selectedIds={selectedIds}
        onClickHub={onToggleHub}
        onClickPoi={onTogglePoi}
      />
      {!data.features && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            padding: '8px 12px',
            borderRadius: 8,
            background: 'rgba(0,0,0,0.7)',
            border: '1px solid var(--panel-border)',
            color: 'var(--text-dim)',
            fontSize: 11,
            pointerEvents: 'auto',
            maxWidth: 280,
          }}
        >
          Glenwood polygon set not yet authored. Save GeoJSON to{' '}
          <code style={{ color: 'var(--text-h)' }}>
            public/data/placer/glenwood/glenwood-features.geojson
          </code>{' '}
          and refresh.
        </div>
      )}
    </SubjectMapCanvas>
  );
}
