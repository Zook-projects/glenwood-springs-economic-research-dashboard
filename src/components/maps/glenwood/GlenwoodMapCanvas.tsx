// GlenwoodMapCanvas — Glenwood-scoped basemap with hand-digitized hub/POI
// polygons. Reuses SubjectMapCanvas for the basemap + style and pushes the
// feature layers in via map-context once the map is ready.
//
// Layer visibility is driven by the active sub-view:
//   - visitation: city boundary + hub fills + hub outlines + POI center pins
//   - retailHubs: city boundary + hub fills + hub outlines
//   - pois:       city boundary + POI fills + POI outlines
//
// Labels are hidden in every view; a shared hover tooltip surfaces the
// property name + visits over the active timeframe window.
//
// Selection state is mirrored into MapLibre feature-state on the
// `glenwood-features` source; paint expressions read from there.

import { useEffect, useMemo, useState } from 'react';
import type { LngLatBoundsLike } from 'maplibre-gl';
import { SubjectMapCanvas, useMapProjection } from '../../SubjectMapCanvas';
import type { GlenwoodPlacerData, GlenwoodFeatures } from '../../../types/placer-glenwood';
import type { GlenwoodSubView } from './GlenwoodSubViewTabs';
import type { GlenwoodTimeframe } from './GlenwoodTimeframeToggle';
import {
  findLatestDate,
  fmtCount,
  HUB_PALETTE,
  POI_PALETTE,
  poiMonthlyFromOrigins,
  timeframeWindows,
  totalVisitsInWindow,
} from './glenwoodMetrics';

const GLENWOOD_BOUNDS: LngLatBoundsLike = [
  [-107.45, 39.46],
  [-107.20, 39.62],
];

const COLOR_BOUNDARY = 'rgba(183, 148, 244, 0.85)';
const COLOR_BOUNDARY_FILL = 'rgba(183, 148, 244, 0.05)';
// Hub + POI boundaries and POI markers all render in white by default.
// Selection swaps in the entity's palette color via ['get', 'color'] in
// the paint expressions below.
const COLOR_HUB_ACCENT = '#ffffff';
const COLOR_HUB_FILL_DEFAULT = 'rgba(255, 255, 255, 0.12)';
const COLOR_POI_ACCENT = '#ffffff';
const COLOR_POI_FILL_DEFAULT = 'rgba(255, 255, 255, 0.12)';
const COLOR_ORIGIN_DOT = 'rgba(183, 148, 244, 0.6)';

interface Props {
  data: GlenwoodPlacerData;
  subView: GlenwoodSubView;
  // Accepted for future feature-coloring (e.g., color hubs by window
  // totals). Currently unused — the basemap stays the same across
  // timeframes. Keeping it threaded so we can wire it in without
  // touching the call site.
  timeframe: GlenwoodTimeframe;
  selectedHubs: Set<string>;
  selectedPois: Set<string>;
  onToggleHub: (id: string) => void;
  onTogglePoi: (id: string) => void;
}

// Layer visibility matrix per sub-view. Labels are hidden everywhere —
// hover tooltip surfaces the property name + visits instead.
const LAYER_VISIBILITY: Record<GlenwoodSubView, Record<string, boolean>> = {
  visitation: {
    'gw-boundary-fill': true,
    'gw-boundary-outline': true,
    'gw-hubs-fill': true,
    'gw-hubs-outline': true,
    'gw-hubs-label': false,
    'gw-pois-fill': false,
    'gw-pois-outline': false,
    'gw-pois-pin': true,
    'gw-pois-label': false,
    'gw-poi-origins': false,
  },
  retailHubs: {
    'gw-boundary-fill': true,
    'gw-boundary-outline': true,
    'gw-hubs-fill': true,
    'gw-hubs-outline': true,
    'gw-hubs-label': false,
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
    'gw-pois-pin': false,
    'gw-pois-label': false,
    'gw-poi-origins': false,
  },
};

interface HoverInfo {
  id: string;
  name: string;
  x: number;
  y: number;
}

function GlenwoodLayerManager({
  features,
  poiOrigins,
  subView,
  selectedIds,
  onClickHub,
  onClickPoi,
  onHover,
}: {
  features: GlenwoodFeatures | null;
  poiOrigins: GeoJSON.FeatureCollection<GeoJSON.Point, { zip: string; visits: number }>;
  subView: GlenwoodSubView;
  selectedIds: Set<string>;
  onClickHub: (id: string) => void;
  onClickPoi: (id: string) => void;
  onHover: (info: HoverInfo | null) => void;
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
          // Selected hubs paint in their palette color so the boundary on
          // the map matches the ranking-card legend; default = the white
          // wash everywhere else.
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            ['to-color', ['get', 'color']],
            COLOR_HUB_FILL_DEFAULT,
          ],
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            0.4,
            1.0,
          ],
        },
      });
      addOnce('gw-hubs-outline', {
        id: 'gw-hubs-outline',
        source: 'glenwood-features',
        type: 'line',
        filter: ['==', ['get', 'kind'], 'hub'],
        paint: {
          'line-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            ['to-color', ['get', 'color']],
            COLOR_HUB_ACCENT,
          ],
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
          // See `gw-hubs-fill` for the selected-color rationale.
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            ['to-color', ['get', 'color']],
            COLOR_POI_FILL_DEFAULT,
          ],
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            0.4,
            1.0,
          ],
        },
      });
      addOnce('gw-pois-outline', {
        id: 'gw-pois-outline',
        source: 'glenwood-features',
        type: 'line',
        filter: ['all', ['==', ['get', 'kind'], 'poi'], ['==', ['geometry-type'], 'Polygon']],
        paint: {
          'line-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            ['to-color', ['get', 'color']],
            COLOR_POI_ACCENT,
          ],
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
        // Restrict to Point geometry so each POI gets exactly one marker
        // (rendered at the centroid emitted by build-glenwood-features.py);
        // without this filter, MapLibre's circle layer would draw one circle
        // per polygon vertex.
        filter: ['all', ['==', ['get', 'kind'], 'poi'], ['==', ['geometry-type'], 'Point']],
        paint: {
          'circle-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            ['to-color', ['get', 'color']],
            COLOR_POI_ACCENT,
          ],
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
        // Same as the pin layer — label off the Point feature so each POI
        // gets a single label at its centroid, not one per polygon vertex.
        filter: ['all', ['==', ['get', 'kind'], 'poi'], ['==', ['geometry-type'], 'Point']],
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

      // Apply the current sub-view's visibility — the separate visibility
      // effect runs once on mount before these layers exist, so without this
      // line layers would all stay 'visible' until subView next changes.
      const initialVis = LAYER_VISIBILITY[subView];
      for (const [layerId, visible] of Object.entries(initialVis)) {
        try {
          map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
        } catch {
          /* skip */
        }
      }

      return true;
    };

    if (!ready()) {
      // isStyleLoaded() can stay false while the basemap's hillshade tiles
      // load; relying on `style.load` alone misses the window because it
      // already fired before this effect attached. `idle` fires after every
      // render cycle once the map settles, so we'll retry on the next idle
      // until ready() succeeds.
      const onIdle = () => {
        if (ready()) map.off('idle', onIdle);
      };
      map.on('idle', onIdle);
      return () => {
        map.off('idle', onIdle);
      };
    }
    return undefined;
  }, [map, features, poiOrigins, subView]);

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

  // Click + hover handlers. Hover is tracked across hub-fill, poi-fill, and
  // poi-pin layers — when the cursor leaves all three, the tooltip clears.
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

    const hoverLayers = ['gw-hubs-fill', 'gw-pois-fill', 'gw-pois-pin'] as const;
    const hovered = new Set<string>();
    const handleMove = (
      layer: string,
      e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] },
    ) => {
      const props = e.features?.[0]?.properties;
      if (!props || typeof props.id !== 'string' || typeof props.name !== 'string') return;
      onHover({ id: props.id, name: props.name, x: e.point.x, y: e.point.y });
      hovered.add(layer);
      map.getCanvas().style.cursor = 'pointer';
    };
    const handleLeave = (layer: string) => {
      hovered.delete(layer);
      if (hovered.size === 0) {
        onHover(null);
        map.getCanvas().style.cursor = '';
      }
    };

    const moveHandlers: Record<string, (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void> = {};
    const leaveHandlers: Record<string, () => void> = {};
    for (const layer of hoverLayers) {
      moveHandlers[layer] = (e) => handleMove(layer, e);
      leaveHandlers[layer] = () => handleLeave(layer);
      map.on('mousemove', layer, moveHandlers[layer]);
      map.on('mouseleave', layer, leaveHandlers[layer]);
    }

    return () => {
      map.off('click', 'gw-hubs-fill', handleHub);
      map.off('click', 'gw-pois-pin', handlePoi);
      map.off('click', 'gw-pois-fill', handlePoi);
      for (const layer of hoverLayers) {
        map.off('mousemove', layer, moveHandlers[layer]);
        map.off('mouseleave', layer, leaveHandlers[layer]);
      }
    };
  }, [map, onClickHub, onClickPoi, onHover]);

  return null;
}

export function GlenwoodMapCanvas({
  data,
  subView,
  timeframe,
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

  // Per-entity color, matching the ranking-card palettes. When a hub or
  // POI is selected, the map paints the boundary in this color; the
  // strips read from the same HUB_PALETTE / POI_PALETTE so the legend
  // and the map agree feature-by-feature.
  const enrichedFeatures = useMemo<GlenwoodFeatures | null>(() => {
    if (!data.features) return null;
    const colorById = new Map<string, string>();
    data.hubs.hubs.forEach((h, i) =>
      colorById.set(h.id, HUB_PALETTE[i % HUB_PALETTE.length]),
    );
    data.pois.pois.forEach((p, i) =>
      colorById.set(p.id, POI_PALETTE[i % POI_PALETTE.length]),
    );
    return {
      ...data.features,
      features: data.features.features.map((f) => ({
        ...f,
        properties: {
          ...f.properties,
          color: colorById.get(f.properties.id) ?? '#ffffff',
        },
      })),
    };
  }, [data.features, data.hubs.hubs, data.pois.pois]);

  // Visits lookup for the hover tooltip — keyed by hub/POI id, summed over
  // the active timeframe window so the tooltip number matches the strip below.
  const visitsById = useMemo(() => {
    const out = new Map<string, number>();
    const hubLatest = findLatestDate(data.hubs.hubs.flatMap((h) => h.dailyVisits ?? []));
    if (hubLatest) {
      const { window } = timeframeWindows(hubLatest, timeframe);
      for (const h of data.hubs.hubs) {
        out.set(h.id, totalVisitsInWindow(h.dailyVisits ?? [], window));
      }
    }
    const allPoiMonthly = data.pois.pois.flatMap((p) => poiMonthlyFromOrigins(p));
    const poiLatest = findLatestDate(allPoiMonthly);
    if (poiLatest) {
      const { window } = timeframeWindows(poiLatest, timeframe);
      for (const p of data.pois.pois) {
        out.set(p.id, totalVisitsInWindow(poiMonthlyFromOrigins(p), window));
      }
    }
    return out;
  }, [data, timeframe]);

  const [hover, setHover] = useState<HoverInfo | null>(null);

  return (
    <SubjectMapCanvas bounds={GLENWOOD_BOUNDS}>
      <GlenwoodLayerManager
        features={enrichedFeatures}
        poiOrigins={poiOrigins}
        subView={subView}
        selectedIds={selectedIds}
        onClickHub={onToggleHub}
        onClickPoi={onTogglePoi}
        onHover={setHover}
      />
      {hover && (
        <div
          className="glass rounded-md"
          style={{
            position: 'absolute',
            left: hover.x + 14,
            top: hover.y + 14,
            padding: '6px 10px',
            pointerEvents: 'none',
            fontSize: 11,
            color: 'var(--text)',
            whiteSpace: 'nowrap',
            zIndex: 25,
            boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
          }}
        >
          <div style={{ color: 'var(--text-h)', fontWeight: 600 }}>{hover.name}</div>
          <div style={{ color: 'var(--text-dim)', marginTop: 2 }}>
            {fmtCount(visitsById.get(hover.id) ?? 0)} visits
          </div>
        </div>
      )}
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
