/**
 * Firebase Admin singletons.
 *
 * The Admin SDK bypasses security rules by design. That is exactly why the
 * rules can be as strict as they are: every write to authoritative data
 * happens here, behind a guard, and is audited.
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import process from 'node:process';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAuth } from 'firebase-admin/auth';

if (getApps().length === 0) {
  // Inside a Cloud Function, FIREBASE_CONFIG supplies the project and the
  // default storage bucket, so no options are needed. A local process - the
  // scripts in scripts/ - has no FIREBASE_CONFIG, and `storage.bucket()` then
  // throws "Bucket name not specified or invalid" at the moment it is first
  // used: halfway through a publish job, rather than at startup.
  // Deliberately only when FIREBASE_CONFIG is absent: `initializeApp(options)`
  // uses the object as given and does NOT merge FIREBASE_CONFIG into it, so
  // passing one inside a function would silently drop projectId. Production
  // keeps the exact call it had before.
  const localBucket = !process.env.FIREBASE_CONFIG
    && (process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET);
  initializeApp(localBucket ? { storageBucket: localBucket } : undefined);
}

export const db = getFirestore();
export const auth = getAuth();
export const storage = getStorage();
export const bucket = () => storage.bucket();
export { FieldValue, Timestamp };

// Undefined values are a common source of accidental field deletion; ignoring
// them keeps partial updates safe.
try {
  db.settings({ ignoreUndefinedProperties: true });
} catch {
  // settings() throws if called twice (e.g. on a warm instance). Harmless.
}

export const serverTimestamp = () => FieldValue.serverTimestamp();

/** Write documents in chunks that respect Firestore's 500-op batch limit. */
export async function commitInBatches(operations, chunkSize = 400) {
  let written = 0;
  for (let i = 0; i < operations.length; i += chunkSize) {
    const batch = db.batch();
    for (const op of operations.slice(i, i + chunkSize)) {
      if (op.type === 'set') batch.set(op.ref, op.data, op.options || {});
      else if (op.type === 'update') batch.update(op.ref, op.data);
      else if (op.type === 'delete') batch.delete(op.ref);
    }
    await batch.commit();
    written += Math.min(chunkSize, operations.length - i);
  }
  return written;
}
