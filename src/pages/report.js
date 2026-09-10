/**
 * Citizen barrier reporting.
 *
 * Three short steps, each one screen tall on a phone. The copy is explicit
 * that a report is reviewed before it changes anything: people are more
 * willing to report honestly when they understand their report will not
 * instantly repaint a street red, and the system is more trustworthy for it.
 */

import { el, mount, on, announce } from '../utils/dom.js';
import { t } from '../i18n/index.js';
import { setHeader, getOutlet, backButton } from '../components/appShell.js';
import { icon } from '../components/icons.js';
import { button, banner, field, emptyState } from '../components/ui.js';
import { ensureSignedIn, getUser } from '../services/auth.js';
import { createReport, getUploadPolicy } from '../services/api.js';
import { getStorageService } from '../config/firebase.js';
import { getCurrentPosition } from '../services/geolocate.js';
import { toastError } from '../services/toast.js';
import { describeError } from '../services/errors.js';
import { track } from '../services/analytics.js';
import { navigate } from '../router/index.js';
import { appState } from '../app.js';
import { REPORT_CATEGORIES } from '@shared/constants.js';
import { MAX_REPORT_UPLOAD_MB, MAX_REPORT_DESCRIPTION_CHARS, DEFAULT_MAP_CENTER } from '@shared/config.js';

/**
 * Icon and disc colour per category.
 *
 * The tones are not a severity scale - a blocked pavement is not "worse" than
 * steps here, and the reviewer decides severity later. They exist so nine
 * near-identical cards can be told apart at a glance, which is the whole job
 * of this screen.
 */
const CATEGORY_LOOK = {
  broken_pavement: { iconName: 'surface', tone: 'brand' },
  missing_curb_ramp: { iconName: 'ramp', tone: 'accessible' },
  steps: { iconName: 'steps', tone: 'brand' },
  blocked_sidewalk: { iconName: 'block', tone: 'inaccessible' },
  narrow_passage: { iconName: 'width', tone: 'accessible' },
  surface_problem: { iconName: 'surface', tone: 'brand' },
  crossing_problem: { iconName: 'route', tone: 'accent' },
  temporary_obstruction: { iconName: 'warning', tone: 'partial' },
  other: { iconName: 'info', tone: 'brand' }
};

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export async function render() {
  setHeader({ title: t('report.title'), left: backButton() });

  const state = {
    step: 1,
    category: null,
    location: appState.pendingReportLocation || null,
    photoFile: null,
    photoUrl: null,
    description: ''
  };
  appState.pendingReportLocation = null;

  const container = el('div.page.stack');
  mount(getOutlet(), container);

  let map = null;
  let mapModule = null;
  let marker = null;
  let destroyed = false;

  track('report_started');
  renderStep();

  function renderStep() {
    if (destroyed) return;
    const indicator = el('div.steps-indicator', { 'aria-hidden': 'true' },
      [1, 2, 3].map((n) => el('div.steps-indicator__dot', { dataset: { done: String(n <= state.step) } })));

    if (state.step === 1) mount(container, [indicator, stepCategory()]);
    else if (state.step === 2) mount(container, [indicator, stepLocation()]);
    else mount(container, [indicator, stepDetails()]);

    announce(t(`report.step${state.step}`));
  }

  // --- step 1: category ----------------------------------------------------
  function stepCategory() {
    return el('div.stack', {}, [
      el('h2', {}, t('report.step1')),
      el('p.small.muted', {}, t('report.intro')),
      el('div.category-grid', { role: 'group', 'aria-label': t('report.category') },
        REPORT_CATEGORIES.map((category) => el('button.category-card', {
          type: 'button',
          'aria-pressed': String(state.category === category),
          onClick: () => {
            state.category = category;
            state.step = 2;
            renderStep();
          }
        }, [
          el(`span.category-card__icon.category-card__icon--${(CATEGORY_LOOK[category] || {}).tone || 'brand'}`,
            { 'aria-hidden': 'true' },
            icon((CATEGORY_LOOK[category] || {}).iconName || 'info', 20)),
          el('span.category-card__label', {}, t(`report.category_${category}`)),
          el('span.category-card__chevron', { 'aria-hidden': 'true' }, icon('chevronRight', 16))
        ])))
    ]);
  }

  // --- step 2: location ----------------------------------------------------
  function stepLocation() {
    const mapHost = el('div', {
      style: {
        height: '300px', borderRadius: 'var(--r-lg)', overflow: 'hidden',
        border: '1px solid var(--border)', position: 'relative'
      }
    });
    const readout = el('p.small.muted');

    // Center crosshair: the pin stays put and the map moves under it, which is
    // far easier one-handed than dragging a small marker.
    const crosshair = el('div', {
      'aria-hidden': 'true',
      style: {
        position: 'absolute', left: '50%', top: '50%',
        transform: 'translate(-50%, -100%)', pointerEvents: 'none', zIndex: '5',
        color: 'var(--brand)'
      }
    }, icon('pin', 34));
    mapHost.append(crosshair);

    const node = el('div.stack', {}, [
      el('h2', {}, t('report.step2')),
      el('p.small.muted', {}, t('report.adjustPin')),
      mapHost,
      readout,
      el('div.row', { style: { gap: '8px' } }, [
        button(t('report.useCurrentLocation'), { variant: 'secondary', icon: 'locate', onClick: useLocation })
      ]),
      el('div.row', { style: { gap: '8px', marginTop: '8px' } }, [
        button(t('app.back'), { variant: 'ghost', onClick: () => { state.step = 1; renderStep(); } }),
        button(t('app.next'), {
          variant: 'primary', block: true,
          onClick: () => {
            if (!state.location) { toastError(t('report.noLocation')); return; }
            state.step = 3;
            renderStep();
          }
        })
      ])
    ]);

    initMap(mapHost, readout);
    return node;

    async function useLocation() {
      try {
        const position = await getCurrentPosition();
        state.location = { lat: position.lat, lng: position.lng };
        map?.flyTo({ center: [position.lng, position.lat], zoom: 18, duration: 700 });
        updateReadout(readout);
      } catch (error) {
        toastError(error.message);
      }
    }
  }

  async function initMap(host, readout) {
    try {
      mapModule = await import('../maps/map.js');
      if (destroyed) return;
      const center = state.location
        ? [state.location.lng, state.location.lat]
        : DEFAULT_MAP_CENTER;
      map = await mapModule.createMap(host, { center, zoom: state.location ? 18 : 15, controls: false });
      await mapModule.whenReady(map);
      if (destroyed) return;

      if (!state.location) {
        state.location = { lng: center[0], lat: center[1] };
      }
      updateReadout(readout);

      map.on('moveend', () => {
        const c = map.getCenter();
        state.location = { lat: c.lat, lng: c.lng };
        updateReadout(readout);
      });
    } catch {
      mount(host, el('div.empty', {}, t('map.layerFailed')));
    }
  }

  function updateReadout(readout) {
    if (!readout || !state.location) return;
    readout.textContent = `${state.location.lat.toFixed(5)}, ${state.location.lng.toFixed(5)}`;
  }

  // --- step 3: photo + description ----------------------------------------
  function stepDetails() {
    const fileInput = el('input', {
      type: 'file',
      accept: ACCEPTED_TYPES.join(','),
      capture: 'environment',
      style: { display: 'none' },
      id: 'report-photo'
    });

    const photoSlot = el('div');
    const description = el('textarea.textarea', {
      id: 'report-description',
      maxlength: String(MAX_REPORT_DESCRIPTION_CHARS),
      placeholder: t('report.descriptionPlaceholder'),
      value: state.description
    });

    const errorSlot = el('div');
    const submitBtn = button(t('app.submit'), { variant: 'primary', block: true, icon: 'check' });

    const offChange = on(fileInput, 'change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (!ACCEPTED_TYPES.includes(file.type)) {
        mount(errorSlot, banner(t('report.photoWrongType'), { tone: 'warning' }));
        return;
      }
      if (file.size > MAX_REPORT_UPLOAD_MB * 1024 * 1024) {
        mount(errorSlot, banner(t('report.photoTooLarge', { size: MAX_REPORT_UPLOAD_MB }), { tone: 'warning' }));
        return;
      }
      mount(errorSlot);
      state.photoFile = file;
      if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
      state.photoUrl = URL.createObjectURL(file);
      renderPhoto();
    });

    function renderPhoto() {
      if (!state.photoUrl) {
        mount(photoSlot, el('button.photo-drop', {
          type: 'button', onClick: () => fileInput.click()
        }, [
          icon('camera', 26),
          el('div.small.strong', { style: { marginTop: '8px' } }, t('report.addPhoto')),
          el('div.xs.muted', {}, t('report.photoHint'))
        ]));
        return;
      }
      mount(photoSlot, el('div.photo-preview', {}, [
        el('img', { src: state.photoUrl, alt: '' }),
        el('button.photo-preview__remove', {
          type: 'button', 'aria-label': t('report.removePhoto'),
          onClick: () => {
            URL.revokeObjectURL(state.photoUrl);
            state.photoUrl = null;
            state.photoFile = null;
            renderPhoto();
          }
        }, icon('close', 16))
      ]));
    }

    renderPhoto();

    on(submitBtn, 'click', async () => {
      state.description = description.value.trim();
      submitBtn.disabled = true;
      mount(submitBtn, [el('span.btn__spinner', { 'aria-hidden': 'true' }), t('report.submitting')]);
      try {
        const result = await submit();
        renderSuccess(result);
      } catch (error) {
        mount(errorSlot, banner(describeError(error), { tone: 'danger' }));
        submitBtn.disabled = false;
        mount(submitBtn, [icon('check', 18), t('app.submit')]);
      }
    });

    return el('div.stack', {}, [
      el('h2', {}, t('report.step3')),
      fileInput,
      el('div.field', {}, [
        el('span.field__label', {}, t('report.photo')),
        photoSlot
      ]),
      field(t('report.description'), description, { id: 'report-description' }),
      errorSlot,
      el('div.row', { style: { gap: '8px' } }, [
        button(t('app.back'), { variant: 'ghost', onClick: () => { state.step = 2; renderStep(); } }),
        submitBtn
      ]),
      el('p.xs.muted', {}, t('report.photoHint'))
    ]);
  }

  async function submit() {
    await ensureSignedIn();
    const user = getUser();

    let photoPath = null;
    if (state.photoFile) {
      const policy = await getUploadPolicy().catch(() => ({ pathPrefix: `reports/${user.uid}/` }));
      const draftId = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const extension = state.photoFile.type === 'image/png' ? 'png'
        : state.photoFile.type === 'image/webp' ? 'webp' : 'jpg';
      photoPath = `${policy.pathPrefix}${draftId}/photo.${extension}`;

      const storage = await getStorageService();
      const { ref, uploadBytes } = await import('firebase/storage');
      await uploadBytes(ref(storage, photoPath), state.photoFile, {
        contentType: state.photoFile.type,
        cacheControl: 'private, max-age=0'
      });
    }

    const result = await createReport({
      category: state.category,
      location: state.location,
      description: state.description,
      photoPath,
      regionId: appState.regionId || undefined,
      locale: document.documentElement.lang || 'en'
    });

    track('report_submitted', { category: state.category, has_photo: Boolean(photoPath) });
    return result;
  }

  function renderSuccess(result) {
    const duplicates = result.duplicateCandidates || [];
    mount(container, el('div.stack', {}, [
      el('div.card.stack-sm', { style: { textAlign: 'center', padding: 'var(--s-6)' } }, [
        el('div', { style: { color: 'var(--accessible)', display: 'flex', justifyContent: 'center' } }, icon('check', 40)),
        el('h2', {}, t('report.submitted')),
        el('p.small.muted', {}, t('report.submittedBody'))
      ]),
      duplicates.length
        ? el('div.stack-sm', {}, [
          banner(t('report.duplicateBody', { count: duplicates.length }), { tone: 'info' })
        ])
        : null,
      el('div.stack-sm', {}, [
        el('a.btn.btn--secondary.btn--block', { href: '/saved' }, t('report.viewMyReports')),
        button(t('report.reportAnother'), {
          variant: 'ghost', block: true,
          onClick: () => {
            state.step = 1; state.category = null; state.photoFile = null;
            if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
            state.photoUrl = null; state.description = '';
            renderStep();
          }
        }),
        el('a.btn.btn--ghost.btn--block', { href: '/map' }, t('nav.map'))
      ])
    ]));
  }

  return {
    destroy() {
      destroyed = true;
      if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
      if (map) { map.remove(); map = null; }
    }
  };
}
