/**
 * Turning failures into something a person can act on.
 *
 * A Cloud Functions error arrives as a code plus a developer message. Showing
 * `functions/resource-exhausted` to a resident is useless; this maps the
 * codes onto translated sentences, and preserves the server's own message
 * when it was written for a human (which, in this codebase, it usually was).
 */

import { t } from '../i18n/index.js';

const CODE_MAP = {
  'functions/unauthenticated': 'error.permission',
  'functions/permission-denied': 'error.permission',
  'functions/not-found': 'error.notFound',
  'functions/resource-exhausted': 'error.rateLimited',
  'functions/unavailable': 'error.unavailable',
  'functions/deadline-exceeded': 'error.timeout',
  'functions/internal': 'error.generic',
  'functions/failed-precondition': 'error.generic',
  'permission-denied': 'error.permission',
  'unavailable': 'error.network',
  'auth/network-request-failed': 'error.network',
  'auth/popup-closed-by-user': 'error.signInFailed',
  'map-style-failed': 'error.mapStyle'
};

/**
 * Codes this codebase throws with a sentence written for the person reading
 * it. On these, the server's own message is always better than anything a
 * generic map can say, because it names the specific thing that went wrong -
 * "an analysis job is already running", "GEMINI_API_KEY is not configured" -
 * and usually the way out of it.
 *
 * Everything else keeps the generic sentence: `internal`, `unavailable` and
 * `deadline-exceeded` carry stack detail or transport noise, and showing that
 * to a municipal reviewer helps nobody.
 */
const HUMAN_AUTHORED = new Set([
  'functions/failed-precondition',
  'functions/resource-exhausted',
  'functions/invalid-argument',
  'functions/not-found',
  'functions/permission-denied',
  'functions/already-exists',
  'functions/out-of-range'
]);

/** A sentence to show the user. */
export function describeError(error) {
  if (!error) return t('error.generic');

  const code = error.code || '';
  const message = (error.message || '').trim();

  // Decided by the code, not by how the sentence is punctuated.
  //
  // The previous rule accepted a server message only if it ended in
  // terminal punctuation and contained no "/" - a guard meant to reject raw
  // codes like `functions/resource-exhausted`, which also threw away every
  // real explanation that happened to mention a path or a URL. That is the
  // wrong way round: it silently replaced the one sentence that said what to
  // do with a generic one that said to wait, and waiting fixed nothing.
  if (message && HUMAN_AUTHORED.has(code)) return message;

  const key = CODE_MAP[code];
  if (key) return t(key);

  // For an unrecognised code, fall back to the old shape-based guess rather
  // than nothing - but still refuse anything that looks like a bare code.
  if (message.length > 12 && /[.!?]$/.test(message) && !/^[a-z-]+\/[a-z-]+$/.test(message)) {
    return message;
  }

  if (!navigator.onLine) return t('error.network');
  return t('error.generic');
}

/** Log with context in development; stay quiet in production. */
export function logError(context, error) {
  if (import.meta.env?.DEV) console.error(`[${context}]`, error);
}
