/**
 * Route cost model.
 *
 *   cost(edge) = length x statusMultiplier
 *              + sum(barrier penalties, in equivalent metres)
 *              + uncertainty penalty (length x rate, when unverified)
 *              + freshness penalty  (length x rate, when stale)
 *
 * Costs are expressed in "equivalent metres" so every term is comparable and
 * the A* heuristic (straight-line distance) stays admissible: the multiplier
 * is never below 1 and the penalties are never negative.
 *
 * A profile may also refuse an edge outright. A wheelchair route will report
 * "no accessible route found" rather than send someone down steps.
 */

import {
  ROUTE_STATUS_MULTIPLIERS, ROUTE_PROFILE_RULES, SHORTEST_PROFILE_ID
} from './config.js';
import { SegmentStatus, Freshness, RouteProfile } from './constants.js';

/**
 * @typedef {Object} RoutableEdge
 * @property {number} lengthMeters
 * @property {string} status               SegmentStatus
 * @property {string[]} [barriers]
 * @property {string[]} [hardBlocks]
 * @property {string} [freshnessState]
 * @property {number} [evidenceConfidence]
 */

/**
 * @param {RoutableEdge} edge
 * @param {string} profileId
 * @param {{ preferVerifiedData?: boolean }} [options]
 * @param {Object} [config]
 * @returns {{ cost: number, forbidden: boolean, blockedBy: string[], parts: object }}
 */
export function edgeCost(edge, profileId, options = {}, config = {}) {
  const length = Math.max(0, Number(edge?.lengthMeters) || 0);

  // The comparison route: pure distance, nothing else. This is what a
  // conventional pedestrian router would give you.
  if (profileId === SHORTEST_PROFILE_ID) {
    return {
      cost: length,
      forbidden: false,
      blockedBy: [],
      parts: { base: length, status: 0, barriers: 0, uncertainty: 0, freshness: 0 }
    };
  }

  const multipliers = (config.ROUTE_STATUS_MULTIPLIERS ?? ROUTE_STATUS_MULTIPLIERS)[profileId]
    ?? (config.ROUTE_STATUS_MULTIPLIERS ?? ROUTE_STATUS_MULTIPLIERS)[RouteProfile.BALANCED];
  const rules = (config.ROUTE_PROFILE_RULES ?? ROUTE_PROFILE_RULES)[profileId]
    ?? (config.ROUTE_PROFILE_RULES ?? ROUTE_PROFILE_RULES)[RouteProfile.BALANCED];

  const status = edge?.status || SegmentStatus.UNVERIFIED;
  const barriers = new Set([...(edge?.barriers || []), ...(edge?.hardBlocks || [])]);

  // --- outright refusal ---------------------------------------------------
  const blockedBy = rules.forbidden.filter((b) => barriers.has(b));
  const multiplier = multipliers[status] ?? multipliers[SegmentStatus.UNVERIFIED];
  if (blockedBy.length > 0 || !Number.isFinite(multiplier)) {
    if (!Number.isFinite(multiplier)) blockedBy.push(`status:${status}`);
    return {
      cost: Infinity,
      forbidden: true,
      blockedBy,
      parts: { base: length, status: Infinity, barriers: 0, uncertainty: 0, freshness: 0 }
    };
  }

  // --- classification multiplier -----------------------------------------
  const statusCost = length * multiplier;

  // --- named barrier penalties -------------------------------------------
  let barrierCost = 0;
  const appliedBarriers = [];
  for (const b of barriers) {
    const penalty = rules.barrierPenaltyMeters[b];
    if (typeof penalty === 'number' && penalty > 0) {
      barrierCost += penalty;
      appliedBarriers.push({ id: b, meters: penalty });
    }
  }

  // --- uncertainty --------------------------------------------------------
  let uncertaintyRate = rules.unknownPenaltyPerMeter;
  if (options.preferVerifiedData) uncertaintyRate *= 2;
  const uncertaintyCost = status === SegmentStatus.UNVERIFIED ? length * uncertaintyRate : 0;

  // --- freshness ----------------------------------------------------------
  const fresh = edge?.freshnessState;
  const staleFactor = fresh === Freshness.STALE ? 1 : (fresh === Freshness.NONE ? 1.3 : 0);
  const freshnessCost = length * rules.stalePenaltyPerMeter * staleFactor;

  const cost = statusCost + barrierCost + uncertaintyCost + freshnessCost;

  return {
    cost,
    forbidden: false,
    blockedBy: [],
    parts: {
      base: length,
      status: statusCost,
      barriers: barrierCost,
      uncertainty: uncertaintyCost,
      freshness: freshnessCost,
      multiplier,
      appliedBarriers
    }
  };
}

/** Walking speed for the profile, metres per second. */
export function profileSpeed(profileId, config = {}) {
  const rules = (config.ROUTE_PROFILE_RULES ?? ROUTE_PROFILE_RULES)[profileId];
  return rules?.walkingSpeedMps ?? 1.2;
}

/** Estimated duration in seconds for a distance, by profile. */
export function estimateDurationSeconds(distanceMeters, profileId, config = {}) {
  const speed = profileSpeed(profileId === SHORTEST_PROFILE_ID ? RouteProfile.BALANCED : profileId, config);
  return Math.round(distanceMeters / speed);
}
