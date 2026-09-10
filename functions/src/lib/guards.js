/**
 * Callable guards.
 *
 * Every privileged Cloud Function starts with one of these. The pattern is
 * deliberately boring: check auth, check the role claim, validate the payload,
 * and only then do work.
 */

import { HttpsError } from 'firebase-functions/v2/https';
import { ROLE_RANK, Role } from '../shared/constants.js';

/** Reject unless a user (anonymous counts) is signed in. */
export function requireAuth(request) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign-in is required for this action.');
  }
  return request.auth;
}

export function roleOf(request) {
  return request.auth?.token?.role || Role.CITIZEN;
}

/**
 * Reject unless the caller holds at least `minimum` in the role hierarchy.
 * Roles live in Auth custom claims and are set only by scripts/set-admin.js.
 */
export function requireRole(request, minimum) {
  requireAuth(request);
  const actual = roleOf(request);
  if ((ROLE_RANK[actual] ?? -1) < (ROLE_RANK[minimum] ?? 99)) {
    throw new HttpsError('permission-denied', 'You do not have permission to perform this action.');
  }
  return { uid: request.auth.uid, role: actual, email: request.auth.token?.email || null };
}

export const requireReviewer = (r) => requireRole(r, Role.REVIEWER);
export const requireMunicipalityAdmin = (r) => requireRole(r, Role.MUNICIPALITY_ADMIN);
export const requireSuperAdmin = (r) => requireRole(r, Role.SUPER_ADMIN);

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

export function assert(condition, message, code = 'invalid-argument') {
  if (!condition) throw new HttpsError(code, message);
}

export function requireString(value, field, { max = 500, min = 1 } = {}) {
  assert(typeof value === 'string', `${field} must be a string.`);
  const v = value.trim();
  assert(v.length >= min, `${field} is required.`);
  assert(v.length <= max, `${field} must be at most ${max} characters.`);
  return v;
}

export function requireOneOf(value, allowed, field) {
  assert(allowed.includes(value), `${field} must be one of: ${allowed.join(', ')}.`);
  return value;
}

export function requireNumber(value, field, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(value);
  assert(Number.isFinite(n), `${field} must be a number.`);
  assert(n >= min && n <= max, `${field} must be between ${min} and ${max}.`);
  return n;
}

/** Validate a {lat, lng} pair. */
export function requireLatLng(value, field) {
  assert(value && typeof value === 'object', `${field} must be a {lat, lng} object.`);
  return {
    lat: requireNumber(value.lat, `${field}.lat`, { min: -90, max: 90 }),
    lng: requireNumber(value.lng, `${field}.lng`, { min: -180, max: 180 })
  };
}

/** Validate a [west, south, east, north] bounding box. */
export function requireBbox(value, field = 'bbox') {
  assert(Array.isArray(value) && value.length === 4, `${field} must be [west, south, east, north].`);
  const [w, s, e, n] = value.map(Number);
  assert([w, s, e, n].every(Number.isFinite), `${field} must contain four numbers.`);
  assert(w >= -180 && e <= 180 && s >= -90 && n <= 90, `${field} is out of range.`);
  assert(w < e && s < n, `${field} must have west < east and south < north.`);
  return [w, s, e, n];
}
