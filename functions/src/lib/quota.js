/**
 * AI cost protection.
 *
 * This is a student competition project running on a personal Google Cloud
 * account. An accidental loop over a city's worth of street imagery would be
 * expensive, so spending is gated at three independent levels:
 *
 *   1. per job   - MAX_AI_ANALYSES_PER_JOB
 *   2. per day   - MAX_AI_ANALYSES_PER_DAY, enforced by a transactional ledger
 *   3. per image - a deduplication key, so identical evidence is never paid
 *                  for twice
 *
 * The daily ledger is a Firestore transaction rather than an in-memory
 * counter, because Cloud Functions scale horizontally and an in-memory
 * counter would be per-instance - which is to say, no limit at all.
 */

import { HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue, serverTimestamp } from './firebase.js';
import { COLLECTIONS } from '../config/index.js';
import { MAX_AI_ANALYSES_PER_DAY, MAX_CONCURRENT_AI_JOBS } from '../shared/config.js';
import { analysisDedupeKey } from './cacheKey.js';

/** UTC day key, e.g. "2026-09-08". */
export function usageDayKey(now = new Date()) {
  return new Date(now).toISOString().slice(0, 10);
}

function usageRef(day = usageDayKey()) {
  return db.collection(COLLECTIONS.aiUsage).doc(day);
}

/**
 * Atomically reserve `count` AI calls against today's budget.
 * Returns how many were actually granted, which may be fewer than requested
 * (or zero). Callers must respect the granted number.
 */
export async function reserveAiCalls(count, { dailyLimit = MAX_AI_ANALYSES_PER_DAY } = {}) {
  const day = usageDayKey();
  const ref = usageRef(day);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used = snap.exists ? (snap.data().reserved || 0) : 0;
    const remaining = Math.max(0, dailyLimit - used);
    const granted = Math.max(0, Math.min(count, remaining));

    if (granted > 0) {
      tx.set(ref, {
        day,
        reserved: FieldValue.increment(granted),
        limit: dailyLimit,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }

    return { granted, used, remaining, limit: dailyLimit, day };
  });
}

/** Give back reservations that were not spent (a job finished early, failed). */
export async function releaseAiCalls(count) {
  if (!count || count <= 0) return;
  await usageRef().set({
    reserved: FieldValue.increment(-count),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

/** Record actual spend, separately from reservations, for honest reporting. */
export async function recordAiSpend({ calls = 0, cached = 0, failed = 0, model = null } = {}) {
  const day = usageDayKey();
  await usageRef(day).set({
    day,
    calls: FieldValue.increment(calls),
    cached: FieldValue.increment(cached),
    failed: FieldValue.increment(failed),
    model,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

/** Today's usage snapshot for the admin cost panel. */
export async function getUsage(day = usageDayKey()) {
  const snap = await usageRef(day).get();
  const data = snap.exists ? snap.data() : {};
  return {
    day,
    limit: data.limit ?? MAX_AI_ANALYSES_PER_DAY,
    reserved: data.reserved ?? 0,
    calls: data.calls ?? 0,
    cached: data.cached ?? 0,
    failed: data.failed ?? 0,
    remaining: Math.max(0, (data.limit ?? MAX_AI_ANALYSES_PER_DAY) - (data.reserved ?? 0))
  };
}

/**
 * Refuse to start a second concurrent AI job. Bulk analysis is expensive and
 * sequential by design; parallel jobs would multiply spend and race on the
 * same segments.
 */
/**
 * Past this, a job claiming to run is not running.
 *
 * A Cloud Function cannot outlive its own timeout, and the analysis job is
 * capped at 200 calls made concurrently - minutes of work, not half an hour.
 * So a job still marked `running` after this long did not finish: it crashed,
 * timed out, or its instance was reclaimed mid-write, and nothing will ever
 * come back to close it.
 */
const STALE_JOB_MS = 30 * 60 * 1000;

export async function assertNoConcurrentAiJob({ limit = MAX_CONCURRENT_AI_JOBS } = {}) {
  const running = await db.collection(COLLECTIONS.analysisJobs)
    .where('status', 'in', ['queued', 'running'])
    .limit(limit + 20)
    .get();

  const now = Date.now();
  const live = [];
  const stale = [];

  for (const doc of running.docs) {
    const data = doc.data();
    const since = data.startedAt?.toMillis?.() ?? data.createdAt?.toMillis?.() ?? null;
    // No timestamp at all is treated as live. Refusing to start is the safe
    // failure here; running two bulk analyses at once is the expensive one.
    if (since == null || now - since < STALE_JOB_MS) live.push(doc);
    else stale.push(doc);
  }

  // Close the dead ones out. Without this a single crashed job locks every
  // future analysis permanently, and the console gives no way out: the job
  // list shows nothing running, while the start button refuses with "a job is
  // already running". That trap is worse than the concurrency it was
  // guarding against.
  for (const doc of stale) {
    try {
      await doc.ref.update({
        status: 'failed',
        finishedAt: new Date(),
        message: 'Marked failed automatically: the job stopped reporting and was never closed.'
      });
    } catch {
      // Best effort. A job we could not close still must not block the start.
    }
  }

  if (live.length >= limit) {
    throw new HttpsError(
      'resource-exhausted',
      `An analysis job is already running. Wait for it to finish, or cancel it first.`
    );
  }
}

// Defined in ./cacheKey.js so it can be imported and tested without Firebase.
export { analysisDedupeKey };
