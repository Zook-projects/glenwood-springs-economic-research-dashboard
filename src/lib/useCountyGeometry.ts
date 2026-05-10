// useCountyGeometry — fetches the 3-county GeoJSON (Eagle, Garfield, Pitkin)
// once on first call. Used by subject map overlays for choropleth fills and
// for label placement at precomputed centroids.

import { useEffect, useState } from 'react';

export interface CountyFeatureProperties {
  geoid: string;       // e.g., "08045"
  fips: string;        // e.g., "045"
  name: string;        // e.g., "Garfield"
  stateGeoid: string;  // "08"
  centroid: [number, number]; // [lng, lat]
}

export interface CountyFeature {
  type: 'Feature';
  properties: CountyFeatureProperties;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

export interface CountyGeometry {
  type: 'FeatureCollection';
  features: CountyFeature[];
}

let cached: CountyGeometry | null = null;
let inflight: Promise<CountyGeometry> | null = null;

async function load(): Promise<CountyGeometry> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = fetch('/data/geo/counties.geojson')
    .then((r) => {
      if (!r.ok) throw new Error(`counties.geojson HTTP ${r.status}`);
      return r.json() as Promise<CountyGeometry>;
    })
    .then((data) => {
      cached = data;
      inflight = null;
      return data;
    })
    .catch((err) => {
      inflight = null;
      throw err;
    });
  return inflight;
}

export function useCountyGeometry(): {
  data: CountyGeometry | null;
  isLoading: boolean;
  error: Error | null;
} {
  const [data, setData] = useState<CountyGeometry | null>(cached);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(!cached);

  useEffect(() => {
    if (cached) {
      setData(cached);
      setIsLoading(false);
      return;
    }
    let alive = true;
    load()
      .then((d) => { if (alive) { setData(d); setIsLoading(false); } })
      .catch((e) => { if (alive) { setError(e); setIsLoading(false); } });
    return () => { alive = false; };
  }, []);

  return { data, isLoading, error };
}
