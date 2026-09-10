# Responsible AI

The user-facing version is in the app at `/responsible-ai`, in English and
Greek. This document adds the reasoning and points at the code.

## The stake

This system makes claims about whether disabled people can use particular
streets. A wrong "accessible" can strand someone at a kerb they cannot get down.
That asymmetry — a false green is far worse than a false grey — shapes every
design decision below.

The system is built on the assumption that the AI will sometimes be wrong, and
arranged so that being wrong is **visible and correctable** rather than
invisible and permanent.

## What the AI does

One narrow job: look at a street-level photograph and report which physical
accessibility features are visible, in a fixed schema. That is the whole of its
role. `functions/src/ai/`.

## What it does not do

| It does not | Instead |
|---|---|
| decide the accessibility score | a deterministic formula does, from its observations |
| identify, describe or count people | it is instructed to ignore anyone in frame |
| infer disability, health, age or condition | nothing in the schema can express it |
| estimate widths or gradients numerically | it reports categories; a single uncalibrated photo cannot support numbers |
| assess legal compliance | explicitly forbidden in the prompt |
| act on a citizen report | only a human reviewer turns a report into evidence |
| produce prose the user reads as a verdict | the UI renders translated keys, not model text |

The separation is enforced three times over: the schema has no score field, the
prompt forbids grading, and the scoring engine is separate code that never sees
the model's prose.

## Uncertainty is a first-class answer

The schema requires the model to distinguish **"I can see there is none"** from
**"I cannot see"**, and `unknown` is always available.

An honest unknown keeps a segment grey, which is a useful outcome. A confident
guess would be an actively harmful one. The prompt says so in as many words:
*"An honest 'unknown' is useful to this system; a confident guess is harmful."*

Both `unknown` and `not_visible` count as saying nothing when measuring how much
evidence a segment has — so a frame that saw nothing raises no confidence. That
was a real bug, found by a test, and fixing it is why
`isEmptyObservation` checks both.

## Grey is a feature

A segment is classified only when evidence confidence reaches 45. Below that it
is reported as "not enough evidence" and drawn grey **and dashed** — colour is
never the only channel carrying meaning.

The temptation to lower that threshold, to make the map look more complete, is
real and is exactly what the project must not do. The threshold is adjustable by
a municipality, audited when changed, and the settings screen says plainly:
*"Lowering it makes the map more colourful and less honest."*

## Every claim is traceable

Tapping any street gives: the classification; the score with its arithmetic
itemised, including any ceiling a severe barrier imposed; the confidence with
each component; the age of the newest evidence; which sources contributed; the
individual image findings with their quality; links to the original Mapillary
photograph and OpenStreetMap way; and the verification history.

Nothing about a rating is hidden, including the parts that are unflattering.

## Humans outrank the machine

A municipal reviewer can **confirm**, **correct with a written reason**, or
**flag for a site visit**. A correction outranks the pipeline entirely.

Every override is recorded with who made it, when, why, and what the value was
before. The override can be cleared, handing the segment back to the engine.
The segment's classification history is preserved throughout.

The system is designed to be corrected, not defended.

## Measuring rather than asserting

No accuracy figure is published unless it has been measured against human
ground-truth labels recorded in the system, and every figure is shown with its
sample size. Below thirty labelled segments it is marked indicative only.

The validation screen suggests the **lowest-confidence** classified segments for
labelling — a sample drawn from where the system is most confident would flatter
it.

**Optimistic errors** — the system claiming a street is better than it is — are
counted and displayed separately from pessimistic ones, because they are not
equivalent failures and averaging them would hide the dangerous one.

## Bias and fairness

The evidence base has a real geographic bias: Mapillary coverage is denser on
main roads driven by contributors than in residential back streets, and OSM
accessibility tagging is uneven.

The system does not correct for this, because it cannot. What it does instead is
**make it visible**: the coverage page reports assessed versus unknown in metres
of pedestrian network, per source. A municipality can see which parts of the city
the system knows nothing about — which is itself actionable, and is the honest
alternative to quietly extrapolating.

The four mobility profiles are not variations on one model. A pram can be lifted
over a kerb but is miserable on cobbles; a 4% ramp is nothing to a pram and
significant in a manual wheelchair. The cost tables differ accordingly.

## Environmental and cost restraint

At most three frames per segment, never a whole sequence. Deduplication so
identical evidence is never analysed twice. A Flash-Lite class model, because the
task is constrained extraction and spending a thinking budget on "is there a kerb
in this picture" buys nothing. No scheduled job calls a model.

Restraint here is both a cost control and an environmental one; they happen to
point the same way.

## What this is not

AccessPafos AI provides AI-assisted accessibility intelligence. It is **not** an
accessibility audit, it has **no** regulatory standing, and it is **not**
affiliated with or endorsed by the Municipality of Pafos. That disclaimer appears
in the app, in exports, and in the published data bundle's metadata.

## Accessibility of the tool itself

An accessibility product that is not itself accessible would be a poor argument
for its own thesis. Target: WCAG 2.2 AA. Semantic HTML, visible focus, focus
traps in dialogs with Escape and focus restoration, a skip link, live regions for
route and status announcements, 46 px minimum touch targets, `prefers-reduced-motion`
and `prefers-contrast` honoured, and a redundant non-colour channel wherever
colour carries meaning — glyphs in the legend, dashes on unverified segments,
labels beside every status pill.

Full detail in [TECHNICAL_PROPOSAL.md](TECHNICAL_PROPOSAL.md#accessibility-of-the-application-itself).
