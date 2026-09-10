/**
 * The accessibility map.
 *
 * Map-first by design: it takes the whole viewport, and everything else -
 * search, filters, legend - floats above it. Tapping any street opens the
 * evidence behind its rating, which is the interaction the entire product
 * exists to make possible.
 */

import { el, mount, on, announce } from '../utils/dom.js';
import { t } from '../i18n/index.js';
import { setHeader, getOutlet } from '../components/appShell.js';
import { icon } from '../components/icons.js';
import { chip, banner, spinner, button } from '../components/ui.js';
import { openSheet, closeSheet } from '../components/sheet.js';
import { renderSegmentDetail } from '../components/segmentDetail.js';
import { appState } from '../app.js';
import {
  loadAccessibilityBundle, readCachedBundle, recallRegion, rememberRegion
} from '../services/bundle.js';
import { getSegmentDetail, searchPlace } from '../services/api.js';
import { getPref, setPrefs } from '../services/prefs.js';
import { getCurrentPosition, primeLocation, readCachedPosition } from '../services/geolocate.js';
import { isDemoActive, setDemoActive, onDemoChange, simulateBundle } from '../services/demo.js';
import { toastError, toast } from '../services/toast.js';
import { describeError } from '../services/errors.js';
import { track } from '../services/analytics.js';
import { navigate } from '../router/index.js';
import { SegmentStatus, STATUS_COLORS, STATUS_GLYPH } from '@shared/constants.js';

const FILTERS = [
  { key: 'all', labelKey: 'map.filterAll' },
  { key: 'accessible', labelKey: 'map.filterAccessible', color: STATUS_COLORS.accessible },
  { key: 'partial', labelKey: 'map.filterPartial', color: STATUS_COLORS.partial },
  { key: 'barriers', labelKey: 'map.filterBarriers', color: STATUS_COLORS.inaccessible },
  { key: 'verified', labelKey: 'map.filterVerified' },
  { key: 'recent', labelKey: 'map.filterRecent' },
  { key: 'wheelchair', labelKey: 'map.filterWheelchair' }
];

export async function render({ query }) {
  setHeader({ mode: 'hidden' });

  const canvas = el('div.map-canvas', { id: 'map-canvas' });
  const status = el('div');

  // Always present, hidden unless the projection is on. A bar rather than a
  // badge, and the way out lives inside it: a demo you cannot obviously leave
  // is a demo somebody forgets they are in.
  const demoBar = el('div.demo-bar', { hidden: !isDemoActive() }, [
    el('span.demo-bar__icon', { 'aria-hidden': 'true' }, icon('eye', 15)),
    el('div.demo-bar__text', {}, [
      el('strong.xs', {}, t('app.demoTitle')),
      el('span.xs', {}, t('app.demoBanner'))
    ]),
    el('button.demo-bar__exit', {
      type: 'button', onClick: () => setDemoActive(false)
    }, t('app.demoExit'))
  ]);
  const chipsRow = el('div.map-filters', { role: 'group', 'aria-label': t('map.filters') });

  const searchInput = el('input', {
    type: 'search',
    placeholder: t('map.searchPlaceholder'),
    'aria-label': t('map.searchPlaceholder'),
    enterkeyhint: 'search',
    autocomplete: 'off'
  });

  const searchForm = el('form.map-search', { role: 'search' }, [
    el('span', { style: { display: 'flex', color: 'var(--muted)' } }, icon('search', 18)),
    searchInput,
    el('button.btn.btn--accent.btn--sm.btn--icon', {
      type: 'submit', 'aria-label': t('app.search')
    }, icon('chevronRight', 18))
  ]);

  /**
   * All four states, glyph included.
   *
   * Grey is listed with the rest rather than tucked into a footnote: "not
   * assessed" is a result this map has to be able to report, and a legend that
   * omits it invites the reader to assume the grey streets are simply bad.
   */
  const legend = el('div.legend.legend--floating', {}, [
    el('button.legend__close', {
      type: 'button', 'aria-label': t('legend.hide'), onClick: () => setLegendOpen(false)
    }, icon('close', 14)),
    el('div.legend__title', {}, t('legend.title')),
    el('div.legend__items', {}, [
      SegmentStatus.ACCESSIBLE, SegmentStatus.PARTIAL,
      SegmentStatus.INACCESSIBLE, SegmentStatus.UNVERIFIED
    ].map((s) => el('span.legend__item', {}, [
      el('span.legend__swatch', {
        style: s === SegmentStatus.UNVERIFIED
          ? { background: 'transparent', backgroundImage: `repeating-linear-gradient(90deg,${STATUS_COLORS[s]} 0 4px,transparent 4px 7px)` }
          : { background: STATUS_COLORS[s] },
        'aria-hidden': 'true'
      }),
      el('span.legend__glyph', { 'aria-hidden': 'true' }, STATUS_GLYPH[s]),
      t(`status.${s}`)
    ])))
  ]);

  /**
   * The legend can be folded away.
   *
   * On a phone the card covers a real slice of the map, and a reader who has
   * learned the four colours does not need it standing there. Closing it leaves
   * a labelled button in its place, so the key is never lost - only the space
   * it was taking - and the choice is remembered on the device.
   */
  const legendToggle = el('button.legend-toggle', {
    type: 'button', 'aria-label': t('legend.show'), onClick: () => setLegendOpen(true)
  }, icon('layers', 18));

  function setLegendOpen(open) {
    legend.hidden = !open;
    legendToggle.hidden = open;
    // Local only: this is a per-screen choice, not a profile setting.
    setPrefs({ legendCollapsed: !open }, { sync: false });
  }

  legend.hidden = getPref('legendCollapsed') === true;
  legendToggle.hidden = !legend.hidden;

  const screen = el('div.map-screen', {}, [
    canvas,
    el('div.map-overlay', {}, [searchForm, chipsRow, status]),
    legend,
    legendToggle,
    // Locate only. A "Report a barrier" pill used to sit here as well, which
    // both duplicated the Report button in the middle of the bottom navigation
    // and, at 375px, ran off the right edge of the screen.
    demoBar,
    el('div.map-fab', {}, [
      el('button.fab.fab--icon', {
        type: 'button', 'aria-label': t('map.locateMe'), onClick: locate
      }, icon('locate', 20))
    ])
  ]);

  mount(getOutlet(), el('div.page--full', { style: { position: 'absolute', inset: '0' } }, screen));

  // --- state ---------------------------------------------------------------
  const activeFilters = new Set(['all']);
  let map = null;
  let layers = null;
  let mapModule = null;
  let userMarker = null;
  let destroyed = false;
  let framed = false;
  // The real bundle is kept as it arrived. Leaving the projection is then just
  // a redraw, and the projection is never the thing held in memory.
  let realBundle = null;
  let realRegion = null;

  renderChips();

  // --- boot the map --------------------------------------------------------
  mount(status, spinner(t('map.loadingLayer')));

  try {
    mapModule = await import('../maps/map.js');
    layers = await import('../maps/layers.js');
    if (destroyed) return teardown();

    map = await mapModule.createMap(canvas, { ariaLabel: t('map.title') });
    await mapModule.whenReady(map);
    if (destroyed) return teardown();

    // Start a position fix now, but only for someone who has already granted
    // permission - see primeLocation. By the time they reach for the locate
    // button the answer is usually already in hand. Nothing awaits this and a
    // failure is ignored: it is an optimisation, not a step.
    primeLocation();

    /**
     * Draw whatever is already on the device, then check the server.
     *
     * The slow part of opening this screen was never the map: it was waiting
     * for the `bootstrap` callable to say which bundle to fetch, and then
     * fetching a few megabytes of it, before anything could be drawn. Both are
     * skippable for someone who has been here before. The bundle URL carries
     * its version, so a cache hit is the published data for that version and
     * not an approximation of it - and the version is verified below either
     * way, so a device that is behind corrects itself as soon as the callable
     * answers.
     */
    let drawn = null;
    const remembered = recallRegion();
    if (remembered) {
      const cachedBundle = await readCachedBundle(remembered);
      if (destroyed) return teardown();
      if (cachedBundle) {
        showBundle(remembered, cachedBundle);
        drawn = remembered;
      }
    }

    const region = await resolveRegion();
    if (destroyed) return teardown();

    if (!region) {
      // Nothing from the server. If something is on screen it is real published
      // data and stays; the banner says only that it could not be refreshed,
      // because "this may be out of date" is the honest claim here, not "there
      // is no data".
      mount(status, banner(
        drawn ? t('map.offlineCached') : t('error.noRegion'),
        { tone: 'neutral' }
      ));
    } else {
      rememberRegion(region);

      const upToDate = drawn
        && drawn.id === region.id
        && drawn.bundleVersion === region.bundleVersion;

      if (upToDate) {
        hint();
      } else {
        const bundle = await loadAccessibilityBundle(region);
        if (destroyed) return teardown();
        if (!bundle) {
          if (!drawn) mount(status, banner(t('error.noRegion'), { tone: 'neutral' }));
        } else {
          showBundle(region, bundle);
          hint();
        }
      }
    }

    wireInteractions();

    if (query.segment) openSegment(query.segment);
  } catch (error) {
    mount(status, banner(describeError(error), { tone: 'danger' }));
  }

  /**
   * Put a bundle on the map.
   *
   * `addAccessibilityLayer` replaces the source data when the layer already
   * exists, so this is also the update path when the cached version turns out
   * to be behind the server. The viewport is only framed once: moving the map
   * under someone a second later, after they have started panning, is worse
   * than opening on a slightly wider view.
   */
  function showBundle(forRegion, bundle) {
    realRegion = forRegion;
    realBundle = bundle;
    const drawn = isDemoActive() ? simulateBundle(bundle) : bundle;
    layers.addAccessibilityLayer(map, drawn);
    if (!framed) {
      framed = true;
      mapModule.fitToBbox(map, openingView(bundle, forRegion), 40);
    }
    applyFilters();
    track('map_opened', { segments: bundle.features?.length || 0 });
  }

  /** The one-off "tap a street" hint, shown once the real data is in place. */
  function hint() {
    mount(status, el('div.banner.banner--neutral', {}, [
      el('span.banner__icon', {}, icon('info', 15)),
      el('span.xs', {}, t('map.tapSegment'))
    ]));
    setTimeout(() => { if (!destroyed) status.replaceChildren(); }, 6000);
  }

  // --- interactions --------------------------------------------------------
  function wireInteractions() {
    if (!map || !layers) return;

    map.on('click', layers.LAYER_HITBOX, (event) => {
      const feature = event.features?.[0];
      if (!feature?.properties?.id) return;
      // A projected segment must never open the evidence view - there is no
      // evidence. It gets told so instead.
      openSegment(feature.properties.id, feature.properties.simulated === true);
    });

    map.on('mouseenter', layers.LAYER_HITBOX, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layers.LAYER_HITBOX, () => { map.getCanvas().style.cursor = ''; });
  }

  async function openSegment(segmentId, simulated = false) {
    layers?.highlightSegment(map, segmentId);
    const sheet = openSheet({
      title: t('segment.title'),
      body: spinner(),
      onClose: () => layers?.highlightSegment(map, null)
    });

    if (simulated) {
      // No request is made. There is nothing on the server for this street and
      // inventing a score breakdown to fill the panel would be the exact lie
      // the projection is built to avoid telling.
      sheet.setTitle(t('app.demoSimulatedTitle'));
      sheet.setBody(el('div.stack-sm', {}, [
        banner(t('app.demoSimulatedBody'), { tone: 'warning' }),
        button(t('app.demoExit'), {
          variant: 'secondary', block: true,
          onClick: () => { setDemoActive(false); closeSheet(); }
        })
      ]));
      return;
    }

    try {
      const detail = await getSegmentDetail(segmentId);
      if (destroyed) return;
      sheet.setTitle(detail.segment.streetName || t('segment.unnamed'));
      sheet.setBody(renderSegmentDetail(detail, {
        onReport: (segment) => {
          appState.pendingReportLocation = segment.centre
            ? { lat: segment.centre[1], lng: segment.centre[0] }
            : null;
          closeSheet();
          navigate('/report');
        }
      }));
      track('segment_opened', { status: detail.assessment?.status });
      announce(`${detail.segment.streetName || t('segment.unnamed')}: ${t(`status.${detail.assessment?.status || 'unverified'}`)}`);
    } catch (error) {
      sheet.setBody(banner(describeError(error), { tone: 'danger' }));
    }
  }

  function renderChips() {
    mount(chipsRow, FILTERS.map((filter) => chip(t(filter.labelKey), {
      pressed: activeFilters.has(filter.key),
      dotColor: filter.color,
      onClick: () => toggleFilter(filter.key)
    })));
  }

  function toggleFilter(key) {
    if (key === 'all') {
      activeFilters.clear();
      activeFilters.add('all');
    } else {
      activeFilters.delete('all');
      if (activeFilters.has(key)) activeFilters.delete(key);
      else activeFilters.add(key);
      if (activeFilters.size === 0) activeFilters.add('all');
    }
    renderChips();
    applyFilters();
    track('filter_applied', { count: activeFilters.size });
  }

  function applyFilters() {
    if (!map || !layers) return;
    if (activeFilters.has('all')) { layers.applyFilters(map, {}); return; }

    const statuses = [];
    if (activeFilters.has('accessible')) statuses.push(SegmentStatus.ACCESSIBLE);
    if (activeFilters.has('partial')) statuses.push(SegmentStatus.PARTIAL);
    if (activeFilters.has('barriers')) {
      statuses.push(SegmentStatus.INACCESSIBLE, SegmentStatus.PARTIAL);
    }
    if (activeFilters.has('wheelchair')) statuses.push(SegmentStatus.ACCESSIBLE);

    layers.applyFilters(map, {
      status: statuses.length ? [...new Set(statuses)] : undefined,
      verifiedOnly: activeFilters.has('verified'),
      recentOnly: activeFilters.has('recent'),
      wheelchairOnly: activeFilters.has('wheelchair')
    });
  }

  async function locate() {
    // Move on the warmed fix immediately, then correct with the accurate one -
    // the same bargain the bundle cache makes: show what is already known, and
    // put it right the moment the truth arrives.
    const warm = readCachedPosition();
    if (warm) showPosition(warm, { duration: 600 });

    try {
      showPosition(await getCurrentPosition(), { duration: warm ? 500 : 900 });
    } catch (error) {
      // With a position already on screen a failed refresh is not worth a
      // toast; without one it is the only thing the user has to go on.
      if (!warm) toastError(error.message || t('map.locationUnavailable'));
    }
  }

  function showPosition(position, { duration = 900 } = {}) {
    if (!map || destroyed) return;
    map.flyTo({ center: [position.lng, position.lat], zoom: 16.5, duration });
    if (userMarker) userMarker.remove();
    userMarker = mapModule.createMarker({ color: '#1E88C7' })
      .setLngLat([position.lng, position.lat])
      .addTo(map);
  }

  const offSubmit = on(searchForm, 'submit', async (event) => {
    event.preventDefault();
    const value = searchInput.value.trim();
    if (value.length < 3) return;
    try {
      const { results } = await searchPlace(value);
      if (!results?.length) { toast(t('map.noResults')); return; }
      const first = results[0];
      map?.flyTo({ center: [first.lng, first.lat], zoom: 17, duration: 900 });
      announce(first.displayName);
    } catch (error) {
      toastError(describeError(error));
    }
  });

  const offDemo = onDemoChange(() => {
    demoBar.hidden = !isDemoActive();
    // Redraw from the untouched bundle, so switching off restores the real map
    // exactly rather than trying to undo a simulation in place.
    if (realBundle && map && !destroyed) showBundle(realRegion, realBundle);
  });

  function teardown() {
    destroyed = true;
    offDemo();
    offSubmit();
    closeSheet({ silent: true });
    if (userMarker) userMarker.remove();
    if (map) { map.remove(); map = null; }
  }

  return { destroy: teardown };
}

/**
 * The region this map should draw, or null when there is nothing to draw yet.
 *
 * Bootstrap is fetched once at boot and announced on the window. A page that
 * opens after that announcement has already gone out would wait for an event
 * that will never fire again, so the resolved payload is read first and the
 * wait is bounded: an unanswered bootstrap ends as "no region", which the map
 * can explain, rather than as a spinner that never stops.
 */
/**
 * Where the map should open.
 *
 * Fitting the imported region put the middle of the screen on upper Pafos and
 * Geroskipou, while every assessed segment sat in a corner: a visitor's first
 * view was mostly area the pilot has not reached. This opens on the part of
 * the network that has street-level evidence instead.
 *
 * The padding is deliberately generous - a third of the assessed span on each
 * side - so the opening view keeps unassessed grey network around the edges.
 * The point is to start where there is something to read, not to frame the
 * map so it looks better assessed than it is; the coverage figures elsewhere
 * report the whole region either way.
 *
 * Derived from the bundle rather than configured, so it follows coverage as
 * it grows. Falls back to the region when nothing has been assessed yet.
 */
function openingView(bundle, region) {
  const assessed = (bundle?.features || []).filter(
    (f) => (f.properties?.sources || []).includes('mapillary')
  );
  if (assessed.length === 0) return region?.bbox;

  let w = Infinity; let s = Infinity; let e = -Infinity; let n = -Infinity;
  for (const feature of assessed) {
    for (const [lng, lat] of feature.geometry?.coordinates || []) {
      if (lng < w) w = lng;
      if (lng > e) e = lng;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
  }
  if (!Number.isFinite(w)) return region?.bbox;

  const padLng = Math.max((e - w) / 3, 0.002);
  const padLat = Math.max((n - s) / 3, 0.002);
  return [w - padLng, s - padLat, e + padLng, n + padLat];
}

async function resolveRegion({ timeoutMs = 12000 } = {}) {
  const pick = (data) => data?.regions?.find((r) => r.id === data.defaultRegionId)
    || data?.regions?.[0]
    || null;

  if (appState.bootstrap) return pick(appState.bootstrap);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('accesspafos:bootstrap', done);
      window.removeEventListener('accesspafos:bootstrap-failed', fail);
      resolve(value);
    };
    const done = (event) => finish(pick(event.detail));
    const fail = () => finish(null);
    const timer = setTimeout(() => finish(pick(appState.bootstrap)), timeoutMs);

    window.addEventListener('accesspafos:bootstrap', done);
    window.addEventListener('accesspafos:bootstrap-failed', fail);
  });
}
