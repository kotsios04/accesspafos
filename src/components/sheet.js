/**
 * Bottom sheet.
 *
 * Implemented as a real modal dialog: focus is trapped while it is open,
 * Escape closes it, the backdrop is inert to screen readers, and focus
 * returns to whatever opened it. A sheet that a keyboard user cannot escape
 * from would be a serious failure in a product about access.
 */

import { el, clear, trapFocus, on } from '../utils/dom.js';
import { icon } from './icons.js';
import { t } from '../i18n/index.js';

let active = null;

/**
 * @param {Object} options
 * @param {string} options.title
 * @param {Node|Node[]} options.body
 * @param {Node[]} [options.footer]
 * @param {() => void} [options.onClose]
 * @param {string} [options.labelledBy]
 */
export function openSheet({ title, body, footer, onClose, ariaLabel }) {
  closeSheet({ silent: true });

  const root = document.getElementById('sheet-root');
  const titleId = `sheet-title-${Date.now()}`;

  const backdrop = el('div.sheet-backdrop', { 'aria-hidden': 'true' });
  const bodyEl = el('div.sheet__body');
  if (body) bodyEl.append(...(Array.isArray(body) ? body : [body]));

  const sheet = el('div.sheet', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': title ? titleId : undefined,
    'aria-label': !title ? ariaLabel : undefined,
    tabindex: '-1'
  }, [
    el('div.sheet__grip', { 'aria-hidden': 'true' }),
    el('div.sheet__header', {}, [
      title && el('h2.sheet__title', { id: titleId }, title),
      el('button.sheet__close', {
        type: 'button',
        'aria-label': t('app.close'),
        onClick: () => closeSheet()
      }, icon('close', 17))
    ]),
    bodyEl,
    footer && footer.length ? el('div.sheet__footer', {}, footer) : null
  ]);

  root.append(backdrop, sheet);

  // Prevent the page behind from scrolling under the sheet on iOS.
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  requestAnimationFrame(() => {
    backdrop.dataset.open = 'true';
    sheet.dataset.open = 'true';
  });

  const release = trapFocus(sheet);
  const offBackdrop = on(backdrop, 'click', () => closeSheet());
  const offKey = on(document, 'keydown', (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); closeSheet(); }
  });

  // Swipe down to dismiss - expected on mobile, and harmless elsewhere.
  let startY = null;
  const offTouchStart = on(sheet, 'touchstart', (event) => {
    if (bodyEl.scrollTop > 0) return;
    startY = event.touches[0].clientY;
  }, { passive: true });
  const offTouchMove = on(sheet, 'touchmove', (event) => {
    if (startY == null) return;
    const delta = event.touches[0].clientY - startY;
    if (delta > 0) sheet.style.transform = `translateY(${delta}px)`;
  }, { passive: true });
  const offTouchEnd = on(sheet, 'touchend', (event) => {
    if (startY == null) return;
    const delta = (event.changedTouches[0].clientY - startY);
    sheet.style.transform = '';
    startY = null;
    if (delta > 110) closeSheet();
  });

  active = {
    sheet,
    backdrop,
    close() {
      offBackdrop(); offKey(); offTouchStart(); offTouchMove(); offTouchEnd();
      release();
      document.body.style.overflow = previousOverflow;
      backdrop.dataset.open = 'false';
      sheet.dataset.open = 'false';
      setTimeout(() => { backdrop.remove(); sheet.remove(); }, 260);
      onClose?.();
    },
    setBody(nodes) {
      clear(bodyEl);
      bodyEl.append(...(Array.isArray(nodes) ? nodes : [nodes]));
    },
    setTitle(text) {
      const node = sheet.querySelector('.sheet__title');
      if (node) node.textContent = text;
    }
  };

  return active;
}

export function closeSheet({ silent = false } = {}) {
  if (!active) return;
  const current = active;
  active = null;
  if (silent) {
    current.backdrop.remove();
    current.sheet.remove();
    document.body.style.overflow = '';
  } else {
    current.close();
  }
}

export function isSheetOpen() { return Boolean(active); }
export function getActiveSheet() { return active; }
