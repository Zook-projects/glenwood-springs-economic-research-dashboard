// SubjectMapCanvas — slim MapLibre basemap host for Demographics, Housing,
// and Commerce map views. Mirrors CommuteView's basemap (CARTO Dark Matter
// + Mapzen hillshade + symbol-label suppression + road-color tweak) but
// strips out every LODES-specific concern (corridor SVG arcs, OD heatmap,
// block-selection circles, ZIP-node labels).
//
// Children render absolutely-positioned over the map canvas. Subject overlays
// can use the MapContext (via useMapProjection) to project [lng, lat] →
// {x, y} and re-render on map move/zoom.

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import maplibregl, { type Map as MLMap, type LngLatBoundsLike } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const STYLE_URL =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const HILLSHADE_ENABLED =
  import.meta.env.VITE_HILLSHADE_ENABLED !== 'false';

const HILLSHADE_DEM_TILES =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

// Default region — Roaring Fork & Colorado River corridor. Matches the
// CommuteView (Workforce) basemap envelope exactly so all four maps share
// an identical initial viewport.
const DEFAULT_BOUNDS: LngLatBoundsLike = [
  [-108.45, 39.05],
  [-106.65, 39.85],
];

// ----- MapContext -----------------------------------------------------------

interface MapCtx {
  map: MLMap | null;
  // Version bumps on every map move/zoom — overlay components subscribe to
  // this to trigger a re-render and re-project their features.
  version: number;
}

const MapContext = createContext<MapCtx>({ map: null, version: 0 });

export function useMapProjection() {
  const { map, version } = useContext(MapContext);
  // Stable function but its identity changes whenever version changes, so
  // overlay memos depending on it re-run on map move.
  const project = (lngLat: [number, number]): { x: number; y: number } => {
    if (!map) return { x: 0, y: 0 };
    const p = map.project(lngLat);
    return { x: p.x, y: p.y };
  };
  return { project, map, version };
}

// ----- SubjectMapCanvas component ------------------------------------------

interface Props {
  children?: ReactNode;
  // Optional bounds override; defaults to the regional envelope.
  bounds?: LngLatBoundsLike;
  // Click-on-empty handler — fired when the user clicks the map canvas
  // outside any interactive overlay element. Use to clear selection.
  onClickEmpty?: () => void;
}

export function SubjectMapCanvas({ children, bounds, onClickEmpty }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ctx, setCtx] = useState<MapCtx>({ map: null, version: 0 });

  // Stash latest onClickEmpty so the once-bound MapLibre handler always reads
  // the current closure.
  const onClickEmptyRef = useRef(onClickEmpty);
  useEffect(() => {
    onClickEmptyRef.current = onClickEmpty;
  }, [onClickEmpty]);

  // ---- Init MapLibre once -------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      bounds: bounds ?? DEFAULT_BOUNDS,
      fitBoundsOptions: { padding: { top: 40, right: 40, bottom: 40, left: 40 } },
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchZoomRotate: true,
    });
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;

    map.on('click', () => onClickEmptyRef.current?.());

    map.on('style.load', () => {
      const style = map.getStyle();
      if (!style?.layers) return;

      // Hillshade — adds mountain relief; mirrors CommuteView basemap so
      // both maps feel like siblings.
      if (HILLSHADE_ENABLED && !map.getSource('terrain-dem')) {
        map.addSource('terrain-dem', {
          type: 'raster-dem',
          tiles: [HILLSHADE_DEM_TILES],
          tileSize: 256,
          encoding: 'terrarium',
          maxzoom: 15,
          attribution:
            '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Mapzen Terrain Tiles</a>',
        });

        const firstSymbolLayerId =
          style.layers.find((l) => l.type === 'symbol')?.id ?? 'water';

        map.addLayer(
          {
            id: 'hillshade',
            source: 'terrain-dem',
            type: 'hillshade',
            paint: {
              'hillshade-shadow-color': '#000814',
              'hillshade-highlight-color': '#1a2330',
              'hillshade-accent-color': '#0a0f18',
              'hillshade-exaggeration': 0.55,
              'hillshade-illumination-direction': 315,
              'hillshade-illumination-anchor': 'viewport',
            },
          },
          firstSymbolLayerId,
        );
      }

      // Hide basemap symbol/label layers — overlay components own labels.
      for (const layer of style.layers) {
        if (layer.type !== 'symbol') continue;
        try {
          map.setLayoutProperty(layer.id, 'visibility', 'none');
        } catch {
          /* skip */
        }
      }

      // Road color tweak — mirror CommuteView so both maps share basemap
      // language.
      for (const layer of style.layers) {
        if (layer.type !== 'line') continue;
        const id = layer.id;
        const isRoad =
          id.includes('road') ||
          id.includes('highway') ||
          id.includes('street') ||
          id.includes('motorway') ||
          id.includes('tunnel') ||
          id.includes('bridge');
        if (!isRoad) continue;
        const isMajor =
          id.includes('motorway') ||
          id.includes('major') ||
          id.includes('trunk') ||
          id.includes('primary') ||
          /road-1$|road-2$/.test(id);
        try {
          map.setPaintProperty(id, 'line-color', isMajor ? '#5a4a30' : '#3a3530');
          map.setPaintProperty(id, 'line-opacity', isMajor ? 0.95 : 0.7);
        } catch {
          /* skip */
        }
      }
    });

    // Bump version on any view change so overlays re-project.
    const bump = () => setCtx((c) => ({ map: c.map, version: c.version + 1 }));
    map.on('move', bump);
    map.on('zoom', bump);
    map.on('resize', bump);

    // Initial context publish — once the map is ready enough to project.
    setCtx({ map, version: 0 });

    return () => {
      map.off('move', bump);
      map.off('zoom', bump);
      map.off('resize', bump);
      map.remove();
      mapRef.current = null;
    };
    // bounds intentionally not in deps — initial bounds only; subsequent
    // bound changes are handled imperatively by the parent via map.fitBounds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <MapContext.Provider value={ctx}>
        {/* Overlay container — children absolutely positioned over the map.
            Use pointer-events-none on this wrapper and pointer-events-auto
            on interactive children so map drag/zoom still works through
            non-interactive overlay regions. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
          }}
        >
          {children}
        </div>
      </MapContext.Provider>
    </div>
  );
}
