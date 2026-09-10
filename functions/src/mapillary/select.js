/**
 * Choosing which Mapillary frames are worth analysing.
 *
 * A single Mapillary sequence can contain eighty near-identical frames of one
 * street. Analysing all eighty would cost eighty times as much and tell us
 * almost nothing extra. This module picks at most a handful of genuinely
 * informative frames per segment:
 *
 *   - close to the segment (within a tight radius);
 *   - looking roughly along or across it, not away from it;
 *   - recent in preference to old;
 *   - spatially spread, so we do not analyse the same three metres twice;
 *   - not a 360° panorama, whose geometry the prompt is not calibrated for.
 */

import { pointToLineMeters, haversineMeters, bearingDegrees, bearingDelta } from '../shared/geo.js';
import {
  MAX_MAPILLARY_IMAGES_PER_SEGMENT, MAPILLARY_SEARCH_RADIUS_M,
  MAPILLARY_DEDUPE_DISTANCE_M
} from '../shared/config.js';

/**
 * Score how useful an image is for assessing a given segment.
 * Higher is better; returns null when the image should not be used at all.
 *
 * @param {{lng:number,lat:number,capturedAt:number|null,compassAngle:number|null,qualityScore:number|null,isPano:boolean}} image
 * @param {{geometry:[number,number][]}} segment
 */
export function scoreImageForSegment(image, segment, options = {}) {
  const radius = options.radiusM ?? MAPILLARY_SEARCH_RADIUS_M;
  const now = options.now ?? Date.now();

  if (image.isPano && !options.includePanoramas) return null;

  const point = [image.lng, image.lat];
  const nearest = pointToLineMeters(point, segment.geometry);
  if (!Number.isFinite(nearest.distance) || nearest.distance > radius) return null;

  // --- proximity: 1 at the kerb, 0 at the radius -------------------------
  const proximity = 1 - nearest.distance / radius;

  // --- viewing direction --------------------------------------------------
  // The camera should be looking along the segment (walking down it) or at it
  // (crossing it), not at the sky or at a building behind the photographer.
  let direction = 0.5; // neutral when the compass angle is unknown
  if (image.compassAngle != null && segment.geometry.length >= 2) {
    const i = Math.min(nearest.index, segment.geometry.length - 2);
    const segBearing = bearingDegrees(segment.geometry[i], segment.geometry[i + 1]);
    const delta = bearingDelta(image.compassAngle, segBearing);
    // 0° (along) and 180° (against) are both good; 90° (perpendicular) is the
    // typical car-mounted side view, which is still useful for pavements.
    const alignment = Math.min(delta, 180 - delta) / 90; // 0 = aligned, 1 = perpendicular
    direction = 1 - 0.35 * alignment;
  }

  // --- recency: full marks under a year, decaying to zero at eight -------
  let recency = 0.3;
  if (image.capturedAt) {
    const ageYears = (now - image.capturedAt) / (365.25 * 86400000);
    recency = ageYears <= 1 ? 1 : Math.max(0, 1 - (ageYears - 1) / 7);
  }

  // --- Mapillary's own quality signal, when present ---------------------
  const quality = image.qualityScore != null
    ? Math.max(0, Math.min(1, image.qualityScore))
    : 0.6;

  const score = 0.35 * proximity + 0.30 * recency + 0.20 * direction + 0.15 * quality;

  return {
    score: Number(score.toFixed(4)),
    distanceMeters: Math.round(nearest.distance * 10) / 10,
    components: {
      proximity: Number(proximity.toFixed(3)),
      recency: Number(recency.toFixed(3)),
      direction: Number(direction.toFixed(3)),
      quality: Number(quality.toFixed(3))
    }
  };
}

/**
 * Select the frames to analyse for one segment.
 *
 * @param {{id:string, geometry:[number,number][]}} segment
 * @param {Array<object>} candidateImages
 * @param {{ max?: number, radiusM?: number, dedupeDistanceM?: number, now?: number }} [options]
 * @returns {Array<{image:object, score:number, distanceMeters:number, components:object}>}
 */
export function selectUsefulImagesForSegment(segment, candidateImages, options = {}) {
  const max = options.max ?? MAX_MAPILLARY_IMAGES_PER_SEGMENT;
  const dedupeDistance = options.dedupeDistanceM ?? MAPILLARY_DEDUPE_DISTANCE_M;

  const scored = [];
  for (const image of candidateImages || []) {
    const result = scoreImageForSegment(image, segment, options);
    if (result) scored.push({ image, ...result });
  }

  scored.sort((a, b) => b.score - a.score);

  // Greedy spatial spread: take the best, then skip anything standing almost
  // in the same spot, and prefer a different sequence where possible.
  const chosen = [];
  const usedSequences = new Set();

  for (const pass of [1, 2]) {
    for (const candidate of scored) {
      if (chosen.length >= max) break;
      if (chosen.some((c) => c.image.id === candidate.image.id)) continue;
      // First pass: one frame per sequence, for genuinely independent views.
      if (pass === 1 && candidate.image.sequenceId && usedSequences.has(candidate.image.sequenceId)) continue;
      const tooClose = chosen.some((c) =>
        haversineMeters([c.image.lng, c.image.lat], [candidate.image.lng, candidate.image.lat]) < dedupeDistance);
      if (tooClose) continue;
      chosen.push(candidate);
      if (candidate.image.sequenceId) usedSequences.add(candidate.image.sequenceId);
    }
    if (chosen.length >= max) break;
  }

  return chosen;
}

/**
 * Index images into a grid so each segment only tests nearby candidates.
 * Without this, matching 3000 segments against 20000 images is 60M distance
 * computations; with it, it is a few hundred thousand.
 */
export function buildImageIndex(images, cellDeg = 0.0006) {
  const grid = new Map();
  for (const image of images) {
    const k = `${Math.floor(image.lng / cellDeg)}:${Math.floor(image.lat / cellDeg)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(image);
  }
  const reach = Math.max(1, Math.ceil((MAPILLARY_SEARCH_RADIUS_M / 111320) / cellDeg));
  return {
    cellDeg,
    candidatesFor(segment) {
      const seen = new Set();
      const out = [];
      for (const [lng, lat] of segment.geometry) {
        const cx = Math.floor(lng / cellDeg);
        const cy = Math.floor(lat / cellDeg);
        for (let dx = -reach; dx <= reach; dx += 1) {
          for (let dy = -reach; dy <= reach; dy += 1) {
            for (const img of grid.get(`${cx + dx}:${cy + dy}`) || []) {
              if (seen.has(img.id)) continue;
              seen.add(img.id);
              out.push(img);
            }
          }
        }
      }
      return out;
    }
  };
}
