/**
 * Place search.
 *
 * Nominatim is a free service run by the OpenStreetMap Foundation with an
 * explicit usage policy: identify yourself, do not send a request per
 * keystroke, cache aggressively, and stay under one request per second. This
 * module honours all four:
 *
 *   - it runs server-side only, never from the browser;
 *   - it is called on explicit submit, never on keypress;
 *   - every result is cached in Firestore for a month;
 *   - a token bucket in Firestore enforces the rate limit across instances.
 *
 * The provider is behind a small interface so a commercial geocoder can be
 * swapped in later without touching the UI.
 */

import { HttpsError } from 'firebase-functions/v2/https';
import { db, serverTimestamp, Timestamp, FieldValue } from '../lib/firebase.js';
import { COLLECTIONS, NOMINATIM_ENDPOINT, osmUserAgent } from '../config/index.js';
import { fetchJson } from '../lib/http.js';
import { DEFAULT_REGION, PAFOS_BOUNDS } from '../shared/config.js';

const CACHE_TTL_DAYS = 30;
const MIN_INTERVAL_MS = 1100;
const RATE_DOC = 'nominatimRate';

export const NOMINATIM_ATTRIBUTION = 'Search results © OpenStreetMap contributors';

function cacheKey(query, bbox) {
  return Buffer.from(`${query.toLowerCase().trim()}|${(bbox || []).join(',')}`)
    .toString('base64url')
    .slice(0, 200);
}

/**
 * Search for a place. Results are biased to, and bounded by, the Pafos area:
 * this is a Pafos accessibility tool, and returning a street in Nicosia the
 * app has no data for would be worse than returning nothing.
 */
export async function searchPlaces(query, { bbox = PAFOS_BOUNDS, limit = 6 } = {}) {
  const trimmed = String(query || '').trim();
  if (trimmed.length < 3) {
    throw new HttpsError('invalid-argument', 'Enter at least three characters to search.');
  }

  const key = cacheKey(trimmed, bbox);
  const cacheRef = db.collection(COLLECTIONS.geocodeCache).doc(key);
  const cached = await cacheRef.get();
  if (cached.exists) {
    const data = cached.data();
    const ageDays = (Date.now() - (data.cachedAt?.toMillis?.() ?? 0)) / 86400000;
    if (ageDays < CACHE_TTL_DAYS) {
      return { results: data.results || [], cached: true, attribution: NOMINATIM_ATTRIBUTION };
    }
  }

  await acquireRateSlot();

  const params = new URLSearchParams({
    q: trimmed,
    format: 'jsonv2',
    addressdetails: '1',
    limit: String(Math.min(limit, 10)),
    viewbox: `${bbox[0]},${bbox[3]},${bbox[2]},${bbox[1]}`,
    bounded: '1',
    'accept-language': 'en,el'
  });

  let raw;
  try {
    raw = await fetchJson(`${NOMINATIM_ENDPOINT.value()}/search?${params}`, {
      headers: {
        'User-Agent': osmUserAgent(),
        Accept: 'application/json',
        Referer: 'https://access-pafos.web.app'
      },
      timeoutMs: 12000,
      retries: 1,
      label: 'Nominatim search'
    });
  } catch (error) {
    throw new HttpsError('unavailable',
      'The place search service is temporarily unavailable. You can still drop a pin on the map.',
      { cause: String(error).slice(0, 200) });
  }

  const results = (Array.isArray(raw) ? raw : []).map(normaliseResult).filter(Boolean);

  await cacheRef.set({
    query: trimmed,
    bbox,
    results,
    cachedAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + CACHE_TTL_DAYS * 86400000)
  });

  return { results, cached: false, attribution: NOMINATIM_ATTRIBUTION };
}

function normaliseResult(r) {
  const lat = Number(r.lat);
  const lng = Number(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const address = r.address || {};
  const primary = r.name || address.road || address.pedestrian || r.display_name?.split(',')[0] || 'Unnamed place';
  return {
    id: `${r.osm_type || 'x'}${r.osm_id || Math.random().toString(36).slice(2)}`,
    name: primary,
    displayName: r.display_name || primary,
    category: r.category || r.class || null,
    type: r.type || null,
    lat,
    lng,
    regionId: DEFAULT_REGION.id
  };
}

/**
 * Cross-instance rate limiting. A Firestore transaction is used rather than an
 * in-process timer because Cloud Functions scale out, and ten warm instances
 * each politely waiting one second is still ten requests per second.
 */
async function acquireRateSlot() {
  const ref = db.collection(COLLECTIONS.config).doc(RATE_DOC);
  const allowed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const last = snap.exists ? (snap.data().lastRequestAt?.toMillis?.() ?? 0) : 0;
    const now = Date.now();
    if (now - last < MIN_INTERVAL_MS) return false;
    tx.set(ref, { lastRequestAt: Timestamp.fromMillis(now), requests: FieldValue.increment(1) }, { merge: true });
    return true;
  });

  if (!allowed) {
    throw new HttpsError('resource-exhausted',
      'Search is busy for a moment - please try again in a second.');
  }
}

/** Reverse geocode, used to label a dropped pin. Same cache and rate limit. */
export async function reverseGeocode(lat, lng) {
  const key = cacheKey(`rev:${lat.toFixed(5)},${lng.toFixed(5)}`, null);
  const cacheRef = db.collection(COLLECTIONS.geocodeCache).doc(key);
  const cached = await cacheRef.get();
  if (cached.exists) return { result: cached.data().result || null, cached: true, attribution: NOMINATIM_ATTRIBUTION };

  await acquireRateSlot();
  const params = new URLSearchParams({
    lat: String(lat), lon: String(lng), format: 'jsonv2', zoom: '18', 'accept-language': 'en,el'
  });

  let raw;
  try {
    raw = await fetchJson(`${NOMINATIM_ENDPOINT.value()}/reverse?${params}`, {
      headers: { 'User-Agent': osmUserAgent(), Accept: 'application/json' },
      timeoutMs: 12000, retries: 1, label: 'Nominatim reverse'
    });
  } catch {
    return { result: null, cached: false, attribution: NOMINATIM_ATTRIBUTION };
  }

  const result = normaliseResult(raw);
  await cacheRef.set({
    result, cachedAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + CACHE_TTL_DAYS * 86400000)
  });
  return { result, cached: false, attribution: NOMINATIM_ATTRIBUTION };
}
