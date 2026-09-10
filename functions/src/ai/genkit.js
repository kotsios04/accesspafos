/**
 * Genkit + Gemini initialisation.
 *
 * The instance is created lazily and cached per warm Cloud Function instance,
 * because `defineSecret().value()` is only readable at runtime inside a
 * function that declares the secret.
 *
 * The genkit packages are also *imported* lazily, which matters more than it
 * looks. The Firebase CLI loads this whole module graph in a subprocess to
 * discover the exported functions, and gives it ten seconds. Three modules
 * import `isGeminiConfigured` — a function that only reads a secret string —
 * and a static import here dragged the entire genkit and google-genai graph
 * into that ten-second budget on every deploy, and into the cold start of
 * every function, including the ones that never touch the model.
 */

import { GEMINI_API_KEY } from '../config/index.js';
import { AI_MODEL } from '../shared/config.js';

let cachedAi = null;
let cachedGoogleAI = null;

export class GeminiNotConfiguredError extends Error {
  constructor() {
    super('GEMINI_API_KEY is not configured. AI analysis is unavailable until it is set.');
    this.name = 'GeminiNotConfiguredError';
    this.code = 'gemini-not-configured';
  }
}

/** Cheap enough to call from anywhere: it reads a secret, nothing more. */
export function isGeminiConfigured() {
  try {
    return Boolean(GEMINI_API_KEY.value());
  } catch {
    return false;
  }
}

async function loadGoogleAI() {
  if (!cachedGoogleAI) ({ googleAI: cachedGoogleAI } = await import('@genkit-ai/google-genai'));
  return cachedGoogleAI;
}

export async function getAi() {
  if (cachedAi) return cachedAi;
  const apiKey = GEMINI_API_KEY.value();
  if (!apiKey) throw new GeminiNotConfiguredError();
  const [{ genkit }, googleAI] = await Promise.all([import('genkit'), loadGoogleAI()]);
  cachedAi = genkit({ plugins: [googleAI({ apiKey })] });
  return cachedAi;
}

/** The configured model reference. */
export async function model(modelId = AI_MODEL) {
  const googleAI = await loadGoogleAI();
  return googleAI.model(modelId);
}

export { AI_MODEL };
