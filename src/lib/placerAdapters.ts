// placerAdapters — projects PlacerRow[] into the FlowRow shape every
// downstream visualization consumes (MapCanvas corridor pipeline,
// StatsAggregated, StatsForZip).
//
// Corridor path resolution per row:
//   1. Baked path from the metric file's interned `paths` table
//      (build-placer.py routes every row through the corridor graph,
//      sending out-of-area origins via the appropriate I-70 gateway).
//   2. Fallback: legacy lookup against the LODES `flowsByOdKey` index for
//      metric files emitted before routing was baked in (pre-2026-05).
//   3. Empty path — the row becomes stats-only (zero-length paths are
//      skipped cleanly by MapCanvas).

import type { CorridorId, FlowRow, ZipMeta } from '../types/flow';
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
  const pathTable = metricFile.paths;
  const rows: FlowRow[] = [];

  for (const r of metricFile.rows) {
    if (!Number.isFinite(r.value) || r.value <= 0) continue;
    const corridorPath = resolveCorridorPath(r, pathTable, flowsByOdKey);
    rows.push({
      originZip: r.originZip,
      originPlace: placeOf.get(r.originZip) ?? r.originZip,
      destZip: r.destZip,
      destPlace: placeOf.get(r.destZip) ?? r.destZip,
      workerCount: r.value,
      year,
      source: 'LEHD',
      sourceKind: 'placer',
      corridorPath,
      originLat: r.originLat,
      originLng: r.originLng,
      originCity: r.originCity,
      originState: r.originState,
      residents: r.residents,
      category: r.category,
      subCategory: r.subCategory,
      propertySample: r.propertySample,
    });
  }
  return rows;
}

function resolveCorridorPath(
  row: PlacerRow,
  pathTable: CorridorId[][] | undefined,
  flowsByOdKey: Map<string, FlowRow>,
): CorridorId[] {
  if (pathTable && typeof row.pathId === 'number') {
    const baked = pathTable[row.pathId];
    if (baked) return baked;
  }
  const lodes = flowsByOdKey.get(`${row.originZip}-${row.destZip}`);
  return lodes?.corridorPath ?? [];
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
