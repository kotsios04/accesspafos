/**
 * Municipal exports.
 *
 * Public works departments do not live in web dashboards; they live in
 * spreadsheets and GIS. An export that lands as a CSV in someone's inbox is
 * what makes this tool usable by the people who would actually fix the kerbs.
 *
 * Exports are written to Cloud Storage and returned as a short-lived signed
 * URL, so a spreadsheet of municipal issues is never left publicly readable.
 */

import { db, bucket } from '../lib/firebase.js';
import { toCsv } from '../lib/csv.js';
import { COLLECTIONS } from '../config/index.js';
import { computeCoverage } from '../admin/coverage.js';
import { writeAudit, AuditAction } from '../lib/audit.js';
import { SegmentStatus } from '../shared/constants.js';
import { decodeSegment } from '../shared/geometry.js';

export { toCsv };

async function saveExport(regionId, filename, contents, contentType) {
  const path = `exports/${regionId}/${Date.now()}_${filename}`;
  const file = bucket().file(path);
  await file.save(contents, { contentType, metadata: { cacheControl: 'private, max-age=0' } });
  const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 30 * 60 * 1000 });
  return { path, url, bytes: Buffer.byteLength(contents), filename };
}

export async function exportIssuesCsv(regionId, actor) {
  const snap = await db.collection(COLLECTIONS.priorityIssues)
    .where('regionId', '==', regionId)
    .orderBy('priorityScore', 'desc')
    .limit(5000)
    .get();

  const rows = snap.docs.map((d) => d.data());
  const csv = toCsv(rows, [
    { key: 'priorityScore', label: 'Priority' },
    { key: 'priorityBand', label: 'Band' },
    { key: 'segmentId', label: 'Segment ID' },
    { key: 'streetName', label: 'Street' },
    { key: 'streetNameEl', label: 'Street (EL)' },
    { label: 'Latitude', value: (r) => r.centre?.[1] ?? '' },
    { label: 'Longitude', value: (r) => r.centre?.[0] ?? '' },
    { key: 'accessibilityStatus', label: 'Accessibility status' },
    { key: 'accessibilityScore', label: 'Accessibility score' },
    { key: 'evidenceConfidence', label: 'Evidence confidence' },
    { key: 'freshnessState', label: 'Evidence freshness' },
    { label: 'Barriers', value: (r) => (r.barriers || []).join('; ') },
    { key: 'verifiedReportCount', label: 'Confirmed resident reports' },
    { label: 'Accessible detour ratio', value: (r) => r.detour?.ratio ?? 'none found' },
    { label: 'Nearby public services', value: (r) => (r.nearbyPois || []).map((p) => `${p.class} (${p.distanceMeters}m)`).join('; ') },
    { key: 'status', label: 'Workflow status' },
    { key: 'assignedDepartment', label: 'Assigned to' }
  ]);

  const result = await saveExport(regionId, 'priority-issues.csv', csv, 'text/csv; charset=utf-8');
  await writeAudit({ actor, action: AuditAction.EXPORT_GENERATED, targetType: 'region', targetId: regionId, next: { type: 'issues-csv', rows: rows.length } });
  return { ...result, rows: rows.length };
}

export async function exportReportsCsv(regionId, actor) {
  const snap = await db.collection(COLLECTIONS.citizenReports)
    .where('regionId', '==', regionId)
    .orderBy('createdAt', 'desc')
    .limit(5000)
    .get();

  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const csv = toCsv(rows, [
    { key: 'id', label: 'Report ID' },
    { label: 'Submitted', value: (r) => r.createdAt?.toDate?.().toISOString() ?? '' },
    { key: 'category', label: 'Category' },
    { key: 'status', label: 'Status' },
    { label: 'Latitude', value: (r) => r.location?.lat ?? '' },
    { label: 'Longitude', value: (r) => r.location?.lng ?? '' },
    { key: 'streetName', label: 'Street' },
    { key: 'segmentId', label: 'Segment ID' },
    { key: 'description', label: 'Description' },
    { label: 'Has photo', value: (r) => (r.hasPhoto ? 'yes' : 'no') },
    { label: 'Reviewed', value: (r) => r.reviewedAt?.toDate?.().toISOString() ?? '' },
    { key: 'assignedTo', label: 'Assigned to' }
    // Deliberately excluded: reporterUid and the photo path. An operational
    // spreadsheet does not need to identify who reported what.
  ]);

  const result = await saveExport(regionId, 'citizen-reports.csv', csv, 'text/csv; charset=utf-8');
  await writeAudit({ actor, action: AuditAction.EXPORT_GENERATED, targetType: 'region', targetId: regionId, next: { type: 'reports-csv', rows: rows.length } });
  return { ...result, rows: rows.length };
}

export async function exportCoverageCsv(regionId, actor) {
  const coverage = await computeCoverage(regionId);
  const rows = [
    { measure: 'Total pedestrian network', metres: coverage.metres.total, percent: 100 },
    { measure: 'Assessed', metres: coverage.metres.assessed, percent: coverage.percentOfNetwork.assessed },
    { measure: 'Unknown (insufficient evidence)', metres: coverage.metres.unknown, percent: coverage.percentOfNetwork.unknown },
    { measure: 'Manually verified', metres: coverage.metres.manuallyVerified, percent: coverage.percentOfNetwork.manuallyVerified },
    { measure: 'AI-assessed from imagery', metres: coverage.metres.aiAssessed, percent: coverage.percentOfNetwork.aiAssessed },
    { measure: 'OSM metadata only', metres: coverage.metres.osmOnly, percent: coverage.percentOfNetwork.osmOnly },
    { measure: 'Stale evidence', metres: coverage.metres.stale, percent: coverage.percentOfNetwork.stale },
    { measure: 'Classified accessible', metres: coverage.metres.byStatus.accessible, percent: coverage.percentOfNetwork.accessible },
    { measure: 'Classified partial', metres: coverage.metres.byStatus.partial, percent: coverage.percentOfNetwork.partial },
    { measure: 'Classified inaccessible', metres: coverage.metres.byStatus.inaccessible, percent: coverage.percentOfNetwork.inaccessible }
  ];

  const csv = toCsv(rows, [
    { key: 'measure', label: 'Measure' },
    { key: 'metres', label: 'Metres of network' },
    { key: 'percent', label: '% of network' }
  ]);

  const result = await saveExport(regionId, 'coverage.csv', csv, 'text/csv; charset=utf-8');
  await writeAudit({ actor, action: AuditAction.EXPORT_GENERATED, targetType: 'region', targetId: regionId, next: { type: 'coverage-csv' } });
  return { ...result, rows: rows.length };
}

export async function exportSegmentsGeoJson(regionId, actor) {
  const snap = await db.collection(COLLECTIONS.segments).where('regionId', '==', regionId).get();
  const features = snap.docs
    .map((d) => ({ id: d.id, ...decodeSegment(d.data()) }))
    .filter((s) => Array.isArray(s.geometry) && s.geometry.length >= 2)
    .map((s) => {
      const a = s.assessment || {};
      return {
        type: 'Feature',
        id: s.id,
        geometry: { type: 'LineString', coordinates: s.geometry },
        properties: {
          segmentId: s.id,
          osmWayId: s.osmWayId,
          kind: s.kind,
          street: s.streetName,
          lengthMeters: s.lengthMeters,
          status: a.status || SegmentStatus.UNVERIFIED,
          accessibilityScore: a.accessibilityScore ?? null,
          evidenceConfidence: a.evidenceConfidence ?? null,
          freshness: a.freshnessState || null,
          barriers: (a.barriers || []).join('; '),
          positives: (a.positiveFeatures || []).join('; '),
          sources: (a.sources || []).join('; '),
          manuallyVerified: Boolean(s.manualVerification?.at)
        }
      };
    });

  const geojson = {
    type: 'FeatureCollection',
    features,
    metadata: {
      regionId,
      generatedAt: new Date().toISOString(),
      attribution: 'Pedestrian network © OpenStreetMap contributors (ODbL). Accessibility assessment by AccessPafos AI - not an official certification.'
    }
  };

  const result = await saveExport(regionId, 'segments.geojson', JSON.stringify(geojson), 'application/geo+json');
  await writeAudit({ actor, action: AuditAction.EXPORT_GENERATED, targetType: 'region', targetId: regionId, next: { type: 'segments-geojson', features: features.length } });
  return { ...result, rows: features.length };
}
