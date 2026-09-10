/**
 * Mapillary imagery discovery job.
 *
 * Finds which street-level frames exist over a region and which of them are
 * worth analysing for each segment. Discovery is free; analysis is not, so
 * this job deliberately stops at selection and writes down what it would
 * analyse. An admin then sees the exact number of AI calls a run would cost
 * and starts it explicitly.
 */

import { db, serverTimestamp, commitInBatches } from '../lib/firebase.js';
import { COLLECTIONS } from '../config/index.js';
import { discoverImageryForBbox, isMapillaryConfigured, MapillaryNotConfiguredError } from '../mapillary/client.js';
import { selectUsefulImagesForSegment, buildImageIndex } from '../mapillary/select.js';
import { runJob, updateProgress, isCancelled, recordJobError } from './runner.js';
import { writeAudit, AuditAction } from '../lib/audit.js';
import { MAX_IMAGES_PER_SEGMENT, MAPILLARY_SEARCH_RADIUS_M } from '../shared/config.js';
import { bboxOf, padBbox, bboxIntersects } from '../shared/geo.js';
import { decodeSegment } from '../shared/geometry.js';
import { deriveOsmEvidence } from '../shared/osm.js';

export const ImageryStatus = Object.freeze({
  NOT_SEARCHED: 'not_searched',
  NONE_FOUND: 'none_found',
  SELECTED: 'selected',
  ANALYSED: 'analysed',
  /** OSM already answers this segment, or it is not somewhere anyone walks. */
  NOT_NEEDED: 'not_needed'
});

/**
 * Roads that are not pedestrian infrastructure at all. A driveway or a parking
 * aisle has no pavement to assess, and a motorway has no pedestrian access to
 * assess; paying a vision model to look at them is spending the survey budget
 * on the answer we already have.
 */
const NON_PEDESTRIAN_SERVICE = new Set(['driveway', 'parking_aisle', 'drive-through']);
const NON_PEDESTRIAN_HIGHWAY = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'raceway', 'bus_guideway'
]);

/**
 * Does this segment need a photograph, or is it already settled?
 *
 * Two ways it can be settled. Either it is not pedestrian infrastructure - in
 * which case there is nothing to look at - or the OSM tags are decisive on
 * their own: `deriveOsmEvidence` reports `decisive` when a hard block is
 * present (steps, wheelchair=no) or when a mapper has stated `wheelchair`
 * explicitly. A person standing on the street wrote that down; a photograph
 * cannot improve on it, and the model would only be asked to agree.
 *
 * Deliberately conservative. Anything not covered here still gets a picture:
 * a wrongly skipped segment stays grey, and grey is the honest state for a
 * street nobody has looked at. It is the reverse mistake - claiming to know -
 * that this whole product exists to avoid.
 *
 * @returns {{needed: boolean, reason?: string}}
 */
export function needsVisualEvidence(segment) {
  const tags = segment?.osmTags || {};

  if (NON_PEDESTRIAN_HIGHWAY.has(tags.highway)) {
    return { needed: false, reason: `highway=${tags.highway} carries no pedestrian access` };
  }
  if (tags.highway === 'service' && NON_PEDESTRIAN_SERVICE.has(tags.service)) {
    return { needed: false, reason: `service=${tags.service} is not a pedestrian way` };
  }
  if (tags.foot === 'no' || tags.access === 'private' || tags.access === 'no') {
    return { needed: false, reason: 'closed to pedestrians in OSM' };
  }

  const osm = deriveOsmEvidence(tags, { kind: segment?.kind });
  if (osm.decisive) {
    return {
      needed: false,
      reason: osm.hardBlocks.length
        ? `OSM states a hard block: ${osm.hardBlocks.join(', ')}`
        : `OSM states wheelchair=${tags.wheelchair}`
    };
  }

  return { needed: true };
}

/**
 * @param {import('firebase-admin/firestore').DocumentReference} jobRef
 * @param {{regionId:string, bbox:number[], maxPerSegment?:number, actor:object}} params
 */
export async function runMapillaryDiscovery(jobRef, params) {
  const { regionId, bbox, maxPerSegment = MAX_IMAGES_PER_SEGMENT, actor } = params;

  return runJob(jobRef, async (ref) => {
    if (!isMapillaryConfigured()) throw new MapillaryNotConfiguredError();

    await updateProgress(ref, { message: 'Searching Mapillary for street-level imagery…' });
    const { images, tiles, truncatedTiles } = await discoverImageryForBbox(bbox);

    if (truncatedTiles > 0) {
      await recordJobError(ref,
        new Error(`${truncatedTiles} of ${tiles} tiles hit the per-tile image limit; some imagery was not enumerated.`),
        { stage: 'discovery' });
    }

    await updateProgress(ref, {
      message: `Found ${images.length} usable frames across ${tiles} tiles. Matching them to segments…`
    });

    // Cache the metadata. We store IDs and geometry, never the pictures.
    await commitInBatches(images.map((image) => ({
      type: 'set',
      ref: db.collection(COLLECTIONS.mapillaryImages).doc(image.id),
      data: { ...image, regionId, discoveredAt: serverTimestamp() },
      options: { merge: true }
    })));

    const index = buildImageIndex(images);
    const segmentsSnap = await db.collection(COLLECTIONS.segments)
      .where('regionId', '==', regionId).get();

    // A discovery run only searched the box it was given. Segments outside it
    // were never looked at, so they keep `not_searched` - writing `none_found`
    // there would claim an absence of imagery we never checked for.
    //
    // The filter happens before `total` is set, so progress counts the work
    // this run will actually do rather than the whole region.
    const searched = padBbox(bbox, MAPILLARY_SEARCH_RADIUS_M);
    const inSearchArea = [];
    let outsideSearch = 0;
    for (const doc of segmentsSnap.docs) {
      // candidatesFor and selectUsefulImagesForSegment both walk the geometry,
      // which is stored flat in Firestore.
      const segment = decodeSegment(doc.data());
      if (segment.geometry?.length && bboxIntersects(searched, bboxOf(segment.geometry))) {
        inSearchArea.push({ doc, segment });
      } else {
        outsideSearch += 1;
      }
    }

    await updateProgress(ref, {
      total: inSearchArea.length,
      processed: 0,
      message: `${inSearchArea.length} segment(s) lie in the searched area (${outsideSearch} elsewhere in the region were not searched).`
    });

    let withImagery = 0;
    let selectedTotal = 0;
    let processed = 0;
    const writes = [];

    let skippedAsSettled = 0;

    for (const { doc, segment } of inSearchArea) {
      if (await isCancelled(ref)) break;

      // Decided before a single image is fetched, let alone analysed.
      const verdict = needsVisualEvidence(segment);
      if (!verdict.needed) {
        skippedAsSettled += 1;
        processed += 1;
        writes.push({
          type: 'set',
          ref: doc.ref,
          data: {
            imagery: {
              status: ImageryStatus.NOT_NEEDED,
              imageCount: 0,
              notNeededReason: verdict.reason,
              lastSearchedAt: serverTimestamp(),
              selected: []
            },
            updatedAt: serverTimestamp()
          },
          options: { merge: true }
        });
        continue;
      }

      const candidates = index.candidatesFor(segment);
      const chosen = selectUsefulImagesForSegment(segment, candidates, { max: maxPerSegment });

      if (chosen.length > 0) { withImagery += 1; selectedTotal += chosen.length; }

      writes.push({
        type: 'set',
        ref: doc.ref,
        data: {
          imagery: {
            status: chosen.length ? ImageryStatus.SELECTED : ImageryStatus.NONE_FOUND,
            imageCount: chosen.length,
            candidateCount: candidates.length,
            lastSearchedAt: serverTimestamp(),
            selected: chosen.map((c) => ({
              imageId: c.image.id,
              capturedAt: c.image.capturedAt,
              distanceMeters: c.distanceMeters,
              compassAngle: c.image.compassAngle,
              sequenceId: c.image.sequenceId,
              selectionScore: c.score,
              analysed: false
            }))
          },
          updatedAt: serverTimestamp()
        },
        options: { merge: true }
      });

      processed += 1;
      if (writes.length >= 300) {
        await commitInBatches(writes.splice(0, writes.length));
        await updateProgress(ref, { processed, succeeded: withImagery, message: `Matched ${processed}/${inSearchArea.length} segment(s) inside the searched area…` });
      }
    }

    if (writes.length) await commitInBatches(writes);
    await updateProgress(ref, {
      processed,
      succeeded: withImagery,
      message: `${withImagery} segment(s) have imagery to analyse. `
        + `${skippedAsSettled} were already settled by their OSM tags and cost nothing.`
    });

    await writeAudit({
      actor,
      action: AuditAction.IMAGERY_DISCOVERED,
      targetType: 'region',
      targetId: regionId,
      next: { imagesFound: images.length, segmentsWithImagery: withImagery, framesSelected: selectedTotal },
      context: { bbox, segmentsInSearchArea: processed, segmentsOutsideSearchArea: outsideSearch }
    });

    return {
      imagesFound: images.length,
      tilesQueried: tiles,
      truncatedTiles,
      segmentsProcessed: processed,
      segmentsWithImagery: withImagery,
      framesSelected: selectedTotal,
      // Coverage is reported over the area actually searched, not the whole
      // region: a run over one neighbourhood says nothing about the rest.
      segmentsInSearchArea: processed,
      segmentsOutsideSearchArea: outsideSearch,
      regionSegmentCount: segmentsSnap.size,
      coverageRatio: processed ? Number((withImagery / processed).toFixed(3)) : 0,

      // Segments the OSM tags already answered, which never reached the
      // selector and will never reach the model. Reported here rather than
      // only in a progress message, because a saving nobody can see is a
      // saving nobody can verify.
      skippedAsSettled,

      // One call per segment, not one per frame: the analysis job sends the
      // closest photograph and only reaches for another when that reading
      // comes back unclear. `maxAiCalls` is the ceiling if every segment
      // turned out unclear, which it will not.
      estimatedAiCalls: withImagery,
      maxAiCalls: selectedTotal
    };
  });
}

/**
 * What a full analysis run would cost, without running it. This is what the
 * admin console shows before the "Start analysis" button becomes active.
 */
export async function estimateAnalysisCost(regionId, { onlyUnanalysed = true } = {}) {
  const snap = await db.collection(COLLECTIONS.segments)
    .where('regionId', '==', regionId)
    .where('imagery.status', '==', ImageryStatus.SELECTED)
    .get();

  let frames = 0;
  let segments = 0;
  for (const doc of snap.docs) {
    const selected = doc.data().imagery?.selected || [];
    const pending = onlyUnanalysed ? selected.filter((s) => !s.analysed) : selected;
    if (pending.length) { segments += 1; frames += pending.length; }
  }

  // One call per segment, not one per frame.
  //
  // The analysis job sends the closest photograph first and only reaches for
  // another when that reading comes back poor, obstructed or uncertain - so
  // counting every selected frame described a bill that will not arrive.
  // `maxAiCalls` is the ceiling if every single segment turned out unclear,
  // which in practice it will not.
  return {
    regionId,
    segments,
    frames,
    estimatedAiCalls: segments,
    maxAiCalls: frames,
    note: 'One photograph per segment is analysed. A second is only spent when the first reading is unclear.'
  };
}
