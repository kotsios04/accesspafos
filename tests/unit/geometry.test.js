/**
 * Firestore-safe geometry encoding.
 *
 * The whole OSM import failed on `INVALID_ARGUMENT: Nested arrays are not
 * allowed` after correctly parsing all 5,697 segments: a LineString is an
 * array of coordinate pairs, and Firestore refuses to store an array inside an
 * array. The dry run never reached a write, so nothing caught it until the
 * first real import.
 */

import { describe, it, expect } from 'vitest';
import { packGeometry, unpackGeometry, decodeSegment } from '@shared/geometry.js';

const LINE = [[32.4031, 34.7533], [32.4045, 34.7541], [32.4062, 34.7549]];

describe('packGeometry()', () => {
  it('flattens coordinate pairs so Firestore will accept them', () => {
    const flat = packGeometry(LINE);
    expect(flat).toEqual([32.4031, 34.7533, 32.4045, 34.7541, 32.4062, 34.7549]);
    // the actual constraint: no element may itself be an array
    expect(flat.some(Array.isArray)).toBe(false);
  });

  it('is idempotent, so packing an already-packed value is harmless', () => {
    expect(packGeometry(packGeometry(LINE))).toEqual(packGeometry(LINE));
  });

  it('survives empty and malformed input rather than throwing mid-import', () => {
    expect(packGeometry([])).toEqual([]);
    expect(packGeometry(null)).toEqual([]);
    expect(packGeometry(undefined)).toEqual([]);
    expect(packGeometry([[1, 2], [3]])).toEqual([1, 2]);
  });
});

describe('unpackGeometry()', () => {
  it('round-trips without losing precision', () => {
    expect(unpackGeometry(packGeometry(LINE))).toEqual(LINE);
  });

  it('passes through the nested form, so old documents still read', () => {
    expect(unpackGeometry(LINE)).toEqual(LINE);
  });

  it('drops a trailing unpaired number instead of emitting a broken point', () => {
    expect(unpackGeometry([1, 2, 3])).toEqual([[1, 2]]);
  });

  it('returns an empty line for empty or missing input', () => {
    expect(unpackGeometry([])).toEqual([]);
    expect(unpackGeometry(undefined)).toEqual([]);
  });
});

describe('decodeSegment()', () => {
  it('restores the geometry and leaves every other field alone', () => {
    const stored = { id: 'w1', regionId: 'kato-pafos', lengthMeters: 42, geometry: packGeometry(LINE) };
    const decoded = decodeSegment(stored);
    expect(decoded.geometry).toEqual(LINE);
    expect(decoded.id).toBe('w1');
    expect(decoded.regionId).toBe('kato-pafos');
    expect(decoded.lengthMeters).toBe(42);
  });

  it('does not mutate the document it was given', () => {
    const stored = { geometry: packGeometry(LINE) };
    decodeSegment(stored);
    expect(Array.isArray(stored.geometry[0])).toBe(false);
  });
});

describe('what Firestore actually rejects', () => {
  // A guard that states the rule, so the encoding cannot quietly regress.
  const hasNestedArray = (value) => Array.isArray(value) && value.some(Array.isArray);

  it('a raw LineString is rejected, the packed form is not', () => {
    expect(hasNestedArray(LINE)).toBe(true);
    expect(hasNestedArray(packGeometry(LINE))).toBe(false);
  });

  it('a packed segment document contains no nested array anywhere', () => {
    const doc = {
      id: 'w1',
      geometry: packGeometry(LINE),
      centre: [32.4045, 34.7541],
      osmTags: { highway: 'footway' },
      assessment: { barriers: ['steps'], sources: ['osm'] }
    };
    for (const [key, value] of Object.entries(doc)) {
      expect(hasNestedArray(value), `${key} holds a nested array`).toBe(false);
    }
  });
});
