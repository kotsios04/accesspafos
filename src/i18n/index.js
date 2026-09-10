/**
 * Internationalisation.
 *
 * Two locales, one flat key space, no strings hard-coded in components.
 * Greek is not an afterthought here: this is a tool for a Greek-speaking
 * city, and a Cypriot resident should never have to read English to find out
 * whether they can get down their own street.
 */

import en from './en.js';
import el from './el.js';

const DICTIONARIES = { en, el };
const SUPPORTED = Object.keys(DICTIONARIES);
const STORAGE_KEY = 'accesspafos.locale';
const FALLBACK = 'en';

let current = FALLBACK;
const listeners = new Set();

/** Browser preference, narrowed to what we actually support. */
export function detectLocale() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED.includes(stored)) return stored;
  } catch { /* private mode: fall through to the browser preference */ }

  for (const tag of navigator.languages || [navigator.language || '']) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (SUPPORTED.includes(base)) return base;
  }
  return FALLBACK;
}

export function getLocale() { return current; }
export function getSupportedLocales() { return [...SUPPORTED]; }

export function setLocale(locale, { persist = true } = {}) {
  if (!SUPPORTED.includes(locale)) return current;
  current = locale;
  document.documentElement.lang = locale;
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, locale); } catch { /* ignore */ }
  }
  for (const listener of listeners) listener(locale);
  return current;
}

export function onLocaleChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function lookup(dictionary, key) {
  return key.split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), dictionary);
}

/**
 * Translate. Missing keys fall back to English, then to the key itself -
 * a visible key is a bug report, whereas an empty string hides the problem.
 *
 * @param {string} key
 * @param {Record<string, string|number>} [values] {placeholder} interpolation
 */
export function t(key, values) {
  let value = lookup(DICTIONARIES[current], key);
  if (value === undefined && current !== FALLBACK) value = lookup(DICTIONARIES[FALLBACK], key);
  if (value === undefined) {
    if (import.meta.env?.DEV) console.warn(`[i18n] missing key: ${key}`);
    return key;
  }
  if (typeof value !== 'string') return value;
  if (!values) return value;
  return value.replace(/\{(\w+)\}/g, (match, name) => (
    values[name] !== undefined ? String(values[name]) : match
  ));
}

/** Translate a list-shaped entry (used by the static content pages). */
export function tList(key) {
  const value = lookup(DICTIONARIES[current], key) ?? lookup(DICTIONARIES[FALLBACK], key);
  return Array.isArray(value) ? value : [];
}

/** Pick the right field from a bilingual data object coming from Firestore. */
export function pickLocalised(object, base) {
  if (!object) return null;
  if (current === 'el') return object[`${base}El`] || object[base] || null;
  return object[base] || object[`${base}El`] || null;
}
