/**
 * The canonical structured observation produced by one piece of visual
 * evidence (a Mapillary frame, a citizen photo, a municipal verification
 * photo).
 *
 * This module is dependency-free so it can run in the browser, in Cloud
 * Functions and in tests. The Cloud Functions layer additionally enforces the
 * same shape with Zod at the model boundary (functions/src/ai/schema.js); this
 * validator is the second line of defence and the single source of truth for
 * the allowed vocabulary.
 *
 * Design rule: every field distinguishes "not present" from "not visible".
 * A model that cannot see something must say so rather than assert absence.
 */

/** Values that carry no information and must be excluded from voting. */
export const NON_INFORMATIVE = Object.freeze(['unknown', 'not_visible']);

export const ENUMS = Object.freeze({
  imageQuality: ['good', 'medium', 'poor'],
  visibility: ['yes', 'no', 'not_visible', 'unknown'],
  pathCondition: ['clear', 'restricted', 'blocked', 'unknown'],
  rampCondition: ['usable', 'damaged', 'unknown'],
  surfaceType: ['paved', 'paving_stones', 'gravel', 'dirt', 'other', 'unknown'],
  surfaceCondition: ['good', 'uneven', 'damaged', 'unknown'],
  obstacleSeverity: ['none', 'minor', 'moderate', 'blocking', 'unknown'],
  passage: ['clear', 'restricted', 'blocked', 'unknown'],
  crossingFeature: [
    'marked_crossing', 'traffic_signals', 'tactile_paving',
    'dropped_kerb', 'refuge_island', 'audible_signal'
  ]
});

/** An empty, fully-unknown observation. Used as the normalisation base. */
export function emptyObservation() {
  return {
    imageQuality: 'poor',
    pedestrianPath: { visible: 'unknown', condition: 'unknown' },
    curbRamp: { visible: 'unknown', condition: 'unknown' },
    stairs: { visible: 'unknown' },
    surface: { type: 'unknown', condition: 'unknown' },
    obstacle: { visible: 'unknown', severity: 'unknown', description: '' },
    crossing: { visible: 'unknown', accessibleFeatures: [] },
    clearPassage: { classification: 'unknown' },
    uncertainFindings: [],
    notes: ''
  };
}

function pick(value, allowed, fallback) {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

function shortString(value, max) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * Validate a candidate observation.
 * @param {unknown} raw
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateObservation(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['observation must be an object'] };
  }
  const o = /** @type {Record<string, any>} */ (raw);

  const req = (path, value, allowed) => {
    if (!allowed.includes(value)) {
      errors.push(`${path}: expected one of [${allowed.join(', ')}], got ${JSON.stringify(value)}`);
    }
  };

  req('imageQuality', o.imageQuality, ENUMS.imageQuality);

  if (!o.pedestrianPath || typeof o.pedestrianPath !== 'object') {
    errors.push('pedestrianPath: missing');
  } else {
    req('pedestrianPath.visible', o.pedestrianPath.visible, ENUMS.visibility);
    req('pedestrianPath.condition', o.pedestrianPath.condition, ENUMS.pathCondition);
  }

  if (!o.curbRamp || typeof o.curbRamp !== 'object') {
    errors.push('curbRamp: missing');
  } else {
    req('curbRamp.visible', o.curbRamp.visible, ENUMS.visibility);
    req('curbRamp.condition', o.curbRamp.condition, ENUMS.rampCondition);
  }

  if (!o.stairs || typeof o.stairs !== 'object') {
    errors.push('stairs: missing');
  } else {
    req('stairs.visible', o.stairs.visible, ENUMS.visibility);
  }

  if (!o.surface || typeof o.surface !== 'object') {
    errors.push('surface: missing');
  } else {
    req('surface.type', o.surface.type, ENUMS.surfaceType);
    req('surface.condition', o.surface.condition, ENUMS.surfaceCondition);
  }

  if (!o.obstacle || typeof o.obstacle !== 'object') {
    errors.push('obstacle: missing');
  } else {
    req('obstacle.visible', o.obstacle.visible, ENUMS.visibility);
    req('obstacle.severity', o.obstacle.severity, ENUMS.obstacleSeverity);
  }

  if (!o.crossing || typeof o.crossing !== 'object') {
    errors.push('crossing: missing');
  } else {
    req('crossing.visible', o.crossing.visible, ENUMS.visibility);
    if (o.crossing.accessibleFeatures !== undefined && !Array.isArray(o.crossing.accessibleFeatures)) {
      errors.push('crossing.accessibleFeatures: expected array');
    }
  }

  if (!o.clearPassage || typeof o.clearPassage !== 'object') {
    errors.push('clearPassage: missing');
  } else {
    req('clearPassage.classification', o.clearPassage.classification, ENUMS.passage);
  }

  if (o.uncertainFindings !== undefined && !Array.isArray(o.uncertainFindings)) {
    errors.push('uncertainFindings: expected array');
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Coerce a model response into a valid observation, dropping anything the
 * schema does not know about. Unrecognised values become `unknown` rather
 * than being guessed - the system is allowed to know less, never to know
 * something it was not told.
 *
 * @param {unknown} raw
 * @returns {ReturnType<typeof emptyObservation>}
 */
export function normalizeObservation(raw) {
  const base = emptyObservation();
  if (!raw || typeof raw !== 'object') return base;
  const o = /** @type {Record<string, any>} */ (raw);

  base.imageQuality = pick(o.imageQuality, ENUMS.imageQuality, 'poor');

  const pp = o.pedestrianPath || {};
  base.pedestrianPath.visible = pick(pp.visible, ENUMS.visibility, 'unknown');
  base.pedestrianPath.condition = pick(pp.condition, ENUMS.pathCondition, 'unknown');

  const cr = o.curbRamp || {};
  base.curbRamp.visible = pick(cr.visible, ENUMS.visibility, 'unknown');
  base.curbRamp.condition = pick(cr.condition, ENUMS.rampCondition, 'unknown');

  const st = o.stairs || {};
  base.stairs.visible = pick(st.visible, ENUMS.visibility, 'unknown');

  const su = o.surface || {};
  base.surface.type = pick(su.type, ENUMS.surfaceType, 'unknown');
  base.surface.condition = pick(su.condition, ENUMS.surfaceCondition, 'unknown');

  const ob = o.obstacle || {};
  base.obstacle.visible = pick(ob.visible, ENUMS.visibility, 'unknown');
  base.obstacle.severity = pick(ob.severity, ENUMS.obstacleSeverity, 'unknown');
  base.obstacle.description = shortString(ob.description, 140);

  const cx = o.crossing || {};
  base.crossing.visible = pick(cx.visible, ENUMS.visibility, 'unknown');
  base.crossing.accessibleFeatures = Array.isArray(cx.accessibleFeatures)
    ? [...new Set(cx.accessibleFeatures.filter((f) => ENUMS.crossingFeature.includes(f)))]
    : [];

  const cp = o.clearPassage || {};
  base.clearPassage.classification = pick(cp.classification, ENUMS.passage, 'unknown');

  base.uncertainFindings = Array.isArray(o.uncertainFindings)
    ? o.uncertainFindings.map((f) => shortString(f, 120)).filter(Boolean).slice(0, 6)
    : [];

  base.notes = shortString(o.notes, 240);

  return base;
}

/**
 * True when an observation carries no usable information at all.
 *
 * Both `unknown` and `not_visible` count as saying nothing: an image where
 * the model could see none of the relevant features is evidence that we
 * looked, not evidence about the street. Treating "not_visible" as
 * informative here would inflate the observation count and, through it, the
 * evidence confidence - which is precisely the number that decides whether a
 * segment may be classified at all.
 *
 * Such observations are still stored: provenance is never discarded, and
 * knowing that a frame was analysed and yielded nothing is useful. They
 * simply contribute nothing to score or confidence.
 */
export function isEmptyObservation(obs) {
  if (!obs) return true;
  const saysNothing = (value) => typeof value !== 'string' || NON_INFORMATIVE.includes(value);
  return (
    saysNothing(obs.pedestrianPath?.visible) &&
    saysNothing(obs.pedestrianPath?.condition) &&
    saysNothing(obs.curbRamp?.visible) &&
    saysNothing(obs.stairs?.visible) &&
    saysNothing(obs.surface?.type) &&
    saysNothing(obs.surface?.condition) &&
    saysNothing(obs.obstacle?.visible) &&
    saysNothing(obs.obstacle?.severity) &&
    saysNothing(obs.crossing?.visible) &&
    saysNothing(obs.clearPassage?.classification) &&
    !(Array.isArray(obs.crossing?.accessibleFeatures) && obs.crossing.accessibleFeatures.length > 0)
  );
}

/** The feature keys used for cross-observation agreement measurement. */
export const AGREEMENT_KEYS = Object.freeze([
  'pedestrianPath.visible',
  'pedestrianPath.condition',
  'curbRamp.visible',
  'stairs.visible',
  'surface.type',
  'surface.condition',
  'obstacle.severity',
  'clearPassage.classification'
]);

/** Read a dotted path such as 'surface.type' from an observation. */
export function readPath(obs, path) {
  return path.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obs);
}

