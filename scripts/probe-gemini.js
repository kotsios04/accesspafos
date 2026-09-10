#!/usr/bin/env node
/**
 * Find out what the Gemini API is actually objecting to.
 *
 * Genkit reports `INVALID_ARGUMENT ... [400 Bad Request] Request contains an
 * invalid argument.` and throws away the `error.details` array, which is the
 * only part that says *which* argument. This talks to the REST endpoint
 * directly and prints the whole body, then walks the request up one feature at
 * a time so the first failing step names the cause.
 *
 *   node scripts/probe-gemini.js
 *
 * Costs a handful of tiny calls. Reads GEMINI_API_KEY from .env.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

for (const line of existsSync(resolve(root, '.env')) ? readFileSync(resolve(root, '.env'), 'utf8').split('\n') : []) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('GEMINI_API_KEY missing from .env'); process.exit(1); }

const MODEL = process.argv[2] || 'gemini-flash-lite-latest';

// A 1x1 white JPEG, so the image path is exercised without a download.
const TINY_JPEG = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

async function call(label, body) {
  const res = await fetch(`${BASE}/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (res.ok) {
    console.log(`  ✓ ${label}`);
    return true;
  }
  console.log(`  ✗ ${label} — HTTP ${res.status}`);
  try {
    const err = JSON.parse(text).error || {};
    console.log(`      message: ${err.message}`);
    if (err.details) console.log(`      details: ${JSON.stringify(err.details)}`);
  } catch { console.log(`      body: ${text.slice(0, 600)}`); }
  return false;
}

const TEXT = { contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ok' }] }] };

async function main() {
  console.log(`Model under test: ${MODEL}\n`);

  console.log('A. Does the model exist?');
  const list = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': KEY } });
  if (!list.ok) {
    console.log(`  ✗ models.list failed: HTTP ${list.status} ${(await list.text()).slice(0, 300)}`);
  } else {
    const models = (await list.json()).models || [];
    const hit = models.find((m) => m.name === `models/${MODEL}`);
    console.log(hit ? `  ✓ ${MODEL} exists` : `  ✗ ${MODEL} NOT in the model list`);
    const lite = models.filter((m) => /lite/i.test(m.name)).map((m) => m.name.replace('models/', ''));
    console.log(`  flash-lite models available: ${lite.join(', ') || '(none)'}`);
  }

  console.log('\nB. Plain text, no config');
  if (!await call('text only', TEXT)) {
    console.log('\n  → The key or the model is the problem, not the request shape. Stopping.');
    return;
  }

  console.log('\nC. Adding thinkingConfig { thinkingBudget: 0 }');
  const thinkingOk = await call('thinkingBudget: 0',
    { ...TEXT, generationConfig: { thinkingConfig: { thinkingBudget: 0 } } });

  console.log('\nD. Adding a response schema');
  const plainSchema = {
    type: 'OBJECT',
    properties: { verdict: { type: 'STRING', enum: ['yes', 'no'] } },
    required: ['verdict']
  };
  await call('schema, no length limits',
    { ...TEXT, generationConfig: { responseMimeType: 'application/json', responseSchema: plainSchema } });

  await call('schema WITH string maxLength (what our Zod .max() emits)', {
    ...TEXT,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: { note: { type: 'STRING', maxLength: 140 } },
        required: ['note']
      }
    }
  });

  await call('schema with array maxItems', {
    ...TEXT,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: { items: { type: 'ARRAY', maxItems: 6, items: { type: 'STRING' } } },
        required: ['items']
      }
    }
  });

  console.log('\nE. Adding an inline image');
  await call('text + inline image', {
    contents: [{
      role: 'user',
      parts: [
        { text: 'Reply with the single word: ok' },
        { inlineData: { mimeType: 'image/jpeg', data: TINY_JPEG } }
      ]
    }]
  });

  console.log('\nF. Everything at once, the way the job sends it');
  await call('image + schema + thinkingBudget 0', {
    contents: [{
      role: 'user',
      parts: [
        { text: 'Reply with the single word: ok' },
        { inlineData: { mimeType: 'image/jpeg', data: TINY_JPEG } }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 900,
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: { note: { type: 'STRING', maxLength: 240 } },
        required: ['note']
      }
    }
  });

  if (!thinkingOk) {
    console.log('\n→ thinkingBudget: 0 is rejected by this model. That is the likely cause:');
    console.log('  the fallback in analyze.js only retries when the error text mentions');
    console.log('  "thinking"/"unsupported", and this error says none of those things.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
