/**
 * Coverage reporting.
 *
 * This exists because the first question any serious reviewer asks is "how
 * much of the city does this actually cover, and how do you know?" - and the
 * only defensible answer is a page that measures it honestly, including the
 * part that is not covered.
 *
 * Coverage is measured in METRES of pedestrian network, not in segment
 * counts: a hundred five-metre crossing stubs are not the same amount of city
 * as a hundred hundred-metre streets.
 */

import { db } from '../lib/firebase.js';
import { COLLECTIONS } from '../config/index.js';
import { SegmentStatus, Freshness, SourceType } from '../shared/constants.js';

/**
 * @param {string} regionId
 * @returns {Promise<object>} coverage figures in metres and segment counts
 */
export async function computeCoverage(regionId) {
  const snap = await db.collection(COLLECTIONS.segments)
    .where('regionId', '==', regionId)
    .get();

  const metres = {
    total: 0,
    assessed: 0,
    unknown: 0,
    manuallyVerified: 0,
    aiAssessed: 0,
    osmOnly: 0,
    stale: 0,
    byStatus: {
      [SegmentStatus.ACCESSIBLE]: 0,
      [SegmentStatus.PARTIAL]: 0,
      [SegmentStatus.INACCESSIBLE]: 0,
      [SegmentStatus.UNVERIFIED]: 0
    }
  };
  const counts = {
    total: 0,
    assessed: 0,
    unknown: 0,
    manuallyVerified: 0,
    aiAssessed: 0,
    osmOnly: 0,
    stale: 0,
    withImagery: 0,
    needsInspection: 0,
    byStatus: {
      [SegmentStatus.ACCESSIBLE]: 0,
      [SegmentStatus.PARTIAL]: 0,
      [SegmentStatus.INACCESSIBLE]: 0,
      [SegmentStatus.UNVERIFIED]: 0
    }
  };

  for (const doc of snap.docs) {
    const s = doc.data();
    const len = s.lengthMeters || 0;
    const a = s.assessment || {};
    const status = a.status || SegmentStatus.UNVERIFIED;
    const sources = a.sources || [];

    metres.total += len;
    counts.total += 1;
    metres.byStatus[status] = (metres.byStatus[status] || 0) + len;
    counts.byStatus[status] = (counts.byStatus[status] || 0) + 1;

    if (status === SegmentStatus.UNVERIFIED) {
      metres.unknown += len; counts.unknown += 1;
    } else {
      metres.assessed += len; counts.assessed += 1;
    }

    if (sources.includes(SourceType.MANUAL)) { metres.manuallyVerified += len; counts.manuallyVerified += 1; }
    else if (sources.includes(SourceType.MAPILLARY)) { metres.aiAssessed += len; counts.aiAssessed += 1; }
    else if (sources.includes(SourceType.OSM) && status !== SegmentStatus.UNVERIFIED) { metres.osmOnly += len; counts.osmOnly += 1; }

    if (a.freshnessState === Freshness.STALE) { metres.stale += len; counts.stale += 1; }
    if ((s.imagery?.imageCount || 0) > 0) counts.withImagery += 1;
    if (s.needsInspection) counts.needsInspection += 1;
  }

  const pct = (n) => (metres.total > 0 ? Number(((n / metres.total) * 100).toFixed(1)) : 0);

  return {
    regionId,
    generatedAt: new Date().toISOString(),
    metres: roundAll(metres),
    counts,
    percentOfNetwork: {
      assessed: pct(metres.assessed),
      unknown: pct(metres.unknown),
      manuallyVerified: pct(metres.manuallyVerified),
      aiAssessed: pct(metres.aiAssessed),
      osmOnly: pct(metres.osmOnly),
      stale: pct(metres.stale),
      accessible: pct(metres.byStatus[SegmentStatus.ACCESSIBLE]),
      partial: pct(metres.byStatus[SegmentStatus.PARTIAL]),
      inaccessible: pct(metres.byStatus[SegmentStatus.INACCESSIBLE])
    }
  };
}

function roundAll(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === 'number' ? Math.round(v) : roundAll(v);
  }
  return out;
}

/** Headline numbers for the admin overview and the public home page. */
export async function computeOverviewStats(regionId) {
  const [coverage, pendingReports, criticalIssues, aiUsageSnap] = await Promise.all([
    computeCoverage(regionId),
    db.collection(COLLECTIONS.citizenReports)
      .where('regionId', '==', regionId).where('status', '==', 'pending').count().get()
      .then((s) => s.data().count).catch(() => 0),
    db.collection(COLLECTIONS.priorityIssues)
      .where('regionId', '==', regionId).where('priorityScore', '>=', 75).count().get()
      .then((s) => s.data().count).catch(() => 0),
    db.collection(COLLECTIONS.aiUsage).orderBy('day', 'desc').limit(7).get().catch(() => null)
  ]);

  const aiThisWeek = aiUsageSnap
    ? aiUsageSnap.docs.reduce((sum, d) => sum + (d.data().calls || 0), 0)
    : 0;

  return {
    ...coverage,
    pendingReports,
    criticalIssues,
    aiAnalysesThisWeek: aiThisWeek
  };
}
