/**
 * AI analysis job - the only place in the system that spends money.
 *
 * Every safeguard the project has is enforced here, in this order:
 *   1. a second concurrent AI job is refused outright;
 *   2. the work is bounded by MAX_AI_ANALYSES_PER_JOB;
 *   3. the daily budget is reserved transactionally before any call is made;
 *   4. each frame is checked against the observation cache and skipped if the
 *      same image was already analysed by the same model and version;
 *   5. unused reservations are returned when the job finishes.
 *
 * Analysis produces observations. It does not produce scores: after the
 * frames are processed, the affected segments are re-assessed by the same
 * deterministic engine that runs everywhere else.
 */

import { db, serverTimestamp, commitInBatches } from '../lib/firebase.js';
import { COLLECTIONS } from '../config/index.js';
import { getImageForAnalysis, isMapillaryConfigured, MapillaryNotConfiguredError, mapillaryViewerUrl } from '../mapillary/client.js';
import { isGeminiConfigured, GeminiNotConfiguredError } from '../ai/genkit.js';
import { findCachedObservation, saveObservation, saveFailedObservation, linkObservationToSegment } from '../ai/observations.js';
import { reserveAiCalls, releaseAiCalls, recordAiSpend } from '../lib/quota.js';
import { mapWithConcurrency } from '../lib/http.js';
import { runJob, updateProgress, isCancelled, recordJobError, incrementProgress } from './runner.js';
import { recomputeSegment } from '../scoring/apply.js';
import { writeAudit, AuditAction } from '../lib/audit.js';
import { ImageryStatus } from './discoverMapillary.js';
import {
  AI_MODEL, ANALYSIS_VERSION, MAX_AI_ANALYSES_PER_JOB, AI_JOB_CONCURRENCY,
  AI_CONSECUTIVE_FAILURE_LIMIT
} from '../shared/config.js';
import { SourceType } from '../shared/constants.js';

/**
 * The analysis module is loaded on first use rather than imported.
 *
 * It pulls in genkit and its Zod schema, which is a large graph that the
 * Firebase CLI would otherwise have to load inside its ten-second function
 * discovery budget on every deploy - for a job that only runs when an admin
 * starts it.
 */
let analyzeFn = null;
async function analyzeStreetAccessibility(input) {
  if (!analyzeFn) ({ analyzeStreetAccessibility: analyzeFn } = await import('../ai/analyze.js'));
  return analyzeFn(input);
}

/**
 * @param {import('firebase-admin/firestore').DocumentReference} jobRef
 * @param {{regionId:string, limit?:number, segmentIds?:string[], forceReanalysis?:boolean, actor:object}} params
 */
export async function runImageryAnalysis(jobRef, params) {
  const {
    regionId,
    limit = MAX_AI_ANALYSES_PER_JOB,
    segmentIds = null,
    forceReanalysis = false,
    actor
  } = params;

  return runJob(jobRef, async (ref) => {
    if (!isGeminiConfigured()) throw new GeminiNotConfiguredError();
    if (!isMapillaryConfigured()) throw new MapillaryNotConfiguredError();

    // --- 1. build the work list -------------------------------------------
    const tasks = await collectTasks(regionId, { segmentIds, forceReanalysis });
    const capped = tasks.slice(0, Math.min(limit, MAX_AI_ANALYSES_PER_JOB));

    if (capped.length === 0) {
      await updateProgress(ref, { total: 0, message: 'Nothing to analyse: every selected frame already has a current observation.' });
      return { analysed: 0, cached: 0, failed: 0, segmentsUpdated: 0, skippedByBudget: 0 };
    }

    // --- 2. reserve budget -------------------------------------------------
    const reservation = await reserveAiCalls(capped.length);
    if (reservation.granted === 0) {
      throw new Error(
        `The daily AI budget is spent (${reservation.used}/${reservation.limit} calls used today). Analysis will be available again tomorrow, or raise the limit in Settings.`
      );
    }

    const work = capped.slice(0, reservation.granted);
    const skippedByBudget = capped.length - work.length;

    await updateProgress(ref, {
      total: work.length,
      message: `Analysing ${work.length} frame(s) with ${AI_MODEL}` +
        (skippedByBudget ? ` (${skippedByBudget} deferred: daily budget)` : '') + '…'
    });

    // --- 3. analyse --------------------------------------------------------
    let analysed = 0;
    let cached = 0;
    let failed = 0;
    let attempted = 0;
    let consecutiveFailures = 0;
    let abortReason = null;
    const touchedSegments = new Set();
    const imageryUpdates = new Map();

    const results = await mapWithConcurrency(work, AI_JOB_CONCURRENCY, async (task) => {
      if (abortReason) return { skipped: true };
      if (await isCancelled(ref)) return { skipped: true };

      // Cache check - the single biggest cost saving in the system.
      if (!forceReanalysis) {
        const hit = await findCachedObservation({
          sourceType: SourceType.MAPILLARY,
          sourceId: task.imageId,
          model: AI_MODEL,
          analysisVersion: ANALYSIS_VERSION
        });
        if (hit) {
          // The frame was already analysed - for some other segment. The
          // finding is reusable, the link is not: record that this segment is
          // also described by it, or the segment ends up marked analysed with
          // no evidence attached to it.
          await linkObservationToSegment({
            sourceType: SourceType.MAPILLARY,
            sourceId: task.imageId,
            model: AI_MODEL,
            analysisVersion: ANALYSIS_VERSION,
            segmentId: task.segmentId
          });
          cached += 1;
          touchedSegments.add(task.segmentId);
          markAnalysed(imageryUpdates, task);
          await incrementProgress(ref, { processed: 1, skipped: 1 });
          return { cached: true };
        }
      }

      const image = await getImageForAnalysis(task.imageId);
      const result = await analyzeStreetAccessibility({
        imageUrl: image.analysisUrl,
        context: {
          segmentKind: task.segmentKind,
          streetName: task.streetName,
          distanceMeters: task.distanceMeters
        }
      });

      attempted += 1;

      if (!result.ok) {
        failed += 1;
        consecutiveFailures += 1;
        // A systematic fault - a rejected request shape, a revoked key, a
        // model that no longer exists - fails every frame identically. Without
        // this, one bad deploy quietly spends the entire daily budget proving
        // the same thing several hundred times.
        if (consecutiveFailures >= AI_CONSECUTIVE_FAILURE_LIMIT && analysed === 0) {
          abortReason = `Stopped after ${consecutiveFailures} consecutive failures with no successes. `
            + `This is a systematic fault, not bad luck: ${result.error}`;
        }
        await saveFailedObservation({
          segmentId: task.segmentId,
          regionId,
          sourceType: SourceType.MAPILLARY,
          sourceId: task.imageId,
          model: AI_MODEL,
          error: result.error
        });
        await incrementProgress(ref, { processed: 1 });
        return { failed: true, error: result.error };
      }

      await saveObservation({
        segmentId: task.segmentId,
        regionId,
        sourceType: SourceType.MAPILLARY,
        sourceId: task.imageId,
        observation: result.observation,
        model: result.model,
        modelVersion: result.modelVersion,
        analysisVersion: result.analysisVersion,
        capturedAt: image.capturedAt,
        location: { lng: image.lng, lat: image.lat },
        sourceMeta: {
          sequenceId: image.sequenceId,
          compassAngle: image.compassAngle,
          distanceMeters: task.distanceMeters,
          attribution: image.attribution,
          viewerUrl: mapillaryViewerUrl(image.id),
          creatorUsername: image.creatorUsername
        }
      });

      analysed += 1;
      consecutiveFailures = 0;
      touchedSegments.add(task.segmentId);
      markAnalysed(imageryUpdates, task);
      if (readingIsSufficient(result.observation)) {
        retireRemainingFrames(imageryUpdates, task, 'sufficient_reading');
      }
      await incrementProgress(ref, { processed: 1, succeeded: 1 });
      return { ok: true };
    });

    for (const r of results) {
      if (!r.ok && r.error) await recordJobError(ref, r.error, { stage: 'analysis' });
    }

    // --- 4. hand unspent budget back --------------------------------------
    //
    // Only successful calls are charged by the provider, so only they consume
    // budget. Counting failures against the daily limit meant a broken request
    // shape could exhaust a whole day of allowance without a single billed
    // token - and made the ledger describe attempts while claiming to describe
    // spend.
    const unspent = reservation.granted - analysed;
    if (unspent > 0) await releaseAiCalls(unspent);
    await recordAiSpend({ calls: analysed, cached, failed, model: AI_MODEL });

    // --- 5. mark frames analysed ------------------------------------------
    await commitInBatches([...imageryUpdates.entries()].map(([segmentId, selected]) => ({
      type: 'set',
      ref: db.collection(COLLECTIONS.segments).doc(segmentId),
      data: {
        imagery: { selected, status: ImageryStatus.ANALYSED, lastAnalysedAt: serverTimestamp() },
        updatedAt: serverTimestamp()
      },
      options: { merge: true }
    })));

    // --- 6. re-assess the affected segments -------------------------------
    if (abortReason) await recordJobError(ref, new Error(abortReason), { stage: 'circuit-breaker' });

    await updateProgress(ref, { message: `Re-assessing ${touchedSegments.size} segment(s)…` });
    let segmentsUpdated = 0;
    for (const segmentId of touchedSegments) {
      try {
        await recomputeSegment(segmentId);
        segmentsUpdated += 1;
      } catch (error) {
        await recordJobError(ref, error, { stage: 'reassess', segmentId });
      }
    }

    await writeAudit({
      actor,
      action: AuditAction.AI_ANALYSIS_RUN,
      targetType: 'region',
      targetId: regionId,
      next: { analysed, cached, failed, segmentsUpdated, model: AI_MODEL, analysisVersion: ANALYSIS_VERSION },
      context: { requested: tasks.length, budgetGranted: reservation.granted, skippedByBudget }
    });

    return {
      analysed,
      cached,
      failed,
      attempted,
      abortedAfterConsecutiveFailures: abortReason ? consecutiveFailures : 0,
      abortReason,
      segmentsUpdated,
      skippedByBudget,
      model: AI_MODEL,
      analysisVersion: ANALYSIS_VERSION,
      dailyBudget: { used: reservation.used + analysed, limit: reservation.limit }
    };
  });
}

/**
 * Is this reading good enough that a second photograph would add nothing?
 *
 * Conservative in the direction that costs money rather than the one that
 * costs truth: anything doubtful keeps its remaining frames and gets another
 * look on the next run.
 */
function readingIsSufficient(observation) {
  if (!observation) return false;
  if (observation.imageQuality === 'poor') return false;
  // The model looked and could not see the pavement at all - a different angle
  // is exactly what that calls for.
  if (observation.pedestrianPath?.visible === 'not_visible') return false;
  if ((observation.uncertainFindings?.length || 0) > 2) return false;
  return true;
}

/**
 * Retire the frames this segment no longer needs.
 *
 * Marked analysed with a note rather than deleted, so the record still shows
 * which imagery was selected and why it was never sent - and so a later
 * forceReanalysis can still reach it.
 */
function retireRemainingFrames(map, task, reason) {
  const list = map.get(task.segmentId) || task.allSelected;
  map.set(task.segmentId, list.map((s) => (
    s.imageId === task.imageId || s.analysed
      ? s
      : { ...s, analysed: true, skipped: reason, analysedAt: new Date().toISOString() }
  )));
}

function markAnalysed(map, task) {
  const list = map.get(task.segmentId) || task.allSelected;
  map.set(task.segmentId, list.map((s) =>
    (s.imageId === task.imageId ? { ...s, analysed: true, analysedAt: new Date().toISOString() } : s)));
}

/** Flatten segments-with-selected-imagery into a list of per-frame tasks. */
async function collectTasks(regionId, { segmentIds, forceReanalysis }) {
  let docs;
  if (Array.isArray(segmentIds) && segmentIds.length) {
    const snaps = await db.getAll(...segmentIds.map((id) => db.collection(COLLECTIONS.segments).doc(id)));
    docs = snaps.filter((s) => s.exists);
  } else {
    const snap = await db.collection(COLLECTIONS.segments)
      .where('regionId', '==', regionId)
      .where('imagery.status', 'in', [ImageryStatus.SELECTED, ImageryStatus.ANALYSED])
      .get();
    docs = snap.docs;
  }

  const tasks = [];
  for (const doc of docs) {
    const segment = doc.data();
    const selected = segment.imagery?.selected || [];
    const pending = selected.filter((frame) => forceReanalysis || !frame.analysed);
    if (!pending.length) continue;

    // ONE frame per segment per run, the closest one.
    //
    // Previously every selected frame became a task, so a segment with three
    // usable photographs cost three calls whether or not the first one settled
    // the question - and for most streets the first one does. The rest are not
    // thrown away: a reading that comes back poor, obstructed or full of
    // uncertainty leaves them pending for the next run, while a clear reading
    // retires them (see retireRemainingFrames). Depth is spent where the model
    // says it is needed instead of everywhere by default, which is most of the
    // saving in this pipeline.
    const best = pending.reduce((a, b) =>
      ((b.distanceMeters ?? 999) < (a.distanceMeters ?? 999) ? b : a));

    tasks.push({
      segmentId: doc.id,
      segmentKind: segment.kind,
      streetName: segment.streetName,
      imageId: best.imageId,
      distanceMeters: best.distanceMeters,
      allSelected: selected
    });
  }

  // Analyse the best-matched frames first, so a budget-limited run spends its
  // calls on the most informative imagery rather than on whatever sorted first.
  tasks.sort((a, b) => (a.distanceMeters ?? 999) - (b.distanceMeters ?? 999));
  return tasks;
}
