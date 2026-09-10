/**
 * Freshness: how old the newest evidence about a segment is.
 *
 * Freshness is reported separately from the score and from confidence,
 * because "we were confident about this in 2019" is a different statement
 * from "we are confident about this now". Routing penalises stale evidence;
 * the UI always shows the capture date.
 */

import { Freshness } from './constants.js';
import { FRESHNESS_THRESHOLDS, FRESHNESS_CONFIDENCE_FACTOR } from './config.js';

const DAY_MS = 86400000;

/** Coerce Firestore Timestamp | Date | ISO string | epoch ms to epoch ms. */
export function toMillis(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === 'object') {
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    if (typeof value._seconds === 'number') return value._seconds * 1000;
  }
  return null;
}

/**
 * @param {Object} input
 * @param {*} [input.lastEvidenceAt]   newest capture/analysis timestamp
 * @param {*} [input.lastVerifiedAt]   newest human verification timestamp
 * @param {number} [input.now]
 * @param {Object} [config]
 * @returns {{ state: string, ageDays: number|null, referenceAt: number|null, verified: boolean }}
 */
export function computeFreshness({ lastEvidenceAt, lastVerifiedAt, now = Date.now() } = {}, config = {}) {
  const thresholds = config.FRESHNESS_THRESHOLDS ?? FRESHNESS_THRESHOLDS;
  const evidenceMs = toMillis(lastEvidenceAt);
  const verifiedMs = toMillis(lastVerifiedAt);
  const referenceAt = Math.max(evidenceMs ?? -Infinity, verifiedMs ?? -Infinity);

  if (!Number.isFinite(referenceAt)) {
    return { state: Freshness.NONE, ageDays: null, referenceAt: null, verified: false };
  }

  const ageDays = Math.max(0, (now - referenceAt) / DAY_MS);
  let state;
  if (ageDays <= thresholds.recentMaxDays) state = Freshness.RECENT;
  else if (ageDays <= thresholds.agingMaxDays) state = Freshness.AGING;
  else state = Freshness.STALE;

  return {
    state,
    ageDays: Math.round(ageDays),
    referenceAt,
    verified: verifiedMs != null && verifiedMs >= (evidenceMs ?? -Infinity)
  };
}

/** Multiplier applied to evidence confidence for a freshness state. */
export function freshnessConfidenceFactor(state, config = {}) {
  const table = config.FRESHNESS_CONFIDENCE_FACTOR ?? FRESHNESS_CONFIDENCE_FACTOR;
  return table[state] ?? 1;
}

/** True when a segment should be queued for re-checking. */
export function isStale(state) {
  return state === Freshness.STALE || state === Freshness.NONE;
}
