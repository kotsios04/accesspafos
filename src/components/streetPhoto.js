/**
 * The street-level photograph behind an assessment.
 *
 * Rendered inline, next to the findings it supports, so that "the kerb is a
 * barrier here" and the picture of the kerb are on screen together. Previously
 * the only way to see the photograph was a link that took you to another site,
 * which meant the evidence was one navigation away from the claim - and in
 * practice that is the same as not having it.
 *
 * The node is returned synchronously and fills itself in when the request
 * settles, because the caller builds the whole detail view in one pass. Three
 * end states, all of them legible: the photograph, a plain sentence saying
 * there isn't one, or nothing at all when Mapillary is not configured.
 *
 * Attribution is not decoration. The imagery is CC BY-SA and the credit is a
 * licence condition, so it is rendered from the same constant the map uses and
 * is not conditional on anything.
 */

import { el, on, trapFocus } from '../utils/dom.js';
import { t } from '../i18n/index.js';
import { formatDate } from '../utils/format.js';
import { icon } from './icons.js';
import { ATTRIBUTION } from '../config/env.js';
import { isMapillaryConfigured, loadObservationPhoto } from '../services/mapillary.js';

/**
 * @param {object} observation  an entry from getSegmentDetail's observations
 * @returns {HTMLElement|null}  null when there is nothing that could be shown
 */
export function streetPhoto(observation) {
  if (!isMapillaryConfigured) return null;

  const host = el('div.street-photo', {
    // Screen readers are told the region is filling rather than being left to
    // wonder why a heading has no content under it.
    'aria-busy': 'true',
    'aria-live': 'polite'
  }, [
    el('div.street-photo__skeleton', { 'aria-hidden': 'true' }),
    el('p.xs.muted.street-photo__status', {}, t('segment.photoLoading'))
  ]);

  loadObservationPhoto(observation)
    .then((photo) => { host.replaceChildren(...content(photo)); })
    .catch(() => { host.replaceChildren(...content(null)); })
    .finally(() => { host.setAttribute('aria-busy', 'false'); });

  return host;
}

function content(photo) {
  if (!photo) {
    return [el('p.xs.muted', {}, t('segment.photoNone'))];
  }

  const figure = el('figure.street-photo__figure', {}, [
    el('button.street-photo__button', {
      type: 'button',
      'aria-label': t('segment.photoOpen'),
      onClick: () => openLightbox(photo)
    }, [
      el('img.street-photo__img', {
        src: photo.thumbUrl,
        alt: t('segment.photoAlt'),
        loading: 'lazy',
        decoding: 'async'
      }),
      photo.isPano
        ? el('span.street-photo__badge', {}, t('segment.photoPano'))
        : null,
      el('span.street-photo__zoom', { 'aria-hidden': 'true' }, icon('search', 16))
    ]),
    el('figcaption.street-photo__caption', {}, [
      el('span.xs.muted', {}, credit(photo)),
      el('span.xs.muted.street-photo__licence', { html: ATTRIBUTION.mapillary })
    ])
  ]);

  return [figure];
}

/** Photographer and date - the two things the licence and the reader both want. */
function credit(photo) {
  const parts = [];
  if (photo.creator) parts.push(t('segment.photoBy', { creator: photo.creator }));
  if (photo.capturedAt) parts.push(formatDate(photo.capturedAt));
  return parts.join(' · ');
}

/**
 * A self-contained overlay rather than the shared bottom sheet.
 *
 * `openSheet` closes whatever sheet is already open, and on mobile this
 * component is usually rendered *inside* that sheet - so reusing it would
 * dismiss the segment detail the reader is in the middle of. Same modal
 * contract though: focus trapped, Escape closes, focus restored.
 */
function openLightbox(photo) {
  const image = el('img.street-lightbox__img', {
    src: photo.fullUrl,
    alt: t('segment.photoAlt')
  });

  const close = el('button.street-lightbox__close', {
    type: 'button',
    'aria-label': t('app.close')
  }, icon('close', 20));

  const overlay = el('div.street-lightbox', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': t('segment.photoAlt'),
    tabindex: '-1'
  }, [
    close,
    image,
    el('p.street-lightbox__caption', {}, [
      el('span', {}, credit(photo)),
      el('span', { html: ATTRIBUTION.mapillary })
    ])
  ]);

  document.body.append(overlay);
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  // trapFocus restores focus to whatever opened this when released, so the
  // thumbnail button is where the reader lands on close.
  const release = trapFocus(overlay, { initialFocus: close });

  function dismiss() {
    offClose(); offKey(); offBackdrop();
    release();
    document.body.style.overflow = previousOverflow;
    overlay.remove();
  }

  const offClose = on(close, 'click', dismiss);
  const offKey = on(document, 'keydown', (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); dismiss(); }
  });
  // Only the backdrop dismisses; a tap on the photograph itself must not, or
  // pinch-zooming on a phone would keep closing it.
  const offBackdrop = on(overlay, 'click', (event) => {
    if (event.target === overlay) dismiss();
  });

  requestAnimationFrame(() => { overlay.dataset.open = 'true'; });
}
