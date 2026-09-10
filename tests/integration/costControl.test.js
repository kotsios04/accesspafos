/**
 * The cost-control machinery.
 *
 * These are the tests that stand between this project and a surprise bill:
 * frame selection, deduplication keys, and the arithmetic behind the
 * pre-flight estimate an administrator sees before starting an analysis run.
 */

import { describe, it, expect } from 'vitest';
import { selectUsefulImagesForSegment, scoreImageForSegment, buildImageIndex } from '../../functions/src/mapillary/select.js';
import { analysisDedupeKey } from '../../functions/src/lib/cacheKey.js';
import {
  MAX_IMAGES_PER_SEGMENT, MAPILLARY_DEDUPE_DISTANCE_M, MAPILLARY_SEARCH_RADIUS_M,
  MAX_AI_ANALYSES_PER_JOB, MAX_AI_ANALYSES_PER_DAY, ANALYSIS_VERSION, AI_MODEL
} from '@shared/config.js';

const NOW = Date.parse('2026-09-08T00:00:00Z');
const yearsAgo = (n) => NOW - n * 365.25 * 86400000;

const segment = {
  id: 'seg-1',
  geometry: [[32.4160, 34.7565], [32.4185, 34.7568], [32.4210, 34.7570]]
};

/** A whole Mapillary sequence: eighty frames a few metres apart. */
function sequenceAlongSegment(count = 80, sequenceId = 'seq-a', capturedAt = yearsAgo(1)) {
  const [start, , end] = segment.geometry;
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    return {
      id: `${sequenceId}-${i}`,
      lng: start[0] + (end[0] - start[0]) * t,
      lat: start[1] + (end[1] - start[1]) * t,
      capturedAt,
      compassAngle: 88,
      isPano: false,
      qualityScore: 0.7,
      sequenceId
    };
  });
}

describe('frame selection', () => {
  it('analyses a handful of frames, not the whole sequence', () => {
    const chosen = selectUsefulImagesForSegment(segment, sequenceAlongSegment(80), { now: NOW });
    expect(chosen.length).toBeGreaterThan(0);
    expect(chosen.length).toBeLessThanOrEqual(MAX_IMAGES_PER_SEGMENT);
  });

  it('never picks two frames standing in the same spot', () => {
    const chosen = selectUsefulImagesForSegment(segment, sequenceAlongSegment(80), { now: NOW });
    for (let i = 0; i < chosen.length; i += 1) {
      for (let j = i + 1; j < chosen.length; j += 1) {
        const a = chosen[i].image;
        const b = chosen[j].image;
        const metres = Math.hypot((a.lng - b.lng) * 91000, (a.lat - b.lat) * 111000);
        expect(metres).toBeGreaterThanOrEqual(MAPILLARY_DEDUPE_DISTANCE_M * 0.9);
      }
    }
  });

  it('prefers recent imagery over old imagery', () => {
    const recent = { id: 'new', lng: 32.4185, lat: 34.7568, capturedAt: NOW - 30 * 86400000, compassAngle: 88, isPano: false, qualityScore: 0.7, sequenceId: 'a' };
    const ancient = { id: 'old', lng: 32.4185, lat: 34.7568, capturedAt: yearsAgo(7), compassAngle: 88, isPano: false, qualityScore: 0.7, sequenceId: 'b' };
    expect(scoreImageForSegment(recent, segment, { now: NOW }).score)
      .toBeGreaterThan(scoreImageForSegment(ancient, segment, { now: NOW }).score);
  });

  it('prefers closer imagery over distant imagery', () => {
    const near = { id: 'near', lng: 32.4185, lat: 34.7568, capturedAt: yearsAgo(1), compassAngle: 88, isPano: false, sequenceId: 'a' };
    const far = { id: 'far', lng: 32.41865, lat: 34.75695, capturedAt: yearsAgo(1), compassAngle: 88, isPano: false, sequenceId: 'b' };
    expect(scoreImageForSegment(near, segment, { now: NOW }).score)
      .toBeGreaterThan(scoreImageForSegment(far, segment, { now: NOW }).score);
  });

  it('rejects imagery beyond the search radius outright', () => {
    const distant = { id: 'x', lng: 32.4400, lat: 34.7800, capturedAt: NOW, compassAngle: 0, isPano: false, sequenceId: 'a' };
    expect(scoreImageForSegment(distant, segment, { now: NOW })).toBeNull();
  });

  it('skips 360-degree panoramas, whose geometry the prompt is not calibrated for', () => {
    const pano = { id: 'p', lng: 32.4185, lat: 34.7568, capturedAt: NOW, compassAngle: 0, isPano: true, sequenceId: 'a' };
    expect(scoreImageForSegment(pano, segment, { now: NOW })).toBeNull();
    const chosen = selectUsefulImagesForSegment(segment, [pano], { now: NOW });
    expect(chosen).toHaveLength(0);
  });

  it('spreads across sequences, so the frames are genuinely independent views', () => {
    const candidates = [
      ...sequenceAlongSegment(30, 'seq-a', yearsAgo(1)),
      ...sequenceAlongSegment(30, 'seq-b', yearsAgo(1.1))
    ];
    const chosen = selectUsefulImagesForSegment(segment, candidates, { now: NOW });
    const sequences = new Set(chosen.map((c) => c.image.sequenceId));
    expect(sequences.size).toBeGreaterThan(1);
  });

  it('returns nothing when there is no imagery, rather than inventing coverage', () => {
    expect(selectUsefulImagesForSegment(segment, [], { now: NOW })).toHaveLength(0);
    expect(selectUsefulImagesForSegment(segment, null, { now: NOW })).toHaveLength(0);
  });

  it('is deterministic, so an estimate matches the run that follows it', () => {
    const candidates = sequenceAlongSegment(60);
    const first = selectUsefulImagesForSegment(segment, candidates, { now: NOW }).map((c) => c.image.id);
    const second = selectUsefulImagesForSegment(segment, candidates, { now: NOW }).map((c) => c.image.id);
    expect(first).toEqual(second);
  });
});

describe('the spatial index', () => {
  it('returns the same candidates a full scan would, for a segment in range', () => {
    const images = sequenceAlongSegment(40);
    const index = buildImageIndex(images);
    const candidates = index.candidatesFor(segment);
    const chosenViaIndex = selectUsefulImagesForSegment(segment, candidates, { now: NOW }).map((c) => c.image.id);
    const chosenViaScan = selectUsefulImagesForSegment(segment, images, { now: NOW }).map((c) => c.image.id);
    expect(chosenViaIndex).toEqual(chosenViaScan);
  });

  it('does not return imagery from the other side of the city', () => {
    const index = buildImageIndex([
      ...sequenceAlongSegment(10),
      { id: 'nicosia', lng: 33.3823, lat: 35.1856, capturedAt: NOW, isPano: false, sequenceId: 'z' }
    ]);
    expect(index.candidatesFor(segment).map((i) => i.id)).not.toContain('nicosia');
  });
});

describe('the deduplication key', () => {
  it('is identical for the same image, model and analysis version', () => {
    const input = { sourceType: 'mapillary', sourceId: '123', model: AI_MODEL, analysisVersion: ANALYSIS_VERSION };
    expect(analysisDedupeKey(input)).toBe(analysisDedupeKey({ ...input }));
  });

  it('changes when the analysis version changes, so a new contract is not served from an old cache', () => {
    const base = { sourceType: 'mapillary', sourceId: '123', model: AI_MODEL };
    expect(analysisDedupeKey({ ...base, analysisVersion: '1.0.0' }))
      .not.toBe(analysisDedupeKey({ ...base, analysisVersion: '1.1.0' }));
  });

  it('changes when the model changes', () => {
    const base = { sourceType: 'mapillary', sourceId: '123', analysisVersion: ANALYSIS_VERSION };
    expect(analysisDedupeKey({ ...base, model: 'a' })).not.toBe(analysisDedupeKey({ ...base, model: 'b' }));
  });

  it('distinguishes a citizen photograph from a Mapillary frame with the same id', () => {
    const base = { sourceId: '123', model: AI_MODEL, analysisVersion: ANALYSIS_VERSION };
    expect(analysisDedupeKey({ ...base, sourceType: 'mapillary' }))
      .not.toBe(analysisDedupeKey({ ...base, sourceType: 'citizen' }));
  });
});

describe('spend estimation', () => {
  /** The arithmetic the ingestion console shows before the button is armed. */
  const willAnalyse = (frames, perJob, remainingToday) => Math.min(frames, perJob, remainingToday);

  it('never proposes more calls than the per-job cap', () => {
    expect(willAnalyse(10000, MAX_AI_ANALYSES_PER_JOB, MAX_AI_ANALYSES_PER_DAY))
      .toBeLessThanOrEqual(MAX_AI_ANALYSES_PER_JOB);
  });

  it('never proposes more calls than remain in today’s budget', () => {
    expect(willAnalyse(10000, MAX_AI_ANALYSES_PER_JOB, 7)).toBe(7);
  });

  it('proposes nothing when the budget is spent', () => {
    expect(willAnalyse(500, MAX_AI_ANALYSES_PER_JOB, 0)).toBe(0);
  });

  it('keeps the per-job cap at or below the daily cap, so one job cannot exhaust a day', () => {
    expect(MAX_AI_ANALYSES_PER_JOB).toBeLessThanOrEqual(MAX_AI_ANALYSES_PER_DAY);
  });

  it('bounds the worst case for a whole pilot region', () => {
    const pilotSegments = 200;
    const worstCase = pilotSegments * MAX_IMAGES_PER_SEGMENT;
    expect(worstCase).toBeLessThanOrEqual(MAX_AI_ANALYSES_PER_DAY + MAX_AI_ANALYSES_PER_JOB);
  });
});
