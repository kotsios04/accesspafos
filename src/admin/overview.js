/**
 * Console overview.
 *
 * Every figure here is read from the live database. There are no illustrative
 * numbers and no placeholder charts: if nothing has been imported, this page
 * says so and points at the ingestion screen.
 */

import { el, mount } from '../utils/dom.js';
import { renderAdminShell, activeRegionId } from './shell.js';
import {
  stat, banner, spinner, sectionTitle, meter, statusPill, kpiCard, sectionHead
} from '../components/ui.js';
import { icon } from '../components/icons.js';
import { formatNetworkLength, formatNumber } from '../utils/format.js';
import { adminOverview } from '../services/api.js';
import { describeError } from '../services/errors.js';
import { track } from '../services/analytics.js';
import { SegmentStatus, STATUS_COLORS } from '@shared/constants.js';

export async function render() {
  const content = await renderAdminShell({ nav: 'overview', title: 'Overview' });
  if (!content) return {};

  mount(content, spinner());
  track('admin_opened');

  try {
    const data = await adminOverview(activeRegionId());
    mount(content, renderOverview(data));
  } catch (error) {
    mount(content, banner(describeError(error), { tone: 'danger' }));
  }

  return {};
}

function renderOverview(data) {
  const counts = data.counts || {};
  const metres = data.metres || {};
  const pct = data.percentOfNetwork || {};

  if (!counts.total) {
    return el('div.stack', {}, [
      banner('No pedestrian network has been imported for this region yet.', { tone: 'warning' }),
      el('a.btn.btn--primary', { href: '/admin/ingestion' }, [icon('download', 18), 'Go to data ingestion'])
    ]);
  }

  return el('div.stack-lg', {}, [
    integrationWarnings(data.integrations),

    el('div.admin-page-head', {}, [
      el('div', {}, [
        el('h2.admin-page-head__title', {}, 'Network overview'),
        el('p.admin-page-head__sub', {},
          'Every figure on this page is read from the live database for the selected region. '
          + 'Nothing here is estimated, and no figure is shown for data that has not been imported.')
      ]),
      el('div.admin-page-head__actions', {}, [
        el('a.btn.btn--secondary.btn--sm', { href: '/admin/coverage' }, 'Coverage detail'),
        el('a.btn.btn--accent.btn--sm', { href: '/admin/ingestion' }, 'Data ingestion')
      ])
    ]),

    // Four headline figures. No period-over-period trend is shown: the
    // pipeline does not yet retain historical snapshots to compare against,
    // and a made-up "+12% this month" would be exactly the kind of claim this
    // product exists to avoid.
    el('div.metric-grid', {}, [
      kpiCard('Pedestrian network', formatNetworkLength(metres.total),
        { iconName: 'layers', tone: 'brand', foot: `${formatNumber(counts.total)} segments` }),
      kpiCard('Assessed', `${pct.assessed ?? 0}%`,
        { iconName: 'check', tone: 'accessible', foot: `${formatNumber(counts.assessed)} segments` }),
      kpiCard('Barriers found', formatNumber(
        (counts.byStatus?.[SegmentStatus.INACCESSIBLE] || 0) + (counts.byStatus?.[SegmentStatus.PARTIAL] || 0)),
      { iconName: 'warning', tone: 'inaccessible', foot: `${formatNumber(data.criticalIssues || 0)} critical` }),
      kpiCard('Not enough evidence', `${pct.unknown ?? 0}%`,
        { iconName: 'eye', tone: 'unverified', foot: `${formatNumber(counts.unknown)} segments` })
    ]),

    el('div.admin-split', {}, [
      el('div.stack-lg', {}, [
        el('section', {}, [
          sectionHead('Classification', { sub: 'Share of the network in each of the four states, by length.' }),
          el('div.card.stack-sm', {}, [
            statusRow(SegmentStatus.ACCESSIBLE, counts, metres, pct.accessible),
            statusRow(SegmentStatus.PARTIAL, counts, metres, pct.partial),
            statusRow(SegmentStatus.INACCESSIBLE, counts, metres, pct.inaccessible),
            statusRow(SegmentStatus.UNVERIFIED, counts, metres, pct.unknown)
          ])
        ]),

        el('section', {}, [
          sectionHead('Evidence quality', { sub: 'What each assessment is actually based on.' }),
          el('div.card.stack-sm', {}, [
            meter('Assessed share of network', pct.assessed, { suffix: '%', tone: 'accessible' }),
            meter('Verified on site', pct.manuallyVerified, { suffix: '%' }),
            meter('Assessed from imagery', pct.aiAssessed, { suffix: '%' }),
            meter('OSM metadata only', pct.osmOnly, { suffix: '%', tone: 'partial' }),
            meter('Evidence out of date', pct.stale, { suffix: '%', tone: 'inaccessible' })
          ])
        ])
      ]),

      el('aside.admin-rail', {}, [
        el('section', {}, [
          sectionTitle('Work queue'),
          el('div.card.stack-sm', {}, [
            queueRow('Reports awaiting review', data.pendingReports || 0, '/admin/reports', 'flag'),
            queueRow('Critical priority issues', data.criticalIssues || 0, '/admin/priorities', 'warning'),
            queueRow('Flagged for inspection', counts.needsInspection || 0, '/admin/map', 'eye'),
            queueRow('Stale evidence', counts.stale || 0, '/admin/coverage', 'clock')
          ])
        ]),

        el('section', {}, [
          sectionTitle('AI usage'),
          aiUsagePanel(data.aiUsage, data.aiAnalysesThisWeek)
        ])
      ])
    ])
  ]);
}

function queueRow(label, count, href, iconName) {
  return el('a.alert-row', { href }, [
    el('span.icon-badge.icon-badge--sm', { 'aria-hidden': 'true' }, icon(iconName, 15)),
    el('div.alert-row__body', {}, el('div.alert-row__title', {}, label)),
    el('span.strong', {}, formatNumber(count))
  ]);
}

function statusRow(status, counts, metres, percent) {
  const count = counts.byStatus?.[status] || 0;
  const length = metres.byStatus?.[status] || 0;
  return el('div', {}, [
    el('div.row.row--between', { style: { marginBottom: '4px' } }, [
      statusPill(status),
      el('span.small', {}, `${formatNumber(count)} · ${formatNetworkLength(length)} · ${percent ?? 0}%`)
    ]),
    el('div.meter__track', {}, [
      el('div.meter__fill', {
        style: { width: `${percent || 0}%`, background: STATUS_COLORS[status] }
      })
    ])
  ]);
}

function aiUsagePanel(usage, thisWeek) {
  if (!usage) return el('p.small.muted', {}, 'No AI usage recorded.');
  const remaining = usage.remaining ?? 0;
  const tone = remaining === 0 ? 'inaccessible' : remaining < usage.limit * 0.2 ? 'partial' : 'accessible';
  return el('div.card.stack-sm', {}, [
    el('div.stats', {}, [
      stat(formatNumber(usage.calls || 0), 'Model calls today'),
      stat(formatNumber(usage.cached || 0), 'Served from cache today'),
      stat(formatNumber(thisWeek || 0), 'Model calls this week'),
      stat(formatNumber(remaining), 'Remaining today')
    ]),
    meter(`Daily budget (${usage.reserved || 0} / ${usage.limit})`,
      usage.limit ? ((usage.reserved || 0) / usage.limit) * 100 : 0,
      { suffix: '%', tone }),
    el('p.xs.muted', {}, 'Analysis is capped per job and per day, and identical evidence is never analysed twice.')
  ]);
}

function integrationWarnings(integrations) {
  if (!integrations) return null;
  const missing = [];
  if (!integrations.mapillary) missing.push('MAPILLARY_ACCESS_TOKEN');
  if (!integrations.gemini) missing.push('GEMINI_API_KEY');
  if (!missing.length) return null;

  return banner(
    `${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not configured. ` +
    'Imagery discovery and AI analysis are unavailable until the secret is added to Secret Manager and the functions redeployed. Everything else works.',
    { tone: 'warning' }
  );
}
