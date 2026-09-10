/**
 * Typed wrappers over the callable Cloud Functions.
 *
 * One place that knows the function names, so a rename is a single edit
 * rather than a hunt through the pages. Every call goes through `call()`,
 * which normalises errors into something `describeError` can translate.
 */

import { getFunctionsService } from '../config/firebase.js';
import { logError } from './errors.js';

const cache = new Map();

async function call(name, payload = {}, { timeoutMs = 60000 } = {}) {
  const functions = await getFunctionsService();
  const { httpsCallable } = await import('firebase/functions');
  const fn = httpsCallable(functions, name, { timeout: timeoutMs });
  try {
    const result = await fn(payload);
    return result.data;
  } catch (error) {
    logError(`api.${name}`, error);
    throw error;
  }
}

/** Short-lived memo for reads that several screens request at once. */
async function cached(key, ttlMs, producer) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await producer();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function invalidate(prefix = '') {
  for (const key of [...cache.keys()]) {
    if (!prefix || key.startsWith(prefix)) cache.delete(key);
  }
}

// --- public -----------------------------------------------------------------
/**
 * The payload the home screen and the map are both waiting for.
 *
 * The in-memory `cached()` above only helps within one page load. The last
 * successful answer is also written to the device, so a returning visitor sees
 * the coverage figures and the barrier list immediately instead of two
 * spinners, and the live answer replaces them a moment later. What is stored is
 * a payload the server published, not a local calculation - so the worst case
 * is a figure that is one visit out of date for about a second, and the screens
 * that use it say so if the refresh never arrives.
 */
const BOOTSTRAP_KEY = 'accesspafos.bootstrap';

export const bootstrap = () => cached('bootstrap', 120000, async () => {
  const data = await call('bootstrap');
  try {
    localStorage.setItem(BOOTSTRAP_KEY, JSON.stringify({ cachedAt: Date.now(), data }));
  } catch { /* private mode: the app just loses the head start */ }
  return data;
});

/**
 * The last bootstrap payload this device received, if any.
 *
 * Synchronous and never throws, so a screen can paint from it before deciding
 * whether it needs to wait for anything.
 *
 * @returns {{data: object, cachedAt: number}|null}
 */
export function readCachedBootstrap() {
  try {
    const entry = JSON.parse(localStorage.getItem(BOOTSTRAP_KEY) || 'null');
    return entry?.data ? entry : null;
  } catch {
    return null;
  }
}

export const calculateRoute = (payload) =>
  call('calculateRoute', payload, { timeoutMs: 120000 });

export const searchPlace = (query) =>
  cached(`search:${query.toLowerCase()}`, 300000, () => call('searchPlace', { query }));

export const reverseLookup = (lat, lng) =>
  cached(`rev:${lat.toFixed(4)},${lng.toFixed(4)}`, 600000, () => call('reverseLookup', { lat, lng }));

export const getSegmentDetail = (segmentId) =>
  cached(`segment:${segmentId}`, 60000, () => call('getSegmentDetail', { segmentId }));

export const createReport = (payload) => call('createReport', payload, { timeoutMs: 120000 });
export const getUploadPolicy = () => cached('uploadPolicy', 600000, () => call('getUploadPolicy'));

// --- reviewer ----------------------------------------------------------------
export const reviewCitizenReport = (payload) => call('reviewCitizenReport', payload, { timeoutMs: 120000 });
export const assignCitizenReport = (payload) => call('assignCitizenReport', payload);
export const getReportPhotoUrl = (reportId) => call('getReportPhotoUrl', { reportId });
export const retryReportAnalysis = (reportId) => call('retryReportAnalysis', { reportId }, { timeoutMs: 120000 });
export const verifySegmentAccessibility = (payload) => call('verifySegmentAccessibility', payload, { timeoutMs: 120000 });
export const clearSegmentOverride = (payload) => call('clearSegmentOverride', payload);
export const recordValidationLabel = (payload) => call('recordValidationLabel', payload);
export const getValidation = (regionId) => call('getValidation', { regionId });

// --- admin -------------------------------------------------------------------
export const adminOverview = (regionId) => call('adminOverview', { regionId }, { timeoutMs: 120000 });
export const adminCoverage = (regionId) => call('adminCoverage', { regionId }, { timeoutMs: 120000 });
export const updateIssueStatus = (payload) => call('updateIssueStatus', payload, { timeoutMs: 120000 });
export const getConfiguration = () => call('getConfiguration');
export const setConfiguration = (values) => call('setConfiguration', { values });
export const getAiUsage = (days) => call('getAiUsage', { days });
export const estimateAnalysis = (regionId) => call('estimateAnalysis', { regionId }, { timeoutMs: 120000 });
export const generateExport = (payload) => call('generateExport', payload, { timeoutMs: 300000 });
export const startIngestionJob = (payload) => call('startIngestionJob', payload, { timeoutMs: 120000 });
export const startAnalysisJob = (payload) => call('startAnalysisJob', payload, { timeoutMs: 120000 });
export const cancelJob = (payload) => call('cancelJob', payload);

export { call as rawCall };
