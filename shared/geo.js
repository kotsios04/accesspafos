/**
 * Small dependency-free geodesy helpers shared by the frontend, the Cloud
 * Functions and the tests. Turf is used in the browser only where its extra
 * capability is genuinely needed (snapping a live position to a route line).
 */

const EARTH_RADIUS_M = 6371008.8;
const DEG = Math.PI / 180;

/** @typedef {[number, number]} LngLat  [longitude, latitude] */

export function toRadians(deg) {
  return deg * DEG;
}

/**
 * Great-circle distance in metres between two [lng, lat] positions.
 * @param {LngLat} a
 * @param {LngLat} b
 */
export function haversineMeters(a, b) {
  const lat1 = a[1] * DEG;
  const lat2 = b[1] * DEG;
  const dLat = lat2 - lat1;
  const dLng = (b[0] - a[0]) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Length in metres of a LineString coordinate array.
 * @param {LngLat[]} coords
 */
export function lineLengthMeters(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    total += haversineMeters(coords[i - 1], coords[i]);
  }
  return total;
}

/** Midpoint of a LineString by arc length. @param {LngLat[]} coords */
export function lineMidpoint(coords) {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  if (coords.length === 1) return [coords[0][0], coords[0][1]];
  const half = lineLengthMeters(coords) / 2;
  let travelled = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const seg = haversineMeters(coords[i - 1], coords[i]);
    if (travelled + seg >= half) {
      const t = seg === 0 ? 0 : (half - travelled) / seg;
      return [
        coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
        coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t
      ];
    }
    travelled += seg;
  }
  return [coords[coords.length - 1][0], coords[coords.length - 1][1]];
}

/**
 * Local planar projection around an origin latitude. Accurate enough at the
 * scale of a city for point-to-segment distance work, and far cheaper than a
 * full geodesic solution.
 */
function project(p, originLat) {
  const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * originLat * DEG);
  const mPerDegLng = 111412.84 * Math.cos(originLat * DEG) - 93.5 * Math.cos(3 * originLat * DEG);
  return [p[0] * mPerDegLng, p[1] * mPerDegLat];
}

/**
 * Perpendicular distance in metres from a point to a two-point segment, plus
 * the projected foot point and the interpolation parameter t in [0, 1].
 * @param {LngLat} p @param {LngLat} a @param {LngLat} b
 * @returns {{ distance: number, point: LngLat, t: number }}
 */
export function pointToSegmentMeters(p, a, b) {
  const originLat = p[1];
  const P = project(p, originLat);
  const A = project(a, originLat);
  const B = project(b, originLat);
  const abx = B[0] - A[0];
  const aby = B[1] - A[1];
  const denom = abx * abx + aby * aby;
  let t = denom === 0 ? 0 : ((P[0] - A[0]) * abx + (P[1] - A[1]) * aby) / denom;
  t = Math.max(0, Math.min(1, t));
  const foot = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return { distance: haversineMeters(p, foot), point: foot, t };
}

/**
 * Shortest distance in metres from a point to a polyline, with the closest
 * point and the index of the sub-segment that produced it.
 * @param {LngLat} p @param {LngLat[]} line
 */
export function pointToLineMeters(p, line) {
  let best = { distance: Infinity, point: null, index: -1, t: 0 };
  if (!Array.isArray(line) || line.length === 0) return best;
  if (line.length === 1) {
    return { distance: haversineMeters(p, line[0]), point: line[0], index: 0, t: 0 };
  }
  for (let i = 1; i < line.length; i += 1) {
    const r = pointToSegmentMeters(p, line[i - 1], line[i]);
    if (r.distance < best.distance) {
      best = { distance: r.distance, point: r.point, index: i - 1, t: r.t };
    }
  }
  return best;
}

/** Initial bearing in degrees (0-360) from a to b. */
export function bearingDegrees(a, b) {
  const lat1 = a[1] * DEG;
  const lat2 = b[1] * DEG;
  const dLng = (b[0] - a[0]) * DEG;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/** Smallest absolute difference between two bearings, in degrees (0-180). */
export function bearingDelta(a, b) {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * Bounding box of a coordinate array.
 * @param {LngLat[]} coords @returns {[number,number,number,number]} [w,s,e,n]
 */
export function bboxOf(coords) {
  let w = Infinity; let s = Infinity; let e = -Infinity; let n = -Infinity;
  for (const c of coords) {
    if (c[0] < w) w = c[0];
    if (c[0] > e) e = c[0];
    if (c[1] < s) s = c[1];
    if (c[1] > n) n = c[1];
  }
  return [w, s, e, n];
}

/** Expand a bbox by a distance in metres. */
export function padBbox(bbox, meters) {
  const midLat = (bbox[1] + bbox[3]) / 2;
  const dLat = meters / 111320;
  const dLng = meters / (111320 * Math.max(0.1, Math.cos(midLat * DEG)));
  return [bbox[0] - dLng, bbox[1] - dLat, bbox[2] + dLng, bbox[3] + dLat];
}

export function bboxContains(bbox, p) {
  return p[0] >= bbox[0] && p[0] <= bbox[2] && p[1] >= bbox[1] && p[1] <= bbox[3];
}

export function bboxIntersects(a, b) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

/** Approximate area of a bbox in square kilometres. */
export function bboxAreaKm2(bbox) {
  const midLat = (bbox[1] + bbox[3]) / 2;
  const h = (bbox[3] - bbox[1]) * 110.574;
  const w = (bbox[2] - bbox[0]) * 111.320 * Math.cos(midLat * DEG);
  return Math.abs(h * w);
}

/**
 * Split a bbox into a grid of tiles no larger than `maxSpanDeg` on a side.
 * Mapillary requires bbox queries smaller than 0.01 degrees square, and
 * Overpass behaves far better on bounded areas.
 */
export function splitBbox(bbox, maxSpanDeg) {
  const [w, s, e, n] = bbox;
  const cols = Math.max(1, Math.ceil((e - w) / maxSpanDeg));
  const rows = Math.max(1, Math.ceil((n - s) / maxSpanDeg));
  const dx = (e - w) / cols;
  const dy = (n - s) / rows;
  const tiles = [];
  for (let i = 0; i < cols; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      tiles.push([w + i * dx, s + j * dy, w + (i + 1) * dx, s + (j + 1) * dy]);
    }
  }
  return tiles;
}

const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Geohash of a position. Used only as a cheap prefix index for "reports near
 * here" queries in Firestore; all real distance work uses haversine.
 */
export function geohash(lng, lat, precision = 9) {
  let minLat = -90; let maxLat = 90;
  let minLng = -180; let maxLng = 180;
  let hash = '';
  let bits = 0;
  let bit = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) { bits = (bits << 1) + 1; minLng = mid; } else { bits <<= 1; maxLng = mid; }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) { bits = (bits << 1) + 1; minLat = mid; } else { bits <<= 1; maxLat = mid; }
    }
    even = !even;
    bit += 1;
    if (bit === 5) {
      hash += GEOHASH_BASE32[bits];
      bits = 0;
      bit = 0;
    }
  }
  return hash;
}

/** Round a coordinate pair to ~1 m for stable identifiers. */
export function roundCoord(p, decimals = 5) {
  const f = 10 ** decimals;
  return [Math.round(p[0] * f) / f, Math.round(p[1] * f) / f];
}
