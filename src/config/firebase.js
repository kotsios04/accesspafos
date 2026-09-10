/**
 * Firebase client initialisation.
 *
 * Everything is lazy. The public map must paint before Auth, Firestore or
 * Functions have loaded, so each service is imported on first use and the
 * heavy SDK chunks stay out of the critical path.
 */

import { initializeApp, getApps } from 'firebase/app';
import {
  firebaseConfig, isFirebaseConfigured, functionsRegion,
  useEmulators, analyticsEnabled, isDev
} from './env.js';

let appInstance = null;
const services = {};

export function getFirebaseApp() {
  if (appInstance) return appInstance;
  if (!isFirebaseConfigured) {
    throw new Error('Firebase is not configured. Copy .env.example to .env and add the project values.');
  }
  appInstance = getApps()[0] || initializeApp(firebaseConfig);
  return appInstance;
}

export async function getAuthService() {
  if (services.auth) return services.auth;
  const { getAuth, connectAuthEmulator } = await import('firebase/auth');
  const auth = getAuth(getFirebaseApp());
  if (useEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  }
  services.auth = auth;
  return auth;
}

export async function getDb() {
  if (services.db) return services.db;
  const { getFirestore, connectFirestoreEmulator } = await import('firebase/firestore');
  const db = getFirestore(getFirebaseApp());
  if (useEmulators) connectFirestoreEmulator(db, '127.0.0.1', 8080);
  services.db = db;
  return db;
}

export async function getFunctionsService() {
  if (services.functions) return services.functions;
  const { getFunctions, connectFunctionsEmulator } = await import('firebase/functions');
  const fns = getFunctions(getFirebaseApp(), functionsRegion);
  if (useEmulators) connectFunctionsEmulator(fns, '127.0.0.1', 5001);
  services.functions = fns;
  return fns;
}

export async function getStorageService() {
  if (services.storage) return services.storage;
  const { getStorage, connectStorageEmulator } = await import('firebase/storage');
  const storage = getStorage(getFirebaseApp());
  if (useEmulators) connectStorageEmulator(storage, '127.0.0.1', 9199);
  services.storage = storage;
  return storage;
}

/**
 * Analytics is opt-in and never loaded unless it is switched on, so a visitor
 * who only wants to look at the map is not measured by default.
 */
export async function getAnalyticsService() {
  if (!analyticsEnabled || useEmulators) return null;
  if (services.analytics !== undefined) return services.analytics;
  try {
    const { getAnalytics, isSupported } = await import('firebase/analytics');
    services.analytics = (await isSupported()) ? getAnalytics(getFirebaseApp()) : null;
  } catch {
    services.analytics = null;
  }
  return services.analytics;
}

export { isFirebaseConfigured };
