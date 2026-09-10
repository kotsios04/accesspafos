/**
 * Saved places, saved routes and the user's own reports.
 *
 * Anonymous users see device-local saves; a signed-in user sees the same list
 * from their account. Their own reports are readable under the security rules
 * without any special endpoint, so this reads Firestore directly.
 */

import { el, mount } from '../utils/dom.js';
import { t } from '../i18n/index.js';
import { setHeader, getOutlet } from '../components/appShell.js';
import { icon } from '../components/icons.js';
import { emptyState, spinner, sectionTitle, statusPill, banner } from '../components/ui.js';
import { formatDistance, formatDate } from '../utils/format.js';
import { listSaved, removeItem, listMyReports } from '../services/saved.js';
import { isSignedIn } from '../services/auth.js';
import { navigate } from '../router/index.js';
import { appState } from '../app.js';

export async function render() {
  setHeader({ title: t('saved.title') });
  const container = el('div.page.stack-lg');
  mount(getOutlet(), container);
  mount(container, spinner());

  const [places, routes, reports] = await Promise.all([
    listSaved('places'),
    listSaved('routes'),
    listMyReports()
  ]);

  const nodes = [];

  if (!isSignedIn()) {
    nodes.push(banner(t('saved.signedOutNote'), { tone: 'neutral' }));
  }

  nodes.push(section(t('saved.places'), places, (place) => el('div.list-item', {}, [
    icon('pin', 18),
    el('div', {}, [
      el('div.list-item__title', {}, place.name || place.displayName),
      el('div.list-item__meta', {}, place.displayName || '')
    ]),
    removeButton('places', place.id)
  ])));

  nodes.push(section(t('saved.routes'), routes, (route) => el('button.list-item', {
    type: 'button',
    onClick: () => {
      appState.lastRoutePlan = null;
      navigate(`/route?to=${encodeURIComponent(route.destination?.name || '')}`);
    }
  }, [
    icon('route', 18),
    el('div', {}, [
      el('div.list-item__title', {}, route.name),
      el('div.list-item__meta', {}, [
        formatDistance(route.distanceMeters),
        route.profile ? ` · ${t(`profile.${route.profile}`)}` : ''
      ].join(''))
    ]),
    removeButton('routes', route.id)
  ])));

  nodes.push(el('section.stack-sm', {}, [
    sectionTitle(t('saved.reports')),
    reports.length
      ? el('div.stack-sm', {}, reports.map((report) => el('div.list-item', {}, [
        icon('flag', 18),
        el('div', {}, [
          el('div.list-item__title', {}, t(`report.category_${report.category}`)),
          el('div.list-item__meta', {}, [
            formatDate(report.createdAt),
            report.streetName ? ` · ${report.streetName}` : ''
          ].join(''))
        ]),
        el('span.pill.pill--neutral', {}, t(`report.status_${report.status}`))
      ])))
      : el('p.small.muted', {}, t('saved.emptyReports'))
  ]));

  mount(container, nodes);
  return {};

  function section(title, items, renderItem) {
    return el('section.stack-sm', {}, [
      sectionTitle(title),
      items.length
        ? el('div.stack-sm', {}, items.map(renderItem))
        : el('p.small.muted', {}, t('saved.emptyBody'))
    ]);
  }

  function removeButton(kind, id) {
    return el('button.btn.btn--ghost.btn--icon.btn--sm', {
      type: 'button',
      'aria-label': t('saved.remove'),
      onClick: async (event) => {
        await removeItem(kind, id);
        event.target.closest('.list-item')?.remove();
      }
    }, icon('trash', 16));
  }
}
