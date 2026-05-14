// placerPassThrough — derives a PassThroughFile from Placer FlowRow[] so the
// Activity map's pass-through traffic card reads from Placer data instead of
// LODES.
//
// Definition (mirrors scripts/build-passthrough.py for LODES):
//   A flow "passes through" anchor X when X's corridor-graph node appears in
//   the flow's corridorPath but is NOT the flow's origin node or destination
//   node. For Placer, the destination is always one of the 11 anchors, so the
//   pass-through anchors for a flow are simply the corridor-graph nodes the
//   path touches between (exclusive) the resolved origin node and the dest
//   node.
//
// Bucket convention (preserved from PassThroughCard's mode-agnostic union):
//   inbound  — workplace is one of the OTHER 10 anchors (true for every
//              Placer flow that passes through X, since the dest is always
//              an anchor and we require dest != X)
//   outbound — residence is one of the OTHER 10 anchors (Placer flows whose
//              origin ZIP itself is an anchor and origin != X)
// The card unifies and dedupes anyway, so most cross-residential Placer
// pass-throughs land in inbound; anchor-to-anchor pairs land in both.
//
// Top-N capping mirrors the LODES build (default 200 per anchor per mode) so
// the partner-list card pagination stays comparable.

import type {
  CorridorId,
  CorridorNode,
  CorridorRecord,
  FlowRow,
  NodeId,
  PassThroughFile,
  PassThroughPair,
} from '../types/flow';

const PAIRS_PER_ANCHOR_PER_MODE = 200;

/** Walk a corridor path and return the ordered list of node IDs visited.
 * The two endpoints of each corridor are direction-agnostic, so the walker
 * picks the next node by matching the previous corridor's exit. Returns an
 * empty array if the path is malformed or empty. */
function walkPathNodes(
  path: readonly CorridorId[],
  corridorIndex: Map<CorridorId, CorridorRecord>,
  startNode: string | null,
): string[] {
  if (path.length === 0) return [];
  const first = corridorIndex.get(path[0]);
  if (!first) return [];
  // Pick the starting endpoint: if startNode matches one of the first
  // corridor's endpoints use that; else default to `from` (the build sets
  // corridor direction so this is the natural traversal sense).
  let current =
    startNode != null && (first.from === startNode || first.to === startNode)
      ? startNode
      : first.from;
  const nodes: string[] = [current];
  for (const cid of path) {
    const c = corridorIndex.get(cid);
    if (!c) return nodes;
    const next = c.from === current ? c.to : c.from;
    nodes.push(next);
    current = next;
  }
  return nodes;
}

/** Build {zip → node-id} and {node-id → zip} indices from the corridor node
 * set. Only nodes that carry an associated ZIP appear; gateway sentinels
 * (GW_E, GW_W) lack anchor ZIPs and are excluded from both directions. */
function buildZipNodeMaps(corridorNodes: Map<NodeId, CorridorNode>): {
  zipToNode: Map<string, NodeId>;
  nodeToZip: Map<NodeId, string>;
} {
  const zipToNode = new Map<string, NodeId>();
  const nodeToZip = new Map<NodeId, string>();
  for (const n of corridorNodes.values()) {
    if (!n.zip) continue;
    if (!zipToNode.has(n.zip)) zipToNode.set(n.zip, n.id);
    if (!nodeToZip.has(n.id)) nodeToZip.set(n.id, n.zip);
  }
  return { zipToNode, nodeToZip };
}

export function buildPlacerPassThrough(
  flows: readonly FlowRow[],
  corridorIndex: Map<CorridorId, CorridorRecord>,
  corridorNodes: Map<NodeId, CorridorNode>,
  anchorZips: readonly string[],
  year: number,
): PassThroughFile {
  const { zipToNode, nodeToZip } = buildZipNodeMaps(corridorNodes);
  const anchorZipSet = new Set(anchorZips);

  type PairAgg = Map<string, number>; // key = `${originZip}→${destZip}`
  const inboundByAnchor = new Map<string, PairAgg>();
  const outboundByAnchor = new Map<string, PairAgg>();
  const totalByAnchor = new Map<string, number>();
  for (const z of anchorZips) {
    inboundByAnchor.set(z, new Map());
    outboundByAnchor.set(z, new Map());
    totalByAnchor.set(z, 0);
  }

  const upsert = (
    bucket: PairAgg,
    originZip: string,
    destZip: string,
    workers: number,
  ) => {
    const key = `${originZip}→${destZip}`;
    bucket.set(key, (bucket.get(key) ?? 0) + workers);
  };

  for (const f of flows) {
    if (!f.corridorPath || f.corridorPath.length === 0) continue;
    if (!Number.isFinite(f.workerCount) || f.workerCount <= 0) continue;

    const originNode = zipToNode.get(f.originZip) ?? null;
    const destNode = zipToNode.get(f.destZip) ?? null;
    if (destNode === null) continue;  // dest must be a graph node for indexing

    const nodes = walkPathNodes(f.corridorPath, corridorIndex, originNode);
    if (nodes.length < 3) continue;  // need at least one intermediate

    // Intermediate nodes are everything between the first and last node.
    for (let i = 1; i < nodes.length - 1; i++) {
      const midZip = nodeToZip.get(nodes[i]);
      if (!midZip || !anchorZipSet.has(midZip)) continue;
      if (midZip === f.originZip || midZip === f.destZip) continue;

      totalByAnchor.set(midZip, (totalByAnchor.get(midZip) ?? 0) + f.workerCount);

      // Inbound bucket: dest is an anchor (always true for Placer) and
      // dest != midZip (we already filtered that). Every Placer pass-through
      // flow contributes here.
      upsert(inboundByAnchor.get(midZip)!, f.originZip, f.destZip, f.workerCount);

      // Outbound bucket: origin is itself one of the other 10 anchors and
      // origin != midZip.
      if (anchorZipSet.has(f.originZip) && f.originZip !== midZip) {
        upsert(outboundByAnchor.get(midZip)!, f.originZip, f.destZip, f.workerCount);
      }
    }
  }

  const finalizeBucket = (bucket: PairAgg) => {
    const pairs: PassThroughPair[] = [];
    for (const [key, workers] of bucket) {
      const [originZip, destZip] = key.split('→');
      pairs.push({ originZip, destZip, workerCount: workers });
    }
    pairs.sort((a, b) => b.workerCount - a.workerCount);
    const kept = pairs.slice(0, PAIRS_PER_ANCHOR_PER_MODE);
    const residual = pairs
      .slice(PAIRS_PER_ANCHOR_PER_MODE)
      .reduce((s, p) => s + p.workerCount, 0);
    return { pairs: kept, residual };
  };

  const byAnchor: PassThroughFile['byAnchor'] = {};
  for (const z of anchorZips) {
    byAnchor[z] = {
      total: totalByAnchor.get(z) ?? 0,
      inbound: finalizeBucket(inboundByAnchor.get(z)!),
      outbound: finalizeBucket(outboundByAnchor.get(z)!),
    };
  }

  return {
    year,
    pairsPerAnchorPerMode: PAIRS_PER_ANCHOR_PER_MODE,
    byAnchor,
  };
}
