/**
 * Multi-observation aggregation.
 *
 * A single street-level image must never define a whole segment on its own.
 * This module votes across every observation attached to a segment, measures
 * how far the observations agree, and emits the same barrier / positive
 * vocabulary that `osm.js` emits - so the scoring engine sees one language.
 *
 * Agreement is not merely reported: it scales the weight of each derived
 * finding, so a contested barrier costs fewer points than a unanimous one.
 */

import { Barrier, PositiveFeature } from './constants.js';
import { SINGLE_OBSERVATION_WEIGHT } from './config.js';
import { AGREEMENT_KEYS, NON_INFORMATIVE, readPath, isEmptyObservation } from './observationSchema.js';

/**
 * @typedef {Object} ObservationRecord
 * @property {object}  observation  a normalised observation
 * @property {string}  sourceType   SourceType
 * @property {string}  sourceId
 * @property {string|number|null} [capturedAt]
 */

/**
 * Worst-first orderings used to break voting ties.
 *
 * When independent observations split evenly, the aggregator takes the more
 * conservative reading. Half the images saying "damaged" and half saying
 * "good" must not be resolved as "good": that would let the system claim an
 * accessibility property it does not actually have evidence for.
 */
export const CONSERVATIVE_ORDER = Object.freeze({
  'pedestrianPath.visible': ['no', 'yes'],
  'pedestrianPath.condition': ['blocked', 'restricted', 'clear'],
  'curbRamp.visible': ['no', 'yes'],
  'curbRamp.condition': ['damaged', 'usable'],
  'stairs.visible': ['yes', 'no'],
  'surface.type': ['dirt', 'gravel', 'other', 'paving_stones', 'paved'],
  'surface.condition': ['damaged', 'uneven', 'good'],
  'obstacle.visible': ['yes', 'no'],
  'obstacle.severity': ['blocking', 'moderate', 'minor', 'none'],
  'clearPassage.classification': ['blocked', 'restricted', 'clear'],
  'crossing.visible': ['no', 'yes']
});

/**
 * Vote across observations for one dotted feature path.
 * Ties are broken toward the more conservative value (see CONSERVATIVE_ORDER).
 * @returns {{ value: string|null, support: number, informative: number, agreement: number, tie: boolean }}
 */
export function voteFeature(observations, path) {
  const counts = new Map();
  let informative = 0;
  for (const obs of observations) {
    const v = readPath(obs, path);
    if (typeof v !== 'string' || NON_INFORMATIVE.includes(v)) continue;
    informative += 1;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  if (informative === 0) {
    return { value: null, support: 0, informative: 0, agreement: 0, tie: false };
  }

  const order = CONSERVATIVE_ORDER[path] || [];
  const rank = (v) => {
    const i = order.indexOf(v);
    return i === -1 ? order.length : i;
  };

  let best = null;
  let bestCount = -1;
  let tie = false;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v; bestCount = c; tie = false;
    } else if (c === bestCount) {
      tie = true;
      // Prefer the more conservative (worse) reading.
      if (rank(v) < rank(best)) best = v;
    }
  }

  return {
    value: best,
    support: bestCount,
    informative,
    agreement: bestCount / informative,
    tie
  };
}

const POOR_SURFACE_TYPES = new Set(['gravel', 'dirt']);

/**
 * Aggregate a set of observations into evidence plus agreement metrics.
 *
 * @param {ObservationRecord[]} records
 * @returns {{
 *   barriers: Array<{id:string,source:string,detail:string,weightScale:number,support:number}>,
 *   positives: Array<{id:string,source:string,detail:string,weightScale:number,support:number}>,
 *   votes: Record<string, ReturnType<typeof voteFeature>>,
 *   observationCount: number,
 *   informativeCount: number,
 *   agreement: number,
 *   conflict: number,
 *   contestedKeys: string[],
 *   imageQualities: string[],
 *   uncertainFindings: string[]
 * }}
 */
export function aggregateObservations(records) {
  const list = Array.isArray(records) ? records.filter((r) => r && r.observation) : [];
  const observations = list.map((r) => r.observation);
  const informativeObs = observations.filter((o) => !isEmptyObservation(o));

  /** @type {Record<string, ReturnType<typeof voteFeature>>} */
  const votes = {};
  const contestedKeys = [];
  let agreementSum = 0;
  let agreementKeys = 0;

  for (const key of AGREEMENT_KEYS) {
    const v = voteFeature(observations, key);
    votes[key] = v;
    if (v.informative >= 2) {
      agreementSum += v.agreement;
      agreementKeys += 1;
      if (v.agreement < 1) contestedKeys.push(key);
    }
  }

  const agreement = agreementKeys > 0 ? agreementSum / agreementKeys : 1;
  const conflict = agreementKeys > 0 ? 1 - agreement : 0;

  const barriers = [];
  const positives = [];

  // Label the evidence by where it actually came from. Two agreeing Mapillary
  // frames are still Mapillary evidence, and saying "visual" would throw that
  // provenance away — which then surfaces in the UI as an untranslatable
  // source with no explanation behind it. Only a genuinely mixed set falls
  // back to the generic label.
  const sourceTypes = [...new Set(list.map((r) => r.sourceType).filter(Boolean))];
  const sourceLabel = sourceTypes.length === 1 ? sourceTypes[0] : 'visual';

  /** Weight a finding by how much the observations agreed about it. */
  // Weight a finding by how well the evidence actually supports it: the share
  // of informative observations that agreed, and - for a finding only one
  // photograph could speak to - a discount, because "one frame saw it and the
  // others could not tell" is weaker than "three frames agreed" and used to
  // score identically. See SINGLE_OBSERVATION_WEIGHT.
  const scale = (v) => {
    if (v.informative === 0) return 0;
    if (v.informative === 1) return SINGLE_OBSERVATION_WEIGHT;
    return v.agreement;
  };

  const push = (target, id, vote, detail) => {
    target.push({
      id,
      source: sourceLabel,
      detail,
      weightScale: scale(vote),
      support: vote.support
    });
  };

  // --- pedestrian path ---------------------------------------------------
  const pathVisible = votes['pedestrianPath.visible'];
  if (pathVisible.value === 'no') {
    push(barriers, Barrier.NO_PEDESTRIAN_PATH, pathVisible,
      'No pedestrian path visible in the street-level imagery');
  }
  const pathCondition = votes['pedestrianPath.condition'];
  if (pathCondition.value === 'blocked') {
    push(barriers, Barrier.BLOCKING_OBSTACLE, pathCondition, 'Pedestrian path observed blocked');
  } else if (pathCondition.value === 'restricted') {
    push(barriers, Barrier.RESTRICTED_PASSAGE, pathCondition, 'Pedestrian path observed restricted');
  } else if (pathCondition.value === 'clear' && pathVisible.value === 'yes') {
    push(positives, PositiveFeature.CLEAR_PATH, pathCondition, 'Clear pedestrian path observed');
  }

  // --- curb ramp ---------------------------------------------------------
  const ramp = votes['curbRamp.visible'];
  if (ramp.value === 'no') {
    push(barriers, Barrier.MISSING_CURB_RAMP, ramp, 'Kerb observed without a dropped-kerb ramp');
  } else if (ramp.value === 'yes') {
    const cond = voteFeature(observations, 'curbRamp.condition');
    if (cond.value === 'damaged') {
      push(barriers, Barrier.MISSING_CURB_RAMP, cond, 'Curb ramp observed but damaged');
      barriers[barriers.length - 1].weightScale *= 0.6;
    } else {
      push(positives, PositiveFeature.CURB_RAMP, ramp, 'Curb ramp observed');
    }
  }

  // --- stairs ------------------------------------------------------------
  const stairs = votes['stairs.visible'];
  if (stairs.value === 'yes') {
    push(barriers, Barrier.STEPS, stairs, 'Steps observed in the street-level imagery');
  }

  // --- surface -----------------------------------------------------------
  const sType = votes['surface.type'];
  const sCond = votes['surface.condition'];
  if (sCond.value === 'damaged') {
    push(barriers, Barrier.DAMAGED_SURFACE, sCond, 'Damaged walking surface observed');
  } else if (sCond.value === 'uneven') {
    push(barriers, Barrier.UNEVEN_SURFACE, sCond, 'Uneven walking surface observed');
  }
  if (sType.value && POOR_SURFACE_TYPES.has(sType.value)) {
    push(barriers, Barrier.UNSUITABLE_SURFACE, sType, `Surface observed as ${sType.value}`);
  }
  if (sCond.value === 'good' && (sType.value === 'paved' || sType.value === 'paving_stones')) {
    push(positives, PositiveFeature.GOOD_PAVED_SURFACE, sCond, 'Good paved surface observed');
  }

  // --- obstacles / passage ----------------------------------------------
  const sev = votes['obstacle.severity'];
  if (sev.value === 'blocking') {
    const desc = describeObstacle(observations);
    push(barriers, Barrier.BLOCKING_OBSTACLE, sev, desc || 'Blocking obstacle observed');
  } else if (sev.value === 'moderate') {
    const desc = describeObstacle(observations);
    push(barriers, Barrier.RESTRICTED_PASSAGE, sev, desc || 'Obstacle narrowing the passage');
  }

  const passage = votes['clearPassage.classification'];
  if (passage.value === 'blocked' && sev.value !== 'blocking') {
    push(barriers, Barrier.BLOCKING_OBSTACLE, passage, 'Passage observed blocked');
  } else if (passage.value === 'restricted' && sev.value !== 'moderate' && sev.value !== 'blocking') {
    push(barriers, Barrier.RESTRICTED_PASSAGE, passage, 'Passage observed restricted');
  }

  // --- crossings ---------------------------------------------------------
  const crossingFeatures = new Map();
  for (const o of observations) {
    const feats = o?.crossing?.accessibleFeatures;
    if (Array.isArray(feats)) {
      for (const f of feats) crossingFeatures.set(f, (crossingFeatures.get(f) || 0) + 1);
    }
  }
  const featureVote = (name) => {
    const support = crossingFeatures.get(name) || 0;
    return { value: support > 0 ? name : null, support, informative: informativeObs.length, agreement: 1 };
  };
  if (crossingFeatures.has('tactile_paving')) {
    push(positives, PositiveFeature.TACTILE_PAVING, featureVote('tactile_paving'), 'Tactile paving observed at the crossing');
  }
  if (crossingFeatures.has('dropped_kerb')) {
    push(positives, PositiveFeature.CURB_RAMP, featureVote('dropped_kerb'), 'Dropped kerb observed at the crossing');
  }
  if (crossingFeatures.has('traffic_signals') || crossingFeatures.has('marked_crossing')
      || crossingFeatures.has('audible_signal') || crossingFeatures.has('refuge_island')) {
    push(positives, PositiveFeature.ACCESSIBLE_CROSSING, featureVote('marked_crossing'),
      'Crossing infrastructure observed');
  }

  const uncertainFindings = [...new Set(
    observations.flatMap((o) => (Array.isArray(o.uncertainFindings) ? o.uncertainFindings : []))
  )].slice(0, 8);

  return {
    barriers,
    positives,
    votes,
    observationCount: observations.length,
    informativeCount: informativeObs.length,
    agreement,
    conflict,
    contestedKeys,
    imageQualities: observations.map((o) => o.imageQuality).filter(Boolean),
    uncertainFindings
  };
}

function describeObstacle(observations) {
  for (const o of observations) {
    const d = o?.obstacle?.description;
    if (typeof d === 'string' && d.trim()) return d.trim();
  }
  return null;
}
