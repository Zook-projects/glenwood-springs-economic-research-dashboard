// placerAdapters — projects PlacerRow[] into the FlowRow shape every
// downstream visualization consumes (MapCanvas corridor pipeline,
// StatsAggregated, StatsForZip). The corridor path is borrowed from the
// LODES flow indexed by `flowsByOdKey` so Placer rows ride the same
// corridor graph without a separate routing pass; rows whose ZIP pair
// LODES doesn't know about emit an empty corridorPath and become
// stats-only (the map skips zero-length paths cleanly).

import type { FlowRow, ZipMeta } from '../types/flow';
import type { PlacerMetricFile, PlacerRow } from '../types/placer';

function buildPlaceLookup(zips: ZipMeta[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const z of zips) m.set(z.zip, z.place);
  return m;
}

function yearFromIso(lastBuilt: string): number {
  const y = Number(lastBuilt.slice(0, 4));
  if (Number.isFinite(y) && y > 1900 && y < 3000) return y;
  return new Date().getUTCFullYear();
}

/**
 * Convert one Placer metric file (e.g. Employee Counts) into FlowRow[].
 * Reuses the LODES corridorPath for each (originZip, destZip) pair when
 * available. The resulting rows carry `sourceKind: 'placer'` so tooltip
 * labels can switch units (workers → employees / visits) at render time.
 */
export function toFlowRows(
  metricFile: PlacerMetricFile,
  zips: ZipMeta[],
  flowsByOdKey: Map<string, FlowRow>,
): FlowRow[] {
  const placeOf = buildPlaceLookup(zips);
  const year = yearFromIso(metricFile.lastBuilt);
  const rows: FlowRow[] = [];

  for (const r of metricFile.rows) {
    if (!Number.isFinite(r.value) || r.value <= 0) continue;
    const key = `${r.originZip}-${r.destZip}`;
    const lodes = flowsByOdKey.get(key);
    rows.push({
      originZip: r.originZip,
      originPlace: placeOf.get(r.originZip) ?? r.originZip,
      destZip: r.destZip,
      destPlace: placeOf.get(r.destZip) ?? r.destZip,
      workerCount: r.value,
      year,
      source: 'LEHD',
      sourceKind: 'placer',
      corridorPath: lodes?.corridorPath ?? [],
    });
  }
  return rows;
}

/**
 * Aggregate raw Placer rows by origin ZIP within a single destination
 * anchor. Useful for the per-anchor stats panel when the user has
 * selected one of the destination ZIPs in the chip row.
 */
export function aggregateOriginsForAnchor(
  rows: PlacerRow[],
  destAnchor: string,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.destZip !== destAnchor) continue;
    m.set(r.originZip, (m.get(r.originZip) ?? 0) + r.value);
  }
  return m;
}
