import { describe, it, expect } from 'vitest';
import { computeEvidenceConfidence } from '@shared/confidence.js';
import { CONFIDENCE, MIN_CONFIDENCE_TO_CLASSIFY } from '@shared/config.js';
import { Freshness } from '@shared/constants.js';

describe('computeEvidenceConfidence', () => {
  it('is zero with no evidence at all', () => {
    expect(computeEvidenceConfidence({}).confidence).toBe(0);
  });

  it('does not let a single mediocre image reach the classification threshold', () => {
    const result = computeEvidenceConfidence({
      osmInformativeness: 0.1,
      imageQualities: ['medium'],
      informativeCount: 1,
      freshnessState: Freshness.AGING
    });
    expect(result.confidence).toBeLessThan(MIN_CONFIDENCE_TO_CLASSIFY);
    expect(result.gate.classifiable).toBe(false);
  });

  it('rises with richer OSM metadata', () => {
    const thin = computeEvidenceConfidence({ osmInformativeness: 0.2, freshnessState: Freshness.RECENT });
    const rich = computeEvidenceConfidence({ osmInformativeness: 0.9, freshnessState: Freshness.RECENT });
    expect(rich.confidence).toBeGreaterThan(thin.confidence);
  });

  it('counts at most the configured number of images', () => {
    const three = computeEvidenceConfidence({
      imageQualities: ['good', 'good', 'good'], informativeCount: 3, freshnessState: Freshness.RECENT
    });
    const ten = computeEvidenceConfidence({
      imageQualities: Array(10).fill('good'), informativeCount: 10, freshnessState: Freshness.RECENT
    });
    expect(ten.confidence).toBe(three.confidence);
  });

  it('rewards agreement and punishes conflict', () => {
    const agreeing = computeEvidenceConfidence({
      imageQualities: ['good', 'good'], informativeCount: 2, agreement: 1, conflict: 0, freshnessState: Freshness.RECENT
    });
    const conflicting = computeEvidenceConfidence({
      imageQualities: ['good', 'good'], informativeCount: 2, agreement: 0.5, conflict: 0.5, freshnessState: Freshness.RECENT
    });
    expect(agreeing.confidence).toBeGreaterThan(conflicting.confidence);
  });

  it('applies no agreement bonus when there is only one observation', () => {
    const result = computeEvidenceConfidence({
      imageQualities: ['good'], informativeCount: 1, agreement: 1, freshnessState: Freshness.RECENT
    });
    expect(result.components.some((c) => c.key === 'confidence.agreement')).toBe(false);
  });

  it('discounts aged evidence', () => {
    const base = { osmInformativeness: 0.8, imageQualities: ['good', 'good'], informativeCount: 2 };
    const recent = computeEvidenceConfidence({ ...base, freshnessState: Freshness.RECENT });
    const stale = computeEvidenceConfidence({ ...base, freshnessState: Freshness.STALE });
    expect(stale.confidence).toBeLessThan(recent.confidence);
  });

  it('lifts a decisive OSM tag to the configured floor', () => {
    const result = computeEvidenceConfidence({
      osmInformativeness: 0.45, osmDecisive: true, freshnessState: Freshness.NONE
    });
    expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENCE.osmDecisiveFloor);
    expect(result.gate.classifiable).toBe(true);
  });

  it('treats an on-site verification as the strongest evidence there is', () => {
    const result = computeEvidenceConfidence({ manuallyVerified: true, freshnessState: Freshness.RECENT });
    expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENCE.manualVerificationFloor);
  });

  it('caps the contribution of confirmed citizen reports', () => {
    const many = computeEvidenceConfidence({
      verifiedReportCount: 20, freshnessState: Freshness.RECENT
    });
    const component = many.components.find((c) => c.key === 'confidence.verified_reports');
    expect(component.points).toBeLessThanOrEqual(CONFIDENCE.maxVerifiedReportBonus);
  });

  it('never exceeds 100', () => {
    const result = computeEvidenceConfidence({
      osmInformativeness: 1,
      imageQualities: ['good', 'good', 'good'],
      informativeCount: 3,
      agreement: 1,
      verifiedReportCount: 5,
      manuallyVerified: true,
      freshnessState: Freshness.RECENT
    });
    expect(result.confidence).toBeLessThanOrEqual(100);
  });
});
