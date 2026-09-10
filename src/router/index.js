/**
 * Client-side router.
 *
 * Real URLs (History API), not hashes, because a municipality that wants to
 * link a colleague to `/admin/priorities` should be able to. Firebase Hosting
 * rewrites every path to index.html, so a deep link works on first load too.
 *
 * Pages are dynamic imports: the admin console, the map engine and the route
 * planner are separate chunks that a visitor only downloads if they go there.
 */

import { announce } from '../utils/dom.js';

/**
 * The path the app is served under.
 *
 * In production this is '/' on Firebase Hosting, and everything below is a
 * no-op. It exists so the same build can also be served from a sub-directory -
 * which is how the app is previewed locally before a deploy - without the
 * router mistaking the directory prefix for a route and answering 404.
 */
const BASE = (import.meta.env?.BASE_URL || '/').replace(/\/+$/, '');

/** Application path from a browser pathname. */
export function toAppPath(pathname) {
  if (!BASE) return pathname || '/';
  if (pathname === BASE) return '/';
  return pathname.startsWith(`${BASE}/`) ? pathname.slice(BASE.length) || '/' : pathname;
}

/** Browser pathname from an application path. */
export function toHref(path) {
  if (!BASE) return path;
  return `${BASE}${path === '/' ? '/' : path}`;
}

/** @type {Array<{pattern: RegExp, keys: string[], load: () => Promise<any>, meta: object}>} */
const routes = [];
let currentPage = null;
let currentPath = null;
let onNavigate = null;

/**
 * @param {string} path  '/segment/:id' style pattern
 * @param {() => Promise<{render: Function}>} load
 * @param {{shell?: 'app'|'admin'|'none', title?: string}} [meta]
 */
export function route(path, load, meta = {}) {
  const keys = [];
  const pattern = new RegExp(`^${path
    .replace(/\/$/, '')
    .replace(/:([A-Za-z0-9_]+)/g, (_, key) => { keys.push(key); return '([^/]+)'; })
    .replace(/\*/g, '.*')}/?$`);
  routes.push({ pattern, keys, load, meta, path });
}

export function setNavigationHandler(handler) { onNavigate = handler; }

export function match(pathname) {
  const clean = pathname.replace(/\/+$/, '') || '/';
  for (const entry of routes) {
    const result = entry.pattern.exec(clean);
    if (!result) continue;
    const params = {};
    entry.keys.forEach((key, index) => { params[key] = decodeURIComponent(result[index + 1]); });
    return { entry, params };
  }
  return null;
}

export function navigate(to, { replace = false, state = {} } = {}) {
  const target = new URL(to, window.location.origin);
  const url = new URL(toHref(target.pathname) + target.search + target.hash, window.location.origin);
  if (url.pathname === window.location.pathname && url.search === window.location.search) {
    return resolve();
  }
  if (replace) window.history.replaceState(state, '', url);
  else window.history.pushState(state, '', url);
  return resolve();
}

export function getQuery() {
  return Object.fromEntries(new URLSearchParams(window.location.search));
}

export function currentRoutePath() { return currentPath; }

/** Render whatever the current URL points at. */
export async function resolve() {
  const pathname = toAppPath(window.location.pathname);
  const found = match(pathname);

  // Tear down the previous page so map instances and geolocation watchers do
  // not leak between navigations.
  if (currentPage?.destroy) {
    try { currentPage.destroy(); } catch { /* a failing teardown must not block navigation */ }
  }
  currentPage = null;
  currentPath = pathname;

  if (!found) {
    const module = await import('../pages/notFound.js');
    currentPage = await module.render({ params: {}, query: getQuery() });
    onNavigate?.({ pathname, meta: { shell: 'app' }, params: {} });
    return currentPage;
  }

  const { entry, params } = found;
  onNavigate?.({ pathname, meta: entry.meta, params });

  try {
    const module = await entry.load();
    currentPage = await module.render({ params, query: getQuery(), navigate });
  } catch (error) {
    console.error('[router] failed to render', pathname, error);
    const module = await import('../pages/error.js');
    currentPage = await module.render({ error });
  }

  // Move the reading position to the top and tell assistive technology that
  // the page changed - an SPA gets neither for free.
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  const main = document.getElementById('main');
  if (main) {
    main.focus({ preventScroll: true });
    if (entry.meta?.title) announce(entry.meta.title);
  }

  return currentPage;
}

/** Intercept in-app links so navigation stays client-side. */
export function startRouter() {
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const anchor = event.target.closest?.('a[href]');
    if (!anchor) return;
    if (anchor.target && anchor.target !== '_self') return;
    if (anchor.hasAttribute('download') || anchor.getAttribute('rel')?.includes('external')) return;

    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;

    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) return;

    event.preventDefault();
    navigate(toAppPath(url.pathname) + url.search);
  });

  window.addEventListener('popstate', () => resolve());
  return resolve();
}

export function registerRoutes() {
  // --- public --------------------------------------------------------------
  route('/', () => import('../pages/home.js'), { shell: 'app', tab: 'home' });
  route('/map', () => import('../pages/map.js'), { shell: 'app', tab: 'map', chrome: 'map' });
  route('/route', () => import('../pages/route.js'), { shell: 'app', tab: 'route' });
  route('/route/result', () => import('../pages/routeResult.js'), { shell: 'app', tab: 'route', chrome: 'map' });
  route('/navigate', () => import('../pages/navigate.js'), { shell: 'app', tab: 'route', chrome: 'map' });
  route('/saved', () => import('../pages/saved.js'), { shell: 'app', tab: 'saved' });
  route('/settings', () => import('../pages/settings.js'), { shell: 'app', tab: 'profile' });
  route('/report', () => import('../pages/report.js'), { shell: 'app', tab: 'map' });
  route('/segment/:id', () => import('../pages/segment.js'), { shell: 'app', tab: 'map' });

  // --- static content ------------------------------------------------------
  route('/privacy', () => import('../pages/info.js'), { shell: 'app', tab: 'profile', doc: 'privacy' });
  route('/data-sources', () => import('../pages/info.js'), { shell: 'app', tab: 'profile', doc: 'dataSources' });
  route('/methodology', () => import('../pages/info.js'), { shell: 'app', tab: 'profile', doc: 'methodology' });
  route('/responsible-ai', () => import('../pages/info.js'), { shell: 'app', tab: 'profile', doc: 'responsibleAi' });

  // --- municipality console -------------------------------------------------
  route('/admin', () => import('../admin/overview.js'), { shell: 'admin', nav: 'overview' });
  route('/admin/map', () => import('../admin/map.js'), { shell: 'admin', nav: 'map' });
  route('/admin/reports', () => import('../admin/reports.js'), { shell: 'admin', nav: 'reports' });
  route('/admin/priorities', () => import('../admin/priorities.js'), { shell: 'admin', nav: 'priorities' });
  route('/admin/coverage', () => import('../admin/coverage.js'), { shell: 'admin', nav: 'coverage' });
  route('/admin/ingestion', () => import('../admin/ingestion.js'), { shell: 'admin', nav: 'ingestion' });
  route('/admin/validation', () => import('../admin/validation.js'), { shell: 'admin', nav: 'validation' });
  route('/admin/settings', () => import('../admin/settings.js'), { shell: 'admin', nav: 'settings' });
  route('/admin/login', () => import('../admin/login.js'), { shell: 'none' });
}
