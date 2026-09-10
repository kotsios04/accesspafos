/**
 * Environment configuration.
 *
 * Vite inlines `import.meta.env.VITE_*` at build time. Nothing secret belongs
 * here: the Firebase web config is public by design (it identifies the
 * project to the browser), and access is controlled by security rules and App
 * Check, not by hiding these values.
 */

const env = import.meta.env || {};

function required(key, value) {
  if (!value && import.meta.env?.DEV) {
    console.warn(`[config] ${key} is not set. Copy .env.example to .env and fill it in.`);
  }
  return value || '';
}

export const firebaseConfig = {
  apiKey: required('VITE_FIREBASE_API_KEY', env.VITE_FIREBASE_API_KEY),
  authDomain: required('VITE_FIREBASE_AUTH_DOMAIN', env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: required('VITE_FIREBASE_PROJECT_ID', env.VITE_FIREBASE_PROJECT_ID),
  storageBucket: required('VITE_FIREBASE_STORAGE_BUCKET', env.VITE_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: required('VITE_FIREBASE_APP_ID', env.VITE_FIREBASE_APP_ID),
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || undefined
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId
);

export const functionsRegion = env.VITE_FUNCTIONS_REGION || 'europe-west1';

export const mapStyleUrl = env.VITE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron';

/**
 * Mapillary. Absent, the segment detail simply renders no photograph - the
 * assessment, its reasoning and the map are all unaffected, so this is a
 * feature that degrades rather than a dependency that breaks.
 */
export const mapillaryToken = env.VITE_MAPILLARY_TOKEN || '';

export const useEmulators = env.VITE_USE_EMULATORS === 'true';
export const demoMode = env.VITE_DEMO_MODE === 'true';
export const analyticsEnabled = env.VITE_ANALYTICS_ENABLED === 'true';

export const isDev = Boolean(env.DEV);
export const appVersion = env.VITE_APP_VERSION || '1.0.0';

/**
 * Attribution that must be shown wherever the map is. This is a licence
 * obligation under ODbL and CC BY-SA, not a nicety, so it lives in config
 * rather than being typed into a template somewhere and later lost.
 */
export const ATTRIBUTION = {
  basemap: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>',
  openmaptiles: '<a href="https://openmaptiles.org" target="_blank" rel="noopener">OpenMapTiles</a>',
  osm: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  mapillary: 'Imagery © <a href="https://www.mapillary.com" target="_blank" rel="noopener">Mapillary</a> contributors (CC BY-SA)'
};

export const mapAttributionHtml =
  `${ATTRIBUTION.basemap} · ${ATTRIBUTION.openmaptiles} · ${ATTRIBUTION.osm}`;
