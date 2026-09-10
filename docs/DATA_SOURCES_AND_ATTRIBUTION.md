# Data sources and attribution

AccessPafos AI is built almost entirely on open data. That is the point: an
accessibility layer that depended on a proprietary survey would stop the day the
survey budget ran out.

## OpenStreetMap

**What we take.** The pedestrian network — footways, pavements, crossings,
steps, paths and walkable streets — together with the accessibility tags
contributors have added: `surface`, `smoothness`, `width`, `kerb`,
`kerb:height`, `incline`, `tactile_paving`, `ramp`, `wheelchair`, `barrier`,
`sidewalk`, `step_count`, `handrail`. Also public-service points of interest for
the priority engine.

**How.** The Overpass API, for a bounded region, triggered by an administrator.
Never from a visitor's browser. `out body meta` so we also get each element's
last edit time, which is what dates our OSM-derived evidence.

**Licence.** © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/).

**Obligations we meet.** Attribution on every map view and in every export; an
identifiable User-Agent with a contact address on every Overpass request;
bounded queries with backoff; a 25 km² import cap.

**Share-alike.** Our derived accessibility assessments are a produced work built
from an ODbL database. Exports carry the OSM notice, and a municipality
redistributing a derived database should satisfy itself of its ODbL obligations
before doing so.

## Mapillary

**What we take.** Street-level photographs contributed by volunteers, companies
and public bodies. For each: the image ID, position, capture time, compass angle,
camera type, quality score and sequence ID.

**How.** Mapillary API v4 (`graph.mapillary.com`), server-side, with an OAuth
token held in Secret Manager. Bounding-box discovery is tiled to respect the
0.01°-square limit.

**Licence.** Imagery © the respective contributors, CC BY-SA.

**What we deliberately do not do.** We do **not** re-host the photographs. We
store the image ID, its metadata, and the structured observations our analysis
derives. A thumbnail is fetched at analysis time and discarded. The segment
detail sheet links to the original on Mapillary, with attribution, so a user or
reviewer can look at the actual photograph themselves.

That is a licensing decision and a product decision at once: mirroring a
CC BY-SA photo library would be neither necessary for this product nor ours to
do.

## OpenFreeMap

**What we take.** Vector basemap tiles, built from OpenStreetMap data using the
OpenMapTiles schema.

**How.** `https://tiles.openfreemap.org/styles/positron`, loaded directly by
MapLibre in the browser.

**Attribution.** OpenFreeMap, OpenMapTiles and OpenStreetMap, shown on every map
view via MapLibre's attribution control, styled to sit above the bottom
navigation rather than be hidden behind it.

Public OSM raster tiles are deliberately **not** used — the OSM Foundation's tile
servers are for the openstreetmap.org site, not as an unlimited production
service for third-party apps.

## Nominatim

**What we take.** Place search and reverse geocoding, bounded to the Pafos area.

**How, and why it looks like this.** The OSM Foundation's usage policy asks for a
few specific things, and this implementation honours each:

| Policy asks | What we do |
|---|---|
| identify yourself | User-Agent with the application and a contact address |
| no autocomplete per keystroke | search runs on explicit submit only |
| cache aggressively | every result cached 30 days |
| stay under 1 req/s | cross-instance Firestore token bucket, not an in-process timer |
| don't call from the browser | server-side only |

The provider sits behind a small interface, so a commercial geocoder can be
swapped in for a production municipal deployment without touching the UI.

## Google Gemini, via Genkit

Used only to extract structured observations from photographs, server-side, with
the key in Secret Manager. It receives an image and returns a fixed schema. No
personal data is sent. See [AI_METHODOLOGY.md](AI_METHODOLOGY.md).

## What is NOT in this system

Stated explicitly, because absences matter as much as sources:

- **No pedestrian counts or footfall estimates.** We do not have them for Pafos.
  A plausible-looking estimate would make the municipal priority ranking
  unfalsifiable, which is worse than having one fewer factor.
- **No commercial or proprietary datasets.**
- **No personal data from any third party.**
- **No official municipal accessibility survey.** If one exists, it could be
  imported as a verification source — that would be a genuine improvement.

## Attribution in the product

| Surface | Attribution shown |
|---|---|
| Every map view | OpenFreeMap · OpenMapTiles · © OpenStreetMap contributors |
| Segment detail, per image | © Mapillary contributors (CC BY-SA), with a link to the original |
| Search results | © OpenStreetMap contributors |
| `/data-sources` page | full detail, in English and Greek |
| GeoJSON exports | both notices, plus the AI-assisted disclaimer, in `metadata` |
| CSV exports | in the accompanying documentation |

## If you reuse data from this system

Carry the OpenStreetMap attribution and comply with ODbL. Carry the Mapillary
attribution for anything derived from its imagery. And carry the disclaimer:
this is AI-assisted accessibility intelligence, not an accessibility
certification.
