/**
 * Public-service points of interest, used only by the municipal priority
 * engine. A broken kerb outside a hospital entrance matters more than the
 * same kerb on a quiet cul-de-sac, and OSM already knows where the hospitals
 * are - so this is real context rather than an invented footfall model.
 */

import { classifyPoi } from '../shared/osm.js';
import { haversineMeters } from '../shared/geo.js';
import { PRIORITY_POI_RADIUS_M } from '../shared/config.js';

/**
 * @param {{elements:any[]}} overpassJson
 * @param {string} regionId
 */
export function parsePois(overpassJson, regionId) {
  const out = [];
  for (const el of overpassJson?.elements || []) {
    const tags = el.tags || {};
    const cls = classifyPoi(tags);
    if (!cls) continue;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    out.push({
      id: `${el.type}${el.id}`,
      regionId,
      class: cls,
      name: tags.name || tags['name:en'] || tags['name:el'] || null,
      lng: lon,
      lat
    });
  }
  return out;
}

/**
 * POIs within the priority radius of a point, with their distances.
 * @param {[number,number]} centre
 * @param {Array<{class:string,lng:number,lat:number,name?:string}>} pois
 */
export function poisNear(centre, pois, radiusM = PRIORITY_POI_RADIUS_M) {
  const out = [];
  for (const poi of pois) {
    const d = haversineMeters(centre, [poi.lng, poi.lat]);
    if (d <= radiusM) {
      out.push({ class: poi.class, name: poi.name || null, distanceMeters: Math.round(d) });
    }
  }
  return out.sort((a, b) => a.distanceMeters - b.distanceMeters);
}

/** Index POIs into a coarse grid so per-segment lookups stay cheap. */
export function buildPoiIndex(pois, cellDeg = 0.005) {
  const grid = new Map();
  for (const poi of pois) {
    const k = `${Math.floor(poi.lng / cellDeg)}:${Math.floor(poi.lat / cellDeg)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(poi);
  }
  return {
    cellDeg,
    near(centre, radiusM = PRIORITY_POI_RADIUS_M) {
      const cx = Math.floor(centre[0] / cellDeg);
      const cy = Math.floor(centre[1] / cellDeg);
      const candidates = [];
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const bucket = grid.get(`${cx + dx}:${cy + dy}`);
          if (bucket) candidates.push(...bucket);
        }
      }
      return poisNear(centre, candidates, radiusM);
    }
  };
}
