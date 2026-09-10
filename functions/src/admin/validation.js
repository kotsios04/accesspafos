/**
 * Validation: measuring whether the AI is any good, honestly.
 *
 * The only defensible way to state an accuracy figure is to compare the
 * pipeline against labels a human produced independently. This module lets a
 * reviewer record ground truth for a segment and then computes agreement
 * from those labels alone.
 *
 * If no labels exist, the metrics endpoint returns "not enough data" - it does
 * not return a number. An unmeasured accuracy claim is worse than no claim.
 */

import { HttpsError } from 'firebase-functions/v2/https';
import { db, serverTimestamp } from '../lib/firebase.js';
import { COLLECTIONS } from '../config/index.js';
import { SEGMENT_STATUSES, SegmentStatus, Barrier } from '../shared/constants.js';
import { writeAudit, AuditAction } from '../lib/audit.js';

const BARRIER_IDS = Object.values(Barrier);

/** Record a human ground-truth label for a segment. */
export async function addValidationLabel({ segmentId, trueStatus, trueBarriers = [], notes = '', actor }) {
  if (!SEGMENT_STATUSES.includes(trueStatus) || trueStatus === SegmentStatus.UNVERIFIED) {
    throw new HttpsError('invalid-argument', 'A ground-truth label must be accessible, partial or inaccessible.');
  }
  const barriers = trueBarriers.filter((b) => BARRIER_IDS.includes(b));

  const segSnap = await db.collection(COLLECTIONS.segments).doc(segmentId).get();
  if (!segSnap.exists) throw new HttpsError('not-found', 'That segment does not exist.');
  const segment = segSnap.data();

  const ref = db.collection(COLLECTIONS.validationSamples).doc(`${segmentId}__${actor.uid}`);
  const doc = {
    id: ref.id,
    segmentId,
    regionId: segment.regionId,
    trueStatus,
    trueBarriers: barriers,
    notes: String(notes).slice(0, 600),
    // The system's belief AT LABELLING TIME is frozen here, so a later
    // recomputation cannot quietly improve the historical score.
    predictedStatus: segment.assessment?.status ?? null,
    predictedScore: segment.assessment?.accessibilityScore ?? null,
    predictedConfidence: segment.assessment?.evidenceConfidence ?? null,
    predictedBarriers: segment.assessment?.barriers ?? [],
    assessmentVersion: segment.assessment?.assessmentVersion ?? null,
    labelledBy: actor.uid,
    labelledByEmail: actor.email || null,
    createdAt: serverTimestamp()
  };

  await ref.set(doc, { merge: true });

  await writeAudit({
    actor,
    action: AuditAction.VALIDATION_LABEL_ADDED,
    targetType: 'segment',
    targetId: segmentId,
    next: { trueStatus, trueBarriers: barriers }
  });

  return doc;
}

/**
 * Agreement metrics over the labelled sample.
 *
 * Reported alongside the sample size, always. A 90% agreement rate on eleven
 * segments is not a 90% accurate system, and the UI is required to show the
 * denominator next to the number.
 */
export async function computeValidationMetrics(regionId) {
  const snap = await db.collection(COLLECTIONS.validationSamples)
    .where('regionId', '==', regionId)
    .get();

  const samples = snap.docs.map((d) => d.data());
  const classified = samples.filter((s) => s.predictedStatus && s.predictedStatus !== SegmentStatus.UNVERIFIED);

  if (samples.length === 0) {
    return {
      regionId,
      sampleSize: 0,
      sufficient: false,
      message: 'No ground-truth labels have been recorded yet. Accuracy cannot be reported.'
    };
  }

  const agreed = classified.filter((s) => s.predictedStatus === s.trueStatus).length;

  /** @type {Record<string, {tp:number, fp:number, fn:number}>} */
  const perBarrier = {};
  for (const s of samples) {
    const predicted = new Set(s.predictedBarriers || []);
    const truth = new Set(s.trueBarriers || []);
    for (const b of new Set([...predicted, ...truth])) {
      perBarrier[b] = perBarrier[b] || { tp: 0, fp: 0, fn: 0 };
      if (predicted.has(b) && truth.has(b)) perBarrier[b].tp += 1;
      else if (predicted.has(b)) perBarrier[b].fp += 1;
      else perBarrier[b].fn += 1;
    }
  }

  const barrierMetrics = Object.entries(perBarrier).map(([id, m]) => ({
    barrier: id,
    ...m,
    precision: m.tp + m.fp > 0 ? Number((m.tp / (m.tp + m.fp)).toFixed(3)) : null,
    recall: m.tp + m.fn > 0 ? Number((m.tp / (m.tp + m.fn)).toFixed(3)) : null
  })).sort((a, b) => (b.tp + b.fp + b.fn) - (a.tp + a.fp + a.fn));

  // Confusion matrix over the three classified states.
  const states = [SegmentStatus.ACCESSIBLE, SegmentStatus.PARTIAL, SegmentStatus.INACCESSIBLE];
  const confusion = {};
  for (const t of states) {
    confusion[t] = {};
    for (const p of [...states, SegmentStatus.UNVERIFIED]) confusion[t][p] = 0;
  }
  for (const s of samples) {
    if (!confusion[s.trueStatus]) continue;
    const p = s.predictedStatus || SegmentStatus.UNVERIFIED;
    confusion[s.trueStatus][p] = (confusion[s.trueStatus][p] || 0) + 1;
  }

  // "Optimistic error" is the one that matters most for safety: the system
  // said a segment was better than it really is.
  const rank = { accessible: 3, partial: 2, inaccessible: 1 };
  const optimistic = classified.filter((s) =>
    (rank[s.predictedStatus] || 0) > (rank[s.trueStatus] || 0)).length;
  const pessimistic = classified.filter((s) =>
    (rank[s.predictedStatus] || 0) < (rank[s.trueStatus] || 0)).length;

  return {
    regionId,
    sampleSize: samples.length,
    classifiedSampleSize: classified.length,
    unclassifiedInSample: samples.length - classified.length,
    // Deliberately below 30 this is flagged as indicative only.
    sufficient: classified.length >= 30,
    statusAgreement: classified.length ? Number((agreed / classified.length).toFixed(3)) : null,
    optimisticErrors: optimistic,
    pessimisticErrors: pessimistic,
    confusion,
    barrierMetrics,
    caveat: classified.length < 30
      ? 'Sample too small for a reliable accuracy figure. Treat as indicative only.'
      : null
  };
}

/**
 * Segments worth labelling next: assessed, but with the least confidence, so
 * the sample tests the pipeline where it is weakest rather than where it is
 * obviously right.
 */
export async function suggestValidationTargets(regionId, limit = 20) {
  const snap = await db.collection(COLLECTIONS.segments)
    .where('regionId', '==', regionId)
    .orderBy('assessment.evidenceConfidence', 'desc')
    .limit(400)
    .get();

  const labelled = new Set(
    (await db.collection(COLLECTIONS.validationSamples).where('regionId', '==', regionId).get())
      .docs.map((d) => d.data().segmentId)
  );

  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((s) => !labelled.has(s.id) && s.assessment?.status && s.assessment.status !== SegmentStatus.UNVERIFIED)
    .sort((a, b) => (a.assessment.evidenceConfidence || 0) - (b.assessment.evidenceConfidence || 0))
    .slice(0, limit)
    .map((s) => ({
      segmentId: s.id,
      streetName: s.streetName,
      status: s.assessment.status,
      accessibilityScore: s.assessment.accessibilityScore,
      evidenceConfidence: s.assessment.evidenceConfidence,
      centre: s.centre
    }));
}
