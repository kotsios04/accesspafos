/**
 * Product analytics - minimal, opt-in, and free of anything personal.
 *
 * Events record that something happened, never who it happened to and never
 * where precisely. No coordinates, no report contents, no photographs, no
 * search strings.
 */

import { getAnalyticsService } from '../config/firebase.js';
import { analyticsEnabled } from '../config/env.js';
import { getPref } from './prefs.js';

const ALLOWED_EVENTS = new Set([
  'map_opened',
  'segment_opened',
  'route_calculated',
  'route_navigation_started',
  'report_started',
  'report_submitted',
  'language_changed',
  'filter_applied',
  'admin_opened'
]);

export async function track(event, params = {}) {
  if (!analyticsEnabled) return;
  if (!getPref('analyticsOptIn')) return;
  if (!ALLOWED_EVENTS.has(event)) return;

  try {
    const analytics = await getAnalyticsService();
    if (!analytics) return;
    const { logEvent } = await import('firebase/analytics');
    logEvent(analytics, event, sanitise(params));
  } catch {
    // Analytics must never break the product.
  }
}

/** Only scalars, and nothing that could identify a person or a location. */
function sanitise(params) {
  const out = {};
  const blocked = /lat|lng|lon|coord|uid|email|photo|query|address|name/i;
  for (const [key, value] of Object.entries(params)) {
    if (blocked.test(key)) continue;
    if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'string' && value.length <= 40) out[key] = value;
  }
  return out;
}
