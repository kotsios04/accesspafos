/**
 * Transient messages.
 *
 * Toasts are rendered inside an `aria-live="polite"` region so that a screen
 * reader hears "your report has been received" without focus being stolen
 * from whatever the user was doing.
 */

import { el } from '../utils/dom.js';

const DEFAULT_MS = 4200;

export function toast(message, { type = 'neutral', duration = DEFAULT_MS, action } = {}) {
  const root = document.getElementById('toast-root');
  if (!root) return () => {};

  const node = el(`div.toast.toast--${type}`, { role: 'status' }, [
    el('span', { style: { flex: '1' } }, message),
    action && el('button.link-button', {
      style: { color: '#fff' },
      onClick: () => { action.onClick(); dismiss(); }
    }, action.label)
  ]);

  root.append(node);
  const timer = duration > 0 ? setTimeout(dismiss, duration) : null;

  function dismiss() {
    if (timer) clearTimeout(timer);
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(() => node.remove(), 200);
  }

  return dismiss;
}

export const toastError = (message, options) => toast(message, { ...options, type: 'error' });
export const toastSuccess = (message, options) => toast(message, { ...options, type: 'success' });
