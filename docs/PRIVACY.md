# Privacy

The user-facing version of this is in the app at `/privacy`, in English and
Greek. This document adds the implementation detail.

## The design premise

You can use AccessPafos without telling it who you are. Exploring the map,
reading a segment's evidence and planning a route require no account, no
sign-in and no personal details. Anonymous authentication happens only at the
moment someone submits a report — because a report needs an owner so the
reporter can see it later and so abuse can be rate-limited — and it asks nothing
of the user beyond tapping submit.

## What is collected, and when

| Action | Collected | Stored |
|---|---|---|
| Browsing the map | nothing | nothing |
| Planning a route | origin and destination, used to compute the route | not stored against a user |
| Searching a place | the query, server-side | cached 30 days by query text, not by user |
| Submitting a report | location, category, description, optional photo, anonymous uid | yes |
| Signing in with Google | email, display name | yes |
| Changing a preference | mobility profile, language, units | device, plus account if signed in |

## Location

Requested only when the user taps a control that needs it. Used in the browser
to centre the map and to follow progress along a route. **It is not transmitted
for storage and not logged.** During navigation the position stays in the tab.

## Photographs

Report photographs are **not public**. They are readable by the uploader and by
municipal reviewers, through short-lived signed URLs (15 minutes), enforced in
`storage.rules`.

They may contain incidental bystanders, vehicles or house numbers. That is
precisely why they stay private, and why the analysis prompt forbids the model
from identifying people or transcribing plates and house numbers.

A rejected report's photograph is deleted automatically after 30 days by a
scheduled function. Uploads that were never attached to a report are deleted
after 24 hours.

## Street-level imagery

Mapillary photographs belong to their contributors. We store the image ID, its
location and capture date, and our structured findings. **We do not re-host the
imagery.** Analysis fetches a thumbnail by URL and discards it.

## Analytics

Off unless a user turns it on in Settings. When enabled, an allowlist of nine
event names is permitted, and parameters are filtered against a blocklist that
strips anything matching `lat|lng|lon|coord|uid|email|photo|query|address|name`.
Only scalars and short strings survive.

No coordinates, no search terms, no report contents, no photographs.

## Who can see what

| Data | Public | Owner | Reviewers | Super admins |
|---|:-:|:-:|:-:|:-:|
| Accessibility map and segment evidence | ✓ | ✓ | ✓ | ✓ |
| Coverage statistics | ✓ | ✓ | ✓ | ✓ |
| Own reports | | ✓ | ✓ | ✓ |
| Other people's reports | | | ✓ | ✓ |
| Report photographs | | own | ✓ | ✓ |
| Citizen-sourced observations | | | ✓ | ✓ |
| Saved places and routes | | ✓ | | |
| Audit log | | | | ✓ |

Note the third row of the matrix: citizen-sourced *observations* — the
structured findings, not the photograph — are reviewer-only, because they can
carry a free-text obstacle description written about a specific location.

## Retention

| Data | Kept |
|---|---|
| Segments, assessments, observations | indefinitely — this is the accessibility record |
| Citizen reports | indefinitely, as municipal evidence |
| Rejected report photographs | 30 days after rejection |
| Orphaned uploads | 24 hours |
| Geocoding cache | 30 days |
| Audit log | indefinitely |

Observations are retained deliberately: they are what makes it possible to
change the scoring and re-derive every assessment without having lost what the
system originally saw.

## User rights

- Use the app with no account at all.
- Withdraw a report while it is still pending.
- Sign out at any time.
- Clear device-stored preferences by clearing site data.
- Request deletion of an account and its reports by contacting the maintainer.

## GDPR posture

Data is stored in Google Cloud within the European Union. The lawful basis for
processing a report is the legitimate interest of a municipality in maintaining
accessible public infrastructure; for preferences, consent, freely given and
withdrawable.

Data minimisation is structural rather than procedural: the report form asks for
a category, a point and an optional photograph, and there is nowhere to enter a
name or a phone number, because the system has no use for either.

**For a production municipal deployment**, a formal Data Protection Impact
Assessment should be completed with the municipality's data protection officer,
and the retention periods above confirmed against Cypriot public-records rules.
This project has not done that; it would be dishonest to imply otherwise.
