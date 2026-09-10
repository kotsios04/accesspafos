# Demo script

**Eight minutes.** Live application, real data, no slides until the end.

Preparation: pilot region imported, imagery analysed, bundle published, a
municipality role on your account, phone and laptop both ready and signed in.

---

## 0 · Before you start (30 s, while the page loads)

> "AccessPafos is an accessibility layer for Pafos, built from data that already
> exists. Nobody surveyed these streets for us. I'll show you the app, and then
> I'll show you the part most demos hide — the part where it says it doesn't
> know."

---

## 1 · Home (30 s) — *on the phone*

Open the deployed URL on the phone, screen mirrored.

> "Move through Pafos with confidence. Routes chosen not only for distance, but
> for accessibility."

Scroll to the coverage figures.

> "These come from the live database. Assessed network, barriers found, and —
> this one matters — how much we don't know yet."

---

## 2 · The map (60 s)

Tap **Explore the accessibility map**.

> "Every pedestrian segment in the pilot area. Green is accessible, amber is
> partial, red is a barrier, grey is not enough evidence."

Zoom to the harbour.

> "Notice the grey is dashed as well as grey. Colour is never the only signal —
> that matters if you have a colour vision deficiency or you're outside in
> Cypriot sunlight."

---

## 3 · A green segment: the evidence (90 s) ★

Tap a **green** segment.

> "Score 94, confidence 71, evidence from last June."

Open **Why this score?**

> "This is the part I'd ask you to judge the project on. It starts at 100. Every
> adjustment is listed, with which source produced it. Below that, how the
> confidence was reached — OpenStreetMap tags, two analysed photographs, and the
> fact that they agreed with each other."

Scroll to the image findings, tap through to Mapillary.

> "And that's the actual photograph. Anyone can check our work."

> "The AI did not produce that 94. It reported what it saw — a clear path, a
> usable dropped kerb, a paved surface in good condition. A fixed formula did the
> arithmetic. Run it again on the same evidence and you get 94 again."

---

## 4 · A grey segment: the honest part (60 s) ★★

Tap a **grey** segment. Pause on it.

> "This one is grey. Not because it's bad — because we don't have enough evidence
> to say. Confidence 22, and we only classify above 45."

> "Most demos would have painted this green. A map that guesses green sends a
> wheelchair user to a kerb they can't get down. Grey is the honest answer, and
> there's a lot of it in any real city. Showing it is the whole point."

---

## 5 · The route comparison (120 s) ★★★

Route tab. Origin at the harbour, destination past the steps. Profile:
**Wheelchair**. Calculate.

Three options appear.

> "Shortest: 240 metres, three minutes. It goes down the harbour steps, and half
> of it hasn't been assessed."

> "Recommended: 500 metres, nine minutes, entirely assessed as accessible."

Tap the recommended route, open **Why this route?**

> "It avoids: steps. 260 metres further — 108% more. That's the trade-off, stated
> plainly, so the person decides rather than the app deciding for them."

Switch the profile to **Balanced**, recalculate.

> "Different profile, different answer. And the wheelchair profile doesn't just
> dislike steps — it refuses them. If there were no way round, it would say 'no
> accessible route found' and show you what's in the way, rather than quietly
> routing you into a staircase."

Open the step-by-step list.

> "Turn-by-turn, with what's ahead on each step. That's the reason to navigate
> with this rather than a general-purpose map."

---

## 6 · Reporting (45 s) — *on the phone*

Tap **Report a barrier**. Category → location → photo.

> "Three taps. No account needed. The map moves under a fixed pin, which is much
> easier one-handed."

Submit.

> "'Waiting for review.' A report does not repaint a street. Anyone can file one,
> so if one tap turned a road red, the system would deserve to be distrusted. A
> reviewer looks first."

---

## 7 · The municipality console (120 s) — *switch to laptop* ★★

`/admin` → **Overview**.

> "Real coverage, in metres of pedestrian network — not segment counts, because a
> hundred crossing stubs aren't the same amount of city as a hundred streets."

**Coverage**.

> "Assessed, verified on site, assessed from imagery, OpenStreetMap-only, and
> unknown. A council can see exactly which parts of the city this system knows
> nothing about — which is itself useful."

**Priorities** → open the top issue.

> "Priority 81. And here's the breakdown: severity 24.6 out of 30; no accessible
> alternative — full 20, because we routed around this barrier and there isn't a
> way; nearby public services 7.4, because there's a hospital 120 metres away,
> and OpenStreetMap already knew that."

> "There's deliberately no 'pedestrian footfall' factor. We don't have foot
> traffic data for Pafos, and inventing a plausible number would make the whole
> ranking unfalsifiable."

**Map** → click a segment → the verification drawer.

> "A reviewer can confirm, correct with a reason, or flag for a site visit. A
> correction outranks the pipeline entirely, and it's audited with the previous
> value. When the AI is wrong, a human fixes it and you can see that they did."

**Ingestion** → **Estimate cost**.

> "Before any AI runs, the exact number of model calls, what today's budget has
> left, and how many frames are already cached. Nothing bulk starts on its own.
> This runs on a student cloud account and the design takes that seriously."

---

## 8 · Close (45 s)

> "Three things I'd like you to take away."

> "**One.** Nobody surveyed these streets. This is OpenStreetMap and existing
> Mapillary photographs, turned into a routable accessibility layer. Which means
> it works in the next city too — that's a bounding box and an import job."

> "**Two.** Every claim is traceable. Score, confidence, freshness, source,
> photograph, and a human who can override it. The AI extracts observations; a
> deterministic engine does the scoring."

> "**Three.** It says when it doesn't know. And in accessibility, an honest
> 'unknown' is worth more than a confident guess — because someone is going to
> plan their afternoon around this."

---

## Questions you will be asked

**"Who surveys every street?"**
Nobody. OpenStreetMap and Mapillary already exist. Scans and reports are how the
layer stays current, not how it gets built.

**"How do you know?"**
Tap any segment. Source, imagery date, structured findings, confidence
components, and a link to the original photograph.

**"What if the data's old?"**
Freshness is a first-class field. Over three years is "out of date", it lowers
confidence, it penalises routing, and it's shown next to the capture date.

**"What if there's no data?"**
Grey. We don't guess.

**"What if the AI is wrong?"**
Humans override it, corrections outrank the pipeline, everything is audited, and
we measure agreement against human labels rather than asserting an accuracy
figure.

**"Is this an official accessibility certification?"**
No. AI-assisted accessibility intelligence. Not an audit, no regulatory standing,
not endorsed by the Municipality.

**"How accurate is it?"**
We don't publish a number we haven't measured. The validation module records
human ground truth and reports agreement with the sample size beside it. With a
pilot and fifty labelled segments, we'd have a real answer — and it would be a
real answer.

**"Why AI at all?"**
Because it turns visual evidence that already exists into structured, routable
data. Without it, the only way to know whether a kerb has a ramp is to send
someone to look at it.

---

## If something breaks

- **Map won't load** — screenshots in `docs/` as a fallback; keep talking about
  the evidence panel, which is the substance.
- **No network** — the PWA offline shell loads and explains itself. Say so; it's
  a feature.
- **A route fails** — that's a demo, not a failure: show the error message. It
  names the reason, and distinguishing "no route" from "no *accessible* route" is
  exactly the design point.
