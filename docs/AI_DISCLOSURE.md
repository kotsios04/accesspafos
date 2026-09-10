# AI disclosure

Two different things get confused in competition submissions, so they are
separated here: AI **inside the product**, and AI **used to build it**.

---

## Part 1 — AI inside the product

### What it is

| | |
|---|---|
| Model | Google Gemini, `gemini-3.5-flash-lite` (configurable: `AI_MODEL`) |
| Framework | Genkit (`genkit`, `@genkit-ai/google-genai`) |
| Where | Cloud Functions only, server-side. The key is in Google Secret Manager. |
| Input | One street-level photograph (Mapillary thumbnail, citizen report, or municipal verification photo) |
| Output | A fixed, enumerated JSON schema of visible physical accessibility features |

### What it decides

Nothing.

The model performs **extraction**: pixels to structured facts. A deterministic
formula in `shared/scoring.js` turns facts into a score. The model never sees the
score, never produces one, and has no field in its schema that could express one.

That boundary is what makes every claim on the map reproducible, explainable and
auditable. Run the pipeline twice on the same evidence and you get the same
number.

### Constraints on the model

Enforced in the prompt, asserted by tests, and backed up by schema validation:

- never identify, describe or count people
- never infer disability, health, age or condition
- never read number plates or house numbers
- distinguish "I can see there is none" from "I cannot see"
- never guess — `unknown` is always acceptable and preferred
- no widths in metres, no gradients in percent, from an uncalibrated photograph
- no legal or regulatory compliance claims
- no score, rating or recommendation

### Where AI is *not* used

- Deciding accessibility scores or classifications
- Routing
- Municipal priority ranking
- Duplicate report detection
- Any decision affecting a citizen report, which only a human reviewer can make
- Generating any user-facing prose; the UI renders translated keys

### Human oversight

Municipal reviewers can confirm, correct or flag any classification. Corrections
outrank the pipeline and are audited with the previous value. Citizen reports
require human verification before they affect anything.

### Accuracy

No figure is published unless measured against human ground-truth labels
recorded in the system, and any figure is always shown with its sample size.
See [`evaluation/README.md`](../evaluation/README.md).

---

## Part 2 — AI tools used to build the project

Disclosed because the competition asks, and because it is the honest thing to
put in writing.

| Tool | Used for | Extent |
|---|---|---|
| **Claude (Anthropic)** | Architecture, implementation, tests, documentation | Substantial. Used as a pair-programming and drafting collaborator throughout the build. |
| _(add any others you used)_ | | |

> **Fill this in before submitting.** List every AI tool you actually used —
> ChatGPT, GitHub Copilot, Cursor, Gemini, v0, Figma AI, an image generator for
> slides, anything. Under-disclosing is the failure mode that damages a
> submission; over-disclosing costs nothing.

### What that means in practice

AI assistance was used to write code, tests and prose. It was not used to
fabricate data, results or claims. Specifically:

- Every figure the application displays is computed from the live database.
- The evaluation harness ships with **no** pre-baked accuracy numbers; its
  fixture file is explicitly marked as fixture data and refuses to be quoted as
  a measurement.
- No user counts, adoption figures, coverage claims, partnerships or
  endorsements are asserted anywhere in this repository.
- The demo script instructs the presenter to show the live application, and to
  show grey segments rather than hide them.

### Human responsibility

The design decisions — the four-state model, the confidence gate, the refusal to
let the AI score, the ceiling mechanism, the choice to make grey prominent, the
decision not to invent a footfall factor — are engineering judgements. They are
documented here so they can be argued with, and the author is answerable for
them regardless of what tools were used to express them in code.

### Verification

- 337 automated tests, run with no network access
- The full build verified end to end
- The scoring calibrations worked through explicitly and written into
  `shared/config.js` as tables, not left as unexplained constants
- Limitations documented rather than omitted
