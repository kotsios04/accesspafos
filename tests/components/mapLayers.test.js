/**
 * The accessibility layer's paint expressions.
 *
 * These exist because of a bug that ran for as long as the layer did: the white
 * casing was built as `['+', ramp, 3]`, which the style spec forbids - a `zoom`
 * expression may only be the direct input of a top-level `interpolate` or
 * `step`. MapLibre logged an error and silently fell back to a constant 1px, so
 * the casing that lifts the coloured lines off the basemap never lifted
 * anything. Nothing failed; it just looked slightly wrong forever.
 *
 * `layers.js` needs no real map, only something that records what was asked
 * for, so the expressions can be inspected directly.
 */

import { describe, it, expect } from 'vitest';
import { addAccessibilityLayer, SOURCE_ID } from '@src/maps/layers.js';

/** The smallest thing `addAccessibilityLayer` will accept and talk to. */
function fakeMap() {
  const layers = [];
  const sources = new Map();
  return {
    layers,
    sources,
    getSource: (id) => sources.get(id),
    addSource: (id, spec) => sources.set(id, { ...spec, setData() {} }),
    addLayer: (layer) => layers.push(layer)
  };
}

const EMPTY = { type: 'FeatureCollection', features: [] };

/** Every stop value of an `interpolate` ramp, in order. */
function stops(expression) {
  const out = [];
  for (let i = 4; i < expression.length; i += 2) out.push(expression[i]);
  return out;
}

describe('accessibility layer paint', () => {
  it('adds one source and the six layers the map interacts with', () => {
    const map = fakeMap();
    addAccessibilityLayer(map, EMPTY);

    expect(map.sources.has(SOURCE_ID)).toBe(true);
    expect(map.layers.map((l) => l.id)).toEqual([
      'accessibility-base',
      'accessibility-line',
      'accessibility-unknown',
      'accessibility-simulated',
      'accessibility-selected',
      'accessibility-hitbox'
    ]);
  });

  it('keeps every zoom-driven width a top-level interpolate', () => {
    const map = fakeMap();
    addAccessibilityLayer(map, EMPTY);

    for (const layer of map.layers) {
      const width = layer.paint['line-width'];
      if (!Array.isArray(width)) continue;      // the hitbox is a plain number

      expect(width[0], layer.id).toBe('interpolate');
      expect(width[2], layer.id).toEqual(['zoom']);
    }
  });

  it('draws the casing wider than the line it sits under, at every zoom', () => {
    const map = fakeMap();
    addAccessibilityLayer(map, EMPTY);

    const byId = Object.fromEntries(map.layers.map((l) => [l.id, l]));
    const casing = stops(byId['accessibility-base'].paint['line-width']);
    const line = stops(byId['accessibility-line'].paint['line-width']);

    expect(casing).toHaveLength(line.length);
    for (const [i, value] of casing.entries()) {
      expect(value, `stop ${i}`).toBeGreaterThan(line[i]);
    }
  });

  it('separates unverified segments by dash as well as by colour', () => {
    const map = fakeMap();
    addAccessibilityLayer(map, EMPTY);

    const unknown = map.layers.find((l) => l.id === 'accessibility-unknown');
    // Colour is never the only channel carrying meaning on this map.
    expect(unknown.paint['line-dasharray']).toBeTruthy();
  });
});
