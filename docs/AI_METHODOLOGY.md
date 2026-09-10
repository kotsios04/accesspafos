# AI methodology

## The one-sentence version

A vision model looks at a street photograph and reports, in a fixed schema, which
physical accessibility features are visible. It does nothing else — and in
particular it does not decide whether the street is accessible.

## Why the model is not allowed to score

The temptation is obvious: show a model a photograph, ask "how accessible is
this, out of 100", and put the number on a map. It would work, in the sense that
numbers would come out.

It would also be indefensible. The number would not be reproducible, it could
not be explained, it could not be audited, and it would drift whenever the model
changed underneath us. "Why is this street amber?" would have no answer beyond
"the model said so".

So the model is confined to **extraction**: it converts pixels into structured
facts. A deterministic formula converts facts into a score. That boundary is
what makes every claim on the map traceable, and it is enforced in three places —
the schema has no score field, the prompt forbids grading, and the scoring engine
is separate code that never sees the model's prose.

## Model

| | |
|---|---|
| Model | `gemini-3.5-flash-lite`, pinned (configurable: `AI_MODEL`) |
| Framework | Genkit (`genkit`, `@genkit-ai/google-genai`) |
| Temperature | 0.1, dropping to 0 on the retry |
| Max output | 900 tokens |
| Thinking budget | ceiling of 128 tokens (`AI_THINKING_CONFIG`); measured spend is 0 |
| Where it runs | Cloud Functions only. The key is in Secret Manager and never reaches a browser. |

A Flash-Lite class model is a deliberate choice, not a compromise. The task is
constrained structured extraction over a small vocabulary — not open-ended
reasoning — and this is a cost-sensitive project. Spending on a thinking budget
for "is there a kerb in this picture" buys nothing.

### Why the version is pinned

The model name is recorded as the provenance of every observation and forms
part of the key that decides whether a cached observation may be reused. A
moving alias such as `gemini-flash-lite-latest` cannot serve either purpose: it
names a different model over time, so "produced by
`gemini-flash-lite-latest`" is not a reproducible claim, and because the key
does not change when the alias moves, observations made by the old model would
continue to be reused as though the new one had made them.

Both failure modes stopped being hypothetical on 9 September 2026, when the
alias moved to a model that rejected the project's thinking configuration and
the previous pinned model was withdrawn from the API entirely. The model is now
an explicit version, changing it is a deliberate edit, and each observation also
stores `aiModelVersion` — the version string the API reported for the model that
actually served the request, so provenance is recorded rather than assumed.

## Input

Images are downloaded and inlined as base64 data URLs rather than passed as
remote links. That keeps the request deterministic, works identically for
Mapillary thumbnails and Cloud Storage objects, and means a signed URL that
expired between discovery and analysis fails loudly instead of quietly producing
a blank observation.

Sources: Mapillary thumbnails (1024 px), citizen report photographs, municipal
verification photographs. Maximum 6 MB, JPEG/PNG/WebP only.

## Output schema

Strict, enumerated, and derived from a single shared vocabulary
(`shared/observationSchema.js`) so the Zod schema at the model boundary and the
validator downstream cannot drift apart. A test asserts the schema hard-codes no
enum literals of its own.

```jsonc
{
  "imageQuality":   "good | medium | poor",
  "pedestrianPath": { "visible": "yes|no|not_visible|unknown",
                      "condition": "clear|restricted|blocked|unknown" },
  "curbRamp":       { "visible": "yes|no|not_visible|unknown",
                      "condition": "usable|damaged|unknown" },
  "stairs":         { "visible": "yes|no|not_visible|unknown" },
  "surface":        { "type": "paved|paving_stones|gravel|dirt|other|unknown",
                      "condition": "good|uneven|damaged|unknown" },
  "obstacle":       { "visible": "yes|no|not_visible|unknown",
                      "severity": "none|minor|moderate|blocking|unknown",
                      "description": "≤140 chars" },
  "crossing":       { "visible": "yes|no|not_visible|unknown",
                      "accessibleFeatures": ["marked_crossing", "traffic_signals",
                                             "tactile_paving", "dropped_kerb",
                                             "refuge_island", "audible_signal"] },
  "clearPassage":   { "classification": "clear|restricted|blocked|unknown" },
  "uncertainFindings": ["≤6 short strings"],
  "notes": "≤240 chars"
}
```

### "no" versus "not_visible"

The single most important distinction in the schema, and the one the prompt
spends the most words on.

- **`no`** — I can see the thing is absent. I can see the kerb clearly and there
  is no ramp cut into it.
- **`not_visible`** — the view is blocked, dark, too distant or ambiguous.

`no` is evidence of a barrier. `not_visible` is evidence of nothing. Collapsing
them would turn every obstructed photograph into a false accessibility claim,
which is precisely the failure mode this system exists to avoid.

Both are treated as non-informative when counting how much evidence a segment
has, so a frame that saw nothing raises no confidence.

## System instruction

The full text is in `functions/src/ai/prompt.js` and asserted by
`tests/integration/schemaContract.test.js`. Its constraints:

1. **Never identify, describe or count people.** Ignore anyone in frame entirely.
2. **Never infer disability, health, age or condition.**
3. **Do not read number plates or house numbers.**
4. **Distinguish "not visible" from "no".**
5. **Never guess.** "unknown" is always acceptable and strongly preferred. An
   honest unknown is useful to this system; a confident guess is harmful.
6. **No widths in metres, no gradients in percent, no kerb heights in
   centimetres.** A single uncalibrated photograph cannot support those numbers.
7. **No legal or regulatory compliance claims.**
8. **Invent nothing** that is not in the image.
9. **No score, rating or recommendation.**
10. If the image is unusable — blur, night, lens obstruction, pointing at the
    sky — say `imageQuality: poor` and leave the rest unknown.

Context about the segment (its OSM kind, street name, camera distance) is
supplied because it genuinely helps focus the analysis. It is phrased as
context that *may be wrong or out of date*, with an explicit instruction to
report only what is visible, so it cannot become a self-fulfilling prophecy.

## Defence in depth

The model is not trusted. Four independent layers stand between its output and
the map:

1. **Genkit + Zod** constrain generation at the model boundary.
2. **`normalizeObservation`** coerces anything unrecognised to `unknown` and
   drops unknown crossing features, extra fields and over-long text. Garbage in
   produces a valid, uninformative observation — never a plausible invention.
3. **`validateObservation`** re-checks the normalised result. A malformed
   observation is discarded, never patched up.
4. **The scoring engine** ignores any finding it has no configured weight for.

On a schema failure the call is retried **once** with a sterner instruction and
temperature 0. A second failure is recorded as a failed observation — which also
stops the same broken image being retried in a loop — and the segment simply has
one less piece of evidence.

## Aggregation across images

One photograph must never define a segment. That rule is enforced in two ways:

**Through confidence.** A single frame contributes 17 points, well below the
classification threshold of 45. Two agreeing good frames reach 49 and classify.

**Through weighting.** For each feature, informative answers are counted and the
majority wins, with the finding's weight set to the level of agreement. Half the
images saying "damaged" and half saying "good" yields a *damaged* finding at
half weight — and lowers confidence, often enough to keep the segment grey.

**Ties break toward the worse reading.** An even split between "good surface" and
"damaged surface" resolves to damaged. Resolving it the other way would let the
system claim an accessibility property it has no majority evidence for.

## Frame selection

Analysing every frame of a Mapillary sequence would cost eighty times as much and
tell us almost nothing extra. At most three frames per segment are chosen, scored
on:

| Factor | Weight | Rationale |
|---|---:|---|
| Proximity to the segment | 35% | 1.0 at the kerb, 0 at 22 m |
| Recency | 30% | full marks under a year, decaying to zero at eight |
| Viewing direction | 20% | along or across the segment, not away from it |
| Mapillary quality score | 15% | when the API provides one |

Then a greedy spatial spread: no two chosen frames within 12 m, and a first pass
that takes at most one frame per sequence, so the images are genuinely
independent views rather than three consecutive frames from the same car.

Panoramas are skipped — the prompt is not calibrated for 360° geometry.

Selection is deterministic, so the cost estimate an administrator sees matches
the run that follows it.

## What we never do

- Analyse imagery automatically on map load, or on any schedule.
- Re-analyse an image already analysed by the same model and analysis version.
- Store or re-host Mapillary photographs. We keep the image ID, its metadata and
  our derived observations.
- Send any personal data to the model.
- Let the model's output reach a user without passing through the scoring engine.

## Measuring it

No accuracy figure is published unless it has been measured against human
ground-truth labels recorded in the system, and every figure is shown with its
sample size. Below thirty labelled segments the output is marked indicative only.

Optimistic errors — the system claiming a street is *better* than it is — are
counted and displayed separately, because those are the failures that can strand
someone at a kerb.

See [`evaluation/README.md`](../evaluation/README.md).

## Versioning

`ANALYSIS_VERSION` is bumped whenever the prompt, the schema or the extraction
semantics change. It is part of the deduplication key, so a bump correctly
invalidates every cached observation rather than mixing results from two
different contracts. Observations always record the model and version that
produced them.
