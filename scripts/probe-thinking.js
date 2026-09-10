#!/usr/bin/env node
/**
 * Which thinking configuration does each Flash-Lite model actually accept?
 *
 * `thinkingBudget: 0` was valid on Gemini 2.5 Flash-Lite and is rejected by
 * the model `gemini-flash-lite-latest` points at today. Rather than guess a
 * replacement, ask: send the realistic payload shape (inline image + response
 * schema) against a matrix of models and thinking configs, and print what
 * survives.
 *
 *   node scripts/probe-thinking.js
 *
 * A handful of one-pixel calls. Reads GEMINI_API_KEY from .env.
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

const TINY_JPEG = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

const MODELS = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'];

const VARIANTS = [
  ['no thinkingConfig', undefined],
  ['thinkingBudget: 0', { thinkingBudget: 0 }],
  ['thinkingBudget: 128', { thinkingBudget: 128 }],
  ['thinkingBudget: -1 (dynamic)', { thinkingBudget: -1 }],
  ["thinkingLevel: 'low'", { thinkingLevel: 'low' }],
  ["thinkingLevel: 'minimal'", { thinkingLevel: 'minimal' }]
];

function payload(thinkingConfig) {
  return {
    contents: [{
      role: 'user',
      parts: [
        { text: 'Reply as JSON with note set to the single word ok.' },
        { inlineData: { mimeType: 'image/jpeg', data: TINY_JPEG } }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 900,
      ...(thinkingConfig ? { thinkingConfig } : {}),
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { note: { type: 'STRING', maxLength: 240 } }, required: ['note'] }
    }
  };
}

async function main() {
  console.log('Resolving what the aliases point at:\n');
  const list = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': KEY } });
  if (list.ok) {
    for (const m of ((await list.json()).models || [])) {
      const name = m.name.replace('models/', '');
      if (MODELS.includes(name)) {
        console.log(`  ${name.padEnd(28)} version=${m.version || '?'}  ${m.displayName || ''}`);
      }
    }
  }

  for (const model of MODELS) {
    console.log(`\n${model}`);
    for (const [label, thinkingConfig] of VARIANTS) {
      const res = await fetch(`${BASE}/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
        body: JSON.stringify(payload(thinkingConfig))
      });
      if (res.ok) {
        const json = await res.json();
        const usage = json.usageMetadata || {};
        const thoughts = usage.thoughtsTokenCount ?? 0;
        console.log(`  ✓ ${label.padEnd(30)} in=${usage.promptTokenCount ?? '?'} out=${usage.candidatesTokenCount ?? '?'} thinking=${thoughts}`);
      } else {
        let why = `HTTP ${res.status}`;
        try { why += ` — ${(JSON.parse(await res.text()).error || {}).message}`; } catch { /* keep the status */ }
        console.log(`  ✗ ${label.padEnd(30)} ${why}`);
      }
    }
  }

  console.log('\nPick the cheapest variant with thinking=0 (or lowest) that succeeds.');
}

main().catch((e) => { console.error(e); process.exit(1); });
