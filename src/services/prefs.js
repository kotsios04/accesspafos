/**
 * User preferences.
 *
 * Stored on the device for everyone, and mirrored to Firestore for signed-in
 * users so a mobility profile follows someone from their phone to their
 * laptop. localStorage can throw (private browsing, blocked site data), so
 * every access is guarded and the app works with defaults when it fails.
 */

import { getUser, isSignedIn } from './auth.js';
import { getDb } from '../config/firebase.js';
import { logError } from './errors.js';

const KEY = 'accesspafos.prefs';

const DEFAULTS = {
  mobilityProfile: 'balanced',
  units: 'metric',
  preferVerifiedData: false,
  reducedMotion: null,      // null = follow the OS setting
  analyticsOptIn: false,
  seenIntro: false,
  // Local only: whether the map legend card is folded away. Never synced -
  // it is a per-screen choice, not something to carry to another device.
  legendCollapsed: false
};

let state = { ...DEFAULTS };
const listeners = new Set();

function readLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeLocal(value) {
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* private mode */ }
}

export function loadPrefs() {
  state = readLocal();
  return state;
}

export function getPrefs() { return { ...state }; }
export function getPref(key) { return state[key]; }

export async function setPrefs(patch, { sync = true } = {}) {
  state = { ...state, ...patch };
  writeLocal(state);
  for (const listener of listeners) listener(state);

  if (sync && isSignedIn()) {
    try {
      const db = await getDb();
      const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
      await setDoc(doc(db, 'users', getUser().uid), {
        mobilityProfile: state.mobilityProfile,
        units: state.units,
        preferVerifiedData: state.preferVerifiedData,
        reducedMotion: state.reducedMotion,
        analyticsOptIn: state.analyticsOptIn,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (error) {
      // A preference that failed to sync is not worth interrupting anyone for.
      logError('prefs.sync', error);
    }
  }
  return state;
}

export function onPrefsChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Pull server-side preferences after sign-in, without clobbering local edits. */
export async function hydrateFromServer() {
  if (!isSignedIn()) return state;
  try {
    const db = await getDb();
    const { doc, getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(db, 'users', getUser().uid));
    if (snap.exists()) {
      const remote = snap.data();
      state = {
        ...state,
        mobilityProfile: remote.mobilityProfile ?? state.mobilityProfile,
        units: remote.units ?? state.units,
        preferVerifiedData: remote.preferVerifiedData ?? state.preferVerifiedData,
        reducedMotion: remote.reducedMotion ?? state.reducedMotion,
        analyticsOptIn: remote.analyticsOptIn ?? state.analyticsOptIn
      };
      writeLocal(state);
      for (const listener of listeners) listener(state);
    }
  } catch (error) {
    logError('prefs.hydrate', error);
  }
  return state;
}

export { DEFAULTS };
