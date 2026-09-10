# Business Model Canvas — AccessPafos AI

> No traction is claimed. There are no users, no pilots, no letters of intent and
> no partnerships. What follows is a model, and the assumptions it rests on are
> stated at the bottom so they can be tested rather than believed.

---

## Customer segments

**Primary — municipalities and local authorities.**
Small and mid-sized cities that have accessibility obligations, a public works
budget, and no systematic picture of where the problems are. Pafos is the
archetype: large enough to matter, small enough to finish.

**Secondary**
- Tourism boards and DMOs, for whom accessible-tourism information is a
  competitive asset
- University and hospital campuses, which are dense pedestrian estates with a
  legal duty and a single owner
- Airports, ports and transport interchanges
- Smart-city platform operators, as an accessibility data layer

**Users, who are not the buyer.** Wheelchair users, people with reduced mobility,
elderly residents, parents with prams, temporarily injured people, carers, and
visitors with access needs. The product must be free to them, or it does not
work.

## Value propositions

**For a municipality**
- A city-wide accessibility picture without commissioning a survey
- A ranked, explainable repair queue instead of a complaints inbox
- Evidence for accessibility funding applications, in metres and photographs
- Citizen reports arriving structured, de-duplicated and located
- Auditability: every claim traceable, every override recorded

**For a resident**
- Routes chosen for accessibility, with the trade-off against distance visible
- Honesty about what is not known, rather than a confident guess
- A two-tap way to report a barrier, in Greek or English

**For a tourism body**
- Verifiable accessible-route information, rather than a leaflet
- Accessible tourism is a growing segment and an ageing one

## Channels

- Direct to municipal accessibility officers and public works departments
- EU and national accessibility and smart-city funding programmes, where the
  procurement path already exists
- Disability organisations, who are both the strongest advocates and the harshest
  and most useful critics
- Municipal innovation competitions — including this one
- Open-source visibility; the OpenStreetMap community is a genuine channel

## Customer relationships

- Self-service for residents; no account required to use anything
- Hands-on onboarding for a municipality: import, first analysis pass, training a
  reviewer
- Ongoing: quarterly imagery refresh, threshold tuning, support
- Community: reports are the retention mechanism, and the reason the data does
  not rot

## Revenue streams

| Stream | Shape | Rationale |
|---|---|---|
| Setup | one-off, per city | ingestion, first analysis pass, configuration, training |
| Annual subscription | per city, tiered by network size | hosting, refresh, support, updates |
| Imagery refresh | per campaign | re-discovery and re-analysis after streetworks |
| Data / API access | per integration | tourism platforms, transport apps, campus systems |
| Consulting | day rate | accessibility reporting, funding applications |

**Free forever:** the citizen-facing application. A paywalled accessibility map
is a contradiction in terms.

Pricing is not proposed here. Setting a number before a single municipality has
been asked what a survey currently costs them would be guessing dressed as
analysis.

## Key resources

- The domain core — scoring, confidence, routing and priority engines, which are
  where the actual intellectual work sits
- The AI extraction pipeline and its schema
- Accumulated observations and verifications per city; this compounds
- Municipal relationships and reviewer trust
- Open data: OpenStreetMap and Mapillary — which are the foundation and are not
  owned by anyone, which is the point

## Key activities

- Region ingestion and imagery analysis
- Maintaining the scoring engine and its calibration
- Municipal onboarding and reviewer training
- Validation: measuring agreement against ground truth, honestly
- Keeping pace with Mapillary, Overpass and model APIs
- Contributing verified findings back to OpenStreetMap

## Key partnerships

- **Municipality of Pafos** — pilot, validation, and the source of the questions
  worth answering
- **OpenStreetMap community** — the data foundation, and a channel
- **Mapillary / Meta** — imagery
- **Google Cloud** — infrastructure and models
- **Disability organisations in Cyprus** — validation and advocacy
- **Universities** — student contributors, imagery capture, research

## Cost structure

| Cost | Scale |
|---|---|
| Cloud hosting and database | very low; the map is one static file per region |
| AI analysis | one-off per image, cached forever; the dominant cost is the first pass |
| Development | the main ongoing cost |
| Municipal onboarding | staff time |
| Support | staff time |

The structure is unusually favourable: **the expensive part happens once per
image, and never again**. Recalculating a whole city's assessments after a
scoring change costs nothing, because it re-derives from stored observations.
Marginal cost per additional user is essentially zero.

---

## Assumptions this model rests on

Stated so they can be tested. Every one of them could be wrong.

1. **Mapillary coverage is sufficient in target cities.** If a city has no
   imagery, the map is mostly grey and the value proposition weakens sharply.
   *Test: measure coverage before quoting.*
2. **A municipality will pay for accessibility intelligence.** Accessibility
   budgets exist but are small and often reactive.
   *Test: ask three municipalities what a pedestrian accessibility survey has
   cost them.*
3. **Reviewers will use the console.** A queue nobody works is a queue that
   decays.
   *Test: the pilot, with a named officer.*
4. **AI agreement with human ground truth is good enough to be useful.**
   Currently unmeasured. The harness exists; the labels do not.
   *Test: label 50 segments in the pilot area.*
5. **Residents will report barriers.** Civic reporting apps have famously mixed
   engagement.
   *Test: the pilot, with disability organisations involved from the start.*

## Competitive landscape

- **Google/Apple Maps** — some wheelchair-accessible venue metadata, essentially
  no pedestrian *route* accessibility. Not a competitor at street level.
- **Wheelmap** — excellent, crowdsourced, venue-focused rather than route-focused.
  A complement.
- **AccessNow, Wheelmate** — venue-focused.
- **Municipal accessibility surveys** — thorough, expensive, static, and out of
  date within a couple of years. The nearest substitute, and the honest
  comparison.
- **Academic research on street-imagery accessibility** — the closest technical
  neighbours, and mostly not deployed.

The differentiator is not the AI. It is the combination of a routable graph, an
explainable score, an honest unknown state, and a municipal workflow that closes
the loop from a resident's report to a repaired kerb.
