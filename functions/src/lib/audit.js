/**
 * Append-only audit log.
 *
 * Anything that overrides the pipeline, changes a role, resolves an issue or
 * spends money is recorded with who did it, when, and what the value was
 * before and after. This is what makes "the AI got it wrong, a human fixed
 * it" an inspectable claim rather than an assurance.
 */

import { db, serverTimestamp } from './firebase.js';
import { COLLECTIONS } from '../config/index.js';

export const AuditAction = Object.freeze({
  SEGMENT_VERIFIED: 'segment.verified',
  SEGMENT_OVERRIDDEN: 'segment.overridden',
  SEGMENT_INSPECTION_REQUESTED: 'segment.inspection_requested',
  SEGMENT_REANALYSIS_REQUESTED: 'segment.reanalysis_requested',
  REPORT_VERIFIED: 'report.verified',
  REPORT_REJECTED: 'report.rejected',
  REPORT_MERGED: 'report.merged',
  REPORT_RESOLVED: 'report.resolved',
  ISSUE_ASSIGNED: 'issue.assigned',
  ISSUE_STATUS_CHANGED: 'issue.status_changed',
  ISSUE_BOOSTED: 'issue.boosted',
  CONFIG_CHANGED: 'config.changed',
  ROLE_CHANGED: 'role.changed',
  JOB_STARTED: 'job.started',
  JOB_CANCELLED: 'job.cancelled',
  REGION_IMPORTED: 'region.imported',
  IMAGERY_DISCOVERED: 'imagery.discovered',
  AI_ANALYSIS_RUN: 'ai.analysis_run',
  GRAPH_REBUILT: 'graph.rebuilt',
  BUNDLE_PUBLISHED: 'bundle.published',
  VALIDATION_LABEL_ADDED: 'validation.label_added',
  EXPORT_GENERATED: 'export.generated'
});

/**
 * @param {Object} entry
 * @param {{uid:string, role:string, email?:string|null}} entry.actor
 * @param {string} entry.action
 * @param {string} entry.targetType
 * @param {string} [entry.targetId]
 * @param {*} [entry.previous]
 * @param {*} [entry.next]
 * @param {Object} [entry.context]
 */
export async function writeAudit({ actor, action, targetType, targetId = null, previous = null, next = null, context = {} }) {
  const doc = {
    actorUid: actor?.uid || 'system',
    actorRole: actor?.role || 'system',
    actorEmail: actor?.email || null,
    action,
    targetType,
    targetId,
    previous: sanitise(previous),
    next: sanitise(next),
    context: sanitise(context),
    createdAt: serverTimestamp()
  };
  await db.collection(COLLECTIONS.auditLogs).add(doc);
  return doc;
}

export const systemActor = Object.freeze({ uid: 'system', role: 'system', email: null });

/**
 * Audit entries are read by humans in a table. Keep them small, and never
 * copy a citizen photo URL or a raw token into one.
 */
function sanitise(value, depth = 0) {
  if (value == null) return null;
  if (depth > 4) return '[truncated]';
  if (typeof value === 'string') return value.length > 400 ? `${value.slice(0, 399)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 30).map((v) => sanitise(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    let n = 0;
    for (const [k, v] of Object.entries(value)) {
      if (/token|secret|password|authorization|apikey/i.test(k)) continue;
      out[k] = sanitise(v, depth + 1);
      if ((n += 1) >= 40) break;
    }
    return out;
  }
  return String(value);
}
