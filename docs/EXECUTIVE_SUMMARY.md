# AccessPafos AI — Executive Summary

**The AI Accessibility Layer for Pafos**
Submitted to the Pafos 2.0 Innovation Competition, Municipality of Pafos.

---

## The problem

Navigation apps optimise for distance and time. They cannot answer the question
that actually decides whether a journey is possible for a wheelchair user, a
parent with a pram, an elderly resident or someone on crutches for six weeks:
**is this route usable?**

A 400-metre walk that ends at an un-ramped kerb is not a 400-metre walk. It is a
dead end, discovered on arrival. Every day, people in Pafos plan around streets
they are not sure about, take longer routes they know work, or do not go at all.

The information exists — in the shape of the kerbs, the state of the pavements,
the flights of steps down to the harbour. It has simply never been collected in
a form a routing engine can use.

## Why this has not been solved

The obvious approach is to survey the city: send people out with phones to
photograph every street. It is also why most accessibility maps cover three
neighbourhoods and then stop. The survey is expensive, it is never finished, and
the day the funding ends the data starts going stale.

## The solution

AccessPafos AI builds an accessibility layer from data that **already exists**.

The pedestrian network of Pafos is already mapped in OpenStreetMap. Thousands of
street-level photographs of Pafos already exist on Mapillary, contributed by
volunteers and by vehicles that have driven the city. Neither was collected for
accessibility purposes — but between them they contain the answer.

A vision model reads each photograph and reports, in a fixed vocabulary, what is
physically visible: is there a pavement, is there a dropped kerb, are there
steps, what is the surface, is anything in the way. A deterministic scoring
engine turns those observations, together with OpenStreetMap's own accessibility
tags, into a score, a confidence and a freshness for every stretch of pavement in
the city. The result is routable.

**Nobody has to walk every street.** Citizen reports and municipal site visits
are how the layer stays current — not how it gets built.

## What a resident gets

- A map of Pafos where every pedestrian segment is green, amber, red or **grey**.
- Routes chosen for accessibility, presented beside the shortest route so the
  trade-off is visible: *500 m, all assessed accessible* against *240 m, includes
  steps, half of it unassessed*.
- Four mobility profiles. The wheelchair profile **refuses** steps outright and
  says "no accessible route found" rather than quietly sending someone to a
  staircase.
- The evidence behind every rating: the score with its arithmetic itemised, the
  confidence and where it came from, the age of the newest photograph, and a link
  to that photograph.
- A two-tap way to report a barrier. Fully bilingual, English and Greek.

## What the Municipality gets

- A live picture of pedestrian accessibility, measured in **metres of network**,
  including — prominently — the part that is not yet known.
- A ranked repair queue where every score opens into its own breakdown: how
  severe the barrier is, whether an accessible detour exists, which public
  services sit nearby in OpenStreetMap, how many residents confirmed it.
- Citizen reports arriving already matched to a pavement segment, already
  checked for duplicates, and already analysed if they carry a photograph.
- CSV and GeoJSON exports, because public works departments live in spreadsheets
  and GIS, not in dashboards.
- A full audit trail of every override, verification and decision.

## The idea that makes it trustworthy

**Grey.**

A segment is coloured only when the evidence supports it. Below a confidence
threshold it stays grey — drawn dashed as well, so colour is never the only
signal — whatever its provisional score.

A real city has a lot of grey, and showing it is the whole point. A map that
painted uncertainty green to look complete would not be an incomplete tool; it
would be a dangerous one. Every accessibility claim here is traceable to the tag
or the photograph that produced it, and the AI never sets a score — it reports
observations, and a fixed formula does the arithmetic.

## Status

A working application, not a prototype. Vanilla JavaScript and MapLibre on
Firebase Hosting; Cloud Functions, Firestore and Genkit + Gemini behind it. 337
automated tests covering the scoring, confidence, routing and priority engines
end to end. Real OpenStreetMap ingestion, real Mapillary integration, real AI
analysis, real security rules.

Costs are bounded structurally — at most three photographs per segment, a
transactional daily budget, and a cache that means the same image is never paid
for twice — because this runs on a student's cloud account.

## Why Pafos

Pafos is the right size to finish. It has the tourism to make accessibility an
economic argument as well as a civic one, an ageing resident population, and a
historic centre where steps and cobbles are genuine obstacles rather than
hypothetical ones. The pilot area is Kato Pafos and the harbour front — the part
of the city where residents and visitors most need to know.

The architecture is region-scoped throughout. A second municipality is a bounding
box and an import job.

## What is honestly not claimed

No user numbers. No adoption figures. No accuracy percentage — the system
measures agreement against human ground-truth labels recorded inside it, reports
the sample size beside any figure, and shows nothing at all until labels exist.
No municipal endorsement. This is AI-assisted accessibility intelligence, not an
accessibility certification.

The limitations are documented rather than omitted: imagery coverage is uneven,
a photograph shows one moment, and OpenStreetMap accessibility tagging is thin in
most cities including this one. That last one is a gap this project makes
visible rather than papers over — which is itself useful to a municipality.

---

**Live demo:** _<deployment URL>_ · **Source:** _<repository URL>_
