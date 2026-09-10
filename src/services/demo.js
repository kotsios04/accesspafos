/**
 * Demo mode: what Pafos would look like fully documented.
 *
 * This exists for one purpose - showing a municipality or a judge the shape of
 * the finished thing while only a fraction of the city has been surveyed - and
 * it is the single most dangerous feature in the product, because a fabricated
 * accessibility rating is precisely the harm the whole system is built to
 * prevent. Somebody in a wheelchair routed down an invented "accessible"
 * street is worse off than somebody with no app at all.
 *
 * So four rules are load-bearing here, not stylistic:
 *
 * 1. It only fills in the GREY. Segments carrying a real assessment keep it,
 *    untouched. That turns the feature from "a fake map" into a coverage
 *    projection: this is what the system would show if the survey reached
 *    everywhere, and what is genuinely known today is still visibly what is
 *    genuinely known today.
 *
 * 2. The projection is drawn from the REAL distribution measured in this
 *    region's own assessed segments - not from an imagination. "If the
 *    undocumented streets resemble the documented ones" is a statement that can
 *    be defended; a random colour is not.
 *
 * 3. Simulated segments are marked `simulated: true` and the map draws them
 *    differently - not merely labelled, but visibly another kind of line, so
 *    that even a cropped screenshot with no interface around it cannot pass for
 *    real data.
 *
 * 4. Nothing here is ever written anywhere. No Firestore, no callable, no
 *    localStorage. It lives in sessionStorage and dies with the tab.
 *
 * Routing deliberately does NOT run over simulated segments - see
 * `routeWarning`. Colouring a map that says "this is a projection" is an
 * honest illustration; telling someone which way to actually walk on invented
 * evidence is not, and no framing in the interface would make it so.
 */

import { SegmentStatus } from '@shared/constants.js';

const KEY = 'accesspafos.demoMode';

/** Bands the simulated score is drawn from, matched to the real thresholds. */
const SCORE_BANDS = {
  [SegmentStatus.ACCESSIBLE]: [80, 96],
  [SegmentStatus.PARTIAL]: [52, 78],
  [SegmentStatus.INACCESSIBLE]: [14, 48]
};

/** A fallback shape for a region with too little real data to learn from. */
const FALLBACK_MIX = [
  [SegmentStatus.ACCESSIBLE, 0.34],
  [SegmentStatus.PARTIAL, 0.41],
  [SegmentStatus.INACCESSIBLE, 0.25]
];

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

/**
 * sessionStorage, not localStorage, and that is deliberate: a demo that
 * survives into tomorrow's visit is a demo somebody forgets they switched on.
 */
export function isDemoActive() {
  try {
    return sessionStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

export function setDemoActive(active) {
  try {
    if (active) sessionStorage.setItem(KEY, 'true');
    else sessionStorage.removeItem(KEY);
  } catch { /* private mode: demo mode simply cannot be turned on */ }
  window.dispatchEvent(new CustomEvent('accesspafos:demo', { detail: { active: Boolean(active) } }));
}

/** Subscribe to changes. @returns {() => void} unsubscribe */
export function onDemoChange(handler) {
  const listener = (event) => handler(event.detail.active);
  window.addEventListener('accesspafos:demo', listener);
  return () => window.removeEventListener('accesspafos:demo', listener);
}

// ---------------------------------------------------------------------------
// the projection
// ---------------------------------------------------------------------------

/**
 * A stable number in [0,1) from a segment id.
 *
 * Deterministic on purpose: the same street must get the same projected rating
 * every time the layer redraws, or panning the map would make ratings flicker
 * and the illustration would be visibly nonsense.
 */
function hashUnit(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** The status mix actually measured in this region's assessed segments. */
export function measuredMix(features = []) {
  const counts = { [SegmentStatus.ACCESSIBLE]: 0, [SegmentStatus.PARTIAL]: 0, [SegmentStatus.INACCESSIBLE]: 0 };
  let total = 0;
  for (const f of features) {
    const status = f?.properties?.status;
    if (status in counts) { counts[status] += 1; total += 1; }
  }
  // Too small a sample tells us nothing; a projection built on nine segments
  // would be arithmetic dressed up as evidence.
  if (total < 30) return FALLBACK_MIX;
  return Object.entries(counts).map(([status, n]) => [status, n / total]);
}

function pickStatus(mix, roll) {
  let cumulative = 0;
  for (const [status, share] of mix) {
    cumulative += share;
    if (roll < cumulative) return status;
  }
  return mix[mix.length - 1][0];
}

/**
 * Return a copy of the bundle with the unverified segments filled in.
 *
 * The input is never mutated - the real bundle stays intact in memory so that
 * leaving demo mode is just a matter of drawing it again.
 *
 * @param {GeoJSON.FeatureCollection} bundle
 * @returns {GeoJSON.FeatureCollection}
 */
export function simulateBundle(bundle) {
  if (!bundle?.features?.length) return bundle;

  const mix = measuredMix(bundle.features);

  const features = bundle.features.map((feature) => {
    if (feature?.properties?.status !== SegmentStatus.UNVERIFIED) return feature;

    const id = String(feature.properties.id ?? '');
    const roll = hashUnit(id);
    const status = pickStatus(mix, roll);
    const [low, high] = SCORE_BANDS[status];
    // A second, decorrelated roll so the score is not a function of the band
    // boundary it fell nearest to.
    const spread = hashUnit(`${id}:score`);

    return {
      ...feature,
      properties: {
        ...feature.properties,
        status,
        accessibilityScore: Math.round(low + spread * (high - low)),
        simulated: true
      }
    };
  });

  return { ...bundle, features, metadata: { ...bundle.metadata, simulated: true } };
}

/**
 * Headline figures for the home page while the projection is on.
 * @returns {{segmentCount:number, simulatedCount:number, statusCounts:object}}
 */
export function simulatedStats(bundle) {
  const counts = {
    [SegmentStatus.ACCESSIBLE]: 0,
    [SegmentStatus.PARTIAL]: 0,
    [SegmentStatus.INACCESSIBLE]: 0,
    [SegmentStatus.UNVERIFIED]: 0
  };
  let simulated = 0;
  for (const f of bundle?.features || []) {
    const status = f?.properties?.status;
    if (status in counts) counts[status] += 1;
    if (f?.properties?.simulated) simulated += 1;
  }
  return {
    segmentCount: bundle?.features?.length || 0,
    simulatedCount: simulated,
    statusCounts: counts
  };
}

/** True when this feature's rating was projected rather than assessed. */
export function isSimulated(feature) {
  return Boolean(feature?.properties?.simulated);
}
