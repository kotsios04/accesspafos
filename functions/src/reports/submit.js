/**
 * Citizen report submission.
 *
 * Design commitment: a report does NOT change the map. It is evidence that a
 * human being will look at. Anyone can file one, which means anyone could
 * file a false one, and a system where one anonymous tap turns a street red
 * would be trivially abusable and would deserve to be distrusted.
 *
 * What a report does immediately: get attached to the right pedestrian
 * segment, get checked against nearby open reports for duplicates, and, if it
 * carries a photograph, get that photograph analysed so a reviewer sees the
 * structured findings alongside the picture.
 */

import { HttpsError } from 'firebase-functions/v2/https';
import { db, serverTimestamp, bucket } from '../lib/firebase.js';
import { COLLECTIONS } from '../config/index.js';
import { ReportCategory, ReportStatus, REPORT_CATEGORIES, SourceType } from '../shared/constants.js';
import { geohash } from '../shared/geo.js';
import { findDuplicateCandidates } from '../shared/duplicates.js';
import { matchPointToSegment } from '../routing/service.js';
import { DEFAULT_REGION, MAX_REPORT_DESCRIPTION_CHARS, DUPLICATE_RADIUS_M, DUPLICATE_WINDOW_DAYS } from '../shared/config.js';
import { isGeminiConfigured } from '../ai/genkit.js';

/**
 * Loaded on first use, not imported: `ai/analyze.js` pulls in genkit and its
 * Zod schema, and report submission must not carry that graph into its cold
 * start - nor into the Firebase CLI's ten-second function discovery budget.
 */
let analyzeFn = null;
async function analyzeStreetAccessibility(input) {
  if (!analyzeFn) ({ analyzeStreetAccessibility: analyzeFn } = await import('../ai/analyze.js'));
  return analyzeFn(input);
}
import { normalizeObservation } from '../shared/observationSchema.js';

/**
 * @param {Object} input
 * @param {string} input.category
 * @param {{lat:number,lng:number}} input.location
 * @param {string} [input.description]
 * @param {string} [input.photoPath]   Cloud Storage object path already uploaded by the client
 * @param {string} [input.regionId]
 * @param {string} input.reporterUid
 * @param {string} [input.locale]
 */
export async function submitReport(input) {
  if (!REPORT_CATEGORIES.includes(input.category)) {
    throw new HttpsError('invalid-argument', 'Unknown report category.');
  }

  const regionId = input.regionId || DEFAULT_REGION.id;
  const point = [input.location.lng, input.location.lat];

  // --- attach to a pedestrian segment ------------------------------------
  let match = null;
  try {
    match = await matchPointToSegment(regionId, point);
  } catch {
    // A region without an imported graph still accepts reports; they simply
    // arrive unattached and a reviewer places them.
    match = null;
  }

  const ref = db.collection(COLLECTIONS.citizenReports).doc();
  const report = {
    id: ref.id,
    regionId,
    category: input.category,
    description: (input.description || '').slice(0, MAX_REPORT_DESCRIPTION_CHARS),
    location: { lat: input.location.lat, lng: input.location.lng },
    geohash: geohash(input.location.lng, input.location.lat, 8),
    segmentId: match?.segmentId || null,
    segmentDistanceMeters: match?.distanceMeters ?? null,
    streetName: match?.streetName || null,
    photoPath: input.photoPath || null,
    hasPhoto: Boolean(input.photoPath),
    reporterUid: input.reporterUid,
    reporterLocale: input.locale || 'en',
    status: ReportStatus.PENDING,
    aiAnalysis: null,
    duplicateCandidates: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  // --- duplicate suggestions ---------------------------------------------
  // Suggestions for the reviewer, not a precondition for accepting evidence.
  // This query needs a composite index on (regionId, geohash); without it
  // Firestore throws FAILED_PRECONDITION, and because nothing caught that throw
  // it reached the browser as a bare HTTP 500 - a citizen standing at a blocked
  // kerb was told "Something went wrong" and their report was thrown away, over
  // a reviewer convenience. It fails soft now, exactly as the segment match
  // above already does.
  try {
    const candidates = await findNearbyOpenReports(regionId, input.location);
    report.duplicateCandidates = findDuplicateCandidates(
      { ...report, createdAt: Date.now() },
      candidates
    );
  } catch (error) {
    console.error('submitReport: duplicate scan failed, storing report anyway', error);
    report.duplicateCandidates = [];
  }

  await ref.set(report);

  // --- optional photo analysis -------------------------------------------
  // Analysed for the reviewer's benefit only. It never touches the segment's
  // assessment until a human verifies the report.
  if (input.photoPath && isGeminiConfigured()) {
    analyseReportPhoto(ref.id, input.photoPath, {
      segmentKind: null,
      streetName: match?.streetName || null
    }).catch(() => { /* failures are recorded on the document itself */ });
  }

  return {
    id: ref.id,
    status: report.status,
    segmentId: report.segmentId,
    duplicateCandidates: report.duplicateCandidates,
    message: 'report.submitted'
  };
}

/** Open reports nearby, for the duplicate check. */
export async function findNearbyOpenReports(regionId, location, { radiusM = DUPLICATE_RADIUS_M, windowDays = DUPLICATE_WINDOW_DAYS } = {}) {
  // Geohash prefix gives a cheap bounding filter; exact distances are then
  // computed in `findDuplicateCandidates`.
  const prefix = geohash(location.lng, location.lat, 6);
  const since = new Date(Date.now() - windowDays * 86400000);

  const snap = await db.collection(COLLECTIONS.citizenReports)
    .where('regionId', '==', regionId)
    .where('geohash', '>=', prefix)
    .where('geohash', '<=', `${prefix}`)
    .limit(60)
    .get();

  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => {
      const created = r.createdAt?.toDate?.();
      return !created || created >= since;
    })
    .map((r) => ({
      id: r.id,
      category: r.category,
      location: r.location,
      createdAt: r.createdAt?.toMillis?.() ?? null,
      status: r.status,
      segmentId: r.segmentId
    }));
}

/**
 * Run the vision analysis over a citizen photograph and attach the structured
 * result to the report for the reviewer.
 */
export async function analyseReportPhoto(reportId, photoPath, context = {}) {
  const ref = db.collection(COLLECTIONS.citizenReports).doc(reportId);
  try {
    // Read the bytes straight out of the bucket rather than signing a URL and
    // fetching it back over the public internet.
    //
    // Signing needs the IAM signBlob API, because a Cloud Run instance holds no
    // private key - so this path could fail with a permission error over a file
    // the Admin SDK was always allowed to read directly. It also sent the image
    // out to the internet and pulled it back in, for no reason: a signed URL
    // exists so a *browser* can fetch an object, and there is no browser here.
    //
    // getReportPhotoUrl still signs, and should: that one really is handing a
    // URL to a reviewer's browser.
    const file = bucket().file(photoPath);
    const [[buffer], [metadata]] = await Promise.all([file.download(), file.getMetadata()]);

    const result = await analyzeStreetAccessibility({
      imageDataUrl: `data:${metadata.contentType || 'image/jpeg'};base64,${buffer.toString('base64')}`,
      context
    });

    // `update` rather than `set(..., { merge: true })`, and this is the whole
    // point of the change: merge DEEP-merges a nested map, so writing a
    // successful reading over a failed one left the old `error` key sitting
    // beside the new `observation`. aiPanel tests `error` first and returns
    // early, so the reviewer went on seeing a stale failure over a perfectly
    // good result, and every retry looked like it had done nothing at all.
    // `update` replaces the field outright, so each reading is whole and only
    // the newest one is on the document.
    await ref.update({
      aiAnalysis: result.ok
        ? {
          observation: normalizeObservation(result.observation),
          model: result.model,
          analysisVersion: result.analysisVersion,
          warnings: result.warnings,
          analysedAt: serverTimestamp(),
          sourceType: SourceType.CITIZEN
        }
        : { error: result.error, model: result.model, analysedAt: serverTimestamp() },
      updatedAt: serverTimestamp()
    });

    return result;
  } catch (error) {
    // Same reasoning in reverse: a failure must not leave the previous
    // observation lying underneath it. Wrapped so that a write problem here
    // cannot swallow the error we are actually trying to report.
    try {
      await ref.update({
        aiAnalysis: { error: String(error).slice(0, 300), analysedAt: serverTimestamp() },
        updatedAt: serverTimestamp()
      });
    } catch (writeError) {
      console.error('analyseReportPhoto: could not record the failure', writeError);
    }
    throw error;
  }
}

export { ReportCategory, ReportStatus };
