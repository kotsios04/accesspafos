# Accessibility scoring

## What this is not

These weights are a **conservative pedestrian-mobility heuristic**. They are not
derived from any legal accessibility standard, they are not a compliance
assessment, and they carry no regulatory standing. Where a number below looks
authoritative, it is a considered engineering judgement, published so it can be
argued with — and every one of them is tunable by a municipality without a
redeploy.

## The pipeline

```
OSM tags        ─┐
AI observations ─┼─►  one vocabulary of barriers and positive features
verified reports─┘              │
                                ▼
                     deterministic scoring (this document)
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
                  score     confidence   freshness
                    └───────────┼───────────┘
                                ▼
                         classification
```

The AI is upstream of all of this. It reports what it sees; the arithmetic here
is what turns that into a number, and it is the same arithmetic every time.

## One vocabulary

Every source — an OSM tag, a photograph, a confirmed resident report — is
translated into the same set of identifiers before anything is scored. That is
what lets `kerb=raised` and "the model saw a kerb with no ramp" combine into one
finding rather than two.

### Barriers

| Identifier | Penalty | Score ceiling |
|---|---:|---:|
| `wheelchair_tagged_no` | 35 | 12 |
| `steps` | 45 | 18 |
| `blocking_obstacle` | 20 | 42 |
| `no_pedestrian_path` | 30 | 52 |
| `missing_curb_ramp` | 25 | 62 |
| `crossing_without_ramp` | 22 | 62 |
| `steep_incline` (>8%) | 20 | 62 |
| `high_kerb` | 20 | 64 |
| `narrow_width` (<0.9 m) | 15 | 66 |
| `damaged_surface` | 20 | 70 |
| `unsuitable_surface` | 18 | 72 |
| `restricted_passage` | 15 | 74 |
| `moderate_incline` (5–8%) | 10 | — |
| `uneven_surface` | 10 | — |

### Positive features

| Identifier | Points |
|---|---:|
| `wheelchair_tagged_yes` | 10 |
| `manually_verified` | 10 |
| `curb_ramp`, `flush_kerb` | 8 |
| `clear_path`, `good_paved_surface` | 6 |
| `accessible_crossing`, `ramp_present` | 5 |
| `tactile_paving`, `adequate_width` | 4 |

Total positive contribution is capped at **20 points**.

## The arithmetic

```
score = clamp( 100 − Σ penalties + min(Σ positives, 20) )
score = min( score, ceiling )
```

### Why penalties are scaled

Each finding carries a `weightScale` in 0…1, set by how well the evidence
supports it. A barrier that three photographs agree on gets full weight; one
that two photographs split on gets half. A penalty is `weight × weightScale`.

### Why duplicates are merged, not stacked

If OSM says `highway=steps` and a photograph shows steps, that is one flight of
steps, not two. Findings are collapsed by identifier before scoring; corroboration
from an independent source *raises* the weight (capped at 1) rather than
doubling the penalty.

### Why contradictions are resolved, not averaged

Some findings cannot both be true: `missing_curb_ramp` and `curb_ramp`,
`high_kerb` and `flush_kerb`, `narrow_width` and `adequate_width`. When both
appear, the one with stronger evidence wins and the loser is recorded as a
resolved contradiction, visible in the breakdown. On a tie the barrier wins,
because claiming less is the safer error.

### Why ceilings exist

This is the part that took the most thought.

A segment with no dropped kerb, but a beautiful asphalt surface and generous
width, scores 100 − 25 + 12 = **87** by plain arithmetic. Eighty-seven is in the
"accessible" band. And it is wrong: a pavement that ends in an un-ramped kerb is
not an accessible pavement, however pleasant the walk up to it.

So severe barriers impose a **ceiling** on the final score. Positive features add
back points, but they cannot climb over a ceiling. With the ceiling, that segment
scores **62** — partial, which is what it is.

The ceiling relaxes proportionally when the evidence is weak:

```
effectiveCeiling = 100 − (100 − ceiling) × weightScale
```

A missing ramp seen in one contested photograph caps at 81, not 62. The system
is confident in proportion to its evidence, in the ceiling as everywhere else.

## Evidence confidence

A separate number, 0–100, answering a different question: *how much should you
trust that score?*

It is deliberately **not** the model's self-reported certainty. A language
model's confidence in itself is not evidence. Confidence here is built from
things that can be checked:

| Component | Contribution |
|---|---|
| OSM structured tags | up to 65, proportional to how many relevant tags exist |
| Analysed imagery | 17 (good) / 11 (medium) / 4 (poor) per image, up to 3 images |
| Cross-image agreement | up to +15 when independent images concur |
| Cross-image conflict | up to −20 when they contradict |
| Confirmed resident reports | +6 each, capped at 12 |
| Age discount | ×1.0 recent, ×0.9 ageing, ×0.75 stale, ×0.6 undated |
| Decisive OSM tag | floor of 70 |
| On-site verification | floor of 85 |

### The two calibrations that matter

**Can OSM tags alone classify a segment?** Only when the tagging is
comprehensive and not stale:

| Tagging | Freshness | Confidence | Result |
|---|---|---:|---|
| surface only | recent | 13 | grey |
| surface + smoothness + width | recent | 33 | grey |
| + kerb, incline, tactile paving | recent | 52 | classified |
| + kerb, incline, tactile paving | ageing | 47 | classified |
| + kerb, incline, tactile paving | stale | 39 | grey |

Where a mapper has actually recorded surface, smoothness, width and kerb, they
have told us a great deal, and refusing to use it would waste the best open
accessibility data that exists.

**How many photographs does it take?**

| Imagery | Confidence | Result |
|---|---:|---|
| 1 good frame | 17 | grey |
| 2 good frames, agreeing | 49 | classified |
| 2 good frames, contradicting | 31 | grey |
| 3 good frames, agreeing | 66 | classified |
| 2 medium frames, agreeing | 37 | grey |

Line 1 is the rule that one photograph must never define a whole segment.
Line 3 is the rule that disagreement is a reason to say nothing, not a reason
to pick a side.

### The decisive-tag floor

`highway=steps` is not a hint that there might be steps. `wheelchair=no` is not
a suggestion. These are direct assertions by a mapper about the barrier itself,
so they earn a confidence floor of 70 — otherwise a genuinely known barrier
would hide behind grey, which helps nobody.

## Freshness

Reported separately from confidence, because *"we were confident about this in
2019"* is a different statement from *"we are confident about this now"*.

| State | Newest evidence |
|---|---|
| Recent | under 1 year |
| Ageing | 1–3 years |
| Out of date | over 3 years |
| No dated evidence | nothing dated at all |

Freshness discounts confidence, penalises routing cost, and is always shown next
to the capture date in the UI. A nightly scheduled function re-evaluates it, so
a segment silently crossing from "ageing" to "out of date" updates without
anyone clicking anything.

## Classification

```
if manual override        → that status,        reason: manual_override
if no evidence            → unverified,         reason: no_evidence
if confidence < 45        → unverified,         reason: insufficient_evidence
if score ≥ 80             → accessible
if score ≥ 50             → partial
otherwise                 → inaccessible
```

**The order is the product.** Confidence is checked *before* the score. A
segment scoring 100 with confidence 5 is grey, not green.

## Worked examples

**A well-mapped harbour pavement.** `surface=asphalt, smoothness=good,
width=2.4, kerb=lowered, tactile_paving=yes`, plus two good agreeing
photographs showing a clear path and a usable ramp.
No barriers → 100, positives capped at +20 but already at maximum → **100**.
Confidence: OSM 52 + imagery 34 + agreement 15 = **100** (clamped).
→ **Accessible**, high confidence, recent.

**Harbour Steps.** `highway=steps`, no imagery.
Barrier `steps` (45, ceiling 18) → **18**.
Confidence: informativeness 0.45 × 65 = 29, aged ×0.9 = 26, then the decisive-tag
floor lifts it to **70**.
→ **Inaccessible**, and correctly so, from one OSM tag.

**An untagged lane with one dark photograph.** No OSM evidence. One poor-quality
frame that saw nothing.
Confidence **2**.
→ **Grey**, reason `insufficient_evidence`. The map says "we do not know", which
is the true answer.

## Tuning

`ACCESSIBLE_THRESHOLD`, `PARTIAL_THRESHOLD`, `MIN_CONFIDENCE_TO_CLASSIFY`, the
freshness thresholds and the image cap are all adjustable from the municipality
console without a redeploy. Every change is validated (the partial threshold
cannot exceed the accessible one) and audited with its previous value, because
moving `MIN_CONFIDENCE_TO_CLASSIFY` is a policy decision about how confidently
this system is allowed to speak.

Everything else — the penalties, the ceilings, the confidence components — is
code, changed in `shared/config.js` with a version bump and a recalculation.

## Tests

`tests/unit/scoring.test.js`, `confidence.test.js`, `classify.test.js`,
`aggregate.test.js` and `assess.test.js` cover this document, including the
properties that matter most: that confidence gates classification, that a
severe barrier's ceiling holds, that duplicate findings do not stack, and that
the whole thing is deterministic.
