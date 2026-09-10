/**
 * Route results.
 *
 * The screen that makes the argument: three routes, side by side, with the
 * trade-off stated in numbers. A user should be able to see at a glance that
 * the accessible route is 260 m longer and why that 260 m is worth walking.
 */

import { el, mount, on } from '../utils/dom.js';
import { t } from '../i18n/index.js';
import { setHeader, getOutlet, backButton } from '../components/appShell.js';
import { icon } from '../components/icons.js';
import {
  banner, compositionBar, statusPill, button, sectionTitle, emptyState, scoreRing
} from '../components/ui.js';
import { formatDistance, formatDuration } from '../utils/format.js';
import { appState } from '../app.js';
import { navigate } from '../router/index.js';
import { saveItem } from '../services/saved.js';
import { toastSuccess } from '../services/toast.js';
import { RouteVariant, SegmentStatus } from '@shared/constants.js';
import { classifySegment } from '@shared/classify.js';

const VARIANT_LABEL = {
  [RouteVariant.RECOMMENDED]: 'route.recommended',
  [RouteVariant.BALANCED]: 'route.balanced',
  [RouteVariant.SHORTEST]: 'route.shortest'
};
const VARIANT_DESC = {
  [RouteVariant.RECOMMENDED]: 'route.recommendedDesc',
  [RouteVariant.BALANCED]: 'route.balancedDesc',
  [RouteVariant.SHORTEST]: 'route.shortestDesc'
};

export async function render() {
  const stored = appState.lastRoutePlan;
  if (!stored) { navigate('/route', { replace: true }); return {}; }

  const { plan, origin, destination, profile } = stored;
  setHeader({ mode: 'hidden' });

  const canvas = el('div', { style: { position: 'absolute', inset: '0 0 46% 0' } });
  const panel = el('div', {
    style: {
      position: 'absolute', left: '0', right: '0', bottom: '0',
      height: '48%', overflowY: 'auto',
      background: 'var(--surface)',
      borderRadius: 'var(--r-xl) var(--r-xl) 0 0',
      boxShadow: 'var(--shadow-sheet)',
      padding: 'var(--s-4)',
      paddingBottom: 'calc(var(--nav-height) + var(--safe-bottom) + var(--s-4))'
    }
  });

  const topBar = el('div', {
    style: {
      position: 'absolute', top: 'calc(var(--safe-top) + 12px)', left: '12px', zIndex: '30'
    }
  }, backButton(() => navigate('/route')));

  mount(getOutlet(), el('div', { style: { position: 'absolute', inset: '0' } }, [canvas, topBar, panel]));

  const found = plan.options.filter((o) => o.found);
  const recommended = plan.options.find((o) => o.variant === RouteVariant.RECOMMENDED && o.found)
    || found[0];

  let selected = recommended;
  let map = null;
  let layers = null;
  let mapModule = null;
  let destroyed = false;

  renderPanel();

  try {
    mapModule = await import('../maps/map.js');
    layers = await import('../maps/layers.js');
    if (destroyed) return { destroy: teardown };

    map = await mapModule.createMap(canvas, { controls: false, ariaLabel: t('route.title') });
    await mapModule.whenReady(map);
    if (destroyed) return { destroy: teardown };

    layers.addRouteLayers(map);
    drawRoute();

    mapModule.createMarker({ color: '#1E88C7' }).setLngLat([origin.lng, origin.lat]).addTo(map);
    mapModule.createMarker({ color: '#1FA463' }).setLngLat([destination.lng, destination.lat]).addTo(map);
  } catch {
    // The metrics panel is fully usable without the map.
  }

  function drawRoute() {
    if (!map || !layers || !selected?.geometry) return;
    layers.setRoute(map, selected.geometry);
    layers.setAlternativeRoutes(map, found
      .filter((o) => o.variant !== selected.variant)
      .map((o) => o.geometry));
    mapModule.fitToGeometry(map, selected.geometry.coordinates, 56);
  }

  function renderPanel() {
    const nodes = [];

    if (plan.warning === 'no_accessible_route') {
      nodes.push(banner(
        `${t('route.noAccessibleRoute')} ${t('route.noAccessibleRouteBody')}`,
        { tone: 'warning' }
      ));
    } else if (plan.warning === 'high_unknown_coverage') {
      nodes.push(banner(t('route.highUnknown', { percent: plan.warningDetail.unknownPercent }), { tone: 'warning' }));
    }

    if (!found.length) {
      mount(panel, emptyState(t('route.noRoute'), null,
        button(t('app.back'), { variant: 'primary', onClick: () => navigate('/route') })));
      return;
    }

    nodes.push(sectionTitle(t('route.results')));
    nodes.push(el('div.route-options', {}, plan.options.map(routeCard)));

    if (selected?.found) {
      nodes.push(whySection(selected));
      nodes.push(stepsSection(selected));
      nodes.push(el('div.stack-sm', { style: { marginTop: '16px' } }, [
        button(t('route.startNavigation'), {
          variant: 'primary', block: true, icon: 'play',
          onClick: () => {
            appState.lastRoutePlan = { ...stored, selectedVariant: selected.variant };
            navigate('/navigate');
          }
        }),
        button(t('segment.savePlace'), {
          variant: 'ghost', block: true, icon: 'bookmark',
          onClick: async () => {
            await saveItem('routes', {
              name: `${origin.name || t('route.origin')} → ${destination.name || t('route.destination')}`,
              origin, destination, profile,
              distanceMeters: selected.distanceMeters,
              accessibilityScore: selected.accessibilityScore
            });
            toastSuccess(t('app.save'));
          }
        })
      ]));
      nodes.push(el('p.xs.muted', { style: { marginTop: '12px' } }, t('route.disclaimer')));
    }

    mount(panel, nodes);
  }

  function routeCard(option) {
    if (!option.found) {
      return el('div.route-option', { style: { opacity: '0.6' } }, [
        el('span.score-ring', { role: 'img', 'aria-label': t('route.noRoute') },
          el('span.score-ring__value', { 'aria-hidden': 'true' }, '\u2014')),
        el('div', {}, [
          el('div.route-option__head', {}, [
            el('span.route-option__name', {}, t(VARIANT_LABEL[option.variant])),
            el('span.pill.pill--neutral', {}, t('route.noRoute'))
          ]),
          el('p.route-option__desc', {},
            option.variant === RouteVariant.RECOMMENDED ? t('route.noAccessibleRouteBody') : t('route.noRoute'))
        ])
      ]);
    }

    const isSelected = selected?.variant === option.variant;

    return el('button.route-option', {
      type: 'button',
      'aria-pressed': String(isSelected),
      onClick: () => { selected = option; renderPanel(); drawRoute(); }
    }, [
      scoreRing(option.accessibilityScore, {
        status: ringStatus(option),
        label: `${t('route.accessibilityScore')}: ${option.accessibilityScore != null ? `${option.accessibilityScore}/100` : t('status.unverified')}`
      }),
      el('div', {}, [
        el('div.route-option__head', {}, [
          el('span.route-option__name', {}, t(VARIANT_LABEL[option.variant])),
          el('span.small.strong', {}, formatDistance(option.distanceMeters))
        ]),
        el('p.route-option__desc', {}, option.sameAsRecommended && option.variant !== RouteVariant.RECOMMENDED
          ? t('route.sameAsRecommended')
          : t(VARIANT_DESC[option.variant])),
        el('div.route-option__stats', {}, [
          routeStat('clock', formatDuration(option.durationSeconds, t), t('route.duration')),
          routeStat('chart', `${option.unknownPercent}%`, t('route.unknownShare')),
          option.extraDistanceMeters > 0
            ? routeStat('route', `+${formatDistance(option.extraDistanceMeters)}`, t('route.extraDistance'))
            : null
        ].filter(Boolean)),
        compositionBar(option.statusMeters, option.distanceMeters)
      ])
    ]);
  }

  /**
   * The colour of a route's ring comes from the same classifier the map uses,
   * so a route scoring 62 is amber in both places. `unknownPercent` stands in
   * for evidence confidence here: a route made mostly of unassessed segments
   * gets a grey ring rather than a flattering green one.
   */
  function ringStatus(option) {
    if (option.accessibilityScore == null) return null;
    return classifySegment({
      score: option.accessibilityScore,
      confidence: 100 - (option.unknownPercent ?? 100),
      hasAnyEvidence: true
    }).status;
  }

  function routeStat(iconName, value, label) {
    return el('span.route-stat', { title: label }, [
      el('span.route-stat__icon', { 'aria-hidden': 'true' }, icon(iconName, 13)),
      el('span.sr-only', {}, `${label}: `),
      value
    ]);
  }

  function whySection(option) {
    return el('div.card.stack-sm', { style: { marginTop: '16px' } }, [
      el('h3', { style: { fontSize: 'var(--text-md)' } }, [icon('info', 16), ' ', t('route.whyTitle')]),
      el('ul', {}, (option.reasons || []).map((reason) => el('li.small', {
        style: { listStyle: 'disc', marginLeft: '18px', marginBottom: '4px', color: 'var(--ink-2)' }
      }, translateReason(reason)))),
      option.barriersAvoided?.length
        ? el('div', {}, [
          el('p.xs.muted', { style: { marginTop: '8px' } }, t('route.barriersAvoided')),
          el('div.tag-list', {}, option.barriersAvoided.map((b) =>
            el('span.pill.pill--accessible', {}, t(`barrier.${b}`))))
        ])
        : null,
      option.barriersOnRoute?.length
        ? el('div', {}, [
          el('p.xs.muted', { style: { marginTop: '8px' } }, t('route.barriersOnRoute')),
          el('div.tag-list', {}, option.barriersOnRoute.map((b) =>
            el('span.pill.pill--inaccessible', {}, `${t(`barrier.${b.id}`)} · ${formatDistance(b.meters)}`)))
        ])
        : null
    ]);
  }

  function translateReason(reason) {
    const values = { ...(reason.values || {}) };
    if (Array.isArray(values.barriers)) {
      values.barriers = values.barriers.map((b) => t(`barrier.${b}`)).join(', ');
    }
    return t(reason.key, values);
  }

  function stepsSection(option) {
    if (!option.steps?.length) return null;
    return el('details', { style: { marginTop: '12px' } }, [
      el('summary.small.strong', { style: { cursor: 'pointer', padding: '8px 0' } }, t('route.steps')),
      el('div.step-list', {}, option.steps.map((step) => el('div.step', {}, [
        el('span.step__icon', {}, icon(manoeuvreIcon(step.manoeuvre), 18)),
        el('div', {}, [
          el('span.step__text', {}, manoeuvreText(step)),
          step.barriers?.length
            ? el('span.step__warn', { style: { display: 'block' } },
              t('route.ahead', { barrier: step.barriers.map((b) => t(`barrier.${b}`)).join(', ') }))
            : null
        ]),
        el('span.step__distance', {}, step.distanceMeters ? formatDistance(step.distanceMeters) : '')
      ])))
    ]);
  }

  function teardown() {
    destroyed = true;
    if (map) { map.remove(); map = null; }
  }

  return { destroy: teardown };
}

export function manoeuvreIcon(manoeuvre) {
  if (manoeuvre === 'turn_left' || manoeuvre === 'sharp_left') return 'turnLeft';
  if (manoeuvre === 'turn_right' || manoeuvre === 'sharp_right') return 'turnRight';
  if (manoeuvre === 'arrive') return 'finish';
  return 'straight';
}

export function manoeuvreText(step) {
  const key = step.streetName
    ? `route.manoeuvre.${step.manoeuvre}`
    : `route.manoeuvre.${step.manoeuvre}NoName`;
  return t(key, { street: step.streetName || '' });
}
