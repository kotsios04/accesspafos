# Data model

Firestore, region-scoped. Authoritative accessibility data is server-owned:
no client, at any role, can write it. See [SECURITY.md](SECURITY.md).

## Collections

| Collection | Written by | Read by | Purpose |
|---|---|---|---|
| `users/{uid}` | the user | owner, reviewers | preferences only — never roles |
| `users/{uid}/savedPlaces`, `savedRoutes` | the user | owner | personal lists |
| `regions/{regionId}` | server | public | pilot area, versions, import stats |
| `regions/{regionId}/nodes/{nodeId}` | server | admin | graph nodes |
| `segments/{segmentId}` | server | public | geometry, OSM tags, assessment summary |
| `segments/{id}/assessmentHistory` | server | public | classification changes over time |
| `segmentAssessments/{segmentId}` | server | public | full assessment with explanation |
| `observations/{observationId}` | server | public (citizen ones: reviewers) | one image, one analysis |
| `citizenReports/{reportId}` | citizen (create), server (review) | owner, reviewers | barrier reports |
| `verificationEvents/{eventId}` | server | reviewers | immutable verification record |
| `priorityIssues/{issueId}` | server | reviewers | municipal work queue |
| `ingestionJobs`, `analysisJobs` | server | municipality admins | job progress |
| `validationSamples/{id}` | server | reviewers | human ground-truth labels |
| `mapillaryImages/{imageId}` | server | server | imagery metadata cache |
| `pois/{id}` | server | server | public services for priority |
| `config/public` | server | public | runtime thresholds, versions |
| `auditLogs/{id}` | server | super admins | append-only privileged-action log |
| `aiUsage/{YYYY-MM-DD}` | server | municipality admins | daily spend ledger |
| `geocodeCache/{key}` | server | server | Nominatim cache |

## `segments/{segmentId}`

Identifier: `w{osmWayId}_{fromOsmNode}_{toOsmNode}` — derived from OSM, never
from insertion order, which is what makes re-import idempotent.

```jsonc
{
  "id": "w100_1_3",
  "regionId": "kato-pafos",
  "osmWayId": 100,
  "osmVersion": 9,
  "osmTimestamp": "2025-04-18T08:12:00Z",   // dates the OSM-derived evidence

  "fromNode": "n1", "toNode": "n3",
  "geometry": [[32.4160, 34.7565], [32.4185, 34.7568], [32.4210, 34.7570]],
  "centre": [32.4185, 34.7568],
  "lengthMeters": 287.8,

  "kind": "sidewalk",          // footway|sidewalk|crossing|steps|path|road_walkable…
  "side": "left",              // preserved: accessibility belongs to the pavement
  "isCarriageway": false,
  "streetName": "Poseidonos Avenue",
  "streetNameEl": "Λεωφόρος Ποσειδώνος",
  "osmTags": { "highway": "footway", "surface": "asphalt", "kerb": "lowered" },

  // Compact copy for the map bundle and admin filters. The full explanation
  // lives in segmentAssessments and is fetched only when a user opens it.
  "assessment": {
    "status": "accessible",
    "accessibilityScore": 94,
    "evidenceConfidence": 71,
    "freshnessState": "recent",
    "lastEvidenceAt": "<Timestamp>",
    "lastVerifiedAt": null,
    "barriers": [],
    "positiveFeatures": ["curb_ramp", "good_paved_surface", "tactile_paving"],
    "sources": ["osm", "mapillary"],
    "observationCount": 2,
    "assessmentVersion": "1.0.0",
    "classificationReason": "score_band"
  },

  "imagery": {
    "status": "analysed",       // not_searched | none_found | selected | analysed
    "imageCount": 2,
    "candidateCount": 41,       // how many were available before selection
    "lastSearchedAt": "<Timestamp>",
    "selected": [
      { "imageId": "123", "capturedAt": 1749081600000, "distanceMeters": 6.4,
        "compassAngle": 88, "sequenceId": "seq-a", "selectionScore": 0.81,
        "analysed": true }
    ]
  },

  "manualVerification": {
    "result": "confirmed",       // confirmed | corrected | needs_inspection
    "override": false,           // true pins the status; false only raises confidence
    "status": "accessible",
    "by": "<uid>", "byEmail": "…", "at": "<Timestamp>",
    "notes": "Checked on site 2026-08-14.",
    "photoPath": "verification/w100_1_3/photo.jpg"
  },
  "needsInspection": false
}
```

## `observations/{observationId}`

Identifier: `{sourceType}_{sourceId}_{model}_{analysisVersion}` — which makes the
document itself the cache, so a duplicate analysis cannot be written even under
a race.

**Observations are never rewritten.** Assessments are recomputed *from* them.
That is what lets the scoring weights change without losing what the system
originally saw, and what keeps a validation label meaningful months later.

```jsonc
{
  "segmentId": "w100_1_3",
  "regionId": "kato-pafos",
  "sourceType": "mapillary",     // osm | mapillary | citizen | manual | municipality
  "sourceId": "123456789",
  "dedupeKey": "mapillary::123456789::-::gemini-3.5-flash-lite::1.0.0",

  "observation": { /* the validated structured observation */ },
  "imageQuality": "good",

  "aiModel": "gemini-3.5-flash-lite",
  "aiModelVersion": "3.5-flash-lite-07-2026",
  "analysisVersion": "1.0.0",
  "capturedAt": "<Timestamp>",   // when the photo was taken
  "analysedAt": "<Timestamp>",   // when we looked at it
  "location": { "lng": 32.4185, "lat": 34.7568 },

  "sourceMeta": {
    "sequenceId": "seq-a", "compassAngle": 88, "distanceMeters": 6.4,
    "attribution": "Street-level imagery © Mapillary contributors, CC BY-SA",
    "viewerUrl": "https://www.mapillary.com/app/?pKey=123456789&focus=photo",
    "creatorUsername": "…"
  },
  "status": "active"             // active | superseded | failed
}
```

Provenance is never lost. Every claim on the map can be walked back to the
photograph or tag that produced it.

## `citizenReports/{reportId}`

```jsonc
{
  "regionId": "kato-pafos",
  "category": "blocked_sidewalk",
  "description": "Scooters across the pavement most mornings.",
  "location": { "lat": 34.7754, "lng": 32.4245 },
  "geohash": "swpjcfdv",          // cheap prefix index for "reports near here"
  "segmentId": "w100_1_3",        // matched on submission
  "segmentDistanceMeters": 4,
  "streetName": "Poseidonos Avenue",

  "photoPath": "reports/{uid}/{draftId}/photo.jpg",   // NOT public
  "hasPhoto": true,
  "reporterUid": "<uid>",         // anonymous auth is enough

  "status": "pending",            // pending|needs_review|verified|rejected|duplicate|resolved|withdrawn
  "aiAnalysis": { "observation": { }, "model": "…", "analysisVersion": "1.0.0" },
  "duplicateCandidates": [ { "id": "…", "score": 0.86, "distanceMeters": 4 } ],

  "reviewedBy": "<uid>", "reviewedAt": "<Timestamp>", "reviewNotes": "…",
  "verifiedAt": "<Timestamp>",
  "photoDeleteAfter": "<Timestamp>"   // set on rejection; cleanup job honours it
}
```

The photograph is analysed on submission **for the reviewer's benefit only**. It
touches the segment's assessment when, and only when, a human verifies the
report.

## `priorityIssues/{issueId}`

Identifier: `issue_{segmentId}` — one issue per segment, so recomputation
updates rather than accumulates.

```jsonc
{
  "segmentId": "w101_3_5",
  "priorityScore": 81,
  "priorityBand": "critical",
  "breakdown": [
    { "key": "priority.severity", "factor": 0.82, "points": 24.6, "max": 30 },
    { "key": "priority.no_accessible_alternative", "factor": 1, "points": 20, "max": 20 },
    { "key": "priority.nearby_public_services", "factor": 0.49, "points": 7.4, "max": 15,
      "detail": { "pois": [ { "class": "hospital", "distanceMeters": 120 } ] } }
  ],
  "detour": { "ratio": 2.4, "direct": 142, "detourMeters": 341 },
  "verifiedReportCount": 2,
  "manualBoost": 0,
  "status": "new",                    // new|needs_review|verified|assigned|in_progress|resolved|rejected
  "assignedDepartment": null
}
```

The breakdown is stored, not just the score, so the ranking can be argued with.

## `auditLogs/{id}`

Append-only. Every override, verification, rejection, assignment, configuration
change, role change, import and analysis run, with `previous` and `next` values.
Redacted of anything matching `token|secret|password|authorization|apikey`, and
size-bounded — audit entries are read by humans in a table.

## `aiUsage/{YYYY-MM-DD}`

```jsonc
{ "day": "2026-09-08", "limit": 500, "reserved": 340, "calls": 312, "cached": 128, "failed": 2 }
```

`reserved` is incremented **transactionally** before any model call. Cloud
Functions scale horizontally, so an in-memory counter would be per-instance —
which is to say, no limit at all.

## Cloud Storage

| Path | Access |
|---|---|
| `reports/{uid}/{reportId}/{file}` | uploader and reviewers only — never public |
| `verification/{segmentId}/{file}` | reviewers |
| `public/bundles/{regionId}/accessibility.v{n}.geojson` | public read, server write |
| `public/bundles/{regionId}/graph.v{n}.json` | server only |
| `exports/{regionId}/{timestamp}_{name}` | admins, via 30-minute signed URLs |

## Indexes

`firestore.indexes.json` declares composite indexes for every query the app
makes — reports by status and date, issues by priority, observations by segment
and capture time, segments by region and classification, jobs by region and
creation, audit by target. They are created proactively rather than discovered
through production errors.

## Deliberate absences

- **No pedestrian counts.** We do not have them for Pafos, and inventing them
  would make the priority ranking unfalsifiable.
- **No mirrored Mapillary imagery.** IDs and metadata only.
- **No client-writable role field**, anywhere.
- **No public citizen photographs.**
