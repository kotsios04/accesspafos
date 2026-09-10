# Presentation outline

**12 slides, 10 minutes, plus a live demo.** The demo is the argument; the slides
frame it.

Design: one idea per slide, few words, the map does the talking. Palette from the
app — civic teal `#176B87`, and the four status colours. No stock photography of
people in wheelchairs.

---

### 1 · Title
**AccessPafos AI** — The AI Accessibility Layer for Pafos
Your name · Pafos 2.0 Innovation Competition
*Background: a screenshot of the map, green/amber/red/grey, no annotations.*

### 2 · The question nobody can answer
> "Is this route usable?"

A 400 m walk that ends at an un-ramped kerb is not a 400 m walk. It is a dead
end, discovered on arrival.

*Visual: two identical route lines, one with a photo of an un-ramped kerb at the
end.*

### 3 · Who this is for
Wheelchair users · reduced mobility · elderly residents · parents with prams ·
temporarily injured · visitors with access needs

**Say:** "Not a niche. Most of us are in this list at some point."

### 4 · Why it hasn't been solved
Survey every street → expensive, never finished, stale the year after.
Most accessibility maps cover three neighbourhoods and stop.

### 5 · The insight ★
**The data already exists.**

OpenStreetMap has the pedestrian network. Mapillary has thousands of photographs
of Pafos. Neither was collected for accessibility — between them they contain the
answer.

### 6 · How it works
```
existing data → structured AI observations → deterministic scoring → routable graph
```
One line per stage, animated in.

**Say:** "The AI reports what it sees. A fixed formula does the scoring. That
separation is the whole design."

### 7 · Four colours, and the one that matters ★★
🟢 accessible · 🟡 partial · 🔴 barrier · ⬜ **not enough evidence**

**Say:** "Grey is not a gap in the demo. Grey is the honest answer, and every
real city has a lot of it. A map that guesses green sends someone to a kerb they
can't get down."

### 8 · Every claim is traceable
*Screenshot: the "Why this score?" panel, itemised.*

Score · confidence · freshness · source · the actual photograph · human override

### 9 · The trade-off, made visible ★★★
*Screenshot: the three route options side by side.*

240 m through the steps · **500 m, entirely assessed accessible**

**Say:** "The app doesn't hide the shortest route. It shows you the cost of
avoiding the barrier and lets you decide."

### 10 · For the Municipality
Ranked repair queue with an itemised score · coverage in metres, including the
unknown · reports arriving structured and located · CSV and GeoJSON exports ·
full audit trail

### 11 · Built to be trusted
| | |
|---|---|
| AI never sets a score | deterministic engine does |
| Nothing claimed without evidence | confidence gate before classification |
| Humans override the machine | audited, with previous values |
| Costs bounded | 3 frames/segment, daily ledger, dedup cache |
| No accuracy claimed | until measured against human labels |

### 12 · What's next
Pilot in Kato Pafos with a named accessibility officer · 50 ground-truth labels
to produce a real accuracy figure · municipal imagery capture · feed verified
findings back to OpenStreetMap

**Close:** "Nobody surveyed these streets. That's what makes it work here — and
what makes it work in the next city."

---

## → Live demo (8 minutes)

Follow [DEMO_SCRIPT.md](DEMO_SCRIPT.md). Phone for the public app, laptop for the
console.

---

## Timing

| | |
|---|---|
| Slides 1–5 | 3 min |
| Slides 6–8 | 2.5 min |
| Slides 9–11 | 3 min |
| Slide 12 | 1.5 min |
| Demo | 8 min |
| Questions | 5 min |

## Delivery notes

- **Lead with the person, not the technology.** The first two minutes should
  contain no architecture.
- **Do not apologise for grey.** Present it as the strongest feature. Judges will
  test whether you believe it.
- **The evidence panel is the moment.** Slow down there.
- **Say "we don't know" out loud at least once.** It is more persuasive than any
  claim in the deck.
- **Have a number ready that you actually have**: segments imported, metres of
  network, images analysed, percentage still unknown. Never one you don't.
