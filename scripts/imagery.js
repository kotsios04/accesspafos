#!/usr/bin/env node
/**
 * Imagery discovery and AI analysis from the command line.
 *
 * The console can do all of this, but the console runs inside a Cloud
 * Function with a 9-minute ceiling and a deploy in front of it. This runs the
 * *same* job code against the same production Firestore, so a run can be
 * scoped tightly, watched, and stopped — which is what you want when the last
 * step is the only one that spends money.
 *
 *   node scripts/imagery.js discover --region kato-pafos --bbox 32.41,34.752,32.428,34.762
 *   node scripts/imagery.js estimate --region kato-pafos
 *   node scripts/imagery.js estimate --region kato-pafos --bbox 32.41,34.752,32.428,34.762
 *   node scripts/imagery.js analyse  --region kato-pafos --bbox ... --limit 40
 *   node scripts/imagery.js analyse  --region kato-pafos --limit 40 --yes
 *   node scripts/imagery.js publish  --region kato-pafos
 *   node scripts/imagery.js usage [--release]
 *   node scripts/imagery.js audit    # is every analysed segment actually evidenced?
 *   node scripts/imagery.js relink   # attach evidence that is already paid for
 *
 * `recalculate`, `rebuild-graph` and `publish` are the same maintenance jobs
 * the console runs. Publish after an analysis run: the public map reads a
 * published snapshot, so new scores are invisible until it is rebuilt.
 *
 * `analyse` refuses to run without --yes. Every other command is free.
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS, MAPILLARY_ACCESS_TOKEN and
 * GEMINI_API_KEY in .env (see secrets/README.md).
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) { args._.push(token); continue; }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i += 1; }
  }
  return args;
}

function loadEnv() {
  const path = resolve(root, '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (!process.env[key]) process.env[key] = raw.replace(/^["']|["']$/g, '').trim();
  }
  // firebase-admin wants an absolute path; .env holds a repo-relative one.
  const creds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (creds && !existsSync(creds) && existsSync(resolve(root, creds))) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = resolve(root, creds);
  }
}

function parseBbox(value) {
  if (!value || value === true) return null;
  const parts = String(value).split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`--bbox must be four numbers "west,south,east,north", got "${value}"`);
  }
  const [w, s, e, n] = parts;
  if (w >= e || s >= n) throw new Error('--bbox must be west<east and south<north');
  return [w, s, e, n];
}

const fn = (path) => import(pathToFileURL(join(root, 'functions', 'src', path)).href);

const ACTOR = { uid: 'cli', email: process.env.OSM_CONTACT_EMAIL || 'cli', role: 'super_admin', via: 'scripts/imagery.js' };

/**
 * Create a job document that the deployed trigger will NOT pick up.
 *
 * `onIngestionJobCreated` / `onAnalysisJobCreated` fire on document creation
 * and bail out unless the new document is QUEUED. A job created here is
 * already RUNNING, because this process is the runner - otherwise the same
 * work would execute twice: once locally and once in the cloud, doubling the
 * Mapillary calls and the AI spend.
 */
async function createLocalJob(kind, payload) {
  const [{ db, serverTimestamp }, { COLLECTIONS }, { JobStatus }] = await Promise.all([
    fn('lib/firebase.js'), fn('config/index.js'), fn('shared/constants.js')
  ]);
  const collection = kind === 'analysis' ? COLLECTIONS.analysisJobs : COLLECTIONS.ingestionJobs;
  const ref = db.collection(collection).doc();
  await ref.set({
    id: ref.id,
    kind,
    type: payload.type,
    regionId: payload.regionId || null,
    status: JobStatus.RUNNING,
    runner: 'cli',
    processed: 0,
    total: payload.total ?? null,
    succeeded: 0,
    skipped: 0,
    errors: [],
    errorCount: 0,
    params: payload.params || {},
    createdBy: payload.createdBy || null,
    createdAt: serverTimestamp(),
    startedAt: serverTimestamp(),
    finishedAt: null,
    message: 'Started from scripts/imagery.js'
  });
  return ref;
}

/** Segment IDs whose geometry intersects a bbox padded by the search radius. */
async function segmentIdsInBbox(regionId, bbox) {
  const [{ db }, { COLLECTIONS }, geo, { decodeSegment }, config] = await Promise.all([
    fn('lib/firebase.js'), fn('config/index.js'), fn('shared/geo.js'),
    fn('shared/geometry.js'), fn('shared/config.js')
  ]);
  const padded = geo.padBbox(bbox, config.MAPILLARY_SEARCH_RADIUS_M);
  const snap = await db.collection(COLLECTIONS.segments).where('regionId', '==', regionId).get();
  const ids = [];
  for (const doc of snap.docs) {
    const segment = decodeSegment(doc.data());
    if (!segment.geometry?.length) continue;
    if (geo.bboxIntersects(padded, geo.bboxOf(segment.geometry))) ids.push(doc.id);
  }
  return { ids, regionTotal: snap.size };
}

async function watch(ref, label) {
  const { JobStatus } = await fn('shared/constants.js');
  let last = '';
  for (;;) {
    const snap = await ref.get();
    const d = snap.data() || {};
    const line = `${label} ${d.status} ${d.processed ?? 0}/${d.total ?? '?'}` +
      (d.message ? ` — ${d.message}` : '');
    if (line !== last) { console.log(line); last = line; }
    if ([JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED].includes(d.status)) return d;
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const regionId = args.region || 'kato-pafos';
  const bbox = parseBbox(args.bbox);

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS is not set (see secrets/README.md).');
  }

  if (command === 'discover') {
    if (!bbox) throw new Error('discover needs --bbox west,south,east,north');
    const { isMapillaryConfigured } = await fn('mapillary/client.js');
    if (!isMapillaryConfigured()) throw new Error('MAPILLARY_ACCESS_TOKEN is not set in .env');
    const geo = await fn('shared/geo.js');
    console.log(`Region ${regionId}, search box ${bbox.join(',')} (${geo.bboxAreaKm2(bbox).toFixed(2)} km²)`);

    const { runMapillaryDiscovery } = await fn('jobs/discoverMapillary.js');
    const ref = await createLocalJob('ingestion', {
      type: 'discover_mapillary', regionId, createdBy: ACTOR.uid, params: { bbox }
    });
    const run = runMapillaryDiscovery(ref, { regionId, bbox, actor: ACTOR });
    const [result] = await Promise.all([run, watch(ref, 'discovery')]);
    console.log('\nResult:', JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'estimate') {
    const { estimateAnalysisCost } = await fn('jobs/discoverMapillary.js');
    const whole = await estimateAnalysisCost(regionId);
    console.log(`Region ${regionId}: ${whole.segments} segment(s) with unanalysed frames, ${whole.frames} frame(s) → ${whole.estimatedAiCalls} AI call(s).`);

    if (bbox) {
      const { ids } = await segmentIdsInBbox(regionId, bbox);
      const scoped = await framesForSegments(regionId, ids);
      console.log(`Inside --bbox: ${scoped.segments} segment(s), ${scoped.frames} frame(s) → ${scoped.frames} AI call(s).`);
    }

    const { MAX_AI_ANALYSES_PER_JOB, MAX_AI_ANALYSES_PER_DAY, AI_MODEL } = await fn('shared/config.js');
    console.log(`Caps: ${MAX_AI_ANALYSES_PER_JOB}/job, ${MAX_AI_ANALYSES_PER_DAY}/day, model ${AI_MODEL}.`);
    return;
  }

  if (command === 'analyse' || command === 'analyze') {
    const limit = Number(args.limit || 25);
    if (!Number.isFinite(limit) || limit < 1) throw new Error('--limit must be a positive number');

    let segmentIds = null;
    if (bbox) {
      const { ids } = await segmentIdsInBbox(regionId, bbox);
      segmentIds = ids;
      console.log(`Scoped to ${ids.length} segment(s) inside ${bbox.join(',')}.`);
    }

    const scoped = await framesForSegments(regionId, segmentIds);
    const willRun = Math.min(limit, scoped.frames);
    console.log(`${scoped.frames} unanalysed frame(s) available; --limit ${limit} → up to ${willRun} AI call(s) this run.`);

    if (!args.yes) {
      console.log('\nRefusing to spend without --yes. Re-run with --yes to start.');
      return;
    }

    const { runImageryAnalysis } = await fn('jobs/analyzeImagery.js');
    const ref = await createLocalJob('analysis', {
      type: 'analyze_imagery', regionId, createdBy: ACTOR.uid, params: { limit, segmentIds: segmentIds ? segmentIds.length : null }
    });
    const run = runImageryAnalysis(ref, { regionId, limit, segmentIds, actor: ACTOR });
    const [result] = await Promise.all([run, watch(ref, 'analysis')]);
    console.log('\nResult:', JSON.stringify(result, null, 2));
    return;
  }

  // `audit` answers one question: does every segment we marked analysed
  // actually have evidence attached to it? `relink` repairs the ones that do
  // not, from the frame list each segment already stores.
  if (command === 'audit' || command === 'relink') {
    const [{ db }, { COLLECTIONS }, { ImageryStatus }, obs, { SourceType }, config] = await Promise.all([
      fn('lib/firebase.js'), fn('config/index.js'), fn('jobs/discoverMapillary.js'),
      fn('ai/observations.js'), fn('shared/constants.js'), fn('shared/config.js')
    ]);

    const obsSnap = await db.collection(COLLECTIONS.observations).get();
    let active = 0; let failedDocs = 0; let missingLinks = 0;
    const linkedTo = new Map(); // observationId -> Set(segmentId)
    for (const doc of obsSnap.docs) {
      const d = doc.data();
      if (d.status === 'failed') { failedDocs += 1; continue; }
      active += 1;
      const ids = Array.isArray(d.segmentIds) ? d.segmentIds : (d.segmentId ? [d.segmentId] : []);
      if (!Array.isArray(d.segmentIds)) missingLinks += 1;
      linkedTo.set(doc.id, new Set(ids));
    }

    const segSnap = await db.collection(COLLECTIONS.segments)
      .where('regionId', '==', regionId)
      .where('imagery.status', '==', ImageryStatus.ANALYSED).get();

    const repairs = [];
    let analysedFrames = 0;
    const segmentsWithEvidence = new Set();
    for (const doc of segSnap.docs) {
      for (const frame of (doc.data().imagery?.selected || [])) {
        if (!frame.analysed) continue;
        analysedFrames += 1;
        const obsId = obs.observationDocId({
          sourceType: SourceType.MAPILLARY, sourceId: frame.imageId,
          analysisVersion: config.ANALYSIS_VERSION, model: config.AI_MODEL
        });
        const linked = linkedTo.get(obsId);
        if (!linked) continue;               // no observation (a failed frame)
        if (linked.has(doc.id)) segmentsWithEvidence.add(doc.id);
        else repairs.push({ obsId, segmentId: doc.id, imageId: frame.imageId });
      }
    }

    const orphaned = segSnap.size - segmentsWithEvidence.size;
    console.log(`Observations:            ${obsSnap.size} (${active} active, ${failedDocs} failed)`);
    console.log(`  without segmentIds:    ${missingLinks}  (written before the array existed)`);
    console.log(`Segments marked analysed: ${segSnap.size}`);
    console.log(`  with evidence linked:   ${segmentsWithEvidence.size}`);
    console.log(`  WITH NONE:              ${orphaned}`);
    console.log(`Analysed frames:          ${analysedFrames}`);
    console.log(`Missing frame→segment links: ${repairs.length}`);

    if (command === 'audit') {
      if (repairs.length) console.log('\nRun `relink` to attach the evidence that is already paid for.');
      return;
    }

    if (!repairs.length) {
      // The links may already be in place from a run whose recompute failed -
      // re-deriving is cheap and idempotent, so do it rather than assume.
      console.log('\nNothing to link. Re-deriving assessments anyway.');
      await recomputeAll(segSnap.docs.map((d) => d.id));
      return;
    }

    const { commitInBatches } = await fn('lib/firebase.js');
    const { FieldValue } = await fn('lib/firebase.js');
    await commitInBatches(repairs.map((r) => ({
      type: 'set',
      ref: db.collection(COLLECTIONS.observations).doc(r.obsId),
      data: { segmentIds: FieldValue.arrayUnion(r.segmentId) },
      options: { merge: true }
    })));
    console.log(`\nLinked ${repairs.length} observation→segment pair(s).`);

    // Backfill segmentIds on documents written before the array existed, so
    // the array-contains query sees them at all.
    const backfill = obsSnap.docs
      .filter((d) => !Array.isArray(d.data().segmentIds) && d.data().segmentId)
      .map((d) => ({
        type: 'set',
        ref: d.ref,
        data: { segmentIds: FieldValue.arrayUnion(String(d.data().segmentId)) },
        options: { merge: true }
      }));
    if (backfill.length) {
      await commitInBatches(backfill);
      console.log(`Backfilled segmentIds on ${backfill.length} older observation(s).`);
    }

    await recomputeAll(segSnap.docs.map((d) => d.id));
    return;
  }

  if (command === 'usage') {
    const { getUsage, releaseAiCalls } = await fn('lib/quota.js');
    const before = await getUsage();
    console.log('Today:', JSON.stringify(before, null, 2));

    // A job that is killed mid-run (Ctrl+C, a crashed process) never reaches
    // its release step, so its reservation is held for the rest of the day
    // against work that will never happen. `reserved` above will exceed
    // `calls + failed` when that has happened.
    const leaked = before.reserved - (before.calls + before.failed);
    if (leaked > 0) {
      console.log(`\n${leaked} reservation(s) are held by a run that never finished.`);
      if (args.release) {
        await releaseAiCalls(leaked);
        console.log('Released. Now:', JSON.stringify(await getUsage(), null, 2));
      } else {
        console.log('Re-run with --release to hand them back.');
      }
    }
    return;
  }

  // Maintenance, so the whole pipeline can be driven from here. Analysis
  // re-assesses the segments it touched, but the published bundle the public
  // map downloads is a snapshot: without a republish the new colours never
  // reach anyone.
  const MAINTENANCE = {
    recalculate: ['runRecalculation', 'recalculate'],
    'rebuild-graph': ['runGraphRebuild', 'rebuild_graph'],
    publish: ['runBundlePublish', 'publish_bundle']
  };
  if (MAINTENANCE[command]) {
    const [fnName, jobType] = MAINTENANCE[command];
    const mod = await fn('jobs/maintenance.js');
    const ref = await createLocalJob('ingestion', { type: jobType, regionId, createdBy: ACTOR.uid });
    const run = mod[fnName](ref, { regionId, actor: ACTOR });
    const [result] = await Promise.all([run, watch(ref, command)]);
    console.log('\nResult:', JSON.stringify(result, null, 2));
    return;
  }

  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 32).join('\n'));
  process.exitCode = 1;
}

/**
 * Re-derive assessments for a set of segments.
 *
 * Stops at the first missing-index error instead of repeating it once per
 * segment. A precondition that is false for one segment is false for all of
 * them, and a hundred identical stack traces bury the one line that says what
 * to do about it.
 */
async function recomputeAll(segmentIds) {
  console.log(`\nRe-assessing ${segmentIds.length} segment(s)…`);
  const { recomputeSegment } = await fn('scoring/apply.js');
  let done = 0;
  for (const id of segmentIds) {
    try {
      await recomputeSegment(id);
      done += 1;
    } catch (error) {
      const message = error?.message || String(error);
      if (/FAILED_PRECONDITION|requires an index/i.test(message)) {
        console.error('\nStopped: the observations index does not exist yet.\n');
        console.error('  firebase deploy --only firestore:indexes\n');
        console.error('Building takes a few minutes; the Firestore console shows it as');
        console.error('"Building" and then "Enabled". Re-run this command once it is enabled.');
        console.error(`\nFirestore said: ${message.split('You can create it here:')[0].trim()}`);
        process.exitCode = 1;
        return;
      }
      console.log(`  ! ${id}: ${message}`);
    }
  }
  console.log(`Re-assessed ${done}. Now run: node scripts/imagery.js publish`);
}

/** Count unanalysed selected frames, optionally restricted to given segments. */
async function framesForSegments(regionId, segmentIds) {
  const [{ db }, { COLLECTIONS }, { ImageryStatus }] = await Promise.all([
    fn('lib/firebase.js'), fn('config/index.js'), fn('jobs/discoverMapillary.js')
  ]);
  let docs;
  if (Array.isArray(segmentIds)) {
    docs = [];
    for (let i = 0; i < segmentIds.length; i += 300) {
      const refs = segmentIds.slice(i, i + 300).map((id) => db.collection(COLLECTIONS.segments).doc(id));
      docs.push(...(await db.getAll(...refs)).filter((s) => s.exists));
    }
  } else {
    const snap = await db.collection(COLLECTIONS.segments)
      .where('regionId', '==', regionId)
      .where('imagery.status', '==', ImageryStatus.SELECTED).get();
    docs = snap.docs;
  }
  let frames = 0; let segments = 0;
  for (const doc of docs) {
    const pending = (doc.data().imagery?.selected || []).filter((s) => !s.analysed);
    if (pending.length) { segments += 1; frames += pending.length; }
  }
  return { segments, frames };
}

main().then(() => process.exit(0)).catch((error) => {
  console.error('\n' + (error?.stack || error?.message || String(error)));
  process.exit(1);
});
