// usePlacerData — fetches the Placer.ai zip-origin bundle emitted by
// scripts/build-placer.py. Fail-open: if any of the metric files (or the
// summary index) is missing/404, the hook returns `data: null` rather than
// surfacing an error. That keeps the LODES surfaces working untouched when
// the workbook hasn't been processed yet.

import { useEffect, useState } from 'react';
import type {
  PlacerData,
  PlacerMetricFile,
  PlacerSummary,
} from '../types/placer';

const DATA_BASE = `${import.meta.env.BASE_URL}data`;

export interface UsePlacerDataResult {
  data: PlacerData | null;
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

export function usePlacerData(): UsePlacerDataResult {
  const [data, setData] = useState<PlacerData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    Promise.all([
      fetchOrNull<PlacerSummary>(`${DATA_BASE}/placer/placer-summary.json`),
      fetchOrNull<PlacerMetricFile>(`${DATA_BASE}/placer/placer-employee-counts.json`),
      fetchOrNull<PlacerMetricFile>(`${DATA_BASE}/placer/placer-employee-visits.json`),
      fetchOrNull<PlacerMetricFile>(`${DATA_BASE}/placer/placer-visitor-counts.json`),
      fetchOrNull<PlacerMetricFile>(`${DATA_BASE}/placer/placer-visitor-visits.json`),
    ])
      .then(([summary, ec, ev, vc, vv]) => {
        if (cancelled) return;
        if (!summary || !ec || !ev || !vc || !vv) {
          setData(null);
        } else {
          setData({
            summary,
            employeeCounts: ec,
            employeeVisits: ev,
            visitorCounts: vc,
            visitorVisits: vv,
          });
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
