/**
 * Municipal review of citizen reports.
 *
 * This is where a report becomes evidence. Verifying a report:
 *   - records who verified it and when;
 *   - promotes the citizen photograph's observation into the evidence store,
 *     attributed to the citizen, never laundered into "AI analysis";
 *   - triggers a recomputation of the affected segment;
 *   - writes an audit entry.
 *
 * Rejecting a report schedules its photograph for deletion, because we should
 * not keep photographs we have decided we do not need.
 */

import { HttpsError } from 'firebase-functions/v2/https';
import { db, serverTimestamp, Timestamp } from '../lib/firebase.js';
import { COLLECTIONS } from '../config/index.js';
import { ReportStatus, SourceType } from '../shared/constants.js';
import { writeAudit, AuditAction } from '../lib/audit.js';
import { recomputeSegment } from '../scoring/apply.js';
import { saveObservation } from '../ai/observations.js';
import { normalizeObservation } from '../shared/observationSchema.js';
import { RETENTION } from '../shared/config.js';
import { recomputePriorityForSegment } from '../admin/priority.js';

const OPEN_STATUSES = new Set([ReportStatus.PENDING, ReportStatus.NEEDS_REVIEW]);

/**
 * @param {Object} input
 * @param {string} input.reportId
 * @param {'verify'|'reject'|'duplicate'|'resolve'|'needs_review'} input.decision
 * @param {string} [input.notes]
 * @param {string} [input.duplicateOf]
 * @param {{uid:string,role:string,email?:string}} input.actor
 */
export async function reviewReport(input) {
  const ref = db.collection(COLLECTIONS.citizenReports).doc(input.reportId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'That report no longer exists.');
  const report = snap.data();

  const previous = { status: report.status };
  const patch = {
    reviewedBy: input.actor.uid,
    reviewedAt: serverTimestamp(),
    reviewNotes: (input.notes || '').slice(0, 600),
    updatedAt: serverTimestamp()
  };

  let action;
  switch (input.decision) {
    case 'verify':
      patch.status = ReportStatus.VERIFIED;
      patch.verifiedAt = serverTimestamp();
      action = AuditAction.REPORT_VERIFIED;
      break;
    case 'reject':
      patch.status = ReportStatus.REJECTED;
      patch.photoDeleteAfter = Timestamp.fromMillis(
        Date.now() + RETENTION.rejectedReportPhotoDays * 86400000
      );
      action = AuditAction.REPORT_REJECTED;
      break;
    case 'duplicate':
      if (!input.duplicateOf) throw new HttpsError('invalid-argument', 'Select the report this duplicates.');
      patch.status = ReportStatus.DUPLICATE;
      patch.duplicateOf = input.duplicateOf;
      action = AuditAction.REPORT_MERGED;
      break;
    case 'resolve':
      patch.status = ReportStatus.RESOLVED;
      patch.resolvedAt = serverTimestamp();
      action = AuditAction.REPORT_RESOLVED;
      break;
    case 'needs_review':
      patch.status = ReportStatus.NEEDS_REVIEW;
      action = AuditAction.REPORT_VERIFIED;
      break;
    default:
      throw new HttpsError('invalid-argument', 'Unknown review decision.');
  }

  await ref.set(patch, { merge: true });

  // A verified photograph becomes a first-class observation, attributed to
  // the citizen who took it.
  let observationSaved = false;
  if (input.decision === 'verify' && report.segmentId && report.aiAnalysis?.observation) {
    await saveObservation({
      segmentId: report.segmentId,
      regionId: report.regionId,
      sourceType: SourceType.CITIZEN,
      sourceId: `report:${input.reportId}`,
      observation: normalizeObservation(report.aiAnalysis.observation),
      model: report.aiAnalysis.model || 'unknown',
      analysisVersion: report.aiAnalysis.analysisVersion,
      capturedAt: report.createdAt,
      location: report.location,
      sourceMeta: {
        reportId: input.reportId,
        category: report.category,
        verifiedBy: input.actor.uid,
        attribution: 'Reported by a resident of Pafos'
      }
    });
    observationSaved = true;
  }

  let recomputed = null;
  if (report.segmentId && ['verify', 'reject', 'resolve'].includes(input.decision)) {
    recomputed = await recomputeSegment(report.segmentId);
    await recomputePriorityForSegment(report.regionId, report.segmentId).catch(() => null);
  }

  await writeAudit({
    actor: input.actor,
    action,
    targetType: 'citizenReport',
    targetId: input.reportId,
    previous,
    next: { status: patch.status, duplicateOf: patch.duplicateOf || null },
    context: { segmentId: report.segmentId || null, notes: patch.reviewNotes, observationSaved }
  });

  return {
    id: input.reportId,
    status: patch.status,
    segmentId: report.segmentId || null,
    recomputedStatus: recomputed?.status || null,
    observationSaved
  };
}

/** Assign a report to a department without changing its verification state. */
export async function assignReport({ reportId, department, actor }) {
  const ref = db.collection(COLLECTIONS.citizenReports).doc(reportId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'That report no longer exists.');

  await ref.set({
    assignedTo: department,
    assignedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  await writeAudit({
    actor,
    action: AuditAction.ISSUE_ASSIGNED,
    targetType: 'citizenReport',
    targetId: reportId,
    previous: { assignedTo: snap.data().assignedTo || null },
    next: { assignedTo: department }
  });

  return { id: reportId, assignedTo: department };
}

export { OPEN_STATUSES };
