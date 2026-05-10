// workforceTotals — derive total-workforce (LODES WAC totalJobs = inbound +
// local) per anchor zip, per containing county, and across the whole region.
// Consumed by the subject map strips so the second-position KPI in the
// Region/Place card can read "Workforce" without each strip re-implementing
// the lookup.

import type { ContextEnvelope } from '../types/context';
import type { WacFile } from '../types/lodes';

export interface WorkforceTotals {
  // Sum of WAC totalJobs across every anchor zip present in the bundle.
  region: number;
  // Anchor zip → totalJobs (workplace W_S000). Includes only zips that
  // appear both in `bundle.places` and in `wacFile.entries`.
  byZip: Map<string, number>;
  // County GEOID → sum of totalJobs across the anchor zips whose containing
  // county matches. Uses ContextPlaceEntry.countyGeoid as the join.
  byCountyGeoid: Map<string, number>;
}

export function computeWorkforceTotals(
  bundle: ContextEnvelope,
  wacFile: WacFile,
): WorkforceTotals {
  const wacByZip = new Map<string, number>();
  for (const e of wacFile.entries) {
    wacByZip.set(e.zip, e.latest?.totalJobs ?? 0);
  }

  const byZip = new Map<string, number>();
  const byCountyGeoid = new Map<string, number>();
  let region = 0;

  for (const p of bundle.places) {
    const v = wacByZip.get(p.zip);
    if (v == null) continue;
    byZip.set(p.zip, v);
    region += v;
    if (p.countyGeoid) {
      byCountyGeoid.set(p.countyGeoid, (byCountyGeoid.get(p.countyGeoid) ?? 0) + v);
    }
  }

  return { region, byZip, byCountyGeoid };
}
