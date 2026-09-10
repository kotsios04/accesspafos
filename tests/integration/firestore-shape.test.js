/**
 * Every document the OSM import writes must be storable in Firestore.
 *
 * Firestore refuses arrays that contain arrays. The import parsed all 5,697
 * segments of Kato Pafos correctly and then failed on the write with
 * `INVALID_ARGUMENT: Nested arrays are not allowed`, because a LineString is
 * exactly that shape. Nothing caught it earlier: the dry run reports and exits
 * without writing, so the constraint was never exercised until production.
 *
 * This runs the real parser over the real Overpass fixture and asserts the
 * documents it produces would survive the write.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { parsePedestrianNetwork } from '../../functions/src/osm/parse.js';
import { packGeometry } from '@shared/geometry.js';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/overpass-kato-pafos.json', import.meta.url)), 'utf8')
);

/** Every path inside `value` that holds an array of arrays. */
function nestedArrayPaths(value, path = '') {
  const found = [];
  if (Array.isArray(value)) {
    if (value.some(Array.isArray)) found.push(path || '(root)');
    value.forEach((item, i) => found.push(...nestedArrayPaths(item, `${path}[${i}]`)));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      found.push(...nestedArrayPaths(item, path ? `${path}.${key}` : key));
    }
  }
  return found;
}

describe('OSM import documents are Firestore-safe', () => {
  const network = parsePedestrianNetwork(fixture, { regionId: 'kato-pafos' });

  it('parses the fixture into segments and nodes', () => {
    expect(network.segments.length).toBeGreaterThan(0);
    expect(network.nodes.length).toBeGreaterThan(0);
  });

  it('confirms the raw parser output is what Firestore rejects', () => {
    // Not a defect in the parser - the nested form is the correct in-memory
    // shape, and everything downstream expects it. It just cannot be stored.
    const offenders = network.segments.filter((s) => nestedArrayPaths(s).length > 0);
    expect(offenders.length).toBe(network.segments.length);
    expect(nestedArrayPaths(network.segments[0])).toContain('geometry');
  });

  it('has no nested array left in any segment once packed', () => {
    for (const segment of network.segments) {
      const doc = { ...segment, geometry: packGeometry(segment.geometry) };
      expect(nestedArrayPaths(doc), `segment ${segment.id}`).toEqual([]);
    }
  });

  it('has no nested array in any node document', () => {
    for (const node of network.nodes) {
      expect(nestedArrayPaths(node), `node ${node.id}`).toEqual([]);
    }
  });

  it('keeps the geometry recoverable after packing', () => {
    const segment = network.segments.find((s) => s.geometry.length >= 2);
    const doc = { ...segment, geometry: packGeometry(segment.geometry) };
    expect(doc.geometry.length).toBe(segment.geometry.length * 2);
    expect(doc.geometry[0]).toBe(segment.geometry[0][0]);
    expect(doc.geometry[1]).toBe(segment.geometry[0][1]);
  });
});
