#!/usr/bin/env node
/**
 * Mirror `shared/` into `functions/src/shared/`.
 *
 * The domain core is the single source of truth for scoring, confidence,
 * freshness, routing and priority. The frontend imports it directly via the
 * `@shared` Vite alias. Cloud Functions cannot: `firebase deploy` only uploads
 * the `functions/` directory, so anything outside it would be missing at
 * runtime. Rather than duplicate the logic - which is exactly how a frontend
 * and a backend end up disagreeing about a score - we copy it verbatim at
 * install time and before every deploy.
 *
 * The copy is gitignored. `shared/` is the only version anybody edits.
 */

import { mkdir, readdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = join(root, 'shared');
const dest = join(root, 'functions', 'src', 'shared');

const BANNER = `// AUTO-GENERATED - DO NOT EDIT.
// Copied from /shared by scripts/sync-shared.mjs. Edit the original instead.
`;

async function copyDir(from, to) {
  await mkdir(to, { recursive: true });
  const entries = await readdir(from, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    const fromPath = join(from, entry.name);
    const toPath = join(to, entry.name);
    if (entry.isDirectory()) {
      count += await copyDir(fromPath, toPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const body = await readFile(fromPath, 'utf8');
      await writeFile(toPath, BANNER + body, 'utf8');
      count += 1;
    }
  }
  return count;
}

/**
 * Remove files in `dir` that no longer exist in `source`.
 *
 * Best-effort by design: some environments (a network share, a mounted
 * volume, a locked file) refuse deletes. A stale extra module is harmless -
 * nothing imports it - whereas failing the whole sync would block a deploy,
 * so a refused delete is reported and stepped over rather than thrown.
 */
async function prune(dir, source) {
  if (!existsSync(dir)) return { removed: 0, skipped: 0 };
  let removed = 0;
  let skipped = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = join(dir, entry.name);
    const original = join(source, entry.name);
    if (entry.isDirectory()) {
      const inner = await prune(target, original);
      removed += inner.removed;
      skipped += inner.skipped;
      continue;
    }
    if (existsSync(original)) continue;
    try {
      await rm(target, { force: true });
      removed += 1;
    } catch {
      skipped += 1;
    }
  }
  return { removed, skipped };
}

async function main() {
  if (!existsSync(src)) {
    console.error(`[sync-shared] source directory missing: ${src}`);
    process.exit(1);
  }
  const info = await stat(src);
  if (!info.isDirectory()) {
    console.error(`[sync-shared] not a directory: ${src}`);
    process.exit(1);
  }

  // Overwrite in place, then prune. Writing over the existing copy avoids
  // needing delete permission on the destination at all in the common case.
  const count = await copyDir(src, dest);
  const { removed, skipped } = await prune(dest, src);

  console.log(
    `[sync-shared] copied ${count} module(s) -> ${relative(root, dest)}` +
    (removed ? `, pruned ${removed}` : '') +
    (skipped ? `, ${skipped} stale file(s) could not be removed (harmless)` : '')
  );
}

main().catch((err) => {
  console.error('[sync-shared] failed:', err);
  process.exit(1);
});
