# Cost control

This is a student competition project running on a personal Google Cloud
account. An accidental loop over a city's worth of street imagery is not a
theoretical risk — it is the single most likely way this project could go
wrong — so spending is bounded structurally rather than by care.

## Four independent limits

| Level | Limit | Where enforced |
|---|---|---|
| Per segment | 3 frames | frame selection, before anything is queued |
| Per job | `MAX_AI_ANALYSES_PER_JOB` = 200 | job creation |
| Per day | `MAX_AI_ANALYSES_PER_DAY` = 500 | transactional Firestore ledger |
| Per image | never analysed twice | deduplication key |

They are independent on purpose: any one of them failing still leaves three.

## Why the daily limit is a Firestore transaction

The obvious implementation is a counter in module scope. It would be useless.
Cloud Functions scale horizontally; ten warm instances each politely counting to
500 is a limit of 5,000.

So the ledger lives in Firestore, and a job **reserves** its budget in a
transaction before making a single model call:

```js
const { granted, remaining } = await reserveAiCalls(tasks.length);
// granted may be fewer than requested, or zero. Respect it.
const work = tasks.slice(0, granted);
```

Unspent reservations are returned when the job finishes — including when it
fails — so a crashed job does not silently consume the day's budget.

## Why the deduplication key includes the model and version

```
mapillary::123456789::-::gemini-3.5-flash-lite::1.0.0
```

The key is also the observation's document ID, which means a duplicate analysis
cannot be written even under a race: the second write lands on the same document.

Including the model and `ANALYSIS_VERSION` is what makes the cache *correct*
rather than merely cheap. Bumping `ANALYSIS_VERSION` — which happens whenever the
prompt or schema changes — correctly invalidates every cached observation,
because results from two different extraction contracts must not be pooled.

In steady state this is where nearly all the saving comes from. Recalculating a
whole region's assessments costs **nothing**: it re-derives scores from stored
observations rather than re-analysing images.

## Why three frames, not eighty

A Mapillary sequence can contain eighty near-identical frames of one street.
Analysing all eighty would cost eighty times as much and tell us almost nothing
extra.

Selection scores each candidate on proximity, recency, viewing direction and
Mapillary's own quality score, then takes a greedy spatial spread — no two chosen
frames within 12 m, and a first pass that takes at most one frame per sequence,
so the images are genuinely independent views rather than three consecutive
frames from the same car.

It is deterministic, so the estimate an administrator sees matches the run that
follows it.

## Nothing starts on its own

Bulk analysis is never triggered by a map load, a page view, a schedule or a
data change. An administrator must:

1. open `/admin/ingestion`,
2. press **Estimate cost**, which shows the exact number of model calls, the
   frames already cached, and what today's budget has left,
3. press **Start analysis**, which is labelled with that number.

A second concurrent AI job is refused outright.

## The scheduled functions spend nothing

Four run on a schedule, and none of them calls a model:

| Job | Schedule | What it does |
|---|---|---|
| `refreshFreshness` | nightly 02:30 | re-evaluates freshness states, recomputes affected regions |
| `cleanupUploads` | nightly 03:00 | deletes photographs from rejected reports past retention, and orphaned uploads |
| `weeklyPriorityRefresh` | Mondays 04:00 | re-ranks the municipal queue |
| `flagStaleRegions` | Mondays 05:00 | flags regions worth re-discovering — **flags, does not start** |

A scheduled function that re-ran AI on unchanged evidence is how a hobby project
wakes up to a four-figure bill.

## Non-AI costs

**Firestore reads.** The public map reads **one static GeoJSON bundle** from
Cloud Storage, not documents. For a few thousand segments a Firestore-backed map
would be a few thousand reads per visitor. The bundle is immutable per version,
so the browser cache absorbs repeat visits.

**Overpass.** Bounded, admin-triggered ingestion only, never from a visitor's
browser, with an identifiable User-Agent, exponential backoff, and a 25 km²
import cap.

**Nominatim.** Server-side only, on explicit submit rather than per keystroke,
rate-limited by a cross-instance Firestore token bucket, every result cached for
30 days.

**Mapillary.** Metadata only. We do not re-host imagery.

**Cloud Functions.** Routing holds the graph in instance memory keyed by
`graphVersion`, so warm instances answer with no I/O at all.

## Visibility

The console shows model calls today, cache hits today, calls this week, budget
remaining, and a 14-day history. Every analysis run is written to the audit log
with what it cost.

## Worst case

A 200-segment pilot with full imagery coverage: 200 × 3 = 600 frames. Capped at
200 per job and 500 per day, that is a two-day first pass. Every subsequent
recalculation is free.

## Tuning

`MAX_IMAGES_PER_SEGMENT`, `MAX_AI_ANALYSES_PER_JOB` and
`MAX_AI_ANALYSES_PER_DAY` are adjustable from the console, validated on the
server, and audited with their previous values. A municipality with a real
budget can raise them; the structure that keeps spending bounded does not
change.

## Tests

`tests/integration/costControl.test.js` covers frame selection (including the
eighty-frame sequence), the deduplication key's invalidation behaviour, and the
estimate arithmetic — including that one job cannot exhaust a day's budget.
