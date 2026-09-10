#!/usr/bin/env node
/**
 * Seed the LOCAL EMULATORS with a small, clearly-labelled fixture region.
 *
 * This exists so the UI can be developed and demonstrated without a network
 * round trip to Overpass, Mapillary or Gemini. It refuses to run against a
 * real project: fixture data on a production map would be exactly the
 * "dashboard with fake values" this project is built not to be.
 *
 *   firebase emulators:start --only firestore,auth,storage
 *   npm run seed:dev
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const shared = (name) => import(pathToFileURL(join(root, 'shared', name)).href);

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

/**
 * A short stretch of the Kato Pafos harbour front, invented but plausible,
 * exercising every classification the UI has to render.
 */
const FIXTURE_WAYS = [
  {
    id: 'demo-1', name: 'Poseidonos Avenue (demo)', kind: 'sidewalk',
    coords: [[32.4160, 34.7565], [32.4185, 34.7568], [32.4210, 34.7570]],
    tags: { highway: 'footway', footway: 'sidewalk', surface: 'asphalt', smoothness: 'good', width: '2.4', kerb: 'lowered', tactile_paving: 'yes' }
  },
  {
    id: 'demo-2', name: 'Harbour steps (demo)', kind: 'steps',
    coords: [[32.4210, 34.7570], [32.4214, 34.7562]],
    tags: { highway: 'steps', step_count: '18' }
  },
  {
    id: 'demo-3', name: 'Apostolou Pavlou (demo)', kind: 'sidewalk',
    coords: [[32.4210, 34.7570], [32.4232, 34.7583], [32.4250, 34.7596]],
    tags: { highway: 'footway', footway: 'sidewalk', surface: 'paving_stones', smoothness: 'intermediate' }
  },
  {
    id: 'demo-4', name: 'Harbour ramp (demo)', kind: 'footway',
    coords: [[32.4214, 34.7562], [32.4232, 34.7570], [32.4250, 34.7596]],
    tags: { highway: 'footway', surface: 'concrete', incline: '4%', wheelchair: 'yes' }
  },
  {
    id: 'demo-5', name: 'Unnamed lane (demo)', kind: 'footway',
    coords: [[32.4185, 34.7568], [32.4188, 34.7590]],
    tags: { highway: 'footway' }   // deliberately untagged: this one stays grey
  },
  {
    id: 'demo-6', name: 'Kennedy Square crossing (demo)', kind: 'crossing',
    coords: [[32.4250, 34.7596], [32.4256, 34.7600]],
    tags: { highway: 'footway', footway: 'crossing', crossing: 'traffic_signals', kerb: 'raised' }
  }
];

async function main() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;

  // Refuse to touch anything that is not an emulator.
  if (!/^(127\.0\.0\.1|localhost|0\.0\.0\.0)/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
    console.error('Refusing to seed: FIRESTORE_EMULATOR_HOST does not point at a local emulator.');
    console.error('This script writes clearly-labelled demo data and must never touch a real project.');
    process.exit(1);
  }

  const { lineLengthMeters, lineMidpoint } = await shared('geo.js');
  const { assessSegment } = await shared('assess.js');
  const { normalizeObservation } = await shared('observationSchema.js');

  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'access-pafos' });
  const db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });

  const regionId = 'demo-kato-pafos';
  const now = Date.now();

  // A couple of fixture observations so the "why this score" panel has
  // something to show.
  const observationsBySegment = {
    'demo-3': [
      {
        observation: normalizeObservation({
          imageQuality: 'good',
          pedestrianPath: { visible: 'yes', condition: 'restricted' },
          curbRamp: { visible: 'no', condition: 'unknown' },
          stairs: { visible: 'no' },
          surface: { type: 'paving_stones', condition: 'uneven' },
          obstacle: { visible: 'yes', severity: 'moderate', description: 'café tables narrowing the pavement' },
          crossing: { visible: 'no', accessibleFeatures: [] },
          clearPassage: { classification: 'restricted' },
          notes: 'Demo fixture observation.'
        }),
        sourceType: 'mapillary', sourceId: 'demo-image-1',
        capturedAt: now - 200 * 86400000
      },
      {
        observation: normalizeObservation({
          imageQuality: 'medium',
          pedestrianPath: { visible: 'yes', condition: 'restricted' },
          curbRamp: { visible: 'no', condition: 'unknown' },
          stairs: { visible: 'no' },
          surface: { type: 'paving_stones', condition: 'uneven' },
          obstacle: { visible: 'yes', severity: 'minor', description: '' },
          crossing: { visible: 'not_visible', accessibleFeatures: [] },
          clearPassage: { classification: 'restricted' },
          notes: 'Demo fixture observation.'
        }),
        sourceType: 'mapillary', sourceId: 'demo-image-2',
        capturedAt: now - 190 * 86400000
      }
    ]
  };

  let written = 0;
  const batch = db.batch();

  for (const way of FIXTURE_WAYS) {
    const length = lineLengthMeters(way.coords);
    const observations = observationsBySegment[way.id] || [];
    const assessment = assessSegment({
      osmTags: way.tags,
      osmTimestamp: new Date(now - 400 * 86400000).toISOString(),
      segmentKind: way.kind,
      observations,
      now
    });

    batch.set(db.collection('segments').doc(way.id), {
      id: way.id,
      regionId,
      osmWayId: null,
      fromNode: `${way.id}-a`,
      toNode: `${way.id}-b`,
      geometry: way.coords,
      centre: lineMidpoint(way.coords),
      lengthMeters: Math.round(length * 10) / 10,
      kind: way.kind,
      streetName: way.name,
      streetNameEl: way.name,
      osmTags: way.tags,
      osmTimestamp: new Date(now - 400 * 86400000).toISOString(),
      demo: true,
      assessment: {
        status: assessment.status,
        accessibilityScore: assessment.accessibilityScore,
        evidenceConfidence: assessment.evidenceConfidence,
        freshnessState: assessment.freshnessState,
        barriers: assessment.barriers,
        positiveFeatures: assessment.positiveFeatures,
        sources: assessment.sources,
        observationCount: observations.length,
        assessmentVersion: assessment.assessmentVersion,
        classificationReason: assessment.classificationReason
      },
      imagery: { imageCount: observations.length, status: observations.length ? 'analysed' : 'not_searched' },
      importedAt: FieldValue.serverTimestamp()
    });

    batch.set(db.collection('segmentAssessments').doc(way.id), {
      segmentId: way.id, regionId, demo: true, ...assessment
    });

    observations.forEach((record, index) => {
      const id = `demo-obs-${way.id}-${index}`;
      batch.set(db.collection('observations').doc(id), {
        id,
        segmentId: way.id,
        regionId,
        sourceType: record.sourceType,
        sourceId: record.sourceId,
        observation: record.observation,
        imageQuality: record.observation.imageQuality,
        aiModel: 'demo-fixture',
        analysisVersion: '1.0.0',
        capturedAt: new Date(record.capturedAt),
        analysedAt: FieldValue.serverTimestamp(),
        status: 'active',
        demo: true,
        sourceMeta: { attribution: 'Demo fixture — not real imagery' }
      });
    });

    written += 1;
    console.log(`  ${way.id.padEnd(8)} ${assessment.status.padEnd(14)} score ${String(assessment.accessibilityScore ?? '—').padStart(4)}  confidence ${assessment.evidenceConfidence}`);
  }

  batch.set(db.collection('regions').doc(regionId), {
    id: regionId,
    name: 'Kato Pafos (demo data)',
    nameEl: 'Κάτω Πάφος (δεδομένα επίδειξης)',
    bbox: [32.4140, 34.7550, 32.4270, 34.7610],
    segmentCount: FIXTURE_WAYS.length,
    demo: true,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  batch.set(db.collection('config').doc('public'), {
    values: { DEMO_MODE: true },
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  await batch.commit();

  console.log(`\nSeeded ${written} demo segments into the emulator.`);
  console.log('DEMO_MODE is on: the app will show a visible "Demo data" badge.');
  console.log('Run "firebase emulators:start" and set VITE_USE_EMULATORS=true in .env.');
}

main().catch((error) => {
  console.error('Seeding failed:', error.message);
  process.exit(1);
});
