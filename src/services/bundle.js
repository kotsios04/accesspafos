/**
 * Loading the published accessibility layer.
 *
 * The map reads ONE versioned GeoJSON file from Cloud Storage rather than
 * querying Firestore per segment. For a few thousand segments that is the
 * difference between one request and a few thousand document reads per
 * visitor - which is the difference between a map that is free to run and one
 * that is not.
 *
 * The file is immutable per version, and that single fact is what the caching
 * here rests on. A cached copy of `accessibility.v5.geojson` is not a stale
 * approximation of the current data - it is byte-for-byte what the server would
 * send for version 5, and the URL changes the moment a version 6 is published.
 * So it is kept in the Cache Storage API and drawn immediately on a return
 * visit, while the version is checked against the server in parallel. The map
 * appears at once and still corrects itself within a second if it was behind.
 *
 * This is the one exception to the service worker's rule about not caching
 * accessibility data, and it is allowed for the reason that rule exists: the
 * danger is showing someone a rating the publisher has since revised without
 * knowing it, and a version-keyed URL plus a revalidation on every open is
 * exactly how that is prevented.
 */

import { appState } from '../app.js';
import { logError } from './errors.js';

const memory = new Map();

const BUNDLE_CACHE = 'accesspafos-bundle-v1';
const LAST_REGION_KEY = 'accesspafos.lastRegion';

/** Cache Storage is absent in insecure contexts and can throw when blocked. */
function cacheStorage() {
  try {
    return typeof caches !== 'undefined' ? caches : null;
  } catch {
    return null;
  }
}

/**
 * Remember which region and bundle version was last drawn.
 *
 * Without this the fast path cannot start: the bundle URL lives in the
 * `bootstrap` response, so the first thing a returning visitor would otherwise
 * wait for is a callable round trip, before a byte of already-cached map data
 * could be looked up.
 */
export function rememberRegion(region) {
  if (!region?.bundleUrl) return;
  try {
    localStorage.setItem(LAST_REGION_KEY, JSON.stringify(region));
  } catch { /* private browsing; the app simply loses the fast path */ }
}

/** @returns {object|null} the region last drawn, if one was stored. */
export function recallRegion() {
  try {
    const region = JSON.parse(localStorage.getItem(LAST_REGION_KEY) || 'null');
    return region?.bundleUrl && region?.id ? region : null;
  } catch {
    return null;
  }
}

/**
 * The cached bundle for this exact region and version, or null.
 *
 * Never touches the network, so it is safe to await before anything is drawn.
 */
export async function readCachedBundle(region) {
  if (!region?.bundleUrl) return null;

  const key = `${region.id}:${region.bundleVersion}`;
  if (memory.has(key)) return memory.get(key);

  const store = cacheStorage();
  if (!store) return null;

  try {
    const cache = await store.open(BUNDLE_CACHE);
    const hit = await cache.match(region.bundleUrl);
    if (!hit) return null;
    const data = await hit.json();
    memory.set(key, data);
    appState.bundle = data;
    return data;
  } catch {
    // A corrupt or unreadable entry is not worth reporting: the network path
    // below produces the same data and overwrites it.
    return null;
  }
}

/**
 * Store this version and drop every other one.
 *
 * Bundles are a few megabytes and the URL carries the version, so without the
 * prune a device would accumulate one copy per publish forever.
 */
async function writeCachedBundle(url, response) {
  const store = cacheStorage();
  if (!store) return;

  try {
    const cache = await store.open(BUNDLE_CACHE);
    await cache.put(url, response);
    for (const request of await cache.keys()) {
      if (request.url !== new Request(url).url) await cache.delete(request);
    }
  } catch { /* quota, private mode: the map still works, just not instantly */ }
}

/**
 * @param {{id:string, bundleUrl:string|null, bundleVersion:number}} region
 * @returns {Promise<GeoJSON.FeatureCollection|null>}
 */
export async function loadAccessibilityBundle(region) {
  if (!region?.bundleUrl) return null;

  const key = `${region.id}:${region.bundleVersion}`;
  if (memory.has(key)) return memory.get(key);

  const cached = await readCachedBundle(region);
  if (cached) return cached;

  try {
    const response = await fetch(region.bundleUrl, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`Bundle request failed with HTTP ${response.status}`);
    // Cloned before reading: a Response body can only be consumed once, and
    // both the parse and the cache write need it.
    await writeCachedBundle(region.bundleUrl, response.clone());
    const data = await response.json();
    memory.set(key, data);
    appState.bundle = data;
    return data;
  } catch (error) {
    logError('bundle.load', error);
    throw error;
  }
}

/** Feature lookup by segment id, for the detail sheet and route rendering. */
export function findFeature(bundle, segmentId) {
  if (!bundle?.features) return null;
  return bundle.features.find((f) => f.properties?.id === segmentId) || null;
}

export function bundleStats(bundle) {
  if (!bundle?.metadata) return null;
  return {
    segmentCount: bundle.metadata.segmentCount,
    totalLengthMeters: bundle.metadata.totalLengthMeters,
    statusCounts: bundle.metadata.statusCounts,
    generatedAt: bundle.metadata.generatedAt,
    bundleVersion: bundle.metadata.bundleVersion
  };
}

export function clearBundleCache() {
  memory.clear();
  const store = cacheStorage();
  if (store) store.delete(BUNDLE_CACHE).catch(() => { /* nothing to clear */ });
  try { localStorage.removeItem(LAST_REGION_KEY); } catch { /* private mode */ }
}
