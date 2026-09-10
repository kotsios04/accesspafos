#!/usr/bin/env node
/**
 * Parse every module under functions/src with Node's own parser.
 *
 * This runs in the Firebase `predeploy` hook: it is a cheap, dependency-free
 * guard against shipping a syntax error to production, and it fails loudly
 * before anything is uploaded.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(p));
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = await walk(srcDir);
let failed = 0;
for (const file of files) {
  try {
    await run(process.execPath, ['--check', file]);
  } catch (err) {
    failed += 1;
    console.error(`✗ ${relative(srcDir, file)}`);
    console.error(String(err.stderr || err.message).trim());
  }
}

if (failed > 0) {
  console.error(`\n[syntax-check] ${failed} file(s) failed to parse.`);
  process.exit(1);
}
console.log(`[syntax-check] ${files.length} module(s) parsed cleanly.`);

/**
 * Only `defineSecret` params may appear in a function's `secrets:` array.
 *
 * The CLI resolves that array against Secret Manager, so a `defineString`
 * param listed there fails the whole deploy with a 404 for a secret that was
 * never meant to exist - after the upload has already started, and with an
 * error that names the parameter rather than the mistake. Catching it here
 * costs nothing and turns a confusing deploy failure into one line.
 */
const config = await readFile(join(srcDir, 'config', 'index.js'), 'utf8');
const declared = {
  secret: [...config.matchAll(/export const (\w+) = defineSecret\(/g)].map((m) => m[1]),
  string: [...config.matchAll(/export const (\w+) = define(?:String|Int|Boolean|List)\(/g)].map((m) => m[1])
};

let misbound = 0;
for (const file of files) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/secrets:\s*\[([^\]]*)\]/g)) {
    for (const name of match[1].split(',').map((x) => x.trim()).filter(Boolean)) {
      if (declared.secret.includes(name)) continue;
      misbound += 1;
      const kind = declared.string.includes(name) ? 'a defineString param' : 'not a declared secret';
      console.error(`✗ ${relative(srcDir, file)}: \`secrets: [${name}]\` - ${name} is ${kind}.`);
    }
  }
}

if (misbound > 0) {
  console.error(`\n[syntax-check] ${misbound} non-secret param(s) bound as secrets. Remove them from \`secrets:\`; defineString values are available at runtime without it.`);
  process.exit(1);
}
console.log('[syntax-check] secrets bindings verified.');

/**
 * A function that reads a secret must also declare it.
 *
 * `defineSecret(...).value()` resolves only inside a function whose options
 * list that secret in `secrets:`. Elsewhere it throws, and every call site in
 * this codebase wraps it in a try/catch that answers "not configured" - so a
 * missing declaration does not fail loudly, it quietly reports the opposite of
 * the truth. `startAnalysisJob` refused to run for exactly this reason while
 * GEMINI_API_KEY was correctly configured all along.
 *
 * Reads are matched through the small helpers that wrap them as well as
 * through `.value()` directly.
 */
const READERS = {
  MAPILLARY_ACCESS_TOKEN: ['MAPILLARY_ACCESS_TOKEN.value()', 'isMapillaryConfigured()'],
  GEMINI_API_KEY: ['GEMINI_API_KEY.value()', 'isGeminiConfigured()']
};

const entry = await readFile(join(srcDir, 'index.js'), 'utf8');
// Split on the exported callable/trigger boundaries so each function's own
// options block and body are examined together.
const blocks = entry.split(/\nexport const /).slice(1);
let unbound = 0;

for (const block of blocks) {
  const name = (block.match(/^(\w+)/) || [])[1];
  if (!name) continue;
  const header = block.slice(0, block.indexOf('async (') + 1) || block.slice(0, 600);
  const declared = (header.match(/secrets:\s*\[([^\]]*)\]/) || [, ''])[1];

  for (const [secret, reads] of Object.entries(READERS)) {
    if (!reads.some((r) => block.includes(r))) continue;
    if (declared.includes(secret)) continue;
    unbound += 1;
    console.error(`\u2717 ${name}: reads ${secret} but does not declare it in \`secrets:\`.`);
  }
}

if (unbound > 0) {
  console.error(`\n[syntax-check] ${unbound} function(s) read a secret they do not declare. \`.value()\` will throw there and the guarded feature will report itself unavailable.`);
  process.exit(1);
}
console.log('[syntax-check] secret reads are declared.');
