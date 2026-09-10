/**
 * Route planner.
 *
 * Geocoder search is on explicit submit, never per keystroke: Nominatim's usage
 * policy forbids autocomplete against the public instance, and honouring that
 * is part of using open data responsibly rather than just consuming it.
 *
 * Suggestions as you type come from somewhere else entirely - the published
 * bundle already sitting in the browser, which carries every street name in the
 * region. Local, instant, no request made, and it can only offer streets the
 * app actually has data about. See services/places.js.
 */

import { el, mount, on } from '../utils/dom.js';
import { t, getLocale } from '../i18n/index.js';

/**
 * How each mobility profile is dressed in the option list.
 *
 * Decorative only: the profile's name and description carry the meaning, and
 * the icon is aria-hidden. Kept here rather than in the shared constants
 * because it is a presentation choice for this one screen, not part of what a
 * routing profile is.
 */
const PROFILE_LOOK = {
  wheelchair: { iconName: 'wheelchair', tone: 'brand' },
  reduced_mobility: { iconName: 'steps', tone: 'accessible' },
  stroller: { iconName: 'users', tone: 'accent' },
  balanced: { iconName: 'route', tone: 'partial' }
};
import { setHeader, getOutlet } from '../components/appShell.js';
import { icon } from '../components/icons.js';
import { button, radioOption, toggle, field, banner, sectionTitle } from '../components/ui.js';
import { searchPlace, calculateRoute } from '../services/api.js';
import { suggestStreets } from '../services/places.js';
import { getCurrentPosition } from '../services/geolocate.js';
import { getPrefs, setPrefs } from '../services/prefs.js';
import { toastError } from '../services/toast.js';
import { describeError } from '../services/errors.js';
import { track } from '../services/analytics.js';
import { navigate } from '../router/index.js';
import { appState } from '../app.js';
import { ROUTE_PROFILES } from '@shared/constants.js';

export async function render({ query }) {
  setHeader({ title: t('route.title') });

  const prefs = getPrefs();
  const state = {
    origin: null,
    destination: null,
    profile: prefs.mobilityProfile,
    preferVerified: prefs.preferVerifiedData
  };

  const originPicker = placePicker({
    id: 'route-origin',
    label: t('route.origin'),
    placeholder: t('route.originPlaceholder'),
    allowCurrentLocation: true,
    onPick: (place) => { state.origin = place; }
  });

  const destinationPicker = placePicker({
    id: 'route-destination',
    label: t('route.destination'),
    placeholder: t('route.destinationPlaceholder'),
    onPick: (place) => { state.destination = place; }
  });

  const errorSlot = el('div');
  const submit = button(t('route.calculate'), {
    variant: 'primary', block: true, icon: 'route', type: 'submit'
  });

  const form = el('form.stack', { onSubmit: onCalculate }, [
    // The two endpoints are joined by a rail so the pair reads as one control
    // rather than two unrelated search boxes.
    el('div.route-endpoints', {}, [
      el('span.route-endpoints__dot.route-endpoints__dot--from', { 'aria-hidden': 'true' }),
      el('span.route-endpoints__dot.route-endpoints__dot--to', { 'aria-hidden': 'true' }),
      originPicker.node,
      destinationPicker.node
    ]),

    el('fieldset', { style: { border: '0', padding: '0', margin: '0' } }, [
      el('legend.field__label', { style: { padding: '0' } }, t('route.profile')),
      el('div.option-list', {}, ROUTE_PROFILES.map((profileId) => radioOption({
        name: 'profile',
        value: profileId,
        checked: state.profile === profileId,
        title: t(`profile.${profileId}`),
        description: t(`profile.${profileId}Desc`),
        ...PROFILE_LOOK[profileId],
        onChange: (value) => {
          state.profile = value;
          setPrefs({ mobilityProfile: value });
        }
      })))
    ]),

    el('div.card', {}, toggle(
      t('route.preferVerified'),
      state.preferVerified,
      (checked) => {
        state.preferVerified = checked;
        setPrefs({ preferVerifiedData: checked });
      },
      { hint: t('route.preferVerifiedHint') }
    )),

    errorSlot,
    submit,
    el('p.xs.muted', {}, t('route.disclaimer'))
  ]);

  mount(getOutlet(), el('div.page.stack', {}, [form]));

  // A destination handed over from the home screen search box.
  if (query.to) {
    destinationPicker.setQuery(query.to);
    destinationPicker.search();
  }

  async function onCalculate(event) {
    event.preventDefault();
    mount(errorSlot);

    if (!state.destination) {
      mount(errorSlot, banner(t('route.destinationPlaceholder'), { tone: 'warning' }));
      destinationPicker.focus();
      return;
    }

    // No origin chosen: fall back to the device's position, which is what a
    // user tapping straight through almost always means.
    if (!state.origin) {
      try {
        const position = await getCurrentPosition();
        state.origin = { lat: position.lat, lng: position.lng, name: t('route.useMyLocation') };
        originPicker.setLabel(t('route.useMyLocation'));
      } catch (error) {
        mount(errorSlot, banner(error.message || t('map.locationUnavailable'), { tone: 'warning' }));
        return;
      }
    }

    setBusy(true);
    try {
      const plan = await calculateRoute({
        origin: { lat: state.origin.lat, lng: state.origin.lng },
        destination: { lat: state.destination.lat, lng: state.destination.lng },
        profile: state.profile,
        preferVerifiedData: state.preferVerified,
        regionId: appState.regionId || undefined
      });

      appState.lastRoutePlan = {
        plan,
        origin: state.origin,
        destination: state.destination,
        profile: state.profile
      };
      track('route_calculated', {
        profile: state.profile,
        unknown_percent: plan.options?.[0]?.unknownPercent ?? 0
      });
      navigate('/route/result');
    } catch (error) {
      mount(errorSlot, banner(describeError(error), { tone: 'danger' }));
    } finally {
      setBusy(false);
    }
  }

  function setBusy(busy) {
    submit.disabled = busy;
    mount(submit, busy
      ? [el('span.btn__spinner', { 'aria-hidden': 'true' }), t('route.calculating')]
      : [icon('route', 18), t('route.calculate')]);
  }

  return { destroy() { originPicker.destroy(); destinationPicker.destroy(); } };
}

/**
 * A search box that resolves to a coordinate.
 *
 * Deliberately submit-driven. It also offers the device location and, when
 * results come back, shows them as a short list rather than silently choosing
 * the first - the user knows which "Poseidonos" they meant.
 */
function placePicker({ id, label, placeholder, allowCurrentLocation = false, onPick }) {
  const input = el('input.input', {
    id, type: 'search', placeholder, autocomplete: 'off', enterkeyhint: 'search'
  });
  const results = el('div.stack-sm', { style: { marginTop: '8px' }, role: 'listbox' });
  const suggestions = el('div.stack-sm.place-suggest', { role: 'listbox' });
  const chosen = el('p.small.muted', { hidden: true });

  const searchBtn = el('button.btn.btn--secondary.btn--sm', { type: 'button' }, [icon('search', 15), t('app.search')]);
  const locateBtn = allowCurrentLocation
    ? el('button.btn.btn--ghost.btn--sm', { type: 'button' }, [icon('locate', 15), t('route.useMyLocation')])
    : null;

  const node = el('div.field', {}, [
    el('label.field__label', { for: id }, label),
    input,
    suggestions,
    el('div.row', { style: { marginTop: '8px', gap: '8px' } }, [searchBtn, locateBtn].filter(Boolean)),
    chosen,
    results
  ]);

  /**
   * Redraw the local suggestions. No network, so this runs on every keystroke
   * without a debounce: the work is a scan of a few thousand names already in
   * memory, and delaying it would only make the list feel slower than it is.
   */
  function renderSuggestions() {
    const matches = suggestStreets(input.value, { locale: getLocale() });
    if (!matches.length) { mount(suggestions); return; }

    mount(suggestions, matches.map((place) => el('button.list-item.list-item--sm', {
      type: 'button',
      role: 'option',
      onClick: () => { pick(place); mount(suggestions); }
    }, [
      icon('route', 15),
      el('div', {}, [
        el('div.list-item__title', {}, place.name),
        place.displayName && place.displayName !== place.name
          ? el('div.list-item__meta', {}, place.displayName)
          : null
      ])
    ])));
  }

  async function search() {
    const value = input.value.trim();
    if (value.length < 3) return;
    mount(results, el('p.small.muted', {}, t('app.loading')));
    try {
      const response = await searchPlace(value);
      if (!response.results?.length) {
        mount(results, el('p.small.muted', {}, t('route.noPlaces')));
        return;
      }
      mount(results, response.results.slice(0, 5).map((place) => el('button.list-item', {
        type: 'button',
        role: 'option',
        onClick: () => pick(place)
      }, [
        icon('pin', 17),
        el('div', {}, [
          el('div.list-item__title', {}, place.name),
          el('div.list-item__meta', {}, place.displayName)
        ]),
        icon('chevronRight', 15)
      ])));
      results.append(el('p.xs.muted', { style: { marginTop: '6px' } },
        response.attribution || '© OpenStreetMap contributors'));
    } catch (error) {
      mount(results, banner(describeError(error), { tone: 'warning' }));
    }
  }

  function pick(place) {
    onPick(place);
    input.value = place.name || place.displayName || '';
    chosen.hidden = false;
    chosen.textContent = place.displayName || place.name || '';
    mount(results);
  }

  async function useLocation() {
    try {
      const position = await getCurrentPosition();
      pick({ lat: position.lat, lng: position.lng, name: t('route.useMyLocation'), displayName: t('route.useMyLocation') });
    } catch (error) {
      toastError(error.message || t('map.locationUnavailable'));
    }
  }

  const offInput = on(input, 'input', renderSuggestions);
  const offSearch = on(searchBtn, 'click', () => { mount(suggestions); search(); });
  const offEnter = on(input, 'keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); mount(suggestions); search(); }
    if (event.key === 'Escape') mount(suggestions);
  });
  const offLocate = locateBtn ? on(locateBtn, 'click', useLocation) : () => {};

  return {
    node,
    search,
    focus: () => input.focus(),
    setQuery: (value) => { input.value = value; },
    setLabel: (value) => { chosen.hidden = false; chosen.textContent = value; },
    destroy() { offInput(); offSearch(); offEnter(); offLocate(); }
  };
}
