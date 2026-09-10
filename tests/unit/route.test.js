/**
 * Route-level honesty: a summary may not assert more than its evidence.
 *
 * Separate from routing.test.js, which covers path-finding. This file covers
 * what the resulting summary is allowed to claim.
 */

import { describe, it, expect } from 'vitest';
import { summariseRoute } from '@shared/route.js';
import { SegmentStatus, RouteVariant } from '@shared/constants.js';

describe('a route may not claim a score it has no evidence for', () => {
  // Found live: a real 1,316 m route across Kato Pafos reported
  // `accessibilityScore: 96` while its own `unknownPercent` read 100. Every
  // segment on it was unverified.
  //
  // The cause is a gap between two layers that each behaved correctly on their
  // own. Scoring gives a segment a provisional number even when the evidence
  // is thin - a bare footway with no recorded barriers scores 100 - and
  // `classifySegment` then refuses to classify it, returning `unverified`.
  // The route summary averaged the provisional numbers and skipped the gate,
  // so the discipline held at segment level and evaporated at route level.
  const edge = (id, status, score, lengthMeters = 200) => ({
    id,
    lengthMeters,
    status,
    accessibilityScore: score,
    evidenceConfidence: status === SegmentStatus.UNVERIFIED ? 15 : 80,
    geometry: [[32.40, 34.75], [32.41, 34.76]],
    barriers: []
  });

  const summarise = (edges) => summariseRoute(
    { edges, distanceMeters: edges.reduce((sum, e) => sum + e.lengthMeters, 0) },
    { variant: RouteVariant.RECOMMENDED, profileId: 'wheelchair' }
  );

  it('reports no score when nothing on the route was assessed', () => {
    const route = summarise([
      edge('a', SegmentStatus.UNVERIFIED, 100),
      edge('b', SegmentStatus.UNVERIFIED, 96),
      edge('c', SegmentStatus.UNVERIFIED, 92)
    ]);
    expect(route.accessibilityScore).toBeNull();
    expect(route.unknownPercent).toBe(100);
    expect(route.assessedShare).toBe(0);
  });

  it('reports a score when the route is fully assessed', () => {
    const route = summarise([
      edge('a', SegmentStatus.ACCESSIBLE, 95),
      edge('b', SegmentStatus.ACCESSIBLE, 88)
    ]);
    expect(route.accessibilityScore).toBe(92);
    expect(route.assessedShare).toBe(1);
  });

  it('withholds the score when too little of the route is assessed', () => {
    const route = summarise([
      edge('a', SegmentStatus.ACCESSIBLE, 90),
      edge('b', SegmentStatus.UNVERIFIED, 100),
      edge('c', SegmentStatus.UNVERIFIED, 100)
    ]);
    expect(route.assessedShare).toBeCloseTo(0.333, 2);
    expect(route.accessibilityScore).toBeNull();
  });

  it('averages only the assessed part, never the provisional numbers', () => {
    // The unverified half scores 100. If it leaked in, the average would be 95.
    const route = summarise([
      edge('a', SegmentStatus.ACCESSIBLE, 90),
      edge('b', SegmentStatus.UNVERIFIED, 100)
    ]);
    expect(route.accessibilityScore).toBe(90);
  });

  it('never reports a score higher than the assessed segments justify', () => {
    const route = summarise([
      edge('a', SegmentStatus.PARTIAL, 60),
      edge('b', SegmentStatus.PARTIAL, 64),
      edge('c', SegmentStatus.UNVERIFIED, 100)
    ]);
    expect(route.accessibilityScore).toBe(62);
    expect(route.accessibilityScore).toBeLessThan(100);
  });
});
