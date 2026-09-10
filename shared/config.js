/**
 * AccessPafos AI - central configuration.
 *
 * Every threshold, weight, limit and version used by the accessibility
 * pipeline lives here. There are deliberately no magic numbers scattered
 * through the scoring, routing or priority code.
 *
 * A subset of these values is mirrored into Firestore at `config/public` so a
 * municipality administrator can tune the deployment without a redeploy; see
 * `mergeRuntimeConfig()` at the bottom of this file.
 */

import { RouteProfile, SegmentStatus, Freshness } from './constants.js';

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

/**
 * Cloud Functions region.  ***CHANGE THIS IN ONE PLACE ONLY.***
 *
 * europe-west1 (Belgium) is the default for a specific reason: 2nd-generation
 * Firestore triggers must be deployed in a region compatible with the
 * Firestore database's own location, and europe-west1 is a member of the
 * `eur3` European multi-region, which is what the Firebase console creates by
 * default for European projects. Choosing a region outside `eur3` - Frankfurt,
 * for instance - makes `onDocumentCreated` triggers fail to deploy against an
 * `eur3` database, which is a confusing failure to debug.
 *
 * If this project's Firestore database is REGIONAL rather than eur3, set this
 * to that exact region instead (Firebase console -> Firestore -> the location
 * is shown next to the database name). Everything else follows from here:
 * the functions, the callable client, and the emulator all read this value.
 *
 * Hosting is a global CDN and is unaffected by this choice.
 */
export const APP_REGION = 'europe-west1';

export const APP_NAME = 'AccessPafos AI';
export const APP_TAGLINE = 'The AI Accessibility Layer for Pafos';

// ---------------------------------------------------------------------------
// Map defaults
// ---------------------------------------------------------------------------

/** [longitude, latitude] - MapLibre order. Pafos, Cyprus. */
export const DEFAULT_MAP_CENTER = [32.4245, 34.7754];
export const DEFAULT_MAP_ZOOM = 14.2;
export const MIN_MAP_ZOOM = 10;
export const MAX_MAP_ZOOM = 19;

/** Bounding box of the Pafos pilot area: [west, south, east, north]. */
export const PAFOS_BOUNDS = [32.3600, 34.7300, 32.4800, 34.8100];

/** Default pilot region: Kato Pafos / Pafos Harbour. */
export const DEFAULT_REGION = Object.freeze({
  id: 'kato-pafos',
  name: 'Kato Pafos / Harbour',
  nameEl: 'Κάτω Πάφος / Λιμάνι',
  bbox: [32.4030, 34.7530, 32.4380, 34.7830]
});

// ---------------------------------------------------------------------------
// Classification thresholds
// ---------------------------------------------------------------------------

/** Accessibility score at or above which a segment is classified accessible. */
export const ACCESSIBLE_THRESHOLD = 80;
/** Accessibility score at or above which a segment is classified partial. */
export const PARTIAL_THRESHOLD = 50;

/**
 * Below this evidence confidence the segment is NOT classified at all: it is
 * reported as `unverified` and rendered grey, whatever its provisional score.
 * This is the single most important guard against inventing accessibility.
 */
export const MIN_CONFIDENCE_TO_CLASSIFY = 45;

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

export const FRESHNESS_THRESHOLDS = Object.freeze({
  /** Newest evidence younger than this is `recent`. */
  recentMaxDays: 365,
  /** Newest evidence younger than this is `aging`; older is `stale`. */
  agingMaxDays: 1095
});

/** Multiplier applied to evidence confidence as evidence ages. */
export const FRESHNESS_CONFIDENCE_FACTOR = Object.freeze({
  [Freshness.RECENT]: 1.0,
  [Freshness.AGING]: 0.9,
  [Freshness.STALE]: 0.75,
  [Freshness.NONE]: 0.6
});

// ---------------------------------------------------------------------------
// Scoring engine
// ---------------------------------------------------------------------------

export const SCORING_BASE = 100;

/**
 * Penalties, in accessibility-score points, subtracted from the base score.
 *
 * These weights encode a conservative pedestrian-mobility heuristic. They are
 * NOT a legal accessibility standard and are not derived from one; see
 * docs/ACCESSIBILITY_SCORING.md.
 */
export const SCORING_PENALTIES = Object.freeze({
  steps: 45,
  missing_curb_ramp: 25,
  crossing_without_ramp: 22,
  high_kerb: 20,
  damaged_surface: 20,
  blocking_obstacle: 20,
  unsuitable_surface: 18,
  restricted_passage: 15,
  narrow_width: 15,
  steep_incline: 20,
  moderate_incline: 10,
  uneven_surface: 10,
  no_pedestrian_path: 30,
  wheelchair_tagged_no: 35
});

/**
 * Positive evidence, in accessibility-score points, added back. The total
 * positive contribution is capped so that positives can never manufacture an
 * "accessible" classification on their own.
 */
export const SCORING_POSITIVES = Object.freeze({
  curb_ramp: 8,
  flush_kerb: 8,
  clear_path: 6,
  good_paved_surface: 6,
  accessible_crossing: 5,
  tactile_paving: 4,
  adequate_width: 4,
  ramp_present: 5,
  wheelchair_tagged_yes: 10,
  manually_verified: 10
});

export const MAX_POSITIVE_BONUS = 20;

/**
 * Weight for a finding only one photograph was able to speak to.
 *
 * `voteFeature` ignores non-informative answers, so a feature that one frame
 * reported and two answered "not visible" for arrives as a unanimous vote of
 * one - and the agreement scale, which discounts disagreement among two or
 * more informative votes, had nothing to discount and returned full weight.
 * A single unconfirmed look therefore counted exactly as much as three frames
 * agreeing.
 *
 * It should not. This is not about being kinder to the map: the factor applies
 * to positive findings as well as barriers, so a lone glimpse of a curb ramp
 * is discounted by the same amount as a lone glimpse of a missing one. What is
 * being corrected is the weight of evidence, not the direction of the answer.
 */
export const SINGLE_OBSERVATION_WEIGHT = 0.6;

/**
 * Hard ceilings on the final accessibility score when a given barrier is
 * present with full evidential weight.
 *
 * Positive features add points back, but they must never be able to lift a
 * segment that demonstrably has a severe barrier into the "accessible" band.
 * A beautifully paved sidewalk that ends in an un-ramped kerb is not an
 * accessible sidewalk, and no amount of good surface should say otherwise.
 *
 * A partially-supported barrier relaxes its ceiling proportionally:
 *   effectiveCeiling = 100 - (100 - ceiling) * weightScale
 */
export const BARRIER_SCORE_CEILINGS = Object.freeze({
  wheelchair_tagged_no: 12,
  steps: 18,
  blocking_obstacle: 42,
  no_pedestrian_path: 52,
  missing_curb_ramp: 62,
  crossing_without_ramp: 62,
  high_kerb: 64,
  steep_incline: 62,
  narrow_width: 66,
  damaged_surface: 70,
  unsuitable_surface: 72,
  restricted_passage: 74
});

// ---------------------------------------------------------------------------
// Evidence confidence
// ---------------------------------------------------------------------------

export const CONFIDENCE = Object.freeze({
  /**
   * Maximum contribution from OSM structured tags alone.
   *
   * Calibrated deliberately against MIN_CONFIDENCE_TO_CLASSIFY, because the
   * ratio between the two decides an important policy question: can
   * OpenStreetMap tagging alone classify a segment, with no imagery?
   *
   * The answer here is "only when the tagging is comprehensive and not stale".
   * Working through it, with informativeness as computed by
   * deriveOsmEvidence() and the freshness discount applied:
   *
   *   surface only               (0.20) recent -> 13   -> stays grey
   *   surface+smoothness+width   (0.50) recent -> 33   -> stays grey
   *   + kerb, incline, tactile   (0.80) recent -> 52   -> classified
   *   + kerb, incline, tactile   (0.80) ageing -> 47   -> classified
   *   + kerb, incline, tactile   (0.80) stale  -> 39   -> stays grey
   *
   * That is the behaviour we want. Where a mapper has actually done the work
   * of recording surface, smoothness, width and kerb, refusing to use it
   * would waste the best open accessibility data that exists — and the whole
   * premise of this project is that such data should be used. Where the
   * tagging is partial, or where it has not been touched in three years, the
   * segment stays grey and waits for imagery or a site visit.
   */
  maxOsmContribution: 65,
  /**
   * Per-image contribution, by the image quality the model itself reported.
   *
   * Calibrated so that the evidence level this system is designed to gather -
   * two or three well-chosen frames per segment - is actually enough to
   * classify, while a single frame never is. Working through it against
   * MIN_CONFIDENCE_TO_CLASSIFY, including the agreement bonus:
   *
   *   1 good frame                          17        -> stays grey
   *   2 good frames, agreeing          34 + 15 = 49   -> classified
   *   2 good frames, contradicting  34 + 7 - 10 = 31  -> stays grey
   *   3 good frames, agreeing          51 + 15 = 66   -> classified
   *   2 medium frames, agreeing        22 + 15 = 37   -> stays grey
   *
   * The first line is the rule that one photograph must never define a whole
   * segment. The third is the rule that disagreement is a reason to say
   * nothing, not a reason to pick a side.
   */
  imageQualityPoints: { good: 17, medium: 11, poor: 4 },
  /** Images beyond this count add nothing (see MAX_IMAGES_PER_SEGMENT). */
  maxCountedImages: 3,
  /** Bonus when independent observations agree on the key features. */
  maxAgreementBonus: 15,
  /** Penalty when independent observations contradict each other. */
  maxConflictPenalty: 20,
  /** Bonus per reviewer-verified citizen report, capped. */
  verifiedReportBonus: 6,
  maxVerifiedReportBonus: 12,
  /** A segment verified on the ground by a municipal reviewer. */
  manualVerificationFloor: 85,
  /**
   * Some OSM tags are decisive on their own: `highway=steps` and
   * `wheelchair=no` are direct assertions by a mapper about the barrier
   * itself, not indirect hints. They earn a confidence floor so a genuinely
   * known barrier is never hidden behind the grey "unverified" state.
   */
  osmDecisiveFloor: 70,
  /** Confidence assigned when literally nothing is known. */
  noEvidence: 0
});

// ---------------------------------------------------------------------------
// AI configuration
// ---------------------------------------------------------------------------

/**
 * Gemini model used for street-level accessibility observation extraction.
 * A Flash-Lite class model is deliberately chosen: the task is constrained
 * structured extraction, not open-ended reasoning, and this is a
 * cost-sensitive student project.
 *
 * Pinned to an explicit version rather than the `gemini-flash-lite-latest`
 * alias, for a reason that matters more here than convenience. This string is
 * stored as the provenance of every observation and forms part of the
 * deduplication key. An alias is not reproducible provenance: "produced by
 * gemini-flash-lite-latest" means a different model each time Google moves it,
 * and because the key would not change, observations from the old model would
 * go on being reused as though the new one had made them. Both hazards stopped
 * being theoretical on 9 Sep 2026, when the alias moved to a model that
 * rejected the thinking configuration and `gemini-2.5-flash-lite` was
 * withdrawn outright.
 *
 * Moving to a new model is therefore a deliberate edit here, paired with a
 * bump to ANALYSIS_VERSION so the cache re-derives rather than inherits.
 */
export const AI_MODEL = 'gemini-3.5-flash-lite';

/**
 * Bumped whenever the prompt, the output schema or the extraction semantics
 * change. Cached observations from an older version are never silently reused
 * as if they came from the current one.
 */
export const ANALYSIS_VERSION = '1.0.0';

/**
 * Bumped whenever the scoring / confidence / classification logic changes,
 * so stored assessments can be recomputed deliberately.
 */
export const ASSESSMENT_VERSION = '1.1.0';

export const AI_TEMPERATURE = 0.1;
export const AI_MAX_OUTPUT_TOKENS = 900;

// ---------------------------------------------------------------------------
// Cost protection - hard application-side limits
// ---------------------------------------------------------------------------

export const MAX_IMAGES_PER_SEGMENT = 3;
export const MAX_MAPILLARY_IMAGES_PER_SEGMENT = MAX_IMAGES_PER_SEGMENT;
export const MAX_AI_ANALYSES_PER_JOB = 200;
// Raised from 500. At roughly $0.0016 a call the old cap was guarding against
// a cost that does not exist - a full day of analysis at 500 calls is under a
// dollar - while making a region take months to survey. The real protection is
// the per-job cap and the estimate shown before the button is pressed.
export const MAX_AI_ANALYSES_PER_DAY = 3000;
export const MAX_CONCURRENT_AI_JOBS = 1;
/** Parallel in-flight Gemini requests inside a single job. */
/**
 * Thinking configuration sent with every analysis request, or null for none.
 *
 * This used to be `{ thinkingBudget: 0 }` hard-coded in the request builder.
 * That was valid for Gemini 2.5 Flash-Lite and is rejected outright by 3.5 - a
 * flat `400 Request contains an invalid argument`, on every frame, with
 * nothing in the message naming the field.
 *
 * 128 rather than nothing at all: sending no thinking configuration leaves the
 * model free to decide, and on Gemini 3.x it decides to think. Measured on
 * 3.5-flash-lite, `thinkingBudget: 128` produced 0 thinking tokens while
 * `thinkingBudget: -1` produced 325 - which, billed as output at Flash-Lite
 * rates, is most of the cost of a frame spent on deliberation this task does
 * not need. The number is a ceiling, not a target.
 *
 * `null` is a supported value here, meaning "send nothing", and the request
 * builder falls back to it if a future model rejects whatever is set.
 * `scripts/probe-thinking.js` prints what each model accepts.
 */
export const AI_THINKING_CONFIG = { thinkingBudget: 128 };

export const AI_JOB_CONCURRENCY = 4;

/**
 * Stop an analysis job after this many consecutive failures with no successes.
 *
 * Every systematic fault at the model boundary - a request shape the API
 * rejects, a revoked key, a model alias that moved - fails identically on every
 * frame. Retrying it two hundred times costs a day's budget and teaches
 * nothing, so the job gives up and says what it saw.
 */
export const AI_CONSECUTIVE_FAILURE_LIMIT = 5;

/** Guard against somebody drawing a box over the whole island. */
export const MAX_IMPORT_AREA_KM2 = 25;
/**
 * Longest stretch that may carry a single accessibility verdict, in metres.
 *
 * Splitting only at junctions left Pafos with segments of up to 1,017 m: one
 * colour and one score for a kilometre of street, derived from at most three
 * photographs that could be looking at entirely different places along it.
 * A segment is the unit of evidence, so it has to be short enough that three
 * frames can honestly characterise it.
 *
 * 50 m is a little over the median junction-to-junction length here (36 m), so
 * most segments are untouched and only the long ones are divided. Cuts land on
 * existing OSM vertices, never on interpolated points.
 */
export const MAX_SEGMENT_LENGTH_M = 50;

/**
 * Ceiling on one import, as a cost guard rather than a technical limit: it
 * exists so a mistyped bounding box cannot quietly write a country's worth of
 * documents. Raised from 8,000 when length splitting took Kato Pafos from
 * 5,697 segments to roughly 8,900.
 */
export const MAX_SEGMENTS_PER_IMPORT = 12000;

export const MAX_REPORT_UPLOAD_MB = 8;
export const MAX_REPORT_DESCRIPTION_CHARS = 600;

/** Mapillary discovery caps. */
export const MAX_MAPILLARY_IMAGES_PER_TILE = 2000;
export const MAPILLARY_SEARCH_RADIUS_M = 22;
export const MAPILLARY_MAX_AGE_YEARS = 8;
/** Two Mapillary frames closer than this are treated as near-duplicates. */
export const MAPILLARY_DEDUPE_DISTANCE_M = 12;

/** Overpass etiquette. */
export const OVERPASS_TIMEOUT_S = 180;
export const OVERPASS_MAX_RETRIES = 3;

/**
 * Public Overpass mirrors, tried in order after the configured endpoint.
 *
 * Retrying harder against one host does not help when that host is the
 * problem: overpass-api.de answered three backed-off attempts with HTTP 504
 * because it was saturated, which is an ordinary condition for a free
 * community service, not a fault. Rotating to a mirror is also the politer
 * behaviour - the Overpass usage policy asks clients to spread load rather
 * than hammer one instance.
 *
 * All are public Overpass API instances speaking the same protocol. The list
 * is a fallback, not a load balancer: the configured endpoint is always tried
 * first and a mirror is used only after it fails.
 */
export const OVERPASS_MIRRORS = Object.freeze([
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
]);

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/**
 * Multiplier applied to a segment's length when computing route cost, by
 * classification and profile. `Infinity` means the profile refuses the edge
 * outright; the router will report "no route" rather than send a wheelchair
 * user down a flight of steps.
 */
export const ROUTE_STATUS_MULTIPLIERS = Object.freeze({
  [RouteProfile.WHEELCHAIR]: {
    [SegmentStatus.ACCESSIBLE]: 1.0,
    [SegmentStatus.PARTIAL]: 2.6,
    [SegmentStatus.INACCESSIBLE]: Infinity,
    [SegmentStatus.UNVERIFIED]: 2.2
  },
  [RouteProfile.REDUCED_MOBILITY]: {
    [SegmentStatus.ACCESSIBLE]: 1.0,
    [SegmentStatus.PARTIAL]: 2.0,
    [SegmentStatus.INACCESSIBLE]: 9.0,
    [SegmentStatus.UNVERIFIED]: 1.8
  },
  [RouteProfile.STROLLER]: {
    [SegmentStatus.ACCESSIBLE]: 1.0,
    [SegmentStatus.PARTIAL]: 1.8,
    [SegmentStatus.INACCESSIBLE]: 7.0,
    [SegmentStatus.UNVERIFIED]: 1.6
  },
  [RouteProfile.BALANCED]: {
    [SegmentStatus.ACCESSIBLE]: 1.0,
    [SegmentStatus.PARTIAL]: 1.35,
    [SegmentStatus.INACCESSIBLE]: 3.0,
    [SegmentStatus.UNVERIFIED]: 1.15
  }
});

/**
 * Barriers a profile refuses outright, and extra cost (in equivalent metres)
 * for barriers it merely dislikes.
 */
export const ROUTE_PROFILE_RULES = Object.freeze({
  [RouteProfile.WHEELCHAIR]: {
    forbidden: ['steps', 'wheelchair_tagged_no'],
    barrierPenaltyMeters: {
      missing_curb_ramp: 220,
      crossing_without_ramp: 200,
      high_kerb: 200,
      blocking_obstacle: 260,
      restricted_passage: 150,
      narrow_width: 180,
      damaged_surface: 140,
      unsuitable_surface: 130,
      steep_incline: 240,
      moderate_incline: 60,
      uneven_surface: 70,
      no_pedestrian_path: 200
    },
    /** Extra cost per metre of segment whose evidence is missing. */
    unknownPenaltyPerMeter: 0.55,
    stalePenaltyPerMeter: 0.25,
    walkingSpeedMps: 0.9
  },
  [RouteProfile.REDUCED_MOBILITY]: {
    forbidden: [],
    barrierPenaltyMeters: {
      steps: 400,
      missing_curb_ramp: 130,
      crossing_without_ramp: 120,
      high_kerb: 120,
      blocking_obstacle: 170,
      restricted_passage: 90,
      narrow_width: 90,
      damaged_surface: 120,
      unsuitable_surface: 100,
      steep_incline: 200,
      moderate_incline: 55,
      uneven_surface: 60,
      no_pedestrian_path: 140
    },
    unknownPenaltyPerMeter: 0.4,
    stalePenaltyPerMeter: 0.2,
    walkingSpeedMps: 0.8
  },
  [RouteProfile.STROLLER]: {
    forbidden: [],
    barrierPenaltyMeters: {
      steps: 350,
      missing_curb_ramp: 110,
      crossing_without_ramp: 100,
      high_kerb: 130,
      blocking_obstacle: 150,
      restricted_passage: 90,
      narrow_width: 110,
      damaged_surface: 100,
      unsuitable_surface: 110,
      steep_incline: 120,
      moderate_incline: 35,
      uneven_surface: 70,
      no_pedestrian_path: 120
    },
    unknownPenaltyPerMeter: 0.3,
    stalePenaltyPerMeter: 0.15,
    walkingSpeedMps: 1.05
  },
  [RouteProfile.BALANCED]: {
    forbidden: [],
    barrierPenaltyMeters: {
      steps: 90,
      missing_curb_ramp: 45,
      crossing_without_ramp: 40,
      high_kerb: 45,
      blocking_obstacle: 70,
      restricted_passage: 35,
      narrow_width: 35,
      damaged_surface: 45,
      unsuitable_surface: 40,
      steep_incline: 70,
      moderate_incline: 20,
      uneven_surface: 25,
      no_pedestrian_path: 50
    },
    unknownPenaltyPerMeter: 0.12,
    stalePenaltyPerMeter: 0.06,
    walkingSpeedMps: 1.2
  }
});

/** Cost model used for the "shortest" comparison route: pure distance. */
export const SHORTEST_PROFILE_ID = '__shortest__';

/** Snap tolerance when matching a user-chosen point to the pedestrian graph. */
export const ROUTE_SNAP_RADIUS_M = 250;
/** Safety valve on the A* search. */
export const ROUTE_MAX_EXPANSIONS = 250000;
/** Above this share of unknown segments the UI shows a prominent caveat. */
export const ROUTE_HIGH_UNKNOWN_RATIO = 0.4;

/**
 * How much of a route must actually be assessed before a route-level
 * accessibility score is reported at all.
 *
 * A segment keeps a provisional score even when its evidence is too thin to
 * classify - that separation is deliberate, and `classifySegment` holds the
 * line by returning `unverified` whatever the score says. The route summary
 * used to average those provisional numbers anyway, so a route with no usable
 * evidence anywhere on it reported 96/100 while its own `unknownPercent` read
 * 100. A reader sees the 96.
 *
 * Below this share the score is null, which every surface already renders as
 * "not enough evidence" rather than as a number.
 */
export const ROUTE_MIN_ASSESSED_SHARE_FOR_SCORE = 0.5;

// ---------------------------------------------------------------------------
// Priority engine
// ---------------------------------------------------------------------------

/**
 * Weights of the deterministic municipal priority score (0-100).
 * Every factor is computed from data the system actually holds. There is
 * deliberately no "estimated pedestrian traffic" factor: we do not have it.
 */
export const PRIORITY_WEIGHTS = Object.freeze({
  severity: 30,
  noAccessibleAlternative: 20,
  nearbyPublicServices: 15,
  safetyImpact: 10,
  verifiedCitizenReports: 10,
  evidenceConfidence: 8,
  freshness: 7
});

/** Manual municipal boost, applied on top and capped. */
export const PRIORITY_MANUAL_BOOST_MAX = 15;

/** Distances (metres) at which a public service still counts as "nearby". */
export const PRIORITY_POI_RADIUS_M = 250;

/** OSM POI classes that raise priority, with their relative weight. */
export const PRIORITY_POI_WEIGHTS = Object.freeze({
  hospital: 1.0,
  clinic: 0.8,
  doctors: 0.6,
  pharmacy: 0.5,
  school: 0.8,
  kindergarten: 0.6,
  university: 0.6,
  townhall: 0.9,
  government: 0.8,
  social_facility: 0.9,
  bus_station: 0.8,
  bus_stop: 0.4,
  post_office: 0.5,
  library: 0.5,
  community_centre: 0.5
});

/** Detour ratio above which a barrier counts as "no accessible alternative". */
export const PRIORITY_NO_ALTERNATIVE_RATIO = 2.0;

// ---------------------------------------------------------------------------
// Duplicate report detection
// ---------------------------------------------------------------------------

export const DUPLICATE_RADIUS_M = 40;
export const DUPLICATE_WINDOW_DAYS = 45;
export const DUPLICATE_MIN_SCORE = 0.6;

// ---------------------------------------------------------------------------
// Data retention
// ---------------------------------------------------------------------------

export const RETENTION = Object.freeze({
  /** Photos attached to rejected reports are deleted after this many days. */
  rejectedReportPhotoDays: 30,
  /** Unattached uploads in the temporary area. */
  orphanUploadHours: 24,
  /** Resolved issues stay visible in the admin list for this long. */
  resolvedIssueVisibleDays: 180
});

// ---------------------------------------------------------------------------
// Published bundles
// ---------------------------------------------------------------------------

export const BUNDLE = Object.freeze({
  /** Storage path template for the public accessibility GeoJSON bundle. */
  pathTemplate: 'public/bundles/{regionId}/accessibility.v{version}.geojson',
  /** Client cache lifetime for a bundle, in seconds. */
  clientCacheSeconds: 900
});

// ---------------------------------------------------------------------------
// Demo mode
// ---------------------------------------------------------------------------

/**
 * When true the app may load clearly-labelled fixture data and MUST show a
 * visible "Demo data" badge. Production deployments run with this false.
 */
export const DEMO_MODE = false;

// ---------------------------------------------------------------------------
// Runtime overrides
// ---------------------------------------------------------------------------

/** The subset of config a municipality administrator may tune at runtime. */
export const RUNTIME_TUNABLE_KEYS = Object.freeze([
  'ACCESSIBLE_THRESHOLD',
  'PARTIAL_THRESHOLD',
  'MIN_CONFIDENCE_TO_CLASSIFY',
  'FRESHNESS_THRESHOLDS',
  'MAX_IMAGES_PER_SEGMENT',
  'MAX_AI_ANALYSES_PER_JOB',
  'MAX_SEGMENT_LENGTH_M',
  'MAX_AI_ANALYSES_PER_DAY',
  'AI_CONSECUTIVE_FAILURE_LIMIT',
  'AI_THINKING_CONFIG',
  'PRIORITY_WEIGHTS',
  'DEMO_MODE'
]);

export const DEFAULT_CONFIG = Object.freeze({
  APP_REGION,
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  ACCESSIBLE_THRESHOLD,
  PARTIAL_THRESHOLD,
  MIN_CONFIDENCE_TO_CLASSIFY,
  FRESHNESS_THRESHOLDS,
  FRESHNESS_CONFIDENCE_FACTOR,
  SCORING_BASE,
  SCORING_PENALTIES,
  SCORING_POSITIVES,
  MAX_POSITIVE_BONUS,
  SINGLE_OBSERVATION_WEIGHT,
  BARRIER_SCORE_CEILINGS,
  CONFIDENCE,
  AI_MODEL,
  ANALYSIS_VERSION,
  ASSESSMENT_VERSION,
  MAX_IMAGES_PER_SEGMENT,
  MAX_AI_ANALYSES_PER_JOB,
  MAX_SEGMENT_LENGTH_M,
  OVERPASS_MIRRORS,
  MAX_AI_ANALYSES_PER_DAY,
  AI_CONSECUTIVE_FAILURE_LIMIT,
  AI_THINKING_CONFIG,
  MAX_CONCURRENT_AI_JOBS,
  MAX_IMPORT_AREA_KM2,
  MAX_REPORT_UPLOAD_MB,
  ROUTE_STATUS_MULTIPLIERS,
  ROUTE_PROFILE_RULES,
  ROUTE_HIGH_UNKNOWN_RATIO,
  ROUTE_MIN_ASSESSED_SHARE_FOR_SCORE,
  PRIORITY_WEIGHTS,
  PRIORITY_MANUAL_BOOST_MAX,
  PRIORITY_POI_RADIUS_M,
  PRIORITY_POI_WEIGHTS,
  DUPLICATE_RADIUS_M,
  DUPLICATE_WINDOW_DAYS,
  DEMO_MODE
});

/**
 * Merge a Firestore `config/public` document over the compiled defaults.
 * Unknown keys are ignored, so a malformed config document can never widen
 * the system's behaviour beyond what the code supports.
 *
 * @param {Record<string, unknown>} [overrides]
 * @returns {typeof DEFAULT_CONFIG}
 */
export function mergeRuntimeConfig(overrides) {
  if (!overrides || typeof overrides !== 'object') return DEFAULT_CONFIG;
  const merged = { ...DEFAULT_CONFIG };
  for (const key of RUNTIME_TUNABLE_KEYS) {
    if (overrides[key] !== undefined && overrides[key] !== null) {
      merged[key] = overrides[key];
    }
  }
  return Object.freeze(merged);
}
