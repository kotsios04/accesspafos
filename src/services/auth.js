/**
 * Authentication.
 *
 * Deliberate design: exploring the map and planning a route require NO
 * account at all. Anonymous sign-in happens only when a user submits a
 * report, because a report needs an owner - so the reporter can see their own
 * report later, and so abuse can be rate-limited - but it asks nothing of the
 * user beyond tapping submit.
 */

import { getAuthService } from '../config/firebase.js';
import { logError } from './errors.js';

let currentUser = null;
let currentClaims = {};
let ready = null;
const listeners = new Set();

export function getUser() { return currentUser; }
export function getRole() { return currentClaims.role || 'citizen'; }
export function isReviewer() { return ['reviewer', 'municipality_admin', 'super_admin'].includes(getRole()); }
export function isMunicipalityAdmin() { return ['municipality_admin', 'super_admin'].includes(getRole()); }
export function isAnonymous() { return Boolean(currentUser?.isAnonymous); }
export function isSignedIn() { return Boolean(currentUser && !currentUser.isAnonymous); }

export function onAuthChange(listener) {
  listeners.add(listener);
  if (ready) listener(currentUser, currentClaims);
  return () => listeners.delete(listener);
}

function emit() {
  for (const listener of listeners) listener(currentUser, currentClaims);
}

/** Resolve once the first auth state is known. Safe to call repeatedly. */
export function initAuth() {
  if (ready) return ready;
  ready = (async () => {
    const auth = await getAuthService();
    const { onIdTokenChanged } = await import('firebase/auth');
    return new Promise((resolve) => {
      let settled = false;
      onIdTokenChanged(auth, async (user) => {
        currentUser = user;
        currentClaims = {};
        if (user) {
          try {
            const token = await user.getIdTokenResult();
            currentClaims = token.claims || {};
          } catch (error) {
            logError('auth.claims', error);
          }
        }
        emit();
        if (!settled) { settled = true; resolve(user); }
      });
    });
  })();
  return ready;
}

/** Ensure there is *some* identity, creating an anonymous one if needed. */
export async function ensureSignedIn() {
  await initAuth();
  if (currentUser) return currentUser;
  const auth = await getAuthService();
  const { signInAnonymously } = await import('firebase/auth');
  const credential = await signInAnonymously(auth);
  return credential.user;
}

/**
 * Upgrade an anonymous session to a Google account, keeping the same uid
 * where possible so previously submitted reports stay attached to the user.
 */
export async function signInWithGoogle() {
  await initAuth();
  const auth = await getAuthService();
  const { GoogleAuthProvider, signInWithPopup, linkWithPopup } = await import('firebase/auth');
  const provider = new GoogleAuthProvider();

  if (currentUser?.isAnonymous) {
    try {
      const credential = await linkWithPopup(currentUser, provider);
      return credential.user;
    } catch (error) {
      // The Google account already exists elsewhere: fall back to a plain
      // sign-in. The anonymous reports stay with the old uid, which is
      // honest - they were made by a different identity.
      if (error?.code !== 'auth/credential-already-in-use') throw error;
    }
  }

  const credential = await signInWithPopup(auth, provider);
  return credential.user;
}

/** Email/password, used by the municipality console. */
export async function signInWithEmail(email, password) {
  await initAuth();
  const auth = await getAuthService();
  const { signInWithEmailAndPassword } = await import('firebase/auth');
  const credential = await signInWithEmailAndPassword(auth, email, password);
  await credential.user.getIdToken(true); // pick up role claims immediately
  return credential.user;
}

export async function sendPasswordReset(email) {
  const auth = await getAuthService();
  const { sendPasswordResetEmail } = await import('firebase/auth');
  return sendPasswordResetEmail(auth, email);
}

export async function signOut() {
  const auth = await getAuthService();
  const { signOut: fbSignOut } = await import('firebase/auth');
  await fbSignOut(auth);
}

/** Force a token refresh, after a role has been granted server-side. */
export async function refreshClaims() {
  if (!currentUser) return currentClaims;
  const token = await currentUser.getIdTokenResult(true);
  currentClaims = token.claims || {};
  emit();
  return currentClaims;
}
