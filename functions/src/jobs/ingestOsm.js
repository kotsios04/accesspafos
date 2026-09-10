/**
 * OSM ingestion job.
 *
 * Downloads the pedestrian network for a bounded region from Overpass,
 * converts it into segments and nodes, writes them idempotently, and records
 * connectivity so an admin immediately sees whether the imported network is
 * actually routable.
 *
 * Re-running an import over the same area updates the same documents: every
 * identifier is derived from OSM ids, never from insertion order.
 */

import { db, serverTimestamp, commitInBatches } from '../lib/firebase.js';
import { packGeometry } from '../shared/geometry.js';
import { COLLECTIONS } from '../config/index.js';
import { fetchPedestrianNetwork, fetchPois, assertImportableArea } from '../osm/overpass.js';
import { parsePedestrianNetwork, analyseConnectivity } from '../osm/parse.js';
import { parsePois } from '../osm/poi.js';
import { recomputeRegion } from '../scoring/apply.js';
import { runJob, updateProgress, isCancelled, recordJobError } from './runner.js';
import { writeAudit, AuditAction } from '../lib/audit.js';
import { MAX_SEGMENTS_PER_IMPORT } from '../shared/config.js';
import { bboxAreaKm2 } from '../shared/geo.js';

/**
 * @param {import('firebase-admin/firestore').DocumentReference} jobRef
 * @param {{regionId:string, regionName?:string, bbox:number[], actor:object}} params
 */
export async function runOsmImport(jobRef, params) {
  const { regionId, regionName, bbox, actor } = params;

  return runJob(jobRef, async (ref) => {
    const areaKm2 = assertImportableArea(bbox);
    await updateProgress(ref, { message: 'Querying Overpass for the pedestrian network…' });

    const overpass = await fetchPedestrianNetwork(bbox);
    await updateProgress(ref, {
      message: `Overpass returned ${overpass.elements.length} elements. Building the pedestrian graph…`
    });

    const { nodes, segments, stats } = parsePedestrianNetwork(overpass, { regionId });

    if (segments.length === 0) {
      throw new Error('No pedestrian ways were found in that area. Try a larger or different bounding box.');
    }
    if (segments.length > MAX_SEGMENTS_PER_IMPORT) {
      throw new Error(
        `That area produced ${segments.length} segments, above the ${MAX_SEGMENTS_PER_IMPORT} limit. Import it in smaller pieces.`
      );
    }

    const connectivity = analyseConnectivity(segments);
    await updateProgress(ref, {
      total: segments.length,
      message: `Writing ${segments.length} segments (${Math.round(stats.totalLengthMeters)} m of pedestrian network)…`
    });

    // --- write segments, preserving any manual verification already made ---
    const existing = await db.collection(COLLECTIONS.segments)
      .where('regionId', '==', regionId).select('manualVerification', 'imagery', 'assessment').get();
    const preserved = new Map(existing.docs.map((d) => [d.id, d.data()]));

    const writes = segments.map((segment) => {
      const prior = preserved.get(segment.id);
      return {
        type: 'set',
        ref: db.collection(COLLECTIONS.segments).doc(segment.id),
        data: {
          ...segment,
          // Firestore rejects nested arrays, which is what a LineString is.
          geometry: packGeometry(segment.geometry),
          // Ingestion must never discard a reviewer's site visit or the
          // imagery/assessment state that depends on it.
          manualVerification: prior?.manualVerification ?? null,
          imagery: prior?.imagery ?? { imageCount: 0, status: 'not_searched', lastSearchedAt: null },
          assessment: prior?.assessment ?? null,
          importedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        options: { merge: true }
      };
    });

    await commitInBatches(writes);
    await updateProgress(ref, { processed: segments.length, succeeded: segments.length });

    // --- nodes -------------------------------------------------------------
    await commitInBatches(nodes.map((node) => ({
      type: 'set',
      ref: db.collection(COLLECTIONS.regions).doc(regionId).collection('nodes').doc(node.id),
      data: { ...node, updatedAt: serverTimestamp() },
      options: { merge: true }
    })));

    // --- public services, for the priority engine --------------------------
    let poiCount = 0;
    if (!await isCancelled(ref)) {
      try {
        await updateProgress(ref, { message: 'Fetching nearby public services from OpenStreetMap…' });
        const poiJson = await fetchPois(bbox);
        const pois = parsePois(poiJson, regionId);
        await commitInBatches(pois.map((poi) => ({
          type: 'set',
          ref: db.collection(COLLECTIONS.pois).doc(`${regionId}__${poi.id}`),
          data: { ...poi, updatedAt: serverTimestamp() },
          options: { merge: true }
        })));
        poiCount = pois.length;
      } catch (error) {
        // POIs only affect priority ranking; failing to get them must not
        // fail an otherwise successful network import.
        await recordJobError(ref, error, { stage: 'pois' });
      }
    }

    // --- retire segments this import no longer produces ---------------------
    //
    // The import is the authority for a region's network, so anything left in
    // the database that it did not produce is stale. Skipping this was safe
    // only while segment ids were stable; length splitting changes them, and
    // leaving the old documents behind would draw every divided street twice -
    // once as its parts and once as the kilometre it used to be - and count
    // the length twice in every coverage figure.
    //
    // Guarded, because "delete what the import did not produce" is a
    // catastrophic instruction if the import itself was truncated: a partial
    // Overpass response would otherwise wipe the region. A run that yields
    // less than half of what is already stored refuses to prune and says so.
    const pruneResult = await pruneStaleSegments(ref, regionId, new Set(segments.map((s) => s.id)));

    // --- region document ---------------------------------------------------
    await db.collection(COLLECTIONS.regions).doc(regionId).set({
      id: regionId,
      name: regionName || regionId,
      bbox,
      areaKm2: Number(areaKm2.toFixed(2)),
      segmentCount: segments.length,
      nodeCount: nodes.length,
      poiCount,
      totalLengthMeters: stats.totalLengthMeters,
      connectivity,
      lastImportedAt: serverTimestamp(),
      lastImportStats: stats,
      updatedAt: serverTimestamp()
    }, { merge: true });

    // --- assess everything from OSM tags alone -----------------------------
    // Most segments will come out grey: OSM rarely carries kerb, surface and
    // width tags for a whole city. That is the honest starting point, and
    // exactly what imagery analysis then improves on.
    await updateProgress(ref, { message: 'Computing initial assessments from OSM tags…' });
    const assessed = await recomputeRegion(regionId, {
      onProgress: async (n, total) => updateProgress(ref, { message: `Assessed ${n}/${total} segments…` }),
      shouldStop: () => isCancelled(ref)
    });

    await writeAudit({
      actor,
      action: AuditAction.REGION_IMPORTED,
      targetType: 'region',
      targetId: regionId,
      next: {
        segments: segments.length,
        nodes: nodes.length,
        pois: poiCount,
        lengthMeters: stats.totalLengthMeters,
        areaKm2: Number(areaKm2.toFixed(2))
      },
      context: { bbox, connectivity }
    });

    return {
      segments: segments.length,
      nodes: nodes.length,
      pois: poiCount,
      totalLengthMeters: stats.totalLengthMeters,
      connectivity,
      parseStats: stats,
      statusCounts: assessed.statusCounts,
      ...pruneResult
    };
  });
}

/**
 * Delete segments (and their assessments) that this import did not produce.
 *
 * @param {import('firebase-admin/firestore').DocumentReference} ref  job document
 * @param {string} regionId
 * @param {Set<string>} keep  ids the import produced
 */
async function pruneStaleSegments(ref, regionId, keep) {
  const snap = await db.collection(COLLECTIONS.segments).where('regionId', '==', regionId).get();
  if (snap.empty) return { staleSegmentsRemoved: 0 };

  const stale = snap.docs.filter((d) => !keep.has(d.id));
  if (stale.length === 0) return { staleSegmentsRemoved: 0 };

  // A healthy re-import keeps most of what is there. Losing more than half is
  // far more likely to mean a truncated Overpass response than a network that
  // genuinely halved overnight, and the cost of being wrong is the region.
  if (keep.size < snap.size / 2) {
    const message = `Refusing to remove ${stale.length} stale segment(s): this import produced ${keep.size}, `
      + `fewer than half the ${snap.size} already stored. That looks like a truncated import rather than a shrunken network. `
      + 'Nothing was deleted; re-run the import and check the Overpass response first.';
    await recordJobError(ref, new Error(message), { stage: 'prune' });
    return { staleSegmentsRemoved: 0, prunePrevented: stale.length };
  }

  await updateProgress(ref, { message: `Removing ${stale.length} segment(s) this import no longer produces…` });
  await commitInBatches(stale.flatMap((d) => ([
    { type: 'delete', ref: d.ref },
    { type: 'delete', ref: db.collection(COLLECTIONS.segmentAssessments).doc(d.id) }
  ])));
  return { staleSegmentsRemoved: stale.length };
}
