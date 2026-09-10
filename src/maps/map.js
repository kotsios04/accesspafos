/**
 * MapLibre GL JS wrapper.
 *
 * MapLibre v6 ships as ES modules only and no longer exposes a default
 * export, hence the namespace import. The library is heavy, so this module is
 * always loaded dynamically by the pages that need a map - the home screen
 * never pays for it.
 */

import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * Point MapLibre at the worker this build actually ships.
 *
 * Left alone, MapLibre derives the worker URL from `import.meta.url` of its
 * own chunk, which lands on a path no bundler emits anything to. Saying it
 * explicitly means the location is decided here, next to the Vite plugin that
 * puts the file there, instead of falling out of chunk naming.
 */
maplibregl.setWorkerUrl(`${import.meta.env.BASE_URL}assets/maplibre/maplibre-gl-worker.mjs`);
import { mapStyleUrl, mapAttributionHtml } from '../config/env.js';
import { applyBasemapPalette, loadBasemapStyle } from './basemap.js';
import {
  DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, MIN_MAP_ZOOM, MAX_MAP_ZOOM, PAFOS_BOUNDS
} from '@shared/config.js';

/**
 * @param {HTMLElement} container
 * @param {{center?:[number,number], zoom?:number, interactive?:boolean, bounds?:number[], fitPadding?:number}} [options]
 */
export async function createMap(container, options = {}) {
  // Awaited so the style can be patched before MapLibre parses it - see
  // `loadBasemapStyle`. It resolves to the URL if the fetch fails, which is
  // what MapLibre would have used anyway.
  const style = await loadBasemapStyle(mapStyleUrl);

  const map = new maplibregl.Map({
    container,
    style,
    center: options.center || DEFAULT_MAP_CENTER,
    zoom: options.zoom ?? DEFAULT_MAP_ZOOM,
    minZoom: options.minZoom ?? MIN_MAP_ZOOM,
    maxZoom: options.maxZoom ?? MAX_MAP_ZOOM,
    // Keep the viewport near Pafos: this app has data for one city, and
    // letting a user drift to an empty ocean is a poor experience.
    maxBounds: options.maxBounds === null ? undefined : (options.maxBounds || padBounds(PAFOS_BOUNDS, 0.25)),
    interactive: options.interactive !== false,
    attributionControl: false,
    // A visible focus ring on the canvas matters for keyboard users panning
    // the map with the arrow keys.
    keyboard: true,
    dragRotate: false,
    pitchWithRotate: false,
    touchZoomRotate: true,
    fadeDuration: 120
  });

  map.touchZoomRotate?.disableRotation();

  /**
   * Attribution: required, and required to be small.
   *
   * Two things were wrong with the old bar. It printed the notice twice - once
   * from the style's own sources and once from `customAttribution`, which
   * repeats the same three names - and MapLibre builds a compact control
   * *expanded*, minimising it only when the user first touches the map, so a
   * phone opened this screen behind a full-width licence strip.
   *
   * A vector source carries its attribution in the TileJSON it fetches, not in
   * the style document, so whether the style covers the obligation cannot be
   * read off `getStyle().sources` - the earlier attempt to do exactly that is
   * what produced the duplicate. The control is therefore added with no
   * attribution of ours, and once the map has settled the rendered notice is
   * inspected: if the sources supplied nothing, ours goes in as the fallback.
   * That way the notice is present whatever basemap is configured, and printed
   * once.
   */
  let attributionAdded = false;
  const addAttribution = () => {
    if (attributionAdded) return;
    attributionAdded = true;
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    collapseAttribution();
  };

  let fallbackChecked = false;
  const ensureAttributionText = () => {
    if (fallbackChecked || !attributionAdded) return;
    fallbackChecked = true;
    const inner = map.getContainer().querySelector('.maplibregl-ctrl-attrib-inner');
    if (inner && inner.textContent.trim()) return;
    map.addControl(new maplibregl.AttributionControl({
      compact: true,
      customAttribution: mapAttributionHtml
    }), 'bottom-right');
    collapseAttribution();
  };

  /**
   * MapLibre adds `maplibregl-compact-show` when it first builds the compact
   * control and removes it only on the next map interaction. Dropping the class
   * is all it takes to start collapsed; once `maplibregl-compact` is on the
   * element MapLibre stops re-expanding it, so this does not have to fight the
   * control on every redraw.
   */
  function collapseAttribution() {
    for (const node of map.getContainer()
      .querySelectorAll('.maplibregl-ctrl-attrib.maplibregl-compact-show')) {
      node.classList.remove('maplibregl-compact-show');
    }
  }

  let paletteApplied = false;
  map.on('style.load', () => {
    if (!paletteApplied) {
      paletteApplied = true;
      applyBasemapPalette(map);
    }
    addAttribution();
  });
  map.once('idle', ensureAttributionText);
  map.on('styledata', collapseAttribution);
  map.on('resize', collapseAttribution);

  if (options.controls !== false) {
    map.addControl(new maplibregl.NavigationControl({
      showCompass: false,
      visualizePitch: false
    }), 'bottom-right');
  }

  // The canvas is a graphical control; give assistive technology something.
  const canvas = map.getCanvas();
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', options.ariaLabel || 'Accessibility map of Pafos');
  canvas.setAttribute('tabindex', '0');

  return map;
}

/** Resolve once the style has loaded, so layers can be added safely. */
/**
 * Resolve once the map is usable, or reject with a reason.
 *
 * The earlier version of this waited only for `load` and had no failure path
 * at all, so anything that stopped the style arriving - a blocked CDN, a
 * sprite that never resolved, a worker that failed to start - left the promise
 * pending for the lifetime of the page. The caller sat on `await` forever and
 * the user got a spinner that meant nothing, with no error anywhere.
 *
 * `load` waits for sprites and glyphs as well as the style. Those are needed
 * for labels, not for the accessibility layer this app draws on top, so a
 * loaded style is treated as ready even if the decorative parts are still in
 * flight or never arrive.
 *
 * The timeout is generous on purpose. A cold cache on a slow connection has
 * been measured taking well over ten seconds to reach `load`; the point of the
 * clock is to convert a permanent hang into a message, not to give up on a
 * connection that is merely slow.
 */
export function whenReady(map, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    if (styleIsUsable(map)) { resolve(map); return; }

    // A container with no height renders nothing, so `load` never arrives.
    // Saying that out loud costs one line and turns a silent hang into a
    // failure that names its own cause.
    const { width, height } = map.getContainer().getBoundingClientRect();
    if (width < 1 || height < 1) {
      reject(new MapStyleError(`The map container has no size (${Math.round(width)}x${Math.round(height)}).`));
      return;
    }

    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      map.off('load', onLoad);
      map.off('error', onError);
      map.off('styledata', onStyleData);
      fn(value);
    };

    const onLoad = () => finish(resolve, map);
    const onStyleData = () => { if (styleIsUsable(map)) finish(resolve, map); };
    const onError = (event) => {
      const error = event?.error || event;
      // Tile and sprite errors are recoverable: the map still works, it just
      // looks poorer. Only a failure to produce a style is fatal here.
      if (styleIsUsable(map)) { finish(resolve, map); return; }
      if (error?.status === 404 || /sprite|glyph|tile/i.test(String(error?.url || error?.message || ''))) return;
      finish(reject, new MapStyleError(error?.message || 'The map style could not be loaded.'));
    };

    const timer = setTimeout(() => {
      if (styleIsUsable(map)) { finish(resolve, map); return; }
      finish(reject, new MapStyleError('The map style did not load in time.'));
    }, timeoutMs);

    map.on('load', onLoad);
    map.on('styledata', onStyleData);
    map.on('error', onError);
  });
}

/**
 * Can we add our layers to this map yet?
 *
 * Deliberately NOT `map.isStyleLoaded()`, and deliberately not waiting for
 * `load`. Those answer "has everything finished?", and with the OpenFreeMap
 * positron style the answer is permanently no: `styledata` and `sourcedata`
 * fire, `areTilesLoaded()` reports true, the basemap paints - and
 * `isStyleLoaded()` stays false forever, so `load` never fires either.
 * Waiting on it meant a 30-second timeout on every visit, and because the
 * timeout rejected, the accessibility layer was never requested at all: the
 * map showed streets and no data, and the page reported "no pedestrian data
 * has been imported".
 *
 * What this module actually needs is weaker and testable: a parsed style that
 * accepts `addSource`/`addLayer`. A style with layers does, verified against
 * the live style before this was written. Depending on a third party's style
 * to reach a "fully loaded" state it has no obligation to reach was the
 * mistake; depending on the capability we use is not.
 */
function styleIsUsable(map) {
  try {
    if (map.isStyleLoaded()) return true;
    return (map.getStyle()?.layers?.length ?? 0) > 0;
  } catch {
    // getStyle() throws before the style object exists.
    return false;
  }
}

export class MapStyleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MapStyleError';
    this.code = 'map-style-failed';
  }
}

export function padBounds(bbox, factor = 0.2) {
  const [w, s, e, n] = bbox;
  const dx = (e - w) * factor;
  const dy = (n - s) * factor;
  return [[w - dx, s - dy], [e + dx, n + dy]];
}

export function fitToBbox(map, bbox, padding = 48) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return;
  map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
    padding, duration: 600, maxZoom: 17
  });
}

export function fitToGeometry(map, coordinates, padding = 64) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return;
  let w = Infinity; let s = Infinity; let e = -Infinity; let n = -Infinity;
  for (const [lng, lat] of coordinates) {
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  map.fitBounds([[w, s], [e, n]], { padding, duration: 700, maxZoom: 18 });
}

export function createMarker(options = {}) {
  return new maplibregl.Marker(options);
}

export function createPopup(options = {}) {
  return new maplibregl.Popup({ closeButton: false, offset: 14, ...options });
}

export { maplibregl };
