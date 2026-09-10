/**
 * Accessible route calculation.
 *
 * Wraps the shared planner with graph loading, endpoint snapping and the
 * error cases that actually happen in the field: a destination outside the
 * imported region, an origin in the middle of the sea, a wheelchair profile
 * for which no admissible path exists at all.
 */

import { loadRegionGraph, withVirtualEndpoints, snapToNetwork } from './graph.js';
import { planRoutes } from '../shared/route.js';
import { astar } from '../shared/astar.js';
import { edgeCost } from '../shared/routingCost.js';
import { RouteProfile, RouteVariant, SegmentStatus } from '../shared/constants.js';
import { ROUTE_SNAP_RADIUS_M, SHORTEST_PROFILE_ID, DEFAULT_REGION } from '../shared/config.js';
import { bboxContains } from '../shared/geo.js';

export class RoutingError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RoutingError';
    this.code = code;
    this.details = details;
  }
}

/**
 * @param {Object} input
 * @param {{lat:number,lng:number}} input.origin
 * @param {{lat:number,lng:number}} input.destination
 * @param {string} [input.profile]
 * @param {boolean} [input.preferVerifiedData]
 * @param {string} [input.regionId]
 */
export async function calculateAccessibleRoute(input) {
  const {
    origin, destination,
    profile = RouteProfile.BALANCED,
    preferVerifiedData = false,
    regionId = DEFAULT_REGION.id
  } = input;

  const originPoint = [origin.lng, origin.lat];
  const destPoint = [destination.lng, destination.lat];

  const prepared = await loadRegionGraph(regionId);
  if (!prepared.edgeList.length) {
    throw new RoutingError('empty-graph',
      'This region has no pedestrian network imported yet. Run an OSM import from the municipality console first.');
  }

  let endpoints;
  try {
    endpoints = withVirtualEndpoints(prepared, originPoint, destPoint, ROUTE_SNAP_RADIUS_M);
  } catch (error) {
    throw new RoutingError(
      error.code === 'destination-off-network' ? 'destination-off-network' : 'origin-off-network',
      error.message,
      { snapRadiusMeters: ROUTE_SNAP_RADIUS_M }
    );
  }

  const plan = planRoutes({
    graph: endpoints.graph,
    startNode: endpoints.startNode,
    goalNode: endpoints.goalNode,
    profile,
    preferVerifiedData
  });

  const recommended = plan.options.find((o) => o.variant === RouteVariant.RECOMMENDED);
  const shortest = plan.options.find((o) => o.variant === RouteVariant.SHORTEST);

  // If the accessible profile found nothing but a plain walk exists, say so
  // precisely - "no route" and "no route that avoids steps" are very
  // different messages for a wheelchair user.
  if (!recommended?.found && shortest?.found) {
    return {
      regionId,
      profile,
      preferVerifiedData,
      graphVersion: prepared.version,
      snaps: endpoints.snaps,
      options: plan.options,
      warning: 'no_accessible_route',
      warningDetail: {
        reason: recommended?.reason || 'no_path',
        shortestDistanceMeters: shortest.distanceMeters
      }
    };
  }

  if (!recommended?.found && !shortest?.found) {
    throw new RoutingError('no-route',
      'No pedestrian route could be found between these points in the imported network.',
      { reason: recommended?.reason || 'no_path' });
  }

  return {
    regionId,
    profile,
    preferVerifiedData,
    graphVersion: prepared.version,
    snaps: endpoints.snaps,
    options: plan.options,
    warning: recommended?.highUnknown ? 'high_unknown_coverage' : null,
    warningDetail: recommended?.highUnknown ? { unknownPercent: recommended.unknownPercent } : null
  };
}

/**
 * Detour ratio for the priority engine: how much further is it to get round a
 * barrier than to go through it?
 *
 * Returns `null` when no accessible way round exists at all - which the
 * priority engine treats as the worst case, because it is.
 *
 * @param {string} regionId
 * @param {string} segmentId
 * @param {string} [profile]
 */
export async function accessibleDetourRatio(regionId, segmentId, profile = RouteProfile.WHEELCHAIR) {
  const prepared = await loadRegionGraph(regionId);
  const edge = prepared.edgeList.find((e) => e.id === segmentId);
  if (!edge) return { ratio: null, reason: 'segment-not-found' };

  // Route between the two ends of the barrier while refusing to use it.
  const adjacency = new Map();
  for (const [k, v] of prepared.graph.adjacency) {
    adjacency.set(k, v.filter((e) => e.id !== segmentId));
  }
  const graph = { nodes: prepared.graph.nodes, adjacency };

  const detour = astar(graph, edge.from, edge.to,
    (e) => edgeCost(e, profile, {}, {}));

  if (!detour.found) return { ratio: null, reason: 'no-alternative', direct: edge.lengthMeters };

  const ratio = edge.lengthMeters > 0 ? detour.distanceMeters / edge.lengthMeters : null;
  return {
    ratio: ratio == null ? null : Number(ratio.toFixed(2)),
    direct: edge.lengthMeters,
    detourMeters: Math.round(detour.distanceMeters)
  };
}

/**
 * Which segment is a point on? Used to attach a citizen report to the
 * pedestrian segment it is actually about.
 */
export async function matchPointToSegment(regionId, point, radiusM = 35) {
  const prepared = await loadRegionGraph(regionId);
  const snapped = snapToNetwork(prepared, point, radiusM);
  if (!snapped) return null;
  return {
    segmentId: snapped.edge.id,
    distanceMeters: Math.round(snapped.distance),
    streetName: snapped.edge.streetName || null,
    status: snapped.edge.status || SegmentStatus.UNVERIFIED
  };
}

/** Is this coordinate inside a region we have data for? */
export function isInsideRegion(region, point) {
  return Array.isArray(region?.bbox) && bboxContains(region.bbox, point);
}

export { SHORTEST_PROFILE_ID };
