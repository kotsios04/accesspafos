/**
 * Deterministic accessibility scoring engine.
 *
 * The AI never produces the score. The AI produces structured *observations*;
 * `osm.js` and `aggregate.js` turn observations and OSM tags into a common
 * vocabulary of barriers and positive features; this module turns that
 * vocabulary into a number, deterministically, with a full audit trail.
 *
 * Re-running this function on the same evidence always produces the same
 * score, which is what makes "Why this score?" answerable in the UI.
 */

import {
  SCORING_BASE, SCORING_PENALTIES, SCORING_POSITIVES, MAX_POSITIVE_BONUS,
  BARRIER_SCORE_CEILINGS
} from './config.js';
import { Barrier, PositiveFeature } from './constants.js';

/**
 * Pairs that cannot both be true of the same segment. When both appear, the
 * one supported by stronger evidence wins and the other is recorded as a
 * resolved contradiction rather than silently dropped.
 */
export const CONTRADICTIONS = Object.freeze([
  [Barrier.MISSING_CURB_RAMP, PositiveFeature.CURB_RAMP],
  [Barrier.HIGH_KERB, PositiveFeature.FLUSH_KERB],
  [Barrier.NARROW_WIDTH, PositiveFeature.ADEQUATE_WIDTH],
  [Barrier.NO_PEDESTRIAN_PATH, PositiveFeature.CLEAR_PATH],
  [Barrier.DAMAGED_SURFACE, PositiveFeature.GOOD_PAVED_SURFACE],
  [Barrier.UNSUITABLE_SURFACE, PositiveFeature.GOOD_PAVED_SURFACE],
  [Barrier.UNEVEN_SURFACE, PositiveFeature.GOOD_PAVED_SURFACE],
  [Barrier.BLOCKING_OBSTACLE, PositiveFeature.CLEAR_PATH],
  [Barrier.CROSSING_WITHOUT_RAMP, PositiveFeature.CURB_RAMP],
  [Barrier.WHEELCHAIR_TAGGED_NO, PositiveFeature.WHEELCHAIR_TAGGED_YES]
]);

/**
 * Collapse repeated findings of the same id, keeping the strongest weight and
 * remembering every source that contributed. This is what stops the same
 * barrier being counted twice because OSM and a photo both saw it.
 * @param {Array<{id:string,source:string,detail?:string,weightScale?:number}>} items
 */
export function dedupeEvidence(items) {
  /** @type {Map<string, {id:string,sources:string[],details:string[],weightScale:number}>} */
  const byId = new Map();
  for (const item of items || []) {
    if (!item || typeof item.id !== 'string') continue;
    const w = typeof item.weightScale === 'number' ? clamp01(item.weightScale) : 1;
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, {
        id: item.id,
        sources: [item.source].filter(Boolean),
        details: [item.detail].filter(Boolean),
        weightScale: w
      });
    } else {
      if (item.source && !existing.sources.includes(item.source)) existing.sources.push(item.source);
      if (item.detail && !existing.details.includes(item.detail)) existing.details.push(item.detail);
      // Corroboration from an independent source strengthens the finding, but
      // never beyond full weight.
      existing.weightScale = Math.min(1, Math.max(existing.weightScale, w) +
        (existing.sources.length > 1 ? 0.15 : 0));
    }
  }
  return [...byId.values()];
}

function clamp01(n) { return Math.max(0, Math.min(1, n)); }

/**
 * Resolve barrier/positive contradictions in favour of the stronger evidence.
 * @returns {{ barriers: any[], positives: any[], resolvedConflicts: Array<{kept:string,dropped:string}> }}
 */
export function resolveContradictions(barriers, positives) {
  const bMap = new Map(barriers.map((b) => [b.id, b]));
  const pMap = new Map(positives.map((p) => [p.id, p]));
  const resolvedConflicts = [];

  for (const [barrierId, positiveId] of CONTRADICTIONS) {
    const b = bMap.get(barrierId);
    const p = pMap.get(positiveId);
    if (!b || !p) continue;
    if (b.weightScale >= p.weightScale) {
      pMap.delete(positiveId);
      resolvedConflicts.push({ kept: barrierId, dropped: positiveId });
    } else {
      bMap.delete(barrierId);
      resolvedConflicts.push({ kept: positiveId, dropped: barrierId });
    }
  }

  return {
    barriers: [...bMap.values()],
    positives: [...pMap.values()],
    resolvedConflicts
  };
}

/**
 * @typedef {Object} ScoreBreakdownItem
 * @property {string}   id
 * @property {number}   points     positive number of points removed or added
 * @property {string[]} sources
 * @property {string[]} details
 * @property {number}   weightScale
 */

/**
 * Compute a segment's accessibility score from its evidence.
 *
 * @param {Object} input
 * @param {Array}  input.barriers   barrier evidence items (osm + visual + citizen)
 * @param {Array}  input.positives  positive evidence items
 * @param {Object} [config]         overrides from mergeRuntimeConfig()
 * @returns {{
 *   score: number,
 *   base: number,
 *   penalties: ScoreBreakdownItem[],
 *   bonuses: ScoreBreakdownItem[],
 *   totalPenalty: number,
 *   totalBonus: number,
 *   cappedBonus: number,
 *   resolvedConflicts: Array<{kept:string,dropped:string}>,
 *   barrierIds: string[],
 *   positiveIds: string[]
 * }}
 */
export function computeAccessibilityScore({ barriers = [], positives = [] } = {}, config = {}) {
  const base = config.SCORING_BASE ?? SCORING_BASE;
  const penaltyWeights = config.SCORING_PENALTIES ?? SCORING_PENALTIES;
  const positiveWeights = config.SCORING_POSITIVES ?? SCORING_POSITIVES;
  const maxBonus = config.MAX_POSITIVE_BONUS ?? MAX_POSITIVE_BONUS;

  const dedupedBarriers = dedupeEvidence(barriers);
  const dedupedPositives = dedupeEvidence(positives);
  const resolved = resolveContradictions(dedupedBarriers, dedupedPositives);

  /** @type {ScoreBreakdownItem[]} */
  const penalties = [];
  let totalPenalty = 0;
  for (const b of resolved.barriers) {
    const weight = penaltyWeights[b.id];
    if (typeof weight !== 'number') continue; // unknown barrier: never guess a cost
    const points = round1(weight * b.weightScale);
    if (points <= 0) continue;
    totalPenalty += points;
    penalties.push({ id: b.id, points, sources: b.sources, details: b.details, weightScale: b.weightScale });
  }

  /** @type {ScoreBreakdownItem[]} */
  const bonuses = [];
  let totalBonus = 0;
  for (const p of resolved.positives) {
    const weight = positiveWeights[p.id];
    if (typeof weight !== 'number') continue;
    const points = round1(weight * p.weightScale);
    if (points <= 0) continue;
    totalBonus += points;
    bonuses.push({ id: p.id, points, sources: p.sources, details: p.details, weightScale: p.weightScale });
  }

  penalties.sort((a, b) => b.points - a.points);
  bonuses.sort((a, b) => b.points - a.points);

  const cappedBonus = Math.min(totalBonus, maxBonus);
  const rawScore = clampScore(base - totalPenalty + cappedBonus);

  // Severe barriers impose a hard ceiling that positives cannot climb over.
  const ceilings = config.BARRIER_SCORE_CEILINGS ?? BARRIER_SCORE_CEILINGS;
  let ceiling = 100;
  let ceilingBarrier = null;
  for (const b of resolved.barriers) {
    const c = ceilings[b.id];
    if (typeof c !== 'number') continue;
    const effective = 100 - (100 - c) * b.weightScale;
    if (effective < ceiling) { ceiling = effective; ceilingBarrier = b.id; }
  }
  const score = clampScore(Math.min(rawScore, ceiling));

  return {
    score,
    rawScore,
    ceiling: ceiling >= 100 ? null : Math.round(ceiling),
    ceilingBarrier: score < rawScore ? ceilingBarrier : null,
    base,
    penalties,
    bonuses,
    totalPenalty: round1(totalPenalty),
    totalBonus: round1(totalBonus),
    cappedBonus: round1(cappedBonus),
    resolvedConflicts: resolved.resolvedConflicts,
    barrierIds: resolved.barriers.map((b) => b.id),
    positiveIds: resolved.positives.map((p) => p.id)
  };
}

function round1(n) { return Math.round(n * 10) / 10; }

export function clampScore(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Human-readable, translatable explanation keys for a score breakdown.
 * The UI renders `i18n.t('barrier.' + id)`; this keeps the engine free of copy.
 */
export function explainScore(breakdown) {
  return {
    base: breakdown.base,
    ceiling: breakdown.ceilingBarrier
      ? { key: `ceiling.${breakdown.ceilingBarrier}`, value: breakdown.ceiling, from: breakdown.rawScore }
      : null,
    subtractions: breakdown.penalties.map((p) => ({
      key: `barrier.${p.id}`,
      points: -p.points,
      sources: p.sources,
      details: p.details
    })),
    additions: breakdown.bonuses.map((b) => ({
      key: `positive.${b.id}`,
      points: b.points,
      sources: b.sources,
      details: b.details
    })),
    bonusCapped: breakdown.totalBonus > breakdown.cappedBonus,
    total: breakdown.score
  };
}
