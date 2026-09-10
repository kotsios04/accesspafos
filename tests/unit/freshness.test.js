import { describe, it, expect } from 'vitest';
import { computeFreshness, freshnessConfidenceFactor, isStale, toMillis } from '@shared/freshness.js';
import { Freshness } from '@shared/constants.js';
import { FRESHNESS_THRESHOLDS } from '@shared/config.js';

const NOW = Date.parse('2026-09-08T12:00:00Z');
const daysAgo = (n) => NOW - n * 86400000;

describe('toMillis', () => {
  it('accepts every timestamp shape the system passes around', () => {
    expect(toMillis(NOW)).toBe(NOW);
    expect(toMillis(new Date(NOW))).toBe(NOW);
    expect(toMillis('2026-09-08T12:00:00Z')).toBe(NOW);
    expect(toMillis({ seconds: NOW / 1000 })).toBe(NOW);
    expect(toMillis({ _seconds: NOW / 1000 })).toBe(NOW);
    expect(toMillis({ toMillis: () => NOW })).toBe(NOW);
    expect(toMillis({ toDate: () => new Date(NOW) })).toBe(NOW);
  });

  it('returns null for nonsense rather than a wrong date', () => {
    expect(toMillis(null)).toBeNull();
    expect(toMillis('not a date')).toBeNull();
    expect(toMillis(NaN)).toBeNull();
  });
});

describe('computeFreshness', () => {
  it('reports "none" when nothing is dated', () => {
    const result = computeFreshness({ now: NOW });
    expect(result.state).toBe(Freshness.NONE);
    expect(result.ageDays).toBeNull();
  });

  it('classifies recent, ageing and stale by the configured thresholds', () => {
    expect(computeFreshness({ lastEvidenceAt: daysAgo(30), now: NOW }).state).toBe(Freshness.RECENT);
    expect(computeFreshness({ lastEvidenceAt: daysAgo(FRESHNESS_THRESHOLDS.recentMaxDays + 10), now: NOW }).state)
      .toBe(Freshness.AGING);
    expect(computeFreshness({ lastEvidenceAt: daysAgo(FRESHNESS_THRESHOLDS.agingMaxDays + 10), now: NOW }).state)
      .toBe(Freshness.STALE);
  });

  it('is driven by the newest evidence, not the oldest', () => {
    const result = computeFreshness({
      lastEvidenceAt: daysAgo(2000),
      lastVerifiedAt: daysAgo(10),
      now: NOW
    });
    expect(result.state).toBe(Freshness.RECENT);
    expect(result.verified).toBe(true);
  });

  it('never reports a negative age for a clock-skewed future timestamp', () => {
    const result = computeFreshness({ lastEvidenceAt: NOW + 86400000, now: NOW });
    expect(result.ageDays).toBe(0);
  });
});

describe('freshnessConfidenceFactor', () => {
  it('discounts monotonically as evidence ages', () => {
    const recent = freshnessConfidenceFactor(Freshness.RECENT);
    const aging = freshnessConfidenceFactor(Freshness.AGING);
    const stale = freshnessConfidenceFactor(Freshness.STALE);
    const none = freshnessConfidenceFactor(Freshness.NONE);
    expect(recent).toBeGreaterThan(aging);
    expect(aging).toBeGreaterThan(stale);
    expect(stale).toBeGreaterThan(none);
    expect(recent).toBe(1);
  });
});

describe('isStale', () => {
  it('flags stale and undated evidence for re-checking', () => {
    expect(isStale(Freshness.STALE)).toBe(true);
    expect(isStale(Freshness.NONE)).toBe(true);
    expect(isStale(Freshness.RECENT)).toBe(false);
  });
});
