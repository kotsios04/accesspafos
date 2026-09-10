/**
 * Background job bookkeeping.
 *
 * All long-running work (OSM import, imagery discovery, AI analysis,
 * recalculation, graph rebuild) runs as a tracked job document so the admin
 * console can show real progress and real errors rather than a spinner.
 *
 * Jobs are designed to be safe to retry: each step is idempotent, keyed on
 * stable identifiers derived from OSM/Mapillary IDs rather than on insertion
 * order.
 */

import { db, serverTimestamp, FieldValue } from '../lib/firebase.js';
import { COLLECTIONS } from '../config/index.js';
import { JobStatus } from '../shared/constants.js';

/**
 * @param {'ingestion'|'analysis'} kind
 * @param {Object} payload
 */
export async function createJob(kind, payload) {
  const collection = kind === 'analysis' ? COLLECTIONS.analysisJobs : COLLECTIONS.ingestionJobs;
  const ref = db.collection(collection).doc();
  await ref.set({
    id: ref.id,
    kind,
    type: payload.type,
    regionId: payload.regionId || null,
    status: JobStatus.QUEUED,
    processed: 0,
    total: payload.total ?? null,
    succeeded: 0,
    skipped: 0,
    errors: [],
    errorCount: 0,
    params: payload.params || {},
    createdBy: payload.createdBy || null,
    createdAt: serverTimestamp(),
    startedAt: null,
    finishedAt: null,
    message: null
  });
  return ref;
}

export async function startJob(ref) {
  await ref.update({ status: JobStatus.RUNNING, startedAt: serverTimestamp(), message: null });
}

export async function updateProgress(ref, patch) {
  await ref.update({ ...patch, updatedAt: serverTimestamp() });
}

export async function incrementProgress(ref, { processed = 0, succeeded = 0, skipped = 0 } = {}) {
  const patch = { updatedAt: serverTimestamp() };
  if (processed) patch.processed = FieldValue.increment(processed);
  if (succeeded) patch.succeeded = FieldValue.increment(succeeded);
  if (skipped) patch.skipped = FieldValue.increment(skipped);
  await ref.update(patch);
}

/** Record an error without failing the whole job. Kept bounded in size. */
export async function recordJobError(ref, error, context = {}) {
  const message = error instanceof Error ? error.message : String(error);
  await ref.update({
    errorCount: FieldValue.increment(1),
    errors: FieldValue.arrayUnion({
      message: message.slice(0, 300),
      context: JSON.stringify(context).slice(0, 200),
      at: new Date().toISOString()
    }),
    updatedAt: serverTimestamp()
  });
}

export async function finishJob(ref, { status = JobStatus.COMPLETED, message = null, result = null } = {}) {
  await ref.update({
    status,
    message,
    result: result || null,
    finishedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function failJob(ref, error) {
  const message = error instanceof Error ? error.message : String(error);
  await ref.update({
    status: JobStatus.FAILED,
    message: message.slice(0, 500),
    finishedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

/** Was this job cancelled while it was running? Checked between chunks. */
export async function isCancelled(ref) {
  const snap = await ref.get();
  return snap.exists && snap.data().status === JobStatus.CANCELLED;
}

/**
 * Wrap a job body with consistent lifecycle handling: start, run, finish or
 * fail, and mark partial when some units errored but others succeeded.
 */
export async function runJob(ref, body) {
  await startJob(ref);
  try {
    const result = await body(ref);
    const snap = await ref.get();
    const data = snap.data() || {};
    if (data.status === JobStatus.CANCELLED) return { cancelled: true };
    const status = (data.errorCount || 0) > 0 && (data.succeeded || 0) > 0
      ? JobStatus.PARTIAL
      : ((data.errorCount || 0) > 0 && (data.succeeded || 0) === 0
        ? JobStatus.FAILED
        : JobStatus.COMPLETED);
    await finishJob(ref, { status, result: result || null });
    return { status, result };
  } catch (error) {
    await failJob(ref, error);
    throw error;
  }
}
