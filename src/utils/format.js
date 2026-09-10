/**
 * Locale-aware formatting. Every number a user sees passes through here, so
 * Greek and English render consistently and nothing hard-codes a comma.
 */

import { getLocale } from '../i18n/index.js';

export function formatNumber(value, options = {}) {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(getLocale(), options).format(value);
}

/** Distance in metres, promoted to kilometres above 1 km. */
export function formatDistance(meters, { locale = getLocale() } = {}) {
  if (meters == null || !Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${new Intl.NumberFormat(locale).format(Math.round(meters))} m`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(meters / 1000)} km`;
}

/** Duration in seconds as a compact human string. */
export function formatDuration(seconds, t) {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const mins = Math.round(seconds / 60);
  if (mins < 1) return t ? t('time.under_a_minute') : '<1 min';
  if (mins < 60) return `${mins} ${t ? t('time.min') : 'min'}`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest === 0
    ? `${hours} ${t ? t('time.hr') : 'h'}`
    : `${hours} ${t ? t('time.hr') : 'h'} ${rest} ${t ? t('time.min') : 'min'}`;
}

/** Coerce Firestore Timestamp | Date | ISO string | epoch ms to a Date. */
export function toDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : new Date(t);
  }
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') return value.toDate();
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
    if (typeof value._seconds === 'number') return new Date(value._seconds * 1000);
  }
  return null;
}

export function formatDate(value, options = { year: 'numeric', month: 'short', day: 'numeric' }) {
  const date = toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(getLocale(), options).format(date);
}

export function formatDateTime(value) {
  return formatDate(value, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

/** "3 months ago" - used for evidence age, where the gist matters. */
export function formatRelative(value) {
  const date = toDate(value);
  if (!date) return '—';
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });
  const diffMs = date.getTime() - Date.now();
  const units = [
    ['year', 31557600000], ['month', 2629800000], ['week', 604800000],
    ['day', 86400000], ['hour', 3600000], ['minute', 60000]
  ];
  for (const [unit, ms] of units) {
    if (Math.abs(diffMs) >= ms || unit === 'minute') {
      return rtf.format(Math.round(diffMs / ms), unit);
    }
  }
  return rtf.format(0, 'minute');
}

export function formatPercent(value, { fractionDigits = 0 } = {}) {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(getLocale(), {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(value);
}

/** Metres of network, shown in kilometres once it stops being a footpath. */
/**
 * @param {number} meters
 * @param {{compact?:boolean}} [options] compact drops the decimal, for a
 *   summary tile where the figure is a glance rather than a measurement. The
 *   precise value stays on the coverage screen, which is where someone who
 *   cares about the tenth of a kilometre is looking.
 */
export function formatNetworkLength(meters, { compact = false } = {}) {
  if (!Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${new Intl.NumberFormat(getLocale()).format(Math.round(meters))} m`;
  const km = new Intl.NumberFormat(getLocale(), {
    maximumFractionDigits: compact ? 0 : 1
  }).format(meters / 1000);
  return `${km} km`;
}

export function initials(email, displayName) {
  const source = (displayName || email || '?').trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
