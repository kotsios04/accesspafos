/**
 * `firebase deploy`, with the discovery timeout already set.
 *
 * The CLI loads the whole functions module graph in a subprocess to work out
 * what to deploy, and gives it ten seconds. This project has exceeded that on
 * Windows more than once, and the failure is unhelpful: "User code failed to
 * load. Cannot determine backend specification. Timeout after 10000" names a
 * loading error, not a clock, so it reads as a broken import.
 *
 * The fix has always been `FUNCTIONS_DISCOVERY_TIMEOUT`, and the problem with
 * the fix is that it is an environment variable: it lives for one shell
 * session, so it works on the deploy you set it for and is gone by the next
 * one, days later, with the same misleading error. Setting it here means it is
 * part of the command rather than part of whoever remembers it.
 *
 * A wrapper rather than an inline prefix because `FOO=bar cmd` is not valid in
 * PowerShell, which is the shell this project is deployed from, and adding
 * `cross-env` for one variable is a dependency for nothing.
 *
 * Anything passed through lands on the firebase command:
 *   node scripts/deploy.mjs --only functions
 */

import { spawn } from 'node:child_process';

const DISCOVERY_TIMEOUT_SECONDS = '120';

const child = spawn('firebase', ['deploy', ...process.argv.slice(2)], {
  stdio: 'inherit',
  // Resolves the `firebase.cmd` shim on Windows.
  shell: true,
  env: {
    ...process.env,
    // An explicit setting in the environment wins: this is a floor, not a rule.
    FUNCTIONS_DISCOVERY_TIMEOUT:
      process.env.FUNCTIONS_DISCOVERY_TIMEOUT || DISCOVERY_TIMEOUT_SECONDS
  }
});

child.on('error', (error) => {
  console.error(`Could not start the Firebase CLI: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
