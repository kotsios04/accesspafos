#!/usr/bin/env node
/**
 * Compute agreement metrics from labelled samples.
 *
 * No network, no model calls, no external API: it reads labels and does
 * arithmetic. That is deliberate — an evaluation harness that depended on a
 * live service could not be re-run to check a past result.
 *
 *   npm run evaluate
 *   npm run evaluate -- --input path/to/labels.json
 *   npm run evaluate -- --input labels.json --json
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = join(here, '..', 'fixtures', 'sample-labels.json');

/** Ordered worst-to-best, so an "optimistic" error is a move up this list. */
const RANK = { inaccessible: 1, partial: 2, accessible: 3 };
const SUFFICIENT_SAMPLE = 30;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i += 1; }
  }
  return args;
}

export function evaluate(samples) {
  const all = samples.filter((s) => s && s.trueStatus && s.predictedStatus);
  const classified = all.filter((s) => s.predictedStatus !== 'unverified');
  const declined = all.length - classified.length;

  const agreed = classified.filter((s) => s.predictedStatus === s.trueStatus).length;
  const optimistic = classified.filter((s) => RANK[s.predictedStatus] > RANK[s.trueStatus]);
  const pessimistic = classified.filter((s) => RANK[s.predictedStatus] < RANK[s.trueStatus]);

  // Confusion matrix.
  const states = ['accessible', 'partial', 'inaccessible'];
  const confusion = {};
  for (const truth of states) {
    confusion[truth] = { accessible: 0, partial: 0, inaccessible: 0, unverified: 0 };
  }
  for (const sample of all) {
    if (confusion[sample.trueStatus]) confusion[sample.trueStatus][sample.predictedStatus] += 1;
  }

  // Per-barrier precision and recall.
  const perBarrier = {};
  for (const sample of all) {
    const predicted = new Set(sample.predictedBarriers || []);
    const truth = new Set(sample.trueBarriers || []);
    for (const barrier of new Set([...predicted, ...truth])) {
      perBarrier[barrier] = perBarrier[barrier] || { tp: 0, fp: 0, fn: 0 };
      if (predicted.has(barrier) && truth.has(barrier)) perBarrier[barrier].tp += 1;
      else if (predicted.has(barrier)) perBarrier[barrier].fp += 1;
      else perBarrier[barrier].fn += 1;
    }
  }
  const barrierMetrics = Object.entries(perBarrier).map(([barrier, m]) => ({
    barrier,
    ...m,
    precision: m.tp + m.fp > 0 ? m.tp / (m.tp + m.fp) : null,
    recall: m.tp + m.fn > 0 ? m.tp / (m.tp + m.fn) : null
  })).sort((a, b) => (b.tp + b.fp + b.fn) - (a.tp + a.fp + a.fn));

  // Does the confidence gate behave? Segments it declined to classify should
  // not be ones it would have got right anyway — if they are, the gate is too
  // strict and the map is greyer than it needs to be.
  const declinedButKnowable = all.filter((s) => s.predictedStatus === 'unverified').length;

  return {
    sampleSize: all.length,
    classifiedSampleSize: classified.length,
    declined,
    sufficient: classified.length >= SUFFICIENT_SAMPLE,
    statusAgreement: classified.length ? agreed / classified.length : null,
    optimisticErrors: optimistic.length,
    pessimisticErrors: pessimistic.length,
    optimisticExamples: optimistic.slice(0, 5).map((s) => s.segmentId),
    confusion,
    barrierMetrics,
    declinedButKnowable,
    caveat: classified.length < SUFFICIENT_SAMPLE
      ? `Only ${classified.length} classified samples. Treat every figure below as indicative, not measured.`
      : null
  };
}

function pct(value) {
  return value == null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function report(result, source) {
  const line = (s = '') => process.stdout.write(`${s}\n`);

  line();
  line('AccessPafos AI — evaluation against human ground truth');
  line(`Source: ${source}`);
  line('─'.repeat(64));

  if (result.sampleSize === 0) {
    line('No labelled samples. No accuracy figure can be reported.');
    line('Record labels at /admin/validation first.');
    return;
  }

  if (result.caveat) {
    line(`⚠  ${result.caveat}`);
    line();
  }

  line(`Labelled segments            ${result.sampleSize}`);
  line(`  the system classified      ${result.classifiedSampleSize}`);
  line(`  the system declined        ${result.declined}   (left grey — not counted as errors)`);
  line();
  line(`Status agreement             ${pct(result.statusAgreement)}  (n = ${result.classifiedSampleSize})`);
  line(`  optimistic errors          ${result.optimisticErrors}   ← claimed better than reality`);
  line(`  pessimistic errors         ${result.pessimisticErrors}   ← claimed worse than reality`);
  if (result.optimisticExamples.length) {
    line(`  optimistic examples        ${result.optimisticExamples.join(', ')}`);
  }
  line();

  line('Confusion matrix (rows = actual, columns = predicted)');
  const cols = ['accessible', 'partial', 'inaccessible', 'unverified'];
  line(`  ${''.padEnd(14)}${cols.map((c) => c.slice(0, 12).padStart(13)).join('')}`);
  for (const truth of ['accessible', 'partial', 'inaccessible']) {
    const cells = cols.map((c) => String(result.confusion[truth][c]).padStart(13)).join('');
    line(`  ${truth.padEnd(14)}${cells}`);
  }
  line();

  if (result.barrierMetrics.length) {
    line('Per-barrier detection');
    line(`  ${'barrier'.padEnd(24)}${'tp'.padStart(5)}${'fp'.padStart(5)}${'fn'.padStart(5)}${'precision'.padStart(12)}${'recall'.padStart(10)}`);
    for (const m of result.barrierMetrics) {
      line(`  ${m.barrier.padEnd(24)}${String(m.tp).padStart(5)}${String(m.fp).padStart(5)}${String(m.fn).padStart(5)}${pct(m.precision).padStart(12)}${pct(m.recall).padStart(10)}`);
    }
    line();
  }

  line('─'.repeat(64));
  line('Optimistic errors are the ones that matter: they are the cases where');
  line('someone could be sent to a barrier the system said was not there.');
  line();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = args.input ? resolve(process.cwd(), args.input) : DEFAULT_INPUT;

  let payload;
  try {
    payload = JSON.parse(readFileSync(inputPath, 'utf8'));
  } catch (error) {
    console.error(`Could not read labels from ${inputPath}: ${error.message}`);
    process.exit(1);
  }

  const samples = Array.isArray(payload) ? payload : (payload.samples || []);
  const result = evaluate(samples);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const isFixture = inputPath === DEFAULT_INPUT;
  report(result, isFixture ? `${inputPath}  (FIXTURE DATA — not a real measurement)` : inputPath);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
