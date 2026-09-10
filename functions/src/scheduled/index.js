/**
 * Scheduled maintenance.
 *
 * Deliberately narrow. Scheduled functions that re-run expensive AI on
 * unchanged evidence are how a hobby project wakes up to a four-figure bill,
 * so nothing here calls a model. These jobs only re-date, tidy and re-rank
 * what is already known.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, bucket, serverTimestamp, commitInBatches, Timestamp } from '../lib/firebase.js';
import { COLLECTIONS, REGION } from '../config/index.js';
import { recomputeRegion } from '../scoring/apply.js';
import { recomputeRegionPriorities } from '../admin/priority.js';
import { computeFreshness } from '../shared/freshness.js';
import { Freshness, ReportStatus } from '../shared/constants.js';
import { RETENTION } from '../shared/config.js';
import { systemActor, writeAudit, AuditAction } from '../lib/audit.js';

const SCHEDULE_OPTS = { region: REGION, timeoutSeconds: 540, memory: '1GiB', retryCount: 1 };

/**
 * Evidence does not decay on a schedule - but its DESCRIPTION does. A segment
 * assessed from 2023 imagery silently crosses from "aging" to "stale" on a
 * particular day, and the map should say so without anyone clicking anything.
 */
export const refreshFreshness = onSchedule(
  { ...SCHEDULE_OPTS, schedule: '30 2 * * *', timeZone: 'Asia/Nicosia' },
  async () => {
    const regions = await db.collection(COLLECTIONS.regions).get();
    for (const region of regions.docs) {
      const segments = await db.collection(COLLECTIONS.segments)
        .where('regionId', '==', region.id)
        .get();

      const writes = [];
      let changed = 0;
      for (const doc of segments.docs) {
        const a = doc.data().assessment;
        if (!a) continue;
        const next = computeFreshness({
          lastEvidenceAt: a.lastEvidenceAt,
          lastVerifiedAt: a.lastVerifiedAt
        });
        if (next.state !== a.freshnessState) {
          changed += 1;
          writes.push({
            type: 'set',
            ref: doc.ref,
            data: { assessment: { ...a, freshnessState: next.state }, updatedAt: serverTimestamp() },
            options: { merge: true }
          });
        }
      }
      if (writes.length) await commitInBatches(writes);

      // Freshness feeds confidence, which can change a classification, so a
      // region whose freshness moved needs a real recomputation.
      if (changed > 0) {
        await recomputeRegion(region.id);
        await writeAudit({
          actor: systemActor,
          action: AuditAction.JOB_STARTED,
          targetType: 'region',
          targetId: region.id,
          next: { job: 'refreshFreshness', segmentsChanged: changed }
        });
      }
    }
  }
);

/**
 * Delete photographs attached to rejected reports once their retention period
 * has passed, and clean up uploads that were never attached to a report at all.
 */
export const cleanupUploads = onSchedule(
  { ...SCHEDULE_OPTS, schedule: '0 3 * * *', timeZone: 'Asia/Nicosia' },
  async () => {
    const now = Timestamp.now();
    const expired = await db.collection(COLLECTIONS.citizenReports)
      .where('status', '==', ReportStatus.REJECTED)
      .where('photoDeleteAfter', '<=', now)
      .limit(300)
      .get();

    let deleted = 0;
    for (const doc of expired.docs) {
      const path = doc.data().photoPath;
      if (path) {
        await bucket().file(path).delete().catch(() => null);
        deleted += 1;
      }
      await doc.ref.set({
        photoPath: null,
        hasPhoto: false,
        photoDeletedAt: serverTimestamp(),
        photoDeleteAfter: null
      }, { merge: true });
    }

    // Orphaned uploads: a user picked a photo, then abandoned the form.
    const cutoff = Date.now() - RETENTION.orphanUploadHours * 3600000;
    const [files] = await bucket().getFiles({ prefix: 'reports/', maxResults: 1000 });
    const known = new Set(
      (await db.collection(COLLECTIONS.citizenReports).select('photoPath').get())
        .docs.map((d) => d.data().photoPath).filter(Boolean)
    );
    let orphans = 0;
    for (const file of files) {
      if (known.has(file.name)) continue;
      const created = Date.parse(file.metadata?.timeCreated || '');
      if (Number.isFinite(created) && created < cutoff) {
        await file.delete().catch(() => null);
        orphans += 1;
      }
    }

    if (deleted || orphans) {
      await writeAudit({
        actor: systemActor,
        action: AuditAction.JOB_STARTED,
        targetType: 'storage',
        targetId: 'reports',
        next: { job: 'cleanupUploads', rejectedPhotosDeleted: deleted, orphansDeleted: orphans }
      });
    }
  }
);

/**
 * Weekly priority re-ranking. Priorities depend on detour availability and
 * confirmed report counts, both of which drift as the network and the reports
 * change; this keeps the municipal work queue honest without any AI spend.
 */
export const weeklyPriorityRefresh = onSchedule(
  { ...SCHEDULE_OPTS, schedule: '0 4 * * 1', timeZone: 'Asia/Nicosia' },
  async () => {
    const regions = await db.collection(COLLECTIONS.regions).get();
    for (const region of regions.docs) {
      await recomputeRegionPriorities(region.id, { actor: systemActor });
    }
  }
);

/**
 * Flag regions whose imagery has aged past the stale threshold, so an admin
 * knows a fresh Mapillary discovery pass is worth running. It does NOT start
 * one: discovery and analysis stay manual and budgeted.
 */
export const flagStaleRegions = onSchedule(
  { ...SCHEDULE_OPTS, schedule: '0 5 * * 1', timeZone: 'Asia/Nicosia' },
  async () => {
    const regions = await db.collection(COLLECTIONS.regions).get();
    for (const region of regions.docs) {
      const stale = await db.collection(COLLECTIONS.segments)
        .where('regionId', '==', region.id)
        .where('assessment.freshnessState', '==', Freshness.STALE)
        .count().get().then((s) => s.data().count).catch(() => 0);

      const total = region.data().segmentCount || 0;
      await region.ref.set({
        maintenance: {
          staleSegments: stale,
          staleShare: total ? Number((stale / total).toFixed(3)) : 0,
          suggestsRediscovery: total > 0 && stale / total > 0.35,
          checkedAt: serverTimestamp()
        }
      }, { merge: true });
    }
  }
);
