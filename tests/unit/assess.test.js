import { describe, it, expect } from 'vitest';
import { assessSegment, reportCategoryToBarrier } from '@shared/assess.js';
import { normalizeObservation } from '@shared/observationSchema.js';
import { SegmentStatus, SourceType, Freshness, Barrier } from '@shared/constants.js';
import { MIN_CONFIDENCE_TO_CLASSIFY } from '@shared/config.js';
import { ClassificationReason } from '@shared/classify.js';

const NOW = Date.parse('2026-09-08T00:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

const observation = (over, capturedAt = daysAgo(120)) => ({
  observation: normalizeObservation(over),
  sourceType: SourceType.MAPILLARY,
  sourceId: `img-${Math.random()}`,
  capturedAt
});

const GOOD = {
  imageQuality: 'good',
  pedestrianPath: { visible: 'yes', condition: 'clear' },
  curbRamp: { visible: 'yes', condition: 'usable' },
  stairs: { visible: 'no' },
  surface: { type: 'paved', condition: 'good' },
  obstacle: { visible: 'no', severity: 'none' },
  crossing: { visible: 'no', accessibleFeatures: [] },
  clearPassage: { classification: 'clear' }
};

describe('assessSegment', () => {
  it('leaves an untagged, unphotographed footway grey with no score', () => {
    const result = assessSegment({ osmTags: { highway: 'footway' }, now: NOW });
    expect(result.status).toBe(SegmentStatus.UNVERIFIED);
    expect(result.accessibilityScore).toBeNull();
    expect(result.classificationReason).toBe(ClassificationReason.NO_EVIDENCE);
    expect(result.evidenceConfidence).toBe(0);
  });

  it('classifies a well-tagged, well-photographed pavement as accessible', () => {
    const result = assessSegment({
      osmTags: {
        highway: 'footway', footway: 'sidewalk', surface: 'asphalt',
        smoothness: 'good', width: '2.2', kerb: 'lowered', tactile_paving: 'yes'
      },
      osmTimestamp: daysAgo(120),
      observations: [observation(GOOD), observation(GOOD)],
      now: NOW
    });
    expect(result.status).toBe(SegmentStatus.ACCESSIBLE);
    expect(result.accessibilityScore).toBeGreaterThanOrEqual(80);
    expect(result.evidenceConfidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE_TO_CLASSIFY);
    expect(result.sources).toContain(SourceType.OSM);
    expect(result.sources).toContain(SourceType.MAPILLARY);
  });

  it('calls OSM-tagged steps inaccessible on the strength of the tag alone', () => {
    const result = assessSegment({
      osmTags: { highway: 'steps' }, osmTimestamp: daysAgo(300), now: NOW
    });
    expect(result.status).toBe(SegmentStatus.INACCESSIBLE);
    expect(result.hardBlocks).toContain(Barrier.STEPS);
    expect(result.evidenceConfidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE_TO_CLASSIFY);
  });

  it('keeps a single mediocre photograph below the classification threshold', () => {
    const result = assessSegment({
      osmTags: { highway: 'footway' },
      observations: [observation({ ...GOOD, imageQuality: 'poor' }, daysAgo(1500))],
      now: NOW
    });
    expect(result.status).toBe(SegmentStatus.UNVERIFIED);
    expect(result.classificationReason).toBe(ClassificationReason.INSUFFICIENT_EVIDENCE);
  });

  it('dates its evidence from the OSM element when there is no imagery', () => {
    const result = assessSegment({
      osmTags: { highway: 'steps' }, osmTimestamp: daysAgo(30), now: NOW
    });
    expect(result.freshnessState).toBe(Freshness.RECENT);
    expect(result.evidenceAgeDays).toBe(30);
  });

  it('reports stale evidence as stale', () => {
    const result = assessSegment({
      osmTags: { highway: 'footway', surface: 'asphalt' },
      observations: [observation(GOOD, daysAgo(2000)), observation(GOOD, daysAgo(2100))],
      now: NOW
    });
    expect(result.freshnessState).toBe(Freshness.STALE);
  });

  it('ignores an unverified citizen report entirely', () => {
    const without = assessSegment({ osmTags: { highway: 'footway', surface: 'asphalt' }, osmTimestamp: daysAgo(60), now: NOW });
    const withPending = assessSegment({
      osmTags: { highway: 'footway', surface: 'asphalt' }, osmTimestamp: daysAgo(60),
      citizenReports: [{ category: 'steps', status: 'pending' }],
      now: NOW
    });
    expect(withPending.accessibilityScore).toBe(without.accessibilityScore);
    expect(withPending.barriers).toEqual(without.barriers);
  });

  it('counts a report once a reviewer has confirmed it', () => {
    const result = assessSegment({
      osmTags: { highway: 'footway', surface: 'asphalt', smoothness: 'good' },
      osmTimestamp: daysAgo(60),
      citizenReports: [{ category: 'blocked_sidewalk', status: 'verified', verifiedAt: daysAgo(5) }],
      now: NOW
    });
    expect(result.barriers).toContain(Barrier.BLOCKING_OBSTACLE);
    expect(result.sources).toContain(SourceType.CITIZEN);
  });

  it('lets a reviewer pin a status, and says that is why', () => {
    const result = assessSegment({
      osmTags: { highway: 'footway', surface: 'asphalt', smoothness: 'excellent', kerb: 'lowered' },
      osmTimestamp: daysAgo(30),
      manualVerification: { status: SegmentStatus.INACCESSIBLE, override: true, at: NOW, by: 'reviewer-1' },
      now: NOW
    });
    expect(result.status).toBe(SegmentStatus.INACCESSIBLE);
    expect(result.classificationReason).toBe(ClassificationReason.MANUAL_OVERRIDE);
  });

  it('lets a plain confirmation raise confidence without pinning the status', () => {
    const result = assessSegment({
      osmTags: { highway: 'footway', surface: 'asphalt', smoothness: 'good', kerb: 'lowered', width: '2.0' },
      osmTimestamp: daysAgo(30),
      manualVerification: { status: SegmentStatus.ACCESSIBLE, override: false, at: NOW, result: 'confirmed' },
      now: NOW
    });
    expect(result.classificationReason).toBe(ClassificationReason.SCORE_BAND);
    expect(result.evidenceConfidence).toBeGreaterThan(80);
    expect(result.sources).toContain(SourceType.MANUAL);
  });

  it('is deterministic for identical evidence', () => {
    const input = {
      osmTags: { highway: 'footway', surface: 'paving_stones' },
      osmTimestamp: daysAgo(200),
      observations: [observation(GOOD), observation(GOOD)],
      now: NOW
    };
    const a = assessSegment(input);
    const b = assessSegment(input);
    expect(a.accessibilityScore).toBe(b.accessibilityScore);
    expect(a.evidenceConfidence).toBe(b.evidenceConfidence);
    expect(a.status).toBe(b.status);
  });

  it('always carries a full explanation when it made a claim', () => {
    const result = assessSegment({
      osmTags: { highway: 'steps' }, osmTimestamp: daysAgo(100), now: NOW
    });
    expect(result.explanation.score.subtractions.length).toBeGreaterThan(0);
    expect(result.explanation.confidence.length).toBeGreaterThan(0);
    expect(result.explanation.gate.min).toBe(MIN_CONFIDENCE_TO_CLASSIFY);
    expect(result.explanation.thresholds.accessibleAt).toBeGreaterThan(0);
  });

  it('records the versions that produced it', () => {
    const result = assessSegment({ osmTags: { highway: 'steps' }, now: NOW });
    expect(result.assessmentVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.analysisVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('reportCategoryToBarrier', () => {
  it('maps every category to a known barrier or explicitly to none', () => {
    expect(reportCategoryToBarrier('steps')).toBe(Barrier.STEPS);
    expect(reportCategoryToBarrier('missing_curb_ramp')).toBe(Barrier.MISSING_CURB_RAMP);
    expect(reportCategoryToBarrier('other')).toBeNull();
    expect(reportCategoryToBarrier('nonsense')).toBeNull();
  });
});
