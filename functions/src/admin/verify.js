/**
 * Municipal verification and override.
 *
 * A reviewer who has looked at the evidence - or stood on the pavement - can
 * do three things:
 *
 *   confirm   the pipeline got it right; raises confidence, keeps the score
 *   correct   the pipeline got it wrong; pins the status, with a reason
 *   inspect   we cannot tell from here; flag it for a site visit
 *
 * Every one of them is recorded as a verification event and an audit entry,
 * and the previous state is preserved. "The AI was wrong and a human fixed
 * it" has to be inspectable, or the transparency claim is empty.
 */

import { HttpsError } from 'firebase-functions/v2/https';
import { db, serverTimestamp, Timestamp } from '../lib/firebase.js';
import { COLLECTIONS } from '../config/index.js';
import { SEGMENT_STATUSES, SegmentStatus } from '../shared/constants.js';
import { writeAudit, AuditAction } from '../lib/audit.js';
import { recomputeSegment } from '../scoring/apply.js';
import { recomputePriorityForSegment } from './priority.js';

export const VerificationResult = Object.freeze({
  CONFIRMED: 'confirmed',
  CORRECTED: 'corrected',
  NEEDS_INSPECTION: 'needs_inspection'
});

/**
 * @param {Object} input
 * @param {string} input.segmentId
 * @param {'confirmed'|'corrected'|'needs_inspection'} input.result
 * @param {string} [input.status]     required when result is 'corrected'
 * @param {string} [input.notes]
 * @param {string} [input.photoPath]  optional site photo in Cloud Storage
 * @param {{uid:string,role:string,email?:string}} input.actor
 */
export async function verifySegment(input) {
  const segRef = db.collection(COLLECTIONS.segments).doc(input.segmentId);
  const snap = await segRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'That segment does not exist.');
  const segment = snap.data();

  if (!Object.values(VerificationResult).includes(input.result)) {
    throw new HttpsError('invalid-argument', 'Unknown verification result.');
  }
  if (input.result === VerificationResult.CORRECTED) {
    if (!SEGMENT_STATUSES.includes(input.status)) {
      throw new HttpsError('invalid-argument', 'Choose the correct accessibility status.');
    }
    if (!input.notes || input.notes.trim().length < 5) {
      throw new HttpsError('invalid-argument', 'A correction must say why. Please add a short note.');
    }
  }

  const previous = {
    status: segment.assessment?.status ?? null,
    accessibilityScore: segment.assessment?.accessibilityScore ?? null,
    manualVerification: segment.manualVerification || null
  };

  const now = Timestamp.now();
  const manualVerification = {
    result: input.result,
    // `override: true` pins the status; a plain confirmation leaves the
    // engine in charge and simply raises confidence.
    override: input.result === VerificationResult.CORRECTED,
    status: input.result === VerificationResult.CORRECTED
      ? input.status
      : (input.result === VerificationResult.CONFIRMED ? (segment.assessment?.status || null) : null),
    by: input.actor.uid,
    byEmail: input.actor.email || null,
    at: now,
    notes: (input.notes || '').slice(0, 800),
    photoPath: input.photoPath || null
  };

  await segRef.set({
    manualVerification,
    needsInspection: input.result === VerificationResult.NEEDS_INSPECTION,
    updatedAt: serverTimestamp()
  }, { merge: true });

  // Immutable event record - the verification history the UI shows.
  await db.collection(COLLECTIONS.verificationEvents).add({
    segmentId: input.segmentId,
    regionId: segment.regionId,
    result: input.result,
    statusBefore: previous.status,
    statusRequested: manualVerification.status,
    notes: manualVerification.notes,
    photoPath: input.photoPath || null,
    verifiedBy: input.actor.uid,
    verifiedByEmail: input.actor.email || null,
    createdAt: serverTimestamp()
  });

  const assessment = await recomputeSegment(input.segmentId);
  await recomputePriorityForSegment(segment.regionId, input.segmentId).catch(() => null);

  await writeAudit({
    actor: input.actor,
    action: input.result === VerificationResult.CORRECTED
      ? AuditAction.SEGMENT_OVERRIDDEN
      : (input.result === VerificationResult.NEEDS_INSPECTION
        ? AuditAction.SEGMENT_INSPECTION_REQUESTED
        : AuditAction.SEGMENT_VERIFIED),
    targetType: 'segment',
    targetId: input.segmentId,
    previous,
    next: { status: assessment.status, accessibilityScore: assessment.accessibilityScore, result: input.result },
    context: { notes: manualVerification.notes }
  });

  return {
    segmentId: input.segmentId,
    status: assessment.status,
    accessibilityScore: assessment.accessibilityScore,
    evidenceConfidence: assessment.evidenceConfidence,
    classificationReason: assessment.classificationReason
  };
}

/** Remove a previous override and hand the segment back to the engine. */
export async function clearOverride({ segmentId, actor, notes = '' }) {
  const segRef = db.collection(COLLECTIONS.segments).doc(segmentId);
  const snap = await segRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'That segment does not exist.');

  const previous = snap.data().manualVerification || null;
  await segRef.set({ manualVerification: null, updatedAt: serverTimestamp() }, { merge: true });

  const assessment = await recomputeSegment(segmentId);

  await writeAudit({
    actor,
    action: AuditAction.SEGMENT_OVERRIDDEN,
    targetType: 'segment',
    targetId: segmentId,
    previous,
    next: { manualVerification: null, status: assessment.status },
    context: { notes: notes.slice(0, 400), cleared: true }
  });

  return { segmentId, status: assessment.status };
}

/** Verification history for the segment detail panel. */
export async function verificationHistory(segmentId, limit = 20) {
  const snap = await db.collection(COLLECTIONS.verificationEvents)
    .where('segmentId', '==', segmentId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export { SegmentStatus };
