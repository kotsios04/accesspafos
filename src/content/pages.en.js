/**
 * Public information pages (English).
 *
 * These are part of the product, not filler. A system that makes accessibility
 * claims about a real city owes its users a plain account of where the data
 * comes from, what the AI does and does not do, and what it keeps about them.
 */

export default {
  privacy: {
    title: 'Privacy',
    updated: 'Last updated: September 2026',
    blocks: [
      { p: 'AccessPafos AI is built so that you can use it without telling us who you are. Exploring the map, reading a segment’s evidence and planning a route require no account and no personal details.' },

      { h2: 'What we collect' },
      { ul: [
        'Nothing at all when you browse the map or plan a route anonymously. Route calculation happens on the server, but the origin and destination are used to compute the route and are not stored against you.',
        'If you submit a barrier report: the location you chose, the category, your description, an optional photograph, and an anonymous account identifier so that you can see your own report later.',
        'If you sign in with Google: your email address and display name, used to identify you to municipal reviewers and to keep your saved places across devices.',
        'Your preferences (mobility profile, language, units) are stored on your device, and additionally in your account if you sign in.'
      ] },

      { h2: 'Your location' },
      { p: 'Your device location is only requested when you tap a control that needs it, such as “Use my location” or “Start navigation”. It is used in the browser to centre the map and to follow your progress along a route. It is not transmitted to us for storage and it is not logged.' },

      { h2: 'Photographs you submit' },
      { p: 'Report photographs are not shown publicly. They are readable only by you and by municipal reviewers. They may contain incidental bystanders, vehicles or house numbers, which is exactly why they stay private. If a report is rejected, its photograph is deleted automatically after thirty days.' },
      { p: 'When a photograph is analysed, the analysis extracts only physical accessibility features — kerbs, steps, surfaces, obstructions. The model is instructed not to identify people and not to transcribe number plates or house numbers.' },

      { h2: 'Street-level imagery' },
      { p: 'The street-level photographs the system analyses come from Mapillary and belong to their contributors. We store the image identifier, its location and capture date, and the structured findings of our analysis. We do not re-host the photographs themselves.' },

      { h2: 'Analytics' },
      { p: 'Usage analytics are off unless you turn them on in Settings. When enabled, they record only that an event happened — a map was opened, a route was calculated — never coordinates, search terms, report contents or photographs.' },

      { h2: 'Who can see what' },
      { ul: [
        'Anyone: the accessibility map, segment evidence, and the aggregated coverage figures.',
        'You: your own reports, your saved places and routes, your preferences.',
        'Municipal reviewers: reports and their photographs, so they can verify them.',
        'Nobody: your browsing history within the app, and your device location.'
      ] },

      { h2: 'Your choices' },
      { p: 'You can use the app without an account, withdraw a report while it is still pending, sign out at any time, and clear locally stored preferences by clearing site data in your browser. To have an account and its associated reports deleted, contact the project maintainer.' },

      { h2: 'Where the data lives' },
      { p: 'Data is stored in Google Cloud, in the European Union. Access to it is controlled by Firebase security rules and by role claims that only a project administrator can grant.' }
    ]
  },

  dataSources: {
    title: 'Data sources & attribution',
    updated: 'Last updated: September 2026',
    blocks: [
      { p: 'AccessPafos AI is built almost entirely on open data. That is the point: an accessibility layer that depended on a proprietary survey would stop the day the survey budget ran out.' },

      { h2: 'OpenStreetMap' },
      { p: 'The pedestrian network — footways, pavements, crossings, steps and walkable streets — comes from OpenStreetMap, along with the accessibility tags its contributors have added: surface, smoothness, width, kerb, incline, tactile paving and wheelchair access.' },
      { p: 'Map data © OpenStreetMap contributors, available under the Open Database Licence (ODbL). Network data is retrieved through the Overpass API for a bounded region, on request by an administrator — never from a visitor’s browser.' },

      { h2: 'Mapillary' },
      { p: 'Street-level photographs come from Mapillary, contributed by volunteers, companies and public bodies. Imagery © the respective contributors, licensed CC BY-SA. We use the Mapillary API to find which frames exist near a segment and to fetch a frame for analysis; we store the image identifier and metadata rather than re-hosting the picture.' },

      { h2: 'Basemap' },
      { p: 'The background map is rendered from OpenFreeMap vector tiles, built from OpenStreetMap data with OpenMapTiles schema. Attribution is shown on every map view.' },

      { h2: 'Place search' },
      { p: 'Place search uses Nominatim, operated by the OpenStreetMap Foundation. In line with its usage policy, searches run server-side on explicit submission only — never as you type — are rate-limited, and every result is cached.' },

      { h2: 'Public services' },
      { p: 'Hospitals, clinics, schools, bus stops and government offices used by the municipal priority ranking are OpenStreetMap points of interest. A barrier outside a hospital entrance is ranked higher than the same barrier on a quiet cul-de-sac because OpenStreetMap already records where the hospital is.' },

      { h2: 'What is NOT in this system' },
      { ul: [
        'No pedestrian counts or footfall estimates. We do not have them for Pafos, and inventing them would make the ranking unfalsifiable.',
        'No commercial or proprietary datasets.',
        'No personal data from any third party.',
        'No official municipal accessibility survey. If one exists, it could be imported as a verification source.'
      ] },

      { h2: 'Attribution requirements' },
      { p: 'If you reuse data exported from this system, you must carry the OpenStreetMap attribution and comply with ODbL, and the Mapillary attribution for anything derived from its imagery. Exports include both notices.' }
    ]
  },

  methodology: {
    title: 'Methodology',
    updated: 'Last updated: September 2026',
    blocks: [
      { p: 'Every colour on this map is the output of the same four-step pipeline. It is deterministic: given the same evidence, it always produces the same score, which is what makes “Why this score?” answerable.' },

      { h2: '1. Existing data, not new surveys' },
      { p: 'The system starts from what already exists: the pedestrian network mapped in OpenStreetMap and the street-level photographs already contributed to Mapillary. Nobody has to walk every street with a phone. Manual scanning and citizen reports are an update and verification mechanism, not the data acquisition model.' },

      { h2: '2. Structured observation, not judgement' },
      { p: 'A vision model looks at each selected photograph and reports what is physically visible: is there a pavement, is there a dropped kerb, are there steps, what is the surface, is anything standing in the way. It answers in a fixed schema with a fixed vocabulary, and it is required to distinguish “I can see there is none” from “I cannot see”.' },
      { p: 'The model never outputs a score, a rating or a recommendation. It is an extraction step, not a decision step.' },

      { h2: '3. Deterministic scoring' },
      { p: 'A fixed formula converts observations and OpenStreetMap tags into a score out of 100. It starts at 100, subtracts a fixed penalty for each barrier found, and adds back a capped bonus for confirmed positive features.' },
      { p: 'Severe barriers also impose a ceiling. A pavement with no dropped kerb cannot be scored as accessible however good its surface is, because in practice it is not accessible.' },
      { ul: [
        'Steps: −45, and a hard ceiling that places the segment in the inaccessible band.',
        'No dropped kerb where one is needed: −25, ceiling 62.',
        'Blocked pavement: −20, ceiling 42.',
        'Damaged surface: −20. Restricted passage: −15. Narrow width: −15.',
        'Positive features add back at most 20 points in total.'
      ] },
      { p: 'These weights are a conservative pedestrian-mobility heuristic. They are not derived from any legal accessibility standard and are not presented as compliance with one.' },

      { h2: '4. Three separate numbers' },
      { p: 'Accessibility score, evidence confidence and freshness are reported separately, because they answer different questions and mixing them would hide the important one.' },
      { ul: [
        'Accessibility score (0–100): how usable the evidence suggests this stretch is.',
        'Evidence confidence (0–100): how much we should trust that score. Built from how informative the OpenStreetMap tags are, how many usable images were analysed, whether independent images agreed, and whether a human has verified it on site. The model’s own stated certainty is not used — a language model’s confidence in itself is not evidence.',
        'Freshness: how old the newest evidence is. Recent (under a year), ageing (one to three years), out of date (over three years).'
      ] },

      { h2: 'The grey rule' },
      { p: 'Classification happens only when evidence confidence reaches the minimum threshold. Below it, a segment is reported as “not enough evidence” and drawn grey and dashed, whatever its provisional score. Grey is not a failure state — it is the honest answer, and it is a large part of any real city.' },

      { h2: 'Disagreement' },
      { p: 'When several photographs disagree about the same feature, the aggregator takes the more conservative reading and reduces the weight of that finding. Half the images saying “good surface” and half saying “damaged” resolves toward damaged, at half weight, and lowers confidence.' },

      { h2: 'Human override' },
      { p: 'A municipal reviewer can confirm a classification, correct it with a written reason, or flag it for a site visit. A correction outranks the pipeline. Every override is recorded with who made it and what the value was before.' },

      { h2: 'Routing' },
      { p: 'The routing engine costs each stretch as its length multiplied by a factor for its classification, plus fixed penalties for the specific barriers on it, plus a penalty for unassessed and for stale evidence. A wheelchair profile refuses steps outright rather than routing over them, so it will report “no accessible route” instead of quietly sending someone down a staircase.' },

      { h2: 'Accuracy' },
      { p: 'We do not publish an accuracy figure unless it has been measured against human ground-truth labels recorded in the system, and any figure is always shown with its sample size. An unmeasured accuracy claim would be worse than no claim.' },

      { h2: 'Known limitations' },
      { ul: [
        'Street-level imagery is uneven. Some streets have none, and those stay grey.',
        'A photograph shows one moment. A pavement clear in 2024 may be blocked today.',
        'Widths and gradients cannot be measured from an uncalibrated photograph, so the system reports categories rather than numbers.',
        'OpenStreetMap coverage of accessibility tags is thin in most cities, including Pafos. That is a data problem this project surfaces rather than solves.',
        'This is not an accessibility audit and carries no regulatory standing.'
      ] }
    ]
  },

  responsibleAi: {
    title: 'Responsible AI',
    updated: 'Last updated: September 2026',
    blocks: [
      { p: 'This system makes claims about whether disabled people can use particular streets. Getting that wrong has consequences — a wrong “accessible” can strand someone. The design assumes the AI will sometimes be wrong and is built so that being wrong is visible and correctable.' },

      { h2: 'What the AI does' },
      { p: 'One narrow job: look at a street-level photograph and report which physical accessibility features are visible, in a fixed schema. That is the whole of its role.' },

      { h2: 'What the AI does not do' },
      { ul: [
        'It does not decide the accessibility score. A deterministic formula does that, from the model’s observations.',
        'It does not identify, describe or count people, and is instructed to ignore anyone in frame.',
        'It does not infer anybody’s disability, health or condition.',
        'It does not estimate widths in metres or gradients in percent from a single uncalibrated photograph.',
        'It does not assess compliance with any legal accessibility standard.',
        'It does not act on citizen reports. Only a human reviewer can turn a report into evidence.'
      ] },

      { h2: 'Uncertainty is a valid answer' },
      { p: 'The schema requires the model to distinguish “not present” from “not visible”, and “unknown” is always available. An honest unknown keeps a segment grey, which is a useful outcome; a confident guess would be an actively harmful one.' },

      { h2: 'Every claim is traceable' },
      { p: 'Tapping any street shows the classification, the score with its arithmetic itemised, the confidence with its components, the age of the newest evidence, which sources contributed, the individual image findings, and a link to the original photograph and OpenStreetMap way. Nothing about a rating is hidden.' },

      { h2: 'Humans outrank the machine' },
      { p: 'Municipal reviewers can override any classification with a written reason. Overrides are audited with the previous value, and the segment’s history is preserved. The system is designed to be corrected, not defended.' },

      { h2: 'Measuring rather than asserting' },
      { p: 'Reviewers can record ground-truth labels for segments; agreement is computed only from those labels, and reported with the sample size. The validation view highlights optimistic errors — cases where the system said a street was better than it is — separately, because those are the failures that matter most.' },

      { h2: 'Cost and environmental restraint' },
      { p: 'Analysis is capped per job and per day, deduplicated so identical evidence is never analysed twice, and limited to at most three well-chosen frames per segment. Bulk analysis never starts automatically: an administrator sees the exact number of model calls a run would make and has to start it deliberately.' },

      { h2: 'Not a certification' },
      { p: 'AccessPafos AI provides AI-assisted accessibility intelligence. It is not an accessibility audit, it carries no regulatory standing, and it is not affiliated with or endorsed by the Municipality of Pafos.' }
    ]
  }
};
