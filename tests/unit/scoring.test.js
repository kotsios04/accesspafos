import { describe, it, expect } from 'vitest';
import {
  computeAccessibilityScore, dedupeEvidence, resolveContradictions,
  explainScore, clampScore, CONTRADICTIONS
} from '@shared/scoring.js';
import { SCORING_PENALTIES, SCORING_POSITIVES, MAX_POSITIVE_BONUS, BARRIER_SCORE_CEILINGS } from '@shared/config.js';
import { Barrier, PositiveFeature, SourceType } from '@shared/constants.js';

const barrier = (id, weightScale = 1, source = SourceType.OSM) => ({ id, source, weightScale });
const positive = (id, weightScale = 1, source = SourceType.OSM) => ({ id, source, weightScale });

describe('computeAccessibilityScore', () => {
  it('scores a segment with no findings at the base value', () => {
    const result = computeAccessibilityScore({ barriers: [], positives: [] });
    expect(result.score).toBe(100);
    expect(result.penalties).toHaveLength(0);
  });

  it('subtracts the configured penalty for a barrier that carries no ceiling', () => {
    // uneven_surface is a nuisance, not a severe barrier, so it has no ceiling
    // and the score is exactly the base minus its penalty.
    const result = computeAccessibilityScore({ barriers: [barrier(Barrier.UNEVEN_SURFACE)] });
    expect(result.score).toBe(100 - SCORING_PENALTIES.uneven_surface);
    expect(result.ceiling).toBeNull();
  });

  it('applies both the penalty and the ceiling for a severe barrier', () => {
    const result = computeAccessibilityScore({ barriers: [barrier(Barrier.DAMAGED_SURFACE)] });
    // 100 - 20 = 80 by arithmetic, but damaged_surface caps the segment at 70.
    expect(result.rawScore).toBe(100 - SCORING_PENALTIES.damaged_surface);
    expect(result.score).toBe(BARRIER_SCORE_CEILINGS.damaged_surface);
  });

  it('scales a penalty by the weight of the evidence supporting it', () => {
    const full = computeAccessibilityScore({ barriers: [barrier(Barrier.DAMAGED_SURFACE, 1)] });
    const half = computeAccessibilityScore({ barriers: [barrier(Barrier.DAMAGED_SURFACE, 0.5)] });
    expect(half.score).toBeGreaterThan(full.score);
    expect(half.penalties[0].points).toBeCloseTo(SCORING_PENALTIES.damaged_surface / 2, 1);
  });

  it('never counts the same barrier twice when two sources report it', () => {
    const once = computeAccessibilityScore({ barriers: [barrier(Barrier.STEPS)] });
    const twice = computeAccessibilityScore({
      barriers: [barrier(Barrier.STEPS, 1, SourceType.OSM), barrier(Barrier.STEPS, 1, SourceType.MAPILLARY)]
    });
    expect(twice.penalties).toHaveLength(1);
    expect(twice.score).toBe(once.score);
  });

  it('caps the total positive bonus', () => {
    const result = computeAccessibilityScore({
      barriers: [barrier(Barrier.DAMAGED_SURFACE)],
      positives: [
        positive(PositiveFeature.CURB_RAMP),
        positive(PositiveFeature.TACTILE_PAVING),
        positive(PositiveFeature.ADEQUATE_WIDTH),
        positive(PositiveFeature.ACCESSIBLE_CROSSING),
        positive(PositiveFeature.RAMP_PRESENT),
        positive(PositiveFeature.MANUALLY_VERIFIED)
      ]
    });
    expect(result.cappedBonus).toBeLessThanOrEqual(MAX_POSITIVE_BONUS);
    expect(result.totalBonus).toBeGreaterThan(MAX_POSITIVE_BONUS);
  });

  it('ignores barriers it has no configured weight for rather than guessing one', () => {
    const result = computeAccessibilityScore({ barriers: [barrier('a_barrier_we_invented')] });
    expect(result.score).toBe(100);
    expect(result.penalties).toHaveLength(0);
  });

  it('clamps into 0..100', () => {
    const result = computeAccessibilityScore({
      barriers: [
        barrier(Barrier.STEPS), barrier(Barrier.NO_PEDESTRIAN_PATH),
        barrier(Barrier.BLOCKING_OBSTACLE), barrier(Barrier.HIGH_KERB),
        barrier(Barrier.STEEP_INCLINE), barrier(Barrier.DAMAGED_SURFACE)
      ]
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe('severe-barrier ceilings', () => {
  it('stops a nice surface from making a segment with no dropped kerb "accessible"', () => {
    const result = computeAccessibilityScore({
      barriers: [barrier(Barrier.MISSING_CURB_RAMP)],
      positives: [positive(PositiveFeature.CLEAR_PATH), positive(PositiveFeature.GOOD_PAVED_SURFACE)]
    });
    expect(result.rawScore).toBeGreaterThan(result.score);
    expect(result.score).toBeLessThanOrEqual(BARRIER_SCORE_CEILINGS.missing_curb_ramp);
    expect(result.ceilingBarrier).toBe(Barrier.MISSING_CURB_RAMP);
  });

  it('puts steps firmly in the inaccessible band whatever else is true', () => {
    const result = computeAccessibilityScore({
      barriers: [barrier(Barrier.STEPS)],
      positives: [
        positive(PositiveFeature.GOOD_PAVED_SURFACE),
        positive(PositiveFeature.ADEQUATE_WIDTH),
        positive(PositiveFeature.CLEAR_PATH)
      ]
    });
    expect(result.score).toBeLessThan(50);
  });

  it('relaxes the ceiling proportionally when the barrier is only half-supported', () => {
    const strong = computeAccessibilityScore({ barriers: [barrier(Barrier.MISSING_CURB_RAMP, 1)] });
    const weak = computeAccessibilityScore({ barriers: [barrier(Barrier.MISSING_CURB_RAMP, 0.5)] });
    expect(weak.score).toBeGreaterThan(strong.score);
  });
});

describe('dedupeEvidence', () => {
  it('merges duplicates and records every contributing source', () => {
    const merged = dedupeEvidence([
      { id: Barrier.STEPS, source: SourceType.OSM, detail: 'highway=steps', weightScale: 1 },
      { id: Barrier.STEPS, source: SourceType.MAPILLARY, detail: 'steps observed', weightScale: 0.8 }
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].sources).toEqual([SourceType.OSM, SourceType.MAPILLARY]);
    expect(merged[0].details).toHaveLength(2);
  });

  it('does not let corroboration push weight above 1', () => {
    const merged = dedupeEvidence([
      { id: Barrier.STEPS, source: 'a', weightScale: 1 },
      { id: Barrier.STEPS, source: 'b', weightScale: 1 },
      { id: Barrier.STEPS, source: 'c', weightScale: 1 }
    ]);
    expect(merged[0].weightScale).toBeLessThanOrEqual(1);
  });

  it('skips malformed entries', () => {
    expect(dedupeEvidence([null, undefined, {}, { id: 42 }])).toHaveLength(0);
  });
});

describe('resolveContradictions', () => {
  it('keeps the side with stronger evidence', () => {
    const result = resolveContradictions(
      [{ id: Barrier.MISSING_CURB_RAMP, weightScale: 0.4, sources: [], details: [] }],
      [{ id: PositiveFeature.CURB_RAMP, weightScale: 1, sources: [], details: [] }]
    );
    expect(result.barriers).toHaveLength(0);
    expect(result.positives).toHaveLength(1);
    expect(result.resolvedConflicts[0]).toEqual({ kept: PositiveFeature.CURB_RAMP, dropped: Barrier.MISSING_CURB_RAMP });
  });

  it('prefers the barrier on a tie, which is the conservative reading', () => {
    const result = resolveContradictions(
      [{ id: Barrier.HIGH_KERB, weightScale: 1, sources: [], details: [] }],
      [{ id: PositiveFeature.FLUSH_KERB, weightScale: 1, sources: [], details: [] }]
    );
    expect(result.barriers).toHaveLength(1);
    expect(result.positives).toHaveLength(0);
  });

  it('declares every contradiction pair with known ids', () => {
    for (const [barrierId, positiveId] of CONTRADICTIONS) {
      expect(typeof barrierId).toBe('string');
      expect(typeof positiveId).toBe('string');
    }
  });
});

describe('explainScore', () => {
  it('produces translatable keys and a signed points breakdown', () => {
    const breakdown = computeAccessibilityScore({
      barriers: [barrier(Barrier.STEPS)],
      positives: [positive(PositiveFeature.CLEAR_PATH)]
    });
    const explanation = explainScore(breakdown);
    expect(explanation.base).toBe(100);
    expect(explanation.subtractions[0].key).toBe(`barrier.${Barrier.STEPS}`);
    expect(explanation.subtractions[0].points).toBeLessThan(0);
    expect(explanation.additions[0].points).toBeGreaterThan(0);
    expect(explanation.total).toBe(breakdown.score);
  });

  it('reports the ceiling when one was applied', () => {
    const breakdown = computeAccessibilityScore({
      barriers: [barrier(Barrier.MISSING_CURB_RAMP)],
      positives: [positive(PositiveFeature.GOOD_PAVED_SURFACE), positive(PositiveFeature.CLEAR_PATH)]
    });
    expect(explainScore(breakdown).ceiling).not.toBeNull();
  });
});

describe('clampScore', () => {
  it('clamps into range', () => {
    expect(clampScore(-10)).toBe(0);
    expect(clampScore(140)).toBe(100);
    expect(clampScore(72.4)).toBe(72);
  });

  it('treats a non-finite score as no evidence of accessibility, not as a perfect one', () => {
    // NaN or Infinity here means a caller computed something nonsensical.
    // Resolving that to 100 would silently paint a street green; resolving it
    // to 0 keeps the failure visible and safe.
    expect(clampScore(NaN)).toBe(0);
    expect(clampScore(Infinity)).toBe(0);
    expect(clampScore(undefined)).toBe(0);
  });
});
