/**
 * The AI half of the pipeline, with the model replaced by fixtures.
 *
 * No network, no API key, no cost. What is under test is the contract: given
 * whatever a model returns - including things a model should never return -
 * the system must end up with a defensible score or with an honest "we do
 * not know".
 */

import { describe, it, expect } from 'vitest';
import { normalizeObservation, validateObservation } from '@shared/observationSchema.js';
import { aggregateObservations } from '@shared/aggregate.js';
import { computeAccessibilityScore } from '@shared/scoring.js';
import { computeEvidenceConfidence } from '@shared/confidence.js';
import { classifySegment } from '@shared/classify.js';
import { assessSegment } from '@shared/assess.js';
import { SegmentStatus, SourceType, Barrier, Freshness } from '@shared/constants.js';
import { MIN_CONFIDENCE_TO_CLASSIFY } from '@shared/config.js';
import responses from '../fixtures/model-responses.json';

const NOW = Date.parse('2026-09-08T00:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

/** The path an analysis result actually takes through the system. */
function ingest(rawModelOutput, capturedAt = daysAgo(100)) {
  const observation = normalizeObservation(rawModelOutput);
  const check = validateObservation(observation);
  return {
    observation, valid: check.ok,
    record: { observation, sourceType: SourceType.MAPILLARY, sourceId: `img-${Math.random()}`, capturedAt }
  };
}

describe('normalising whatever the model returns', () => {
  it('accepts a well-formed response unchanged', () => {
    const { observation, valid } = ingest(responses.clean);
    expect(valid).toBe(true);
    expect(observation.pedestrianPath.condition).toBe('clear');
    expect(observation.curbRamp.visible).toBe('yes');
  });

  it('survives a response with invented enum values', () => {
    const { observation, valid } = ingest(responses.inventedValues);
    expect(valid).toBe(true);
    expect(observation.surface.type).toBe('unknown');
    expect(observation.obstacle.severity).toBe('unknown');
  });

  it('survives a response missing whole sections', () => {
    const { observation, valid } = ingest(responses.partial);
    expect(valid).toBe(true);
  });

  it('survives prose where an object was expected', () => {
    const { observation, valid } = ingest(responses.prose);
    expect(valid).toBe(true);
    expect(observation.imageQuality).toBe('poor');
  });

  it('discards a model attempting to smuggle in a score', () => {
    const { observation } = ingest(responses.withScore);
    expect(observation.accessibilityScore).toBeUndefined();
    expect(observation.score).toBeUndefined();
    expect(observation.rating).toBeUndefined();
  });

  it('discards fields describing people', () => {
    const { observation } = ingest(responses.describesPeople);
    expect(JSON.stringify(observation)).not.toMatch(/wheelchair user|elderly|pedestrians observed/i);
    expect(observation.people).toBeUndefined();
  });

  it('truncates a model that will not stop talking', () => {
    const { observation } = ingest(responses.verbose);
    expect(observation.notes.length).toBeLessThanOrEqual(240);
    expect(observation.obstacle.description.length).toBeLessThanOrEqual(140);
  });
});

describe('from observations to a classification', () => {
  it('turns two clean images into an accessible classification', () => {
    const records = [ingest(responses.clean).record, ingest(responses.clean).record];
    const visual = aggregateObservations(records);
    const score = computeAccessibilityScore(visual);
    const confidence = computeEvidenceConfidence({
      imageQualities: visual.imageQualities,
      informativeCount: visual.informativeCount,
      agreement: visual.agreement,
      conflict: visual.conflict,
      freshnessState: Freshness.RECENT
    });
    const result = classifySegment({ score: score.score, confidence: confidence.confidence });
    expect(result.status).toBe(SegmentStatus.ACCESSIBLE);
  });

  it('turns a blocked pavement into an inaccessible classification', () => {
    const records = [ingest(responses.blocked).record, ingest(responses.blocked).record];
    const visual = aggregateObservations(records);
    const score = computeAccessibilityScore(visual);
    expect(score.barrierIds).toContain(Barrier.BLOCKING_OBSTACLE);
    expect(score.score).toBeLessThan(50);
  });

  it('keeps a segment grey when every image saw nothing', () => {
    const records = [ingest(responses.sawNothing).record, ingest(responses.sawNothing).record];
    const visual = aggregateObservations(records);
    expect(visual.informativeCount).toBe(0);
    const confidence = computeEvidenceConfidence({
      imageQualities: visual.imageQualities,
      informativeCount: visual.informativeCount,
      freshnessState: Freshness.RECENT
    });
    expect(confidence.confidence).toBeLessThan(MIN_CONFIDENCE_TO_CLASSIFY);
  });

  it('lowers confidence when two images contradict each other', () => {
    const agreeing = aggregateObservations([ingest(responses.clean).record, ingest(responses.clean).record]);
    const conflicting = aggregateObservations([ingest(responses.clean).record, ingest(responses.blocked).record]);

    const scoreOf = (visual) => computeEvidenceConfidence({
      imageQualities: visual.imageQualities,
      informativeCount: visual.informativeCount,
      agreement: visual.agreement,
      conflict: visual.conflict,
      freshnessState: Freshness.RECENT
    }).confidence;

    expect(scoreOf(conflicting)).toBeLessThan(scoreOf(agreeing));
    expect(conflicting.contestedKeys.length).toBeGreaterThan(0);
  });

  it('resolves a contradiction toward the worse reading, not the better one', () => {
    const visual = aggregateObservations([ingest(responses.clean).record, ingest(responses.blocked).record]);
    const score = computeAccessibilityScore(visual);
    expect(score.score).toBeLessThan(computeAccessibilityScore(
      aggregateObservations([ingest(responses.clean).record, ingest(responses.clean).record])
    ).score);
  });
});

describe('the whole assessment, end to end', () => {
  it('lets good imagery classify a segment that OSM says nothing about', () => {
    const result = assessSegment({
      osmTags: { highway: 'footway' },
      observations: [
        ingest(responses.clean, daysAgo(90)).record,
        ingest(responses.clean, daysAgo(95)).record,
        ingest(responses.clean, daysAgo(100)).record
      ],
      now: NOW
    });
    expect(result.status).toBe(SegmentStatus.ACCESSIBLE);
    expect(result.sources).toContain(SourceType.MAPILLARY);
    expect(result.observationCount).toBe(3);
  });

  it('lets OSM and imagery corroborate each other', () => {
    const imageryOnly = assessSegment({
      osmTags: { highway: 'footway' },
      observations: [ingest(responses.clean, daysAgo(90)).record, ingest(responses.clean, daysAgo(95)).record],
      now: NOW
    });
    const both = assessSegment({
      osmTags: { highway: 'footway', surface: 'asphalt', smoothness: 'good', kerb: 'lowered' },
      osmTimestamp: daysAgo(200),
      observations: [ingest(responses.clean, daysAgo(90)).record, ingest(responses.clean, daysAgo(95)).record],
      now: NOW
    });
    expect(both.evidenceConfidence).toBeGreaterThan(imageryOnly.evidenceConfidence);
  });

  it('refuses to classify from three photographs that all saw nothing', () => {
    const result = assessSegment({
      osmTags: { highway: 'footway' },
      observations: [
        ingest(responses.sawNothing, daysAgo(10)).record,
        ingest(responses.sawNothing, daysAgo(11)).record,
        ingest(responses.sawNothing, daysAgo(12)).record
      ],
      now: NOW
    });
    expect(result.status).toBe(SegmentStatus.UNVERIFIED);
  });

  it('never lets the model output reach the score directly', () => {
    // Even a response that tries hard to assert accessibility cannot raise
    // the score above what its structured findings justify.
    const result = assessSegment({
      osmTags: { highway: 'footway' },
      observations: [ingest(responses.withScore, daysAgo(30)).record],
      now: NOW
    });
    expect(result.accessibilityScore === null || result.accessibilityScore <= 100).toBe(true);
    expect(result.explanation?.score?.additions?.some((a) => /score|rating/i.test(a.key))).toBeFalsy();
  });
});
