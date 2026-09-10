import { describe, it, expect } from 'vitest';
import { computePriority, priorityBand } from '@shared/priority.js';
import { PRIORITY_WEIGHTS, PRIORITY_MANUAL_BOOST_MAX } from '@shared/config.js';
import { SegmentStatus, Freshness, Barrier } from '@shared/constants.js';
import { SegmentKind } from '@shared/osm.js';

const severe = {
  status: SegmentStatus.INACCESSIBLE,
  accessibilityScore: 18,
  evidenceConfidence: 80,
  freshnessState: Freshness.RECENT,
  barriers: [Barrier.MISSING_CURB_RAMP],
  segmentKind: SegmentKind.CROSSING
};

describe('computePriority', () => {
  it('stays within 0..100 and itemises every factor', () => {
    const result = computePriority(severe);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    for (const factor of result.breakdown) {
      expect(factor.points).toBeGreaterThanOrEqual(0);
      expect(factor.points).toBeLessThanOrEqual(factor.max);
    }
  });

  it('gives an unverified segment no severity - we do not know anything is wrong', () => {
    const result = computePriority({
      status: SegmentStatus.UNVERIFIED, accessibilityScore: null,
      evidenceConfidence: 10, freshnessState: Freshness.NONE
    });
    const severity = result.breakdown.find((f) => f.key === 'priority.severity');
    expect(severity.points).toBe(0);
  });

  it('ranks a worse barrier higher', () => {
    const bad = computePriority({ ...severe, accessibilityScore: 10 }).score;
    const mild = computePriority({ ...severe, accessibilityScore: 70 }).score;
    expect(bad).toBeGreaterThan(mild);
  });

  it('treats "no accessible way round" as the worst case for alternatives', () => {
    const none = computePriority({ ...severe, detourRatio: null });
    const factor = none.breakdown.find((f) => f.key === 'priority.no_accessible_alternative');
    expect(factor.points).toBe(PRIORITY_WEIGHTS.noAccessibleAlternative);
  });

  it('gives no alternative penalty when a detour is essentially free', () => {
    const easy = computePriority({ ...severe, detourRatio: 1.0 });
    const factor = easy.breakdown.find((f) => f.key === 'priority.no_accessible_alternative');
    expect(factor.points).toBe(0);
  });

  it('scales the alternative penalty with the length of the detour', () => {
    const small = computePriority({ ...severe, detourRatio: 1.3 }).score;
    const large = computePriority({ ...severe, detourRatio: 2.5 }).score;
    expect(large).toBeGreaterThan(small);
  });

  it('raises priority for a barrier outside a hospital', () => {
    const quiet = computePriority({ ...severe, nearbyPois: [] }).score;
    const busy = computePriority({
      ...severe,
      nearbyPois: [{ class: 'hospital', distanceMeters: 60 }, { class: 'bus_stop', distanceMeters: 30 }]
    }).score;
    expect(busy).toBeGreaterThan(quiet);
  });

  it('ignores points of interest beyond the radius', () => {
    const near = computePriority({ ...severe, nearbyPois: [{ class: 'hospital', distanceMeters: 50 }] }).score;
    const far = computePriority({ ...severe, nearbyPois: [{ class: 'hospital', distanceMeters: 5000 }] }).score;
    expect(near).toBeGreaterThan(far);
  });

  it('ignores POI classes it has no weight for rather than inventing one', () => {
    const withUnknown = computePriority({ ...severe, nearbyPois: [{ class: 'nightclub', distanceMeters: 10 }] });
    const withNone = computePriority({ ...severe, nearbyPois: [] });
    expect(withUnknown.score).toBe(withNone.score);
  });

  it('rewards confirmed resident reports, with a ceiling', () => {
    const one = computePriority({ ...severe, verifiedReportCount: 1 }).score;
    const three = computePriority({ ...severe, verifiedReportCount: 3 }).score;
    const thirty = computePriority({ ...severe, verifiedReportCount: 30 }).score;
    expect(three).toBeGreaterThan(one);
    expect(thirty).toBe(three);
  });

  it('lowers priority for findings we are not confident about', () => {
    const sure = computePriority({ ...severe, evidenceConfidence: 95 }).score;
    const unsure = computePriority({ ...severe, evidenceConfidence: 50 }).score;
    expect(sure).toBeGreaterThan(unsure);
  });

  it('lowers priority for stale findings', () => {
    const fresh = computePriority({ ...severe, freshnessState: Freshness.RECENT }).score;
    const stale = computePriority({ ...severe, freshnessState: Freshness.STALE }).score;
    expect(fresh).toBeGreaterThan(stale);
  });

  it('applies a municipal boost, capped and separately itemised', () => {
    const plain = computePriority({ ...severe });
    const boosted = computePriority({ ...severe, manualBoost: 1 });
    expect(boosted.score).toBeGreaterThanOrEqual(plain.score);
    expect(boosted.manualBoost).toBeLessThanOrEqual(PRIORITY_MANUAL_BOOST_MAX);
    expect(boosted.breakdown.some((f) => f.key === 'priority.municipal_boost')).toBe(true);
  });

  it('has no pedestrian-footfall factor, because we do not have that data', () => {
    const keys = computePriority(severe).breakdown.map((f) => f.key).join(' ');
    expect(keys).not.toMatch(/footfall|traffic|pedestrian_count/);
  });

  it('is deterministic', () => {
    expect(computePriority(severe).score).toBe(computePriority(severe).score);
  });
});

describe('priorityBand', () => {
  it('bands scores consistently', () => {
    expect(priorityBand(90)).toBe('critical');
    expect(priorityBand(60)).toBe('high');
    expect(priorityBand(40)).toBe('medium');
    expect(priorityBand(10)).toBe('low');
  });
});
