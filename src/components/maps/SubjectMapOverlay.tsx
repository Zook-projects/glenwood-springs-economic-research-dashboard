// SubjectMapOverlay — SVG overlay layered over SubjectMapCanvas. Renders
// one of two map layers based on `mapLayer`:
//   - 'symbols':    proportional circles at each anchor place's centroid
//   - 'choropleth': filled county polygons from counties.geojson
//
// Generic over the metric type — Demographics, Housing, and Commerce all
// pass their own metric definitions but share this overlay. The `subjectId`
// drives which color ramp from RAMPS to use.

import { useMemo, useState } from 'react';
import { useMapProjection } from '../SubjectMapCanvas';
import type { ContextEnvelope, ContextLatest } from '../../types/context';
import type { SubjectId } from '../../config/subjects';
import { RAMPS, quintileIndex } from '../../lib/subjectColorRamps';
import type { CountyGeometry } from '../../lib/useCountyGeometry';
import type { ZipMeta } from '../../types/flow';

export type GeoLevel = 'place' | 'county';
export type MapLayerKind = 'symbols' | 'choropleth';

// Minimal metric shape required by the overlay. Demographics/Housing/Commerce
// metric types all satisfy this.
export interface OverlayMetric {
  label: string;
  extract: (latest: ContextLatest | null) => number | null;
  format: (v: number | null | undefined) => string;
}

interface Props {
  subjectId: SubjectId;
  bundle: ContextEnvelope;
  metric: OverlayMetric;
  geoLevel: GeoLevel;
  mapLayer: MapLayerKind;
  zips: ZipMeta[];
  counties: CountyGeometry | null;
  // Set-based selection so multi-select can highlight an arbitrary subset of
  // places / counties. The parent owns add/remove/replace logic — overlay
  // just emits the clicked zip/geoid and reads `.has(...)` for highlight
  // state.
  selectedZips: Set<string>;
  selectedCountyGeoids: Set<string>;
  // County GEOID to scope the visible features. When non-null only places
  // whose containing county matches and the matching county polygon render.
  countyFilter: string | null;
  onSelectZip: (zip: string) => void;
  onSelectCounty: (geoid: string) => void;
}

export function SubjectMapOverlay({
  subjectId,
  bundle,
  metric,
  geoLevel,
  mapLayer,
  zips,
  counties,
  selectedZips,
  selectedCountyGeoids,
  countyFilter,
  onSelectZip,
  onSelectCounty,
}: Props) {
  const { project, map } = useMapProjection();
  const [hover, setHover] = useState<{
    kind: 'place' | 'county';
    id: string;
    label: string;
    valueText: string;
    x: number;
    y: number;
  } | null>(null);

  const ramp = RAMPS[subjectId];

  // ---- Compute distributions + color/size scales ----
  const placeRows = useMemo(() => {
    const rows: Array<{
      zip: string;
      name: string;
      lat: number;
      lng: number;
      value: number | null;
    }> = [];
    for (const p of bundle.places) {
      if (countyFilter && p.countyGeoid !== countyFilter) continue;
      const z = zips.find((zz) => zz.zip === p.zip);
      if (!z || z.lat == null || z.lng == null) continue;
      rows.push({
        zip: p.zip,
        name: p.name,
        lat: z.lat,
        lng: z.lng,
        value: metric.extract(p.latest),
      });
    }
    return rows;
  }, [bundle.places, zips, metric, countyFilter]);

  const countyRows = useMemo(() => {
    return bundle.counties
      .filter((c) => !countyFilter || c.geoid === countyFilter)
      .map((c) => ({
        geoid: c.geoid,
        name: c.name,
        value: metric.extract(c.latest),
      }));
  }, [bundle.counties, metric, countyFilter]);

  const placeDist = useMemo(
    () =>
      placeRows
        .map((r) => r.value)
        .filter((v): v is number => v != null)
        .sort((a, b) => a - b),
    [placeRows],
  );
  const countyDist = useMemo(
    () =>
      countyRows
        .map((r) => r.value)
        .filter((v): v is number => v != null)
        .sort((a, b) => a - b),
    [countyRows],
  );

  // Symbol radius: sqrt-scaled, 6–28 px range based on the place distribution.
  const placeMaxValue = placeDist.length ? placeDist[placeDist.length - 1] : 1;
  const radiusFor = (value: number | null): number => {
    if (value == null || value <= 0) return 4;
    return 6 + Math.sqrt(value / placeMaxValue) * 22;
  };

  // Color from quintile, with a darker stroke for emphasis.
  const colorFor = (value: number | null, dist: readonly number[]): string => {
    if (value == null || dist.length === 0) return ramp.noData;
    const q = quintileIndex(value, dist);
    return ramp.palette[q];
  };

  // Project a county polygon's coordinates into SVG path data.
  const countyPaths = useMemo(() => {
    if (!counties || !map) return [];
    const features = counties.features.filter(
      (f) => !countyFilter || f.properties.geoid === countyFilter,
    );
    return features.map((f) => {
      const coords = projectGeometry(f.geometry, project);
      const d = coordsToPath(coords);
      const value = bundle.counties.find((c) => c.geoid === f.properties.geoid)?.latest;
      const v = metric.extract(value ?? null);
      const fill = colorFor(v, countyDist);
      const valueText = metric.format(v);
      const labelXY = project(f.properties.centroid);
      return {
        geoid: f.properties.geoid,
        name: f.properties.name,
        d,
        fill,
        valueText,
        labelX: labelXY.x,
        labelY: labelXY.y,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counties, map, project, bundle.counties, metric, countyDist, countyFilter]);

  if (!map) return null;

  const showCounties = mapLayer === 'choropleth' || geoLevel === 'county';
  const showSymbols = mapLayer === 'symbols' || geoLevel === 'place';

  return (
    <svg
      className="absolute inset-0 w-full h-full"
      style={{ pointerEvents: 'none' }}
    >
      {/* County polygons */}
      {showCounties && countyPaths.map((c) => {
        const isSelected = selectedCountyGeoids.has(c.geoid);
        return (
          <g
            key={c.geoid}
            style={{ pointerEvents: 'auto', cursor: 'pointer' }}
            onMouseEnter={(e) =>
              setHover({
                kind: 'county',
                id: c.geoid,
                label: c.name + ' County',
                valueText: c.valueText,
                x: e.clientX,
                y: e.clientY,
              })
            }
            onMouseMove={(e) =>
              setHover((h) =>
                h
                  ? { ...h, x: e.clientX, y: e.clientY }
                  : h,
              )
            }
            onMouseLeave={() => setHover(null)}
            onClick={(e) => {
              e.stopPropagation();
              onSelectCounty(c.geoid);
            }}
          >
            <path
              d={c.d}
              fill={c.fill}
              fillOpacity={isSelected ? 0.78 : 0.55}
              stroke={isSelected ? ramp.accent : 'rgba(255,255,255,0.25)'}
              strokeWidth={isSelected ? 2 : 1}
            />
          </g>
        );
      })}

      {/* County label always shown when county layer visible */}
      {showCounties && countyPaths.map((c) => (
        <g key={c.geoid + '-label'} style={{ pointerEvents: 'none' }}>
          <text
            x={c.labelX}
            y={c.labelY - 4}
            fontSize={11}
            fontWeight={700}
            textAnchor="middle"
            fill="#fff"
            style={{
              paintOrder: 'stroke',
              stroke: '#000',
              strokeWidth: 3,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {c.name.toUpperCase()}
          </text>
          <text
            x={c.labelX}
            y={c.labelY + 10}
            fontSize={10}
            textAnchor="middle"
            fill={ramp.accent}
            style={{ paintOrder: 'stroke', stroke: '#000', strokeWidth: 3 }}
          >
            {c.valueText}
          </text>
        </g>
      ))}

      {/* Place symbols + labels */}
      {showSymbols && placeRows.map((p) => {
        const screen = project([p.lng, p.lat]);
        const r = radiusFor(p.value);
        const fill = colorFor(p.value, placeDist);
        const isSelected = selectedZips.has(p.zip);
        return (
          <g
            key={p.zip}
            style={{ pointerEvents: 'auto', cursor: 'pointer' }}
            onMouseEnter={(e) =>
              setHover({
                kind: 'place',
                id: p.zip,
                label: p.name,
                valueText: metric.format(p.value),
                x: e.clientX,
                y: e.clientY,
              })
            }
            onMouseMove={(e) =>
              setHover((h) =>
                h && h.id === p.zip
                  ? { ...h, x: e.clientX, y: e.clientY }
                  : h,
              )
            }
            onMouseLeave={() => setHover(null)}
            onClick={(e) => {
              e.stopPropagation();
              onSelectZip(p.zip);
            }}
          >
            <circle
              cx={screen.x}
              cy={screen.y}
              r={r + 3}
              fill="none"
              stroke={isSelected ? ramp.accent : 'rgba(0,0,0,0.55)'}
              strokeWidth={isSelected ? 3 : 1.5}
            />
            <circle
              cx={screen.x}
              cy={screen.y}
              r={r}
              fill={fill}
              fillOpacity={0.95}
              stroke="#fff"
              strokeOpacity={0.85}
              strokeWidth={1}
            />
          </g>
        );
      })}

      {/* Place labels (rendered after symbols so they sit above) */}
      {showSymbols && placeRows.map((p) => {
        const screen = project([p.lng, p.lat]);
        const r = radiusFor(p.value);
        return (
          <g key={p.zip + '-label'} style={{ pointerEvents: 'none' }}>
            <text
              x={screen.x}
              y={screen.y + r + 12}
              fontSize={10}
              fontWeight={600}
              textAnchor="middle"
              fill="#fff"
              style={{
                paintOrder: 'stroke',
                stroke: '#000',
                strokeWidth: 3,
                letterSpacing: '0.04em',
              }}
            >
              {p.name}
            </text>
          </g>
        );
      })}

      {/* Hover tooltip — fixed-position chip at cursor */}
      {hover && (
        <foreignObject
          x={0}
          y={0}
          width={1}
          height={1}
          style={{ overflow: 'visible', pointerEvents: 'none' }}
        >
          <div
            style={{
              position: 'fixed',
              left: hover.x + 12,
              top: hover.y + 12,
              padding: '6px 10px',
              background: 'rgba(0,0,0,0.85)',
              border: `1px solid ${ramp.accent}`,
              borderRadius: 4,
              fontSize: 11,
              color: '#fff',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              zIndex: 1000,
            }}
          >
            <div style={{ fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              {hover.label}
            </div>
            <div style={{ color: ramp.accent }}>
              {metric.label}: {hover.valueText}
            </div>
          </div>
        </foreignObject>
      )}
    </svg>
  );
}

// ---------- Geometry helpers ----------

type Project = (lngLat: [number, number]) => { x: number; y: number };

// Project a GeoJSON polygon/multipolygon into nested arrays of pixel coords.
function projectGeometry(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  project: Project,
): number[][][] {
  if (geom.type === 'Polygon') {
    return geom.coordinates.map((ring) =>
      ring.map((c) => {
        const p = project([c[0], c[1]]);
        return [p.x, p.y];
      }),
    );
  }
  // MultiPolygon — flatten polygons into one array of rings (we don't
  // distinguish holes vs. outer rings beyond what SVG fill-rule:evenodd
  // handles automatically).
  const out: number[][][] = [];
  for (const poly of geom.coordinates) {
    for (const ring of poly) {
      out.push(ring.map((c) => {
        const p = project([c[0], c[1]]);
        return [p.x, p.y];
      }));
    }
  }
  return out;
}

// Convert nested ring arrays into an SVG path string.
function coordsToPath(rings: number[][][]): string {
  return rings
    .map((ring) => {
      if (ring.length === 0) return '';
      const [x0, y0] = ring[0];
      const tail = ring
        .slice(1)
        .map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`)
        .join('');
      return `M${x0.toFixed(1)},${y0.toFixed(1)}${tail}Z`;
    })
    .join(' ');
}
