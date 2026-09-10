/**
 * Basemap palette.
 *
 * The reference design has a blue sea and green parks; OpenFreeMap's positron
 * style is deliberately desaturated and renders both as pale grey. The obvious
 * fix - point `VITE_MAP_STYLE_URL` at a colourful style such as `liberty` - is
 * the wrong one here, because every colourful vector style spends its strongest
 * hues on the *roads*: motorways yellow, trunk roads orange, primary roads red.
 * This app spends green, amber and red on accessibility. Putting both palettes
 * on one map would leave a reader unable to tell a red street from a red rating,
 * which is exactly the confusion the four-colour scale exists to avoid.
 *
 * So the ground gets the colour and the streets stay neutral: water, greenery,
 * sand and buildings are recoloured after the style loads, and anything that
 * carries traffic or a label is left exactly as positron drew it. The
 * accessibility lines keep their white casing and remain the only saturated
 * lines on the map.
 *
 * Layers are matched by `source-layer` and id keyword rather than by an exact
 * list of positron layer names. The OpenMapTiles schema fixes the source-layer
 * names; the style's own layer ids are its private business and change between
 * releases, so a hard-coded list would silently stop matching after an upstream
 * update and quietly return the map to grey.
 */

/**
 * Bump when the palette or the patching changes.
 *
 * It is part of the cache name, so an old device stops serving itself the
 * colours this file used to produce.
 */
const STYLE_REVISION = 1;

const PALETTE = {
  background: '#F6F4EF',
  water: '#8FD3EF',
  waterEdge: '#6FC3E4',
  wood: '#B4DDAB',
  green: '#C7E9BD',
  sand: '#F2E3C0',
  cemetery: '#D5E6CB',
  hospital: '#F3DEDE',
  school: '#EFE7D4',
  residential: '#F1EEE7',
  building: '#E5E0D6',
  buildingEdge: '#D9D2C6'
};

/** Fill opacity used for the recoloured ground, so labels stay readable. */
const GROUND_OPACITY = 0.92;

const has = (id, ...words) => words.some((word) => id.includes(word));

/**
 * Decide what a basemap layer should be tinted, or null to leave it alone.
 * @returns {{color:string, opacity?:number}|null}
 */
function tintFor(layer) {
  const id = String(layer.id || '').toLowerCase();
  const src = String(layer['source-layer'] || '').toLowerCase();

  if (layer.type === 'background') return { color: PALETTE.background };

  // Streets, rail, runways, borders and every label keep positron's neutral
  // treatment. This is the rule that protects the accessibility colours.
  if (src === 'transportation' || src === 'transportation_name' || src === 'aeroway'
    || src === 'boundary' || src === 'place' || src === 'poi'
    || has(id, 'road', 'bridge', 'tunnel', 'rail', 'aeroway', 'ferry',
      'boundary', 'admin', 'label', 'name', 'poi', 'housenumber')) {
    return null;
  }

  if (src === 'water' || has(id, 'water', 'ocean', 'sea', 'lake', 'bay', 'harbour', 'harbor')) {
    return { color: layer.type === 'line' ? PALETTE.waterEdge : PALETTE.water, opacity: 1 };
  }
  if (src === 'waterway' || has(id, 'waterway', 'river', 'stream', 'canal')) {
    return { color: PALETTE.waterEdge, opacity: 1 };
  }

  if (has(id, 'wood', 'forest')) return { color: PALETTE.wood, opacity: GROUND_OPACITY };
  if (has(id, 'grass', 'park', 'garden', 'pitch', 'golf', 'meadow', 'recreation', 'scrub'))
    return { color: PALETTE.green, opacity: GROUND_OPACITY };
  if (has(id, 'sand', 'beach', 'dune')) return { color: PALETTE.sand, opacity: GROUND_OPACITY };
  if (has(id, 'cemetery')) return { color: PALETTE.cemetery, opacity: GROUND_OPACITY };
  if (has(id, 'hospital')) return { color: PALETTE.hospital, opacity: GROUND_OPACITY };
  if (has(id, 'school', 'university', 'college')) return { color: PALETTE.school, opacity: GROUND_OPACITY };

  if (src === 'building' || has(id, 'building')) {
    return { color: layer.type === 'line' ? PALETTE.buildingEdge : PALETTE.building, opacity: 0.9 };
  }

  if (has(id, 'residential', 'landuse', 'landcover', 'suburb', 'neighbourhood')) {
    return { color: PALETTE.residential, opacity: GROUND_OPACITY };
  }

  return null;
}

/** The paint properties that carry colour and opacity, per layer type. */
const PROPS = {
  background: ['background-color', 'background-opacity'],
  fill: ['fill-color', 'fill-opacity'],
  line: ['line-color', 'line-opacity'],
  'fill-extrusion': ['fill-extrusion-color', 'fill-extrusion-opacity']
};

/**
 * Recolour the loaded basemap in place.
 *
 * Safe to call more than once, and safe to call against a style whose layers do
 * not match any rule: it simply does nothing. Every write is guarded, because a
 * style is free to omit a paint property this code would like to set and a
 * throw here would take the whole map down for a decorative change.
 *
 * @param {import('maplibre-gl').Map} map
 */
export function applyBasemapPalette(map) {
  let layers;
  try { layers = map.getStyle()?.layers; } catch { return; }
  if (!Array.isArray(layers)) return;

  for (const layer of layers) {
    const props = PROPS[layer.type];
    if (!props) continue;                 // symbol, raster, heatmap: left alone
    const tint = tintFor(layer);
    if (!tint) continue;

    const [colorProp, opacityProp] = props;
    try { map.setPaintProperty(layer.id, colorProp, tint.color); } catch { /* not paintable */ }
    if (tint.opacity !== undefined) {
      try { map.setPaintProperty(layer.id, opacityProp, tint.opacity); } catch { /* not paintable */ }
    }
  }
}

/**
 * Numeric comparison operators and the direction that makes them false.
 *
 * `<` and `<=` are falsified by a very large left-hand value, `>` and `>=` by a
 * very small one.
 */
const COMPARISONS = { '<': 1, '<=': 1, '>': -1, '>=': -1 };

/**
 * Make numeric comparisons in a filter tolerant of a missing property.
 *
 * positron filters its road-shield layers with `["<=", ["get", "ref_length"],
 * 6]`. Every road without a `ref_length` makes `get` return null, `<=` reject
 * it as not a number, and MapLibre log "Expected value to be of type number,
 * but found null instead. Falling back to false." - three warnings on every map
 * this app opens, for a comparison that was always going to be false.
 *
 * The fix keeps the outcome and drops the complaint: a `coalesce` supplies a
 * number for the missing case, chosen so the comparison is false exactly where
 * MapLibre's fallback made it false. Deleting the layers instead would have
 * been simpler and wrong - one of the three draws road numbers for every
 * network that is *not* American, which is to say for Cyprus.
 */
function guardNumericComparisons(expr) {
  if (!Array.isArray(expr)) return expr;

  const [op, left, right] = expr;
  const direction = COMPARISONS[op];
  if (direction && Array.isArray(left) && left[0] === 'get' && typeof right === 'number') {
    return [op, ['coalesce', left, right + direction * 1e9], right];
  }

  return expr.map(guardNumericComparisons);
}

/** Write the palette into a style-document layer, before MapLibre sees it. */
function paintLayer(layer) {
  const props = PROPS[layer.type];
  const tint = props ? tintFor(layer) : null;
  if (!tint) return layer;

  const [colorProp, opacityProp] = props;
  const paint = { ...(layer.paint || {}), [colorProp]: tint.color };
  if (tint.opacity !== undefined) paint[opacityProp] = tint.opacity;
  return { ...layer, paint };
}

/**
 * Fetch the basemap style and prepare it for use.
 *
 * Doing this here rather than letting MapLibre fetch the URL buys two things
 * that cannot be had afterwards: the palette is written into the document, so
 * the map paints in colour on its first frame instead of flashing grey and
 * then repainting, and the filters above are made total before a single
 * feature is evaluated against them.
 *
 * Any failure returns the URL unchanged. MapLibre accepts either a document or
 * a URL, so a network hiccup here costs the colour, not the map.
 *
 * @param {string} url
 * @returns {Promise<object|string>}
 */
export async function loadBasemapStyle(url) {
  const cached = await readCachedStyle(url);
  if (cached) {
    // Refresh in the background: the style document changes rarely, and the
    // next map to open picks up whatever this writes.
    fetchStyle(url).then((style) => writeCachedStyle(url, style)).catch(() => {});
    return cached;
  }

  try {
    const style = await fetchStyle(url);
    writeCachedStyle(url, style);
    return style;
  } catch (error) {
    // Not worth a toast: the map still works, it is just the grey one.
    if (import.meta.env?.DEV) {
      console.warn('[basemap] falling back to the unmodified style:', error.message);
    }
    return url;
  }
}

async function fetchStyle(url) {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const style = await response.json();
  if (!Array.isArray(style?.layers)) throw new Error('style document has no layers');

  style.layers = style.layers.map((layer) => {
    const patched = paintLayer(layer);
    return layer.filter
      ? { ...patched, filter: guardNumericComparisons(layer.filter) }
      : patched;
  });
  return style;
}

/**
 * The patched style is cached whole rather than re-derived.
 *
 * It is fetched on every map the app opens, and the patching walks every layer
 * and every filter. Storing the finished document turns that into one read from
 * disk. The cache key includes STYLE_CACHE's version, so changing the palette
 * here invalidates every device's copy rather than leaving the old colours in
 * place - the one failure mode this cache could otherwise have.
 */
const STYLE_CACHE = `accesspafos-basemap-${STYLE_REVISION}`;

function cacheStorage() {
  try {
    return typeof caches !== 'undefined' ? caches : null;
  } catch {
    return null;
  }
}

async function readCachedStyle(url) {
  const store = cacheStorage();
  if (!store) return null;
  try {
    const cache = await store.open(STYLE_CACHE);
    const hit = await cache.match(url);
    return hit ? await hit.json() : null;
  } catch {
    return null;
  }
}

async function writeCachedStyle(url, style) {
  const store = cacheStorage();
  if (!store) return;
  try {
    for (const key of await store.keys()) {
      if (key.startsWith('accesspafos-basemap-') && key !== STYLE_CACHE) await store.delete(key);
    }
    const cache = await store.open(STYLE_CACHE);
    await cache.put(url, new Response(JSON.stringify(style), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch { /* quota or private mode: the fetch path still works */ }
}

export const BASEMAP_PALETTE = PALETTE;
