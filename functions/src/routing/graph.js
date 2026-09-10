/**
 * Building, caching and versioning the routable pedestrian graph.
 *
 * The graph is derived from segments + their assessments. Rebuilding it from
 * Firestore on every route request would be slow and expensive, so it is:
 *   1. serialised to Cloud Storage under a monotonically increasing
 *      graphVersion whenever the network or its assessments change; and
 *   2. cached in the Cloud Function instance's memory, keyed by that version,
 *      so warm instances answer routing requests without any I/O at all.
 */

import { db, bucket, serverTimestamp, FieldValue } from '../lib/firebase.js';
import { COLLECTIONS } from '../config/index.js';
import { buildGraph } from '../shared/astar.js';
import { haversineMeters, pointToLineMeters, lineLengthMeters } from '../shared/geo.js';
import { SegmentStatus } from '../shared/constants.js';
import { ROUTE_SNAP_RADIUS_M } from '../shared/config.js';
import { decodeSegment } from '../shared/geometry.js';

const GRAPH_PATH = (regionId, version) => `public/bundles/${regionId}/graph.v${version}.json`;

/** Per-instance cache: { regionId -> { version, graph, edgeList, index, builtAt } }. */
const memoryCache = new Map();

/**
 * Edge attributes the cost model needs. Everything else about a segment stays
 * in Firestore and is only fetched when a user opens the detail sheet.
 */
export function segmentToEdge(segment) {
  const assessment = segment.assessment || {};
  return {
    id: segment.id,
    from: segment.fromNode,
    to: segment.toNode,
    lengthMeters: segment.lengthMeters,
    geometry: segment.geometry,
    status: assessment.status || SegmentStatus.UNVERIFIED,
    accessibilityScore: assessment.accessibilityScore ?? null,
    evidenceConfidence: assessment.evidenceConfidence ?? 0,
    freshnessState: assessment.freshnessState || 'none',
    barriers: assessment.barriers || [],
    hardBlocks: segment.hardBlocks || [],
    streetName: segment.streetName || null,
    streetNameEl: segment.streetNameEl || null,
    kind: segment.kind || null
  };
}

/** Load every segment of a region and turn it into a serialisable graph. */
export async function buildRegionGraphData(regionId) {
  const snap = await db.collection(COLLECTIONS.segments)
    .where('regionId', '==', regionId)
    .get();

  const edges = [];
  /** @type {Record<string,[number,number]>} */
  const nodes = {};

  for (const doc of snap.docs) {
    const segment = { id: doc.id, ...decodeSegment(doc.data()) };
    if (!segment.geometry || segment.geometry.length < 2) continue;
    edges.push(segmentToEdge(segment));
    nodes[segment.fromNode] = segment.geometry[0];
    nodes[segment.toNode] = segment.geometry[segment.geometry.length - 1];
  }

  return {
    regionId,
    nodes,
    edges,
    builtAt: new Date().toISOString(),
    edgeCount: edges.length,
    nodeCount: Object.keys(nodes).length,
    totalLengthMeters: Math.round(edges.reduce((s, e) => s + (e.lengthMeters || 0), 0))
  };
}

/** Serialise the graph to Storage and bump the region's graphVersion. */
export async function publishRegionGraph(regionId) {
  const data = await buildRegionGraphData(regionId);
  const regionRef = db.collection(COLLECTIONS.regions).doc(regionId);
  const regionSnap = await regionRef.get();
  const version = ((regionSnap.exists ? regionSnap.data().graphVersion : 0) || 0) + 1;

  const file = bucket().file(GRAPH_PATH(regionId, version));
  await file.save(JSON.stringify({ ...data, graphVersion: version }), {
    contentType: 'application/json',
    metadata: { cacheControl: 'private, max-age=60' }
  });

  await regionRef.set({
    graphVersion: version,
    graphPath: GRAPH_PATH(regionId, version),
    graphStats: {
      edgeCount: data.edgeCount,
      nodeCount: data.nodeCount,
      totalLengthMeters: data.totalLengthMeters
    },
    graphBuiltAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  memoryCache.delete(regionId);
  return { version, ...data };
}

/**
 * Get a ready-to-route graph for a region, from memory if possible, then
 * Storage, then - as a last resort - straight from Firestore.
 */
export async function loadRegionGraph(regionId) {
  const regionSnap = await db.collection(COLLECTIONS.regions).doc(regionId).get();
  if (!regionSnap.exists) {
    const error = new Error(`Region "${regionId}" has not been imported yet.`);
    error.code = 'region-not-found';
    throw error;
  }
  const region = regionSnap.data();
  const version = region.graphVersion || 0;

  const cached = memoryCache.get(regionId);
  if (cached && cached.version === version) return cached;

  let data = null;
  if (version > 0 && region.graphPath) {
    try {
      const [buffer] = await bucket().file(region.graphPath).download();
      data = JSON.parse(buffer.toString('utf8'));
    } catch {
      // Fall through and rebuild: a missing artefact must not break routing.
      data = null;
    }
  }
  if (!data) data = await buildRegionGraphData(regionId);

  const prepared = prepareGraph(data, version);
  memoryCache.set(regionId, prepared);
  return prepared;
}

/** Wrap raw graph data with the adjacency structure and a spatial index. */
export function prepareGraph(data, version = 0) {
  const graph = buildGraph(data.edges, data.nodes);
  return {
    version,
    regionId: data.regionId,
    graph,
    edgeList: data.edges,
    index: buildEdgeIndex(data.edges),
    stats: {
      edgeCount: data.edgeCount ?? data.edges.length,
      nodeCount: data.nodeCount ?? Object.keys(data.nodes).length,
      totalLengthMeters: data.totalLengthMeters ?? null
    },
    builtAt: data.builtAt || null
  };
}

/** Coarse grid index so snapping does not scan every edge in the city. */
export function buildEdgeIndex(edges, cellDeg = 0.002) {
  const grid = new Map();
  const put = (lng, lat, edge) => {
    const k = `${Math.floor(lng / cellDeg)}:${Math.floor(lat / cellDeg)}`;
    if (!grid.has(k)) grid.set(k, new Set());
    grid.get(k).add(edge);
  };
  for (const edge of edges) {
    for (const [lng, lat] of edge.geometry || []) put(lng, lat, edge);
  }
  return {
    cellDeg,
    near(point, radiusM = ROUTE_SNAP_RADIUS_M) {
      const reach = Math.max(1, Math.ceil((radiusM / 111320) / cellDeg));
      const cx = Math.floor(point[0] / cellDeg);
      const cy = Math.floor(point[1] / cellDeg);
      const out = new Set();
      for (let dx = -reach; dx <= reach; dx += 1) {
        for (let dy = -reach; dy <= reach; dy += 1) {
          const bucketSet = grid.get(`${cx + dx}:${cy + dy}`);
          if (bucketSet) for (const e of bucketSet) out.add(e);
        }
      }
      return [...out];
    }
  };
}

/**
 * Find the closest point on the pedestrian network to an arbitrary location.
 * @returns {{edge:object, point:[number,number], index:number, t:number, distance:number}|null}
 */
export function snapToNetwork(prepared, point, radiusM = ROUTE_SNAP_RADIUS_M) {
  const candidates = prepared.index.near(point, radiusM);
  let best = null;
  for (const edge of candidates) {
    const r = pointToLineMeters(point, edge.geometry);
    if (r.distance <= radiusM && (!best || r.distance < best.distance)) {
      best = { edge, point: r.point, index: r.index, t: r.t, distance: r.distance };
    }
  }
  return best;
}

/**
 * Insert temporary nodes for the origin and destination.
 *
 * Without this, a route would have to start at the nearest OSM junction,
 * which in a long street can be a hundred metres from where the user actually
 * is. Splitting the snapped edge gives a route that starts where the user
 * stands - and, importantly, inherits that edge's accessibility attributes so
 * the first few metres are costed honestly rather than being free.
 *
 * @returns {{ graph: object, startNode: string, goalNode: string, snaps: object }}
 */
export function withVirtualEndpoints(prepared, origin, destination, radiusM = ROUTE_SNAP_RADIUS_M) {
  const originSnap = snapToNetwork(prepared, origin, radiusM);
  const destSnap = snapToNetwork(prepared, destination, radiusM);
  if (!originSnap) { const e = new Error('No pedestrian path found near the starting point.'); e.code = 'origin-off-network'; throw e; }
  if (!destSnap) { const e = new Error('No pedestrian path found near the destination.'); e.code = 'destination-off-network'; throw e; }

  // Clone adjacency so the cached graph is never mutated by a request.
  const adjacency = new Map();
  for (const [k, v] of prepared.graph.adjacency) adjacency.set(k, [...v]);
  const nodes = new Map(prepared.graph.nodes);
  const graph = { nodes, adjacency };

  const addEdge = (from, to, edge) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push({ ...edge, from, to });
  };

  const splitInto = (snap, virtualId) => {
    const { edge, point, index, t } = snap;
    nodes.set(virtualId, point);

    const head = [...edge.geometry.slice(0, index + 1), point];
    const tail = [point, ...edge.geometry.slice(index + 1)];
    const headLen = lineLengthMeters(head);
    const tailLen = lineLengthMeters(tail);

    const attrs = { ...edge };
    delete attrs.from; delete attrs.to;

    // Both halves inherit the parent segment's accessibility attributes.
    addEdge(virtualId, edge.from, { ...attrs, id: `${edge.id}#a`, geometry: [...head].reverse(), lengthMeters: headLen, virtual: true });
    addEdge(edge.from, virtualId, { ...attrs, id: `${edge.id}#a`, geometry: head, lengthMeters: headLen, virtual: true });
    addEdge(virtualId, edge.to, { ...attrs, id: `${edge.id}#b`, geometry: tail, lengthMeters: tailLen, virtual: true });
    addEdge(edge.to, virtualId, { ...attrs, id: `${edge.id}#b`, geometry: [...tail].reverse(), lengthMeters: tailLen, virtual: true });

    return { headLen, tailLen, attrs };
  };

  const startNode = '__origin__';
  const goalNode = '__destination__';
  splitInto(originSnap, startNode);
  splitInto(destSnap, goalNode);

  // Origin and destination on the same segment: connect them directly, or the
  // router would send a user all the way to a junction and back.
  if (originSnap.edge.id === destSnap.edge.id) {
    const a = originSnap;
    const b = destSnap;
    const forward = (a.index < b.index) || (a.index === b.index && a.t <= b.t);
    const [first, second] = forward ? [a, b] : [b, a];
    const middle = [
      first.point,
      ...originSnap.edge.geometry.slice(first.index + 1, second.index + 1),
      second.point
    ];
    const len = lineLengthMeters(middle);
    const attrs = { ...originSnap.edge };
    delete attrs.from; delete attrs.to;
    const fromId = forward ? startNode : goalNode;
    const toId = forward ? goalNode : startNode;
    addEdge(fromId, toId, { ...attrs, id: `${originSnap.edge.id}#direct`, geometry: middle, lengthMeters: len, virtual: true });
    addEdge(toId, fromId, { ...attrs, id: `${originSnap.edge.id}#direct`, geometry: [...middle].reverse(), lengthMeters: len, virtual: true });
  }

  return {
    graph,
    startNode,
    goalNode,
    snaps: {
      origin: { distanceMeters: Math.round(originSnap.distance), segmentId: originSnap.edge.id, point: originSnap.point },
      destination: { distanceMeters: Math.round(destSnap.distance), segmentId: destSnap.edge.id, point: destSnap.point }
    }
  };
}

/** Drop the in-memory cache (used after a rebuild in the same instance). */
export function invalidateGraphCache(regionId) {
  if (regionId) memoryCache.delete(regionId);
  else memoryCache.clear();
}

export { GRAPH_PATH };
