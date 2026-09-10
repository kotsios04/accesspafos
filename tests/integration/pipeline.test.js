/**
 * End-to-end pipeline, with no network at all.
 *
 * Overpass fixture -> pedestrian graph -> assessment -> routing. This is the
 * test that would catch a change breaking the product's central claim:
 * that an accessible route avoids a barrier the shortest route walks into.
 */

import { describe, it, expect } from 'vitest';
import { parsePedestrianNetwork, analyseConnectivity } from '../../functions/src/osm/parse.js';
import { parsePois, poisNear, buildPoiIndex } from '../../functions/src/osm/poi.js';
import { assessSegment } from '@shared/assess.js';
import { buildGraph, astar } from '@shared/astar.js';
import { planRoutes } from '@shared/route.js';
import { edgeCost } from '@shared/routingCost.js';
import { computePriority } from '@shared/priority.js';
import { SegmentStatus, RouteProfile, RouteVariant, Barrier } from '@shared/constants.js';
import { MAX_SEGMENT_LENGTH_M } from '@shared/config.js';
import { haversineMeters } from '@shared/geo.js';
import overpassFixture from '../fixtures/overpass-kato-pafos.json';
import poiFixture from '../fixtures/overpass-pois.json';

const NOW = Date.parse('2026-09-08T00:00:00Z');

describe('OSM ingestion', () => {
  const parsed = parsePedestrianNetwork(overpassFixture, { regionId: 'test-region' });

  it('keeps pedestrian ways and discards motorways', () => {
    expect(parsed.stats.waysKept).toBeGreaterThan(0);
    expect(parsed.stats.skippedNonPedestrian).toBeGreaterThan(0);
    const kinds = parsed.segments.map((s) => s.kind);
    expect(kinds).toContain('sidewalk');
    expect(kinds).toContain('steps');
  });

  it('drops a carriageway whose pavements are mapped separately', () => {
    expect(parsed.stats.skippedRedundantCarriageway).toBeGreaterThan(0);
  });

  it('splits ways at junctions rather than storing whole streets', () => {
    const fromLongWay = parsed.segments.filter((s) => s.osmWayId === 100);
    expect(fromLongWay.length).toBeGreaterThan(1);
  });


  it('divides a long stretch into contiguous parts', () => {
    const parts = parsed.segments.filter((s) => s.osmWayId === 101);
    expect(parts.length).toBeGreaterThan(1);
    // Each part starts where the previous one ended, so cutting a way never
    // opens a gap in the routing graph.
    for (let i = 1; i < parts.length; i += 1) {
      expect(parts[i].fromNode).toBe(parts[i - 1].toNode);
    }
    // The way still ends where it ended: way 101 (steps) and way 106 (ramp)
    // must still meet, or the steps-versus-ramp choice below is not a choice.
    expect(parts.at(-1).toNode)
      .toBe(parsed.segments.filter((s) => s.osmWayId === 106).at(-1).toNode);
  });

  it('never invents a node to satisfy the length limit', () => {
    // The limit is honoured by cutting at existing OSM vertices only, so a
    // stretch is left long rather than subdivided at a made-up point. The
    // invariant is not "two vertices" - a three-vertex stretch with a huge gap
    // in the middle is equally uncuttable - but that the segment's own first
    // span already exceeds the limit, leaving nothing inside it to cut at.
    for (const segment of parsed.segments) {
      if (segment.lengthMeters <= MAX_SEGMENT_LENGTH_M) continue;
      expect(haversineMeters(segment.geometry[0], segment.geometry[1]))
        .toBeGreaterThan(MAX_SEGMENT_LENGTH_M);
    }
  });

  it('produces stable identifiers, so re-importing updates in place', () => {
    const again = parsePedestrianNetwork(overpassFixture, { regionId: 'test-region' });
    expect(again.segments.map((s) => s.id)).toEqual(parsed.segments.map((s) => s.id));
  });

  it('welds near-coincident endpoints into one connected network', () => {
    const connectivity = analyseConnectivity(parsed.segments);
    expect(connectivity.largestComponentShare).toBeGreaterThan(0.8);
  });

  it('keeps only the tags that matter and carries the element timestamp', () => {
    const segment = parsed.segments.find((s) => s.osmWayId === 100);
    expect(segment.osmTags.highway).toBe('footway');
    expect(segment.osmTags.postal_code).toBeUndefined();
    expect(segment.osmTimestamp).toBeTruthy();
  });

  it('measures length and centre for every segment', () => {
    for (const segment of parsed.segments) {
      expect(segment.lengthMeters).toBeGreaterThan(0);
      expect(segment.centre).toHaveLength(2);
    }
  });
});

describe('assessment over the imported network', () => {
  const parsed = parsePedestrianNetwork(overpassFixture, { regionId: 'test-region' });
  const assessed = parsed.segments.map((segment) => ({
    segment,
    assessment: assessSegment({
      osmTags: segment.osmTags,
      osmTimestamp: segment.osmTimestamp,
      segmentKind: segment.kind,
      now: NOW
    })
  }));

  it('classifies the steps as inaccessible from OSM alone', () => {
    const steps = assessed.find((a) => a.segment.kind === 'steps');
    expect(steps.assessment.status).toBe(SegmentStatus.INACCESSIBLE);
  });

  it('leaves the untagged lane grey', () => {
    const bare = assessed.find((a) => a.segment.osmWayId === 104);
    expect(bare.assessment.status).toBe(SegmentStatus.UNVERIFIED);
    expect(bare.assessment.accessibilityScore).toBeNull();
  });

  it('classifies the well-tagged pavement without needing any imagery', () => {
    const rich = assessed.find((a) => a.segment.osmWayId === 100);
    expect(rich.assessment.status).not.toBe(SegmentStatus.UNVERIFIED);
  });

  it('classifies the ramp as a usable alternative to the steps', () => {
    const ramp = assessed.find((a) => a.segment.osmWayId === 106);
    expect(ramp.assessment.status).not.toBe(SegmentStatus.INACCESSIBLE);
    expect(ramp.assessment.status).not.toBe(SegmentStatus.UNVERIFIED);
  });

  it('produces a mostly-grey city from OSM tags alone, which is the honest result', () => {
    const unverified = assessed.filter((a) => a.assessment.status === SegmentStatus.UNVERIFIED);
    expect(unverified.length).toBeGreaterThan(0);
  });
});

describe('routing over the imported network', () => {
  const parsed = parsePedestrianNetwork(overpassFixture, { regionId: 'test-region' });
  const edges = parsed.segments.map((segment) => {
    const assessment = assessSegment({
      osmTags: segment.osmTags, osmTimestamp: segment.osmTimestamp,
      segmentKind: segment.kind, now: NOW
    });
    return {
      id: segment.id,
      from: segment.fromNode,
      to: segment.toNode,
      lengthMeters: segment.lengthMeters,
      geometry: segment.geometry,
      streetName: segment.streetName,
      status: assessment.status,
      accessibilityScore: assessment.accessibilityScore,
      evidenceConfidence: assessment.evidenceConfidence,
      freshnessState: assessment.freshnessState,
      barriers: assessment.barriers,
      hardBlocks: assessment.hardBlocks
    };
  });
  const nodes = {};
  for (const segment of parsed.segments) {
    nodes[segment.fromNode] = segment.geometry[0];
    nodes[segment.toNode] = segment.geometry[segment.geometry.length - 1];
  }
  const graph = buildGraph(edges, nodes);

  // A way now yields one segment per junction AND per MAX_SEGMENT_LENGTH_M, so
  // "the segment of way 101" is no longer a single thing: `find` returns its
  // first part, whose end is a new node partway along the steps. Asking for
  // the first part's `toNode` moved the goal into the middle of the staircase,
  // where there is no ramp alternative and a wheelchair route cannot exist.
  // The way's start and end are its first part's start and its last part's end.
  const partsOfWay = (wayId) => parsed.segments.filter((s) => s.osmWayId === wayId);
  const startOfWay = (wayId) => partsOfWay(wayId)[0].fromNode;
  const endOfWay = (wayId) => partsOfWay(wayId).at(-1).toNode;

  const start = startOfWay(100);
  // Way 101 (Harbour Steps) and way 106 (Harbour Ramp) both end at the same
  // node, so this is a genuine steps-versus-ramp choice for the router.
  const goal = endOfWay(101);

  it('finds a walking route across the fixture network', () => {
    const result = astar(graph, start, goal, (e) => edgeCost(e, RouteProfile.BALANCED));
    expect(result.found).toBe(true);
  });

  it('never routes a wheelchair over a segment tagged as steps', () => {
    const result = astar(graph, start, goal, (e) => edgeCost(e, RouteProfile.WHEELCHAIR));
    if (result.found) {
      for (const edge of result.edges) {
        expect(edge.barriers || []).not.toContain(Barrier.STEPS);
      }
    }
  });

  it('returns three comparable options with consistent metrics', () => {
    const plan = planRoutes({ graph, startNode: start, goalNode: goal, profile: RouteProfile.WHEELCHAIR });
    expect(plan.options).toHaveLength(3);
    for (const option of plan.options) {
      if (!option.found) continue;
      expect(option.geometry.type).toBe('LineString');
      expect(option.geometry.coordinates.length).toBeGreaterThan(1);
      expect(option.distanceMeters).toBeGreaterThan(0);
      expect(option.durationSeconds).toBeGreaterThan(0);
      expect(option.unknownPercent).toBeGreaterThanOrEqual(0);
      expect(option.unknownPercent).toBeLessThanOrEqual(100);
      expect(option.steps.length).toBeGreaterThan(0);
      const statusTotal = Object.values(option.statusMeters).reduce((a, b) => a + b, 0);
      expect(Math.abs(statusTotal - option.distanceMeters)).toBeLessThanOrEqual(1);
    }
  });

  it('sends a wheelchair up the ramp rather than down the steps', () => {
    const plan = planRoutes({ graph, startNode: start, goalNode: goal, profile: RouteProfile.WHEELCHAIR });
    const recommended = plan.options.find((o) => o.variant === RouteVariant.RECOMMENDED);
    const shortest = plan.options.find((o) => o.variant === RouteVariant.SHORTEST);

    expect(recommended.found).toBe(true);
    expect(shortest.found).toBe(true);
    // The shortest walk takes the steps; the recommended route refuses them
    // and is longer as a result. That difference is the product.
    expect(shortest.barriersOnRoute.map((b) => b.id)).toContain(Barrier.STEPS);
    expect(recommended.barriersOnRoute.map((b) => b.id)).not.toContain(Barrier.STEPS);
    expect(recommended.barriersAvoided).toContain(Barrier.STEPS);
    expect(recommended.distanceMeters).toBeGreaterThan(shortest.distanceMeters);
    expect(recommended.extraDistanceMeters).toBeGreaterThan(0);
  });

  it('reports the accessible route as no shorter than the shortest one', () => {
    const plan = planRoutes({ graph, startNode: start, goalNode: goal, profile: RouteProfile.WHEELCHAIR });
    const recommended = plan.options.find((o) => o.variant === RouteVariant.RECOMMENDED);
    const shortest = plan.options.find((o) => o.variant === RouteVariant.SHORTEST);
    if (recommended?.found && shortest?.found) {
      expect(recommended.distanceMeters).toBeGreaterThanOrEqual(shortest.distanceMeters);
    }
  });
});

describe('public services and priority', () => {
  it('parses POIs and finds the ones near a point', () => {
    const pois = parsePois(poiFixture, 'test-region');
    expect(pois.length).toBeGreaterThan(0);
    expect(pois.every((p) => typeof p.class === 'string')).toBe(true);

    const near = poisNear([32.4185, 34.7568], pois, 400);
    expect(near.length).toBeGreaterThan(0);
    expect(near[0].distanceMeters).toBeLessThanOrEqual(near[near.length - 1].distanceMeters);
  });

  it('indexes POIs and returns the same answer as the direct scan', () => {
    const pois = parsePois(poiFixture, 'test-region');
    const index = buildPoiIndex(pois);
    const direct = poisNear([32.4185, 34.7568], pois, 250).map((p) => p.class).sort();
    const indexed = index.near([32.4185, 34.7568], 250).map((p) => p.class).sort();
    expect(indexed).toEqual(direct);
  });

  it('ranks a barrier next to a hospital above an identical one that is not', () => {
    const pois = parsePois(poiFixture, 'test-region');
    const index = buildPoiIndex(pois);
    const common = {
      status: SegmentStatus.INACCESSIBLE, accessibilityScore: 20,
      evidenceConfidence: 80, freshnessState: 'recent',
      barriers: [Barrier.MISSING_CURB_RAMP], detourRatio: 1.8
    };
    const nearHospital = computePriority({ ...common, nearbyPois: index.near([32.4185, 34.7568]) });
    const remote = computePriority({ ...common, nearbyPois: [] });
    expect(nearHospital.score).toBeGreaterThan(remote.score);
  });
});
