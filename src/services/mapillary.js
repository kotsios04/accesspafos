/**
 * Street-level photographs from Mapillary.
 *
 * The app already tells you what it concluded about a stretch of pavement and
 * why. What it could not do until now is show you the photograph it was looking
 * at when it decided, without sending you to another website to find it. An
 * assessment you cannot check is an assertion, and this whole product is built
 * on not making assertions.
 *
 * So the primary path here is deliberately narrow: an observation already
 * carries the viewer URL of the exact image the model judged, and that URL
 * carries the image id. Given the id, one request returns a thumbnail we can
 * put on the page. No search, no ranking, no guessing which photograph was
 * meant - it is the same image or it is nothing.
 *
 * `loadNearest` exists for the case where there is no observation to hang a
 * photograph off: a segment nobody has analysed yet, where "here is what this
 * street looks like" is still worth more than an empty panel.
 *
 * Every function here answers `null` rather than throwing. A missing photograph
 * must never take the segment detail down with it - the score, the barriers and
 * the reasoning are the product, and the picture is corroboration.
 */

import { mapillaryToken } from '../config/env.js';
import { logError } from './errors.js';

const GRAPH = 'https://graph.mapillary.com';

/** Enough for a card and for the enlarged view on a phone. */
const FIELDS = 'id,thumb_1024_url,thumb_2048_url,captured_at,is_pano,compass_angle,creator';

/**
 * Mapillary's radius search caps at 50 m and picks the best candidate itself,
 * weighing proximity, recency and panoramas. Reimplementing that ranking would
 * be work in exchange for a worse answer.
 */
const NEAREST_RADIUS_M = 50;

const memory = new Map();

export const isMapillaryConfigured = Boolean(mapillaryToken);

/**
 * Pull the image id out of a Mapillary viewer URL.
 *
 * Two forms are in the wild and the ingestion pipeline has used both:
 * `mapillary.com/app/?pKey=<id>` and `mapillary.com/im/<id>`. Anything else
 * returns null rather than a guess - a wrong id fetches a photograph of a
 * different street, which is worse than no photograph at all.
 *
 * @param {string} url
 * @returns {string|null}
 */
export function imageIdFromViewerUrl(url) {
  if (typeof url !== 'string' || !url) return null;

  try {
    const parsed = new URL(url, 'https://www.mapillary.com');
    if (!/(^|\.)mapillary\.com$/i.test(parsed.hostname)) return null;

    const pKey = parsed.searchParams.get('pKey') || parsed.searchParams.get('image_key');
    if (pKey && /^\d+$/.test(pKey)) return pKey;

    const path = parsed.pathname.match(/\/im\/(\d+)/);
    if (path) return path[1];

    return null;
  } catch {
    return null;
  }
}

/** Shape the Graph response into the only fields the UI knows about. */
function toPhoto(raw) {
  if (!raw?.id) return null;
  const thumb = raw.thumb_1024_url;
  if (!thumb) return null;

  return {
    id: String(raw.id),
    thumbUrl: thumb,
    fullUrl: raw.thumb_2048_url || thumb,
    capturedAt: raw.captured_at ? new Date(raw.captured_at).toISOString() : null,
    creator: raw.creator?.username || null,
    isPano: Boolean(raw.is_pano),
    compassAngle: typeof raw.compass_angle === 'number' ? raw.compass_angle : null,
    viewerUrl: `https://www.mapillary.com/app/?pKey=${raw.id}&focus=photo`
  };
}

/**
 * The token goes in the Authorization header rather than the query string so
 * it stays out of URLs, and therefore out of referrers and any logging that
 * records paths.
 */
async function request(path, params) {
  if (!mapillaryToken) return null;

  const url = new URL(path, GRAPH);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: { Authorization: `OAuth ${mapillaryToken}` }
  });
  if (!response.ok) throw new Error(`Mapillary responded HTTP ${response.status}`);
  return response.json();
}

/**
 * One photograph by id.
 *
 * @param {string} imageId
 * @returns {Promise<object|null>}
 */
export async function loadImage(imageId) {
  if (!imageId || !isMapillaryConfigured) return null;

  const key = `id:${imageId}`;
  if (memory.has(key)) return memory.get(key);

  try {
    const photo = toPhoto(await request(`/${encodeURIComponent(imageId)}`, { fields: FIELDS }));
    memory.set(key, photo);
    return photo;
  } catch (error) {
    logError('mapillary.loadImage', error);
    memory.set(key, null);
    return null;
  }
}

/**
 * The best photograph within 50 m of a point, or null if there is none.
 *
 * Coverage over Kato Pafos is good but not total, and null here is an ordinary
 * outcome rather than a fault - the caller is expected to say so plainly rather
 * than spin.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<object|null>}
 */
export async function loadNearest(lat, lng) {
  if (!isMapillaryConfigured) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  // Rounded to about a metre so that repeated taps on the same segment share a
  // cache entry instead of issuing a request per pixel of jitter.
  const key = `near:${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (memory.has(key)) return memory.get(key);

  try {
    const data = await request('/images', {
      lat, lng, radius: NEAREST_RADIUS_M, fields: FIELDS, limit: 1
    });
    const photo = toPhoto(data?.data?.[0]);
    memory.set(key, photo);
    return photo;
  } catch (error) {
    logError('mapillary.loadNearest', error);
    memory.set(key, null);
    return null;
  }
}

/**
 * The photograph for an observation: the one the model actually judged if its
 * id can be recovered, and otherwise whatever stands nearest to where it was
 * taken.
 *
 * @param {{viewerUrl?:string, imageId?:string, lat?:number, lng?:number}} observation
 * @returns {Promise<object|null>}
 */
export async function loadObservationPhoto(observation) {
  if (!observation || !isMapillaryConfigured) return null;

  const id = observation.imageId
    || observation.mapillaryImageId
    || imageIdFromViewerUrl(observation.viewerUrl);

  if (id) {
    const photo = await loadImage(id);
    if (photo) return photo;
  }

  const lat = observation.lat ?? observation.latitude;
  const lng = observation.lng ?? observation.longitude;
  return loadNearest(Number(lat), Number(lng));
}

/** Testing seam. */
export function clearMapillaryCache() {
  memory.clear();
}
