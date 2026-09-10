/**
 * OpenStreetMap interpretation.
 *
 * Two responsibilities:
 *   1. decide which OSM ways form the pedestrian network, and of what kind;
 *   2. turn OSM accessibility tags into the same barrier / positive-feature
 *      vocabulary the AI observations produce, so the scoring engine has one
 *      input language regardless of where the evidence came from.
 *
 * The cardinal rule of this file: ABSENCE OF A TAG IS NOT EVIDENCE OF
 * ACCESSIBILITY. A missing `kerb` tag yields no positive and no penalty - it
 * yields low informativeness, which lowers confidence, which keeps the
 * segment grey.
 */

import { Barrier, PositiveFeature, SourceType } from './constants.js';

// ---------------------------------------------------------------------------
// Way classification
// ---------------------------------------------------------------------------

/** Highway values that are pedestrian infrastructure in their own right. */
const PEDESTRIAN_HIGHWAYS = new Set([
  'footway', 'path', 'pedestrian', 'steps', 'living_street', 'track', 'corridor'
]);

/** Road classes a pedestrian may legally and sensibly walk along in Pafos. */
const WALKABLE_ROADS = new Set([
  'residential', 'unclassified', 'service', 'tertiary', 'secondary',
  'primary', 'road'
]);

/** Road classes that are never part of the pedestrian graph. */
const EXCLUDED_HIGHWAYS = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'construction',
  'proposed', 'raceway', 'bus_guideway', 'escape'
]);

export const SegmentKind = Object.freeze({
  FOOTWAY: 'footway',
  SIDEWALK: 'sidewalk',
  CROSSING: 'crossing',
  STEPS: 'steps',
  PEDESTRIAN_STREET: 'pedestrian_street',
  PATH: 'path',
  ROAD_WALKABLE: 'road_walkable',
  CORRIDOR: 'corridor'
});

const TRUTHY = new Set(['yes', 'designated', 'permissive', 'official', 'true', '1']);
const FALSY = new Set(['no', 'private', 'false', '0']);

export function isTruthy(v) { return typeof v === 'string' && TRUTHY.has(v.toLowerCase()); }
export function isFalsy(v) { return typeof v === 'string' && FALSY.has(v.toLowerCase()); }

/**
 * Should this way be part of the pedestrian routing graph?
 * @param {Record<string,string>} tags
 */
export function isPedestrianWay(tags) {
  if (!tags) return false;
  const hw = tags.highway;
  if (!hw || EXCLUDED_HIGHWAYS.has(hw)) return false;

  // Explicit legal exclusions.
  if (isFalsy(tags.foot)) return false;
  if (tags.access && FALSY.has(tags.access) && !isTruthy(tags.foot)) return false;

  if (PEDESTRIAN_HIGHWAYS.has(hw)) {
    // A `path` only counts when it is at least implicitly walkable.
    if (hw === 'path' && tags.foot && isFalsy(tags.foot)) return false;
    return true;
  }

  if (WALKABLE_ROADS.has(hw)) {
    // A road carriageway is included only as a fallback where no separate
    // pedestrian way is mapped, and never when walking is prohibited.
    return true;
  }

  return false;
}

/**
 * Classify a pedestrian way. Sidewalks mapped as separate ways
 * (`footway=sidewalk`) are distinguished from the carriageway they parallel,
 * and left/right variants are preserved, because accessibility is a property
 * of the sidewalk, not of the road.
 * @param {Record<string,string>} tags
 * @returns {{ kind: string, side: 'left'|'right'|null, isCarriageway: boolean }}
 */
export function classifyOsmWay(tags) {
  const hw = tags.highway;
  const footway = tags.footway;
  let side = null;
  if (footway === 'sidewalk') {
    if (tags['sidewalk:side'] === 'left' || tags.side === 'left') side = 'left';
    if (tags['sidewalk:side'] === 'right' || tags.side === 'right') side = 'right';
  }

  if (hw === 'steps') return { kind: SegmentKind.STEPS, side, isCarriageway: false };
  if (hw === 'pedestrian') return { kind: SegmentKind.PEDESTRIAN_STREET, side, isCarriageway: false };
  if (hw === 'corridor') return { kind: SegmentKind.CORRIDOR, side, isCarriageway: false };
  if (hw === 'footway') {
    if (footway === 'crossing') return { kind: SegmentKind.CROSSING, side, isCarriageway: false };
    if (footway === 'sidewalk') return { kind: SegmentKind.SIDEWALK, side, isCarriageway: false };
    return { kind: SegmentKind.FOOTWAY, side, isCarriageway: false };
  }
  if (hw === 'path' || hw === 'track') return { kind: SegmentKind.PATH, side, isCarriageway: false };
  return { kind: SegmentKind.ROAD_WALKABLE, side, isCarriageway: true };
}

/**
 * A carriageway that declares separately-mapped sidewalks on both sides is
 * redundant in the pedestrian graph and would otherwise double-count.
 */
export function carriagewayHasMappedSidewalks(tags) {
  const s = tags.sidewalk;
  if (s === 'separate') return true;
  const l = tags['sidewalk:left'];
  const r = tags['sidewalk:right'];
  return l === 'separate' && r === 'separate';
}

// ---------------------------------------------------------------------------
// Tag value parsing
// ---------------------------------------------------------------------------

/** Parse an OSM length such as "1.5", "1.5 m", "150 cm". Returns metres. */
export function parseLengthMeters(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  const m = v.match(/^(-?\d+(?:\.\d+)?)\s*(m|cm|mm|ft|feet|")?$/);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  switch (m[2]) {
    case 'cm': return n / 100;
    case 'mm': return n / 1000;
    case 'ft': case 'feet': case '"': return n * 0.3048;
    default: return n;
  }
}

/** Parse an OSM incline. Returns absolute percent, or null when unusable. */
export function parseInclinePercent(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === 'up' || v === 'down' || v === 'yes') return null; // direction only
  const pct = v.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  if (pct) return Math.abs(Number.parseFloat(pct[1]));
  const deg = v.match(/^(-?\d+(?:\.\d+)?)\s*°$/);
  if (deg) return Math.abs(Math.tan((Number.parseFloat(deg[1]) * Math.PI) / 180) * 100);
  const bare = v.match(/^(-?\d+(?:\.\d+)?)$/);
  if (bare) return Math.abs(Number.parseFloat(bare[1]));
  return null;
}

const GOOD_SURFACES = new Set(['asphalt', 'concrete', 'paved', 'concrete:plates', 'chipseal', 'metal', 'wood']);
const OK_SURFACES = new Set(['paving_stones', 'concrete:lanes', 'bricks']);
const POOR_SURFACES = new Set([
  'sett', 'cobblestone', 'unhewn_cobblestone', 'gravel', 'fine_gravel', 'pebblestone',
  'ground', 'dirt', 'earth', 'grass', 'sand', 'mud', 'unpaved', 'compacted', 'woodchips',
  'grass_paver', 'rock', 'stepping_stones'
]);

const BAD_SMOOTHNESS = new Set(['bad', 'very_bad', 'horrible', 'very_horrible', 'impassable']);
const GOOD_SMOOTHNESS = new Set(['excellent', 'good']);

const RESTRICTIVE_BARRIERS = new Set(['gate', 'lift_gate', 'swing_gate', 'bollard', 'chicane', 'cycle_barrier']);
const BLOCKING_BARRIERS = new Set(['kissing_gate', 'stile', 'turnstile', 'full-height_turnstile', 'wall', 'fence', 'block']);

// ---------------------------------------------------------------------------
// Evidence derivation
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} EvidenceItem
 * @property {string} id            barrier or positive-feature identifier
 * @property {string} source        SourceType
 * @property {string} [detail]      short human-readable justification
 * @property {number} [weightScale] 0..1 multiplier on the configured weight
 */

/**
 * Derive structured accessibility evidence from OSM tags.
 *
 * @param {Record<string,string>} tags
 * @param {{ kind?: string }} [opts]
 * @returns {{
 *   barriers: EvidenceItem[],
 *   positives: EvidenceItem[],
 *   hardBlocks: string[],
 *   informativeness: number,
 *   knownTags: string[],
 *   decisive: boolean
 * }}
 */
export function deriveOsmEvidence(tags, opts = {}) {
  const t = tags || {};
  const kind = opts.kind || classifyOsmWay(t).kind;
  /** @type {EvidenceItem[]} */ const barriers = [];
  /** @type {EvidenceItem[]} */ const positives = [];
  const hardBlocks = [];
  const knownTags = [];
  let informativeness = 0;

  const add = (list, id, detail, weightScale = 1) => {
    list.push({ id, source: SourceType.OSM, detail, weightScale });
  };
  const know = (tag, weight) => { knownTags.push(tag); informativeness += weight; };

  // --- steps -------------------------------------------------------------
  if (kind === SegmentKind.STEPS || t.highway === 'steps') {
    know('highway=steps', 0.45);
    const hasWheelchairRamp = isTruthy(t['ramp:wheelchair']);
    add(barriers, Barrier.STEPS, hasWheelchairRamp
      ? 'Mapped as steps, with a wheelchair ramp tagged alongside'
      : 'Mapped in OpenStreetMap as steps');
    if (hasWheelchairRamp) {
      add(positives, PositiveFeature.RAMP_PRESENT, 'ramp:wheelchair=yes');
      know('ramp:wheelchair', 0.1);
    } else {
      hardBlocks.push(Barrier.STEPS);
    }
  }

  // --- explicit wheelchair tagging --------------------------------------
  if (typeof t.wheelchair === 'string') {
    know('wheelchair', 0.3);
    if (isFalsy(t.wheelchair)) {
      add(barriers, Barrier.WHEELCHAIR_TAGGED_NO, 'wheelchair=no in OpenStreetMap');
      hardBlocks.push(Barrier.WHEELCHAIR_TAGGED_NO);
    } else if (t.wheelchair === 'limited') {
      add(barriers, Barrier.RESTRICTED_PASSAGE, 'wheelchair=limited in OpenStreetMap', 0.7);
    } else if (isTruthy(t.wheelchair)) {
      add(positives, PositiveFeature.WHEELCHAIR_TAGGED_YES, 'wheelchair=yes in OpenStreetMap');
    }
  }

  // --- surface -----------------------------------------------------------
  if (typeof t.surface === 'string') {
    know('surface', 0.2);
    const s = t.surface.toLowerCase();
    if (GOOD_SURFACES.has(s)) {
      add(positives, PositiveFeature.GOOD_PAVED_SURFACE, `surface=${s}`);
    } else if (POOR_SURFACES.has(s)) {
      add(barriers, Barrier.UNSUITABLE_SURFACE, `surface=${s}`);
    } else if (OK_SURFACES.has(s)) {
      // Paving stones are usually fine but not evidence of a good surface.
      add(barriers, Barrier.UNEVEN_SURFACE, `surface=${s}`, 0.5);
    }
  }

  // --- smoothness --------------------------------------------------------
  if (typeof t.smoothness === 'string') {
    know('smoothness', 0.18);
    const sm = t.smoothness.toLowerCase();
    if (BAD_SMOOTHNESS.has(sm)) {
      add(barriers, Barrier.DAMAGED_SURFACE, `smoothness=${sm}`,
        sm === 'bad' ? 0.7 : 1);
    } else if (GOOD_SMOOTHNESS.has(sm)) {
      add(positives, PositiveFeature.GOOD_PAVED_SURFACE, `smoothness=${sm}`);
    } else if (sm === 'intermediate') {
      add(barriers, Barrier.UNEVEN_SURFACE, 'smoothness=intermediate', 0.5);
    }
  }

  // --- width -------------------------------------------------------------
  const width = parseLengthMeters(t.width ?? t['width:carriageway'] ?? t.est_width);
  if (width != null) {
    know('width', 0.12);
    if (width < 0.9) {
      add(barriers, Barrier.NARROW_WIDTH, `width=${width.toFixed(2)} m`);
    } else if (width < 1.2) {
      add(barriers, Barrier.NARROW_WIDTH, `width=${width.toFixed(2)} m`, 0.5);
    } else if (width >= 1.5) {
      add(positives, PositiveFeature.ADEQUATE_WIDTH, `width=${width.toFixed(2)} m`);
    }
  }

  // --- kerbs -------------------------------------------------------------
  const kerbHeight = parseLengthMeters(t['kerb:height']);
  if (typeof t.kerb === 'string') {
    know('kerb', 0.22);
    const k = t.kerb.toLowerCase();
    if (k === 'flush' || k === 'no') {
      add(positives, PositiveFeature.FLUSH_KERB, `kerb=${k}`);
    } else if (k === 'lowered') {
      add(positives, PositiveFeature.CURB_RAMP, 'kerb=lowered');
    } else if (k === 'raised') {
      add(barriers, Barrier.HIGH_KERB, 'kerb=raised');
    }
  }
  if (kerbHeight != null) {
    know('kerb:height', 0.12);
    if (kerbHeight > 0.06) {
      add(barriers, Barrier.HIGH_KERB, `kerb:height=${(kerbHeight * 100).toFixed(0)} cm`);
    } else {
      add(positives, PositiveFeature.FLUSH_KERB, `kerb:height=${(kerbHeight * 100).toFixed(0)} cm`);
    }
  }

  // --- incline -----------------------------------------------------------
  const incline = parseInclinePercent(t.incline);
  if (incline != null) {
    know('incline', 0.14);
    if (incline > 8) {
      add(barriers, Barrier.STEEP_INCLINE, `incline=${incline.toFixed(1)}%`);
    } else if (incline > 5) {
      add(barriers, Barrier.MODERATE_INCLINE, `incline=${incline.toFixed(1)}%`);
    }
  }

  // --- tactile paving ----------------------------------------------------
  if (typeof t.tactile_paving === 'string') {
    know('tactile_paving', 0.08);
    if (isTruthy(t.tactile_paving)) {
      add(positives, PositiveFeature.TACTILE_PAVING, 'tactile_paving=yes');
    }
  }

  // --- crossings ---------------------------------------------------------
  if (kind === SegmentKind.CROSSING || t.footway === 'crossing' || t.highway === 'crossing') {
    know('crossing', 0.1);
    const markings = t['crossing:markings'];
    const signalled = t.crossing === 'traffic_signals' || t['crossing:signals'] === 'yes';
    const lowered = t.kerb === 'lowered' || t.kerb === 'flush' || (kerbHeight != null && kerbHeight <= 0.06);
    if (signalled || isTruthy(markings) || t.crossing === 'marked' || t.crossing === 'zebra') {
      add(positives, PositiveFeature.ACCESSIBLE_CROSSING,
        signalled ? 'Signal-controlled crossing' : 'Marked crossing');
    }
    // A crossing whose kerb is explicitly raised is a specific, severe barrier.
    if (t.kerb === 'raised') {
      add(barriers, Barrier.CROSSING_WITHOUT_RAMP, 'Crossing with kerb=raised');
    } else if (lowered) {
      add(positives, PositiveFeature.CURB_RAMP, 'Crossing with lowered or flush kerb');
    }
  }

  // --- explicit ramps ----------------------------------------------------
  if (isTruthy(t.ramp) || isTruthy(t['ramp:wheelchair'])) {
    know('ramp', 0.08);
    add(positives, PositiveFeature.RAMP_PRESENT, 'ramp tagged in OpenStreetMap');
  }

  // --- physical barriers on the way -------------------------------------
  if (typeof t.barrier === 'string') {
    know('barrier', 0.12);
    const b = t.barrier.toLowerCase();
    if (BLOCKING_BARRIERS.has(b)) {
      add(barriers, Barrier.BLOCKING_OBSTACLE, `barrier=${b}`);
    } else if (RESTRICTIVE_BARRIERS.has(b)) {
      add(barriers, Barrier.RESTRICTED_PASSAGE, `barrier=${b}`, 0.8);
    }
  }

  // --- carriageway without a pavement ------------------------------------
  if (kind === SegmentKind.ROAD_WALKABLE) {
    const sw = t.sidewalk;
    const swl = t['sidewalk:left'];
    const swr = t['sidewalk:right'];
    if (sw || swl || swr) {
      know('sidewalk', 0.16);
      const noneSide = (v) => v === 'no' || v === 'none';
      if (noneSide(sw) || (noneSide(swl) && noneSide(swr))) {
        add(barriers, Barrier.NO_PEDESTRIAN_PATH, 'sidewalk=no on the carriageway');
      } else if (sw === 'both' || sw === 'left' || sw === 'right'
                 || swl === 'yes' || swr === 'yes') {
        add(positives, PositiveFeature.CLEAR_PATH, `sidewalk=${sw || swl || swr}`);
      }
    }
  }

  const uniqueHardBlocks = [...new Set(hardBlocks)];

  return {
    barriers,
    positives,
    hardBlocks: uniqueHardBlocks,
    informativeness: Math.max(0, Math.min(1, informativeness)),
    knownTags,
    // A tag that directly asserts the barrier, rather than hinting at it.
    decisive: uniqueHardBlocks.length > 0 || typeof t.wheelchair === 'string'
  };
}

// ---------------------------------------------------------------------------
// Points of interest (used only by the municipal priority engine)
// ---------------------------------------------------------------------------

/**
 * Map an OSM POI to one of the public-service classes the priority engine
 * knows about. Returns null for everything else.
 * @param {Record<string,string>} tags
 */
export function classifyPoi(tags) {
  if (!tags) return null;
  const a = tags.amenity;
  const h = tags.healthcare;
  const o = tags.office;
  const pt = tags.public_transport;
  const hw = tags.highway;

  if (a === 'hospital' || h === 'hospital') return 'hospital';
  if (a === 'clinic' || h === 'clinic') return 'clinic';
  if (a === 'doctors' || h === 'doctor') return 'doctors';
  if (a === 'pharmacy' || h === 'pharmacy') return 'pharmacy';
  if (a === 'school') return 'school';
  if (a === 'kindergarten') return 'kindergarten';
  if (a === 'university' || a === 'college') return 'university';
  if (a === 'townhall') return 'townhall';
  if (o === 'government' || a === 'public_building') return 'government';
  if (a === 'social_facility') return 'social_facility';
  if (a === 'bus_station') return 'bus_station';
  if (hw === 'bus_stop' || pt === 'platform' || pt === 'stop_position') return 'bus_stop';
  if (a === 'post_office') return 'post_office';
  if (a === 'library') return 'library';
  if (a === 'community_centre') return 'community_centre';
  return null;
}

/** Human-readable street name from OSM tags, preferring Greek when asked. */
export function osmDisplayName(tags, locale = 'en') {
  if (!tags) return null;
  if (locale === 'el') {
    return tags['name:el'] || tags.name || tags['name:en'] || null;
  }
  return tags['name:en'] || tags.name || tags['name:el'] || null;
}
