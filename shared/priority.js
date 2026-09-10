/**
 * Municipal priority engine (0-100), deterministic and fully itemised.
 *
 * Every factor below is computed from data the system actually holds. There
 * is deliberately NO "estimated pedestrian footfall" factor: we do not have
 * pedestrian counts for Pafos, and inventing them would make the whole
 * ranking unfalsifiable. What we do have is: how bad the barrier is, whether
 * an accessible detour exists, which public services sit nearby in OSM, how
 * many residents confirmed it, how confident and how fresh the evidence is.
 */

import {
  PRIORITY_WEIGHTS, PRIORITY_MANUAL_BOOST_MAX, PRIORITY_POI_RADIUS_M,
  PRIORITY_POI_WEIGHTS, PRIORITY_NO_ALTERNATIVE_RATIO
} from './config.js';
import { SegmentStatus, Freshness, Barrier } from './constants.js';
import { SegmentKind } from './osm.js';

/** Barriers that also carry a road-safety dimension, not only a mobility one. */
const SAFETY_BARRIERS = new Set([
  Barrier.NO_PEDESTRIAN_PATH,
  Barrier.CROSSING_WITHOUT_RAMP,
  Barrier.BLOCKING_OBSTACLE,
  Barrier.MISSING_CURB_RAMP
]);

const FRESHNESS_FACTOR = Object.freeze({
  [Freshness.RECENT]: 1,
  [Freshness.AGING]: 0.6,
  [Freshness.STALE]: 0.25,
  [Freshness.NONE]: 0
});

/**
 * @typedef {Object} PriorityInput
 * @property {string} status
 * @property {number|null} accessibilityScore
 * @property {number} evidenceConfidence
 * @property {string} freshnessState
 * @property {string[]} [barriers]
 * @property {string} [segmentKind]
 * @property {number|null} [detourRatio]  accessible detour length / direct length; null = none found
 * @property {Array<{class:string, distanceMeters:number}>} [nearbyPois]
 * @property {number} [verifiedReportCount]
 * @property {number} [manualBoost]       0..1, set by a municipality admin
 */

/**
 * @param {PriorityInput} input
 * @param {Object} [config]
 * @returns {{ score: number, breakdown: Array<{key:string,points:number,max:number,factor:number,detail?:object}>, manualBoost:number }}
 */
export function computePriority(input = {}, config = {}) {
  const W = config.PRIORITY_WEIGHTS ?? PRIORITY_WEIGHTS;
  const poiRadius = config.PRIORITY_POI_RADIUS_M ?? PRIORITY_POI_RADIUS_M;
  const poiWeights = config.PRIORITY_POI_WEIGHTS ?? PRIORITY_POI_WEIGHTS;
  const noAltRatio = config.PRIORITY_NO_ALTERNATIVE_RATIO ?? PRIORITY_NO_ALTERNATIVE_RATIO;
  const boostMax = config.PRIORITY_MANUAL_BOOST_MAX ?? PRIORITY_MANUAL_BOOST_MAX;

  const {
    status = SegmentStatus.UNVERIFIED,
    accessibilityScore = null,
    evidenceConfidence = 0,
    freshnessState = Freshness.NONE,
    barriers = [],
    segmentKind = null,
    detourRatio = null,
    nearbyPois = [],
    verifiedReportCount = 0,
    manualBoost = 0
  } = input;

  const breakdown = [];
  const add = (key, factor, max, detail) => {
    const f = clamp01(factor);
    breakdown.push({ key, factor: Number(f.toFixed(3)), points: round1(f * max), max, detail });
    return f * max;
  };

  let total = 0;

  // --- 1. severity of the barrier itself ---------------------------------
  // An unverified segment has no severity: we do not know that anything is
  // wrong with it. It belongs in the inspection queue, not the repair queue.
  const severityFactor = (status === SegmentStatus.UNVERIFIED || accessibilityScore == null)
    ? 0
    : (100 - accessibilityScore) / 100;
  total += add('priority.severity', severityFactor, W.severity, {
    status, accessibilityScore
  });

  // --- 2. is there an accessible way round? ------------------------------
  let altFactor;
  if (detourRatio == null) {
    // No accessible alternative could be found at all - the worst case.
    altFactor = 1;
  } else if (detourRatio <= 1.05) {
    altFactor = 0;
  } else {
    altFactor = Math.min(1, (detourRatio - 1) / (noAltRatio - 1));
  }
  total += add('priority.no_accessible_alternative', altFactor, W.noAccessibleAlternative, {
    detourRatio: detourRatio == null ? null : Number(detourRatio.toFixed(2))
  });

  // --- 3. nearby public services (real OSM POIs) -------------------------
  let poiSum = 0;
  const countedPois = [];
  for (const poi of nearbyPois) {
    const w = poiWeights[poi?.class];
    if (!w) continue;
    const d = Number(poi.distanceMeters);
    if (!Number.isFinite(d) || d > poiRadius) continue;
    const decay = 1 - (d / poiRadius) * 0.7; // 100% at the door, 30% at the edge
    poiSum += w * decay;
    countedPois.push({ class: poi.class, distanceMeters: Math.round(d) });
  }
  const poiFactor = 1 - Math.exp(-poiSum / 1.5);
  total += add('priority.nearby_public_services', poiFactor, W.nearbyPublicServices, {
    pois: countedPois.slice(0, 8), radiusMeters: poiRadius
  });

  // --- 4. safety dimension ------------------------------------------------
  const barrierSet = new Set(barriers);
  const hasSafetyBarrier = [...barrierSet].some((b) => SAFETY_BARRIERS.has(b));
  const isCrossing = segmentKind === SegmentKind.CROSSING;
  const isCarriageway = segmentKind === SegmentKind.ROAD_WALKABLE;
  let safetyFactor = 0;
  if (hasSafetyBarrier && (isCrossing || isCarriageway)) safetyFactor = 1;
  else if (hasSafetyBarrier) safetyFactor = 0.6;
  else if (isCrossing) safetyFactor = 0.35;
  total += add('priority.safety_impact', safetyFactor, W.safetyImpact, {
    isCrossing, hasSafetyBarrier
  });

  // --- 5. confirmed resident reports -------------------------------------
  total += add('priority.verified_reports', Math.min(1, verifiedReportCount / 3), W.verifiedCitizenReports, {
    verifiedReportCount
  });

  // --- 6. how much we trust the finding ----------------------------------
  total += add('priority.evidence_confidence', evidenceConfidence / 100, W.evidenceConfidence, {
    evidenceConfidence
  });

  // --- 7. how current the finding is -------------------------------------
  total += add('priority.freshness', FRESHNESS_FACTOR[freshnessState] ?? 0, W.freshness, {
    freshnessState
  });

  // --- 8. explicit municipal boost ---------------------------------------
  const boost = clamp01(manualBoost) * boostMax;
  if (boost > 0) {
    breakdown.push({
      key: 'priority.municipal_boost',
      factor: Number(clamp01(manualBoost).toFixed(3)),
      points: round1(boost),
      max: boostMax
    });
  }

  const score = Math.max(0, Math.min(100, Math.round(total + boost)));

  return { score, breakdown, manualBoost: round1(boost) };
}

/** Coarse band used for colour-coding the priority table. */
export function priorityBand(score) {
  if (score >= 75) return 'critical';
  if (score >= 55) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

function clamp01(n) { return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0)); }
function round1(n) { return Math.round(n * 10) / 10; }
