# AccessPafos AI

**The AI Accessibility Layer for Pafos**

Built for the **Pafos 2.0 Innovation Competition**, organised by the Municipality of Pafos.

> AI-assisted accessibility intelligence. Not an accessibility certification, and
> not affiliated with or endorsed by the Municipality of Pafos.

---

## The problem

Navigation systems optimise for distance and time. They cannot tell a wheelchair
user whether a route is *usable* — whether the pavement ends in an un-ramped
kerb, whether a flight of steps sits between them and the harbour, whether the
one pavement on the street is blocked by parked scooters most mornings.

For a wheelchair user, a parent with a pram, an elderly resident, or someone on
crutches for six weeks, "800 m, 10 minutes" is not an answer to the question
they are actually asking.

## The approach, and why it scales

The obvious solution — send people out to survey every street — is why most
accessibility maps cover three neighbourhoods and then stop.

AccessPafos starts from data that **already exists**:

```
OpenStreetMap pedestrian network   ─┐
Mapillary street-level imagery     ─┼─► structured AI observations
                                    │        │
                                    │        ▼
citizen reports (reviewed)         ─┤   deterministic scoring engine
municipal verification             ─┘        │
                                             ▼
                              routable, colour-coded accessibility layer
```

Nobody has to walk every street. Citizen reports and site visits are how the
layer stays *current*, not how it gets built.

## The four states

| | Meaning |
|---|---|
| 🟢 **Green** | Evidence shows a usable pedestrian route |
| 🟡 **Amber** | Usable with care; something here will be a problem for some people |
| 🔴 **Red** | A severe barrier was found |
| ⬜ **Grey** | **Not enough evidence.** We do not guess. |

Grey is the important one. A real city has a lot of it, and a map that painted
it green to look complete would be worse than useless — it would be dangerous.
A segment is classified **only** when evidence confidence passes a threshold;
below it, the segment stays grey whatever its provisional score.

## What makes it defensible

Every accessibility claim is traceable to evidence. Tap any street and you get:

- the classification, and the **score with its arithmetic itemised**;
- the **confidence**, with each component that produced it;
- the **age** of the newest evidence;
- which **sources** contributed (OSM tags, which photographs, which reports);
- the individual **image findings**;
- links to the original **Mapillary photograph** and **OpenStreetMap way**;
- the **verification history**, including any municipal override.

The AI never produces the score. It extracts structured observations from
photographs; a deterministic formula turns those into a number. Run it twice on
the same evidence and you get the same answer — which is what makes
"Why this score?" a question with an answer.

---

## Architecture

| Layer | Technology |
|---|---|
| Frontend | Vanilla JavaScript ES modules, Vite, MapLibre GL JS — no framework |
| Hosting | Firebase Hosting (SPA rewrites, PWA, offline shell) |
| Backend | Cloud Functions for Firebase, 2nd generation, Node 22 ESM |
| Database | Cloud Firestore |
| Files | Cloud Storage |
| Auth | Firebase Authentication + custom-claim roles |
| AI | Genkit + Gemini (Flash-Lite class), server-side only |
| Geodata | OpenStreetMap via Overpass; Mapillary API v4; Nominatim |
| Basemap | OpenFreeMap vector tiles (OpenMapTiles schema) |
| Tests | Vitest, plus `@firebase/rules-unit-testing` |

The scoring, confidence, freshness, routing and priority engines live in
`shared/`, imported unchanged by both the browser and the Cloud Functions. The
number the map shows and the number the backend computes come from the same
lines of code, by construction.

```
shared/          domain core — pure, dependency-free, runs everywhere
src/             the public mobile-first app and the municipality console
functions/src/   Cloud Functions: ingestion, AI, scoring, routing, exports
scripts/         admin CLI: set-admin, import-region, seed-dev
tests/           unit, integration, security-rules
evaluation/      ground-truth measurement harness
docs/            architecture, methodology, deployment, submission material
```

Full detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Running it locally

### Prerequisites

- Node.js 20.19+ or 22+
- A Firebase project (Blaze plan — Cloud Functions v2 requires it)
- Java 21+ if you want the emulators

### Setup

```bash
git clone <this repository>
cd accesspafos

npm install
npm --prefix functions install

cp .env.example .env      # then fill in the Firebase web config
npm run dev               # http://localhost:5173
```

The app runs without any secrets. Without a Mapillary token and a Gemini key it
simply cannot discover imagery or analyse it — everything else, including OSM
ingestion, scoring, routing and reporting, works. The console shows a clear
warning naming the missing secret rather than failing silently.

### With the emulators

```bash
firebase emulators:start          # auth, firestore, functions, storage
npm run seed:dev                  # clearly-labelled demo region
# set VITE_USE_EMULATORS=true in .env, then:
npm run dev
```

`seed:dev` refuses to run against anything that is not a local emulator.

### Tests

```bash
npm test                    # 337 tests — unit, integration and component — with no network
npm run test:rules          # security rules (needs the Firestore emulator)
npm run evaluate            # ground-truth metrics from labelled samples
```

---

## Getting real data onto the map

```bash
# 1. import the pedestrian network for the pilot area from OpenStreetMap
npm run import-region -- --pilot --dry-run     # look before you leap
npm run import-region -- --pilot

# 2. grant yourself a municipality role
npm run set-admin -- --email you@example.com --role super_admin

# 3. open /admin/ingestion and run, in order:
#      Discover Mapillary imagery
#      Estimate cost  ->  Start analysis
#      Recalculate assessments
#      Rebuild routing graph
#      Publish map bundle
```

Step 3 is deliberately manual. The estimate tells you exactly how many model
calls a run will make before the button does anything.

---

## Deployment

```bash
firebase use <your-project>

# secrets go to Secret Manager, never to a file
firebase functions:secrets:set MAPILLARY_ACCESS_TOKEN
firebase functions:secrets:set GEMINI_API_KEY

npm run build
firebase deploy
```

Step-by-step, including Firestore location and the first admin:
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## Cost control

This is a student project on a personal Google Cloud account, and the design
takes that seriously. AI spend is bounded at four independent levels:

1. **Per segment** — at most 3 well-chosen frames, never a whole sequence.
2. **Per job** — `MAX_AI_ANALYSES_PER_JOB`.
3. **Per day** — `MAX_AI_ANALYSES_PER_DAY`, enforced by a transactional
   Firestore ledger rather than an in-memory counter (Cloud Functions scale
   out; an in-memory counter is no limit at all).
4. **Per image** — a deduplication key over source, model and analysis version,
   so identical evidence is never paid for twice.

Bulk analysis never starts automatically. See [`docs/COST_CONTROL.md`](docs/COST_CONTROL.md).

---

## Documentation

**Engineering**
[Architecture](docs/ARCHITECTURE.md) ·
[Data model](docs/DATA_MODEL.md) ·
[Deployment](docs/DEPLOYMENT.md) ·
[Security](docs/SECURITY.md) ·
[Cost control](docs/COST_CONTROL.md)

**Method**
[AI methodology](docs/AI_METHODOLOGY.md) ·
[Accessibility scoring](docs/ACCESSIBILITY_SCORING.md) ·
[Routing](docs/ROUTING.md) ·
[Data sources & attribution](docs/DATA_SOURCES_AND_ATTRIBUTION.md)

**Governance**
[Responsible AI](docs/RESPONSIBLE_AI.md) ·
[Privacy](docs/PRIVACY.md) ·
[AI disclosure](docs/AI_DISCLOSURE.md)

**Competition**
[Executive summary](docs/EXECUTIVE_SUMMARY.md) ·
[Technical proposal](docs/TECHNICAL_PROPOSAL.md) ·
[Business model canvas](docs/BUSINESS_MODEL_CANVAS.md) ·
[Demo script](docs/DEMO_SCRIPT.md) ·
[Presentation outline](docs/PRESENTATION_OUTLINE.md) ·
[Video script](docs/VIDEO_DEMO_SCRIPT.md) ·
[Submission checklist](docs/SUBMISSION_CHECKLIST.md)

---

## Attribution

- Pedestrian network and points of interest: **© OpenStreetMap contributors**, [ODbL](https://www.openstreetmap.org/copyright)
- Street-level imagery: **© Mapillary contributors**, CC BY-SA
- Basemap tiles: **OpenFreeMap** / **OpenMapTiles**, from OpenStreetMap data
- Place search: **Nominatim**, OpenStreetMap Foundation

Anything exported from this system carries both the OSM and Mapillary notices.

## Limitations

Stated plainly, because a system that makes accessibility claims owes people
its failure modes:

- Street-level imagery is uneven. Streets without it stay grey.
- A photograph is one moment. A pavement clear in 2024 may be blocked today.
- Widths and gradients cannot be measured from an uncalibrated photograph, so
  the system reports categories, never numbers.
- OpenStreetMap accessibility tagging is thin in most cities, Pafos included.
  This project surfaces that gap rather than papering over it.
- No accuracy figure is published unless it has been measured against human
  ground truth recorded in the system, and it is always shown with its sample
  size.
- This is not an accessibility audit and carries no regulatory standing.

## Licence

MIT for the source code. Data carries the licences of its sources above.
