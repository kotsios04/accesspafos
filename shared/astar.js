/**
 * A* over the pedestrian graph.
 *
 * The graph is deliberately plain data (Maps of arrays) so the same code runs
 * in a Cloud Function, in a unit test and - for a small cached region - in the
 * browser. The heuristic is straight-line distance, which is admissible
 * because every edge cost is at least its own length.
 */

import { haversineMeters } from './geo.js';
import { ROUTE_MAX_EXPANSIONS } from './config.js';

/** Minimal binary min-heap keyed by `f`. */
export class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * @typedef {Object} GraphEdge
 * @property {string} id
 * @property {string} from
 * @property {string} to
 * @property {number} lengthMeters
 * @property {[number,number][]} [geometry]
 *
 * @typedef {Object} Graph
 * @property {Map<string,[number,number]>} nodes
 * @property {Map<string, GraphEdge[]>} adjacency  outgoing edges per node id
 */

/**
 * @param {Graph} graph
 * @param {string} startNode
 * @param {string} goalNode
 * @param {(edge: GraphEdge) => {cost:number, forbidden:boolean}} costFn
 * @param {{ maxExpansions?: number }} [options]
 * @returns {{
 *   found: boolean,
 *   reason?: string,
 *   nodes: string[],
 *   edges: GraphEdge[],
 *   cost: number,
 *   distanceMeters: number,
 *   expansions: number
 * }}
 */
export function astar(graph, startNode, goalNode, costFn, options = {}) {
  const maxExpansions = options.maxExpansions ?? ROUTE_MAX_EXPANSIONS;
  const empty = { found: false, nodes: [], edges: [], cost: Infinity, distanceMeters: 0, expansions: 0 };

  if (!graph?.nodes?.has(startNode)) return { ...empty, reason: 'start_not_in_graph' };
  if (!graph.nodes.has(goalNode)) return { ...empty, reason: 'goal_not_in_graph' };
  if (startNode === goalNode) {
    return { found: true, nodes: [startNode], edges: [], cost: 0, distanceMeters: 0, expansions: 0 };
  }

  const goalPos = graph.nodes.get(goalNode);
  const h = (nodeId) => haversineMeters(graph.nodes.get(nodeId), goalPos);

  /** @type {Map<string, number>} */ const gScore = new Map([[startNode, 0]]);
  /** @type {Map<string, {node:string, edge:GraphEdge}>} */ const cameFrom = new Map();
  const closed = new Set();
  const open = new MinHeap();
  open.push({ node: startNode, f: h(startNode) });

  let expansions = 0;

  while (open.size > 0) {
    const current = open.pop();
    if (closed.has(current.node)) continue;
    closed.add(current.node);
    expansions += 1;

    if (current.node === goalNode) {
      return reconstruct(cameFrom, goalNode, gScore.get(goalNode) ?? Infinity, expansions);
    }
    if (expansions > maxExpansions) {
      return { ...empty, reason: 'search_limit_exceeded', expansions };
    }

    const neighbours = graph.adjacency.get(current.node);
    if (!neighbours) continue;

    for (const edge of neighbours) {
      if (closed.has(edge.to)) continue;
      const { cost, forbidden } = costFn(edge);
      if (forbidden || !Number.isFinite(cost)) continue;

      const tentative = (gScore.get(current.node) ?? Infinity) + cost;
      if (tentative < (gScore.get(edge.to) ?? Infinity)) {
        gScore.set(edge.to, tentative);
        cameFrom.set(edge.to, { node: current.node, edge });
        open.push({ node: edge.to, f: tentative + h(edge.to) });
      }
    }
  }

  return { ...empty, reason: 'no_path', expansions };
}

function reconstruct(cameFrom, goalNode, cost, expansions) {
  const nodes = [goalNode];
  const edges = [];
  let cursor = goalNode;
  let guard = 0;
  while (cameFrom.has(cursor)) {
    if (guard += 1, guard > 1e6) break;
    const step = cameFrom.get(cursor);
    edges.push(step.edge);
    nodes.push(step.node);
    cursor = step.node;
  }
  nodes.reverse();
  edges.reverse();
  const distanceMeters = edges.reduce((sum, e) => sum + (e.lengthMeters || 0), 0);
  return { found: true, nodes, edges, cost, distanceMeters, expansions };
}

/**
 * Build a Graph from a flat list of edges. Edges are traversable in both
 * directions: a pedestrian may walk a sidewalk either way, and OSM `oneway`
 * applies to vehicles, not to people on foot.
 *
 * @param {GraphEdge[]} edges
 * @param {Map<string,[number,number]>|Record<string,[number,number]>} nodePositions
 * @returns {Graph}
 */
export function buildGraph(edges, nodePositions) {
  const nodes = nodePositions instanceof Map
    ? new Map(nodePositions)
    : new Map(Object.entries(nodePositions || {}));
  /** @type {Map<string, GraphEdge[]>} */
  const adjacency = new Map();

  const link = (from, to, edge) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push({ ...edge, from, to });
  };

  for (const edge of edges || []) {
    if (!edge || !nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    link(edge.from, edge.to, edge);
    link(edge.to, edge.from, {
      ...edge,
      geometry: Array.isArray(edge.geometry) ? [...edge.geometry].reverse() : undefined,
      reversed: true
    });
  }

  return { nodes, adjacency };
}
