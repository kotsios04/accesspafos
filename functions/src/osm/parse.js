/**
 * Turn an Overpass response into a pedestrian routing graph.
 *
 * The output is a set of NODES and SEGMENTS. A segment is the stretch of one
 * OSM way between two junctions - not a whole street - because accessibility
 * varies along a street and a router needs to choose between the two sides of
 * a road independently.
 *
 * Identifiers are derived from OSM IDs, never from insertion order, so
 * re-running an import updates the same documents instead of duplicating
 * them. That is what makes ingestion retry-safe.
 */

import {
  isPedestrianWay, classifyOsmWay, carriagewayHasMappedSidewalks,
  osmDisplayName, SegmentKind
} from '../shared/osm.js';
import { lineLengthMeters, lineMidpoint, haversineMeters, bboxOf } from '../shared/geo.js';
import { MAX_SEGMENT_LENGTH_M } from '../shared/config.js';

/**
 * Endpoints of different ways that sit this close are treated as the same
 * node. Real OSM data frequently leaves a sidewalk and its crossing a few
 * centimetres apart, which would otherwise cut the graph into islands and
 * make routing impossible. Kept deliberately small so it cannot bridge
 * opposite sides of a street.
 */
export const NODE_WELD_DISTANCE_M = 4;

export function nodeId(osmNodeId) { return `n${osmNodeId}`; }

/**
 * Cut a junction-to-junction stretch into parts no longer than `maxLen`.
 *
 * A segment is the unit that carries one accessibility verdict and gets at
 * most MAX_IMAGES_PER_SEGMENT photographs. Splitting only at junctions left
 * stretches of over a kilometre in Pafos: one colour, one score, and three
 * frames that could be looking at a promenade, a car park and a side street.
 * Evidence from one end was being applied to the other.
 *
 * Cuts are made at existing OSM vertices, never at interpolated points, so
 * the geometry stays exactly what OSM says, the split nodes are real places,
 * and the id scheme (way + from-node + to-node) keeps working unchanged and
 * stays deterministic across re-imports.
 *
 * Parts are made even rather than greedy - a 110 m stretch at a 50 m limit
 * becomes 3 x ~37 m, not 50 + 50 + 10 - so no part is a stub. A stretch whose
 * vertices are too far apart to cut is returned whole: a faithful long segment
 * is better than an invented node.
 *
 * @param {number[]} ids    OSM node ids, in order
 * @param {number[][]} coords  [lng,lat] per id
 * @param {number} maxLen
 * @returns {Array<{ids:number[], coords:number[][]}>}
 */
export function splitByLength(ids, coords, maxLen) {
  const whole = [{ ids, coords }];
  if (!(maxLen > 0) || coords.length < 3) return whole;

  const cum = [0];
  for (let i = 1; i < coords.length; i += 1) {
    cum.push(cum[i - 1] + haversineMeters(coords[i - 1], coords[i]));
  }
  const total = cum[cum.length - 1];
  if (total <= maxLen) return whole;

  // Walk forward, cutting as we go.
  //
  // The first version of this picked, for each ideal boundary, the vertex
  // nearest to it - which reads well and is wrong: "nearest" can be far past
  // the limit when vertices are sparse, so a 120 m stretch with vertices at
  // 10 m and 110 m was cut into 10 / 100 / 10 and the middle part still broke
  // the rule the function exists to enforce. 287 real segments came out
  // oversize with interior vertices available to cut at.
  //
  // The limit is now a hard constraint and evenness a preference within it:
  // among the vertices that keep this part inside the limit, take the one
  // closest to an even division of what is left. Only when the very next
  // vertex is already beyond the limit is an oversize part emitted, and then
  // it is the shortest one available rather than a choice.
  const cuts = [];
  let from = 0;
  for (;;) {
    const remaining = total - cum[from];
    if (remaining <= maxLen) break;

    const want = cum[from] + remaining / Math.ceil(remaining / maxLen);
    let best = -1;
    let bestDelta = Infinity;
    for (let i = from + 1; i < coords.length - 1; i += 1) {
      if (cum[i] - cum[from] > maxLen) break; // cum is increasing: nothing further fits
      const delta = Math.abs(cum[i] - want);
      if (delta < bestDelta) { bestDelta = delta; best = i; }
    }

    if (best === -1) {
      // Nothing fits inside the limit. Take the next vertex anyway - the
      // shortest oversize part this geometry allows - and carry on, rather
      // than giving up and returning the whole stretch.
      if (from + 1 >= coords.length - 1) break;
      best = from + 1;
    }

    cuts.push(best);
    from = best;
  }
  if (cuts.length === 0) return whole;

  const out = [];
  let sliceStart = 0;
  for (const cut of [...cuts, coords.length - 1]) {
    if (cut <= sliceStart) continue;
    out.push({ ids: ids.slice(sliceStart, cut + 1), coords: coords.slice(sliceStart, cut + 1) });
    sliceStart = cut;
  }
  return out.length ? out : whole;
}

export function segmentId(wayId, fromOsmNode, toOsmNode) {
  return `w${wayId}_${fromOsmNode}_${toOsmNode}`;
}

/**
 * @param {{elements: any[]}} overpassJson
 * @param {{ regionId: string, weldDistanceM?: number }} options
 * @returns {{
 *   nodes: Array<{id:string, osmId:number, lng:number, lat:number}>,
 *   segments: Array<object>,
 *   stats: object
 * }}
 */
export function parsePedestrianNetwork(overpassJson, {
  regionId,
  weldDistanceM = NODE_WELD_DISTANCE_M,
  maxSegmentLength = MAX_SEGMENT_LENGTH_M
} = {}) {
  const elements = overpassJson?.elements || [];

  /** @type {Map<number, {lat:number, lon:number}>} */
  const rawNodes = new Map();
  const ways = [];

  for (const el of elements) {
    if (el.type === 'node') {
      rawNodes.set(el.id, { lat: el.lat, lon: el.lon, tags: el.tags });
    } else if (el.type === 'way' && Array.isArray(el.nodes)) {
      ways.push(el);
    }
  }

  // --- 1. keep only ways that belong in a pedestrian graph ---------------
  const kept = [];
  let skippedNonPedestrian = 0;
  let skippedRedundantCarriageway = 0;

  for (const way of ways) {
    const tags = way.tags || {};
    if (!isPedestrianWay(tags)) { skippedNonPedestrian += 1; continue; }
    const classification = classifyOsmWay(tags);
    // A carriageway whose sidewalks are mapped separately would double-count
    // the street; the separate sidewalk ways are the accessible reality.
    if (classification.isCarriageway && carriagewayHasMappedSidewalks(tags)) {
      skippedRedundantCarriageway += 1;
      continue;
    }
    kept.push({ way, tags, classification });
  }

  // --- 2. find junctions --------------------------------------------------
  /** @type {Map<number, number>} */
  const nodeUse = new Map();
  for (const { way } of kept) {
    for (const n of way.nodes) nodeUse.set(n, (nodeUse.get(n) || 0) + 1);
  }

  const isJunction = (osmNode, way, index) =>
    index === 0 || index === way.nodes.length - 1 || (nodeUse.get(osmNode) || 0) > 1;

  // --- 3. weld near-coincident endpoints ---------------------------------
  const weld = buildWeldMap(kept, rawNodes, weldDistanceM);

  // --- 4. split ways into segments ---------------------------------------
  const segments = [];
  const usedNodes = new Map();
  let skippedGeometry = 0;

  for (const { way, tags, classification } of kept) {
    const osmNodes = way.nodes;
    let cursor = 0;

    for (let i = 1; i < osmNodes.length; i += 1) {
      if (!isJunction(osmNodes[i], way, i)) continue;

      const sliceIds = osmNodes.slice(cursor, i + 1);
      const coords = [];
      let missing = false;
      for (const id of sliceIds) {
        const n = rawNodes.get(id);
        if (!n) { missing = true; break; }
        coords.push([n.lon, n.lat]);
      }
      cursor = i;

      if (missing || coords.length < 2) { skippedGeometry += 1; continue; }

      for (const part of splitByLength(sliceIds, coords, maxSegmentLength)) {
        const fromOsm = part.ids[0];
        const toOsm = part.ids[part.ids.length - 1];
        const fromId = weld.get(fromOsm) || nodeId(fromOsm);
        const toId = weld.get(toOsm) || nodeId(toOsm);
        if (fromId === toId) { skippedGeometry += 1; continue; } // degenerate loop stub

        const length = lineLengthMeters(part.coords);
        if (length < 0.5) { skippedGeometry += 1; continue; }

        segments.push({
          id: segmentId(way.id, fromOsm, toOsm),
          regionId,
          osmWayId: way.id,
          osmVersion: way.version ?? null,
          osmTimestamp: way.timestamp ?? null,
          fromNode: fromId,
          toNode: toId,
          fromOsmNode: fromOsm,
          toOsmNode: toOsm,
          geometry: part.coords,
          centre: lineMidpoint(part.coords),
          lengthMeters: Math.round(length * 10) / 10,
          kind: classification.kind,
          side: classification.side,
          isCarriageway: classification.isCarriageway,
          streetName: osmDisplayName(tags, 'en'),
          streetNameEl: osmDisplayName(tags, 'el'),
          osmTags: pickRelevantTags(tags)
        });

        recordNode(usedNodes, fromId, rawNodes.get(fromOsm), fromOsm);
        recordNode(usedNodes, toId, rawNodes.get(toOsm), toOsm);
      }
    }
  }

  const nodes = [...usedNodes.values()];
  const allCoords = segments.flatMap((s) => s.geometry);

  return {
    nodes,
    segments,
    stats: {
      overpassElements: elements.length,
      waysReceived: ways.length,
      waysKept: kept.length,
      skippedNonPedestrian,
      skippedRedundantCarriageway,
      skippedGeometry,
      segments: segments.length,
      nodes: nodes.length,
      weldedNodes: weld.size,
      totalLengthMeters: Math.round(segments.reduce((s, x) => s + x.lengthMeters, 0)),
      bbox: allCoords.length ? bboxOf(allCoords) : null
    }
  };
}

function recordNode(map, id, raw, osmId) {
  if (!raw || map.has(id)) return;
  map.set(id, { id, osmId, lng: raw.lon, lat: raw.lat });
}

/**
 * Map OSM node ids of near-coincident *endpoints* onto a single graph node id.
 * Only endpoints participate: welding interior vertices would silently create
 * shortcuts that do not exist on the ground.
 */
function buildWeldMap(kept, rawNodes, distanceM) {
  /** @type {Map<number, string>} */
  const weld = new Map();
  if (distanceM <= 0) return weld;

  const endpoints = [];
  for (const { way } of kept) {
    const first = way.nodes[0];
    const last = way.nodes[way.nodes.length - 1];
    for (const id of new Set([first, last])) {
      const n = rawNodes.get(id);
      if (n) endpoints.push({ id, lng: n.lon, lat: n.lat });
    }
  }

  // Spatial hash so this stays linear rather than quadratic on large imports.
  const cell = distanceM / 111320 * 1.5;
  /** @type {Map<string, typeof endpoints>} */
  const grid = new Map();
  const key = (lng, lat) => `${Math.floor(lng / cell)}:${Math.floor(lat / cell)}`;
  for (const p of endpoints) {
    const k = key(p.lng, p.lat);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }

  const assigned = new Set();
  for (const p of endpoints) {
    if (assigned.has(p.id)) continue;
    const cluster = [p];
    const [cx, cy] = key(p.lng, p.lat).split(':').map(Number);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const q of grid.get(`${cx + dx}:${cy + dy}`) || []) {
          if (q.id === p.id || assigned.has(q.id)) continue;
          if (haversineMeters([p.lng, p.lat], [q.lng, q.lat]) <= distanceM) cluster.push(q);
        }
      }
    }
    if (cluster.length < 2) continue;
    // Canonical id: the lowest OSM node id in the cluster, so the mapping is
    // stable across re-imports.
    const canonical = nodeId(Math.min(...cluster.map((c) => c.id)));
    for (const c of cluster) {
      weld.set(c.id, canonical);
      assigned.add(c.id);
    }
  }

  return weld;
}

/**
 * Store the tags that matter for accessibility, provenance and display.
 * Copying every tag would bloat documents with data we never read.
 */
const RELEVANT_TAG_KEYS = [
  'highway', 'footway', 'foot', 'access', 'wheelchair', 'surface', 'smoothness',
  'width', 'est_width', 'kerb', 'kerb:height', 'incline', 'tactile_paving',
  'ramp', 'ramp:wheelchair', 'barrier', 'crossing', 'crossing:markings',
  'crossing:signals', 'sidewalk', 'sidewalk:left', 'sidewalk:right',
  'sidewalk:side', 'step_count', 'handrail', 'lit', 'name', 'name:en', 'name:el',
  'covered', 'segregated', 'bicycle', 'service', 'oneway', 'layer', 'bridge', 'tunnel'
];

export function pickRelevantTags(tags) {
  const out = {};
  for (const key of RELEVANT_TAG_KEYS) {
    if (tags[key] != null) out[key] = String(tags[key]);
  }
  return out;
}

/**
 * Report connectivity so an admin can see immediately whether the imported
 * network is actually routable or whether OSM leaves it in disconnected
 * islands (a very common situation with separately-mapped sidewalks).
 */
export function analyseConnectivity(segments) {
  /** @type {Map<string, string[]>} */
  const adj = new Map();
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push(b);
  };
  for (const s of segments) {
    link(s.fromNode, s.toNode);
    link(s.toNode, s.fromNode);
  }

  const seen = new Set();
  const components = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const stack = [start];
    const comp = [];
    seen.add(start);
    while (stack.length) {
      const n = stack.pop();
      comp.push(n);
      for (const m of adj.get(n) || []) {
        if (!seen.has(m)) { seen.add(m); stack.push(m); }
      }
    }
    components.push(comp.length);
  }
  components.sort((a, b) => b - a);

  const totalNodes = adj.size;
  return {
    componentCount: components.length,
    largestComponentNodes: components[0] || 0,
    largestComponentShare: totalNodes ? Number(((components[0] || 0) / totalNodes).toFixed(3)) : 0,
    isolatedComponents: components.filter((c) => c < 4).length,
    totalNodes
  };
}
