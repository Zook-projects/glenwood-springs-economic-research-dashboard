import { useEffect, useState } from 'react';
import type {
  GlenwoodFeatures,
  GlenwoodHubsFile,
  GlenwoodPlacerData,
  GlenwoodPoisFile,
  GlenwoodVisitationFile,
} from '../types/placer-glenwood';

const DATA_BASE = `${import.meta.env.BASE_URL}data/placer/glenwood`;

export interface UseGlenwoodPlacerDataResult {
  data: GlenwoodPlacerData | null;
  isLoading: boolean;
  error: Error | null;
}

async function fetchOrNull<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function useGlenwoodPlacerData(): UseGlenwoodPlacerDataResult {
  const [data, setData] = useState<GlenwoodPlacerData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    Promise.all([
      fetchOrNull<GlenwoodVisitationFile>(`${DATA_BASE}/visitation.json`),
      fetchOrNull<GlenwoodHubsFile>(`${DATA_BASE}/retail-hubs.json`),
      fetchOrNull<GlenwoodPoisFile>(`${DATA_BASE}/pois.json`),
      fetchOrNull<GlenwoodFeatures>(`${DATA_BASE}/glenwood-features.geojson`),
    ])
      .then(([visitation, hubs, pois, features]) => {
        if (cancelled) return;
        if (!visitation || !hubs || !pois) {
          setData(null);
        } else {
          setData({ visitation, hubs, pois, features });
        }
        setIsLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { data, isLoading, error };
}
