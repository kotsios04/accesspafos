/**
 * AccessPafos AI - application entry point.
 *
 * Boot order matters here. The shell and the router come up first so the
 * first screen paints without waiting for Firebase; auth and the bootstrap
 * payload settle behind it. A visitor who only wants to look at the
 * accessibility map should never wait on an authentication round trip.
 */

import './styles/index.css';

import { detectLocale, setLocale, onLocaleChange, t } from './i18n/index.js';
import { renderShell, setActiveTab, setNavVisible, setHeader, refreshShellStrings, getOutlet } from './components/appShell.js';
import { registerRoutes, startRouter, setNavigationHandler, resolve } from './router/index.js';
import { loadPrefs, getPref, hydrateFromServer } from './services/prefs.js';
import { initAuth, onAuthChange } from './services/auth.js';
import { isDev, appVersion, isFirebaseConfigured } from './config/env.js';
import { migrateLocalToAccount } from './services/saved.js';
import { bootstrap as fetchBootstrap, invalidate } from './services/api.js';
import { toastError } from './services/toast.js';
import { el, mount } from './utils/dom.js';

/** Shared, read-mostly application state. */
export const appState = {
  bootstrap: null,
  regionId: null,
  bundle: null,
  lastRoutePlan: null,
  pendingReportLocation: null
};

async function boot() {
  const container = document.getElementById('app');

  // --- 1. locale and preferences (synchronous, no network) ----------------
  setLocale(detectLocale(), { persist: false });
  loadPrefs();
  applyMotionPreference();

  // --- 2. shell and router: first paint ------------------------------------
  renderShell(container);
  registerRoutes();
  setNavigationHandler(handleNavigation);

  if (!isFirebaseConfigured) {
    renderConfigurationNotice(getOutlet());
    return;
  }

  // --- 3. background: identity and data -----------------------------------
  // The Firebase SDK is imported lazily so it never lands in the first-paint
  // chunk: a visitor looking at the map should not wait on 200 kB of auth and
  // Firestore code before anything appears.
  //
  // This block runs BEFORE `await startRouter()`, and the order is the point.
  // The first page rendered may need the bootstrap payload - the map does, to
  // learn which region and bundle to draw - and it waits for it on an event.
  // Requesting it only after the router had finished meant the map waited out
  // its full timeout for an answer to a question nobody had asked yet, then
  // reported that no data had been imported. Starting the request here means
  // it is in flight while the first screen paints, which is also simply
  // faster.
  initAuth()
    .then(() => hydrateFromServer())
    .catch((error) => { if (isDev) console.warn('[boot] auth', error); });

  onAuthChange((user) => {
    if (user && !user.isAnonymous) {
      migrateLocalToAccount().catch(() => {});
    }
  });

  fetchBootstrap()
    .then((data) => {
      appState.bootstrap = data;
      appState.regionId = data.defaultRegionId;
      window.dispatchEvent(new CustomEvent('accesspafos:bootstrap', { detail: data }));
    })
    .catch((error) => {
      if (isDev) console.warn('[boot] bootstrap failed', error);
      window.dispatchEvent(new CustomEvent('accesspafos:bootstrap-failed', { detail: error }));
    });

  await startRouter();

  // --- 4. locale changes re-render the shell and the current page ----------
  onLocaleChange(() => {
    refreshShellStrings();
    invalidate();
    resolve();
  });

  // --- 5. connectivity -----------------------------------------------------
  window.addEventListener('offline', () => toastError(t('app.offline')));

  registerServiceWorker();
}

/** Apply shell chrome for the route the router is about to render. */
function handleNavigation({ pathname, meta }) {
  const isAdmin = meta?.shell === 'admin' || pathname.startsWith('/admin');

  setNavVisible(!isAdmin && meta?.shell !== 'none');
  document.body.dataset.shell = isAdmin ? 'admin' : 'app';

  if (isAdmin || meta?.shell === 'none') {
    setHeader({ mode: 'hidden' });
    return;
  }

  setActiveTab(pathname);
  // The map and route-result screens own the whole viewport; their pages set
  // their own floating chrome.
  if (meta?.chrome === 'map') setHeader({ mode: 'hidden' });
}

function applyMotionPreference() {
  const preference = getPref('reducedMotion');
  if (preference === true) document.documentElement.style.setProperty('--dur', '0ms');
  if (preference === true) document.documentElement.style.setProperty('--dur-slow', '0ms');
}

/** A clear, actionable message when .env has not been filled in. */
function renderConfigurationNotice(outlet) {
  setHeader({ title: 'AccessPafos AI' });
  mount(outlet, el('div.page.stack', {}, [
    el('div.banner.banner--warning', {}, [
      el('div', {}, [
        el('p.strong', {}, 'Firebase is not configured.'),
        el('p.small', {}, 'Copy .env.example to .env and fill in the Firebase web configuration for your project, then restart the dev server.')
      ])
    ]),
    el('div.card', {}, [
      el('p.small.muted', {}, 'Required values:'),
      el('pre', {
        style: { fontSize: '12px', overflowX: 'auto', background: 'var(--surface-sunk)', padding: '12px', borderRadius: '10px' }
      }, 'VITE_FIREBASE_API_KEY\nVITE_FIREBASE_AUTH_DOMAIN\nVITE_FIREBASE_PROJECT_ID\nVITE_FIREBASE_STORAGE_BUCKET\nVITE_FIREBASE_APP_ID')
    ])
  ]));
}

/**
 * The service worker gives an offline shell: the app opens and explains
 * itself even with no connection, rather than showing a browser error page.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || isDev) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* not fatal */ });
  });
}

// Surface the version for support conversations and the settings screen.
window.__ACCESSPAFOS_VERSION__ = appVersion;

boot().catch((error) => {
  console.error('[boot] fatal', error);
  const container = document.getElementById('app');
  mount(container, el('div.page.stack', {}, [
    el('div.banner.banner--danger', {}, 'AccessPafos failed to start.'),
    el('p.small.muted', {}, String(error?.message || error)),
    el('button.btn.btn--primary', { onClick: () => window.location.reload() }, 'Reload')
  ]));
});
