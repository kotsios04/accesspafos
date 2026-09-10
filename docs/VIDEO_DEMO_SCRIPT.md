# Video demo script

**3 minutes.** Screen recording with voiceover. No talking head, no stock
footage, no music over the narration.

Record at 1920×1080. Phone footage as a portrait inset for the public app;
full-frame for the console. Show real data throughout — if a segment is grey,
leave it grey.

---

### 0:00 – 0:20 · The problem

*Visual: the map of Pafos, slowly zooming toward the harbour.*

> "Navigation apps tell you a route is 400 metres. They can't tell you it ends at
> a kerb you can't get down."
>
> "For a wheelchair user, a parent with a pram, or an elderly resident, distance
> isn't the question. Usability is."

---

### 0:20 – 0:40 · The insight

*Visual: split screen — an OpenStreetMap extract, and a Mapillary street photo.*

> "AccessPafos doesn't survey Pafos. The data already exists: the pedestrian
> network is mapped in OpenStreetMap, and thousands of street-level photographs
> of the city are already on Mapillary."
>
> "Neither was collected for accessibility. Between them, they contain the
> answer."

---

### 0:40 – 1:00 · The layer

*Visual: the accessibility layer fading in over the basemap.*

> "A vision model reads each photograph and reports what's physically visible —
> pavements, dropped kerbs, steps, surfaces, obstructions. A deterministic
> scoring engine turns that into a rating for every stretch of pavement."
>
> "Green, amber, red — and grey."

---

### 1:00 – 1:25 · Grey ★

*Visual: zoom to a grey dashed segment; tap it; the sheet opens.*

> "Grey means we don't have enough evidence to say. Confidence twenty-two, and we
> only classify above forty-five."
>
> "We could have coloured it green. A map that guesses green sends someone to a
> barrier that's really there. So it stays grey — and every real city has a lot
> of grey."

---

### 1:25 – 1:50 · Evidence ★★

*Visual: tap a green segment; open "Why this score?"; scroll the breakdown.*

> "Every rating opens into its evidence. The score starts at a hundred, and every
> adjustment is listed with the source that produced it."
>
> "The AI didn't decide this number. It reported observations — a clear path, a
> usable dropped kerb. A fixed formula did the arithmetic, and it gives the same
> answer every time."

*Visual: tap through to the Mapillary photograph.*

> "And there's the actual photograph."

---

### 1:50 – 2:20 · Routing ★★★

*Visual: route planner, wheelchair profile, calculate. Three options appear.*

> "The shortest route is 240 metres. It goes down the harbour steps."
>
> "The recommended route is 500 metres, entirely assessed as accessible."
>
> "It avoids: steps. 260 metres further. The app doesn't hide the shortcut — it
> shows you the cost of avoiding the barrier and lets you decide."

*Visual: brief cut to the step list showing a barrier warning.*

---

### 2:20 – 2:40 · Municipality

*Visual: console overview, then priorities, then one issue's breakdown.*

> "For the Municipality: a ranked repair queue where every score opens into its
> own breakdown — how severe, whether there's a way round, what public services
> are nearby."
>
> "Coverage measured in metres of pedestrian network, including the part we don't
> know yet. And a reviewer can override anything the system says — audited, with
> the previous value kept."

---

### 2:40 – 3:00 · Close

*Visual: pull back to the full city map.*

> "Nobody surveyed these streets. That's what makes it work here — and what makes
> it work in the next city."
>
> "AccessPafos AI. The accessibility layer for Pafos."

*End card: name, live URL, repository URL.*
*Small print, on screen: "AI-assisted accessibility intelligence. Not an
accessibility certification. Not affiliated with the Municipality of Pafos."*

---

## Production notes

- **Do not speed up the map.** Let it load at real speed; it is fast enough, and
  a sped-up demo reads as hiding something.
- **Show one grey segment properly.** Fifteen seconds on grey is the most
  persuasive part of the video.
- **Record the phone separately** and composite as a portrait inset rather than
  filming a screen.
- **Subtitle it**, in English and Greek. For this project in particular,
  captioning is not optional.
- **No fabricated numbers.** If the pilot has 180 segments, say 180. If a figure
  isn't measured, don't say it.
