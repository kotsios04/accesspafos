/**
 * Evidence confidence (0-100).
 *
 * This is deliberately NOT the model's self-reported confidence. A language
 * model's stated certainty is not evidence. Confidence here is a function of
 * things that can be checked: how much structured OSM metadata exists, how
 * many usable images were analysed, how well independent observations agree,
 * whether a human has verified the segment, and how old all of that is.
 *
 * Confidence is the gate on classification: below MIN_CONFIDENCE_TO_CLASSIFY
 * a segment stays grey no matter what its provisional score says.
 */

import { CONFIDENCE, MIN_CONFIDENCE_TO_CLASSIFY } from './config.js';
import { freshnessConfidenceFactor } from './freshness.js';
import { Freshness } from './constants.js';

/**
 * @param {Object} input
 * @param {number} [input.osmInformativeness]  0..1 from deriveOsmEvidence()
 * @param {boolean} [input.osmDecisive]        an OSM tag asserts the barrier directly
 * @param {string[]} [input.imageQualities]    per-analysed-image quality
 * @param {number} [input.informativeCount]    observations that said something
 * @param {number} [input.agreement]           0..1 cross-observation agreement
 * @param {number} [input.conflict]            0..1
 * @param {number} [input.verifiedReportCount] reviewer-confirmed citizen reports
 * @param {boolean} [input.manuallyVerified]
 * @param {string} [input.freshnessState]
 * @param {Object} [config]
 * @returns {{ confidence: number, components: Array<{key:string,points:number}>, gate: {min:number, classifiable:boolean} }}
 */
export function computeEvidenceConfidence({
  osmInformativeness = 0,
  osmDecisive = false,
  imageQualities = [],
  informativeCount = 0,
  agreement = 1,
  conflict = 0,
  verifiedReportCount = 0,
  manuallyVerified = false,
  freshnessState = Freshness.NONE
} = {}, config = {}) {
  const c = config.CONFIDENCE ?? CONFIDENCE;
  const minToClassify = config.MIN_CONFIDENCE_TO_CLASSIFY ?? MIN_CONFIDENCE_TO_CLASSIFY;
  const components = [];

  // --- structured OSM metadata ------------------------------------------
  const osmPoints = round1(c.maxOsmContribution * clamp01(osmInformativeness));
  if (osmPoints > 0) components.push({ key: 'confidence.osm_metadata', points: osmPoints });

  // --- analysed imagery --------------------------------------------------
  let imagePoints = 0;
  const counted = imageQualities.slice(0, c.maxCountedImages);
  for (const q of counted) {
    imagePoints += c.imageQualityPoints[q] ?? 0;
  }
  imagePoints = round1(imagePoints);
  if (imagePoints > 0) components.push({ key: 'confidence.analysed_imagery', points: imagePoints });

  // --- agreement between independent observations ------------------------
  let agreementPoints = 0;
  let conflictPoints = 0;
  if (informativeCount >= 2) {
    agreementPoints = round1(c.maxAgreementBonus * clamp01(agreement));
    conflictPoints = -round1(c.maxConflictPenalty * clamp01(conflict));
    if (agreementPoints > 0) components.push({ key: 'confidence.agreement', points: agreementPoints });
    if (conflictPoints < 0) components.push({ key: 'confidence.conflict', points: conflictPoints });
  }

  // --- reviewer-confirmed citizen reports --------------------------------
  const reportPoints = Math.min(
    verifiedReportCount * c.verifiedReportBonus,
    c.maxVerifiedReportBonus
  );
  if (reportPoints > 0) components.push({ key: 'confidence.verified_reports', points: reportPoints });

  const subtotal = osmPoints + imagePoints + agreementPoints + conflictPoints + reportPoints;

  // --- age discount ------------------------------------------------------
  const factor = freshnessConfidenceFactor(freshnessState, config);
  const aged = subtotal * factor;
  if (factor !== 1) {
    components.push({
      key: 'confidence.freshness_discount',
      points: round1(aged - subtotal)
    });
  }

  let confidence = clamp100(aged);

  // --- decisive OSM tagging ---------------------------------------------
  // `highway=steps` is not a hint that there might be steps.
  if (osmDecisive && confidence < c.osmDecisiveFloor) {
    components.push({ key: 'confidence.osm_decisive', points: round1(c.osmDecisiveFloor - confidence) });
    confidence = c.osmDecisiveFloor;
  }

  // --- human verification is the strongest evidence we have --------------
  if (manuallyVerified) {
    const floor = c.manualVerificationFloor;
    if (confidence < floor) {
      components.push({ key: 'confidence.manual_verification', points: round1(floor - confidence) });
      confidence = floor;
    }
  }

  confidence = Math.round(confidence);

  return {
    confidence,
    components,
    gate: { min: minToClassify, classifiable: confidence >= minToClassify }
  };
}

function clamp01(n) { return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0)); }
function clamp100(n) { return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0)); }
function round1(n) { return Math.round(n * 10) / 10; }
