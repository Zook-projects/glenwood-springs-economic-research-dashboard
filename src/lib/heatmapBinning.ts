// Quintile-binning for MapLibre heatmap layers — LEHD OnTheMap discrete
// contour style. Each input point's raw weight is replaced by one of five
// fixed band centers (0.10 / 0.30 / 0.50 / 0.70 / 0.90) chosen by its
// rank within the input set. These centers map cleanly to the
// heatmap-color step cutoffs (0.20 / 0.40 / 0.60 / 0.80) configured on
// the MapCanvas layer, so every quintile of points renders as its own
// visible band regardless of how skewed the raw distribution is.
//
// Shared between the Workforce builder (LODES block points) and the
// Shoppers builder (Placer property points) so both maps read with the
// same visual language.

export interface HeatmapWeightedPoint {
  lat: number;
  lng: number;
  weight: number;
  key: string;
}

export interface HeatmapPointFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { weight: number; block: string };
}

export interface HeatmapFeatureCollection {
  type: 'FeatureCollection';
  features: HeatmapPointFeature[];
}

export function quintileBinPoints(
  points: ReadonlyArray<HeatmapWeightedPoint>,
): HeatmapFeatureCollection {
  if (points.length === 0) {
    return { type: 'FeatureCollection', features: [] };
  }
  const sorted = points.map((p) => p.weight).sort((a, b) => a - b);
  const cutoffAt = (frac: number): number => {
    const idx = Math.min(sorted.length - 1, Math.floor(frac * sorted.length));
    return sorted[idx];
  };
  const t20 = cutoffAt(0.2);
  const t40 = cutoffAt(0.4);
  const t60 = cutoffAt(0.6);
  const t80 = cutoffAt(0.8);
  const bandCenter = (w: number): number => {
    if (w <= t20) return 0.1;
    if (w <= t40) return 0.3;
    if (w <= t60) return 0.5;
    if (w <= t80) return 0.7;
    return 0.9;
  };
  const features: HeatmapPointFeature[] = points.map((p) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    properties: { weight: bandCenter(p.weight), block: p.key },
  }));
  return { type: 'FeatureCollection', features };
}
