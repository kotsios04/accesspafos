/**
 * AccessPafos AI - Cloud Functions entry point.
 *
 * Shape of the API:
 *   - public callables  : anonymous-friendly reads and the report submission
 *   - reviewer callables: report review, segment verification, validation
 *   - admin callables   : ingestion, analysis, configuration, exports
 *   - job triggers      : long-running work, started by writing a job document
 *   - scheduled         : nightly and weekly maintenance (never AI)
 *
 * Long jobs are NOT run inside the callable that starts them. The callable
 * creates a job document and returns immediately; a Firestore trigger picks it
 * up with a nine-minute budget and streams progress back into the same
 * document, which the admin console watches live. That way an OSM import of a
 * whole district does not depend on a browser tab staying open.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';

import {
  REGION, CALLABLE_OPTS, PUBLIC_CALLABLE_OPTS, JOB_OPTS, AI_JOB_OPTS, COLLECTIONS,
  MAPILLARY_ACCESS_TOKEN, GEMINI_API_KEY
} from './config/index.js';
import { db, bucket, serverTimestamp } from './lib/firebase.js';
import {
  requireAuth, requireReviewer, requireMunicipalityAdmin,
  requireString, requireOneOf, requireNumber, requireLatLng, requireBbox, assert, roleOf
} from './lib/guards.js';
import { getUsage, assertNoConcurrentAiJob } from './lib/quota.js';
import { writeAudit, AuditAction } from './lib/audit.js';

import { calculateAccessibleRoute, RoutingError } from './routing/service.js';
import { searchPlaces, reverseGeocode } from './search/geocode.js';
import { submitReport, analyseReportPhoto } from './reports/submit.js';
import { reviewReport, assignReport } from './reports/review.js';
import { verifySegment, clearOverride, verificationHistory } from './admin/verify.js';
import { updateIssue, recomputePriorityForSegment } from './admin/priority.js';
import { computeCoverage, computeOverviewStats } from './admin/coverage.js';
import { getPublicConfig, getEffectiveConfig, updateConfig } from './admin/config.js';
import { addValidationLabel, computeValidationMetrics, suggestValidationTargets } from './admin/validation.js';
import { createJob } from './jobs/runner.js';
import { runOsmImport } from './jobs/ingestOsm.js';
import { runMapillaryDiscovery, estimateAnalysisCost } from './jobs/discoverMapillary.js';
import { runImageryAnalysis } from './jobs/analyzeImagery.js';
import { runRecalculation, runGraphRebuild, runBundlePublish } from './jobs/maintenance.js';
import { exportIssuesCsv, exportReportsCsv, exportCoverageCsv, exportSegmentsGeoJson } from './exports/index.js';
import { loadObservationsForSegment } from './ai/observations.js';
import { mapillaryViewerUrl, isMapillaryConfigured } from './mapillary/client.js';
import { isGeminiConfigured } from './ai/genkit.js';

import { ROUTE_PROFILES, RouteProfile, JobStatus, Role, SourceType } from './shared/constants.js';
import { DEFAULT_REGION, MAX_AI_ANALYSES_PER_JOB, MAX_REPORT_UPLOAD_MB } from './shared/config.js';
import { decodeSegment } from './shared/geometry.js';

setGlobalOptions({ region: REGION, maxInstances: 20 });

export * from './scheduled/index.js';

// ===========================================================================
// PUBLIC
// ===========================================================================

/**
 * Everything the app needs on first paint: runtime thresholds, the available
 * regions, and the URL of the current published accessibility bundle.
 * One round trip instead of four.
 */
export const bootstrap = onCall({ ...PUBLIC_CALLABLE_OPTS }, async (request) => {
  const [config, regionsSnap] = await Promise.all([
    getPublicConfig(),
    db.collection(COLLECTIONS.regions).get()
  ]);

  const regions = await Promise.all(regionsSnap.docs.map(async (doc) => {
    const r = doc.data();
    // The published bundle is world-readable by design (storage.rules grants
    // `read: if true` on public/bundles/**), so it is addressed by a stable
    // download URL rather than a signed one.
    //
    // A signed URL would need the runtime service account to hold
    // iam.serviceAccountTokenCreator - which it does not by default, so signing
    // threw and this silently fell back to null, leaving the map with nothing
    // to fetch. It would also expire in six hours, defeating the immutable
    // per-version caching this file is built around.
    const bundleUrl = r.bundlePath ? publicDownloadUrl(r.bundlePath) : null;
    return {
      id: doc.id,
      name: r.name || doc.id,
      nameEl: r.nameEl || null,
      bbox: r.bbox || null,
      segmentCount: r.segmentCount || 0,
      totalLengthMeters: r.totalLengthMeters || 0,
      bundleVersion: r.bundleVersion || 0,
      bundleStats: r.bundleStats || null,
      bundleUrl,
      graphVersion: r.graphVersion || 0,
      lastImportedAt: r.lastImportedAt || null
    };
  }));

  const activeRegion = regions.find((r) => r.bundleVersion > 0) || regions[0] || null;
  const [stats, topBarriers] = activeRegion
    ? await Promise.all([
      computeCoverage(activeRegion.id).catch(() => null),
      loadTopBarriers(activeRegion.id).catch(() => [])
    ])
    : [null, []];

  return {
    config,
    regions,
    defaultRegionId: activeRegion?.id || DEFAULT_REGION.id,
    stats,
    topBarriers,
    role: roleOf(request)
  };
});

/**
 * The highest-priority open barriers in the active region.
 *
 * Read straight from the priority index, which is itself derived from
 * assessments - so an empty region returns an empty list rather than
 * placeholder entries. The home screen renders whatever comes back, including
 * nothing.
 */
async function loadTopBarriers(regionId, limit = 4) {
  const snap = await db.collection(COLLECTIONS.priorityIssues)
    .where('regionId', '==', regionId)
    .orderBy('priorityScore', 'desc')
    .limit(limit * 3)
    .get();

  return snap.docs
    .map((doc) => doc.data())
    .filter((d) => d.status !== 'resolved' && (d.priorityScore || 0) > 0)
    .slice(0, limit)
    .map((d) => ({
      id: d.segmentId,
      name: d.streetName || null,
      nameEl: d.streetNameEl || null,
      status: d.accessibilityStatus || null,
      primaryBarrier: d.barriers?.[0]?.id || null,
      priorityBand: d.priorityBand || null
    }));
}

/**
 * A durable, cacheable URL for a world-readable object in the default bucket.
 * Access is governed by storage.rules, not by a token, so the URL never
 * expires and the browser can cache the bundle for as long as its version
 * lives.
 */
function publicDownloadUrl(path) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket().name}/o/${encodeURIComponent(path)}?alt=media`;
}

/** Accessible routing: three comparable options with honest metrics. */
export const calculateRoute = onCall({ ...PUBLIC_CALLABLE_OPTS, timeoutSeconds: 120, memory: '1GiB' }, async (request) => {
  const data = request.data || {};

  const origin = requireLatLng(data.origin, 'origin');
  const destination = requireLatLng(data.destination, 'destination');
  const profile = data.profile ? requireOneOf(data.profile, ROUTE_PROFILES, 'profile') : RouteProfile.BALANCED;
  const regionId = data.regionId ? requireString(data.regionId, 'regionId', { max: 80 }) : DEFAULT_REGION.id;

  try {
    return await calculateAccessibleRoute({
      origin, destination, profile,
      preferVerifiedData: Boolean(data.preferVerifiedData),
      regionId
    });
  } catch (error) {
    if (error instanceof RoutingError) {
      throw new HttpsError(
        error.code === 'no-route' ? 'not-found' : 'failed-precondition',
        error.message,
        { code: error.code, ...error.details }
      );
    }
    if (error.code === 'region-not-found') throw new HttpsError('not-found', error.message);
    throw error;
  }
});

/** Place search. Explicit submit only - never called per keystroke. */
export const searchPlace = onCall({ ...PUBLIC_CALLABLE_OPTS }, async (request) => {
  const query = requireString(request.data?.query, 'query', { min: 3, max: 120 });
  return searchPlaces(query);
});

export const reverseLookup = onCall({ ...PUBLIC_CALLABLE_OPTS }, async (request) => {
  const { lat, lng } = requireLatLng(request.data, 'location');
  return reverseGeocode(lat, lng);
});

/**
 * Everything behind "Why this score?" for one segment: the assessment, its
 * itemised breakdown, the individual observations and their provenance, and
 * the verification history.
 *
 * Citizen-sourced observations are included as structured findings but never
 * with their photographs - those are reviewer-only. See docs/PRIVACY.md.
 */
export const getSegmentDetail = onCall({ ...PUBLIC_CALLABLE_OPTS }, async (request) => {
  const segmentId = requireString(request.data?.segmentId, 'segmentId', { max: 120 });
  const isReviewer = ['reviewer', 'municipality_admin', 'super_admin'].includes(roleOf(request));

  const [segSnap, assessSnap, observations] = await Promise.all([
    db.collection(COLLECTIONS.segments).doc(segmentId).get(),
    db.collection(COLLECTIONS.segmentAssessments).doc(segmentId).get(),
    loadObservationsForSegment(segmentId, { limit: 12 })
  ]);

  if (!segSnap.exists) throw new HttpsError('not-found', 'That segment is not in the imported network.');
  const segment = decodeSegment(segSnap.data());

  const history = isReviewer ? await verificationHistory(segmentId, 10) : [];

  return {
    segment: {
      id: segmentId,
      regionId: segment.regionId,
      osmWayId: segment.osmWayId,
      kind: segment.kind,
      side: segment.side,
      streetName: segment.streetName,
      streetNameEl: segment.streetNameEl,
      lengthMeters: segment.lengthMeters,
      geometry: segment.geometry,
      centre: segment.centre,
      osmTags: segment.osmTags || {},
      osmTimestamp: segment.osmTimestamp || null,
      imagery: {
        imageCount: segment.imagery?.imageCount || 0,
        status: segment.imagery?.status || 'not_searched',
        lastSearchedAt: segment.imagery?.lastSearchedAt || null
      },
      manualVerification: segment.manualVerification
        ? {
          result: segment.manualVerification.result,
          status: segment.manualVerification.status,
          at: segment.manualVerification.at,
          notes: segment.manualVerification.notes,
          // The reviewer's identity is shown only to other reviewers.
          by: isReviewer ? segment.manualVerification.byEmail || segment.manualVerification.by : null
        }
        : null,
      needsInspection: Boolean(segment.needsInspection)
    },
    assessment: assessSnap.exists ? assessSnap.data() : (segment.assessment || null),
    observations: observations.map((o) => ({
      id: o.id,
      sourceType: o.sourceType,
      capturedAt: o.capturedAt,
      analysedAt: o.analysedAt,
      aiModel: o.aiModel,
      analysisVersion: o.analysisVersion,
      observation: o.observation,
      attribution: o.sourceMeta?.attribution || null,
      viewerUrl: o.sourceType === SourceType.MAPILLARY && o.sourceId
        ? mapillaryViewerUrl(o.sourceId)
        : null,
      distanceMeters: o.sourceMeta?.distanceMeters ?? null
    })),
    verificationHistory: history,
    osmUrl: segment.osmWayId ? `https://www.openstreetmap.org/way/${segment.osmWayId}` : null
  };
});

/** Submit a citizen report. Requires sign-in; anonymous sign-in is enough. */
export const createReport = onCall({ ...CALLABLE_OPTS, secrets: [GEMINI_API_KEY], timeoutSeconds: 120 }, async (request) => {
  const auth = requireAuth(request);
  const data = request.data || {};

  const result = await submitReport({
    category: requireString(data.category, 'category', { max: 40 }),
    location: requireLatLng(data.location, 'location'),
    description: data.description ? requireString(data.description, 'description', { min: 0, max: 600 }) : '',
    photoPath: data.photoPath ? requireString(data.photoPath, 'photoPath', { max: 400 }) : null,
    regionId: data.regionId || DEFAULT_REGION.id,
    reporterUid: auth.uid,
    locale: data.locale || 'en'
  });

  return result;
});

/** Upload constraints, so the client can validate before a wasted upload. */
export const getUploadPolicy = onCall({ ...CALLABLE_OPTS }, async (request) => {
  const auth = requireAuth(request);
  return {
    maxSizeMb: MAX_REPORT_UPLOAD_MB,
    acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'],
    pathPrefix: `reports/${auth.uid}/`
  };
});

// ===========================================================================
// REVIEWER
// ===========================================================================

export const reviewCitizenReport = onCall({ ...CALLABLE_OPTS, timeoutSeconds: 120 }, async (request) => {
  const actor = requireReviewer(request);
  const data = request.data || {};
  return reviewReport({
    reportId: requireString(data.reportId, 'reportId', { max: 120 }),
    decision: requireOneOf(data.decision, ['verify', 'reject', 'duplicate', 'resolve', 'needs_review'], 'decision'),
    notes: data.notes ? String(data.notes).slice(0, 600) : '',
    duplicateOf: data.duplicateOf || null,
    actor
  });
});

export const assignCitizenReport = onCall({ ...CALLABLE_OPTS }, async (request) => {
  const actor = requireReviewer(request);
  return assignReport({
    reportId: requireString(request.data?.reportId, 'reportId', { max: 120 }),
    department: requireString(request.data?.department, 'department', { max: 120 }),
    actor
  });
});

/** A short-lived signed URL so a reviewer can see a report photograph. */
export const getReportPhotoUrl = onCall({ ...CALLABLE_OPTS }, async (request) => {
  requireReviewer(request);
  const reportId = requireString(request.data?.reportId, 'reportId', { max: 120 });

  const snap = await db.collection(COLLECTIONS.citizenReports).doc(reportId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'That report no longer exists.');
  const path = snap.data().photoPath;
  if (!path) throw new HttpsError('not-found', 'This report has no photograph.');

  // Signing a URL from Cloud Run has no local private key, so the SDK calls the
  // IAM signBlob API - which the runtime service account may sign with only if
  // it holds Service Account Token Creator on itself. When that binding is
  // absent this throws SigningError, and an uncaught throw here reached the
  // reviewer as a bare HTTP 500 next to a photograph that simply never
  // appeared. The cause is an IAM binding, not a missing report, and the
  // person looking at the screen should be told which.
  try {
    const [url] = await bucket().file(path).getSignedUrl({
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000
    });
    return { url, expiresInSeconds: 900 };
  } catch (error) {
    console.error('getReportPhotoUrl: signing failed', error);
    throw new HttpsError(
      'failed-precondition',
      'The photograph could not be signed for viewing. The functions service '
      + 'account needs the Service Account Token Creator role on itself.'
    );
  }
});

/**
 * Read the photograph again.
 *
 * The model is advisory and it is sometimes wrong - it misreads a shadow as a
 * step, or a wet patch as damage - and until now a reviewer who disagreed had
 * no recourse: whatever the first pass wrote was on the document for good. A
 * failed analysis was worse still, since the error text stayed on screen
 * permanently with no way to clear it.
 *
 * This changes nothing on the map. It rewrites `aiAnalysis` on the report, and
 * the reviewer's own decision is still the only thing that reaches the public
 * layer.
 */
export const retryReportAnalysis = onCall(
  { ...CALLABLE_OPTS, secrets: [GEMINI_API_KEY], timeoutSeconds: 120 },
  async (request) => {
    requireReviewer(request);
    const reportId = requireString(request.data?.reportId, 'reportId', { max: 120 });

    const ref = db.collection(COLLECTIONS.citizenReports).doc(reportId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'That report no longer exists.');

    const report = snap.data();
    if (!report.photoPath) {
      throw new HttpsError('failed-precondition', 'This report has no photograph to analyse.');
    }
    if (!isGeminiConfigured()) {
      throw new HttpsError('failed-precondition', 'Image analysis is not configured on this deployment.');
    }

    // analyseReportPhoto records its own failure onto the document and then
    // rethrows. The reviewer asked for another reading, and "the model could
    // not read it either" is an answer to that - not a server fault. So the
    // document is re-read either way and the panel shows whatever now stands.
    try {
      await analyseReportPhoto(reportId, report.photoPath, {
        segmentKind: null,
        streetName: report.streetName || null
      });
    } catch (error) {
      console.error('retryReportAnalysis: analysis failed', error);
    }

    const fresh = await ref.get();
    return { aiAnalysis: fresh.data()?.aiAnalysis ?? null };
  }
);

export const verifySegmentAccessibility = onCall({ ...CALLABLE_OPTS, timeoutSeconds: 120 }, async (request) => {
  const actor = requireReviewer(request);
  const data = request.data || {};
  return verifySegment({
    segmentId: requireString(data.segmentId, 'segmentId', { max: 120 }),
    result: requireOneOf(data.result, ['confirmed', 'corrected', 'needs_inspection'], 'result'),
    status: data.status || null,
    notes: data.notes || '',
    photoPath: data.photoPath || null,
    actor
  });
});

export const clearSegmentOverride = onCall({ ...CALLABLE_OPTS }, async (request) => {
  const actor = requireMunicipalityAdmin(request);
  return clearOverride({
    segmentId: requireString(request.data?.segmentId, 'segmentId', { max: 120 }),
    notes: request.data?.notes || '',
    actor
  });
});

export const recordValidationLabel = onCall({ ...CALLABLE_OPTS }, async (request) => {
  const actor = requireReviewer(request);
  const data = request.data || {};
  return addValidationLabel({
    segmentId: requireString(data.segmentId, 'segmentId', { max: 120 }),
    trueStatus: requireString(data.trueStatus, 'trueStatus', { max: 40 }),
    trueBarriers: Array.isArray(data.trueBarriers) ? data.trueBarriers.slice(0, 12) : [],
    notes: data.notes || '',
    actor
  });
});

export const getValidation = onCall({ ...CALLABLE_OPTS }, async (request) => {
  requireReviewer(request);
  const regionId = request.data?.regionId || DEFAULT_REGION.id;
  const [metrics, targets] = await Promise.all([
    computeValidationMetrics(regionId),
    suggestValidationTargets(regionId, 20)
  ]);
  return { metrics, targets };
});

// ===========================================================================
// MUNICIPALITY ADMIN
// ===========================================================================

export const adminOverview = onCall({
  ...CALLABLE_OPTS, timeoutSeconds: 120,
  // Bound purely so the status check can read them: `defineSecret().value()`
  // resolves only inside a function that declares the secret, so a function
  // that merely *asks whether* a secret exists must declare it too, or it
  // will always answer no.
  secrets: [MAPILLARY_ACCESS_TOKEN, GEMINI_API_KEY]
}, async (request) => {
  requireMunicipalityAdmin(request);
  const regionId = request.data?.regionId || DEFAULT_REGION.id;
  const [stats, usage] = await Promise.all([computeOverviewStats(regionId), getUsage()]);
  return {
    ...stats,
    aiUsage: usage,
    integrations: { mapillary: isMapillaryConfigured(), gemini: isGeminiConfigured() }
  };
});

export const adminCoverage = onCall({ ...CALLABLE_OPTS, timeoutSeconds: 120 }, async (request) => {
  requireMunicipalityAdmin(request);
  return computeCoverage(request.data?.regionId || DEFAULT_REGION.id);
});

export const updateIssueStatus = onCall({ ...CALLABLE_OPTS, timeoutSeconds: 120 }, async (request) => {
  const actor = requireReviewer(request);
  return updateIssue({
    issueId: requireString(request.data?.issueId, 'issueId', { max: 160 }),
    patch: request.data?.patch || {},
    actor
  });
});

export const getConfiguration = onCall({ ...CALLABLE_OPTS }, async (request) => {
  requireMunicipalityAdmin(request);
  return getEffectiveConfig();
});

export const setConfiguration = onCall({ ...CALLABLE_OPTS }, async (request) => {
  const actor = requireMunicipalityAdmin(request);
  return updateConfig({ values: request.data?.values || {}, actor });
});

export const getAiUsage = onCall({ ...CALLABLE_OPTS }, async (request) => {
  requireMunicipalityAdmin(request);
  const days = Math.min(Number(request.data?.days) || 14, 60);
  const snap = await db.collection(COLLECTIONS.aiUsage).orderBy('day', 'desc').limit(days).get();
  return {
    today: await getUsage(),
    history: snap.docs.map((d) => {
      const v = d.data();
      return { day: v.day, calls: v.calls || 0, cached: v.cached || 0, failed: v.failed || 0, limit: v.limit || null };
    })
  };
});

export const estimateAnalysis = onCall({ ...CALLABLE_OPTS, timeoutSeconds: 120 }, async (request) => {
  requireMunicipalityAdmin(request);
  const regionId = request.data?.regionId || DEFAULT_REGION.id;
  const [estimate, usage] = await Promise.all([estimateAnalysisCost(regionId), getUsage()]);
  return {
    ...estimate,
    perJobLimit: MAX_AI_ANALYSES_PER_JOB,
    dailyBudget: usage,
    willAnalyse: Math.min(estimate.frames, MAX_AI_ANALYSES_PER_JOB, usage.remaining)
  };
});

export const generateExport = onCall({ ...CALLABLE_OPTS, timeoutSeconds: 300, memory: '1GiB' }, async (request) => {
  const actor = requireMunicipalityAdmin(request);
  const regionId = request.data?.regionId || DEFAULT_REGION.id;
  const kind = requireOneOf(request.data?.kind, ['issues', 'reports', 'coverage', 'segments'], 'kind');

  switch (kind) {
    case 'issues': return exportIssuesCsv(regionId, actor);
    case 'reports': return exportReportsCsv(regionId, actor);
    case 'coverage': return exportCoverageCsv(regionId, actor);
    case 'segments': return exportSegmentsGeoJson(regionId, actor);
    default: throw new HttpsError('invalid-argument', 'Unknown export type.');
  }
});

// ===========================================================================
// JOB CONTROL
// ===========================================================================

export const startIngestionJob = onCall({
  ...CALLABLE_OPTS, timeoutSeconds: 120,
  // Declared so the `isMapillaryConfigured()` precondition below can actually
  // see the secret. Without it the check always failed and discovery could
  // never be started, however correctly the secret was configured.
  secrets: [MAPILLARY_ACCESS_TOKEN]
}, async (request) => {
  const actor = requireMunicipalityAdmin(request);
  const data = request.data || {};
  const type = requireOneOf(data.type,
    ['import_osm', 'discover_mapillary', 'recalculate', 'rebuild_graph', 'publish_bundle'], 'type');

  const regionId = requireString(data.regionId, 'regionId', { max: 80 });
  const params = { regionId, actor: { uid: actor.uid, role: actor.role, email: actor.email } };

  if (type === 'import_osm' || type === 'discover_mapillary') {
    params.bbox = requireBbox(data.bbox);
  }
  if (type === 'import_osm') {
    params.regionName = data.regionName ? requireString(data.regionName, 'regionName', { max: 120 }) : regionId;
  }
  if (type === 'discover_mapillary' && !isMapillaryConfigured()) {
    throw new HttpsError('failed-precondition',
      'MAPILLARY_ACCESS_TOKEN is not configured. Add it to Secret Manager and redeploy before discovering imagery.');
  }

  const ref = await createJob('ingestion', {
    type, regionId, params, createdBy: actor.uid
  });

  await writeAudit({
    actor, action: AuditAction.JOB_STARTED, targetType: 'ingestionJob', targetId: ref.id,
    next: { type, regionId }
  });

  return { jobId: ref.id, kind: 'ingestion', type, status: JobStatus.QUEUED };
});

export const startAnalysisJob = onCall({
  ...CALLABLE_OPTS, timeoutSeconds: 120,
  // Same reason as startIngestionJob: the precondition reads the secret.
  secrets: [GEMINI_API_KEY]
}, async (request) => {
  const actor = requireMunicipalityAdmin(request);
  const data = request.data || {};

  if (!isGeminiConfigured()) {
    throw new HttpsError('failed-precondition',
      'GEMINI_API_KEY is not configured. Add it to Secret Manager and redeploy before running analysis.');
  }
  await assertNoConcurrentAiJob();

  const regionId = requireString(data.regionId, 'regionId', { max: 80 });
  const limit = data.limit !== undefined
    ? requireNumber(data.limit, 'limit', { min: 1, max: MAX_AI_ANALYSES_PER_JOB })
    : MAX_AI_ANALYSES_PER_JOB;

  const usage = await getUsage();
  assert(usage.remaining > 0, `The daily AI budget is spent (${usage.reserved}/${usage.limit}). Try again tomorrow, or raise the limit in Settings.`, 'resource-exhausted');

  const ref = await createJob('analysis', {
    type: 'analyze_imagery',
    regionId,
    params: {
      regionId,
      limit,
      segmentIds: Array.isArray(data.segmentIds) ? data.segmentIds.slice(0, 200) : null,
      forceReanalysis: Boolean(data.forceReanalysis),
      actor: { uid: actor.uid, role: actor.role, email: actor.email }
    },
    createdBy: actor.uid
  });

  await writeAudit({
    actor, action: AuditAction.JOB_STARTED, targetType: 'analysisJob', targetId: ref.id,
    next: { regionId, limit, forceReanalysis: Boolean(data.forceReanalysis) }
  });

  return { jobId: ref.id, kind: 'analysis', status: JobStatus.QUEUED, dailyBudget: usage };
});

export const cancelJob = onCall({ ...CALLABLE_OPTS }, async (request) => {
  const actor = requireMunicipalityAdmin(request);
  const jobId = requireString(request.data?.jobId, 'jobId', { max: 120 });
  const kind = requireOneOf(request.data?.kind, ['ingestion', 'analysis'], 'kind');
  const collection = kind === 'analysis' ? COLLECTIONS.analysisJobs : COLLECTIONS.ingestionJobs;

  const ref = db.collection(collection).doc(jobId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'That job no longer exists.');
  if ([JobStatus.COMPLETED, JobStatus.FAILED].includes(snap.data().status)) {
    throw new HttpsError('failed-precondition', 'That job has already finished.');
  }

  await ref.set({ status: JobStatus.CANCELLED, finishedAt: serverTimestamp(), message: 'Cancelled by an administrator.' }, { merge: true });
  await writeAudit({ actor, action: AuditAction.JOB_CANCELLED, targetType: `${kind}Job`, targetId: jobId });
  return { jobId, status: JobStatus.CANCELLED };
});

// ===========================================================================
// JOB WORKERS (Firestore-triggered, so they get their own time budget)
// ===========================================================================

export const onIngestionJobCreated = onDocumentCreated(
  { document: 'ingestionJobs/{jobId}', ...JOB_OPTS, secrets: [MAPILLARY_ACCESS_TOKEN] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const job = snap.data();
    if (job.status !== JobStatus.QUEUED) return;

    const ref = snap.ref;
    const params = job.params || {};

    switch (job.type) {
      case 'import_osm': return void await runOsmImport(ref, params);
      case 'discover_mapillary': return void await runMapillaryDiscovery(ref, params);
      case 'recalculate': return void await runRecalculation(ref, params);
      case 'rebuild_graph': return void await runGraphRebuild(ref, params);
      case 'publish_bundle': return void await runBundlePublish(ref, params);
      default:
        await ref.set({ status: JobStatus.FAILED, message: `Unknown job type "${job.type}".` }, { merge: true });
    }
  }
);

export const onAnalysisJobCreated = onDocumentCreated(
  { document: 'analysisJobs/{jobId}', ...AI_JOB_OPTS, secrets: [GEMINI_API_KEY, MAPILLARY_ACCESS_TOKEN] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const job = snap.data();
    if (job.status !== JobStatus.QUEUED) return;
    await runImageryAnalysis(snap.ref, job.params || {});
  }
);

/**
 * Keep a segment's priority in step with its assessment without needing a
 * full region sweep after every small change.
 */
export const onVerificationRecorded = onDocumentCreated(
  { document: 'verificationEvents/{eventId}', ...JOB_OPTS, timeoutSeconds: 120, memory: '512MiB' },
  async (event) => {
    const data = event.data?.data();
    if (!data?.segmentId || !data.regionId) return;
    await recomputePriorityForSegment(data.regionId, data.segmentId).catch(() => null);
  }
);

export { Role };
