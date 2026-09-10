/**
 * Firestore security rules.
 *
 * Requires the emulators:
 *   firebase emulators:start --only firestore
 *   npm run test:rules
 *
 * These are the tests that matter most for trustworthiness. The whole design
 * rests on one claim: authoritative accessibility data is server-owned and no
 * client, however authenticated, can write it. That claim is either true in
 * these rules or it is marketing.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment, assertFails, assertSucceeds
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import {
  doc, setDoc, getDoc, updateDoc, deleteDoc, collection, addDoc, serverTimestamp
} from 'firebase/firestore';

let testEnv;

const rules = () => readFileSync(fileURLToPath(new URL('../../firestore.rules', import.meta.url)), 'utf8');

const withRole = (uid, role) => testEnv.authenticatedContext(uid, role ? { role } : {}).firestore();
const anonymous = () => testEnv.unauthenticatedContext().firestore();

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'accesspafos-rules-test',
    firestore: { rules: rules(), host: '127.0.0.1', port: 8080 }
  });
});

afterAll(async () => { await testEnv?.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seed authoritative data with rules disabled, as the server would.
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'segments', 'seg-1'), {
      regionId: 'r1', lengthMeters: 100,
      assessment: { status: 'accessible', accessibilityScore: 90 }
    });
    await setDoc(doc(db, 'segmentAssessments', 'seg-1'), { segmentId: 'seg-1', status: 'accessible' });
    await setDoc(doc(db, 'regions', 'r1'), { name: 'Test region' });
    await setDoc(doc(db, 'config', 'public'), { values: {} });
    await setDoc(doc(db, 'priorityIssues', 'issue-1'), { regionId: 'r1', priorityScore: 80 });
    await setDoc(doc(db, 'auditLogs', 'log-1'), { action: 'test' });
    await setDoc(doc(db, 'citizenReports', 'report-owned'), {
      reporterUid: 'citizen-1', regionId: 'r1', category: 'steps', status: 'pending',
      location: { lat: 34.77, lng: 32.42 }
    });
    await setDoc(doc(db, 'citizenReports', 'report-other'), {
      reporterUid: 'citizen-2', regionId: 'r1', category: 'steps', status: 'pending',
      location: { lat: 34.77, lng: 32.42 }
    });
    await setDoc(doc(db, 'observations', 'obs-osm'), { segmentId: 'seg-1', sourceType: 'mapillary' });
    await setDoc(doc(db, 'observations', 'obs-citizen'), { segmentId: 'seg-1', sourceType: 'citizen' });
    await setDoc(doc(db, 'ingestionJobs', 'job-1'), { regionId: 'r1', status: 'completed' });
    await setDoc(doc(db, 'validationSamples', 'sample-1'), { regionId: 'r1', trueStatus: 'partial' });
  });
});

// ---------------------------------------------------------------------------
describe('public reads', () => {
  it('lets anyone read segments and their assessments without signing in', async () => {
    const db = anonymous();
    await assertSucceeds(getDoc(doc(db, 'segments', 'seg-1')));
    await assertSucceeds(getDoc(doc(db, 'segmentAssessments', 'seg-1')));
    await assertSucceeds(getDoc(doc(db, 'regions', 'r1')));
    await assertSucceeds(getDoc(doc(db, 'config', 'public')));
  });

  it('lets anyone read non-citizen observations, for transparency', async () => {
    await assertSucceeds(getDoc(doc(anonymous(), 'observations', 'obs-osm')));
  });

  it('hides citizen-sourced observations from the public', async () => {
    await assertFails(getDoc(doc(anonymous(), 'observations', 'obs-citizen')));
    await assertSucceeds(getDoc(doc(withRole('rev', 'reviewer'), 'observations', 'obs-citizen')));
  });
});

// ---------------------------------------------------------------------------
describe('authoritative data is server-owned', () => {
  const attempts = [
    ['segments', 'seg-1'],
    ['segmentAssessments', 'seg-1'],
    ['observations', 'obs-osm'],
    ['priorityIssues', 'issue-1'],
    ['regions', 'r1'],
    ['auditLogs', 'log-1'],
    ['config', 'public'],
    ['verificationEvents', 'event-1'],
    ['ingestionJobs', 'job-1'],
    ['validationSamples', 'sample-1']
  ];

  for (const role of [null, 'citizen', 'reviewer', 'municipality_admin', 'super_admin']) {
    for (const [path, id] of attempts) {
      it(`refuses ${role || 'anonymous'} writing ${path}`, async () => {
        const db = role ? withRole('u1', role) : anonymous();
        await assertFails(setDoc(doc(db, path, id), { tampered: true }));
      });
    }
  }

  it('refuses a citizen rewriting a segment assessment even with valid-looking data', async () => {
    const db = withRole('citizen-1', 'citizen');
    await assertFails(updateDoc(doc(db, 'segments', 'seg-1'), {
      assessment: { status: 'accessible', accessibilityScore: 100 }
    }));
  });
});

// ---------------------------------------------------------------------------
describe('roles cannot be self-granted', () => {
  it('refuses a user writing a role onto their own profile', async () => {
    const db = withRole('citizen-1', 'citizen');
    await assertFails(setDoc(doc(db, 'users', 'citizen-1'), {
      displayName: 'Me', role: 'super_admin', createdAt: serverTimestamp()
    }));
  });

  it('refuses smuggling a role in through an update', async () => {
    const db = withRole('citizen-1', 'citizen');
    await assertSucceeds(setDoc(doc(db, 'users', 'citizen-1'), {
      displayName: 'Me', locale: 'en', createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(doc(db, 'users', 'citizen-1'), { role: 'municipality_admin' }));
    await assertFails(updateDoc(doc(db, 'users', 'citizen-1'), { isAdmin: true }));
  });

  it('refuses writing to another user’s profile', async () => {
    const db = withRole('citizen-1', 'citizen');
    await assertFails(setDoc(doc(db, 'users', 'citizen-2'), { displayName: 'Not mine' }));
  });

  it('allows a user to save their own preferences', async () => {
    const db = withRole('citizen-1', 'citizen');
    await assertSucceeds(setDoc(doc(db, 'users', 'citizen-1'), {
      displayName: 'Kotsios', locale: 'el', mobilityProfile: 'wheelchair',
      units: 'metric', createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    }));
  });
});

// ---------------------------------------------------------------------------
describe('citizen reports', () => {
  const validReport = (uid) => ({
    reporterUid: uid,
    regionId: 'r1',
    category: 'blocked_sidewalk',
    status: 'pending',
    location: { lat: 34.7754, lng: 32.4245 },
    description: 'Scooters across the pavement',
    createdAt: serverTimestamp()
  });

  it('lets a signed-in user file a report', async () => {
    const db = withRole('citizen-1', 'citizen');
    await assertSucceeds(setDoc(doc(db, 'citizenReports', 'new-1'), validReport('citizen-1')));
  });

  it('refuses an anonymous, unauthenticated write', async () => {
    await assertFails(setDoc(doc(anonymous(), 'citizenReports', 'new-2'), validReport('nobody')));
  });

  it('refuses filing a report in somebody else’s name', async () => {
    const db = withRole('citizen-1', 'citizen');
    await assertFails(setDoc(doc(db, 'citizenReports', 'new-3'), validReport('citizen-2')));
  });

  it('refuses a report that arrives pre-verified', async () => {
    const db = withRole('citizen-1', 'citizen');
    await assertFails(setDoc(doc(db, 'citizenReports', 'new-4'), {
      ...validReport('citizen-1'), status: 'verified'
    }));
  });

  it('refuses a report carrying its own AI analysis or priority', async () => {
    const db = withRole('citizen-1', 'citizen');
    await assertFails(setDoc(doc(db, 'citizenReports', 'new-5'), {
      ...validReport('citizen-1'), aiAnalysis: { observation: {} }
    }));
    await assertFails(setDoc(doc(db, 'citizenReports', 'new-6'), {
      ...validReport('citizen-1'), priorityScore: 100
    }));
  });

  it('refuses an unknown category', async () => {
    const db = withRole('citizen-1', 'citizen');
    await assertFails(setDoc(doc(db, 'citizenReports', 'new-7'), {
      ...validReport('citizen-1'), category: 'aliens'
    }));
  });

  it('refuses an out-of-range location', async () => {
    const db = withRole('citizen-1', 'citizen');
    await assertFails(setDoc(doc(db, 'citizenReports', 'new-8'), {
      ...validReport('citizen-1'), location: { lat: 999, lng: 999 }
    }));
  });

  it('refuses an over-long description', async () => {
    const db = withRole('citizen-1', 'citizen');
    await assertFails(setDoc(doc(db, 'citizenReports', 'new-9'), {
      ...validReport('citizen-1'), description: 'x'.repeat(1000)
    }));
  });

  it('lets a reporter read their own report but not somebody else’s', async () => {
    const db = withRole('citizen-1', 'citizen');
    await assertSucceeds(getDoc(doc(db, 'citizenReports', 'report-owned')));
    await assertFails(getDoc(doc(db, 'citizenReports', 'report-other')));
  });

  it('lets a reviewer read every report', async () => {
    const db = withRole('rev', 'reviewer');
    await assertSucceeds(getDoc(doc(db, 'citizenReports', 'report-owned')));
    await assertSucceeds(getDoc(doc(db, 'citizenReports', 'report-other')));
  });

  it('lets a reporter withdraw a pending report, and nothing else', async () => {
    const db = withRole('citizen-1', 'citizen');
    await assertSucceeds(updateDoc(doc(db, 'citizenReports', 'report-owned'), {
      status: 'withdrawn', updatedAt: serverTimestamp()
    }));
  });

  it('refuses a reporter marking their own report verified', async () => {
    const db = withRole('citizen-1', 'citizen');
    await assertFails(updateDoc(doc(db, 'citizenReports', 'report-owned'), { status: 'verified' }));
  });

  it('refuses a reviewer writing a review verdict directly', async () => {
    // Review must go through the audited callable, not a client write.
    const db = withRole('rev', 'reviewer');
    await assertFails(updateDoc(doc(db, 'citizenReports', 'report-owned'), { status: 'verified' }));
  });

  it('refuses deleting a report', async () => {
    await assertFails(deleteDoc(doc(withRole('citizen-1', 'citizen'), 'citizenReports', 'report-owned')));
    await assertFails(deleteDoc(doc(withRole('adm', 'super_admin'), 'citizenReports', 'report-owned')));
  });
});

// ---------------------------------------------------------------------------
describe('role-gated reads', () => {
  it('keeps priority issues away from the public', async () => {
    await assertFails(getDoc(doc(anonymous(), 'priorityIssues', 'issue-1')));
    await assertFails(getDoc(doc(withRole('c', 'citizen'), 'priorityIssues', 'issue-1')));
    await assertSucceeds(getDoc(doc(withRole('rev', 'reviewer'), 'priorityIssues', 'issue-1')));
  });

  it('keeps ingestion jobs to municipality administrators', async () => {
    await assertFails(getDoc(doc(withRole('rev', 'reviewer'), 'ingestionJobs', 'job-1')));
    await assertSucceeds(getDoc(doc(withRole('adm', 'municipality_admin'), 'ingestionJobs', 'job-1')));
  });

  it('keeps the audit log to super administrators', async () => {
    await assertFails(getDoc(doc(withRole('adm', 'municipality_admin'), 'auditLogs', 'log-1')));
    await assertSucceeds(getDoc(doc(withRole('root', 'super_admin'), 'auditLogs', 'log-1')));
  });
});

// ---------------------------------------------------------------------------
describe('personal collections', () => {
  it('lets a user manage their own saved places', async () => {
    const db = withRole('citizen-1', 'citizen');
    const ref = doc(db, 'users', 'citizen-1', 'savedPlaces', 'p1');
    await assertSucceeds(setDoc(ref, { name: 'Harbour', lat: 34.77, lng: 32.42 }));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(deleteDoc(ref));
  });

  it('refuses reading another user’s saved places', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', 'citizen-2', 'savedPlaces', 'p1'), { name: 'Theirs' });
    });
    const db = withRole('citizen-1', 'citizen');
    await assertFails(getDoc(doc(db, 'users', 'citizen-2', 'savedPlaces', 'p1')));
  });
});

// ---------------------------------------------------------------------------
describe('the default is closed', () => {
  it('refuses reads and writes to a collection the rules do not mention', async () => {
    for (const db of [anonymous(), withRole('root', 'super_admin')]) {
      await assertFails(getDoc(doc(db, 'somethingUnexpected', 'x')));
      await assertFails(setDoc(doc(db, 'somethingUnexpected', 'x'), { a: 1 }));
    }
  });
});
