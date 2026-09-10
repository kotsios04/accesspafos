import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@shared': r('./shared'),
      '@src': r('./src')
    }
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.js'],
          environment: 'node'
        }
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.js'],
          environment: 'node'
        }
      },
      {
        // Component tests need a DOM. They cover the presentational layer -
        // where a template bug lives - without needing Firebase or a network.
        extends: true,
        test: {
          name: 'components',
          include: ['tests/components/**/*.test.js'],
          environment: 'happy-dom'
        }
      },
      {
        // Requires the Firestore/Storage emulators to be running:
        //   firebase emulators:start --only firestore,storage
        extends: true,
        test: {
          name: 'rules',
          include: ['tests/rules/**/*.test.js'],
          environment: 'node',
          testTimeout: 20000,
          hookTimeout: 30000
        }
      }
    ],
    coverage: {
      provider: 'v8',
      include: ['shared/**/*.js', 'functions/src/**/*.js'],
      exclude: ['functions/src/shared/**']
    }
  }
});
