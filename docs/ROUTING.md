# Routing

## The idea

A conventional pedestrian router minimises distance. This one minimises
*distance the user can actually travel*, by pricing each stretch according to
what is known about it — and by refusing outright to send a wheelchair user down
a flight of steps.

## The cost model

```
cost(edge) = length × statusMultiplier(profile, classification)
           + Σ barrier penalties, in equivalent metres
           + uncertainty penalty   (length × rate, when unassessed)
           + freshness penalty     (length × rate, when stale)
```

Everything is expressed in **equivalent metres**, so the terms are comparable and
the A* heuristic (straight-line distance) stays admissible: the multiplier is
never below 1 and the penalties are never negative, so the heuristic can never
overestimate. That is what guarantees the search returns the genuinely cheapest
route rather than merely a route.

### Classification multipliers

| Classification | Wheelchair | Reduced mobility | Stroller | Balanced |
|---|---:|---:|---:|---:|
| Accessible | 1.0 | 1.0 | 1.0 | 1.0 |
| Partial | 2.6 | 2.0 | 1.8 | 1.35 |
| Inaccessible | **refused** | 9.0 | 7.0 | 3.0 |
| Not enough evidence | 2.2 | 1.8 | 1.6 | 1.15 |

### Refusal, not discouragement

The wheelchair profile **refuses** `steps` and `wheelchair_tagged_no` outright,
and refuses any segment classified inaccessible. Not "penalises heavily" —
refuses.

This matters. With a large-but-finite penalty, a router faced with no good option
will eventually route *through* the steps, because some path is cheaper than no
path. The user gets a route, follows it, and finds a staircase. With refusal, the
router reports **"no accessible route found"** and shows the shortest walk
alongside it so the user can see exactly what stands in the way.

Saying "I cannot get you there" is a better answer than a route that does not
work, and the UI distinguishes it from "no route exists at all".

### Barrier penalties (equivalent metres)

| Barrier | Wheelchair | Reduced mobility | Stroller | Balanced |
|---|---:|---:|---:|---:|
| `steps` | refused | 400 | 350 | 90 |
| `blocking_obstacle` | 260 | 170 | 150 | 70 |
| `steep_incline` | 240 | 200 | 120 | 70 |
| `missing_curb_ramp` | 220 | 130 | 110 | 45 |
| `high_kerb` | 200 | 120 | 130 | 45 |
| `narrow_width` | 180 | 90 | 110 | 35 |
| `damaged_surface` | 140 | 120 | 100 | 45 |
| `unsuitable_surface` | 130 | 100 | 110 | 40 |
| `restricted_passage` | 150 | 90 | 90 | 35 |
| `moderate_incline` | 60 | 55 | 35 | 20 |
| `uneven_surface` | 70 | 60 | 70 | 25 |

The stroller column is not a copy of the wheelchair one. A pram can be lifted
over a kerb but is miserable on cobbles; a 4% ramp is nothing to a pram and
significant in a manual wheelchair. The differences are the point.

### Uncertainty and staleness

| Profile | Unassessed, per metre | Stale, per metre | Walking speed |
|---|---:|---:|---:|
| Wheelchair | 0.55 | 0.25 | 0.9 m/s |
| Reduced mobility | 0.40 | 0.20 | 0.8 m/s |
| Stroller | 0.30 | 0.15 | 1.05 m/s |
| Balanced | 0.12 | 0.06 | 1.2 m/s |

A wheelchair user pays more for uncertainty than a balanced walker, because the
downside of being wrong is much larger. "Prefer verified data" doubles the
uncertainty rate — an explicit choice to walk further rather than gamble.

## Three routes, always

Every request computes three options against the same graph:

| Option | Profile used | What it shows |
|---|---|---|
| **Recommended accessible** | the user's profile | the route this app would have you take |
| **Balanced** | balanced | the compromise |
| **Shortest** | pure distance | what a conventional map would give you |

The comparison *is* the product. A user seeing "500 m, all assessed accessible"
against "240 m, includes steps, 50% unassessed" understands the trade-off in a
way no single number conveys. When two options come out identical the UI says
so rather than presenting the same line twice as if it were a choice.

## Metrics reported per route

- distance, estimated time (profile-specific speed)
- length-weighted mean accessibility score and evidence confidence
- metres in each classification, as a proportional bar
- percentage unassessed, flagged prominently above 40%
- metres resting on stale evidence
- barriers on the route, with the metres each affects
- barriers *avoided* relative to the shortest route
- extra distance versus shortest, absolute and percentage
- turn-by-turn steps, each carrying the accessibility state ahead

## "Why this route?"

The engine emits translated keys and their values, never prose:

```js
{ key: 'route.reason.barriers_avoided',  values: { barriers: ['steps'] } }
{ key: 'route.reason.extra_distance',    values: { meters: 260, percent: 108 } }
{ key: 'route.reason.high_unknown',      values: { percent: 50 } }
```

Which renders, in English or Greek, as: *"It avoids: Steps. 260 m further than
the shortest route (108% more). 50% of it has not been assessed."*

## The graph

**Nodes and edges.** Nodes are OSM junctions (plus welded near-coincident
endpoints); edges are the stretches between them, carrying classification,
score, confidence, freshness and barriers.

**Bidirectional.** Every edge is traversable both ways: OSM `oneway` applies to
vehicles, not to people on foot.

**Virtual endpoints.** A route from where the user is standing, not from the
nearest junction. The snapped edge is split at the projection point and the two
halves **inherit the parent segment's accessibility attributes**, so the first
few metres are costed honestly rather than being free. When origin and
destination land on the same segment they are connected directly, so the router
does not walk someone to a junction and back.

**Cached.** Serialised to Cloud Storage per `graphVersion`, then held in Cloud
Function instance memory keyed by that version. Warm instances answer routing
requests with no I/O at all. The cached graph is never mutated by a request —
virtual endpoints are added to a clone.

## Search

Standard A* with a binary heap, straight-line-distance heuristic, and a
250,000-expansion safety valve. On a district-sized network it settles in
milliseconds.

## Failure modes, and what the user is told

| Situation | Response |
|---|---|
| Origin far from any pedestrian way | "That point is too far from any pedestrian path we have imported." |
| Destination likewise | same, for the destination |
| No path at all | "No pedestrian route could be found between those two points." |
| No path for this profile, but a walk exists | "No route was found that meets your mobility profile" — with the shortest walk shown so the barrier is visible |
| Route mostly unassessed | the route, plus a prominent caveat naming the percentage |
| Region never imported | "No pedestrian data has been imported for this area yet." |

## Navigation

Browser geolocation, requested only when the user starts navigation. The device
position is snapped to the route line; steps advance within 18 m of a manoeuvre;
leaving the line by more than 35 m raises an off-route notice with a recalculate
button. Barriers on the next step are announced ahead of time — which is the
whole reason to navigate with this app rather than a general-purpose one.

Position never leaves the browser. It is not transmitted for storage and not
logged.

The disclaimer is on screen throughout: guidance only, conditions change,
evidence can be out of date, and this is not a guarantee that a route is
passable.

## Detour ratio, for the priority engine

The same graph answers a municipal question: *how much further is it to get
round this barrier than through it?* The engine routes between the two ends of a
barrier with that segment removed. `null` — no way round at all — is the worst
case, and the priority engine treats it as such.

## Tests

`tests/unit/routing.test.js` covers the cost model, the heap, A* including the
cheapest-path property, and the three-route plan.
`tests/integration/pipeline.test.js` runs the whole thing over an OSM fixture and
asserts the product's central claim: the shortest route takes the steps, the
recommended route refuses them and is longer, and the difference is reported.
