/**
 * A very small DOM layer.
 *
 * There is no framework here on purpose. What a framework would give this
 * project - a component tree and reactive updates - is not worth the bundle
 * on a mobile-first civic app whose heaviest dependency is already a map
 * engine. What it would cost is control over exactly what markup a screen
 * reader receives, which in an accessibility product is the wrong trade.
 */

/**
 * Create an element.
 * @param {string} tag  'div', or 'div.card.card--raised', or 'button#id.btn'
 * @param {Object} [props]
 * @param {Array|string|Node} [children]
 */
export function el(tag, props = {}, children = []) {
  const [name, ...rest] = tag.split(/(?=[.#])/);
  const node = document.createElement(name || 'div');

  for (const token of rest) {
    const value = token.slice(1);
    // An interpolated selector - `div.chip.chip--${status}` with an absent
    // status - produces an empty token, and classList.add('') throws a
    // SyntaxError that takes down whatever was rendering. That is how the
    // admin job list ended up stuck on "Loading…": the Firestore snapshot
    // arrived, the row render threw on one empty class, and the listener's
    // callback never completed. An empty class is nothing; treat it as such.
    if (!value) continue;
    if (token.startsWith('.')) node.classList.add(value);
    else if (token.startsWith('#')) node.id = value;
  }

  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class' || key === 'className') node.className = `${node.className} ${value}`.trim();
    else if (key === 'style' && typeof value === 'object') setStyle(node, value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node && key !== 'list' && typeof value !== 'object') {
      try { node[key] = value; } catch { node.setAttribute(key, String(value)); }
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }

  append(node, children);
  return node;
}

/**
 * Apply a style object.
 *
 * Custom properties have to go through setProperty: assigning them onto a
 * CSSStyleDeclaration silently creates an expando that never reaches CSS,
 * which is how the score dials ended up rendering permanently empty.
 */
function setStyle(node, styles) {
  for (const [key, value] of Object.entries(styles)) {
    if (value == null) continue;
    if (key.startsWith('--')) node.style.setProperty(key, String(value));
    else node.style[key] = value;
  }
}

export function append(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) { append(parent, child); continue; }
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(container, ...children) {
  clear(container);
  append(container, children);
  return container;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Add a listener and get back a function that removes it. */
export function on(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

/** Announce a message to assistive technology without moving focus. */
export function announce(message) {
  const region = document.getElementById('live-region');
  if (!region) return;
  // Clearing first makes repeated identical messages announce again.
  region.textContent = '';
  window.setTimeout(() => { region.textContent = message; }, 60);
}

/**
 * Trap focus inside a container (dialogs, bottom sheets).
 * Returns a release function that also restores the previous focus.
 */
export function trapFocus(container, { initialFocus } = {}) {
  const previous = document.activeElement;
  const selector = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  const focusables = () => [...container.querySelectorAll(selector)]
    .filter((n) => n.offsetParent !== null || n === document.activeElement);

  const onKeydown = (event) => {
    if (event.key !== 'Tab') return;
    const items = focusables();
    if (items.length === 0) { event.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  };

  container.addEventListener('keydown', onKeydown);
  (initialFocus || focusables()[0] || container).focus?.();

  return () => {
    container.removeEventListener('keydown', onKeydown);
    if (previous instanceof HTMLElement) previous.focus?.();
  };
}

/** Debounce, for resize handlers and the like. Never for search-as-you-type. */
export function debounce(fn, wait = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** Escape text destined for an innerHTML template. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
