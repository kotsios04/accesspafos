/**
 * `analyzeStreetAccessibility` - the one place a model looks at a photograph.
 *
 * Contract:
 *   in  : an image (Mapillary thumbnail, citizen upload or verification photo)
 *   out : a validated structured observation, or an explicit failure
 *
 * The model never returns a score. It returns facts. If it returns anything
 * that does not fit the schema, the call is retried once with a stricter
 * reminder and then failed - a malformed observation is discarded, never
 * patched up into something plausible.
 */

import { getAi, model, AI_MODEL } from './genkit.js';
import { StreetAccessibilityObservationSchema } from './schema.js';
import { SYSTEM_INSTRUCTION, buildUserPrompt } from './prompt.js';
import { normalizeObservation, validateObservation, isEmptyObservation } from '../shared/observationSchema.js';
import { ANALYSIS_VERSION, AI_TEMPERATURE, AI_MAX_OUTPUT_TOKENS, AI_THINKING_CONFIG } from '../shared/config.js';
import { fetchWithRetry } from '../lib/http.js';

/** Refuse to send anything enormous to the model; thumbnails are ~200 KB. */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Download an image and inline it as a data URL.
 *
 * Inlining rather than passing the remote URL is deliberate: it keeps the
 * request deterministic, it works identically for Mapillary thumbnails and
 * Cloud Storage downloads, and it means a signed URL that expires between
 * discovery and analysis fails here, loudly, instead of silently producing a
 * blank observation.
 */
export async function fetchImageAsDataUrl(url, { maxBytes = MAX_IMAGE_BYTES } = {}) {
  const response = await fetchWithRetry(url, {
    timeoutMs: 25000,
    retries: 2,
    label: 'image download'
  });

  const contentType = (response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    throw new Error(`Unsupported image content type: ${contentType}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) throw new Error('Downloaded image was empty.');
  if (buffer.byteLength > maxBytes) {
    throw new Error(`Image is ${(buffer.byteLength / 1048576).toFixed(1)} MB, above the ${(maxBytes / 1048576).toFixed(0)} MB analysis limit.`);
  }

  return {
    dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
    contentType,
    bytes: buffer.byteLength
  };
}

/**
 * @typedef {Object} AnalyzeInput
 * @property {string} [imageUrl]      remote image to download
 * @property {string} [imageDataUrl]  already-inlined image
 * @property {{segmentKind?:string, streetName?:string, distanceMeters?:number}} [context]
 * @property {string} [modelId]
 */

/**
 * @param {AnalyzeInput} input
 * @returns {Promise<{
 *   ok: boolean,
 *   observation: object|null,
 *   model: string,
 *   analysisVersion: string,
 *   attempts: number,
 *   warnings: string[],
 *   error?: string,
 *   imageBytes?: number
 * }>}
 */
export async function analyzeStreetAccessibility(input = {}) {
  const modelId = input.modelId || AI_MODEL;
  const warnings = [];

  let dataUrl = input.imageDataUrl;
  let contentType = 'image/jpeg';
  let imageBytes;
  if (!dataUrl) {
    if (!input.imageUrl) throw new Error('analyzeStreetAccessibility requires imageUrl or imageDataUrl.');
    const fetched = await fetchImageAsDataUrl(input.imageUrl);
    dataUrl = fetched.dataUrl;
    contentType = fetched.contentType;
    imageBytes = fetched.bytes;
  }

  const [ai, modelRef] = await Promise.all([getAi(), model(modelId)]);
  const userPrompt = buildUserPrompt(input.context || {});

  const baseRequest = {
    model: modelRef,
    system: SYSTEM_INSTRUCTION,
    prompt: [
      { text: userPrompt },
      { media: { url: dataUrl, contentType } }
    ],
    output: { schema: StreetAccessibilityObservationSchema },
    config: {
      temperature: AI_TEMPERATURE,
      maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
      // This is constrained extraction, not reasoning, so we spend as little
      // as the model allows on thinking - but which settings a model accepts
      // changes between versions, so the value comes from configuration and
      // may be null. See AI_THINKING_CONFIG.
      ...(AI_THINKING_CONFIG ? { thinkingConfig: AI_THINKING_CONFIG } : {})
    }
  };

  let attempts = 0;
  let lastError = null;

  for (const request of [baseRequest, stricterRetry(baseRequest)]) {
    attempts += 1;
    try {
      const response = await generateWithThinkingFallback(ai, request, warnings);
      const raw = response.output;
      if (!raw) {
        lastError = 'Model returned no structured output.';
        continue;
      }

      const observation = normalizeObservation(raw);
      const check = validateObservation(observation);
      if (!check.ok) {
        lastError = `Observation failed validation: ${check.errors.slice(0, 3).join('; ')}`;
        continue;
      }

      if (isEmptyObservation(observation)) {
        warnings.push('Model reported nothing usable in this image; it contributes no evidence.');
      }

      return {
        ok: true,
        observation,
        model: modelId,
        // What the API says actually served the request. `modelId` is what we
        // asked for; the two can differ, and only this one is evidence.
        modelVersion: response.custom?.modelVersion || null,
        analysisVersion: ANALYSIS_VERSION,
        attempts,
        warnings,
        imageBytes
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      // A configuration or quota failure will not be fixed by retrying with a
      // sterner prompt, so stop immediately.
      if (/api key|quota|permission|not configured|billing/i.test(lastError)) break;
    }
  }

  return {
    ok: false,
    observation: null,
    model: modelId,
    analysisVersion: ANALYSIS_VERSION,
    attempts,
    warnings,
    error: lastError || 'Unknown analysis failure.',
    imageBytes
  };
}

/**
 * Some model versions reject an explicit thinking budget. Rather than pin a
 * version and hope, we try with it and transparently fall back without it.
 *
 * The fallback used to fire only when the error text mentioned thinking. It
 * does not: the Gemini REST API answers a rejected `thinkingConfig` with a
 * flat `400 Request contains an invalid argument`, and Genkit discards the
 * `error.details` array that would have named the field. So the retry never
 * ran, and every frame in a job failed identically. Any INVALID_ARGUMENT is
 * now treated as a possible config rejection - the retry is one extra call on
 * a request that has already failed, and the circuit breaker in the analysis
 * job bounds how often we can be wrong about this.
 */
function looksLikeConfigRejection(message) {
  return /thinking|thought|unknown name|unsupported|invalid.*config/i.test(message)
    || /invalid_argument|invalid argument|400 bad request/i.test(message);
}

async function generateWithThinkingFallback(ai, request, warnings) {
  try {
    return await ai.generate(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (request.config?.thinkingConfig && looksLikeConfigRejection(message)) {
      warnings.push('Model rejected the request configuration; retried without a thinking budget.');
      const { thinkingConfig, ...config } = request.config;
      return ai.generate({ ...request, config });
    }
    throw error;
  }
}

function stricterRetry(request) {
  return {
    ...request,
    prompt: [
      ...request.prompt,
      {
        text: 'Your previous response did not match the required structure. Reply again using ONLY the allowed values from the schema. When in doubt about any field, answer "unknown" or "not_visible". Do not add fields and do not explain yourself.'
      }
    ],
    config: { ...request.config, temperature: 0 }
  };
}

/**
 * Register the analysis as a named Genkit flow, so it appears in the Genkit
 * developer UI and can be exercised in isolation. Lazily created because the
 * Genkit instance itself needs a runtime secret.
 */
let cachedFlow = null;
export async function getAnalyzeFlow() {
  if (cachedFlow) return cachedFlow;
  const ai = await getAi();
  cachedFlow = ai.defineFlow(
    { name: 'analyzeStreetAccessibility' },
    async (payload) => analyzeStreetAccessibility(payload)
  );
  return cachedFlow;
}
