/**
 * Duplicate citizen-report detection.
 *
 * Three residents reporting the same blocked pavement in the same week is one
 * problem, not three. But merging is a judgement call, so this module only
 * *suggests*: it scores candidates and leaves the decision to a reviewer.
 * Nothing is merged automatically.
 */

import { haversineMeters } from './geo.js';
import { DUPLICATE_RADIUS_M, DUPLICATE_WINDOW_DAYS, DUPLICATE_MIN_SCORE } from './config.js';
import { toMillis } from './freshness.js';

const DAY_MS = 86400000;

/** Categories that describe substantially the same physical problem. */
const RELATED_CATEGORIES = Object.freeze({
  broken_pavement: ['surface_problem'],
  surface_problem: ['broken_pavement'],
  blocked_sidewalk: ['temporary_obstruction', 'narrow_passage'],
  temporary_obstruction: ['blocked_sidewalk'],
  narrow_passage: ['blocked_sidewalk'],
  missing_curb_ramp: ['crossing_problem'],
  crossing_problem: ['missing_curb_ramp']
});

/**
 * @typedef {Object} ReportLike
 * @property {string} id
 * @property {string} category
 * @property {{lat:number,lng:number}} location
 * @property {*} createdAt
 * @property {string} [status]
 * @property {string} [segmentId]
 */

/**
 * Score how likely `candidate` is a duplicate of `report` (0..1).
 * @returns {{ score: number, reasons: string[], distanceMeters: number, ageDays: number }}
 */
export function duplicateScore(report, candidate, config = {}) {
  const radius = config.DUPLICATE_RADIUS_M ?? DUPLICATE_RADIUS_M;
  const windowDays = config.DUPLICATE_WINDOW_DAYS ?? DUPLICATE_WINDOW_DAYS;
  const reasons = [];

  const a = [report.location.lng, report.location.lat];
  const b = [candidate.location.lng, candidate.location.lat];
  const distance = haversineMeters(a, b);

  const distanceScore = distance >= radius ? 0 : 1 - distance / radius;
  if (distanceScore > 0.5) reasons.push('duplicate.reason.very_close');
  else if (distanceScore > 0) reasons.push('duplicate.reason.nearby');

  let categoryScore = 0;
  if (report.category === candidate.category) {
    categoryScore = 1;
    reasons.push('duplicate.reason.same_category');
  } else if ((RELATED_CATEGORIES[report.category] || []).includes(candidate.category)) {
    categoryScore = 0.6;
    reasons.push('duplicate.reason.related_category');
  }

  const tA = toMillis(report.createdAt);
  const tB = toMillis(candidate.createdAt);
  let timeScore = 0;
  let ageDays = 0;
  if (tA != null && tB != null) {
    ageDays = Math.abs(tA - tB) / DAY_MS;
    timeScore = ageDays >= windowDays ? 0 : 1 - ageDays / windowDays;
    if (timeScore > 0.7) reasons.push('duplicate.reason.same_period');
  }

  let score = 0.5 * distanceScore + 0.3 * categoryScore + 0.2 * timeScore;

  // Two reports pinned to the same pedestrian segment are strong evidence.
  if (report.segmentId && report.segmentId === candidate.segmentId) {
    score = Math.min(1, score + 0.15);
    reasons.push('duplicate.reason.same_segment');
  }

  return {
    score: Number(score.toFixed(3)),
    reasons,
    distanceMeters: Math.round(distance),
    ageDays: Math.round(ageDays)
  };
}

/**
 * Rank existing open reports as duplicate candidates for a new report.
 * @param {ReportLike} report
 * @param {ReportLike[]} existing
 * @param {Object} [config]
 */
export function findDuplicateCandidates(report, existing, config = {}) {
  const min = config.DUPLICATE_MIN_SCORE ?? DUPLICATE_MIN_SCORE;
  const closedStatuses = new Set(['rejected', 'resolved', 'withdrawn', 'duplicate']);

  return (existing || [])
    .filter((c) => c && c.id !== report.id && !closedStatuses.has(c.status))
    .map((c) => ({ id: c.id, category: c.category, ...duplicateScore(report, c, config) }))
    .filter((c) => c.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
