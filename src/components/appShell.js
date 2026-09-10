/**
 * The application shell: header, bottom navigation, and the outlet the
 * router renders pages into.
 *
 * The shell persists across navigations. Only the outlet is replaced, which
 * keeps the map instance alive between route changes and avoids the visible
 * re-mount that would otherwise happen every time someone taps a tab.
 */

import { el, mount } from '../utils/dom.js';
import { t } from '../i18n/index.js';
import { icon, brandMark } from './icons.js';
import { demoMode } from '../config/env.js';

/**
 * Five destinations, with reporting raised into the centre.
 *
 * Reporting gets the prominent slot because it is the only action someone
 * may need to take while standing in front of the barrier itself; everything
 * else can wait until they are sitting down.
 */
const TABS = [
  { path: '/', key: 'home', iconName: 'home' },
  { path: '/map', key: 'map', iconName: 'map' },
  { path: '/report', key: 'report', iconName: 'plus', center: true },
  { path: '/route', key: 'route', iconName: 'route' },
  { path: '/settings', key: 'profile', iconName: 'user' }
];

let refs = null;

export function renderShell(container) {
  const outlet = el('main#main.app-main', { tabindex: '-1' });

  const header = el('header.app-header', { hidden: true }, [
    el('div.app-header__inner')
  ]);

  const nav = el('nav.bottom-nav', { 'aria-label': t('nav.home') }, [
    el('div.bottom-nav__inner', {}, TABS.map(navItem))
  ]);

  mount(container, header, outlet, nav);

  if (demoMode) {
    document.body.append(el('div.demo-badge', { role: 'note' }, t('app.demoData')));
  }

  refs = { header, outlet, nav, container };
  refreshSkipLink();
  return refs;
}

function navItem(tab) {
  if (tab.center) {
    return el('a.nav-item.nav-item--center', { href: tab.path, 'data-nav': tab.key }, [
      el('span.nav-fab', { 'aria-hidden': 'true' }, icon(tab.iconName, 24)),
      el('span', {}, t(`nav.${tab.key}`))
    ]);
  }
  return el('a.nav-item', { href: tab.path, 'data-nav': tab.key }, [
    icon(tab.iconName, 21),
    el('span', {}, t(`nav.${tab.key}`))
  ]);
}

export function getOutlet() { return refs?.outlet; }

/**
 * Configure the header for the current page.
 * `mode: 'hidden'` is used by the map, which owns the whole viewport.
 */
export function setHeader({ title, mode = 'default', left, right } = {}) {
  if (!refs) return;
  const { header } = refs;
  const inner = header.firstElementChild;

  header.hidden = mode === 'hidden';
  header.classList.toggle('app-header--transparent', mode === 'transparent');
  if (header.hidden) return;

  mount(inner,
    left || (title ? null : brandLink()),
    title ? el('h1.app-header__title', {}, title) : null,
    right || null
  );
}

/**
 * The badge-plus-wordmark lockup.
 *
 * The subtitle is a plain description of what the project is. It deliberately
 * does not name the Municipality: this is an independent submission and the
 * header must not read as an official municipal service.
 */
export function brandLink({ subtitle = true } = {}) {
  return el('a.brand', { href: '/', 'aria-label': t('app.name') }, [
    brandMark(38),
    el('span.brand__text', {}, [
      el('span.brand__name', {}, ['AccessPafos ', el('span.brand__ai', {}, 'AI')]),
      subtitle && el('span.brand__sub', {}, t('app.tagline'))
    ])
  ]);
}

/** Initials only. There is no photo to show and inventing one would be a lie. */
export function avatarLink(label, { href = '/settings', anonymous = false } = {}) {
  const initials = toInitials(label);
  return el(`a.avatar${anonymous ? '.avatar--anon' : ''}`, {
    href,
    'aria-label': t('nav.profile')
  }, initials || icon('user', 18));
}

function toInitials(label) {
  if (!label) return '';
  const cleaned = String(label).split('@')[0].replace(/[._-]+/g, ' ').trim();
  if (!cleaned) return '';
  const parts = cleaned.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || '').join('');
}

export function backButton(onClick) {
  return el('button.btn.btn--ghost.btn--icon', {
    type: 'button',
    'aria-label': t('app.back'),
    onClick: onClick || (() => window.history.back())
  }, icon('arrowLeft', 20));
}

/** The skip link lives in index.html, so it needs translating separately. */
export function refreshSkipLink() {
  const link = document.querySelector('.skip-link');
  if (link) link.textContent = t('app.skipToContent');
}

export function setNavVisible(visible) {
  if (refs) refs.nav.hidden = !visible;
}

/** Mark the active tab for both sighted users and assistive technology. */
export function setActiveTab(path) {
  if (!refs) return;
  const normalised = path === '/' ? '/' : `/${path.split('/')[1] || ''}`;
  for (const link of refs.nav.querySelectorAll('.nav-item')) {
    const isActive = link.getAttribute('href') === normalised;
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

/** Re-render the shell's own strings after a language switch. */
export function refreshShellStrings() {
  refreshSkipLink();
  if (!refs) return;
  for (const link of refs.nav.querySelectorAll('.nav-item')) {
    const key = link.dataset.nav;
    // The label is the item's own last element child. `querySelector` walks the
    // whole subtree in document order, which on the raised centre item found
    // the icon span nested inside the FAB first - so switching language wrote
    // the label over the icon's SVG and left the real label in English.
    const label = link.lastElementChild;
    if (label && !label.classList.contains('nav-fab')) label.textContent = t(`nav.${key}`);
  }
}
