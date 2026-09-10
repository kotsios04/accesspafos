/**
 * Route planning: three comparable options, each with honest metrics.
 *
 * The product's argument only works if the user can SEE the trade-off, so the
 * recommended accessible route, a balanced route and the plain shortest route
 * are always computed together and reported against each other.
 */

import { astar } from './astar.js';
import { edgeCost, estimateDurationSeconds } from './routingCost.js';
import {
  SHORTEST_PROFILE_ID, ROUTE_HIGH_UNKNOWN_RATIO, ROUTE_MIN_ASSESSED_SHARE_FOR_SCORE
} from './config.js';
import { RouteVariant, RouteProfile, SegmentStatus, Freshness } from './constants.js';
import { bearingDegrees } from './geo.js';

/**
 * @typedef {Object} PlanInput
 * @property {import('./astar.js').Graph} graph
 * @property {string} startNode
 * @property {string} goalNode
 * @property {string} profile               RouteProfile
 * @property {boolean} [preferVerifiedData]
 */

/**
 * Compute the three route options.
 * @param {PlanInput} input
 * @param {Object} [config]
 */
export function planRoutes({ graph, startNode, goalNode, profile = RouteProfile.BALANCED, preferVerifiedData = false } = {}, config = {}) {
  const variants = [
    { variant: RouteVariant.RECOMMENDED, profileId: profile, options: { preferVerifiedData } },
    { variant: RouteVariant.BALANCED, profileId: RouteProfile.BALANCED, options: {} },
    { variant: RouteVariant.SHORTEST, profileId: SHORTEST_PROFILE_ID, options: {} }
  ];

  const raw = variants.map((v) => {
    const result = astar(
      graph, startNode, goalNode,
      (edge) => edgeCost(edge, v.profileId, v.options, config),
      config
    );
    return { ...v, result };
  });

  const shortest = raw.find((r) => r.variant === RouteVariant.SHORTEST);
  const shortestDistance = shortest?.result.found ? shortest.result.distanceMeters : null;
  const shortestBarriers = shortest?.result.found ? collectBarriers(shortest.result.edges) : new Map();

  const options = raw.map((r) => {
    if (!r.result.found) {
      return {
        variant: r.variant,
        profile: r.profileId,
        found: false,
        reason: r.result.reason || 'no_path'
      };
    }
    return summariseRoute(r.result, {
      variant: r.variant,
      profileId: r.profileId,
      shortestDistance,
      shortestBarriers,
      preferVerifiedData
    }, config);
  });

  // Deduplicate: if the recommended and balanced routes are identical, say so
  // rather than presenting the same line twice as if it were a choice.
  const signature = (o) => (o.found ? o.segmentIds.join('|') : `x:${o.reason}`);
  const recSig = signature(options[0]);
  for (let i = 1; i < options.length; i += 1) {
    options[i].sameAsRecommended = signature(options[i]) === recSig;
  }

  return {
    options,
    shortestDistance,
    profile,
    preferVerifiedData
  };
}

function collectBarriers(edges) {
  /** @type {Map<string, number>} */
  const map = new Map();
  for (const e of edges) {
    for (const b of new Set([...(e.barriers || []), ...(e.hardBlocks || [])])) {
      map.set(b, (map.get(b) || 0) + (e.lengthMeters || 0));
    }
  }
  return map;
}

/**
 * Turn a raw A* result into the object the UI renders.
 */
export function summariseRoute(result, meta, config = {}) {
  const { variant, profileId, shortestDistance, shortestBarriers, preferVerifiedData } = meta;
  const edges = result.edges;
  const total = result.distanceMeters || 0;

  /** @type {Record<string, number>} */
  const statusMeters = {
    [SegmentStatus.ACCESSIBLE]: 0,
    [SegmentStatus.PARTIAL]: 0,
    [SegmentStatus.INACCESSIBLE]: 0,
    [SegmentStatus.UNVERIFIED]: 0
  };
  let scoreWeighted = 0;
  let scoreMeters = 0;
  let confidenceWeighted = 0;
  let confidenceMeters = 0;
  let staleMeters = 0;

  for (const e of edges) {
    const len = e.lengthMeters || 0;
    const status = e.status || SegmentStatus.UNVERIFIED;
    statusMeters[status] = (statusMeters[status] || 0) + len;
    // Only segments that cleared the confidence gate may speak to the score.
    // An unverified segment still carries a provisional number, and averaging
    // those in is how a route with no evidence came to report 96 out of 100.
    if (typeof e.accessibilityScore === 'number' && status !== SegmentStatus.UNVERIFIED) {
      scoreWeighted += e.accessibilityScore * len;
      scoreMeters += len;
    }
    if (typeof e.evidenceConfidence === 'number') {
      confidenceWeighted += e.evidenceConfidence * len;
      confidenceMeters += len;
    }
    if (e.freshnessState === Freshness.STALE || e.freshnessState === Freshness.NONE) {
      staleMeters += len;
    }
  }

  const barriers = collectBarriers(edges);
  const barriersOnRoute = [...barriers.entries()]
    .map(([id, meters]) => ({ id, meters: Math.round(meters) }))
    .sort((a, b) => b.meters - a.meters);

  const barriersAvoided = [...(shortestBarriers || new Map()).keys()]
    .filter((b) => !barriers.has(b));

  const unknownRatio = total > 0 ? statusMeters[SegmentStatus.UNVERIFIED] / total : 0;
  const assessedShare = total > 0 ? scoreMeters / total : 0;
  const minAssessedShare = config.ROUTE_MIN_ASSESSED_SHARE_FOR_SCORE ?? ROUTE_MIN_ASSESSED_SHARE_FOR_SCORE;

  const geometry = stitchGeometry(edges);
  const durationSeconds = estimateDurationSeconds(total, profileId, config);

  const summary = {
    variant,
    profile: profileId,
    found: true,
    geometry: { type: 'LineString', coordinates: geometry },
    distanceMeters: Math.round(total),
    durationSeconds,
    accessibilityScore: assessedShare >= minAssessedShare && scoreMeters > 0
      ? Math.round(scoreWeighted / scoreMeters)
      : null,
    assessedShare: Number(assessedShare.toFixed(3)),
    evidenceConfidence: confidenceMeters > 0 ? Math.round(confidenceWeighted / confidenceMeters) : 0,
    statusMeters: Object.fromEntries(Object.entries(statusMeters).map(([k, v]) => [k, Math.round(v)])),
    unknownRatio: Number(unknownRatio.toFixed(3)),
    unknownPercent: Math.round(unknownRatio * 100),
    staleMeters: Math.round(staleMeters),
    barriersOnRoute,
    barriersAvoided,
    extraDistanceMeters: shortestDistance != null ? Math.round(total - shortestDistance) : null,
    extraDistancePercent: shortestDistance ? Math.round(((total - shortestDistance) / shortestDistance) * 100) : null,
    segmentIds: edges.map((e) => e.id),
    routeCost: Math.round(result.cost),
    steps: buildSteps(edges),
    highUnknown: unknownRatio >= (config.ROUTE_HIGH_UNKNOWN_RATIO ?? ROUTE_HIGH_UNKNOWN_RATIO),
    preferVerifiedData: Boolean(preferVerifiedData)
  };

  summary.reasons = explainRoute(summary);
  return summary;
}

/** Concatenate edge geometries without repeating shared vertices. */
export function stitchGeometry(edges) {
  const out = [];
  for (const e of edges) {
    const coords = Array.isArray(e.geometry) && e.geometry.length >= 2
      ? e.geometry
      : null;
    if (!coords) continue;
    for (const c of coords) {
      const last = out[out.length - 1];
      if (!last || last[0] !== c[0] || last[1] !== c[1]) out.push([c[0], c[1]]);
    }
  }
  return out;
}

const TURN_THRESHOLD_DEG = 35;
const SHARP_TURN_DEG = 110;

/**
 * Turn-by-turn instructions. Consecutive edges sharing a street name are
 * merged; a manoeuvre is emitted where the bearing changes materially.
 * Each step also carries the accessibility state of what lies ahead, which is
 * the whole point of navigating with this app rather than a generic one.
 */
export function buildSteps(edges) {
  const steps = [];
  let current = null;

  const flush = () => {
    if (current) {
      current.distanceMeters = Math.round(current.distanceMeters);
      steps.push(current);
      current = null;
    }
  };

  for (let i = 0; i < edges.length; i += 1) {
    const e = edges[i];
    const name = e.streetName || null;
    const prev = i > 0 ? edges[i - 1] : null;

    let manoeuvre = 'continue';
    if (i === 0) {
      manoeuvre = 'depart';
    } else if (prev) {
      const inB = endBearing(prev);
      const outB = startBearing(e);
      if (inB != null && outB != null) {
        const delta = signedDelta(inB, outB);
        const abs = Math.abs(delta);
        if (abs >= SHARP_TURN_DEG) manoeuvre = delta > 0 ? 'sharp_right' : 'sharp_left';
        else if (abs >= TURN_THRESHOLD_DEG) manoeuvre = delta > 0 ? 'turn_right' : 'turn_left';
        else manoeuvre = 'continue';
      }
    }

    const sameStreet = current && current.streetName === name && manoeuvre === 'continue';
    if (sameStreet) {
      current.distanceMeters += e.lengthMeters || 0;
      current.segmentIds.push(e.id);
      mergeStepEvidence(current, e);
    } else {
      flush();
      current = {
        manoeuvre,
        streetName: name,
        distanceMeters: e.lengthMeters || 0,
        segmentIds: [e.id],
        status: e.status || SegmentStatus.UNVERIFIED,
        barriers: [...new Set([...(e.barriers || []), ...(e.hardBlocks || [])])],
        coordinate: firstCoord(e)
      };
    }
  }
  flush();

  if (steps.length > 0) {
    steps.push({
      manoeuvre: 'arrive',
      streetName: steps[steps.length - 1].streetName,
      distanceMeters: 0,
      segmentIds: [],
      status: null,
      barriers: [],
      coordinate: lastCoord(edges[edges.length - 1])
    });
  }
  return steps;
}

function mergeStepEvidence(step, edge) {
  const rank = { accessible: 0, partial: 1, unverified: 2, inaccessible: 3 };
  const next = edge.status || SegmentStatus.UNVERIFIED;
  if ((rank[next] ?? 2) > (rank[step.status] ?? 2)) step.status = next;
  for (const b of [...(edge.barriers || []), ...(edge.hardBlocks || [])]) {
    if (!step.barriers.includes(b)) step.barriers.push(b);
  }
}

function firstCoord(e) {
  return Array.isArray(e.geometry) && e.geometry.length ? e.geometry[0] : null;
}
function lastCoord(e) {
  return Array.isArray(e.geometry) && e.geometry.length ? e.geometry[e.geometry.length - 1] : null;
}
function startBearing(e) {
  const g = e.geometry;
  if (!Array.isArray(g) || g.length < 2) return null;
  return bearingDegrees(g[0], g[1]);
}
function endBearing(e) {
  const g = e.geometry;
  if (!Array.isArray(g) || g.length < 2) return null;
  return bearingDegrees(g[g.length - 2], g[g.length - 1]);
}
/** Signed bearing difference in (-180, 180]; positive means turning right. */
function signedDelta(from, to) {
  let d = ((to - from + 540) % 360) - 180;
  if (d === -180) d = 180;
  return d;
}

/**
 * "Why this route?" - i18n keys plus the numbers they interpolate. The engine
 * never produces user-facing prose; the UI translates these.
 */
export function explainRoute(summary) {
  const reasons = [];

  if (summary.variant === RouteVariant.SHORTEST) {
    reasons.push({ key: 'route.reason.shortest_only_distance' });
  }

  const accessibleShare = summary.distanceMeters > 0
    ? summary.statusMeters[SegmentStatus.ACCESSIBLE] / summary.distanceMeters
    : 0;
  if (accessibleShare >= 0.7) {
    reasons.push({ key: 'route.reason.mostly_assessed_accessible', values: { percent: Math.round(accessibleShare * 100) } });
  }

  if (summary.barriersAvoided.length > 0) {
    reasons.push({ key: 'route.reason.barriers_avoided', values: { barriers: summary.barriersAvoided } });
  }

  if (summary.barriersOnRoute.length > 0) {
    reasons.push({ key: 'route.reason.barriers_remaining', values: { barriers: summary.barriersOnRoute.map((b) => b.id) } });
  }

  if (summary.highUnknown) {
    reasons.push({ key: 'route.reason.high_unknown', values: { percent: summary.unknownPercent } });
  } else if (summary.unknownPercent > 0) {
    reasons.push({ key: 'route.reason.some_unknown', values: { percent: summary.unknownPercent } });
  }

  if (summary.extraDistanceMeters != null && summary.extraDistanceMeters > 20) {
    reasons.push({
      key: 'route.reason.extra_distance',
      values: { meters: summary.extraDistanceMeters, percent: summary.extraDistancePercent }
    });
  } else if (summary.extraDistanceMeters != null && summary.extraDistanceMeters <= 20 && summary.variant !== RouteVariant.SHORTEST) {
    reasons.push({ key: 'route.reason.no_extra_distance' });
  }

  if (summary.staleMeters > 0) {
    reasons.push({ key: 'route.reason.stale_evidence', values: { meters: summary.staleMeters } });
  }

  if (summary.preferVerifiedData) {
    reasons.push({ key: 'route.reason.prefer_verified' });
  }

  return reasons;
}
