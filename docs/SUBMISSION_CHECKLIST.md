# Submission checklist

Pafos 2.0 Innovation Competition · Municipality of Pafos

> Placeholders marked **⬜ fill in** need a real value before submitting. Leaving
> one blank is better than inventing one.

---

## Deliverables

- [ ] **Application summary** — one paragraph. Draw from
      [EXECUTIVE_SUMMARY.md](EXECUTIVE_SUMMARY.md) opening.
- [ ] **Executive summary** — [EXECUTIVE_SUMMARY.md](EXECUTIVE_SUMMARY.md),
      export to PDF, ≤ 2 pages. ⬜ fill in demo URL and repo URL.
- [ ] **Technical proposal** — [TECHNICAL_PROPOSAL.md](TECHNICAL_PROPOSAL.md),
      export to PDF, ≤ 10 pages.
- [ ] **Business model canvas** — [BUSINESS_MODEL_CANVAS.md](BUSINESS_MODEL_CANVAS.md);
      consider also a one-page visual canvas.
- [ ] **Working product** — deployed and reachable. ⬜ URL
- [ ] **Source code** — repository. ⬜ URL, and confirm it is accessible to judges
- [ ] **Technology list** — from the README architecture table
- [ ] **AI platform list** — Google Gemini via Genkit; see
      [AI_DISCLOSURE.md](AI_DISCLOSURE.md) part 1
- [ ] **AI development-tool disclosure** — [AI_DISCLOSURE.md](AI_DISCLOSURE.md)
      part 2. ⬜ **complete the tool table honestly**
- [ ] **Presentation** — build from [PRESENTATION_OUTLINE.md](PRESENTATION_OUTLINE.md)
- [ ] **Video** (if required) — [VIDEO_DEMO_SCRIPT.md](VIDEO_DEMO_SCRIPT.md)

## Technical readiness

- [ ] `npm install` and `npm --prefix functions install` succeed on a clean clone
- [ ] `npm test` passes — 337 unit, integration and component tests
- [ ] `npm run build` succeeds
- [ ] `npm run test:rules` passes against the Firestore emulator
- [ ] `firebase deploy` completes without errors
- [ ] Public app loads on a phone and on a desktop
- [ ] Admin console loads and is role-gated
- [ ] Map renders with attribution visible
- [ ] Real OSM data imported for the pilot region
- [ ] Mapillary discovery has run
- [ ] AI analysis has run on a bounded set
- [ ] Assessments recalculated, graph rebuilt, bundle published
- [ ] Grey segments are visible — a fully coloured map means something is wrong
- [ ] Routing returns three options with genuinely different distances
- [ ] Report submission works end to end from a phone
- [ ] Verification workflow works and appears in the audit log

## Content readiness

- [ ] Greek translation reviewed by a native speaker ⬜
- [ ] All four public info pages read correctly in both languages
- [ ] No lorem ipsum, no TODO, no placeholder text anywhere in the UI
- [ ] `DEMO_MODE` is **false** in production
- [ ] No demo or fixture data in the production database
- [ ] Version number and contact details correct

## Honesty audit — do this last, and do it properly

- [ ] No user or adoption numbers claimed anywhere
- [ ] No accuracy percentage stated unless measured, and shown with its sample size
- [ ] No coverage claim that the coverage page does not support
- [ ] No partnership or endorsement implied
- [ ] No municipal logo used without written permission
- [ ] The "not a certification, not affiliated with the Municipality" disclaimer
      appears in the app, the exports and the submission documents
- [ ] Limitations section present and not softened
- [ ] Every figure in the slide deck traceable to the live database
- [ ] The evaluation fixture is not quoted as a measurement

## Security and privacy

- [ ] No secrets committed — `git log -p | grep -iE "AIza|firebase-adminsdk|BEGIN PRIVATE KEY"` is clean
- [ ] `secrets/` and `.env` gitignored and absent from the repository
- [ ] Firestore and Storage rules deployed
- [ ] Role guards verified on every privileged callable
- [ ] Service-account key not shared, and rotated if it ever was ⬜
- [ ] Privacy page accurate about what is collected

## Presentation day

- [ ] Deployment tested on the venue's network, or a mobile hotspot ready
- [ ] Phone and laptop both signed in, admin role confirmed
- [ ] Demo path walked end to end at least twice
- [ ] Screenshots saved as a fallback if the network fails
- [ ] Battery, cable, adapter
- [ ] Answers rehearsed for the questions in [DEMO_SCRIPT.md](DEMO_SCRIPT.md)
- [ ] One number you actually have, ready to quote

## Nice to have, if time allows

- [ ] Lighthouse run recorded (performance, accessibility, best practices, SEO)
- [ ] 50 ground-truth labels recorded, producing a real agreement figure
- [ ] A screen-reader pass over the main flows
- [ ] A short accessibility statement page
- [ ] One disability organisation in Pafos shown the app and asked what is wrong
      with it — this is worth more than any other item on this list
