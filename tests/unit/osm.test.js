import { describe, it, expect } from 'vitest';
import {
  isPedestrianWay, classifyOsmWay, carriagewayHasMappedSidewalks,
  parseLengthMeters, parseInclinePercent, deriveOsmEvidence, classifyPoi,
  osmDisplayName, SegmentKind, isTruthy, isFalsy
} from '@shared/osm.js';
import { Barrier, PositiveFeature } from '@shared/constants.js';

describe('isPedestrianWay', () => {
  it('accepts pedestrian infrastructure', () => {
    for (const highway of ['footway', 'path', 'pedestrian', 'steps', 'living_street']) {
      expect(isPedestrianWay({ highway }), highway).toBe(true);
    }
  });

  it('accepts walkable roads as a fallback', () => {
    expect(isPedestrianWay({ highway: 'residential' })).toBe(true);
    expect(isPedestrianWay({ highway: 'service' })).toBe(true);
  });

  it('rejects motorways and non-highways', () => {
    for (const highway of ['motorway', 'trunk', 'construction', 'raceway']) {
      expect(isPedestrianWay({ highway }), highway).toBe(false);
    }
    expect(isPedestrianWay({})).toBe(false);
    expect(isPedestrianWay(null)).toBe(false);
  });

  it('respects an explicit prohibition on walking', () => {
    expect(isPedestrianWay({ highway: 'footway', foot: 'no' })).toBe(false);
    expect(isPedestrianWay({ highway: 'service', access: 'private' })).toBe(false);
  });

  it('keeps a private way that nonetheless permits pedestrians', () => {
    expect(isPedestrianWay({ highway: 'service', access: 'private', foot: 'yes' })).toBe(true);
  });
});

describe('classifyOsmWay', () => {
  it('distinguishes sidewalks, crossings and steps', () => {
    expect(classifyOsmWay({ highway: 'footway', footway: 'sidewalk' }).kind).toBe(SegmentKind.SIDEWALK);
    expect(classifyOsmWay({ highway: 'footway', footway: 'crossing' }).kind).toBe(SegmentKind.CROSSING);
    expect(classifyOsmWay({ highway: 'steps' }).kind).toBe(SegmentKind.STEPS);
    expect(classifyOsmWay({ highway: 'pedestrian' }).kind).toBe(SegmentKind.PEDESTRIAN_STREET);
  });

  it('marks a carriageway as such', () => {
    const result = classifyOsmWay({ highway: 'residential' });
    expect(result.kind).toBe(SegmentKind.ROAD_WALKABLE);
    expect(result.isCarriageway).toBe(true);
  });

  it('preserves which side of the street a sidewalk is on', () => {
    expect(classifyOsmWay({ highway: 'footway', footway: 'sidewalk', 'sidewalk:side': 'left' }).side).toBe('left');
  });
});

describe('carriagewayHasMappedSidewalks', () => {
  it('detects separately-mapped pavements so the road is not double-counted', () => {
    expect(carriagewayHasMappedSidewalks({ sidewalk: 'separate' })).toBe(true);
    expect(carriagewayHasMappedSidewalks({ 'sidewalk:left': 'separate', 'sidewalk:right': 'separate' })).toBe(true);
    expect(carriagewayHasMappedSidewalks({ sidewalk: 'both' })).toBe(false);
  });
});

describe('tag value parsing', () => {
  it('parses lengths in several units', () => {
    expect(parseLengthMeters('1.5')).toBe(1.5);
    expect(parseLengthMeters('1.5 m')).toBe(1.5);
    expect(parseLengthMeters('150 cm')).toBe(1.5);
    expect(parseLengthMeters('1500mm')).toBe(1.5);
    expect(parseLengthMeters(2)).toBe(2);
  });

  it('returns null for values it cannot trust', () => {
    expect(parseLengthMeters('wide')).toBeNull();
    expect(parseLengthMeters('')).toBeNull();
    expect(parseLengthMeters(undefined)).toBeNull();
  });

  it('parses inclines and refuses direction-only values', () => {
    expect(parseInclinePercent('12%')).toBe(12);
    expect(parseInclinePercent('-8%')).toBe(8);
    expect(parseInclinePercent('7')).toBe(7);
    expect(parseInclinePercent('up')).toBeNull();
    expect(parseInclinePercent('yes')).toBeNull();
  });

  it('converts an incline given in degrees', () => {
    expect(parseInclinePercent('10°')).toBeCloseTo(17.6, 0);
  });

  it('reads truthy and falsy OSM conventions', () => {
    expect(isTruthy('designated')).toBe(true);
    expect(isTruthy('yes')).toBe(true);
    expect(isFalsy('no')).toBe(true);
    expect(isFalsy('private')).toBe(true);
  });
});

describe('deriveOsmEvidence', () => {
  // The cardinal rule of the whole system.
  it('produces NO evidence at all from an untagged footway', () => {
    const result = deriveOsmEvidence({ highway: 'footway' });
    expect(result.barriers).toHaveLength(0);
    expect(result.positives).toHaveLength(0);
    expect(result.informativeness).toBe(0);
    expect(result.decisive).toBe(false);
  });

  it('treats highway=steps as a decisive hard block', () => {
    const result = deriveOsmEvidence({ highway: 'steps' });
    expect(result.barriers.map((b) => b.id)).toContain(Barrier.STEPS);
    expect(result.hardBlocks).toContain(Barrier.STEPS);
    expect(result.decisive).toBe(true);
    expect(result.informativeness).toBeGreaterThan(0.3);
  });

  it('does not hard-block steps that have a wheelchair ramp beside them', () => {
    const result = deriveOsmEvidence({ highway: 'steps', 'ramp:wheelchair': 'yes' });
    expect(result.hardBlocks).not.toContain(Barrier.STEPS);
    expect(result.positives.map((p) => p.id)).toContain(PositiveFeature.RAMP_PRESENT);
  });

  it('honours explicit wheelchair tagging in both directions', () => {
    const no = deriveOsmEvidence({ highway: 'footway', wheelchair: 'no' });
    expect(no.hardBlocks).toContain(Barrier.WHEELCHAIR_TAGGED_NO);
    const yes = deriveOsmEvidence({ highway: 'footway', wheelchair: 'yes' });
    expect(yes.positives.map((p) => p.id)).toContain(PositiveFeature.WHEELCHAIR_TAGGED_YES);
    const limited = deriveOsmEvidence({ highway: 'footway', wheelchair: 'limited' });
    expect(limited.barriers.map((b) => b.id)).toContain(Barrier.RESTRICTED_PASSAGE);
  });

  it('reads surface and smoothness', () => {
    expect(deriveOsmEvidence({ highway: 'footway', surface: 'asphalt' }).positives.map((p) => p.id))
      .toContain(PositiveFeature.GOOD_PAVED_SURFACE);
    expect(deriveOsmEvidence({ highway: 'footway', surface: 'gravel' }).barriers.map((b) => b.id))
      .toContain(Barrier.UNSUITABLE_SURFACE);
    expect(deriveOsmEvidence({ highway: 'footway', smoothness: 'very_bad' }).barriers.map((b) => b.id))
      .toContain(Barrier.DAMAGED_SURFACE);
  });

  it('reads kerbs', () => {
    expect(deriveOsmEvidence({ highway: 'footway', kerb: 'raised' }).barriers.map((b) => b.id))
      .toContain(Barrier.HIGH_KERB);
    expect(deriveOsmEvidence({ highway: 'footway', kerb: 'lowered' }).positives.map((p) => p.id))
      .toContain(PositiveFeature.CURB_RAMP);
    expect(deriveOsmEvidence({ highway: 'footway', 'kerb:height': '12 cm' }).barriers.map((b) => b.id))
      .toContain(Barrier.HIGH_KERB);
    expect(deriveOsmEvidence({ highway: 'footway', 'kerb:height': '2 cm' }).positives.map((p) => p.id))
      .toContain(PositiveFeature.FLUSH_KERB);
  });

  it('reads width and incline bands', () => {
    expect(deriveOsmEvidence({ highway: 'footway', width: '0.7' }).barriers.map((b) => b.id))
      .toContain(Barrier.NARROW_WIDTH);
    expect(deriveOsmEvidence({ highway: 'footway', width: '2.0' }).positives.map((p) => p.id))
      .toContain(PositiveFeature.ADEQUATE_WIDTH);
    expect(deriveOsmEvidence({ highway: 'footway', incline: '12%' }).barriers.map((b) => b.id))
      .toContain(Barrier.STEEP_INCLINE);
    expect(deriveOsmEvidence({ highway: 'footway', incline: '6%' }).barriers.map((b) => b.id))
      .toContain(Barrier.MODERATE_INCLINE);
  });

  it('flags a carriageway explicitly tagged as having no pavement', () => {
    const result = deriveOsmEvidence({ highway: 'residential', sidewalk: 'no' });
    expect(result.barriers.map((b) => b.id)).toContain(Barrier.NO_PEDESTRIAN_PATH);
  });

  it('reads physical barriers on the way', () => {
    expect(deriveOsmEvidence({ highway: 'footway', barrier: 'kissing_gate' }).barriers.map((b) => b.id))
      .toContain(Barrier.BLOCKING_OBSTACLE);
    expect(deriveOsmEvidence({ highway: 'footway', barrier: 'bollard' }).barriers.map((b) => b.id))
      .toContain(Barrier.RESTRICTED_PASSAGE);
  });

  it('raises informativeness as more relevant tags appear', () => {
    const thin = deriveOsmEvidence({ highway: 'footway', surface: 'asphalt' });
    const rich = deriveOsmEvidence({
      highway: 'footway', surface: 'asphalt', smoothness: 'good',
      width: '2.0', kerb: 'lowered', incline: '2%', tactile_paving: 'yes'
    });
    expect(rich.informativeness).toBeGreaterThan(thin.informativeness);
    expect(rich.informativeness).toBeLessThanOrEqual(1);
  });
});

describe('classifyPoi', () => {
  it('recognises the public services the priority engine uses', () => {
    expect(classifyPoi({ amenity: 'hospital' })).toBe('hospital');
    expect(classifyPoi({ amenity: 'school' })).toBe('school');
    expect(classifyPoi({ highway: 'bus_stop' })).toBe('bus_stop');
    expect(classifyPoi({ office: 'government' })).toBe('government');
  });

  it('returns null for everything else', () => {
    expect(classifyPoi({ amenity: 'bar' })).toBeNull();
    expect(classifyPoi({})).toBeNull();
    expect(classifyPoi(null)).toBeNull();
  });
});

describe('osmDisplayName', () => {
  it('prefers the requested language and falls back sensibly', () => {
    const tags = { name: 'Poseidonos', 'name:en': 'Poseidonos Avenue', 'name:el': 'Λεωφόρος Ποσειδώνος' };
    expect(osmDisplayName(tags, 'el')).toBe('Λεωφόρος Ποσειδώνος');
    expect(osmDisplayName(tags, 'en')).toBe('Poseidonos Avenue');
    expect(osmDisplayName({ name: 'Only' }, 'el')).toBe('Only');
    expect(osmDisplayName({}, 'en')).toBeNull();
  });
});
