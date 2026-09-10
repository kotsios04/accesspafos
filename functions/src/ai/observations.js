/**
 * Persisting observations, with provenance and deduplication.
 *
 * An observation document is the atomic unit of evidence in this system:
 * one image, one analysis, one set of structured findings, permanently
 * attributed to its source. Assessments are recomputed from observations;
 * observations themselves are never rewritten, so the history of what the
 * system believed and why survives.
 */

import { db, serverTimestamp, Timestamp, FieldValue } from '../lib/firebase.js';
import { COLLECTIONS } from '../config/index.js';
import { analysisDedupeKey } from '../lib/quota.js';
import { ANALYSIS_VERSION } from '../shared/config.js';

export const ObservationStatus = Object.freeze({
  ACTIVE: 'active',
  SUPERSEDED: 'superseded',
  FAILED: 'failed'
});

export function observationDocId({ sourceType, sourceId, analysisVersion, model }) {
  const safe = String(sourceId).replace(/[^\w.-]/g, '_');
  return `${sourceType}_${safe}_${model}_${analysisVersion}`.slice(0, 300);
}

/**
 * Has this exact evidence already been analysed by this model under this
 * analysis version? If so, we must not pay for it again.
 *
 * A cache hit does not mean the caller's segment already has this evidence:
 * one photograph sits within range of several segments, especially at a
 * junction, so the same image is selected by each of them. Callers must link
 * the hit to their own segment with `linkObservationToSegment`.
 */
export async function findCachedObservation({ sourceType, sourceId, model, analysisVersion = ANALYSIS_VERSION }) {
  const id = observationDocId({ sourceType, sourceId, analysisVersion, model });
  const snap = await db.collection(COLLECTIONS.observations).doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (data.status === ObservationStatus.FAILED) return null;
  return { id: snap.id, ...data };
}

/**
 * @param {Object} input
 * @param {string} input.segmentId
 * @param {string} input.regionId
 * @param {string} input.sourceType
 * @param {string} input.sourceId
 * @param {object} input.observation      validated observation
 * @param {string} input.model
 * @param {string} [input.analysisVersion]
 * @param {*} [input.capturedAt]          when the photo was taken
 * @param {{lng:number,lat:number}} [input.location]
 * @param {object} [input.sourceMeta]     attribution, sequence, distance, etc.
 */
export async function saveObservation(input) {
  const analysisVersion = input.analysisVersion || ANALYSIS_VERSION;
  const id = observationDocId({
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    analysisVersion,
    model: input.model
  });

  const doc = {
    id,
    // An observation is keyed by the photograph, not by the segment: the same
    // frame is evidence for every segment it looks at. `segmentIds` is the
    // real link and what queries read; `segmentId` is kept as the first
    // segment that selected it, for older documents and for debugging.
    segmentId: input.segmentId,
    segmentIds: FieldValue.arrayUnion(String(input.segmentId)),
    regionId: input.regionId,
    sourceType: input.sourceType,
    sourceId: String(input.sourceId),
    dedupeKey: analysisDedupeKey({
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      model: input.model,
      analysisVersion
    }),
    observation: input.observation,
    imageQuality: input.observation?.imageQuality || 'poor',
    aiModel: input.model,
    // The version string the API reported for the model that served this
    // request. The requested name is pinned, but recording what answered keeps
    // the observation's provenance a fact rather than an assumption.
    aiModelVersion: input.modelVersion || null,
    analysisVersion,
    capturedAt: toTimestamp(input.capturedAt),
    analysedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    location: input.location || null,
    sourceMeta: input.sourceMeta || {},
    status: ObservationStatus.ACTIVE,
    // Clear any error left by a previous failed attempt at this same image:
    // the document is keyed by photograph, so a success supersedes a failure
    // in place rather than creating a second record.
    error: null
  };

  // Merge, specifically so `segmentIds` accumulates.
  //
  // With merge: false, `arrayUnion` in a full `set` has nothing to union with
  // and simply writes [segmentId]. Two segments analysing the SAME photograph
  // at the same time - which happens constantly, since one frame is evidence
  // for every segment near it and the job runs several at a time - therefore
  // raced: the second write replaced the document and dropped the first
  // segment's link. The audit found exactly two such pairs in 200 frames.
  //
  // Every other field is rewritten on each save, so merging changes nothing
  // else; it only stops the array being reset to a single element.
  await db.collection(COLLECTIONS.observations).doc(id).set(doc, { merge: true });
  return doc;
}

/** Record a failure so the same broken image is not retried in a loop. */
export async function saveFailedObservation({ segmentId, regionId, sourceType, sourceId, model, analysisVersion = ANALYSIS_VERSION, error }) {
  const id = observationDocId({ sourceType, sourceId, analysisVersion, model });
  await db.collection(COLLECTIONS.observations).doc(id).set({
    id,
    segmentId,
    regionId,
    sourceType,
    sourceId: String(sourceId),
    aiModel: model,
    analysisVersion,
    status: ObservationStatus.FAILED,
    error: String(error).slice(0, 300),
    analysedAt: serverTimestamp(),
    createdAt: serverTimestamp()
  }, { merge: true });
}

/**
 * Record that an existing observation is also evidence for another segment.
 *
 * Called when the cache answers for a frame that a different segment already
 * paid to analyse. Without this the second segment is marked analysed, is
 * never retried, and still has nothing to show - the evidence exists but is
 * attached to a neighbour.
 */
export async function linkObservationToSegment({
  sourceType, sourceId, model, analysisVersion = ANALYSIS_VERSION, segmentId
}) {
  if (!segmentId) return;
  const id = observationDocId({ sourceType, sourceId, analysisVersion, model });
  await db.collection(COLLECTIONS.observations).doc(id).set({
    segmentIds: FieldValue.arrayUnion(String(segmentId))
  }, { merge: true });
}

/**
 * All active observations for a segment, newest capture first, shaped for the
 * aggregation stage.
 */
export async function loadObservationsForSegment(segmentId, { limit = 20 } = {}) {
  const snap = await db.collection(COLLECTIONS.observations)
    .where('segmentIds', 'array-contains', segmentId)
    .where('status', '==', ObservationStatus.ACTIVE)
    .orderBy('capturedAt', 'desc')
    .limit(limit)
    .get();

  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      observation: data.observation,
      sourceType: data.sourceType,
      sourceId: data.sourceId,
      capturedAt: data.capturedAt,
      analysedAt: data.analysedAt,
      aiModel: data.aiModel,
      analysisVersion: data.analysisVersion,
      sourceMeta: data.sourceMeta || {}
    };
  });
}

function toTimestamp(value) {
  if (value == null) return null;
  if (value instanceof Timestamp) return value;
  if (typeof value === 'number') return Timestamp.fromMillis(value);
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : Timestamp.fromMillis(t);
  }
  return null;
}
