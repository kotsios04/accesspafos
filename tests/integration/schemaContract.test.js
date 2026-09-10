/**
 * The model-boundary contract.
 *
 * The Zod schema the model is constrained by and the validator the pipeline
 * enforces afterwards must speak the same vocabulary. If they drift, the
 * model becomes able to emit a value the pipeline silently discards - which
 * looks like the model being unhelpful rather than like a bug here.
 *
 * The schema module imports Genkit, which lives with the Cloud Functions
 * rather than at the repository root, so this checks the contract by reading
 * the source. That is deliberately a weaker test than importing it, and it
 * still catches the failure that actually happens: someone hard-coding a
 * literal enum in one place and not the other.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { ENUMS } from '@shared/observationSchema.js';
import { SYSTEM_INSTRUCTION, buildUserPrompt } from '../../functions/src/ai/prompt.js';

const schemaSource = readFileSync(
  fileURLToPath(new URL('../../functions/src/ai/schema.js', import.meta.url)), 'utf8'
);

describe('the Zod schema', () => {
  it('derives its vocabulary from the shared enums', () => {
    expect(schemaSource).toContain("from '../shared/observationSchema.js'");
    expect(schemaSource).toContain('ENUMS');
  });

  it('hard-codes no enum literals of its own', () => {
    // z.enum([...]) with a literal array would be a second source of truth.
    expect(schemaSource).not.toMatch(/z\.enum\(\s*\[/);
  });

  it('covers every field the validator checks', () => {
    for (const field of ['imageQuality', 'pedestrianPath', 'curbRamp', 'stairs',
      'surface', 'obstacle', 'crossing', 'clearPassage', 'uncertainFindings', 'notes']) {
      expect(schemaSource, field).toContain(field);
    }
  });

  it('references every enum group the vocabulary defines', () => {
    for (const name of Object.keys(ENUMS)) {
      expect(schemaSource, name).toContain(`ENUMS.${name}`);
    }
  });
});

describe('the system instruction', () => {
  it('forbids identifying people', () => {
    expect(SYSTEM_INSTRUCTION).toMatch(/never identify.*people/i);
  });

  it('forbids inferring disability or health', () => {
    expect(SYSTEM_INSTRUCTION).toMatch(/disability|health/i);
  });

  it('requires "not visible" to be distinguished from "no"', () => {
    expect(SYSTEM_INSTRUCTION).toContain('not_visible');
    expect(SYSTEM_INSTRUCTION).toMatch(/distinguish/i);
  });

  it('forbids estimating widths and gradients from a single photograph', () => {
    expect(SYSTEM_INSTRUCTION).toMatch(/widths in metres|gradients in percent/i);
  });

  it('forbids claiming legal or regulatory compliance', () => {
    expect(SYSTEM_INSTRUCTION).toMatch(/legal or regulatory compliance/i);
  });

  it('forbids the model producing a score', () => {
    expect(SYSTEM_INSTRUCTION).toMatch(/do not output an accessibility score/i);
  });

  it('tells the model that "unknown" is an acceptable answer', () => {
    expect(SYSTEM_INSTRUCTION).toMatch(/unknown.*acceptable|preferred over/i);
  });
});

describe('the per-image prompt', () => {
  it('gives context without making it an expected answer', () => {
    const prompt = buildUserPrompt({ segmentKind: 'crossing', streetName: 'Poseidonos', distanceMeters: 12 });
    expect(prompt).toContain('crossing');
    expect(prompt).toMatch(/may be wrong|out of date/i);
    expect(prompt).toMatch(/report only what you can actually see/i);
  });

  it('works with no context at all', () => {
    expect(buildUserPrompt({}).length).toBeGreaterThan(20);
    expect(buildUserPrompt().length).toBeGreaterThan(20);
  });
});
