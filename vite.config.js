import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));
const require = createRequire(import.meta.url);

/**
 * Ship MapLibre's worker alongside the bundle.
 *
 * MapLibre spawns its worker from a URL it builds at runtime:
 *
 *   new URL('./maplibre-gl-worker.mjs', import.meta.url)
 *
 * There is no static import, so no bundler sees the dependency and the file
 * is silently left out of the build. In development this works anyway,
 * because Vite serves the real package from node_modules and the relative URL
 * resolves. In a production build the request lands on the SPA rewrite, comes
 * back as index.html, and the browser refuses it: "non-JavaScript MIME type of
 * text/html". The map then never finishes initialising, with nothing in the
 * console pointing at the cause.
 *
 * Both files keep their original names - the worker imports
 * ./maplibre-gl-shared.mjs relative to itself, so renaming either breaks the
 * pair - but they live in their own assets/maplibre/ directory rather than
 * beside the hashed chunks. That is deliberate. Everything directly under
 * assets/ is served `immutable, max-age=1 year`, which is correct for a
 * content-hashed filename and dangerous for a fixed one: while these files
 * were missing from the build, requests for them fell through to the SPA
 * rewrite, and Firebase's CDN cached that HTML under the asset path with a
 * one-year immutable lifetime. The bad entry then outlived the fix, in every
 * browser including private windows, because the poisoning was at the edge
 * rather than on any one machine.
 *
 * Their own directory gives them a cache rule of their own (see
 * firebase.json) and a cache key no previous deploy ever touched.
 */
function maplibreWorker() {
  const files = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];
  const base = '/assets/maplibre/';
  return {
    name: 'accesspafos:maplibre-worker',

    /*
     * Dev needs these too, and used not to get them.
     *
     * The plugin was build-only, so under `npm run dev` the worker URL fell
     * through to the SPA fallback and came back as index.html with a 200. The
     * worker then failed silently and the map drew nothing - which made the
     * dev server useless for the one screen most worth iterating on, and sent
     * anyone debugging it looking for a bug in the map code. Serving the same
     * two files from node_modules costs a middleware.
     */
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith(base)) return next();
        const name = req.url.slice(base.length).split('?')[0];
        if (!files.includes(name)) return next();
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.end(readFileSync(require.resolve(`maplibre-gl/dist/${name}`)));
      });
    },

    generateBundle() {
      for (const name of files) {
        this.emitFile({
          type: 'asset',
          fileName: `assets/maplibre/${name}`,
          source: readFileSync(require.resolve(`maplibre-gl/dist/${name}`))
        });
      }
    }
  };
}

export default defineConfig({
  plugins: [maplibreWorker()],
  resolve: {
    alias: {
      '@shared': r('./shared'),
      '@src': r('./src')
    }
  },
  /**
   * The app has exactly one entry. Left to itself Vite globs every .html in
   * the project to find more, which drags in `dist-preview/` and the salvaged
   * `_to_delete/node_modules-partial-linux-install/` - where an empty
   * `tslib/package.json` makes the scan throw on every dev start. Naming the
   * entry is both faster and quieter than teaching the scanner what to skip.
   */
  optimizeDeps: {
    entries: ['index.html']
  },
  server: {
    port: 5173,
    watch: {
      ignored: ['**/_to_delete/**', '**/dist-preview/**', '**/emulator-data/**']
    },
    fs: {
      // shared/ lives outside src/ but inside the project root - allow it.
      allow: [r('.')]
    }
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    // The admin bundle, the map engine and every Firebase service are lazily
    // imported, so the bundler's own splitting already keeps them out of the
    // first-paint chunk. The map engine is the one worth welding together:
    // it is a single large dependency loaded as a unit.
    //
    // Firebase is deliberately NOT forced into one chunk. Grouping it would
    // mean that importing `firebase/app` for a configuration check drags
    // Firestore, Auth and Storage onto the critical path with it.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/maplibre-gl')) return 'maplibre';
          if (id.includes('node_modules/@turf')) return 'turf';
          return undefined;
        }
      }
    },
    chunkSizeWarningLimit: 900
  }
});
