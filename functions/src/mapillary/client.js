/**
 * Mapillary API v4 client (https://graph.mapillary.com).
 *
 * Mapillary provides the street-level imagery that makes this project
 * scalable: nobody has to walk Pafos with a phone, because a great deal of it
 * has already been driven and walked by contributors.
 *
 * We store image IDs and metadata, plus the observations our analysis derives
 * from them. We do NOT permanently mirror the imagery itself: the pictures
 * belong to their contributors under Mapillary's terms, and re-hosting them
 * is neither necessary for this product nor ours to do. Images are fetched by
 * URL at analysis time and discarded.
 */

import { fetchJson } from '../lib/http.js';
import { MAPILLARY_ACCESS_TOKEN } from '../config/index.js';
import { splitBbox } from '../shared/geo.js';
import {
  MAX_MAPILLARY_IMAGES_PER_TILE, MAPILLARY_MAX_AGE_YEARS
} from '../shared/config.js';

const BASE_URL = 'https://graph.mapillary.com';

/**
 * Mapillary rejects bounding boxes larger than 0.01 degrees square, so every
 * region is tiled before querying.
 */
export const MAX_BBOX_SPAN_DEG = 0.009;

/** Fields requested for each image. Kept minimal - each one costs bandwidth. */
export const IMAGE_FIELDS = [
  'id',
  'computed_geometry',
  'geometry',
  'captured_at',
  'compass_angle',
  'computed_compass_angle',
  'is_pano',
  'camera_type',
  'width',
  'height',
  'quality_score',
  'sequence',
  'creator'
].join(',');

export const IMAGE_DETAIL_FIELDS = `${IMAGE_FIELDS},thumb_1024_url,thumb_2048_url`;

export class MapillaryNotConfiguredError extends Error {
  constructor() {
    super('MAPILLARY_ACCESS_TOKEN is not configured. Imagery discovery is unavailable until it is set.');
    this.name = 'MapillaryNotConfiguredError';
    this.code = 'mapillary-not-configured';
  }
}

function token() {
  const value = MAPILLARY_ACCESS_TOKEN.value();
  if (!value) throw new MapillaryNotConfiguredError();
  return value;
}

export function isMapillaryConfigured() {
  try {
    return Boolean(MAPILLARY_ACCESS_TOKEN.value());
  } catch {
    return false;
  }
}

function authHeaders() {
  return {
    Authorization: `OAuth ${token()}`,
    Accept: 'application/json'
  };
}

/**
 * Discover images inside a bounding box, tiling as required by the API.
 *
 * @param {[number,number,number,number]} bbox [west, south, east, north]
 * @param {{ limit?: number, maxAgeYears?: number, includePanoramas?: boolean }} [options]
 * @returns {Promise<{images: object[], tiles: number, truncatedTiles: number}>}
 */
export async function discoverImageryForBbox(bbox, options = {}) {
  const {
    limit = MAX_MAPILLARY_IMAGES_PER_TILE,
    maxAgeYears = MAPILLARY_MAX_AGE_YEARS,
    includePanoramas = false
  } = options;

  const tiles = splitBbox(bbox, MAX_BBOX_SPAN_DEG);
  const cutoff = Date.now() - maxAgeYears * 365.25 * 86400000;

  /** @type {Map<string, object>} */
  const images = new Map();
  let truncatedTiles = 0;

  for (const tile of tiles) {
    const params = new URLSearchParams({
      fields: IMAGE_FIELDS,
      bbox: tile.join(','),
      limit: String(limit)
    });
    const json = await fetchJson(`${BASE_URL}/images?${params}`, {
      headers: authHeaders(),
      timeoutMs: 30000,
      retries: 2,
      label: 'Mapillary image discovery'
    });

    const data = Array.isArray(json?.data) ? json.data : [];
    if (data.length >= limit) truncatedTiles += 1;

    for (const raw of data) {
      const image = normaliseImage(raw);
      if (!image) continue;
      if (!includePanoramas && image.isPano) continue;
      if (image.capturedAt && image.capturedAt < cutoff) continue;
      images.set(image.id, image);
    }
  }

  return { images: [...images.values()], tiles: tiles.length, truncatedTiles };
}

/**
 * Fetch a single image's metadata plus the thumbnail URL used for analysis.
 * Thumbnail URLs are short-lived signed URLs, so they are fetched at analysis
 * time and never stored.
 */
export async function getImageForAnalysis(imageId, { size = 1024 } = {}) {
  const params = new URLSearchParams({ fields: IMAGE_DETAIL_FIELDS });
  const json = await fetchJson(`${BASE_URL}/${encodeURIComponent(imageId)}?${params}`, {
    headers: authHeaders(),
    timeoutMs: 20000,
    retries: 2,
    label: 'Mapillary image metadata'
  });
  const image = normaliseImage(json);
  if (!image) throw new Error(`Mapillary returned no usable metadata for image ${imageId}`);
  image.analysisUrl = size >= 2048
    ? (json.thumb_2048_url || json.thumb_1024_url)
    : (json.thumb_1024_url || json.thumb_2048_url);
  if (!image.analysisUrl) {
    throw new Error(`Mapillary returned no thumbnail URL for image ${imageId}`);
  }
  return image;
}

/**
 * The web viewer link shown in the segment detail sheet, so a user or a
 * municipal reviewer can look at the original photograph themselves.
 */
export function mapillaryViewerUrl(imageId) {
  return `https://www.mapillary.com/app/?pKey=${encodeURIComponent(imageId)}&focus=photo`;
}

export const MAPILLARY_ATTRIBUTION = 'Street-level imagery © Mapillary contributors, CC BY-SA';

function normaliseImage(raw) {
  if (!raw || raw.id == null) return null;
  const geom = raw.computed_geometry || raw.geometry;
  const coords = geom?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;

  return {
    id: String(raw.id),
    lng: Number(coords[0]),
    lat: Number(coords[1]),
    capturedAt: typeof raw.captured_at === 'number' ? raw.captured_at : null,
    compassAngle: numberOrNull(raw.computed_compass_angle ?? raw.compass_angle),
    isPano: Boolean(raw.is_pano),
    cameraType: raw.camera_type || null,
    width: numberOrNull(raw.width),
    height: numberOrNull(raw.height),
    qualityScore: numberOrNull(raw.quality_score),
    sequenceId: raw.sequence ? String(raw.sequence) : null,
    creatorUsername: raw.creator?.username || null,
    attribution: MAPILLARY_ATTRIBUTION
  };
}

function numberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
