/**
 * Runtime configuration.
 *
 * A municipality can tune a small, explicitly-allowed set of thresholds
 * without a redeploy - where the accessible/partial boundary sits, how much
 * evidence is required before anything is classified at all, how the priority
 * weights trade off. Everything else is code.
 *
 * Every change is audited with its previous value, because moving
 * MIN_CONFIDENCE_TO_CLASSIFY is a policy decision about how confidently this
 * system is allowed to speak.
 */

import { HttpsError } from 'firebase-functions/v2/https';
import { db, serverTimestamp } from '../lib/firebase.js';
import { COLLECTIONS } from '../config/index.js';
import {
  RUNTIME_TUNABLE_KEYS, DEFAULT_CONFIG, mergeRuntimeConfig,
  ACCESSIBLE_THRESHOLD, PARTIAL_THRESHOLD, ASSESSMENT_VERSION, ANALYSIS_VERSION, AI_MODEL
} from '../shared/config.js';
import { writeAudit, AuditAction } from '../lib/audit.js';

const PUBLIC_DOC = 'public';

/** The document the browser reads on boot: thresholds, versions, demo flag. */
export async function getPublicConfig() {
  const snap = await db.collection(COLLECTIONS.config).doc(PUBLIC_DOC).get();
  const overrides = snap.exists ? (snap.data().values || {}) : {};
  const merged = mergeRuntimeConfig(overrides);
  return {
    accessibleThreshold: merged.ACCESSIBLE_THRESHOLD,
    partialThreshold: merged.PARTIAL_THRESHOLD,
    minConfidenceToClassify: merged.MIN_CONFIDENCE_TO_CLASSIFY,
    freshnessThresholds: merged.FRESHNESS_THRESHOLDS,
    maxImagesPerSegment: merged.MAX_IMAGES_PER_SEGMENT,
    demoMode: merged.DEMO_MODE,
    assessmentVersion: ASSESSMENT_VERSION,
    analysisVersion: ANALYSIS_VERSION,
    aiModel: AI_MODEL,
    updatedAt: snap.exists ? snap.data().updatedAt || null : null
  };
}

/** The full effective configuration, for the admin settings screen. */
export async function getEffectiveConfig() {
  const snap = await db.collection(COLLECTIONS.config).doc(PUBLIC_DOC).get();
  const overrides = snap.exists ? (snap.data().values || {}) : {};
  return {
    defaults: DEFAULT_CONFIG,
    overrides,
    effective: mergeRuntimeConfig(overrides),
    tunableKeys: RUNTIME_TUNABLE_KEYS
  };
}

/**
 * Apply an override. Values are validated, not merely stored: a threshold
 * ordering that made no sense (partial above accessible) would silently
 * corrupt every classification in the city.
 */
export async function updateConfig({ values, actor }) {
  if (!values || typeof values !== 'object') {
    throw new HttpsError('invalid-argument', 'No configuration values supplied.');
  }

  const rejected = Object.keys(values).filter((k) => !RUNTIME_TUNABLE_KEYS.includes(k));
  if (rejected.length) {
    throw new HttpsError('invalid-argument', `These settings are not tunable at runtime: ${rejected.join(', ')}.`);
  }

  const ref = db.collection(COLLECTIONS.config).doc(PUBLIC_DOC);
  const snap = await ref.get();
  const previous = snap.exists ? (snap.data().values || {}) : {};
  const next = { ...previous, ...values };

  validateConfig(next);

  await ref.set({
    values: next,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid
  }, { merge: true });

  await writeAudit({
    actor,
    action: AuditAction.CONFIG_CHANGED,
    targetType: 'config',
    targetId: PUBLIC_DOC,
    previous,
    next
  });

  return { values: next, effective: mergeRuntimeConfig(next) };
}

function validateConfig(values) {
  const accessible = values.ACCESSIBLE_THRESHOLD ?? ACCESSIBLE_THRESHOLD;
  const partial = values.PARTIAL_THRESHOLD ?? PARTIAL_THRESHOLD;
  const minConf = values.MIN_CONFIDENCE_TO_CLASSIFY;

  const inRange = (n) => Number.isFinite(n) && n >= 0 && n <= 100;
  if (!inRange(accessible) || !inRange(partial)) {
    throw new HttpsError('invalid-argument', 'Thresholds must be between 0 and 100.');
  }
  if (partial >= accessible) {
    throw new HttpsError('invalid-argument', 'The partial threshold must be below the accessible threshold.');
  }
  if (minConf !== undefined && !inRange(minConf)) {
    throw new HttpsError('invalid-argument', 'Minimum confidence must be between 0 and 100.');
  }
  if (values.FRESHNESS_THRESHOLDS) {
    const f = values.FRESHNESS_THRESHOLDS;
    if (!Number.isFinite(f.recentMaxDays) || !Number.isFinite(f.agingMaxDays) || f.recentMaxDays >= f.agingMaxDays) {
      throw new HttpsError('invalid-argument', 'Freshness thresholds must be increasing day counts.');
    }
  }
  if (values.PRIORITY_WEIGHTS) {
    const sum = Object.values(values.PRIORITY_WEIGHTS).reduce((a, b) => a + Number(b || 0), 0);
    if (!Number.isFinite(sum) || sum <= 0 || sum > 100) {
      throw new HttpsError('invalid-argument', 'Priority weights must be positive and sum to at most 100.');
    }
  }
  if (values.MAX_AI_ANALYSES_PER_DAY !== undefined) {
    const n = Number(values.MAX_AI_ANALYSES_PER_DAY);
    if (!Number.isFinite(n) || n < 0 || n > 5000) {
      throw new HttpsError('invalid-argument', 'The daily AI limit must be between 0 and 5000.');
    }
  }
}

export { PUBLIC_DOC };
