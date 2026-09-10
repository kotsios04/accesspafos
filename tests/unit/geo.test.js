import { describe, it, expect } from 'vitest';
import {
  haversineMeters, lineLengthMeters, lineMidpoint, pointToSegmentMeters,
  pointToLineMeters, bearingDegrees, bearingDelta, bboxAreaKm2, splitBbox,
  padBbox, bboxContains, geohash
} from '@shared/geo.js';

const PAFOS = [32.4245, 34.7754];

describe('haversineMeters', () => {
  it('is zero for the same point', () => {
    expect(haversineMeters(PAFOS, PAFOS)).toBe(0);
  });

  it('matches a known distance to within 0.5%', () => {
    // Pafos harbour to Pafos castle, ~1.06 km along the coast road.
    const a = [32.4084, 34.7539];
    const b = [32.4210, 34.7570];
    const d = haversineMeters(a, b);
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1250);
  });

  it('is symmetric', () => {
    const a = [32.40, 34.75];
    const b = [32.42, 34.77];
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
});

describe('lineLengthMeters', () => {
  it('returns 0 for degenerate input', () => {
    expect(lineLengthMeters([])).toBe(0);
    expect(lineLengthMeters([PAFOS])).toBe(0);
    expect(lineLengthMeters(null)).toBe(0);
  });

  it('sums the segments of a polyline', () => {
    const line = [[32.40, 34.77], [32.41, 34.77], [32.42, 34.77]];
    const total = lineLengthMeters(line);
    const parts = haversineMeters(line[0], line[1]) + haversineMeters(line[1], line[2]);
    expect(total).toBeCloseTo(parts, 6);
  });
});

describe('lineMidpoint', () => {
  it('sits halfway along by arc length, not by vertex count', () => {
    // A long first segment and a short second: the midpoint must fall inside
    // the long one, which a naive "middle vertex" implementation would miss.
    const line = [[32.40, 34.77], [32.44, 34.77], [32.4405, 34.77]];
    const mid = lineMidpoint(line);
    expect(mid[0]).toBeGreaterThan(32.40);
    expect(mid[0]).toBeLessThan(32.44);
    const toMid = lineLengthMeters([line[0], mid]);
    expect(toMid).toBeCloseTo(lineLengthMeters(line) / 2, 0);
  });
});

describe('pointToSegmentMeters', () => {
  it('clamps to the segment endpoints', () => {
    const a = [32.40, 34.77];
    const b = [32.41, 34.77];
    const before = pointToSegmentMeters([32.39, 34.77], a, b);
    expect(before.t).toBe(0);
    const after = pointToSegmentMeters([32.42, 34.77], a, b);
    expect(after.t).toBe(1);
  });

  it('finds the perpendicular foot for a point beside the segment', () => {
    const result = pointToSegmentMeters([32.405, 34.771], [32.40, 34.77], [32.41, 34.77]);
    expect(result.t).toBeGreaterThan(0.4);
    expect(result.t).toBeLessThan(0.6);
    expect(result.distance).toBeGreaterThan(100);
    expect(result.distance).toBeLessThan(120);
  });
});

describe('pointToLineMeters', () => {
  it('picks the closest sub-segment', () => {
    const line = [[32.40, 34.77], [32.41, 34.77], [32.41, 34.78]];
    const result = pointToLineMeters([32.4101, 34.7790], line);
    expect(result.index).toBe(1);
    expect(result.distance).toBeLessThan(20);
  });

  it('handles an empty line without throwing', () => {
    expect(pointToLineMeters(PAFOS, []).distance).toBe(Infinity);
  });
});

describe('bearings', () => {
  it('reports due east as ~90 degrees', () => {
    expect(bearingDegrees([32.40, 34.77], [32.41, 34.77])).toBeCloseTo(90, 0);
  });

  it('reports due north as ~0 degrees', () => {
    expect(bearingDegrees([32.40, 34.77], [32.40, 34.78])).toBeCloseTo(0, 0);
  });

  it('measures the smaller angle between bearings', () => {
    expect(bearingDelta(350, 10)).toBe(20);
    expect(bearingDelta(10, 350)).toBe(20);
    expect(bearingDelta(0, 180)).toBe(180);
  });
});

describe('bbox helpers', () => {
  it('computes a plausible area for the pilot region', () => {
    const area = bboxAreaKm2([32.4030, 34.7530, 32.4380, 34.7830]);
    expect(area).toBeGreaterThan(8);
    expect(area).toBeLessThan(14);
  });

  it('splits a bbox into tiles no larger than the requested span', () => {
    const tiles = splitBbox([32.40, 34.75, 32.44, 34.79], 0.009);
    expect(tiles.length).toBeGreaterThan(1);
    for (const [w, s, e, n] of tiles) {
      expect(e - w).toBeLessThanOrEqual(0.009 + 1e-9);
      expect(n - s).toBeLessThanOrEqual(0.009 + 1e-9);
    }
  });

  it('tiles cover the original bbox corners', () => {
    const bbox = [32.40, 34.75, 32.44, 34.79];
    const tiles = splitBbox(bbox, 0.009);
    const west = Math.min(...tiles.map((t) => t[0]));
    const north = Math.max(...tiles.map((t) => t[3]));
    expect(west).toBeCloseTo(bbox[0], 9);
    expect(north).toBeCloseTo(bbox[3], 9);
  });

  it('pads outward', () => {
    const padded = padBbox([32.40, 34.75, 32.41, 34.76], 100);
    expect(padded[0]).toBeLessThan(32.40);
    expect(padded[2]).toBeGreaterThan(32.41);
    expect(bboxContains(padded, [32.405, 34.755])).toBe(true);
  });
});

describe('geohash', () => {
  it('is stable and prefix-shares for nearby points', () => {
    const a = geohash(32.4245, 34.7754, 8);
    const b = geohash(32.42451, 34.77541, 8);
    expect(a).toBe(geohash(32.4245, 34.7754, 8));
    expect(a.slice(0, 6)).toBe(b.slice(0, 6));
  });

  it('diverges for distant points', () => {
    const pafos = geohash(32.4245, 34.7754, 6);
    const nicosia = geohash(33.3823, 35.1856, 6);
    expect(pafos.slice(0, 3)).not.toBe(nicosia.slice(0, 3));
  });
});
