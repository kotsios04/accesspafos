/**
 * Overpass API client.
 *
 * Overpass is used ONLY for bounded, admin-triggered ingestion of a region.
 * It is never called from a public client and never on map load: that would
 * be both slow for the user and abusive of a donated public service. The
 * result of an import is written to Firestore and published as a static
 * GeoJSON bundle, which is what the public map actually reads.
 */

import { fetchWithRetry, HttpError } from '../lib/http.js';
import { OVERPASS_ENDPOINT, osmUserAgent } from '../config/index.js';
import {
  OVERPASS_TIMEOUT_S, OVERPASS_MAX_RETRIES, MAX_IMPORT_AREA_KM2, OVERPASS_MIRRORS
} from '../shared/config.js';
import { bboxAreaKm2 } from '../shared/geo.js';

/** Highway values requested from Overpass. Filtering happens again locally. */
export const PEDESTRIAN_HIGHWAY_REGEX =
  '^(footway|path|pedestrian|steps|living_street|track|corridor|residential|unclassified|service|tertiary|secondary|primary|road)$';

/**
 * Overpass expects a bbox as (south, west, north, east).
 * @param {[number,number,number,number]} bbox [west, south, east, north]
 */
export function toOverpassBbox([w, s, e, n]) {
  return `${s},${w},${n},${e}`;
}

/**
 * Query for the pedestrian network in a bounding box.
 * `out body meta` gives us way tags, node references and the element's last
 * edit timestamp - which is what dates our OSM-derived evidence. The
 * recursive `>` then resolves those node references to coordinates.
 */
export function buildNetworkQuery(bbox, { timeout = OVERPASS_TIMEOUT_S } = {}) {
  const b = toOverpassBbox(bbox);
  return `[out:json][timeout:${timeout}];
(
  way["highway"~"${PEDESTRIAN_HIGHWAY_REGEX}"](${b});
);
out body meta;
>;
out skel qt;`;
}

/** Query for the public-service POIs the priority engine uses. */
export function buildPoiQuery(bbox, { timeout = 90 } = {}) {
  const b = toOverpassBbox(bbox);
  return `[out:json][timeout:${timeout}];
(
  node["amenity"~"^(hospital|clinic|doctors|pharmacy|school|kindergarten|university|college|townhall|social_facility|bus_station|post_office|library|community_centre|public_building)$"](${b});
  way["amenity"~"^(hospital|clinic|doctors|pharmacy|school|kindergarten|university|college|townhall|social_facility|bus_station|post_office|library|community_centre|public_building)$"](${b});
  node["healthcare"](${b});
  node["office"="government"](${b});
  node["highway"="bus_stop"](${b});
);
out center tags;`;
}

/**
 * Execute an Overpass query.
 * @param {string} query
 * @returns {Promise<{elements: any[], osm3s?: object}>}
 */
export async function runOverpassQuery(query, { label = 'Overpass query' } = {}) {
  // The configured endpoint first, then public mirrors. A saturated instance
  // answers every retry with the same 504, so backing off harder against it
  // achieves nothing; another instance usually answers immediately.
  const configured = OVERPASS_ENDPOINT.value();
  const endpoints = [configured, ...OVERPASS_MIRRORS.filter((m) => m !== configured)];

  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      return await queryOne(endpoint, query, label);
    } catch (error) {
      lastError = error;
      const status = error?.status ?? 0;
      // Only move on when the instance is the problem. A malformed query or a
      // rejected request fails identically everywhere, and trying three hosts
      // would just be rude about it.
      if (![0, 408, 429, 500, 502, 503, 504].includes(status)) throw error;
      if (endpoint !== endpoints[endpoints.length - 1]) {
        console.warn(`[overpass] ${endpoint} answered ${status || 'no response'}; trying the next mirror.`);
      }
    }
  }
  throw lastError;
}

async function queryOne(endpoint, query, label) {
  const response = await fetchWithRetry(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': osmUserAgent(),
      Accept: 'application/json'
    },
    body: new URLSearchParams({ data: query }).toString(),
    // Overpass can legitimately take minutes on a busy day.
    timeoutMs: (OVERPASS_TIMEOUT_S + 30) * 1000,
    // One retry per host rather than OVERPASS_MAX_RETRIES: with mirrors to
    // fall back on, breadth beats depth. Four backed-off attempts against a
    // saturated instance is several minutes spent to be told 504 again, and
    // the total wait across every host stays bounded.
    retries: Math.min(OVERPASS_MAX_RETRIES, 1),
    label
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    // Overpass reports rate limiting and query errors as HTML, not JSON.
    throw new HttpError(
      `${label} returned a non-JSON response (Overpass is likely rate limiting or the query timed out).`,
      response.status,
      text.slice(0, 400)
    );
  }
  if (!Array.isArray(json.elements)) {
    throw new HttpError(`${label} returned no elements array.`, response.status, text.slice(0, 400));
  }
  return json;
}

/**
 * Guard against importing an unreasonably large area. Ingestion writes
 * thousands of documents and later triggers paid AI analysis; an accidental
 * island-sized bounding box is a cost incident, not a feature.
 */
export function assertImportableArea(bbox, { maxKm2 = MAX_IMPORT_AREA_KM2 } = {}) {
  const area = bboxAreaKm2(bbox);
  if (area > maxKm2) {
    const error = new Error(
      `The selected area is ${area.toFixed(1)} km², above the ${maxKm2} km² import limit. Draw a smaller region.`
    );
    error.code = 'area-too-large';
    throw error;
  }
  return area;
}

export async function fetchPedestrianNetwork(bbox) {
  assertImportableArea(bbox);
  return runOverpassQuery(buildNetworkQuery(bbox), { label: 'Overpass pedestrian network' });
}

export async function fetchPois(bbox) {
  return runOverpassQuery(buildPoiQuery(bbox), { label: 'Overpass public services' });
}
