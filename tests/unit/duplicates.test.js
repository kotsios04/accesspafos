import { describe, it, expect } from 'vitest';
import { duplicateScore, findDuplicateCandidates } from '@shared/duplicates.js';
import { DUPLICATE_MIN_SCORE } from '@shared/config.js';

const NOW = Date.now();
const at = (lat, lng) => ({ lat, lng });

const base = {
  id: 'new',
  category: 'blocked_sidewalk',
  location: at(34.7754, 32.4245),
  createdAt: NOW,
  segmentId: 'seg-1'
};

describe('duplicateScore', () => {
  it('scores a near-identical report very highly', () => {
    const result = duplicateScore(base, {
      id: 'other', category: 'blocked_sidewalk',
      location: at(34.77542, 32.42452), createdAt: NOW - 86400000, segmentId: 'seg-1'
    });
    expect(result.score).toBeGreaterThan(0.9);
    expect(result.reasons).toContain('duplicate.reason.same_segment');
    expect(result.distanceMeters).toBeLessThan(10);
  });

  it('scores a distant report at zero', () => {
    const result = duplicateScore(base, {
      id: 'far', category: 'blocked_sidewalk',
      location: at(35.1856, 33.3823), createdAt: NOW
    });
    expect(result.score).toBeLessThan(DUPLICATE_MIN_SCORE);
  });

  it('gives partial credit to a related category', () => {
    const same = duplicateScore(base, { id: 'a', category: 'blocked_sidewalk', location: at(34.77545, 32.42455), createdAt: NOW });
    const related = duplicateScore(base, { id: 'b', category: 'temporary_obstruction', location: at(34.77545, 32.42455), createdAt: NOW });
    const unrelated = duplicateScore(base, { id: 'c', category: 'steps', location: at(34.77545, 32.42455), createdAt: NOW });
    expect(same.score).toBeGreaterThan(related.score);
    expect(related.score).toBeGreaterThan(unrelated.score);
  });

  it('discounts reports separated by a long time', () => {
    const recent = duplicateScore(base, { id: 'a', category: 'blocked_sidewalk', location: at(34.77545, 32.42455), createdAt: NOW });
    const old = duplicateScore(base, { id: 'b', category: 'blocked_sidewalk', location: at(34.77545, 32.42455), createdAt: NOW - 200 * 86400000 });
    expect(recent.score).toBeGreaterThan(old.score);
  });

  it('handles a missing timestamp without throwing', () => {
    const result = duplicateScore(base, { id: 'a', category: 'blocked_sidewalk', location: at(34.77545, 32.42455), createdAt: null });
    expect(Number.isFinite(result.score)).toBe(true);
  });
});

describe('findDuplicateCandidates', () => {
  const nearby = (id, over = {}) => ({
    id, category: 'blocked_sidewalk',
    location: at(34.77545, 32.42455), createdAt: NOW - 86400000,
    status: 'pending', segmentId: 'seg-1', ...over
  });

  it('never suggests the report itself', () => {
    expect(findDuplicateCandidates(base, [{ ...base, status: 'pending' }])).toHaveLength(0);
  });

  it('ignores reports that are already closed', () => {
    const candidates = findDuplicateCandidates(base, [
      nearby('rejected', { status: 'rejected' }),
      nearby('resolved', { status: 'resolved' }),
      nearby('open')
    ]);
    expect(candidates.map((c) => c.id)).toEqual(['open']);
  });

  it('ranks the best match first and caps the list', () => {
    const candidates = findDuplicateCandidates(base, [
      nearby('far', { location: at(34.7757, 32.4249) }),
      nearby('exact', { location: at(34.7754, 32.4245) }),
      nearby('c'), nearby('d'), nearby('e'), nearby('f'), nearby('g')
    ]);
    expect(candidates[0].id).toBe('exact');
    expect(candidates.length).toBeLessThanOrEqual(5);
  });

  it('returns nothing for an empty or missing list', () => {
    expect(findDuplicateCandidates(base, [])).toEqual([]);
    expect(findDuplicateCandidates(base, null)).toEqual([]);
  });
});
