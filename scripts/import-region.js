#!/usr/bin/env node
/**
 * Import a Pafos region from the command line.
 *
 * The same ingestion the municipality console runs, available before any
 * Cloud Function is deployed — which matters, because you want real data on
 * the map to test against, and you should not have to deploy a backend to get
 * it.
 *
 *   npm run import-region -- --bbox 32.403,34.753,32.438,34.783 --id kato-pafos --name "Kato Pafos"
 *   npm run import-region -- --pilot            # the default Kato Pafos / Harbour box
 *   npm run import-region -- --pilot --dry-run  # fetch and report, write nothing
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS (see secrets/README.md).
 */

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const shared = (name) => import(pathToFileURL(join(root, 'shared', name)).href);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
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
    if (!process.env[key]) process.env[key] = raw.replace(/^["']|["']$/g, '');
  }
}

function initAdmin() {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (keyPath && existsSync(resolve(root, keyPath))) {
    const serviceAccount = JSON.parse(readFileSync(resolve(root, keyPath), 'utf8'));
    return initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
  }
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
  if (!projectId) {
    console.error('Set FIREBASE_PROJECT_ID in .env, or point GOOGLE_APPLICATION_CREDENTIALS at a service-account key.');
    process.exit(1);
  }
  return initializeApp({ credential: applicationDefault(), projectId });
}

const OVERPASS_HIGHWAYS =
  '^(footway|path|pedestrian|steps|living_street|track|corridor|residential|unclassified|service|tertiary|secondary|primary|road)$';

/**
 * Ask Overpass, with the retry and mirror behaviour the backend already has.
 *
 * This used to be a bare `fetch` with neither, so a single HTTP 504 from a
 * busy public instance ended the import - which is not an error worth failing
 * on: overpass-api.de returning 504 under load is an ordinary Tuesday for a
 * free community service. It borrows `fetchWithRetry` from the backend rather
 * than growing a third copy of the same idea, and keeps this script's own
 * query untouched.
 */
async function overpass(query, endpoint, userAgent) {
  const { fetchWithRetry } = await import(
    pathToFileURL(join(root, 'functions', 'src', 'lib', 'http.js')).href);
  const { OVERPASS_MIRRORS } = await shared('config.js');

  const endpoints = [endpoint, ...OVERPASS_MIRRORS.filter((m) => m !== endpoint)];
  let lastError = null;

  for (const url of endpoints) {
    const started = Date.now();
    try {
      if (url !== endpoint) process.stdout.write(`  asking ${new URL(url).host}… `);
      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': userAgent,
          Accept: 'application/json'
        },
        body: new URLSearchParams({ data: query }).toString(),
        // This query answers in a couple of seconds from a healthy instance.
        // The old 210 s allowance was sized for Overpass being legitimately
        // slow on a huge query, and here it only meant a dead mirror was
        // waited on in silence for three and a half minutes - long enough to
        // be indistinguishable from a hang, which is exactly the failure this
        // project keeps tripping over.
        timeoutMs: 60000,
        retries: 1,
        label: 'Overpass'
      });
      if (url !== endpoint) console.log(`ok in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        // Overpass reports rate limiting and query errors as HTML, not JSON.
        throw new Error('Overpass returned a non-JSON response (rate limited, or the query timed out).');
      }
    } catch (error) {
      lastError = error;
      const status = error?.status ?? 0;
      // Move on only when the instance is the problem. A bad query fails the
      // same way everywhere, and asking three free servers in turn would just
      // be rude about it.
      if (![0, 408, 429, 500, 502, 503, 504].includes(status)) throw error;
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`${url === endpoint ? '  ' : ''}${new URL(url).host} answered ${status || 'nothing'} after ${secs}s` +
        (url === endpoints[endpoints.length - 1] ? '' : '; trying the next mirror…'));
    }
  }
  throw lastError;
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); return; }

  const { DEFAULT_REGION, MAX_IMPORT_AREA_KM2, MAX_SEGMENT_LENGTH_M } = await shared('config.js');
  const { bboxAreaKm2, haversineMeters } = await shared('geo.js');
  const { assessSegment } = await shared('assess.js');
  const { packGeometry } = await shared('geometry.js');

  const bbox = args.bbox
    ? args.bbox.split(',').map(Number)
    : DEFAULT_REGION.bbox;
  const regionId = args.id || DEFAULT_REGION.id;
  const regionName = args.name || DEFAULT_REGION.name;

  if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n))) {
    console.error('--bbox must be west,south,east,north'); process.exit(1);
  }

  const area = bboxAreaKm2(bbox);
  console.log(`Region : ${regionName} (${regionId})`);
  console.log(`Bbox   : ${bbox.join(', ')}`);
  console.log(`Area   : ${area.toFixed(2)} km²`);
  if (area > MAX_IMPORT_AREA_KM2) {
    console.error(`\nThat is above the ${MAX_IMPORT_AREA_KM2} km² import limit. Use a smaller box.`);
    process.exit(1);
  }

  // parse.js lives with the functions, but imports only from shared/.
  const { parsePedestrianNetwork, analyseConnectivity } =
    await import(pathToFileURL(join(root, 'functions', 'src', 'osm', 'parse.js')).href);

  const endpoint = process.env.OVERPASS_ENDPOINT || 'https://overpass-api.de/api/interpreter';
  const contact = process.env.OSM_CONTACT_EMAIL || '';
  const userAgent = `AccessPafosAI/1.0 (Pafos 2.0 civic accessibility project${contact ? `; ${contact}` : ''})`;

  const [w, s, e, n] = bbox;
  const query = `[out:json][timeout:180];
(
  way["highway"~"${OVERPASS_HIGHWAYS}"](${s},${w},${n},${e});
);
out body meta;
>;
out skel qt;`;

  console.log(`\nQuerying Overpass (${endpoint})…`);
  const started = Date.now();
  const json = await overpass(query, endpoint, userAgent);
  console.log(`  ${json.elements.length} elements in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  const { nodes, segments, stats } = parsePedestrianNetwork(json, { regionId });
  const connectivity = analyseConnectivity(segments);

  console.log('\nParsed pedestrian network:');
  console.log(`  ways kept          : ${stats.waysKept} / ${stats.waysReceived}`);
  console.log(`  segments           : ${stats.segments}`);
  console.log(`  nodes              : ${stats.nodes} (${stats.weldedNodes} welded)`);
  console.log(`  total length       : ${(stats.totalLengthMeters / 1000).toFixed(2)} km`);
  console.log(`  connected components: ${connectivity.componentCount} ` +
    `(largest holds ${Math.round(connectivity.largestComponentShare * 100)}% of nodes)`);

  // Segment length is what decides whether three photographs can honestly
  // describe a segment, so the import reports it rather than leaving it to be
  // discovered later from the published bundle.
  const lengths = segments.map((x) => x.lengthMeters).sort((a, b) => a - b);
  const at = (q) => lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * q))];
  const over = segments.filter((x) => x.lengthMeters > MAX_SEGMENT_LENGTH_M);
  // An oversize segment is unavoidable when its own first span already exceeds
  // the limit: there is no vertex inside it to cut at. Counting "has only two
  // vertices" was the wrong test - a three-vertex stretch with a 300 m gap in
  // the middle is equally uncuttable, and was being reported as a splitter
  // failure.
  const unavoidable = over.filter((x) => haversineMeters(x.geometry[0], x.geometry[1]) > MAX_SEGMENT_LENGTH_M);

  console.log('\nSegment length:');
  console.log(`  median / p90 / max : ${at(0.5)} m / ${at(0.9)} m / ${lengths[lengths.length - 1]} m`);
  console.log(`  over the ${MAX_SEGMENT_LENGTH_M} m limit  : ${over.length} ` +
    `(${((over.length / segments.length) * 100).toFixed(1)}%)`);
  console.log(`  ...unavoidably so    : ${unavoidable.length} (no OSM vertex inside the limit to cut at)`);
  if (over.length > unavoidable.length) {
    console.log(`  ! ${over.length - unavoidable.length} oversize segment(s) COULD have been cut - the splitter missed them.`);
  }

  // An initial assessment from OSM tags alone. Most segments will be grey.
  const statusCounts = {};
  const assessed = segments.map((segment) => {
    const assessment = assessSegment({
      osmTags: segment.osmTags,
      osmTimestamp: segment.osmTimestamp,
      segmentKind: segment.kind
    });
    statusCounts[assessment.status] = (statusCounts[assessment.status] || 0) + 1;
    return { segment, assessment };
  });

  console.log('\nInitial assessment from OSM tags alone:');
  for (const [status, count] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status.padEnd(14)} ${count} (${((count / segments.length) * 100).toFixed(1)}%)`);
  }
  console.log('  Most segments being "unverified" here is expected and correct:');
  console.log('  OpenStreetMap rarely carries kerb, surface and width tags for a whole city.');

  if (args['dry-run']) {
    console.log('\n--dry-run: nothing written.');
    return;
  }

  initAdmin();
  const db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });

  console.log('\nWriting to Firestore…');
  await writeBatched(db, assessed.map(({ segment, assessment }) => ({
    ref: db.collection('segments').doc(segment.id),
    data: {
      ...segment,
      // Firestore refuses an array of arrays, and a LineString is exactly
      // that. Coordinates are stored flat - [lng,lat,lng,lat,...] - and
      // unpacked on read. `ingestOsm.js` has done this since the bug was
      // found; this script is the other write path and never got the fix.
      geometry: packGeometry(segment.geometry),
      assessment: {
        status: assessment.status,
        accessibilityScore: assessment.accessibilityScore,
        evidenceConfidence: assessment.evidenceConfidence,
        freshnessState: assessment.freshnessState,
        barriers: assessment.barriers,
        positiveFeatures: assessment.positiveFeatures,
        sources: assessment.sources,
        observationCount: 0,
        assessmentVersion: assessment.assessmentVersion,
        classificationReason: assessment.classificationReason
      },
      imagery: { imageCount: 0, status: 'not_searched', lastSearchedAt: null },
      manualVerification: null,
      importedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }
  })), 'segments');

  await writeBatched(db, assessed.map(({ segment, assessment }) => ({
    ref: db.collection('segmentAssessments').doc(segment.id),
    data: { segmentId: segment.id, regionId, ...assessment, assessedAt: FieldValue.serverTimestamp() }
  })), 'assessments');

  await writeBatched(db, nodes.map((node) => ({
    ref: db.collection('regions').doc(regionId).collection('nodes').doc(node.id),
    data: node
  })), 'nodes');

  await pruneStale(db, regionId, new Set(segments.map((x) => x.id)), new Set(nodes.map((n) => n.id)));

  await db.collection('regions').doc(regionId).set({
    id: regionId,
    name: regionName,
    bbox,
    areaKm2: Number(area.toFixed(2)),
    segmentCount: segments.length,
    nodeCount: nodes.length,
    totalLengthMeters: stats.totalLengthMeters,
    connectivity,
    lastImportedAt: FieldValue.serverTimestamp(),
    lastImportStats: stats,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  console.log('\nDone.');
  console.log('\nNext steps:');
  console.log('  1. Open /admin/ingestion and run "Rebuild routing graph" then "Publish map bundle".');
  console.log('     (Or deploy the functions and use the console for the whole pipeline.)');
  console.log('  2. Add MAPILLARY_ACCESS_TOKEN and GEMINI_API_KEY to run imagery discovery and analysis.');
}

/**
 * Find a nested array before Firestore does.
 *
 * Firestore rejects an array containing arrays with `3 INVALID_ARGUMENT:
 * Nested arrays are not allowed` and does not say which field. That message
 * has now cost this project two debugging sessions, so the check happens here,
 * once, with the path spelled out.
 */
function findNestedArray(value, path = '') {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      if (Array.isArray(value[i])) return `${path}[${i}]`;
      const deeper = findNestedArray(value[i], `${path}[${i}]`);
      if (deeper) return deeper;
    }
    return null;
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const [key, v] of Object.entries(value)) {
      const deeper = findNestedArray(v, path ? `${path}.${key}` : key);
      if (deeper) return deeper;
    }
  }
  return null;
}

async function writeBatched(db, operations, label, chunkSize = 400) {
  if (!operations.length) return;

  for (const op of operations) {
    if (op.delete) continue;
    const offender = findNestedArray(op.data);
    if (offender) {
      throw new Error(
        `Refusing to write ${label}: "${offender}" is an array of arrays, which Firestore rejects. `
        + 'Flatten it (see shared/geometry.js) before writing.'
      );
    }
  }

  for (let i = 0; i < operations.length; i += chunkSize) {
    const batch = db.batch();
    for (const op of operations.slice(i, i + chunkSize)) {
      if (op.delete) batch.delete(op.ref);
      else batch.set(op.ref, op.data, { merge: true });
    }
    await batch.commit();
    process.stdout.write(`\r  ${label}: ${Math.min(i + chunkSize, operations.length)}/${operations.length}`);
  }
  process.stdout.write(`\r  ${label}: ${operations.length}/${operations.length}\n`);
}

function usage() {
  console.log(`
Import a pedestrian network region from OpenStreetMap.

  npm run import-region -- --pilot
  npm run import-region -- --bbox <w,s,e,n> --id <region-id> --name "<name>"
  npm run import-region -- --pilot --dry-run

Options:
  --bbox     west,south,east,north (decimal degrees)
  --id       region identifier; re-importing the same id updates in place
  --name     human-readable region name
  --pilot    use the default Kato Pafos / Harbour bounding box
  --dry-run  fetch, parse and report without writing anything
`);
}

main().catch((error) => {
  console.error('\nImport failed:', error.message);
  process.exit(1);
});

/**
 * Remove segments, assessments and nodes this import did not produce.
 *
 * The import is the authority for a region's network. Skipping this was
 * harmless while segment ids were stable, because a re-import simply
 * overwrote the same documents. Length splitting changes the ids: a stretch
 * that was one segment becomes several with different names, and without a
 * prune the old one survives beside its own parts - every divided street drawn
 * twice on the map and counted twice in every length and coverage figure.
 *
 * Guarded, because "delete whatever the import did not produce" destroys a
 * region if the import itself was truncated. A run yielding fewer than half
 * the stored segments refuses and explains itself rather than acting.
 */
async function pruneStale(db, regionId, keepSegments, keepNodes) {
  const segSnap = await db.collection('segments').where('regionId', '==', regionId).get();
  const staleSegments = segSnap.docs.filter((d) => !keepSegments.has(d.id));

  if (staleSegments.length && keepSegments.size < segSnap.size / 2) {
    console.log(`\n  ! Refusing to remove ${staleSegments.length} stale segment(s).`);
    console.log(`    This import produced ${keepSegments.size}, fewer than half the ${segSnap.size} already stored,`);
    console.log('    which looks like a truncated import rather than a network that halved.');
    console.log('    Nothing was deleted. Check the Overpass response and re-run.');
    return;
  }

  const nodesRef = db.collection('regions').doc(regionId).collection('nodes');
  const nodeSnap = await nodesRef.get();
  const staleNodes = nodeSnap.docs.filter((d) => !keepNodes.has(d.id));

  if (!staleSegments.length && !staleNodes.length) {
    console.log('\n  nothing stale to remove.');
    return;
  }

  console.log(`\nRemoving what this import no longer produces: ${staleSegments.length} segment(s), ${staleNodes.length} node(s)…`);
  await writeBatched(db, staleSegments.map((d) => ({ ref: d.ref, delete: true })), 'stale segments');
  await writeBatched(db, staleSegments.map((d) => ({
    ref: db.collection('segmentAssessments').doc(d.id), delete: true
  })), 'stale assessments');
  await writeBatched(db, staleNodes.map((d) => ({ ref: d.ref, delete: true })), 'stale nodes');
}
