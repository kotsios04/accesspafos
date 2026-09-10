/**
 * Turn-by-turn navigation.
 *
 * Honest scope: this follows the user's position along a route the app has
 * already computed, announces the next manoeuvre, and warns about a barrier
 * before they reach it. It does not claim the route is safe, and it says so
 * on screen - a pavement can be blocked by a delivery van five minutes after
 * the imagery was analysed.
 */

import { el, mount, announce } from '../utils/dom.js';
import { t } from '../i18n/index.js';
import { setHeader, getOutlet } from '../components/appShell.js';
import { icon } from '../components/icons.js';
import { button, banner } from '../components/ui.js';
import { formatDistance, formatDuration } from '../utils/format.js';
import { watchPosition } from '../services/geolocate.js';
import { toastError } from '../services/toast.js';
import { track } from '../services/analytics.js';
import { navigate } from '../router/index.js';
import { appState } from '../app.js';
import { manoeuvreIcon, manoeuvreText } from './routeResult.js';
import { haversineMeters, pointToLineMeters } from '@shared/geo.js';

/** How far off the line before we say the user has left the route. */
const OFF_ROUTE_METERS = 35;
/** How close to the next manoeuvre before we advance to it. */
const ADVANCE_METERS = 18;
/** Warn about a barrier this far ahead. */
const BARRIER_WARNING_METERS = 60;

export async function render() {
  const stored = appState.lastRoutePlan;
  if (!stored) { navigate('/route', { replace: true }); return {}; }

  const option = stored.plan.options.find((o) => o.variant === (stored.selectedVariant || 'recommended') && o.found)
    || stored.plan.options.find((o) => o.found);

  if (!option) { navigate('/route/result', { replace: true }); return {}; }

  setHeader({ mode: 'hidden' });

  const coordinates = option.geometry.coordinates;
  const canvas = el('div.map-canvas');
  const bannerNode = el('div.nav-banner', { role: 'status', 'aria-live': 'polite' });
  const dock = el('div.nav-dock');

  mount(getOutlet(), el('div', { style: { position: 'absolute', inset: '0' } }, [
    canvas, bannerNode, dock
  ]));

  let stepIndex = 0;
  let map = null;
  let mapModule = null;
  let layers = null;
  let marker = null;
  let stopWatch = () => {};
  let destroyed = false;
  let offRoute = false;
  let remainingMeters = option.distanceMeters;

  renderBanner(null);
  renderDock();

  try {
    mapModule = await import('../maps/map.js');
    layers = await import('../maps/layers.js');
    if (destroyed) return { destroy: teardown };

    map = await mapModule.createMap(canvas, { controls: false, ariaLabel: t('route.navigating') });
    await mapModule.whenReady(map);
    if (destroyed) return { destroy: teardown };

    layers.addRouteLayers(map);
    layers.setRoute(map, option.geometry);
    mapModule.fitToGeometry(map, coordinates, 70);
  } catch {
    // Navigation still works as spoken/visible instructions without a map.
  }

  stopWatch = watchPosition(onPosition, (error) => {
    toastError(error.message);
  });

  track('route_navigation_started', { profile: stored.profile });

  function onPosition(position) {
    if (destroyed) return;
    const point = [position.lng, position.lat];

    if (map) {
      if (!marker) {
        marker = mapModule.createMarker({ color: '#176B87' }).setLngLat(point).addTo(map);
      } else {
        marker.setLngLat(point);
      }
      map.easeTo({ center: point, zoom: Math.max(map.getZoom(), 17), duration: 700 });
    }

    const snapped = pointToLineMeters(point, coordinates);
    offRoute = snapped.distance > OFF_ROUTE_METERS;

    // Advance through the step list as the user reaches each manoeuvre.
    const step = option.steps[stepIndex];
    if (step?.coordinate) {
      const distanceToStep = haversineMeters(point, step.coordinate);
      if (distanceToStep < ADVANCE_METERS && stepIndex < option.steps.length - 1) {
        stepIndex += 1;
        const next = option.steps[stepIndex];
        announce(manoeuvreText(next));
      }
    }

    remainingMeters = remainingDistance(coordinates, snapped);
    renderBanner(position);
    renderDock();

    if (stepIndex === option.steps.length - 1 && remainingMeters < 25) {
      announce(t('route.arrived'));
    }
  }

  function renderBanner() {
    const step = option.steps[stepIndex] || option.steps[option.steps.length - 1];
    const nextStep = option.steps[stepIndex + 1];
    const barriers = nextStep?.barriers || step?.barriers || [];

    mount(bannerNode, [
      el('div.row', { style: { gap: '12px', alignItems: 'flex-start' } }, [
        el('span', { style: { color: '#fff', marginTop: '2px' } }, icon(manoeuvreIcon(step?.manoeuvre), 26)),
        el('div', { style: { minWidth: 0 } }, [
          el('div.nav-banner__manoeuvre', {}, manoeuvreText(step || { manoeuvre: 'continue' })),
          el('div.nav-banner__detail', {}, step?.distanceMeters
            ? formatDistance(step.distanceMeters)
            : t('route.navigating'))
        ])
      ]),
      offRoute ? el('div.nav-banner__alert', {}, [icon('warning', 15), ' ', t('route.offRoute')]) : null,
      barriers.length
        ? el('div.nav-banner__alert', {}, [
          icon('warning', 15), ' ',
          t('route.ahead', { barrier: barriers.map((b) => t(`barrier.${b}`)).join(', ') })
        ])
        : null
    ]);
  }

  function renderDock() {
    mount(dock, [
      el('div', {}, [
        el('div.strong', {}, formatDistance(remainingMeters)),
        el('div.xs.muted', {}, formatDuration(
          (remainingMeters / Math.max(1, option.distanceMeters)) * option.durationSeconds, t))
      ]),
      el('div.row', { style: { gap: '8px' } }, [
        offRoute
          ? button(t('route.recalculate'), {
            variant: 'secondary', size: 'sm', icon: 'refresh',
            onClick: () => navigate('/route')
          })
          : null,
        button(t('route.stopNavigation'), {
          variant: 'danger', size: 'sm', icon: 'stop',
          onClick: () => { teardown(); navigate('/route/result'); }
        })
      ])
    ]);
  }

  function teardown() {
    destroyed = true;
    stopWatch();
    if (map) { map.remove(); map = null; }
  }

  return { destroy: teardown };
}

/** Distance from the snapped position to the end of the line. */
function remainingDistance(coordinates, snapped) {
  if (!snapped?.point) return 0;
  let total = haversineMeters(snapped.point, coordinates[snapped.index + 1] || snapped.point);
  for (let i = snapped.index + 1; i < coordinates.length - 1; i += 1) {
    total += haversineMeters(coordinates[i], coordinates[i + 1]);
  }
  return Math.round(total);
}
