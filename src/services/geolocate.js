/**
 * Geolocation.
 *
 * Permission is requested only when the user asks for it - never on load -
 * and every failure path returns a message the UI can actually show, because
 * "position unavailable" on its own helps nobody.
 */

import { t } from '../i18n/index.js';

export class LocationError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'LocationError';
    this.kind = kind;
  }
}

export function isSupported() {
  return 'geolocation' in navigator;
}

/** The most recent fix, from whichever call produced it. */
let cached = null;

/**
 * What the browser would do if we asked - without asking.
 *
 * `permissions.query` reads the stored decision and never raises a prompt,
 * which is the whole reason priming is possible at all.
 *
 * @returns {Promise<'granted'|'prompt'|'denied'|'unsupported'|'unknown'>}
 */
export async function permissionState() {
  if (!isSupported()) return 'unsupported';
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' });
    return status?.state || 'unknown';
  } catch {
    // Safari shipped permissions.query without geolocation support for years
    // and throws on the name. Unknown means "ask properly", never "assume yes".
    return 'unknown';
  }
}

/**
 * The last known position, if it is recent enough to be worth showing.
 * @param {number} [maxAgeMs]
 */
export function readCachedPosition(maxAgeMs = 120000) {
  if (!cached) return null;
  return Date.now() - cached.at <= maxAgeMs ? cached : null;
}

/**
 * Warm the cache when the map opens, so the locate button has an answer ready
 * instead of starting a GPS fix at the moment of the tap.
 *
 * Deliberately does nothing unless permission is ALREADY granted. Calling
 * geolocation on load would put a permission prompt in front of somebody who
 * asked for nothing - the exact pattern the note at the top of this file rules
 * out - and it would be a poor trade in an app whose users have every reason to
 * be careful about who knows where they are. A returning visitor who has
 * already said yes gets the speed; a first-time visitor is left alone until
 * they press the button, which is when asking is honest.
 *
 * Low accuracy on purpose: this is for centring a map, and a coarse fix returns
 * in a fraction of the time without waking the GPS radio.
 *
 * @returns {Promise<object|null>} the fix, or null if it was not appropriate
 */
export async function primeLocation() {
  if (await permissionState() !== 'granted') return null;
  try {
    return await getCurrentPosition({
      enableHighAccuracy: false, timeout: 8000, maximumAge: 60000
    });
  } catch {
    // A failed prime is a non-event: the button still works.
    return null;
  }
}

/** One-shot position. @returns {Promise<{lat:number,lng:number,accuracy:number}>} */
export function getCurrentPosition({ timeout = 12000, maximumAge = 30000, enableHighAccuracy = true } = {}) {
  if (!isSupported()) {
    return Promise.reject(new LocationError('unsupported', t('map.locationUnavailable')));
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const fix = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          heading: position.coords.heading ?? null,
          timestamp: position.timestamp
        };
        cached = { ...fix, at: Date.now() };
        resolve(fix);
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(new LocationError('denied', t('map.locationDenied')));
        } else if (error.code === error.TIMEOUT) {
          reject(new LocationError('timeout', t('error.timeout')));
        } else {
          reject(new LocationError('unavailable', t('map.locationUnavailable')));
        }
      },
      { timeout, maximumAge, enableHighAccuracy }
    );
  });
}

/**
 * Continuous tracking for turn-by-turn navigation.
 * @returns {() => void} stop function
 */
export function watchPosition(onUpdate, onError, options = {}) {
  if (!isSupported()) {
    onError?.(new LocationError('unsupported', t('map.locationUnavailable')));
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (position) => onUpdate({
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
      heading: position.coords.heading ?? null,
      speed: position.coords.speed ?? null,
      timestamp: position.timestamp
    }),
    (error) => onError?.(new LocationError(
      error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable',
      error.code === error.PERMISSION_DENIED ? t('map.locationDenied') : t('map.locationUnavailable')
    )),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 2000, ...options }
  );
  return () => navigator.geolocation.clearWatch(id);
}
