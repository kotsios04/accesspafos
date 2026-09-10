import { describe, it, expect } from 'vitest';
import { classifySegment, ClassificationReason } from '@shared/classify.js';
import { SegmentStatus } from '@shared/constants.js';
import { ACCESSIBLE_THRESHOLD, PARTIAL_THRESHOLD, MIN_CONFIDENCE_TO_CLASSIFY } from '@shared/config.js';

const confident = MIN_CONFIDENCE_TO_CLASSIFY + 20;

describe('classifySegment', () => {
  it('places a high score with good confidence in the accessible band', () => {
    const result = classifySegment({ score: ACCESSIBLE_THRESHOLD, confidence: confident });
    expect(result.status).toBe(SegmentStatus.ACCESSIBLE);
    expect(result.reason).toBe(ClassificationReason.SCORE_BAND);
  });

  it('places a middling score in the partial band', () => {
    expect(classifySegment({ score: PARTIAL_THRESHOLD, confidence: confident }).status)
      .toBe(SegmentStatus.PARTIAL);
  });

  it('places a low score in the inaccessible band', () => {
    expect(classifySegment({ score: PARTIAL_THRESHOLD - 1, confidence: confident }).status)
      .toBe(SegmentStatus.INACCESSIBLE);
  });

  // The central promise of the product.
  it('refuses to classify at all below the confidence threshold, whatever the score', () => {
    for (const score of [0, 40, 79, 95, 100]) {
      const result = classifySegment({ score, confidence: MIN_CONFIDENCE_TO_CLASSIFY - 1 });
      expect(result.status).toBe(SegmentStatus.UNVERIFIED);
      expect(result.reason).toBe(ClassificationReason.INSUFFICIENT_EVIDENCE);
    }
  });

  it('checks confidence before the score, not after', () => {
    const perfectButUnsupported = classifySegment({ score: 100, confidence: 5 });
    expect(perfectButUnsupported.status).toBe(SegmentStatus.UNVERIFIED);
  });

  it('reports "no evidence" distinctly from "not enough evidence"', () => {
    const result = classifySegment({ score: null, confidence: 0, hasAnyEvidence: false });
    expect(result.status).toBe(SegmentStatus.UNVERIFIED);
    expect(result.reason).toBe(ClassificationReason.NO_EVIDENCE);
  });

  it('lets a municipal override outrank the pipeline', () => {
    const result = classifySegment({
      score: 100, confidence: 100,
      manualOverride: { status: SegmentStatus.INACCESSIBLE }
    });
    expect(result.status).toBe(SegmentStatus.INACCESSIBLE);
    expect(result.reason).toBe(ClassificationReason.MANUAL_OVERRIDE);
  });

  it('ignores an override with a status it does not recognise', () => {
    const result = classifySegment({
      score: 90, confidence: confident,
      manualOverride: { status: 'excellent' }
    });
    expect(result.status).toBe(SegmentStatus.ACCESSIBLE);
  });

  it('honours runtime threshold overrides', () => {
    const strict = classifySegment({ score: 85, confidence: confident }, { ACCESSIBLE_THRESHOLD: 90 });
    expect(strict.status).toBe(SegmentStatus.PARTIAL);
    expect(strict.thresholds.accessibleAt).toBe(90);
  });
});
