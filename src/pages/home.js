/**
 * Home.
 *
 * Four jobs, in this order: say what the product does in one sentence, get the
 * user to a route or the map in one tap, offer the shortcuts they are most
 * likely to want, and show the real coverage numbers. The statistics come from
 * the live database - if nothing has been imported yet, it says so rather than
 * showing zeroes dressed up as data.
 */

import { el, mount, on } from '../utils/dom.js';
import { t } from '../i18n/index.js';
import { setHeader, getOutlet, brandLink, avatarLink } from '../components/appShell.js';
import {
  statusGuide, stat, banner, button, sectionTitle, sectionHead,
  spinner, quickActionCard, alertRow, severityBadge
} from '../components/ui.js';
import { icon } from '../components/icons.js';
import { formatNetworkLength, formatPercent, formatNumber } from '../utils/format.js';
import { appState } from '../app.js';
import { navigate } from '../router/index.js';
import { SegmentStatus } from '@shared/constants.js';
import { getUser, onAuthChange } from '../services/auth.js';
import { readCachedBootstrap } from '../services/api.js';

export async function render() {
  const paintHeader = () => {
    const user = getUser();
    setHeader({
      left: brandLink(),
      right: avatarLink(user?.displayName || user?.email, { anonymous: !user || user.isAnonymous })
    });
  };
  paintHeader();

  const statsSlot = el('div', {}, spinner());
  const barriersSlot = el('div', {}, spinner());
  const outlet = getOutlet();

  const destinationInput = el('input', {
    type: 'search',
    name: 'destination',
    placeholder: t('home.destinationPlaceholder'),
    'aria-label': t('home.destinationLabel'),
    enterkeyhint: 'search',
    autocomplete: 'off'
  });
  destinationInput.id = 'home-destination';

  const searchForm = el('form.search-field', {
    role: 'search',
    onSubmit: (event) => {
      event.preventDefault();
      const query = destinationInput.value.trim();
      navigate(query ? `/route?to=${encodeURIComponent(query)}` : '/route');
    }
  }, [
    el('span.search-field__icon', { 'aria-hidden': 'true' }, icon('pin', 18)),
    destinationInput,
    el('button.search-field__go', { type: 'submit', 'aria-label': t('home.findRoute') }, icon('search', 18))
  ]);

  mount(outlet, [
    el('section.hero', {}, [
      /**
       * A photograph of the place the app is about, bled into the sky band.
       *
       * Decoration, and marked as such: it carries no information the text
       * does not, so it is hidden from assistive technology and given an empty
       * alt rather than a description of a sunset. It is also the largest
       * thing on the first screen, so it is fetched eagerly and sized in the
       * markup - a hero that reflows once the image lands is worse than no
       * hero at all.
       */
      el('img.hero__art', {
        src: `${import.meta.env.BASE_URL}brand/pafos-harbour.jpg`,
        alt: '',
        'aria-hidden': 'true',
        width: 706,
        height: 690,
        loading: 'eager',
        decoding: 'async',
        fetchpriority: 'high'
      }),
      el('div.hero__inner', {}, [
        el('h1.hero__title', {}, [
          t('home.headlineLead'),
          ' ',
          el('span.hero__script', {}, t('home.headlineAccent'))
        ]),
        el('p.hero__sub', {}, t('home.subheading')),
        el('div.stack-sm', { style: { marginTop: 'var(--s-5)' } }, [
          searchForm,
          el('div.hero__actions', {}, [
            button(t('home.findRoute'), {
              // The deep teal of the brand, not the brighter scan blue: this
              // is the page's main action, and the accent is reserved for AI
              // and imagery affordances.
              variant: 'primary', icon: 'route', block: true,
              onClick: () => navigate('/route')
            }),
            el('a.btn.btn--secondary.btn--block', { href: '/map' }, [icon('map', 18), t('home.exploreMap')])
          ])
        ])
      ])
    ]),

    el('div.page.stack-lg', {}, [
      el('section', {}, [
        sectionHead(t('home.quickTitle')),
        el('div.quick-grid', {}, [
          quickActionCard({
            href: '/route', iconName: 'route2', tone: 'accent',
            title: t('home.quickRoute'), description: t('home.quickRouteDesc')
          }),
          quickActionCard({
            href: '/map', iconName: 'map', tone: 'brand',
            title: t('home.quickMap'), description: t('home.quickMapDesc')
          }),
          quickActionCard({
            href: '/report', iconName: 'flag', tone: 'partial',
            title: t('home.quickReport'), description: t('home.quickReportDesc')
          }),
          quickActionCard({
            href: '/saved', iconName: 'bookmark', tone: 'accessible',
            title: t('home.quickSaved'), description: t('home.quickSavedDesc')
          })
        ])
      ]),

      el('section', {}, [
        sectionHead(t('home.coverageTitle'), {
          action: el('a.link-button', { href: '/methodology' }, [
            t('home.learnMethodology'), icon('chevronRight', 14)
          ])
        }),
        statsSlot
      ]),

      el('section', {}, [
        sectionHead(t('home.barriersTitle'), { sub: t('home.barriersSub') }),
        barriersSlot
      ]),

      el('section.stack-sm', {}, [
        sectionTitle(t('home.guideTitle')),
        statusGuide(),
        el('p.xs.muted', {}, t('legend.unknownNote'))
      ]),

      el('section.card.stack-sm', {}, [
        el('h3', {}, t('home.howItWorks')),
        el('p.small.muted', {}, t('home.howItWorksBody')),
        el('a.link-button', { href: '/methodology' }, [t('home.learnMethodology'), icon('chevronRight', 14)])
      ]),

      el('section.stack-sm', {}, [
        el('div.row.row--wrap', { style: { gap: '8px' } }, [
          el('a.btn.btn--ghost.btn--sm', { href: '/data-sources' }, t('settings.dataSources')),
          el('a.btn.btn--ghost.btn--sm', { href: '/responsible-ai' }, t('settings.responsibleAi')),
          el('a.btn.btn--ghost.btn--sm', { href: '/privacy' }, t('settings.privacy'))
        ])
      ])
    ])
  ]);

  /**
   * Coverage numbers arrive with the bootstrap payload.
   *
   * Both of these sections used to spin on every single visit while a callable
   * answered. The last payload the server sent is kept on the device, so a
   * returning visitor gets the figures at once and the live ones replace them
   * when they arrive - usually before there is time to read the old ones.
   *
   * Nothing here is estimated or carried forward: what is painted early is a
   * payload the server published, and if the refresh never arrives the reader
   * is told that rather than left believing the figures are current.
   */
  const paint = (data) => {
    renderStats(statsSlot, data);
    renderTopBarriers(barriersSlot, data);
  };

  let paintedFromCache = false;
  if (appState.bootstrap) {
    paint(appState.bootstrap);
  } else {
    const cachedBootstrap = readCachedBootstrap();
    if (cachedBootstrap) {
      paint(cachedBootstrap.data);
      paintedFromCache = true;
    }
  }

  const offAuth = onAuthChange(paintHeader);
  const offReady = on(window, 'accesspafos:bootstrap', (event) => {
    paintedFromCache = false;
    paint(event.detail || appState.bootstrap);
  });
  const offFailed = on(window, 'accesspafos:bootstrap-failed', () => {
    // Figures already on screen are real and stay. Replacing them with an error
    // would throw away the only numbers available; what the reader needs to
    // know is that they could not be refreshed.
    if (paintedFromCache) {
      statsSlot.append(banner(t('home.staleFigures'), { tone: 'neutral' }));
      return;
    }
    mount(statsSlot, banner(t('error.network'), { tone: 'warning' }));
    mount(barriersSlot, banner(t('error.network'), { tone: 'warning' }));
  });

  return { destroy() { offAuth?.(); offReady(); offFailed(); } };
}

function renderStats(slot, data) {
  const stats = data?.stats;
  const region = data?.regions?.find((r) => r.id === data.defaultRegionId);

  if (!stats || !stats.metres?.total) {
    mount(slot, banner(
      `${t('home.noDataTitle')} — ${t('home.noDataBody')}`,
      { tone: 'neutral' }
    ));
    return;
  }

  const m = stats.metres;
  const pct = stats.percentOfNetwork;
  const barrierSegments = (stats.counts?.byStatus?.[SegmentStatus.INACCESSIBLE] || 0)
    + (stats.counts?.byStatus?.[SegmentStatus.PARTIAL] || 0);

  mount(slot, el('div.stack-sm', {}, [
    el('div.stats', {}, [
      stat(formatPercent(pct.assessed / 100, { fractionDigits: 0 }), t('home.statAssessed'),
        { iconName: 'wheelchair', tone: 'brand' }),
      stat(formatNetworkLength(m.total, { compact: true }), t('home.statNetwork'),
        { iconName: 'route', tone: 'accent' }),
      stat(formatNumber(barrierSegments), t('home.statBarriers'),
        { iconName: 'warning', tone: 'inaccessible' }),
      stat(formatPercent(pct.unknown / 100, { fractionDigits: 0 }), t('home.statUnknown'),
        { iconName: 'eye', tone: 'unknown' })
    ]),
    el('p.xs.muted', {}, t('home.coverageNote', { region: region?.name || data.defaultRegionId })),
    pct.manuallyVerified > 0
      ? el('p.xs.muted', {}, `${formatPercent(pct.manuallyVerified / 100, { fractionDigits: 1 })} ${t('home.statVerified').toLowerCase()}.`)
      : null
  ]));
}

/**
 * The barriers the priority index currently ranks highest.
 *
 * These are real segments from the live database. If nothing has been assessed
 * yet the section says so - it never fills itself with examples.
 */
function renderTopBarriers(slot, data) {
  const items = Array.isArray(data?.topBarriers) ? data.topBarriers : [];

  if (items.length === 0) {
    mount(slot, el('div.card', {}, el('p.small.muted', { style: { margin: '0' } },
      data?.stats?.metres?.total ? t('home.barriersEmpty') : t('home.noDataTitle'))));
    return;
  }

  mount(slot, el('div.alert-list', {}, items.map((item) => alertRow({
    href: `/segment/${encodeURIComponent(item.id)}`,
    iconName: barrierIcon(item.primaryBarrier),
    tone: item.status === SegmentStatus.INACCESSIBLE ? 'inaccessible' : 'partial',
    title: item.name || t('segment.unnamed'),
    meta: [
      item.primaryBarrier ? el('span', {}, t(`barrier.${item.primaryBarrier}`)) : null,
      item.primaryBarrier && item.status ? el('span', { 'aria-hidden': 'true' }, '\u00b7') : null,
      item.status ? el('span', {}, t(`status.${item.status}`)) : null
    ].filter(Boolean),
    trailing: item.priorityBand ? severityBadge(item.priorityBand) : undefined
  }))));
}

const BARRIER_ICONS = {
  steps: 'steps',
  missing_curb_ramp: 'kerb',
  crossing_without_ramp: 'kerb',
  high_kerb: 'kerb',
  narrow_width: 'width',
  steep_incline: 'incline',
  damaged_surface: 'surface',
  unsuitable_surface: 'surface',
  blocking_obstacle: 'block',
  no_pedestrian_path: 'block',
  restricted_passage: 'block'
};

function barrierIcon(id) {
  return BARRIER_ICONS[id] || 'warning';
}
