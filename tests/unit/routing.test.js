import { describe, it, expect } from 'vitest';
import { edgeCost, profileSpeed, estimateDurationSeconds } from '@shared/routingCost.js';
import { astar, buildGraph, MinHeap } from '@shared/astar.js';
import { planRoutes, stitchGeometry, buildSteps, explainRoute } from '@shared/route.js';
import { RouteProfile, RouteVariant, SegmentStatus, Freshness, Barrier } from '@shared/constants.js';
import { SHORTEST_PROFILE_ID } from '@shared/config.js';

const edge = (over = {}) => ({
  id: 'e', from: 'a', to: 'b',
  lengthMeters: 100,
  status: SegmentStatus.ACCESSIBLE,
  barriers: [],
  freshnessState: Freshness.RECENT,
  ...over
});

describe('edgeCost', () => {
  it('costs the shortest profile as pure distance', () => {
    const result = edgeCost(edge({ status: SegmentStatus.INACCESSIBLE, barriers: [Barrier.STEPS] }), SHORTEST_PROFILE_ID);
    expect(result.cost).toBe(100);
    expect(result.forbidden).toBe(false);
  });

  it('costs an accessible segment at its own length for every profile', () => {
    for (const profile of Object.values(RouteProfile)) {
      expect(edgeCost(edge(), profile).cost).toBeCloseTo(100, 5);
    }
  });

  it('refuses steps outright for a wheelchair', () => {
    const result = edgeCost(edge({ barriers: [Barrier.STEPS], hardBlocks: [Barrier.STEPS] }), RouteProfile.WHEELCHAIR);
    expect(result.forbidden).toBe(true);
    expect(result.cost).toBe(Infinity);
    expect(result.blockedBy).toContain(Barrier.STEPS);
  });

  it('merely penalises steps for other profiles', () => {
    const result = edgeCost(edge({ barriers: [Barrier.STEPS] }), RouteProfile.REDUCED_MOBILITY);
    expect(result.forbidden).toBe(false);
    expect(result.cost).toBeGreaterThan(100);
  });

  it('refuses an inaccessible segment for a wheelchair even without a named barrier', () => {
    const result = edgeCost(edge({ status: SegmentStatus.INACCESSIBLE }), RouteProfile.WHEELCHAIR);
    expect(result.forbidden).toBe(true);
  });

  it('prices unassessed segments above assessed ones', () => {
    const known = edgeCost(edge(), RouteProfile.WHEELCHAIR).cost;
    const unknown = edgeCost(edge({ status: SegmentStatus.UNVERIFIED }), RouteProfile.WHEELCHAIR).cost;
    expect(unknown).toBeGreaterThan(known);
  });

  it('prices unassessed segments even higher when verified data is preferred', () => {
    const normal = edgeCost(edge({ status: SegmentStatus.UNVERIFIED }), RouteProfile.WHEELCHAIR).cost;
    const strict = edgeCost(edge({ status: SegmentStatus.UNVERIFIED }), RouteProfile.WHEELCHAIR, { preferVerifiedData: true }).cost;
    expect(strict).toBeGreaterThan(normal);
  });

  it('penalises stale evidence', () => {
    const fresh = edgeCost(edge(), RouteProfile.WHEELCHAIR).cost;
    const stale = edgeCost(edge({ freshnessState: Freshness.STALE }), RouteProfile.WHEELCHAIR).cost;
    expect(stale).toBeGreaterThan(fresh);
  });

  it('adds a named barrier penalty in equivalent metres', () => {
    const plain = edgeCost(edge({ status: SegmentStatus.PARTIAL }), RouteProfile.WHEELCHAIR).cost;
    const withBarrier = edgeCost(
      edge({ status: SegmentStatus.PARTIAL, barriers: [Barrier.MISSING_CURB_RAMP] }),
      RouteProfile.WHEELCHAIR
    ).cost;
    expect(withBarrier - plain).toBeGreaterThan(150);
  });

  it('weights the same barrier more heavily for a wheelchair than for a balanced walk', () => {
    const options = { status: SegmentStatus.PARTIAL, barriers: [Barrier.MISSING_CURB_RAMP] };
    const wheelchair = edgeCost(edge(options), RouteProfile.WHEELCHAIR).cost;
    const balanced = edgeCost(edge(options), RouteProfile.BALANCED).cost;
    expect(wheelchair).toBeGreaterThan(balanced);
  });

  it('handles a zero-length edge without producing NaN', () => {
    const result = edgeCost(edge({ lengthMeters: 0 }), RouteProfile.WHEELCHAIR);
    expect(Number.isFinite(result.cost)).toBe(true);
  });
});

describe('walking speeds', () => {
  it('assumes a wheelchair user is slower than a balanced walker', () => {
    expect(profileSpeed(RouteProfile.WHEELCHAIR)).toBeLessThan(profileSpeed(RouteProfile.BALANCED));
  });

  it('estimates duration from distance and profile', () => {
    const slow = estimateDurationSeconds(1000, RouteProfile.WHEELCHAIR);
    const fast = estimateDurationSeconds(1000, RouteProfile.BALANCED);
    expect(slow).toBeGreaterThan(fast);
  });
});

describe('MinHeap', () => {
  it('pops in ascending order of f', () => {
    const heap = new MinHeap();
    for (const f of [5, 1, 9, 3, 7, 2]) heap.push({ f });
    const order = [];
    while (heap.size) order.push(heap.pop().f);
    expect(order).toEqual([1, 2, 3, 5, 7, 9]);
  });

  it('returns undefined when empty', () => {
    expect(new MinHeap().pop()).toBeUndefined();
  });
});

/**
 *        B
 *      /   \        A-B-D : 500 m, fully accessible
 *    A       D      A-C-D : 240 m, but A-C is a flight of steps
 *      \   /
 *        C
 */
function harbourGraph() {
  const nodes = new Map([
    ['A', [32.4000, 34.7700]],
    ['B', [32.4020, 34.7715]],
    ['C', [32.4020, 34.7690]],
    ['D', [32.4040, 34.7700]]
  ]);
  const edges = [
    { id: 'AB', from: 'A', to: 'B', lengthMeters: 250, status: SegmentStatus.ACCESSIBLE, accessibilityScore: 92, evidenceConfidence: 70, barriers: [], freshnessState: Freshness.RECENT, streetName: 'Poseidonos', geometry: [[32.4000, 34.7700], [32.4020, 34.7715]] },
    { id: 'BD', from: 'B', to: 'D', lengthMeters: 250, status: SegmentStatus.ACCESSIBLE, accessibilityScore: 88, evidenceConfidence: 66, barriers: [], freshnessState: Freshness.RECENT, streetName: 'Apostolou Pavlou', geometry: [[32.4020, 34.7715], [32.4040, 34.7700]] },
    { id: 'AC', from: 'A', to: 'C', lengthMeters: 120, status: SegmentStatus.INACCESSIBLE, accessibilityScore: 18, evidenceConfidence: 70, barriers: [Barrier.STEPS], hardBlocks: [Barrier.STEPS], freshnessState: Freshness.AGING, streetName: 'Harbour Steps', geometry: [[32.4000, 34.7700], [32.4020, 34.7690]] },
    { id: 'CD', from: 'C', to: 'D', lengthMeters: 120, status: SegmentStatus.UNVERIFIED, evidenceConfidence: 20, barriers: [], freshnessState: Freshness.NONE, streetName: null, geometry: [[32.4020, 34.7690], [32.4040, 34.7700]] }
  ];
  return buildGraph(edges, nodes);
}

describe('astar', () => {
  it('walks a segment in either direction', () => {
    const graph = harbourGraph();
    const forward = astar(graph, 'A', 'B', (e) => edgeCost(e, RouteProfile.BALANCED));
    const backward = astar(graph, 'B', 'A', (e) => edgeCost(e, RouteProfile.BALANCED));
    expect(forward.found).toBe(true);
    expect(backward.found).toBe(true);
  });

  it('takes the steps shortcut when only distance matters', () => {
    const result = astar(harbourGraph(), 'A', 'D', (e) => edgeCost(e, SHORTEST_PROFILE_ID));
    expect(result.edges.map((e) => e.id)).toEqual(['AC', 'CD']);
    expect(result.distanceMeters).toBe(240);
  });

  it('routes a wheelchair the long way round rather than down the steps', () => {
    const result = astar(harbourGraph(), 'A', 'D', (e) => edgeCost(e, RouteProfile.WHEELCHAIR));
    expect(result.found).toBe(true);
    expect(result.edges.map((e) => e.id)).toEqual(['AB', 'BD']);
    expect(result.distanceMeters).toBe(500);
  });

  it('reports no path rather than inventing one when every route is refused', () => {
    const nodes = new Map([['A', [32.40, 34.77]], ['B', [32.41, 34.77]]]);
    const graph = buildGraph([{
      id: 'AB', from: 'A', to: 'B', lengthMeters: 100,
      status: SegmentStatus.INACCESSIBLE, barriers: [Barrier.STEPS], hardBlocks: [Barrier.STEPS],
      geometry: [[32.40, 34.77], [32.41, 34.77]]
    }], nodes);
    const result = astar(graph, 'A', 'B', (e) => edgeCost(e, RouteProfile.WHEELCHAIR));
    expect(result.found).toBe(false);
    expect(result.reason).toBe('no_path');
  });

  it('handles start == goal', () => {
    const result = astar(harbourGraph(), 'A', 'A', (e) => edgeCost(e, RouteProfile.BALANCED));
    expect(result.found).toBe(true);
    expect(result.distanceMeters).toBe(0);
  });

  it('reports a missing node instead of throwing', () => {
    expect(astar(harbourGraph(), 'A', 'ZZ', (e) => edgeCost(e, RouteProfile.BALANCED)).reason)
      .toBe('goal_not_in_graph');
    expect(astar(harbourGraph(), 'ZZ', 'A', (e) => edgeCost(e, RouteProfile.BALANCED)).reason)
      .toBe('start_not_in_graph');
  });

  it('respects the expansion limit', () => {
    const result = astar(harbourGraph(), 'A', 'D', (e) => edgeCost(e, RouteProfile.BALANCED), { maxExpansions: 1 });
    expect(result.found).toBe(false);
    expect(result.reason).toBe('search_limit_exceeded');
  });

  it('finds the cheapest path, not merely a path', () => {
    // A direct but heavily penalised edge vs. a longer clean detour.
    const nodes = new Map([['A', [32.40, 34.77]], ['B', [32.401, 34.77]], ['C', [32.4005, 34.771]]]);
    const graph = buildGraph([
      { id: 'AB', from: 'A', to: 'B', lengthMeters: 90, status: SegmentStatus.PARTIAL, barriers: [Barrier.MISSING_CURB_RAMP], geometry: [[32.40, 34.77], [32.401, 34.77]] },
      { id: 'AC', from: 'A', to: 'C', lengthMeters: 120, status: SegmentStatus.ACCESSIBLE, barriers: [], geometry: [[32.40, 34.77], [32.4005, 34.771]] },
      { id: 'CB', from: 'C', to: 'B', lengthMeters: 120, status: SegmentStatus.ACCESSIBLE, barriers: [], geometry: [[32.4005, 34.771], [32.401, 34.77]] }
    ], nodes);
    const result = astar(graph, 'A', 'B', (e) => edgeCost(e, RouteProfile.WHEELCHAIR));
    expect(result.edges.map((e) => e.id)).toEqual(['AC', 'CB']);
  });
});

describe('planRoutes', () => {
  const plan = () => planRoutes({
    graph: harbourGraph(), startNode: 'A', goalNode: 'D', profile: RouteProfile.WHEELCHAIR
  });

  it('always returns all three variants', () => {
    const variants = plan().options.map((o) => o.variant);
    expect(variants).toEqual([RouteVariant.RECOMMENDED, RouteVariant.BALANCED, RouteVariant.SHORTEST]);
  });

  it('makes the accessibility trade-off legible', () => {
    const { options } = plan();
    const recommended = options.find((o) => o.variant === RouteVariant.RECOMMENDED);
    const shortest = options.find((o) => o.variant === RouteVariant.SHORTEST);

    expect(recommended.distanceMeters).toBe(500);
    expect(shortest.distanceMeters).toBe(240);
    expect(recommended.extraDistanceMeters).toBe(260);
    expect(recommended.accessibilityScore).toBeGreaterThan(shortest.accessibilityScore);
    expect(recommended.unknownPercent).toBe(0);
    expect(shortest.unknownPercent).toBe(50);
  });

  it('reports which barriers the accessible route avoids', () => {
    const recommended = plan().options.find((o) => o.variant === RouteVariant.RECOMMENDED);
    expect(recommended.barriersAvoided).toContain(Barrier.STEPS);
    expect(recommended.barriersOnRoute).toHaveLength(0);
  });

  it('breaks the route down by classification, summing to its length', () => {
    const shortest = plan().options.find((o) => o.variant === RouteVariant.SHORTEST);
    const total = Object.values(shortest.statusMeters).reduce((a, b) => a + b, 0);
    expect(total).toBe(shortest.distanceMeters);
  });

  it('marks a duplicate option rather than presenting it as a choice', () => {
    const { options } = plan();
    const balanced = options.find((o) => o.variant === RouteVariant.BALANCED);
    expect(balanced.sameAsRecommended).toBe(true);
  });

  it('produces translatable reasons, never prose', () => {
    for (const option of plan().options) {
      for (const reason of option.reasons || []) {
        expect(reason.key).toMatch(/^route\.reason\./);
      }
    }
  });

  it('flags a route dominated by unassessed segments', () => {
    const shortest = plan().options.find((o) => o.variant === RouteVariant.SHORTEST);
    expect(shortest.highUnknown).toBe(true);
    expect(shortest.reasons.some((r) => r.key === 'route.reason.high_unknown')).toBe(true);
  });
});

describe('stitchGeometry', () => {
  it('joins edges without repeating the shared vertex', () => {
    const coords = stitchGeometry([
      { geometry: [[0, 0], [1, 1]] },
      { geometry: [[1, 1], [2, 2]] }
    ]);
    expect(coords).toEqual([[0, 0], [1, 1], [2, 2]]);
  });

  it('skips edges with no usable geometry', () => {
    expect(stitchGeometry([{ geometry: null }, { geometry: [[0, 0], [1, 1]] }])).toHaveLength(2);
  });
});

describe('buildSteps', () => {
  it('opens with a departure and closes with an arrival', () => {
    const steps = buildSteps([
      { id: 'AB', lengthMeters: 250, streetName: 'Poseidonos', status: SegmentStatus.ACCESSIBLE, barriers: [], geometry: [[32.4000, 34.7700], [32.4020, 34.7715]] },
      { id: 'BD', lengthMeters: 250, streetName: 'Apostolou Pavlou', status: SegmentStatus.ACCESSIBLE, barriers: [], geometry: [[32.4020, 34.7715], [32.4040, 34.7700]] }
    ]);
    expect(steps[0].manoeuvre).toBe('depart');
    expect(steps[steps.length - 1].manoeuvre).toBe('arrive');
  });

  it('merges consecutive edges on the same street', () => {
    const steps = buildSteps([
      { id: 'a', lengthMeters: 100, streetName: 'Same Street', barriers: [], geometry: [[32.400, 34.770], [32.401, 34.770]] },
      { id: 'b', lengthMeters: 100, streetName: 'Same Street', barriers: [], geometry: [[32.401, 34.770], [32.402, 34.770]] }
    ]);
    const travelling = steps.filter((s) => s.manoeuvre !== 'arrive');
    expect(travelling).toHaveLength(1);
    expect(travelling[0].distanceMeters).toBe(200);
  });

  it('carries the barriers ahead into the step, so navigation can warn', () => {
    const steps = buildSteps([
      { id: 'a', lengthMeters: 100, streetName: 'X', barriers: [Barrier.MISSING_CURB_RAMP], geometry: [[32.400, 34.770], [32.401, 34.770]] }
    ]);
    expect(steps[0].barriers).toContain(Barrier.MISSING_CURB_RAMP);
  });

  it('returns nothing for an empty route', () => {
    expect(buildSteps([])).toEqual([]);
  });
});
