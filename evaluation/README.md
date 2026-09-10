# Evaluation

Measuring whether the pipeline is any good, without asserting anything that
has not been measured.

## The principle

There is exactly one defensible way to state an accuracy figure for this
system: compare its output against labels a human produced independently, and
report the number **with its sample size**. Anything else — a plausible-looking
percentage in a slide deck, an "estimated accuracy", a figure carried over from
a paper about a different city — is a claim the project cannot support and
should not make.

So this directory contains the machinery to measure, and no pre-baked numbers.
If nobody has labelled anything, the output says so.

## What gets measured

**Status agreement** — how often the system's classification matches the
human's, over segments the system was willing to classify at all. Segments it
left grey are counted separately: refusing to guess is not a wrong answer, but
it is also not a right one, and lumping the two together would let the system
look accurate by saying nothing.

**Optimistic vs pessimistic errors** — reported separately, always. An
optimistic error is the system saying a street is *better* than it is; that is
the failure that can strand a wheelchair user at an un-ramped kerb. A
pessimistic error sends someone the long way round. They are not equivalent and
this harness never averages them together.

**Per-barrier precision and recall** — for each barrier type, how often the
system found it when it was there (recall) and how often it was right when it
claimed it (precision). This is what tells you *which* part of the pipeline is
weak, rather than only that something is.

## Collecting ground truth

Labels are recorded by municipal reviewers in the console, at
`/admin/validation`. The screen suggests the lowest-confidence classified
segments first, deliberately: a sample drawn from where the system is most
confident would flatter it.

Each label freezes the system's belief at the moment of labelling
(`predictedStatus`, `predictedScore`, `predictedConfidence`,
`assessmentVersion`), so a later recomputation cannot quietly improve a
historical score.

Export them with:

```bash
# from the municipality console: Settings -> exports, or
node evaluation/scripts/evaluate.mjs --input evaluation/fixtures/sample-labels.json
```

## Sample size

Below 30 labelled segments the harness marks its output **indicative only**,
and the console does the same. Thirty is not a magic number; it is the point
below which the confidence interval on a proportion is so wide that quoting a
percentage misleads more than it informs.

## Files

| File | What it is |
|---|---|
| `schema.json` | The shape of a labelled sample |
| `fixtures/sample-labels.json` | A small worked example, clearly marked as fixture data |
| `scripts/evaluate.mjs` | Computes the metrics; no network, no external API |

## Running it

```bash
npm run evaluate                                     # uses the fixture
npm run evaluate -- --input path/to/exported.json    # uses real labels
npm run evaluate -- --input labels.json --json       # machine-readable output
```
