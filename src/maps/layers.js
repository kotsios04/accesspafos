/**
 * The accessibility layer.
 *
 * Four colours, one line width ramp, and a redundant non-colour channel:
 * unverified segments are drawn dashed as well as grey, so the map still
 * distinguishes "unknown" from "assessed" for a user with colour vision
 * deficiency or on a washed-out screen in Cypriot sunlight.
 */

import { STATUS_COLORS, SegmentStatus } from '@shared/constants.js';

export const SOURCE_ID = 'accessibility';
export const LAYER_BASE = 'accessibility-base';
export const LAYER_LINE = 'accessibility-line';
export const LAYER_UNKNOWN = 'accessibility-unknown';
export const LAYER_SIMULATED = 'accessibility-simulated';
export const LAYER_SELECTED = 'accessibility-selected';
export const LAYER_HITBOX = 'accessibility-hitbox';

/**
 * Zoom-responsive width: thin when zoomed out, tappable when zoomed in.
 *
 * The offset is baked into each stop rather than added around the finished
 * ramp. Wrapping the ramp in an arithmetic operator looks equivalent and is
 * not: the style spec allows a `zoom` expression only as the direct input of a
 * top-level `interpolate` or `step`, so the whole property becomes invalid.
 * MapLibre logs it and falls back to the default width - which is why the white
 * casing under the coloured lines was being drawn at a constant 1px instead of
 * three pixels wider than the line it exists to lift off the basemap.
 */
const widthRamp = (offset = 0) => [
  'interpolate', ['linear'], ['zoom'],
  12, 1.6 + offset,
  14, 2.8 + offset,
  16, 5 + offset,
  18, 9 + offset
];

const WIDTH_RAMP = widthRamp();

const COLOR_EXPRESSION = [
  'match', ['get', 'status'],
  SegmentStatus.ACCESSIBLE, STATUS_COLORS[SegmentStatus.ACCESSIBLE],
  SegmentStatus.PARTIAL, STATUS_COLORS[SegmentStatus.PARTIAL],
  SegmentStatus.INACCESSIBLE, STATUS_COLORS[SegmentStatus.INACCESSIBLE],
  STATUS_COLORS[SegmentStatus.UNVERIFIED]
];

/**
 * @param {import('maplibre-gl').Map} map
 * @param {GeoJSON.FeatureCollection} data
 */
export function addAccessibilityLayer(map, data) {
  if (map.getSource(SOURCE_ID)) {
    map.getSource(SOURCE_ID).setData(data);
    return;
  }

  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data,
    promoteId: 'id'
  });

  // A soft white casing lifts the coloured lines off the basemap without
  // adding another hue to the palette.
  map.addLayer({
    id: LAYER_BASE,
    type: 'line',
    source: SOURCE_ID,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#FFFFFF',
      'line-width': widthRamp(3),
      'line-opacity': 0.85
    }
  });

  // Assessed segments: solid.
  map.addLayer({
    id: LAYER_LINE,
    type: 'line',
    source: SOURCE_ID,
    filter: ['all',
      ['!=', ['get', 'status'], SegmentStatus.UNVERIFIED],
      ['!=', ['get', 'simulated'], true]
    ],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': COLOR_EXPRESSION,
      'line-width': WIDTH_RAMP,
      'line-opacity': [
        'case',
        ['boolean', ['feature-state', 'dimmed'], false], 0.25,
        0.95
      ]
    }
  });

  // Unverified segments: grey AND dashed. The dash is the point - colour is
  // never the only thing carrying meaning here.
  map.addLayer({
    id: LAYER_UNKNOWN,
    type: 'line',
    source: SOURCE_ID,
    filter: ['==', ['get', 'status'], SegmentStatus.UNVERIFIED],
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-color': STATUS_COLORS[SegmentStatus.UNVERIFIED],
      'line-width': WIDTH_RAMP,
      'line-dasharray': [2, 1.6],
      'line-opacity': [
        'case',
        ['boolean', ['feature-state', 'dimmed'], false], 0.2,
        0.85
      ]
    }
  });

  // Projected segments (demo mode only). Continuous, because a tight dash
  // stipples into visual noise once the whole city is drawn and the network
  // stops reading as streets at all - which defeats the only purpose the
  // projection has.
  //
  // The separation from measured data is carried by weight and strength
  // instead: noticeably thinner, and a little over half opacity against the
  // 0.95 of an assessed segment, which also has a white casing lifting it off
  // the basemap. Side by side the surveyed streets are unmistakably the bold
  // ones. This IS a weaker guarantee than the dash was - a projected line
  // cropped out of all context now looks like a line - so the banner over the
  // map and the panel on every projected segment are doing more of the work,
  // and both say plainly that nothing here was surveyed.
  map.addLayer({
    id: LAYER_SIMULATED,
    type: 'line',
    source: SOURCE_ID,
    filter: ['==', ['get', 'simulated'], true],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': COLOR_EXPRESSION,
      'line-width': widthRamp(-0.8),
      'line-opacity': [
        'case',
        ['boolean', ['feature-state', 'dimmed'], false], 0.18,
        0.55
      ]
    }
  });

  map.addLayer({
    id: LAYER_SELECTED,
    type: 'line',
    source: SOURCE_ID,
    filter: ['==', ['get', 'id'], '__none__'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#122029',
      'line-width': widthRamp(4),
      'line-opacity': 0.9
    }
  });

  // An invisible fat line so a finger can hit a 2 px street.
  map.addLayer({
    id: LAYER_HITBOX,
    type: 'line',
    source: SOURCE_ID,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#000000', 'line-width': 22, 'line-opacity': 0 }
  });
}

export function setLayerData(map, data) {
  const source = map.getSource(SOURCE_ID);
  if (source) source.setData(data);
}

export function highlightSegment(map, segmentId) {
  if (!map.getLayer(LAYER_SELECTED)) return;
  map.setFilter(LAYER_SELECTED, ['==', ['get', 'id'], segmentId || '__none__']);
}

/**
 * Apply the map filter chips.
 * @param {import('maplibre-gl').Map} map
 * @param {{status?:string[], verifiedOnly?:boolean, recentOnly?:boolean, wheelchairOnly?:boolean}} filters
 */
export function applyFilters(map, filters = {}) {
  const clauses = ['all'];

  if (Array.isArray(filters.status) && filters.status.length) {
    clauses.push(['in', ['get', 'status'], ['literal', filters.status]]);
  }
  if (filters.verifiedOnly) clauses.push(['==', ['get', 'verified'], true]);
  if (filters.recentOnly) clauses.push(['==', ['get', 'freshness'], 'recent']);
  if (filters.wheelchairOnly) {
    // "Suitable" means assessed accessible AND carrying none of the barriers a
    // wheelchair profile refuses outright.
    clauses.push(['==', ['get', 'status'], SegmentStatus.ACCESSIBLE]);
  }

  const filter = clauses.length > 1 ? clauses : null;
  const real = ['!=', ['get', 'simulated'], true];
  const extra = filter ? clauses.slice(1) : [];

  const assessed = ['all', ['!=', ['get', 'status'], SegmentStatus.UNVERIFIED], real, ...extra];
  const unknown = ['all', ['==', ['get', 'status'], SegmentStatus.UNVERIFIED], real, ...extra];
  // The chips filter projections by the same rules, so "show me the barriers"
  // means the same thing whichever mode the map is in.
  const simulated = ['all', ['==', ['get', 'simulated'], true], ...extra];

  if (map.getLayer(LAYER_LINE)) map.setFilter(LAYER_LINE, assessed);
  if (map.getLayer(LAYER_UNKNOWN)) map.setFilter(LAYER_UNKNOWN, unknown);
  if (map.getLayer(LAYER_SIMULATED)) map.setFilter(LAYER_SIMULATED, simulated);
  if (map.getLayer(LAYER_HITBOX)) map.setFilter(LAYER_HITBOX, filter);
  if (map.getLayer(LAYER_BASE)) map.setFilter(LAYER_BASE, filter);
}

// --- route rendering ---------------------------------------------------------

export const ROUTE_SOURCE = 'route';
export const ROUTE_CASING = 'route-casing';
export const ROUTE_LINE = 'route-line';
export const ROUTE_ALT_SOURCE = 'route-alt';
export const ROUTE_ALT_LINE = 'route-alt-line';

export function addRouteLayers(map) {
  if (!map.getSource(ROUTE_ALT_SOURCE)) {
    map.addSource(ROUTE_ALT_SOURCE, { type: 'geojson', data: emptyCollection() });
    map.addLayer({
      id: ROUTE_ALT_LINE,
      type: 'line',
      source: ROUTE_ALT_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#8B979F',
        'line-width': 5,
        'line-opacity': 0.55,
        'line-dasharray': [1.6, 1.2]
      }
    });
  }

  if (!map.getSource(ROUTE_SOURCE)) {
    map.addSource(ROUTE_SOURCE, { type: 'geojson', data: emptyCollection() });
    map.addLayer({
      id: ROUTE_CASING,
      type: 'line',
      source: ROUTE_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#FFFFFF', 'line-width': 11, 'line-opacity': 0.95 }
    });
    map.addLayer({
      id: ROUTE_LINE,
      type: 'line',
      source: ROUTE_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#176B87', 'line-width': 6 }
    });
  }
}

export function setRoute(map, geometry) {
  const source = map.getSource(ROUTE_SOURCE);
  if (!source) return;
  source.setData(geometry
    ? { type: 'Feature', geometry, properties: {} }
    : emptyCollection());
}

export function setAlternativeRoutes(map, geometries = []) {
  const source = map.getSource(ROUTE_ALT_SOURCE);
  if (!source) return;
  source.setData({
    type: 'FeatureCollection',
    features: geometries.filter(Boolean).map((geometry) => ({
      type: 'Feature', geometry, properties: {}
    }))
  });
}

export function emptyCollection() {
  return { type: 'FeatureCollection', features: [] };
}
