/**
 * Street suggestions, from the data already in the browser.
 *
 * The route planner searches places through Nominatim on explicit submit,
 * because Nominatim's usage policy forbids autocomplete against the public
 * instance and this project does not take from open infrastructure what it
 * asks people not to take. That constraint is real and stays.
 *
 * But it never justified the missing suggestions. The published accessibility
 * bundle is already in memory, and every segment in it carries its street name
 * in both languages. Suggesting from that is instant, costs nothing, sends
 * nothing anywhere - and is *better* than a geocoder here, because it can only
 * ever offer streets the app actually has data about. A geocoder will happily
 * suggest a village forty kilometres outside the mapped region.
 *
 * Names are matched through the phonetic skeleton in utils/greeklish, so
 * "neas sinikias" finds Νέας Συνοικίας. Without that, a Cypriot on a Latin
 * keyboard - which is most of them, most of the time - finds nothing at all.
 */

import { appState } from '../app.js';
import { matchesName, phoneticKey } from '../utils/greeklish.js';

let index = null;
let indexedFrom = null;

/** Midpoint of a segment's line, near enough for "route me to this street". */
function midpointOf(coordinates) {
  if (!Array.isArray(coordinates) || !coordinates.length) return null;
  const [lng, lat] = coordinates[Math.floor(coordinates.length / 2)];
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/**
 * One entry per named street, not one per segment.
 *
 * A long road is dozens of segments; offering each of them separately would
 * bury every other street in the list under one repeated name.
 */
function buildIndex(bundle) {
  const byKey = new Map();

  for (const feature of bundle?.features || []) {
    const props = feature?.properties || {};
    const name = props.name;
    const nameEl = props.nameEl;
    if (!name && !nameEl) continue;

    // Keyed on the phonetic skeleton so the Greek and Latin spellings of one
    // street collapse into a single suggestion rather than two.
    const key = phoneticKey(nameEl || name);
    if (!key) continue;

    const existing = byKey.get(key);
    if (existing) { existing.segments += 1; continue; }

    const point = midpointOf(feature.geometry?.coordinates);
    if (!point) continue;
    byKey.set(key, { key, name, nameEl, segments: 1, ...point });
  }

  return [...byKey.values()];
}

function currentIndex() {
  const bundle = appState.bundle;
  if (!bundle?.features?.length) return [];
  // Rebuilt only when the bundle itself changes; on a return visit the cached
  // bundle is the same object for the life of the page.
  if (index && indexedFrom === bundle) return index;
  index = buildIndex(bundle);
  indexedFrom = bundle;
  return index;
}

/**
 * Streets whose name begins, phonetically, with what was typed.
 *
 * @param {string} query
 * @param {{limit?:number, locale?:string}} [options]
 * @returns {Array<{name:string, displayName:string, lat:number, lng:number}>}
 */
export function suggestStreets(query, { limit = 6, locale = 'en' } = {}) {
  const trimmed = (query || '').trim();
  // Two characters is where the list stops being every street in Pafos.
  if (trimmed.length < 2) return [];

  const preferGreek = locale === 'el';
  const matches = [];

  for (const entry of currentIndex()) {
    if (matchesName(entry.nameEl || '', trimmed) || matchesName(entry.name || '', trimmed)) {
      matches.push(entry);
    }
  }

  // Longer streets first: with several matches, the arterial road is far more
  // likely to be the one meant than a twenty-metre side street of the same name.
  matches.sort((a, b) => b.segments - a.segments);

  return matches.slice(0, limit).map((entry) => {
    const primary = (preferGreek ? entry.nameEl : entry.name) || entry.name || entry.nameEl;
    const other = primary === entry.name ? entry.nameEl : entry.name;
    return {
      name: primary,
      // The other spelling is shown underneath, which is how somebody who
      // typed greeklish confirms they found the street they meant.
      displayName: other && other !== primary ? other : primary,
      lat: entry.lat,
      lng: entry.lng,
      local: true
    };
  });
}

/** Testing seam. */
export function clearStreetIndex() {
  index = null;
  indexedFrom = null;
}
