/**
 * AccessPafos AI - shared enumerations.
 *
 * These strings are persisted in Firestore and embedded in published GeoJSON
 * bundles. Treat them as a wire format: add new values, never silently rename.
 */

/** Accessibility classification of a pedestrian segment. */
export const SegmentStatus = Object.freeze({
  ACCESSIBLE: 'accessible',
  PARTIAL: 'partial',
  INACCESSIBLE: 'inaccessible',
  /** Not enough evidence to classify. Rendered grey. Never guessed. */
  UNVERIFIED: 'unverified'
});

export const SEGMENT_STATUSES = Object.freeze([
  SegmentStatus.ACCESSIBLE,
  SegmentStatus.PARTIAL,
  SegmentStatus.INACCESSIBLE,
  SegmentStatus.UNVERIFIED
]);

/** Where a piece of evidence came from. Never lost, never overwritten. */
export const SourceType = Object.freeze({
  OSM: 'osm',
  MAPILLARY: 'mapillary',
  CITIZEN: 'citizen',
  MANUAL: 'manual',
  MUNICIPALITY: 'municipality'
});

export const SOURCE_TYPES = Object.freeze(Object.values(SourceType));

/** How old the newest evidence for a segment is. */
export const Freshness = Object.freeze({
  RECENT: 'recent',
  AGING: 'aging',
  STALE: 'stale',
  /** No dated evidence at all. */
  NONE: 'none'
});

/** Mobility profiles used by the routing engine. */
export const RouteProfile = Object.freeze({
  WHEELCHAIR: 'wheelchair',
  REDUCED_MOBILITY: 'reduced_mobility',
  STROLLER: 'stroller',
  BALANCED: 'balanced'
});

export const ROUTE_PROFILES = Object.freeze(Object.values(RouteProfile));

/** The three route options always returned together for comparison. */
export const RouteVariant = Object.freeze({
  RECOMMENDED: 'recommended',
  BALANCED: 'balanced',
  SHORTEST: 'shortest'
});

/** Citizen report categories. Mirrored in firestore.rules - keep in sync. */
export const ReportCategory = Object.freeze({
  BROKEN_PAVEMENT: 'broken_pavement',
  MISSING_CURB_RAMP: 'missing_curb_ramp',
  STEPS: 'steps',
  BLOCKED_SIDEWALK: 'blocked_sidewalk',
  NARROW_PASSAGE: 'narrow_passage',
  SURFACE_PROBLEM: 'surface_problem',
  CROSSING_PROBLEM: 'crossing_problem',
  TEMPORARY_OBSTRUCTION: 'temporary_obstruction',
  OTHER: 'other'
});

export const REPORT_CATEGORIES = Object.freeze(Object.values(ReportCategory));

export const ReportStatus = Object.freeze({
  PENDING: 'pending',
  NEEDS_REVIEW: 'needs_review',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
  DUPLICATE: 'duplicate',
  RESOLVED: 'resolved',
  WITHDRAWN: 'withdrawn'
});

export const IssueStatus = Object.freeze({
  NEW: 'new',
  NEEDS_REVIEW: 'needs_review',
  VERIFIED: 'verified',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
  REJECTED: 'rejected'
});

export const JobStatus = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  PARTIAL: 'partial',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
});

export const Role = Object.freeze({
  CITIZEN: 'citizen',
  REVIEWER: 'reviewer',
  MUNICIPALITY_ADMIN: 'municipality_admin',
  SUPER_ADMIN: 'super_admin'
});

export const ROLE_RANK = Object.freeze({
  citizen: 0,
  reviewer: 1,
  municipality_admin: 2,
  super_admin: 3
});

/**
 * Canonical barrier identifiers. Every penalty applied by the scoring engine
 * names one of these, so a score can always be explained in the UI and
 * translated into Greek.
 */
export const Barrier = Object.freeze({
  STEPS: 'steps',
  MISSING_CURB_RAMP: 'missing_curb_ramp',
  HIGH_KERB: 'high_kerb',
  DAMAGED_SURFACE: 'damaged_surface',
  UNEVEN_SURFACE: 'uneven_surface',
  UNSUITABLE_SURFACE: 'unsuitable_surface',
  BLOCKING_OBSTACLE: 'blocking_obstacle',
  RESTRICTED_PASSAGE: 'restricted_passage',
  NARROW_WIDTH: 'narrow_width',
  STEEP_INCLINE: 'steep_incline',
  MODERATE_INCLINE: 'moderate_incline',
  NO_PEDESTRIAN_PATH: 'no_pedestrian_path',
  CROSSING_WITHOUT_RAMP: 'crossing_without_ramp',
  WHEELCHAIR_TAGGED_NO: 'wheelchair_tagged_no'
});

/** Canonical positive-evidence identifiers. */
export const PositiveFeature = Object.freeze({
  CURB_RAMP: 'curb_ramp',
  CLEAR_PATH: 'clear_path',
  ACCESSIBLE_CROSSING: 'accessible_crossing',
  GOOD_PAVED_SURFACE: 'good_paved_surface',
  TACTILE_PAVING: 'tactile_paving',
  FLUSH_KERB: 'flush_kerb',
  ADEQUATE_WIDTH: 'adequate_width',
  MANUALLY_VERIFIED: 'manually_verified',
  WHEELCHAIR_TAGGED_YES: 'wheelchair_tagged_yes',
  RAMP_PRESENT: 'ramp_present'
});

/** Colours used for the four-state accessibility layer. */
export const STATUS_COLORS = Object.freeze({
  [SegmentStatus.ACCESSIBLE]: '#18A66A',
  [SegmentStatus.PARTIAL]: '#F2B84B',
  [SegmentStatus.INACCESSIBLE]: '#E55757',
  [SegmentStatus.UNVERIFIED]: '#AAB3BC'
});

/**
 * Non-colour redundant encoding, so the layer is not communicated by colour
 * alone (WCAG 1.4.1). Used in the legend, the segment sheet and the tables.
 */
export const STATUS_GLYPH = Object.freeze({
  [SegmentStatus.ACCESSIBLE]: '●',
  [SegmentStatus.PARTIAL]: '◐',
  [SegmentStatus.INACCESSIBLE]: '■',
  [SegmentStatus.UNVERIFIED]: '○'
});
