/**
 * The assessment pipeline, end to end and in one place.
 *
 *   OSM tags ─┐
 *   AI observations ─┼─> common barrier/positive vocabulary
 *   verified citizen reports ─┘
 *                    │
 *                    ├─> deterministic score          (scoring.js)
 *                    ├─> evidence confidence          (confidence.js)
 *                    ├─> freshness                    (freshness.js)
 *                    └─> classification               (classify.js)
 *
 * Everything the UI needs to answer "why?" is returned alongside the numbers.
 */

import { deriveOsmEvidence } from './osm.js';
import { aggregateObservations } from './aggregate.js';
import { computeAccessibilityScore, explainScore } from './scoring.js';
import { computeEvidenceConfidence } from './confidence.js';
import { computeFreshness, toMillis } from './freshness.js';
import { classifySegment } from './classify.js';
import { ASSESSMENT_VERSION, ANALYSIS_VERSION } from './config.js';
import { SourceType, Barrier } from './constants.js';

/**
 * Barrier evidence contributed by citizen reports that a reviewer has
 * confirmed. Unconfirmed reports never reach this function: a report on its
 * own does not turn a street red.
 */
const REPORT_CATEGORY_TO_BARRIER = Object.freeze({
  broken_pavement: Barrier.DAMAGED_SURFACE,
  missing_curb_ramp: Barrier.MISSING_CURB_RAMP,
  steps: Barrier.STEPS,
  blocked_sidewalk: Barrier.BLOCKING_OBSTACLE,
  narrow_passage: Barrier.NARROW_WIDTH,
  surface_problem: Barrier.UNSUITABLE_SURFACE,
  crossing_problem: Barrier.CROSSING_WITHOUT_RAMP,
  temporary_obstruction: Barrier.BLOCKING_OBSTACLE,
  other: null
});

export function reportCategoryToBarrier(category) {
  return REPORT_CATEGORY_TO_BARRIER[category] ?? null;
}

/**
 * @typedef {Object} AssessmentInput
 * @property {Record<string,string>} [osmTags]
 * @property {*} [osmTimestamp]  last edit time of the OSM element (Overpass `meta`)
 * @property {string} [segmentKind]
 * @property {Array<{observation:object, sourceType:string, sourceId:string, capturedAt?:*, analysedAt?:*}>} [observations]
 * @property {Array<{category:string, status:string, verifiedAt?:*, id?:string}>} [citizenReports]
 * @property {{status:string, by?:string, at?:*, notes?:string}|null} [manualVerification]
 * @property {number} [now]
 */

/**
 * Produce a complete, explainable segment assessment.
 * @param {AssessmentInput} input
 * @param {Object} [config]
 */
export function assessSegment(input = {}, config = {}) {
  const {
    osmTags = {},
    osmTimestamp = null,
    segmentKind,
    observations = [],
    citizenReports = [],
    manualVerification = null,
    now = Date.now()
  } = input;

  // --- 1. structured OSM evidence ---------------------------------------
  const osm = deriveOsmEvidence(osmTags, { kind: segmentKind });

  // --- 2. visual evidence -----------------------------------------------
  const visual = aggregateObservations(observations);

  // --- 3. confirmed citizen evidence ------------------------------------
  const verifiedReports = citizenReports.filter((r) => r && r.status === 'verified');
  const citizenBarriers = [];
  for (const r of verifiedReports) {
    const id = reportCategoryToBarrier(r.category);
    if (!id) continue;
    citizenBarriers.push({
      id,
      source: SourceType.CITIZEN,
      detail: 'Reported by a resident and confirmed by a municipal reviewer',
      // A confirmed report is real but is a point observation about a segment;
      // it carries slightly less than full weight on its own.
      weightScale: 0.85
    });
  }

  // --- 4. manual verification -------------------------------------------
  const manualPositives = [];
  const manuallyVerified = Boolean(manualVerification && manualVerification.at);
  if (manuallyVerified && manualVerification.status === 'accessible') {
    manualPositives.push({
      id: 'manually_verified',
      source: SourceType.MANUAL,
      detail: 'Verified on site by a municipal reviewer',
      weightScale: 1
    });
  }

  const barriers = [...osm.barriers, ...visual.barriers, ...citizenBarriers];
  const positives = [...osm.positives, ...visual.positives, ...manualPositives];

  const hasAnyEvidence =
    barriers.length > 0 || positives.length > 0 ||
    osm.informativeness > 0 || visual.informativeCount > 0 || manuallyVerified;

  // --- 5. score ----------------------------------------------------------
  const breakdown = hasAnyEvidence
    ? computeAccessibilityScore({ barriers, positives }, config)
    : null;

  // --- 6. freshness ------------------------------------------------------
  const evidenceTimes = [
    ...observations.map((o) => toMillis(o.capturedAt) ?? toMillis(o.analysedAt)),
    ...verifiedReports.map((r) => toMillis(r.verifiedAt)),
    // An OSM element's own last-edit time dates the structured evidence.
    osm.informativeness > 0 ? toMillis(osmTimestamp) : null
  ].filter((t) => typeof t === 'number');
  const lastEvidenceAt = evidenceTimes.length ? Math.max(...evidenceTimes) : null;
  const lastVerifiedAt = manuallyVerified ? toMillis(manualVerification.at) : null;
  const freshness = computeFreshness({ lastEvidenceAt, lastVerifiedAt, now }, config);

  // --- 7. confidence -----------------------------------------------------
  const confidenceResult = computeEvidenceConfidence({
    osmInformativeness: osm.informativeness,
    osmDecisive: osm.decisive,
    imageQualities: visual.imageQualities,
    informativeCount: visual.informativeCount,
    agreement: visual.agreement,
    conflict: visual.conflict,
    verifiedReportCount: verifiedReports.length,
    manuallyVerified,
    freshnessState: freshness.state
  }, config);

  // --- 8. classification -------------------------------------------------
  // A reviewer may pin a status explicitly (`override: true`). Otherwise their
  // verification only feeds confidence, and the engine still does the maths.
  const override = manualVerification && manualVerification.override === true
    ? manualVerification
    : null;

  const classification = classifySegment({
    score: breakdown ? breakdown.score : null,
    confidence: confidenceResult.confidence,
    hasAnyEvidence,
    manualOverride: override
  }, config);

  // --- 9. provenance summary --------------------------------------------
  const sources = [];
  if (osm.informativeness > 0 || Object.keys(osmTags).length > 0) sources.push(SourceType.OSM);
  if (observations.some((o) => o.sourceType === SourceType.MAPILLARY)) sources.push(SourceType.MAPILLARY);
  if (observations.some((o) => o.sourceType === SourceType.CITIZEN)) sources.push(SourceType.CITIZEN);
  if (verifiedReports.length) {
    if (!sources.includes(SourceType.CITIZEN)) sources.push(SourceType.CITIZEN);
  }
  if (manuallyVerified) sources.push(SourceType.MANUAL);

  return {
    status: classification.status,
    classificationReason: classification.reason,
    accessibilityScore: breakdown ? breakdown.score : null,
    evidenceConfidence: confidenceResult.confidence,
    freshnessState: freshness.state,
    evidenceAgeDays: freshness.ageDays,
    lastEvidenceAt: freshness.referenceAt,
    lastVerifiedAt,
    barriers: breakdown ? breakdown.barrierIds : [],
    positiveFeatures: breakdown ? breakdown.positiveIds : [],
    hardBlocks: osm.hardBlocks,
    sources: [...new Set(sources)],
    observationCount: visual.observationCount,
    informativeObservationCount: visual.informativeCount,
    osmInformativeness: Number(osm.informativeness.toFixed(2)),
    osmKnownTags: osm.knownTags,
    agreement: Number(visual.agreement.toFixed(2)),
    contestedFeatures: visual.contestedKeys,
    uncertainFindings: visual.uncertainFindings,
    assessmentVersion: config.ASSESSMENT_VERSION ?? ASSESSMENT_VERSION,
    analysisVersion: config.ANALYSIS_VERSION ?? ANALYSIS_VERSION,
    assessedAt: now,
    explanation: {
      score: breakdown ? explainScore(breakdown) : null,
      confidence: confidenceResult.components,
      gate: confidenceResult.gate,
      thresholds: classification.thresholds
    }
  };
}
