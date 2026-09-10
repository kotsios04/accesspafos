/**
 * Inline SVG icons.
 *
 * Hand-drawn on a 24-unit grid with a consistent 1.7 stroke, rather than
 * pulled from an icon font: it keeps the bundle honest, avoids a network
 * dependency in the offline shell, and lets every glyph be `aria-hidden`
 * with the label carried by the control around it.
 */

function svg(paths, { size = 22, fill = false, viewBox = '0 0 24 24' } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${viewBox}" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

export const icons = {
  home: (s) => svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>', { size: s }),
  map: (s) => svg('<path d="m9 4-6 2.5v13L9 17l6 3 6-2.5v-13L15 7Z"/><path d="M9 4v13"/><path d="M15 7v13"/>', { size: s }),
  route: (s) => svg('<circle cx="6" cy="19" r="2.4"/><circle cx="18" cy="5" r="2.4"/><path d="M8.4 19h5.1a3.5 3.5 0 0 0 0-7h-3a3.5 3.5 0 0 1 0-7h5.1"/>', { size: s }),
  bookmark: (s) => svg('<path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4Z"/>', { size: s }),
  user: (s) => svg('<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>', { size: s }),
  search: (s) => svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>', { size: s }),
  close: (s) => svg('<path d="m6 6 12 12M18 6 6 18"/>', { size: s }),
  chevronRight: (s) => svg('<path d="m9 5 7 7-7 7"/>', { size: s }),
  chevronLeft: (s) => svg('<path d="m15 5-7 7 7 7"/>', { size: s }),
  chevronDown: (s) => svg('<path d="m5 9 7 7 7-7"/>', { size: s }),
  arrowLeft: (s) => svg('<path d="M20 12H4"/><path d="m10 6-6 6 6 6"/>', { size: s }),
  locate: (s) => svg('<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.6"/><path d="M12 1.4v3M12 19.6v3M22.6 12h-3M4.4 12h-3"/>', { size: s }),
  filter: (s) => svg('<path d="M3 5h18"/><path d="M7 12h10"/><path d="M10 19h4"/>', { size: s }),
  info: (s) => svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6h.01"/>', { size: s }),
  warning: (s) => svg('<path d="M10.3 3.9 2.6 17.3A1.9 1.9 0 0 0 4.3 20h15.4a1.9 1.9 0 0 0 1.7-2.7L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 16.6h.01"/>', { size: s }),
  check: (s) => svg('<path d="m4.5 12.5 5 5 10-11"/>', { size: s }),
  camera: (s) => svg('<path d="M4 8.5h3l1.6-2.4h6.8L17 8.5h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="14" r="3.4"/>', { size: s }),
  flag: (s) => svg('<path d="M5 21V4"/><path d="M5 5h11l-1.8 3.4L16 12H5"/>', { size: s }),
  pin: (s) => svg('<path d="M12 21s7-5.8 7-11a7 7 0 1 0-14 0c0 5.2 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>', { size: s }),
  steps: (s) => svg('<path d="M3 20h4v-4h4v-4h4V8h5"/>', { size: s }),
  ramp: (s) => svg('<path d="M3 19h18"/><path d="M4 19 19 7"/>', { size: s }),
  surface: (s) => svg('<path d="M3 8h18M3 14h18"/><path d="M8 8v6M15 8v6"/>', { size: s }),
  block: (s) => svg('<circle cx="12" cy="12" r="8.5"/><path d="m6.5 6.5 11 11"/>', { size: s }),
  eye: (s) => svg('<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.9"/>', { size: s }),
  clock: (s) => svg('<circle cx="12" cy="12" r="8.6"/><path d="M12 7v5.2l3.2 2"/>', { size: s }),
  shield: (s) => svg('<path d="M12 3 5 5.8v5.6c0 4.3 2.9 8.2 7 9.6 4.1-1.4 7-5.3 7-9.6V5.8Z"/><path d="m9 12 2.2 2.2L15.5 10"/>', { size: s }),
  layers: (s) => svg('<path d="m12 3 9 4.6-9 4.6-9-4.6Z"/><path d="m3 12.6 9 4.6 9-4.6"/>', { size: s }),
  chart: (s) => svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', { size: s }),
  settings: (s) => svg('<circle cx="12" cy="12" r="3.1"/><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H2a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H8a1.6 1.6 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V8a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>', { size: s }),
  clipboard: (s) => svg('<path d="M9 4h6v3H9z"/><path d="M15 5.5h2.5A1.5 1.5 0 0 1 19 7v12.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5V7a1.5 1.5 0 0 1 1.5-1.5H9"/><path d="M9 12h6M9 16h4"/>', { size: s }),
  download: (s) => svg('<path d="M12 3v11"/><path d="m7.5 10 4.5 4.5 4.5-4.5"/><path d="M4 20h16"/>', { size: s }),
  refresh: (s) => svg('<path d="M20 11a8 8 0 1 0-.6 4"/><path d="M20 5v5h-5"/>', { size: s }),
  play: (s) => svg('<path d="M7 4.8v14.4L19.5 12Z"/>', { size: s }),
  stop: (s) => svg('<rect x="6" y="6" width="12" height="12" rx="1.6"/>', { size: s }),
  menu: (s) => svg('<path d="M4 7h16M4 12h16M4 17h16"/>', { size: s }),
  external: (s) => svg('<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', { size: s }),
  turnLeft: (s) => svg('<path d="M15 20V9a4 4 0 0 0-4-4H6"/><path d="m9.5 1.5-3.5 3.5 3.5 3.5"/>', { size: s }),
  turnRight: (s) => svg('<path d="M9 20V9a4 4 0 0 1 4-4h5"/><path d="m14.5 1.5 3.5 3.5-3.5 3.5"/>', { size: s }),
  straight: (s) => svg('<path d="M12 21V5"/><path d="m7.5 9.5 4.5-4.5 4.5 4.5"/>', { size: s }),
  finish: (s) => svg('<path d="M12 21s7-5.8 7-11a7 7 0 1 0-14 0c0 5.2 7 11 7 11Z"/><path d="m9.2 10.2 1.9 1.9 3.7-3.9"/>', { size: s }),
  logout: (s) => svg('<path d="M14 20H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h8"/><path d="M17 8.5 20.5 12 17 15.5"/><path d="M20 12h-9"/>', { size: s }),
  plus: (s) => svg('<path d="M12 5v14M5 12h14"/>', { size: s }),
  wheelchair: (s) => svg('<circle cx="13.4" cy="4.4" r="1.9"/><path d="M12.4 8.2v4.6h4.3l2.6 5.4"/><path d="M16.2 14.6a5.6 5.6 0 1 1-6.4-3.1"/><path d="M18.2 18.2h2.6"/>', { size: s }),
  scan: (s) => svg('<path d="M4 8.6V6a2 2 0 0 1 2-2h2.6"/><path d="M15.4 4H18a2 2 0 0 1 2 2v2.6"/><path d="M20 15.4V18a2 2 0 0 1-2 2h-2.6"/><path d="M8.6 20H6a2 2 0 0 1-2-2v-2.6"/><path d="M4 12h16"/>', { size: s }),
  sparkle: (s) => svg('<path d="M12 3.2 13.7 9l5.8 1.7-5.8 1.7L12 18.2l-1.7-5.8L4.5 10.7 10.3 9Z"/><path d="M18.6 3.4 19.2 5.4l2 .6-2 .6-.6 2-.6-2-2-.6 2-.6Z"/>', { size: s }),
  trendUp: (s) => svg('<path d="M4 16.5 10 10l4 3.6L20 7"/><path d="M15 7h5v5"/>', { size: s }),
  trendDown: (s) => svg('<path d="M4 7.5 10 14l4-3.6L20 17"/><path d="M15 17h5v-5"/>', { size: s }),
  bell: (s) => svg('<path d="M18 9a6 6 0 1 0-12 0c0 4.5-2 6-2 6h16s-2-1.5-2-6Z"/><path d="M10.4 19a1.9 1.9 0 0 0 3.2 0"/>', { size: s }),
  users: (s) => svg('<circle cx="9.4" cy="8.2" r="3.3"/><path d="M3.4 19.4a6 6 0 0 1 12 0"/><path d="M16 5.4a3.3 3.3 0 0 1 0 6.4"/><path d="M17.6 14.6a5.6 5.6 0 0 1 3.4 4.8"/>', { size: s }),
  route2: (s) => svg('<path d="M6 20V9a3.6 3.6 0 0 1 3.6-3.6h4.8"/><circle cx="6" cy="20" r="1.6"/><path d="m12.4 2.6 2.8 2.8-2.8 2.8"/>', { size: s }),
  kerb: (s) => svg('<path d="M3 17h6l3-5h9"/><path d="M3 20h18"/>', { size: s }),
  width: (s) => svg('<path d="M4 12h16"/><path d="m7.5 8.5-3.5 3.5 3.5 3.5"/><path d="m16.5 8.5 3.5 3.5-3.5 3.5"/>', { size: s }),
  incline: (s) => svg('<path d="M3 19h18"/><path d="M4 19 20 6"/><path d="M20 12v7"/>', { size: s }),
    trash: (s) => svg('<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6.5 7 7.4 20a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9L17.5 7"/>', { size: s })
};

/** Render an icon as a DOM node. */
export function icon(name, size = 22) {
  const span = document.createElement('span');
  span.style.display = 'inline-flex';
  span.innerHTML = (icons[name] || icons.info)(size);
  return span;
}

/**
 * The AccessPafos mark.
 *
 * The roundel only - Aphrodite, the harbour castle, the sea, and a wheelchair
 * user on the path between them. The wordmark is part of the same artwork but
 * is not used here: the header already sets "AccessPafos AI" in type, and
 * repeating it inside the mark would say it twice in 38 pixels.
 *
 * An earlier placeholder avoided a wheelchair pictogram on the grounds that
 * the product routes for anyone whose path can be blocked. That reasoning
 * belonged to a placeholder; this is the project's own identity, chosen by its
 * author, and it is not this file's place to argue with it.
 *
 * @param {number} size rendered edge, in CSS pixels
 */
export function brandMark(size = 28) {
  const span = document.createElement('span');
  span.className = 'brand__mark';
  const img = document.createElement('img');
  img.src = `${import.meta.env.BASE_URL}brand/accesspafos-mark.png`;
  img.width = size;
  img.height = size;
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  // The link around it already carries the accessible name, and the mark is
  // never the only route to anything.
  img.decoding = 'async';
  span.appendChild(img);
  return span;
}
