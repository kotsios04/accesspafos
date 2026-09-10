/**
 * Classification: score + confidence -> the four-state accessibility layer.
 *
 * The order of the checks matters and is the product's central promise:
 * confidence is examined BEFORE the score. A segment we do not have enough
 * evidence about is `unverified` and grey, whatever its provisional score.
 */

import { SegmentStatus } from './constants.js';
import { ACCESSIBLE_THRESHOLD, PARTIAL_THRESHOLD, MIN_CONFIDENCE_TO_CLASSIFY } from './config.js';

export const ClassificationReason = Object.freeze({
  INSUFFICIENT_EVIDENCE: 'insufficient_evidence',
  NO_EVIDENCE: 'no_evidence',
  SCORE_BAND: 'score_band',
  MANUAL_OVERRIDE: 'manual_override'
});

/**
 * @param {Object} input
 * @param {number|null} input.score
 * @param {number} input.confidence
 * @param {boolean} [input.hasAnyEvidence]
 * @param {{status:string, by?:string, at?:*, notes?:string}|null} [input.manualOverride]
 * @param {Object} [config]
 * @returns {{ status: string, reason: string, thresholds: object }}
 */
export function classifySegment({
  score,
  confidence = 0,
  hasAnyEvidence = true,
  manualOverride = null
} = {}, config = {}) {
  const accessibleAt = config.ACCESSIBLE_THRESHOLD ?? ACCESSIBLE_THRESHOLD;
  const partialAt = config.PARTIAL_THRESHOLD ?? PARTIAL_THRESHOLD;
  const minConfidence = config.MIN_CONFIDENCE_TO_CLASSIFY ?? MIN_CONFIDENCE_TO_CLASSIFY;
  const thresholds = { accessibleAt, partialAt, minConfidence };

  // A municipal reviewer who has stood on the pavement outranks the pipeline.
  if (manualOverride && isKnownStatus(manualOverride.status)) {
    return {
      status: manualOverride.status,
      reason: ClassificationReason.MANUAL_OVERRIDE,
      thresholds
    };
  }

  if (!hasAnyEvidence || score == null) {
    return { status: SegmentStatus.UNVERIFIED, reason: ClassificationReason.NO_EVIDENCE, thresholds };
  }

  if (confidence < minConfidence) {
    return {
      status: SegmentStatus.UNVERIFIED,
      reason: ClassificationReason.INSUFFICIENT_EVIDENCE,
      thresholds
    };
  }

  let status;
  if (score >= accessibleAt) status = SegmentStatus.ACCESSIBLE;
  else if (score >= partialAt) status = SegmentStatus.PARTIAL;
  else status = SegmentStatus.INACCESSIBLE;

  return { status, reason: ClassificationReason.SCORE_BAND, thresholds };
}

function isKnownStatus(s) {
  return s === SegmentStatus.ACCESSIBLE || s === SegmentStatus.PARTIAL
    || s === SegmentStatus.INACCESSIBLE || s === SegmentStatus.UNVERIFIED;
}
