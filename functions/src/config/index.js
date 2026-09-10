/**
 * Cloud Functions runtime configuration and secret bindings.
 *
 * Secrets are declared with `defineSecret` and bound per-function, so Google
 * Secret Manager injects them at runtime and they never appear in source,
 * in the deploy payload, or in the client bundle.
 */

import { defineSecret, defineString } from 'firebase-functions/params';
import { APP_REGION } from '../shared/config.js';

export const REGION = APP_REGION;

// --- secrets ---------------------------------------------------------------
export const MAPILLARY_ACCESS_TOKEN = defineSecret('MAPILLARY_ACCESS_TOKEN');
export const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

// --- non-secret parameters -------------------------------------------------
export const OVERPASS_ENDPOINT = defineString('OVERPASS_ENDPOINT', {
  default: 'https://overpass-api.de/api/interpreter',
  description: 'Overpass API endpoint used for bounded OSM ingestion.'
});

export const NOMINATIM_ENDPOINT = defineString('NOMINATIM_ENDPOINT', {
  default: 'https://nominatim.openstreetmap.org',
  description: 'Geocoder endpoint. Server-side only, cached and rate limited.'
});

export const OSM_CONTACT_EMAIL = defineString('OSM_CONTACT_EMAIL', {
  default: '',
  description: 'Contact address sent in the User-Agent to Overpass and Nominatim, as their usage policies require.'
});

/**
 * The User-Agent both OSM services ask for: an identifiable application and a
 * way to reach the operator. Sending a generic agent is how projects get
 * blocked, and rightly so.
 */
export function osmUserAgent() {
  const contact = OSM_CONTACT_EMAIL.value();
  return `AccessPafosAI/1.0 (Pafos 2.0 civic accessibility project${contact ? `; ${contact}` : ''})`;
}

// --- shared runtime options ------------------------------------------------
export const CALLABLE_OPTS = {
  region: REGION,
  cors: true,
  memory: '512MiB',
  timeoutSeconds: 60,
  maxInstances: 10
};

/**
 * Public read paths that must work for anonymous visitors on first load.
 *
 * These carry no role guard, so `maxInstances` is the ceiling on what a flood
 * of unauthenticated calls can cost. It is deliberately a small number.
 */
export const PUBLIC_CALLABLE_OPTS = {
  ...CALLABLE_OPTS,
  maxInstances: 20
};

export const JOB_OPTS = {
  region: REGION,
  memory: '1GiB',
  timeoutSeconds: 540,
  maxInstances: 3,
  concurrency: 1
};

export const AI_JOB_OPTS = {
  ...JOB_OPTS,
  memory: '1GiB',
  timeoutSeconds: 540,
  maxInstances: 1
};

/** Collection names, in one place so a rename is a one-line change. */
export const COLLECTIONS = Object.freeze({
  users: 'users',
  regions: 'regions',
  segments: 'segments',
  segmentAssessments: 'segmentAssessments',
  observations: 'observations',
  citizenReports: 'citizenReports',
  verificationEvents: 'verificationEvents',
  priorityIssues: 'priorityIssues',
  ingestionJobs: 'ingestionJobs',
  analysisJobs: 'analysisJobs',
  validationSamples: 'validationSamples',
  config: 'config',
  auditLogs: 'auditLogs',
  aiUsage: 'aiUsage',
  routingGraphs: 'routingGraphs',
  mapillaryImages: 'mapillaryImages',
  pois: 'pois',
  geocodeCache: 'geocodeCache'
});
