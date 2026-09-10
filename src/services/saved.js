/**
 * Saved places and routes.
 *
 * Anonymous users get device-local storage; signed-in users get Firestore,
 * under their own uid, which the security rules make owner-only. The two are
 * merged on sign-in so nothing a user saved before signing in disappears.
 */

import { getUser, isSignedIn } from './auth.js';
import { getDb } from '../config/firebase.js';
import { logError } from './errors.js';

const KEY = 'accesspafos.saved';

function readLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : { places: [], routes: [] };
  } catch {
    return { places: [], routes: [] };
  }
}

function writeLocal(value) {
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* private mode */ }
}

function makeId() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export async function listSaved(kind) {
  const collectionName = kind === 'routes' ? 'savedRoutes' : 'savedPlaces';

  if (isSignedIn()) {
    try {
      const db = await getDb();
      const { collection, getDocs, query, orderBy, limit } = await import('firebase/firestore');
      const snap = await getDocs(query(
        collection(db, 'users', getUser().uid, collectionName),
        orderBy('createdAt', 'desc'),
        limit(100)
      ));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (error) {
      logError('saved.list', error);
    }
  }

  return readLocal()[kind === 'routes' ? 'routes' : 'places'] || [];
}

export async function saveItem(kind, item) {
  const collectionName = kind === 'routes' ? 'savedRoutes' : 'savedPlaces';
  const id = item.id || makeId();
  const record = { ...item, id, createdAt: item.createdAt || Date.now() };

  if (isSignedIn()) {
    try {
      const db = await getDb();
      const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
      await setDoc(doc(db, 'users', getUser().uid, collectionName, id), {
        ...record, createdAt: serverTimestamp()
      });
      return record;
    } catch (error) {
      logError('saved.save', error);
    }
  }

  const local = readLocal();
  const bucket = kind === 'routes' ? 'routes' : 'places';
  local[bucket] = [record, ...(local[bucket] || []).filter((x) => x.id !== id)].slice(0, 100);
  writeLocal(local);
  return record;
}

export async function removeItem(kind, id) {
  const collectionName = kind === 'routes' ? 'savedRoutes' : 'savedPlaces';

  if (isSignedIn()) {
    try {
      const db = await getDb();
      const { doc, deleteDoc } = await import('firebase/firestore');
      await deleteDoc(doc(db, 'users', getUser().uid, collectionName, id));
      return true;
    } catch (error) {
      logError('saved.remove', error);
    }
  }

  const local = readLocal();
  const bucket = kind === 'routes' ? 'routes' : 'places';
  local[bucket] = (local[bucket] || []).filter((x) => x.id !== id);
  writeLocal(local);
  return true;
}

/** Push anything saved while anonymous up to the account, once, on sign-in. */
export async function migrateLocalToAccount() {
  if (!isSignedIn()) return { places: 0, routes: 0 };
  const local = readLocal();
  let places = 0;
  let routes = 0;

  for (const place of local.places || []) {
    await saveItem('places', place);
    places += 1;
  }
  for (const route of local.routes || []) {
    await saveItem('routes', route);
    routes += 1;
  }

  if (places || routes) writeLocal({ places: [], routes: [] });
  return { places, routes };
}

/** The signed-in user's own reports (readable under the security rules). */
export async function listMyReports() {
  const user = getUser();
  if (!user) return [];
  try {
    const db = await getDb();
    const { collection, getDocs, query, where, orderBy, limit } = await import('firebase/firestore');
    const snap = await getDocs(query(
      collection(db, 'citizenReports'),
      where('reporterUid', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(50)
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    logError('saved.reports', error);
    return [];
  }
}
