/**
 * Applying the deterministic assessment to stored data.
 *
 * Nothing in this file decides what is accessible; `shared/assess.js` does.
 * This is the persistence layer around it: gather the evidence a segment
 * has, run the engine, write the result, and keep a history entry whenever
 * the public classification actually changes.
 */

import { db, serverTimestamp, commitInBatches, Timestamp } from '../lib/firebase.js';
import { COLLECTIONS } from '../config/index.js';
import { assessSegment } from '../shared/assess.js';
import { loadObservationsForSegment } from '../ai/observations.js';
import { ReportStatus } from '../shared/constants.js';
import { mapWithConcurrency } from '../lib/http.js';

/** Assessments are one small write each; twelve at a time turns a
 * whole-region pass from minutes into well under one. */
const ASSESSMENT_CONCURRENCY = 12;

/**
 * Recompute one segment from everything currently known about it.
 * @param {string} segmentId
 * @param {{ preloaded?: object, config?: object }} [options]
 */
export async function recomputeSegment(segmentId, options = {}) {
  const segRef = db.collection(COLLECTIONS.segments).doc(segmentId);
  const segSnap = options.preloaded?.segment
    ? { exists: true, data: () => options.preloaded.segment }
    : await segRef.get();

  if (!segSnap.exists) throw new Error(`Segment ${segmentId} does not exist.`);
  const segment = segSnap.data();

  const [observations, citizenReports] = await Promise.all([
    options.preloaded?.observations ?? loadObservationsForSegment(segmentId),
    options.preloaded?.citizenReports ?? loadVerifiedReportsForSegment(segmentId)
  ]);

  const assessment = assessSegment({
    osmTags: segment.osmTags || {},
    osmTimestamp: segment.osmTimestamp || null,
    segmentKind: segment.kind,
    observations,
    citizenReports,
    manualVerification: segment.manualVerification || null
  }, options.config || {});

  await writeAssessment(segRef, segmentId, segment, assessment);
  return assessment;
}

/** Persist an assessment and record a history entry when the status changes. */
export async function writeAssessment(segRef, segmentId, segment, assessment) {
  const previousStatus = segment?.assessment?.status ?? null;
  const summary = toSummary(assessment);

  const writes = [
    {
      type: 'set',
      ref: db.collection(COLLECTIONS.segmentAssessments).doc(segmentId),
      data: {
        segmentId,
        regionId: segment.regionId,
        ...assessment,
        lastEvidenceAt: toTimestamp(assessment.lastEvidenceAt),
        lastVerifiedAt: toTimestamp(assessment.lastVerifiedAt),
        assessedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      },
      options: {}
    },
    {
      type: 'set',
      ref: segRef,
      data: { assessment: summary, updatedAt: serverTimestamp() },
      options: { merge: true }
    }
  ];

  if (previousStatus !== assessment.status) {
    writes.push({
      type: 'set',
      ref: segRef.collection('assessmentHistory').doc(),
      data: {
        from: previousStatus,
        to: assessment.status,
        accessibilityScore: assessment.accessibilityScore,
        evidenceConfidence: assessment.evidenceConfidence,
        reason: assessment.classificationReason,
        assessmentVersion: assessment.assessmentVersion,
        createdAt: serverTimestamp()
      },
      options: {}
    });
  }

  await commitInBatches(writes);
  return { changed: previousStatus !== assessment.status, previousStatus, summary };
}

/**
 * The compact assessment copy stored on the segment document itself. The map
 * bundle and admin filters read this; the full explanation lives in
 * `segmentAssessments` and is fetched only when a user opens a segment.
 */
export function toSummary(assessment) {
  return {
    status: assessment.status,
    accessibilityScore: assessment.accessibilityScore,
    evidenceConfidence: assessment.evidenceConfidence,
    freshnessState: assessment.freshnessState,
    lastEvidenceAt: toTimestamp(assessment.lastEvidenceAt),
    lastVerifiedAt: toTimestamp(assessment.lastVerifiedAt),
    barriers: assessment.barriers,
    positiveFeatures: assessment.positiveFeatures,
    sources: assessment.sources,
    observationCount: assessment.observationCount,
    assessmentVersion: assessment.assessmentVersion,
    classificationReason: assessment.classificationReason
  };
}

export async function loadVerifiedReportsForSegment(segmentId) {
  const snap = await db.collection(COLLECTIONS.citizenReports)
    .where('segmentId', '==', segmentId)
    .where('status', '==', ReportStatus.VERIFIED)
    .limit(25)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Recompute a whole region.
 *
 * Observations and verified reports are loaded once, in bulk, and indexed by
 * segment - a per-segment query would be thousands of round trips and would
 * dominate both the runtime and the Firestore bill.
 *
 * @param {string} regionId
 * @param {{ onProgress?: (n:number, total:number)=>Promise<void>, shouldStop?: ()=>Promise<boolean>, config?: object }} [options]
 */
export async function recomputeRegion(regionId, options = {}) {
  const segmentsSnap = await db.collection(COLLECTIONS.segments)
    .where('regionId', '==', regionId)
    .get();

  const observationsBySegment = await loadRegionObservations(regionId);
  const reportsBySegment = await loadRegionVerifiedReports(regionId);

  let processed = 0;
  let changed = 0;
  let stopped = false;
  const statusCounts = {};

  // Segments are scored independently of one another - `assessSegment` is a
  // pure function of one segment's own evidence - so the only reason this ever
  // ran one at a time was that it was written as a `for` loop. At 8,043
  // segments that is 8,043 sequential Firestore round trips and roughly a
  // quarter of an hour of watching a progress bar. The work is unchanged; only
  // the waiting is shared out.
  //
  // Counters are safe to increment from these tasks: JavaScript runs them on
  // one thread, so no two ever execute between a read and its write.
  await mapWithConcurrency(segmentsSnap.docs, ASSESSMENT_CONCURRENCY, async (doc) => {
    if (stopped) return;
    if (options.shouldStop && await options.shouldStop()) { stopped = true; return; }

    const segment = doc.data();
    const assessment = assessSegment({
      osmTags: segment.osmTags || {},
      osmTimestamp: segment.osmTimestamp || null,
      segmentKind: segment.kind,
      observations: observationsBySegment.get(doc.id) || [],
      citizenReports: reportsBySegment.get(doc.id) || [],
      manualVerification: segment.manualVerification || null
    }, options.config || {});

    const result = await writeAssessment(doc.ref, doc.id, segment, assessment);
    if (result.changed) changed += 1;
    statusCounts[assessment.status] = (statusCounts[assessment.status] || 0) + 1;

    processed += 1;
    if (options.onProgress && processed % 25 === 0) {
      await options.onProgress(processed, segmentsSnap.size);
    }
  });

  if (options.onProgress) await options.onProgress(processed, segmentsSnap.size);

  return { processed, changed, total: segmentsSnap.size, statusCounts };
}

async function loadRegionObservations(regionId) {
  const snap = await db.collection(COLLECTIONS.observations)
    .where('regionId', '==', regionId)
    .where('status', '==', 'active')
    .get();

  /** @type {Map<string, object[]>} */
  const map = new Map();
  for (const doc of snap.docs) {
    const data = doc.data();
    if (!map.has(data.segmentId)) map.set(data.segmentId, []);
    map.get(data.segmentId).push({
      id: doc.id,
      observation: data.observation,
      sourceType: data.sourceType,
      sourceId: data.sourceId,
      capturedAt: data.capturedAt,
      analysedAt: data.analysedAt,
      sourceMeta: data.sourceMeta || {}
    });
  }
  return map;
}

async function loadRegionVerifiedReports(regionId) {
  const snap = await db.collection(COLLECTIONS.citizenReports)
    .where('regionId', '==', regionId)
    .where('status', '==', ReportStatus.VERIFIED)
    .get();

  /** @type {Map<string, object[]>} */
  const map = new Map();
  for (const doc of snap.docs) {
    const data = doc.data();
    if (!data.segmentId) continue;
    if (!map.has(data.segmentId)) map.set(data.segmentId, []);
    map.get(data.segmentId).push({ id: doc.id, ...data });
  }
  return map;
}

function toTimestamp(value) {
  if (value == null) return null;
  if (value instanceof Timestamp) return value;
  if (typeof value === 'number') return Timestamp.fromMillis(value);
  if (value instanceof Date) return Timestamp.fromDate(value);
  return null;
}
