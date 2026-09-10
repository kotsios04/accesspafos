/**
 * Outbound HTTP with timeouts, bounded retries and polite backoff.
 *
 * Overpass, Nominatim and Mapillary are free services run for the public
 * good. Hammering them on failure is both rude and counter-productive, so
 * every retry here backs off, and 429/503 are treated as "slow down", not as
 * "try again immediately".
 */

export class HttpError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {string} url
 * @param {RequestInit & {timeoutMs?: number, retries?: number, retryOn?: number[], label?: string}} [options]
 */
export async function fetchWithRetry(url, options = {}) {
  const {
    timeoutMs = 30000,
    retries = 2,
    retryOn = [408, 429, 500, 502, 503, 504],
    label = 'request',
    ...init
  } = options;

  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (response.ok) return response;

      const body = await safeText(response);
      if (!retryOn.includes(response.status) || attempt === retries) {
        throw new HttpError(`${label} failed with HTTP ${response.status}`, response.status, body);
      }
      lastError = new HttpError(`${label} failed with HTTP ${response.status}`, response.status, body);
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof HttpError && !retryOn.includes(err.status)) throw err;
      lastError = err;
      if (attempt === retries) break;
    }

    // Exponential backoff with jitter: 1s, 2s, 4s ...
    const delay = Math.round((2 ** attempt) * 1000 * (0.75 + Math.random() * 0.5));
    await sleep(delay);
  }

  throw lastError instanceof Error
    ? lastError
    : new HttpError(`${label} failed`, 0, null);
}

/** Fetch and parse JSON, with the same retry semantics. */
export async function fetchJson(url, options = {}) {
  const response = await fetchWithRetry(url, options);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(`${options.label || 'request'} returned malformed JSON`, response.status, text.slice(0, 400));
  }
}

async function safeText(response) {
  try {
    const t = await response.text();
    return t.slice(0, 600);
  } catch {
    return null;
  }
}

/** Run tasks with bounded concurrency, collecting per-item outcomes. */
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = { ok: true, value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  });
  await Promise.all(runners);
  return results;
}
