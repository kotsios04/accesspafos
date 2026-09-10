/**
 * Municipal priority issues.
 *
 * An "issue" is a segment the system believes has a real, evidenced barrier,
 * scored so that public works can start with the ones that matter most. The
 * score is computed by `shared/priority.js`; this module supplies it with the
 * real inputs - the detour needed to get round the barrier, the public
 * services nearby in OSM, the count of confirmed resident reports - and
 * persists the result with its full breakdown so the ranking is inspectable.
 */

import { HttpsError } from 'firebase-functions/v2/https';
import { db, serverTimestamp, commitInBatches } from '../lib/firebase.js';
import { COLLECTIONS } from '../config/index.js';
import { computePriority, priorityBand } from '../shared/priority.js';
import { SegmentStatus, IssueStatus, ReportStatus } from '../shared/constants.js';
import { accessibleDetourRatio } from '../routing/service.js';
import { buildPoiIndex } from '../osm/poi.js';
import { writeAudit, AuditAction, systemActor } from '../lib/audit.js';
import { mapWithConcurrency } from '../lib/http.js';

/** Priority recomputation is one small read/write per segment; ten at a time
 * keeps a whole-region pass to under a minute without troubling Firestore. */
const PRIORITY_CONCURRENCY = 10;

/** Only segments with an evidenced barrier become issues. */
function isIssueWorthy(assessment) {
  if (!assessment) return false;
  if (assessment.status === SegmentStatus.INACCESSIBLE) return true;
  if (assessment.status === SegmentStatus.PARTIAL && (assessment.barriers || []).length > 0) return true;
  return false;
}

async function loadPoiIndex(regionId) {
  const snap = await db.collection(COLLECTIONS.pois).where('regionId', '==', regionId).get();
  return buildPoiIndex(snap.docs.map((d) => d.data()));
}

async function verifiedReportCount(segmentId) {
  const snap = await db.collection(COLLECTIONS.citizenReports)
    .where('segmentId', '==', segmentId)
    .where('status', '==', ReportStatus.VERIFIED)
    .limit(10)
    .get();
  return snap.size;
}

export function issueId(segmentId) { return `issue_${segmentId}`; }

/**
 * Recompute the priority of one segment, creating, updating or retiring its
 * issue as the evidence dictates.
 */
export async function recomputePriorityForSegment(regionId, segmentId, options = {}) {
  const segSnap = await db.collection(COLLECTIONS.segments).doc(segmentId).get();
  if (!segSnap.exists) return null;
  const segment = segSnap.data();
  const assessment = segment.assessment;
  const ref = db.collection(COLLECTIONS.priorityIssues).doc(issueId(segmentId));

  if (!isIssueWorthy(assessment)) {
    // The barrier is gone (repaired, or corrected by a reviewer). Close the
    // issue rather than deleting it: the history is the point.
    const existing = await ref.get();
    if (existing.exists && existing.data().status !== IssueStatus.RESOLVED) {
      await ref.set({
        status: IssueStatus.RESOLVED,
        resolvedReason: 'evidence_no_longer_shows_barrier',
        priorityScore: 0,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }
    return null;
  }

  const poiIndex = options.poiIndex || await loadPoiIndex(regionId);
  const nearbyPois = segment.centre ? poiIndex.near(segment.centre) : [];

  let detour = { ratio: null };
  try {
    detour = await accessibleDetourRatio(regionId, segmentId);
  } catch {
    detour = { ratio: null, reason: 'detour-unavailable' };
  }

  const reports = options.verifiedReportCount ?? await verifiedReportCount(segmentId);
  const existing = await ref.get();
  const manualBoost = existing.exists ? (existing.data().manualBoost || 0) : 0;

  const result = computePriority({
    status: assessment.status,
    accessibilityScore: assessment.accessibilityScore,
    evidenceConfidence: assessment.evidenceConfidence,
    freshnessState: assessment.freshnessState,
    barriers: assessment.barriers || [],
    segmentKind: segment.kind,
    detourRatio: detour.ratio,
    nearbyPois,
    verifiedReportCount: reports,
    manualBoost
  });

  const doc = {
    id: ref.id,
    segmentId,
    regionId,
    streetName: segment.streetName || null,
    streetNameEl: segment.streetNameEl || null,
    centre: segment.centre || null,
    status: existing.exists && existing.data().status !== IssueStatus.RESOLVED
      ? existing.data().status
      : IssueStatus.NEW,
    accessibilityStatus: assessment.status,
    accessibilityScore: assessment.accessibilityScore,
    evidenceConfidence: assessment.evidenceConfidence,
    freshnessState: assessment.freshnessState,
    barriers: assessment.barriers || [],
    priorityScore: result.score,
    priorityBand: priorityBand(result.score),
    breakdown: result.breakdown,
    manualBoost,
    detour,
    nearbyPois: nearbyPois.slice(0, 6),
    verifiedReportCount: reports,
    assignedDepartment: existing.exists ? (existing.data().assignedDepartment || null) : null,
    updatedAt: serverTimestamp(),
    createdAt: existing.exists ? existing.data().createdAt : serverTimestamp()
  };

  await ref.set(doc, { merge: true });
  return doc;
}

/**
 * Recompute every issue in a region. Loads POIs once and reuses the index -
 * a per-segment POI query would be the dominant cost here.
 */
export async function recomputeRegionPriorities(regionId, options = {}) {
  const poiIndex = await loadPoiIndex(regionId);
  const snap = await db.collection(COLLECTIONS.segments)
    .where('regionId', '==', regionId)
    .get();

  let processed = 0;
  let issues = 0;
  let stopped = false;

  // Progress is reported for every segment, not only the issue-worthy ones.
  //
  // The report used to sit after a `continue`, so a segment that was not
  // issue-worthy skipped it - and in a region that is 98% unverified, almost
  // every segment is. The counter therefore advanced perhaps a hundred times
  // in six thousand, the job message never changed from "Recomputing municipal
  // priorities…", and a run that was working perfectly looked hung for
  // minutes. A progress bar that structurally cannot move is worse than none.
  const report = async () => {
    if (options.onProgress && processed % 25 === 0) await options.onProgress(processed, snap.size);
  };

  // Each segment's priority is independent of the others, so they are computed
  // in parallel. Sequentially this was one Firestore round trip per segment,
  // roughly six thousand of them end to end.
  await mapWithConcurrency(snap.docs, PRIORITY_CONCURRENCY, async (doc) => {
    if (stopped) return;
    if (options.shouldStop && await options.shouldStop()) { stopped = true; return; }

    const worthy = isIssueWorthy(doc.data().assessment);
    const result = await recomputePriorityForSegment(regionId, doc.id, { poiIndex })
      .catch((error) => { if (worthy) throw error; return null; });
    if (worthy && result) issues += 1;

    processed += 1;
    await report();
  });

  if (options.onProgress) await options.onProgress(processed, snap.size);

  await writeAudit({
    actor: options.actor || systemActor,
    action: AuditAction.ISSUE_STATUS_CHANGED,
    targetType: 'region',
    targetId: regionId,
    next: { recomputed: processed, issues }
  });

  return { processed, issues, total: snap.size };
}

/** Change an issue's workflow status, assignment or municipal boost. */
export async function updateIssue({ issueId: id, patch, actor }) {
  const ref = db.collection(COLLECTIONS.priorityIssues).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'That issue no longer exists.');
  const before = snap.data();

  const allowed = {};
  if (patch.status !== undefined) {
    if (!Object.values(IssueStatus).includes(patch.status)) {
      throw new HttpsError('invalid-argument', 'Unknown issue status.');
    }
    allowed.status = patch.status;
    if (patch.status === IssueStatus.RESOLVED) allowed.resolvedAt = serverTimestamp();
  }
  if (patch.assignedDepartment !== undefined) {
    allowed.assignedDepartment = String(patch.assignedDepartment || '').slice(0, 120) || null;
    allowed.assignedAt = serverTimestamp();
  }
  if (patch.manualBoost !== undefined) {
    const boost = Number(patch.manualBoost);
    if (!Number.isFinite(boost) || boost < 0 || boost > 1) {
      throw new HttpsError('invalid-argument', 'Municipal boost must be between 0 and 1.');
    }
    allowed.manualBoost = boost;
  }
  if (patch.notes !== undefined) allowed.notes = String(patch.notes).slice(0, 1000);

  allowed.updatedAt = serverTimestamp();
  await ref.set(allowed, { merge: true });

  // A boost changes the score, so recompute rather than leaving the table
  // showing a number that no longer matches its own breakdown.
  let recomputed = null;
  if (patch.manualBoost !== undefined) {
    recomputed = await recomputePriorityForSegment(before.regionId, before.segmentId);
  }

  await writeAudit({
    actor,
    action: patch.manualBoost !== undefined
      ? AuditAction.ISSUE_BOOSTED
      : (patch.assignedDepartment !== undefined ? AuditAction.ISSUE_ASSIGNED : AuditAction.ISSUE_STATUS_CHANGED),
    targetType: 'priorityIssue',
    targetId: id,
    previous: {
      status: before.status,
      assignedDepartment: before.assignedDepartment || null,
      manualBoost: before.manualBoost || 0,
      priorityScore: before.priorityScore
    },
    next: { ...allowed, priorityScore: recomputed?.priorityScore ?? before.priorityScore }
  });

  return { id, ...allowed, priorityScore: recomputed?.priorityScore ?? before.priorityScore };
}

export { isIssueWorthy, priorityBand };
