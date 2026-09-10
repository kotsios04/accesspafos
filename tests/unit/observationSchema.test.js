import { describe, it, expect } from 'vitest';
import {
  ENUMS, emptyObservation, validateObservation, normalizeObservation,
  isEmptyObservation, readPath, AGREEMENT_KEYS, NON_INFORMATIVE
} from '@shared/observationSchema.js';

describe('the empty observation', () => {
  it('is valid and carries no information', () => {
    const empty = emptyObservation();
    expect(validateObservation(empty).ok).toBe(true);
    expect(isEmptyObservation(empty)).toBe(true);
  });
});

describe('validateObservation', () => {
  it('rejects a non-object', () => {
    expect(validateObservation(null).ok).toBe(false);
    expect(validateObservation('steps').ok).toBe(false);
    expect(validateObservation([]).ok).toBe(false);
  });

  it('rejects values outside the vocabulary', () => {
    const result = validateObservation({ ...emptyObservation(), imageQuality: 'stunning' });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('imageQuality');
  });

  it('names every missing section', () => {
    const result = validateObservation({ imageQuality: 'good' });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('pedestrianPath');
    expect(result.errors.join(' ')).toContain('surface');
  });
});

describe('normalizeObservation', () => {
  it('coerces unknown values to "unknown" rather than guessing', () => {
    const result = normalizeObservation({
      imageQuality: 'superb',
      surface: { type: 'marble', condition: 'pristine' },
      stairs: { visible: 'maybe' }
    });
    expect(result.imageQuality).toBe('poor');
    expect(result.surface.type).toBe('unknown');
    expect(result.surface.condition).toBe('unknown');
    expect(result.stairs.visible).toBe('unknown');
    expect(validateObservation(result).ok).toBe(true);
  });

  it('keeps values that are in the vocabulary', () => {
    const result = normalizeObservation({
      imageQuality: 'good',
      pedestrianPath: { visible: 'yes', condition: 'clear' },
      surface: { type: 'paved', condition: 'good' }
    });
    expect(result.imageQuality).toBe('good');
    expect(result.pedestrianPath.condition).toBe('clear');
  });

  it('drops crossing features it does not know', () => {
    const result = normalizeObservation({
      crossing: { visible: 'yes', accessibleFeatures: ['tactile_paving', 'teleporter', 'dropped_kerb'] }
    });
    expect(result.crossing.accessibleFeatures).toEqual(['tactile_paving', 'dropped_kerb']);
  });

  it('deduplicates crossing features', () => {
    const result = normalizeObservation({
      crossing: { visible: 'yes', accessibleFeatures: ['tactile_paving', 'tactile_paving'] }
    });
    expect(result.crossing.accessibleFeatures).toEqual(['tactile_paving']);
  });

  it('truncates free text so a verbose model cannot bloat a document', () => {
    const result = normalizeObservation({
      obstacle: { visible: 'yes', severity: 'moderate', description: 'x'.repeat(500) },
      notes: 'y'.repeat(900),
      uncertainFindings: Array(20).fill('z'.repeat(300))
    });
    expect(result.obstacle.description.length).toBeLessThanOrEqual(140);
    expect(result.notes.length).toBeLessThanOrEqual(240);
    expect(result.uncertainFindings.length).toBeLessThanOrEqual(6);
  });

  it('survives complete garbage', () => {
    for (const input of [null, undefined, 42, 'text', [], { a: { b: { c: 1 } } }]) {
      expect(validateObservation(normalizeObservation(input)).ok).toBe(true);
    }
  });
});

describe('isEmptyObservation', () => {
  it('is false as soon as one field says something', () => {
    const observation = normalizeObservation({ stairs: { visible: 'yes' } });
    expect(isEmptyObservation(observation)).toBe(false);
  });

  it('treats "not_visible" as saying nothing', () => {
    const observation = normalizeObservation({
      pedestrianPath: { visible: 'not_visible', condition: 'unknown' }
    });
    expect(isEmptyObservation(observation)).toBe(true);
  });
});

describe('readPath and the agreement vocabulary', () => {
  it('reads dotted paths safely', () => {
    const observation = emptyObservation();
    expect(readPath(observation, 'surface.type')).toBe('unknown');
    expect(readPath(observation, 'nope.nothing')).toBeUndefined();
  });

  it('lists agreement keys that all resolve on a real observation', () => {
    const observation = emptyObservation();
    for (const key of AGREEMENT_KEYS) {
      expect(readPath(observation, key)).toBeDefined();
    }
  });

  it('treats unknown and not_visible as non-informative', () => {
    expect(NON_INFORMATIVE).toContain('unknown');
    expect(NON_INFORMATIVE).toContain('not_visible');
  });

  it('exposes a non-empty vocabulary for every enum', () => {
    for (const [name, values] of Object.entries(ENUMS)) {
      expect(Array.isArray(values), name).toBe(true);
      expect(values.length, name).toBeGreaterThan(0);
    }
  });
});
