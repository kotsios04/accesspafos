import { describe, it, expect } from 'vitest';
import { aggregateObservations, voteFeature, CONSERVATIVE_ORDER } from '@shared/aggregate.js';
import { normalizeObservation } from '@shared/observationSchema.js';
import { Barrier, PositiveFeature } from '@shared/constants.js';

const record = (over, sourceId = 'img') => ({
  observation: normalizeObservation(over),
  sourceType: 'mapillary',
  sourceId
});

const CLEAN = {
  imageQuality: 'good',
  pedestrianPath: { visible: 'yes', condition: 'clear' },
  curbRamp: { visible: 'yes', condition: 'usable' },
  stairs: { visible: 'no' },
  surface: { type: 'paved', condition: 'good' },
  obstacle: { visible: 'no', severity: 'none' },
  crossing: { visible: 'no', accessibleFeatures: [] },
  clearPassage: { classification: 'clear' }
};

describe('voteFeature', () => {
  it('ignores non-informative answers', () => {
    const observations = [
      normalizeObservation({ surface: { type: 'unknown' } }),
      normalizeObservation({ surface: { type: 'paved' } })
    ];
    const vote = voteFeature(observations, 'surface.type');
    expect(vote.value).toBe('paved');
    expect(vote.informative).toBe(1);
    expect(vote.agreement).toBe(1);
  });

  it('returns nothing when every answer is non-informative', () => {
    const vote = voteFeature([normalizeObservation({}), normalizeObservation({})], 'surface.type');
    expect(vote.value).toBeNull();
    expect(vote.informative).toBe(0);
  });

  it('breaks a tie toward the more conservative reading', () => {
    const observations = [
      normalizeObservation({ surface: { type: 'paved', condition: 'good' } }),
      normalizeObservation({ surface: { type: 'paved', condition: 'damaged' } })
    ];
    const vote = voteFeature(observations, 'surface.condition');
    expect(vote.tie).toBe(true);
    expect(vote.value).toBe('damaged');
  });

  it('declares a conservative ordering for every agreement key it can tie on', () => {
    for (const [path, order] of Object.entries(CONSERVATIVE_ORDER)) {
      expect(order.length, path).toBeGreaterThan(1);
    }
  });
});

describe('aggregateObservations', () => {
  it('reports full agreement for a single observation', () => {
    const result = aggregateObservations([record(CLEAN)]);
    expect(result.agreement).toBe(1);
    expect(result.conflict).toBe(0);
    expect(result.informativeCount).toBe(1);
  });

  it('derives positives from a clean observation', () => {
    const result = aggregateObservations([record(CLEAN)]);
    const ids = result.positives.map((p) => p.id);
    expect(ids).toContain(PositiveFeature.CLEAR_PATH);
    expect(ids).toContain(PositiveFeature.CURB_RAMP);
    expect(ids).toContain(PositiveFeature.GOOD_PAVED_SURFACE);
    expect(result.barriers).toHaveLength(0);
  });

  it('reads an absent ramp as a barrier, but an unseen one as nothing', () => {
    const absent = aggregateObservations([record({ ...CLEAN, curbRamp: { visible: 'no', condition: 'unknown' } })]);
    expect(absent.barriers.map((b) => b.id)).toContain(Barrier.MISSING_CURB_RAMP);

    const unseen = aggregateObservations([record({ ...CLEAN, curbRamp: { visible: 'not_visible', condition: 'unknown' } })]);
    expect(unseen.barriers.map((b) => b.id)).not.toContain(Barrier.MISSING_CURB_RAMP);
    expect(unseen.positives.map((p) => p.id)).not.toContain(PositiveFeature.CURB_RAMP);
  });

  it('halves the weight of a finding the images split on', () => {
    const result = aggregateObservations([
      record({ ...CLEAN, surface: { type: 'paved', condition: 'good' } }, 'a'),
      record({ ...CLEAN, surface: { type: 'paved', condition: 'damaged' } }, 'b')
    ]);
    const damaged = result.barriers.find((b) => b.id === Barrier.DAMAGED_SURFACE);
    expect(damaged).toBeDefined();
    expect(damaged.weightScale).toBeCloseTo(0.5, 5);
    expect(result.conflict).toBeGreaterThan(0);
    expect(result.contestedKeys).toContain('surface.condition');
  });

  it('gives a unanimous finding full weight', () => {
    const result = aggregateObservations([
      record({ ...CLEAN, stairs: { visible: 'yes' } }, 'a'),
      record({ ...CLEAN, stairs: { visible: 'yes' } }, 'b'),
      record({ ...CLEAN, stairs: { visible: 'yes' } }, 'c')
    ]);
    const steps = result.barriers.find((b) => b.id === Barrier.STEPS);
    expect(steps.weightScale).toBe(1);
  });

  it('does not double-count an obstacle reported through two fields', () => {
    const result = aggregateObservations([record({
      ...CLEAN,
      obstacle: { visible: 'yes', severity: 'blocking', description: 'skip' },
      clearPassage: { classification: 'blocked' }
    })]);
    const blocking = result.barriers.filter((b) => b.id === Barrier.BLOCKING_OBSTACLE);
    expect(blocking).toHaveLength(1);
  });

  it('surfaces the obstacle description for the UI', () => {
    const result = aggregateObservations([record({
      ...CLEAN, obstacle: { visible: 'yes', severity: 'blocking', description: 'parked scooters' }
    })]);
    const blocking = result.barriers.find((b) => b.id === Barrier.BLOCKING_OBSTACLE);
    expect(blocking.detail).toContain('scooters');
  });

  it('collects crossing features across observations', () => {
    const result = aggregateObservations([
      record({ ...CLEAN, crossing: { visible: 'yes', accessibleFeatures: ['tactile_paving'] } }, 'a'),
      record({ ...CLEAN, crossing: { visible: 'yes', accessibleFeatures: ['dropped_kerb'] } }, 'b')
    ]);
    const ids = result.positives.map((p) => p.id);
    expect(ids).toContain(PositiveFeature.TACTILE_PAVING);
    expect(ids).toContain(PositiveFeature.CURB_RAMP);
  });

  it('handles an empty or malformed input list', () => {
    for (const input of [[], null, undefined, [null, {}]]) {
      const result = aggregateObservations(input);
      expect(result.barriers).toEqual([]);
      expect(result.positives).toEqual([]);
    }
  });

  it('gathers uncertain findings without repeating them', () => {
    const result = aggregateObservations([
      record({ ...CLEAN, uncertainFindings: ['possible kerb behind the van'] }, 'a'),
      record({ ...CLEAN, uncertainFindings: ['possible kerb behind the van'] }, 'b')
    ]);
    expect(result.uncertainFindings).toHaveLength(1);
  });
});
