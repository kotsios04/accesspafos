# Security

## The claim this document has to support

**Authoritative accessibility data is server-owned.** No client, at any role,
can write a segment, an assessment, an observation, a priority score, a
verification event or an audit entry. Everything else in this project rests on
that being true rather than merely intended.

It is enforced in `firestore.rules`, and `tests/rules/firestore.test.js` asserts
it for every collection × every role, including `super_admin`.

## Roles

Firebase Auth **custom claims**, readable by the rules as `request.auth.token.role`.

| Role | Grants |
|---|---|
| `citizen` | the public app; submit and withdraw own reports |
| `reviewer` | review reports, verify segments, record validation labels |
| `municipality_admin` | + ingestion, configuration, exports |
| `super_admin` | + read the audit log |

There is **no client-writable role field anywhere in the database**, and no
endpoint that grants a role. Elevation requires the Admin SDK and a
service-account key — someone with project access, at a terminal, on purpose:

```bash
npm run set-admin -- --email person@pafos.gov.cy --role reviewer
```

Every role change is written to the audit log.

## Defence in depth

| Layer | What it stops |
|---|---|
| Firebase Auth | unauthenticated writes |
| Custom claims | privilege escalation |
| Firestore rules | direct writes to authoritative data |
| Storage rules | reading other people's report photographs |
| Callable guards | malformed or oversized payloads |
| Server-side validation | out-of-range values, unknown enums |
| Audit log | undetected privileged action |
| Rate limiting | abuse of donated public services |

## Security rules, in outline

```
users/{uid}                 read: owner, reviewers
                            write: owner, and only preference fields —
                                   'role', 'isAdmin' and friends are rejected
users/{uid}/saved*          read/write: owner only

segments, segmentAssessments, regions, config/public
                            read: public (the map must work without login)
                            write: SERVER ONLY

observations                read: public, EXCEPT citizen-sourced (reviewers only)
                            write: SERVER ONLY

citizenReports              create: signed-in, own uid, status 'pending',
                                    known category, valid coordinates,
                                    no aiAnalysis/priorityScore/verified fields
                            read:   owner, or reviewers
                            update: owner may only withdraw a pending report
                            delete: nobody

priorityIssues, verificationEvents, validationSamples     read: reviewers
ingestionJobs, analysisJobs, aiUsage                      read: municipality admins
auditLogs                                                 read: super admins
everything above                                          write: SERVER ONLY

{document=**}               deny
```

### Two details worth calling out

**A reviewer cannot mark a report verified by writing to the document.** Review
goes through an audited callable. If the rules allowed the write directly, the
audit trail would be optional.

**Owner-scoped deletes are declared separately from writes.** On a delete there
is no `request.resource`, so a combined `allow read, write: if isOwner(uid) &&
noPrivilegedFields(request.resource.data)` errors and denies — making deletion
silently impossible. The rules tests caught exactly this.

## Storage rules

```
reports/{uid}/{reportId}/{file}
    read:   uploader, or reviewers        ← never public
    create: uploader, image/* only, < 8 MB
    update: nobody
    delete: municipality admins

verification/{segmentId}/{file}    reviewers
public/bundles/**                  public read, server write
exports/**                         admins, via 30-minute signed URLs
{allPaths=**}                      deny
```

Citizen photographs are not public. They may contain incidental bystanders,
vehicles or house numbers, which is exactly why.

## What is deliberately not protected, and why that is survivable

App Check is **not** used. There is no reCAPTCHA attestation, so nothing proves
that a callable request came from this application rather than from a script
holding the (public, bundled) Firebase config. This is a deliberate trade, and
it is worth being exact about what it does and does not expose.

**Open to anyone**, requiring no sign-in:

| Callable | Cost of abuse |
|---|---|
| `bootstrap` | Firestore reads; capped by `maxInstances: 20` |
| `getSegmentDetail` | Firestore reads |
| `calculateRoute` | CPU — 1 GiB, 120 s; the real bill risk |
| `searchPlace`, `reverseLookup` | proxied to Nominatim, behind the cross-instance token bucket below |

**Still closed**, and not affected by this at all:

- Every write to authoritative data. Segments, assessments, observations and
  audit entries are server-owned; `firestore.rules` denies client writes at any
  role, App Check or no App Check.
- Every privileged callable. Review, verification, ingestion, analysis, config
  and export each call a role guard that reads a custom claim, and claims can
  only be set with a service-account key from a terminal.
- Report submission and photo upload, which require a signed-in user (anonymous
  counts) and go through the review workflow before they can affect anything.
- The AI budget. Analysis is admin-only, and additionally bounded by a
  transactional daily ledger, a per-job cap and a dedup cache — so the paid path
  cannot be reached by an anonymous caller at all.

The residual exposure is therefore **read amplification and routing CPU**, not
data integrity and not AI spend. `maxInstances` is the ceiling: a flood costs
invocations and egress up to that concurrency and then queues, rather than
scaling without limit.

If that trade stops being acceptable — a public pilot, a press mention, an
unexpected bill — the mitigations in ascending order of effort are: lower
`maxInstances` on `PUBLIC_CALLABLE_OPTS`; require `requireAuth` on the public
read paths (the app already signs every visitor in anonymously, so this is a
one-line change plus sequencing the bootstrap call after auth); or re-enable App
Check, which is `enforceAppCheck: true` in `functions/src/config/index.js` plus a
reCAPTCHA Enterprise site key.

## Input validation

Every callable validates before doing anything: types, string lengths,
enum membership, coordinate ranges, bounding-box sanity and ordering, array
sizes. Errors are `HttpsError` with messages written for a human, not a stack
trace.

The AI boundary gets the same treatment twice over — see
[AI_METHODOLOGY.md](AI_METHODOLOGY.md#defence-in-depth).

## Rate limiting and outbound etiquette

Overpass, Nominatim and Mapillary are free services. Hammering them on failure
is both rude and counter-productive.

- Every outbound request has a timeout, bounded retries, and exponential backoff
  with jitter. 429 and 503 mean *slow down*, not *try again immediately*.
- Nominatim is rate-limited by a **cross-instance** Firestore token bucket, not
  an in-process timer — ten warm instances each waiting one second is still ten
  requests per second.
- An identifiable User-Agent with a contact address is sent, as their policies
  ask.
- Overpass is never called from a visitor's browser.

## Secrets

| Secret | Where it lives |
|---|---|
| `MAPILLARY_ACCESS_TOKEN` | Google Secret Manager, bound per function |
| `GEMINI_API_KEY` | Google Secret Manager, bound per function |
| Service-account key | `secrets/`, gitignored, local admin CLI only |

Nothing secret carries a `VITE_` prefix, because that would compile it into the
browser bundle. `.gitignore` excludes `secrets/`, `*firebase-adminsdk*.json`,
`service-account*.json`, `.env` and `*.pem`.

The Firebase web config **is** in the bundle, by design. It identifies the
project to the browser; it is not a credential.

## Headers

Set by Firebase Hosting on every response: `X-Content-Type-Options: nosniff`,
`X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy: geolocation=(self), camera=(self), microphone=()`, and HSTS.

## Audit log

Append-only, super-admin readable, capturing actor, action, target, timestamp
and both previous and next values for: segment overrides and verifications,
report decisions, issue assignments and boosts, configuration changes, role
changes, imports, analysis runs, graph rebuilds, bundle publications, validation
labels and exports.

Entries are redacted of anything matching `token|secret|password|authorization|apikey`
and size-bounded, because they are read by humans in a table.

## Abuse resistance for citizen reports

A report cannot repaint a street. It is evidence a human will look at.

- Anonymous auth gives each report an owner, so patterns are visible and
  rate-limiting is possible, without asking anyone to make an account.
- Reports arrive `pending`. A reviewer decides.
- Only a **verified** report contributes to a segment's assessment, and then at
  0.85 weight rather than full.
- Duplicate detection surfaces coordinated reporting to the reviewer. Nothing is
  merged automatically.

## Reporting a vulnerability

Open a private issue, or contact the maintainer. Please do not open a public
issue for anything affecting user data.
