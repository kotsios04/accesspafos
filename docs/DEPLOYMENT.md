# Deployment

Target: **Firebase project `access-pafos`** (adjust if yours differs).

## Prerequisites

- Node.js 20.19+ or 22+
- Firebase CLI: `npm install -g firebase-tools`, then `firebase login`
- A Firebase project on the **Blaze** plan — Cloud Functions 2nd generation
  requires it. The free tier still covers a project of this size; Blaze is a
  billing-account requirement, not a cost.
- Java 21+ if you want the emulators

## 1 · Firebase project setup

In the Firebase console:

**Authentication** → Sign-in method → enable **Anonymous**, **Google**, and
**Email/Password**. Anonymous is what lets someone report a barrier without
making an account.

**Firestore Database** → Create, **before you run `firebase deploy` for the
first time**, and choose the location deliberately.

> ### The one setting that will bite you
>
> If no database exists when you deploy, the CLI creates one for you **without
> asking**, and it does not pick your region — it lands in `nam5`, the US
> multi-region. Nothing warns you. The deploy then gets most of the way through
> and fails on the Firestore triggers with an Eventarc *permissions* error that
> says nothing about locations; the only clue is `locations/nam5` buried in the
> trigger path.
>
> 2nd-generation Firestore triggers are created in the database's location, and
> Eventarc only allows these pairings:
>
> | Database location | Allowed function regions |
> |---|---|
> | `nam5` | `us-central1`, `us-central2` |
> | `eur3` | `europe-west1`, `europe-west4` |
> | regional | that same region |
>
> `shared/config.js` sets `APP_REGION` to `europe-west1`, so create the database
> in **`eur3`** (or regional `europe-west1`). If you want it elsewhere, set
> `APP_REGION` to a region that pairs with it — one line, in one file, and
> everything else follows.
>
> **If you already deployed into `nam5`:** the fix is to move the database, not
> `APP_REGION`. Moving `APP_REGION` to `us-central1` relocates the whole backend
> to the US while Storage stays in Europe, and makes the EU-residency statement
> in [PRIVACY.md](PRIVACY.md#gdpr-posture) false. While the database is still
> empty this is quick and lossless:
>
> ```bash
> gcloud firestore databases delete --database="(default)" --project=<project>
> # wait ~5 minutes: the database ID cannot be reused immediately
> # then recreate it in eur3 from the console - `(default)` cannot be created
> # with gcloud - and redeploy:
> firebase deploy --only firestore,functions
> ```

**Storage** → Create, same region family.

## 2 · Configure

```bash
cp .env.example .env
```

Fill in the Firebase web config from Project settings → Your apps → Web app.
These values are public by design — they identify the project to the browser and
ship in the bundle. Access is controlled by security rules and the role guards
inside each callable, not by hiding them. See
[SECURITY.md](SECURITY.md#what-is-deliberately-not-protected-and-why-that-is-survivable)
for what that leaves open.

```
VITE_FIREBASE_API_KEY=…
VITE_FIREBASE_AUTH_DOMAIN=access-pafos.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=access-pafos
VITE_FIREBASE_STORAGE_BUCKET=access-pafos.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=…
VITE_FIREBASE_APP_ID=…
VITE_FUNCTIONS_REGION=europe-west1      # must match APP_REGION
```

Set the project:

```bash
firebase use access-pafos
```

## 3 · Secrets

Server-side credentials go to **Google Secret Manager**, never to a file, and
never with a `VITE_` prefix (that would compile them into the browser bundle).

```bash
firebase functions:secrets:set MAPILLARY_ACCESS_TOKEN
firebase functions:secrets:set GEMINI_API_KEY
```

- **Mapillary** — https://www.mapillary.com/dashboard/developers, create an
  application, copy the client token.
- **Gemini** — https://aistudio.google.com/apikey

Optional, non-secret, set as function parameters or left at their defaults:
`OVERPASS_ENDPOINT`, `NOMINATIM_ENDPOINT`, and `OSM_CONTACT_EMAIL` (Overpass and
Nominatim both ask for a contact address in the User-Agent; supplying one is
part of using their services responsibly).

**Neither secret is required to deploy.** Without them, imagery discovery and AI
analysis are unavailable and the console says exactly which secret is missing.
Everything else — OSM ingestion, scoring, routing, reporting, verification —
works.

## 3b · Storage CORS

The public map fetches one versioned GeoJSON bundle straight from Cloud
Storage. A bucket serves cross-origin browser requests only once it has a CORS
configuration; without one the fetch fails with an opaque
`TypeError: Failed to fetch` and the map shows an empty layer with nothing in
the console to explain it.

`storage.cors.json` in the repository root holds the policy. Apply it once:

```bash
gcloud storage buckets update gs://<your-bucket> --cors-file=storage.cors.json
```

Confirm it took:

```bash
gcloud storage buckets describe gs://<your-bucket> --format="value(cors_config)"
```

Add any custom domain to the `origin` list and re-apply. The policy grants
`GET` and `HEAD` only — the bundle is the sole object read this way, and it is
already public under `storage.rules`.

## 4 · Install and verify

```bash
npm install
npm --prefix functions install

npm test          # 337 tests — unit, integration and component — with no network required
npm run build     # must succeed before deploying
```

## 5 · Deploy

```bash
firebase deploy
```

Order matters, and the CLI gets it right on its own: rules and indexes first,
then functions, then hosting. To go piecemeal:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
firebase deploy --only functions
npm run build && firebase deploy --only hosting
```

The functions `predeploy` hook syncs `shared/` into `functions/src/shared/` and
parses every module before anything is uploaded, so a syntax error fails locally
rather than in production.

First function deploy takes several minutes while Cloud Build provisions.

## 6 · The first administrator

Roles are Firebase Auth **custom claims**. There is deliberately no endpoint that
grants one: it requires the Admin SDK and a service-account key, which means it
requires someone with project access, at a terminal, on purpose.

```bash
# 1. sign in once at https://<your-app>.web.app/admin/login so the user exists
# 2. put a service-account key at secrets/service-account.json (see secrets/README.md)
npm run set-admin -- --email you@example.com --role super_admin
npm run set-admin -- --list
```

Sign out and back in — the new role appears in the ID token on the next refresh
(automatic within an hour).

| Role | Can do |
|---|---|
| `citizen` | the public app; no console |
| `reviewer` | review reports, verify segments, record validation labels |
| `municipality_admin` | + ingestion, settings, exports |
| `super_admin` | + read the audit log |

## 7 · Import real data

```bash
npm run import-region -- --pilot --dry-run   # fetch, parse, report; write nothing
npm run import-region -- --pilot             # write it
```

Or from the console at `/admin/ingestion`, which also lets you draw the region
from the current map view.

Expect most segments to come out **grey**. OpenStreetMap rarely carries kerb,
surface and width tags for a whole city. That is the honest starting point, and
it is exactly what imagery analysis improves on.

## 8 · The pipeline

At `/admin/ingestion`, in order:

1. **Import OSM network** — pedestrian ways, split at junctions, first assessment
   from tags alone.
2. **Discover Mapillary imagery** — finds frames, selects at most three per
   segment. Free.
3. **Estimate cost** — shows the exact number of model calls a run would make,
   what today's budget has left, and how many frames are already cached.
4. **Start analysis** — only after reading step 3.
5. **Recalculate assessments** — re-derives every score and re-ranks priorities.
6. **Rebuild routing graph** — versions and caches it.
7. **Publish map bundle** — this is the step that makes the results public.

### Running the pipeline from the command line

The same jobs, without the console and without a deploy in front of them:

```bash
node scripts/imagery.js discover  --bbox 32.4055,34.7530,32.4260,34.7625
node scripts/imagery.js estimate  --bbox 32.4055,34.7530,32.4260,34.7625
node scripts/imagery.js analyse   --bbox 32.4055,34.7530,32.4260,34.7625 --limit 40 --yes
node scripts/imagery.js publish
```

`analyse` prints what it would spend and exits unless `--yes` is passed. Every
other command is free. Jobs created this way are written as `RUNNING` with
`runner: 'cli'` so the deployed Firestore trigger ignores them — otherwise the
same work would run twice, once locally and once in the cloud.

**Discovery is scoped to the box you give it.** Segments outside that box keep
`imagery.status: not_searched`; they are never marked `none_found`, because
nobody looked. This is why a partial run cannot quietly become a claim about
the whole region, and why `coverageRatio` in the result is reported over the
searched area rather than over every segment in the region.

## 9 · Verify the deployment

- [ ] `https://<project>.web.app` loads and the map paints
- [ ] Attribution is visible on the map (OpenStreetMap, OpenFreeMap, OpenMapTiles)
- [ ] Tapping a segment opens the evidence sheet with a "Why this score?" breakdown
- [ ] Grey segments are present and dashed — a fully-coloured map means something is wrong
- [ ] A route returns three options with different distances
- [ ] `/admin` redirects to login when signed out, and opens for a role-holder
- [ ] `/admin/coverage` shows real metres, not zeroes
- [ ] Submitting a report from a phone works and shows "waiting for review"
- [ ] `firebase functions:log` is clean

## Emulators

```bash
firebase emulators:start        # auth 9099, firestore 8080, functions 5001, storage 9199, UI 4000
npm run seed:dev                # clearly-labelled demo region; refuses non-emulator targets
# set VITE_USE_EMULATORS=true in .env
npm run dev
```

Security-rules tests:

```bash
firebase emulators:start --only firestore    # terminal 1
npm run test:rules                           # terminal 2
```

## Custom domain

Hosting → Add custom domain, follow the DNS instructions, then add the domain to
Authentication → Settings → Authorised domains, or Google sign-in will fail with
an unhelpful error.

## Rollback

```bash
firebase hosting:versions:list
firebase hosting:rollback
firebase functions:delete <name> --region europe-west1   # per function
```

Firestore has no rollback. Assessments can be recomputed from observations,
which is the reason observations are immutable.

## Costs at pilot scale

Roughly, for a 200-segment pilot region:

| Service | Expectation |
|---|---|
| Hosting | free tier |
| Firestore | free tier — the map reads one static bundle, not documents |
| Cloud Functions | free tier, aside from ingestion bursts |
| Cloud Storage | pennies |
| Gemini | ≤ 600 calls for a full first pass, then near zero — results are cached |
| Gemini, per call | ~1.8k input + ≤900 output tokens on Flash-Lite: under $0.003 even at the pessimistic end, so a capped 200-frame job is well under a euro |
| Overpass, Mapillary, Nominatim, OpenFreeMap | free, used within their policies |

The dominant cost is the first AI pass. Every subsequent recalculation is free,
because it re-derives scores from stored observations rather than re-analysing
images. See [COST_CONTROL.md](COST_CONTROL.md).

## Troubleshooting

**Functions fail to deploy with a trigger-region error** — the Firestore trigger
region does not match the database location. See the warning in step 1.

**`User code failed to load. Cannot determine backend specification. Timeout
after 10000`** — the CLI loads the whole `functions/src` graph in a subprocess
to discover the exported functions and allows it ten seconds. The graph itself
is small (≈50 modules, ~3.4s on Linux), but Windows is slower at reading many
small files and on-access antivirus scanning can double or triple that. Raise
the budget rather than chasing the code:

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT=120   # PowerShell
firebase deploy
```

```bash
FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy   # bash
```

Only treat it as a code problem if the graph has grown a heavy static import.
Check with:

```bash
node -e "const t=Date.now();import('./functions/src/index.js').catch(()=>{}).finally(()=>console.log(Date.now()-t,'ms'))"
```

Anything model- or SDK-shaped (genkit, the Google GenAI client) belongs behind a
dynamic import, so it loads when the job that needs it runs rather than on every
deploy and every cold start.

**Functions fail with `Could not create bucket gcf-v2-sources-…` (409)** — a race
on the very first deploy: several functions try to create the same source bucket
at once and all but one get a conflict. Re-run `firebase deploy --only
functions`; the bucket now exists. If it repeats, deploy one function first
(`--only functions:bootstrap`) and then the rest.

**Functions fail with `Permission denied while using the Eventarc Service
Agent`** — check the trigger path in the error. If it names a location that is
not paired with `APP_REGION` (see step 1), that is the real problem and no
amount of waiting fixes it. If the location is correct, the service agent's
permissions are still propagating on first use: wait a few minutes and re-run.

**Callables return `unauthenticated`** — the caller is not signed in. The app
signs every visitor in anonymously in the background; if that failed, check that
Anonymous is enabled under Authentication → Sign-in method.

**Callables return `permission-denied`** — the signed-in user does not hold the
role the callable requires. Run `npm run set-admin -- --list` to see the claims
that are actually set, then sign out and back in: a claim change only reaches the
ID token on its next refresh.

**Overpass returns HTML instead of JSON** — rate limiting or a query timeout. The
client detects and reports this specifically. Wait, or import a smaller area.

**The map is empty** — no bundle has been published. Run *Publish map bundle*.

**"Region has not been imported yet"** — run the OSM import first.

**Everything is grey after analysis** — check `/admin/coverage`. If imagery
coverage is low, the honest answer is that Mapillary does not cover that area
well; pick a pilot region where it does.
