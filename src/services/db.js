/**
 * Direct Firestore reads for the console.
 *
 * Reviewer-facing lists are read straight from Firestore rather than through
 * a callable: the security rules already express exactly who may read what,
 * and adding a function in front of them would duplicate that logic in a
 * second place where it could drift. Writes always go through a callable,
 * because writes need auditing.
 */

import { getDb } from '../config/firebase.js';

async function firestore() {
  const [db, sdk] = await Promise.all([getDb(), import('firebase/firestore')]);
  return { db, ...sdk };
}

export async function listReports({ regionId, status = null, category = null, pageSize = 50, cursor = null } = {}) {
  const { db, collection, query, where, orderBy, limit, startAfter, getDocs } = await firestore();

  const clauses = [where('regionId', '==', regionId)];
  if (status) clauses.push(where('status', '==', status));
  if (category) clauses.push(where('category', '==', category));

  const constraints = [...clauses, orderBy('createdAt', 'desc'), limit(pageSize)];
  if (cursor) constraints.push(startAfter(cursor));

  const snap = await getDocs(query(collection(db, 'citizenReports'), ...constraints));
  return {
    items: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    cursor: snap.docs[snap.docs.length - 1] || null,
    done: snap.size < pageSize
  };
}

export async function listPriorityIssues({ regionId, status = null, band = null, pageSize = 100 } = {}) {
  const { db, collection, query, where, orderBy, limit, getDocs } = await firestore();
  const clauses = [where('regionId', '==', regionId)];
  if (status) clauses.push(where('status', '==', status));

  const snap = await getDocs(query(
    collection(db, 'priorityIssues'), ...clauses, orderBy('priorityScore', 'desc'), limit(pageSize)
  ));
  let items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (band) items = items.filter((i) => i.priorityBand === band);
  return items;
}

export async function getIssue(issueId) {
  const { db, doc, getDoc } = await firestore();
  const snap = await getDoc(doc(db, 'priorityIssues', issueId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** Live job progress. Returns an unsubscribe function. */
export async function watchJobs({ kind = 'ingestion', regionId, onChange, pageSize = 8 }) {
  const { db, collection, query, where, orderBy, limit, onSnapshot } = await firestore();
  const collectionName = kind === 'analysis' ? 'analysisJobs' : 'ingestionJobs';
  return onSnapshot(
    query(collection(db, collectionName),
      where('regionId', '==', regionId),
      orderBy('createdAt', 'desc'),
      limit(pageSize)),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (error) => onChange([], error)
  );
}

export async function watchJob(kind, jobId, onChange) {
  const { db, doc, onSnapshot } = await firestore();
  const collectionName = kind === 'analysis' ? 'analysisJobs' : 'ingestionJobs';
  return onSnapshot(doc(db, collectionName, jobId),
    (snap) => onChange(snap.exists() ? { id: snap.id, ...snap.data() } : null));
}

export async function listAuditLog({ pageSize = 50 } = {}) {
  const { db, collection, query, orderBy, limit, getDocs } = await firestore();
  const snap = await getDocs(query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(pageSize)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getSegment(segmentId) {
  const { db, doc, getDoc } = await firestore();
  const snap = await getDoc(doc(db, 'segments', segmentId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
