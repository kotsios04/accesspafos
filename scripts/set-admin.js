#!/usr/bin/env node
/**
 * Grant or revoke a municipality role.
 *
 *   npm run set-admin -- --email someone@pafos.gov.cy --role municipality_admin
 *   npm run set-admin -- --uid abc123 --role reviewer
 *   npm run set-admin -- --email someone@pafos.gov.cy --revoke
 *   npm run set-admin -- --list
 *
 * Roles live in Firebase Auth custom claims and are readable by the security
 * rules as `request.auth.token.role`. There is deliberately NO endpoint that
 * grants a role: it requires the Admin SDK and a service-account key, which
 * means it requires someone with access to the project, at a terminal, on
 * purpose. A self-service "make me an admin" call is exactly the hole this
 * design closes.
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS (see secrets/README.md) or
 * `gcloud auth application-default login`.
 */

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const ROLES = ['citizen', 'reviewer', 'municipality_admin', 'super_admin'];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i += 1; }
  }
  return args;
}

function loadEnv() {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key]) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, '');
  }
}

function initAdmin() {
  loadEnv();
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;

  if (keyPath && existsSync(resolve(process.cwd(), keyPath))) {
    const serviceAccount = JSON.parse(readFileSync(resolve(process.cwd(), keyPath), 'utf8'));
    return initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
  }
  if (!projectId) {
    console.error('Set FIREBASE_PROJECT_ID in .env, or point GOOGLE_APPLICATION_CREDENTIALS at a service-account key.');
    process.exit(1);
  }
  return initializeApp({ credential: applicationDefault(), projectId });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) { usage(); return; }

  initAdmin();
  const auth = getAuth();
  const db = getFirestore();

  if (args.list) {
    console.log('Users holding a municipality role:\n');
    let pageToken;
    let found = 0;
    do {
      const page = await auth.listUsers(1000, pageToken);
      for (const user of page.users) {
        const role = user.customClaims?.role;
        if (role && role !== 'citizen') {
          console.log(`  ${role.padEnd(20)} ${user.email || '(no email)'}  ${user.uid}`);
          found += 1;
        }
      }
      pageToken = page.pageToken;
    } while (pageToken);
    if (!found) console.log('  (none yet)');
    return;
  }

  if (!args.email && !args.uid) { usage(); process.exit(1); }

  const user = args.uid
    ? await auth.getUser(args.uid)
    : await auth.getUserByEmail(args.email);

  const previous = user.customClaims?.role || 'citizen';

  if (args.revoke) {
    await auth.setCustomUserClaims(user.uid, { ...user.customClaims, role: 'citizen' });
    await audit(db, user, previous, 'citizen');
    console.log(`Revoked. ${user.email || user.uid} is now: citizen`);
    console.log('They must sign out and back in (or wait up to an hour) for the change to take effect.');
    return;
  }

  const role = args.role;
  if (!ROLES.includes(role)) {
    console.error(`--role must be one of: ${ROLES.join(', ')}`);
    process.exit(1);
  }

  await auth.setCustomUserClaims(user.uid, { ...user.customClaims, role });
  await audit(db, user, previous, role);

  console.log(`${user.email || user.uid}`);
  console.log(`  ${previous}  ->  ${role}`);
  console.log('\nThe user must sign out and back in for the new role to appear in their ID token.');
  console.log('(Tokens refresh automatically within an hour otherwise.)');
}

async function audit(db, user, previous, next) {
  await db.collection('auditLogs').add({
    actorUid: 'cli',
    actorRole: 'super_admin',
    actorEmail: process.env.USER || process.env.USERNAME || 'cli',
    action: 'role.changed',
    targetType: 'user',
    targetId: user.uid,
    previous: { role: previous, email: user.email || null },
    next: { role: next },
    context: { via: 'scripts/set-admin.js' },
    createdAt: FieldValue.serverTimestamp()
  });
}

function usage() {
  console.log(`
Set a municipality role on a Firebase Auth user.

  npm run set-admin -- --email <address> --role <role>
  npm run set-admin -- --uid <uid> --role <role>
  npm run set-admin -- --email <address> --revoke
  npm run set-admin -- --list

Roles (increasing privilege):
  citizen             the default; no console access
  reviewer            review reports, verify segments, record validation labels
  municipality_admin  everything above, plus ingestion, settings and exports
  super_admin         everything above, plus reading the audit log

Credentials: GOOGLE_APPLICATION_CREDENTIALS in .env, or
             gcloud auth application-default login
`);
}

main().catch((error) => {
  console.error('\nFailed:', error.message);
  if (error.code === 'auth/user-not-found') {
    console.error('That user has not signed in yet. Ask them to sign in once at /admin/login first.');
  }
  process.exit(1);
});
