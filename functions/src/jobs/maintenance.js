/**
 * Recalculation, graph rebuild and bundle publication.
 *
 * These three steps are what turn stored evidence into something the public
 * app can actually use, and they are separated deliberately: recomputing
 * assessments is cheap and frequent, rebuilding the routing graph is
 * moderate, and publishing the map bundle is what users see.
 */

import { db, bucket, serverTimestamp } from '../lib/firebase.js';
import { COLLECTIONS } from '../config/index.js';
import { recomputeRegion } from '../scoring/apply.js';
import { recomputeRegionPriorities } from '../admin/priority.js';
import { publishRegionGraph, invalidateGraphCache } from '../routing/graph.js';
import { runJob, updateProgress, isCancelled } from './runner.js';
import { writeAudit, AuditAction } from '../lib/audit.js';
import { STATUS_COLORS, SegmentStatus } from '../shared/constants.js';
import { BUNDLE } from '../shared/config.js';
import { decodeSegment } from '../shared/geometry.js';

/** Re-run the deterministic assessment for every segment in a region. */
export async function runRecalculation(jobRef, { regionId, actor }) {
  return runJob(jobRef, async (ref) => {
    await updateProgress(ref, { message: 'Recomputing assessments from stored evidence…' });
    const assessed = await recomputeRegion(regionId, {
      onProgress: async (n, total) => updateProgress(ref, { processed: n, total, message: `Assessed ${n}/${total}…` }),
      shouldStop: () => isCancelled(ref)
    });

    await updateProgress(ref, { message: 'Recomputing municipal priorities…' });
    const priorities = await recomputeRegionPriorities(regionId, {
      actor,
      onProgress: async (n, total) => updateProgress(ref, { message: `Prioritised ${n}/${total}…` }),
      shouldStop: () => isCancelled(ref)
    });

    return { ...assessed, issues: priorities.issues };
  });
}

/** Rebuild and version the routing graph. */
export async function runGraphRebuild(jobRef, { regionId, actor }) {
  return runJob(jobRef, async (ref) => {
    await updateProgress(ref, { message: 'Rebuilding the pedestrian routing graph…' });
    const result = await publishRegionGraph(regionId);
    invalidateGraphCache(regionId);

    await writeAudit({
      actor,
      action: AuditAction.GRAPH_REBUILT,
      targetType: 'region',
      targetId: regionId,
      next: { graphVersion: result.version, edges: result.edgeCount, nodes: result.nodeCount }
    });

    return {
      graphVersion: result.version,
      edges: result.edgeCount,
      nodes: result.nodeCount,
      totalLengthMeters: result.totalLengthMeters
    };
  });
}

/**
 * Publish the public accessibility bundle.
 *
 * The map reads ONE versioned GeoJSON file from Cloud Storage rather than
 * thousands of Firestore documents. That is the difference between a map that
 * opens instantly for free and one that costs a read per segment per visitor.
 */
export async function runBundlePublish(jobRef, { regionId, actor }) {
  return runJob(jobRef, async (ref) => {
    await updateProgress(ref, { message: 'Building the public accessibility bundle…' });

    const snap = await db.collection(COLLECTIONS.segments)
      .where('regionId', '==', regionId)
      .get();

    const features = [];
    const counts = {};
    let totalLength = 0;

    for (const doc of snap.docs) {
      const s = decodeSegment(doc.data());
      if (!Array.isArray(s.geometry) || s.geometry.length < 2) continue;
      const a = s.assessment || {};
      const status = a.status || SegmentStatus.UNVERIFIED;
      counts[status] = (counts[status] || 0) + 1;
      totalLength += s.lengthMeters || 0;

      features.push({
        type: 'Feature',
        id: doc.id,
        geometry: { type: 'LineString', coordinates: s.geometry },
        properties: {
          id: doc.id,
          status,
          score: a.accessibilityScore ?? null,
          confidence: a.evidenceConfidence ?? 0,
          freshness: a.freshnessState || 'none',
          barriers: a.barriers || [],
          positives: a.positiveFeatures || [],
          sources: a.sources || [],
          kind: s.kind || null,
          name: s.streetName || null,
          nameEl: s.streetNameEl || null,
          len: Math.round(s.lengthMeters || 0),
          verified: Boolean(s.manualVerification?.at),
          images: s.imagery?.imageCount || 0
        }
      });
    }

    const regionRef = db.collection(COLLECTIONS.regions).doc(regionId);
    const regionSnap = await regionRef.get();
    const version = ((regionSnap.exists ? regionSnap.data().bundleVersion : 0) || 0) + 1;

    const bundle = {
      type: 'FeatureCollection',
      features,
      metadata: {
        regionId,
        bundleVersion: version,
        generatedAt: new Date().toISOString(),
        segmentCount: features.length,
        totalLengthMeters: Math.round(totalLength),
        statusCounts: counts,
        legend: STATUS_COLORS,
        attribution: [
          'Pedestrian network © OpenStreetMap contributors (ODbL)',
          'Street-level imagery © Mapillary contributors (CC BY-SA)'
        ],
        disclaimer: 'AI-assisted accessibility intelligence. Not an official accessibility certification.'
      }
    };

    const path = BUNDLE.pathTemplate.replace('{regionId}', regionId).replace('{version}', String(version));
    await bucket().file(path).save(JSON.stringify(bundle), {
      contentType: 'application/geo+json',
      metadata: { cacheControl: `public, max-age=${BUNDLE.clientCacheSeconds}` }
    });
    await bucket().file(path).makePublic().catch(() => { /* uniform bucket-level access */ });

    await regionRef.set({
      bundleVersion: version,
      bundlePath: path,
      bundleStats: { segmentCount: features.length, statusCounts: counts, totalLengthMeters: Math.round(totalLength) },
      bundlePublishedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    await writeAudit({
      actor,
      action: AuditAction.BUNDLE_PUBLISHED,
      targetType: 'region',
      targetId: regionId,
      next: { bundleVersion: version, segments: features.length, statusCounts: counts }
    });

    return { bundleVersion: version, path, segments: features.length, statusCounts: counts };
  });
}
