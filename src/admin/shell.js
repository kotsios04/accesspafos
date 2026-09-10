/**
 * Municipality console shell.
 *
 * Desktop-first, because this is a workstation tool, but the sidebar collapses
 * to a drawer so it still works on the tablet somebody carries to a site
 * visit. Access is gated on a role claim, and the gate is a courtesy: the real
 * enforcement is in the security rules and in every callable function.
 */

import { el, mount, on } from '../utils/dom.js';
import { t } from '../i18n/index.js';
import { getOutlet } from '../components/appShell.js';
import { icon, brandMark } from '../components/icons.js';
import { initials } from '../utils/format.js';
import {
  getUser, getRole, isReviewer, isMunicipalityAdmin, signOut, initAuth
} from '../services/auth.js';
import { navigate } from '../router/index.js';
import { appState } from '../app.js';

const NAV = [
  { path: '/admin', key: 'overview', label: 'Overview', iconName: 'chart', minRole: 'reviewer' },
  { path: '/admin/map', key: 'map', label: 'Map', iconName: 'map', minRole: 'reviewer' },
  { path: '/admin/reports', key: 'reports', label: 'Reports', iconName: 'flag', minRole: 'reviewer' },
  { path: '/admin/priorities', key: 'priorities', label: 'Priorities', iconName: 'clipboard', minRole: 'reviewer' },
  { path: '/admin/coverage', key: 'coverage', label: 'Coverage', iconName: 'layers', minRole: 'reviewer' },
  { path: '/admin/ingestion', key: 'ingestion', label: 'Data ingestion', iconName: 'download', minRole: 'municipality_admin' },
  { path: '/admin/validation', key: 'validation', label: 'Validation', iconName: 'shield', minRole: 'reviewer' },
  { path: '/admin/settings', key: 'settings', label: 'Settings', iconName: 'settings', minRole: 'municipality_admin' }
];

/**
 * Render the console frame and return the content element for a page to
 * fill. Returns null when the user is not allowed in, having already
 * redirected them to the login screen.
 *
 * @param {{ nav: string, title: string, actions?: Node[] }} options
 */
export async function renderAdminShell({ nav, title, actions = [] }) {
  await initAuth();

  if (!isReviewer()) {
    navigate('/admin/login', { replace: true });
    return null;
  }

  const content = el('div.admin__content');
  const sidebar = el('aside.admin__sidebar', { id: 'admin-sidebar' });
  const scrim = el('div.admin__scrim', { hidden: true });

  const menuButton = el('button.btn.btn--ghost.btn--icon.admin__menu-btn', {
    type: 'button',
    'aria-label': 'Open navigation',
    'aria-expanded': 'false',
    'aria-controls': 'admin-sidebar'
  }, icon('menu', 20));

  const frame = el('div.admin', {}, [
    scrim,
    sidebar,
    el('div.admin__main', {}, [
      el('header.admin__topbar', {}, [
        menuButton,
        el('h1.admin__title', {}, title),
        ...actions
      ]),
      content
    ])
  ]);

  mount(getOutlet(), frame);
  renderSidebar(sidebar, nav);

  const toggle = (open) => {
    sidebar.dataset.open = String(open);
    scrim.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
  };
  on(menuButton, 'click', () => toggle(sidebar.dataset.open !== 'true'));
  on(scrim, 'click', () => toggle(false));
  on(sidebar, 'click', (event) => { if (event.target.closest('a')) toggle(false); });

  return content;
}

function renderSidebar(sidebar, activeKey) {
  const user = getUser();
  const role = getRole();

  mount(sidebar, [
    el('a.admin-brand', { href: '/' }, [
      brandMark(34),
      el('span.admin-brand__text', {}, [
        el('span.admin-brand__name', {}, ['AccessPafos ', el('span.brand__ai', {}, 'AI')]),
        el('span.admin-brand__sub', {}, 'Municipality console')
      ])
    ]),

    el('nav.admin-nav', { 'aria-label': 'Console sections' },
      NAV.filter((item) => item.minRole !== 'municipality_admin' || isMunicipalityAdmin())
        .map((item) => el('a.admin-nav__link', {
          href: item.path,
          'aria-current': item.key === activeKey ? 'page' : undefined
        }, [icon(item.iconName, 18), item.label]))),

    // A pointer to the methodology rather than a marketing panel. The first
    // question anyone asks of a score is how it was produced, and this block
    // makes no claim of its own about coverage or accuracy.
    el('div.admin-aside-card', {}, [
      el('div.admin-aside-card__title', {}, 'How scores are produced'),
      el('p.admin-aside-card__text', {}, 'Every rating traces back to the evidence behind it, with the confidence gate applied before the score.'),
      el('a.admin-aside-card__link', { href: '/methodology' }, ['Read the methodology', icon('chevronRight', 13)])
    ]),

    el('div.admin-user', {}, [
      // Initials only: no gravatars, no third-party avatar service, no extra
      // request that leaks a municipal email address to anybody.
      el('span.admin-user__avatar', { 'aria-hidden': 'true' }, initials(user?.email, user?.displayName)),
      el('div.admin-user__meta', {}, [
        el('div.admin-user__email', {}, user?.email || user?.uid || '—'),
        el('div.muted', {}, role.replace(/_/g, ' '))
      ]),
      el('button.btn.btn--ghost.btn--icon.btn--sm', {
        type: 'button',
        'aria-label': t('settings.signOut'),
        onClick: async () => { await signOut(); navigate('/admin/login'); }
      }, icon('logout', 17))
    ])
  ]);
}

/** The region every console page operates on. */
export function activeRegionId() {
  return appState.regionId
    || appState.bootstrap?.defaultRegionId
    || 'kato-pafos';
}

export function regionSelector(onChange) {
  const regions = appState.bootstrap?.regions || [];
  if (regions.length <= 1) return null;
  return el('select.select', {
    'aria-label': 'Region',
    style: { width: 'auto', minHeight: '38px' },
    onChange: (event) => onChange(event.target.value)
  }, regions.map((region) => el('option', {
    value: region.id,
    selected: region.id === activeRegionId()
  }, region.name)));
}

export { NAV };
