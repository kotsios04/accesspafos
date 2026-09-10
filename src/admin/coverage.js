/**
 * Coverage.
 *
 * The page that answers "how much of Pafos does this actually cover?" - in
 * metres of pedestrian network, not in segment counts, and including the part
 * that is not covered. A coverage page that only reported successes would be
 * worse than none.
 */

import { el, mount } from '../utils/dom.js';
import { renderAdminShell, activeRegionId } from './shell.js';
import { button, banner, spinner, meter, stat, sectionTitle, statusPill } from '../components/ui.js';
import { formatNetworkLength, formatNumber } from '../utils/format.js';
import { adminCoverage, generateExport } from '../services/api.js';
import { describeError } from '../services/errors.js';
import { toastSuccess, toastError } from '../services/toast.js';
import { SegmentStatus, STATUS_COLORS } from '@shared/constants.js';

export async function render() {
  const exportBtn = button('Export CSV', {
    variant: 'secondary', size: 'sm', icon: 'download',
    onClick: async () => {
      try {
        const result = await generateExport({ kind: 'coverage', regionId: activeRegionId() });
        window.open(result.url, '_blank', 'noopener');
        toastSuccess('Coverage exported.');
      } catch (error) { toastError(describeError(error)); }
    }
  });

  const content = await renderAdminShell({ nav: 'coverage', title: 'Coverage', actions: [exportBtn] });
  if (!content) return {};

  mount(content, spinner());
  try {
    const data = await adminCoverage(activeRegionId());
    mount(content, renderCoverage(data));
  } catch (error) {
    mount(content, banner(describeError(error), { tone: 'danger' }));
  }
  return {};
}

function renderCoverage(data) {
  const m = data.metres;
  const c = data.counts;
  const p = data.percentOfNetwork;

  if (!m.total) {
    return banner('Nothing imported for this region yet.', { tone: 'warning' });
  }

  return el('div.stack-lg', {}, [
    el('section.stack-sm', {}, [
      sectionTitle('Pedestrian network'),
      el('div.metric-grid', {}, [
        stat(formatNetworkLength(m.total), 'Total network'),
        stat(formatNumber(c.total), 'Segments'),
        stat(formatNetworkLength(m.assessed), `Assessed (${p.assessed}%)`),
        stat(formatNetworkLength(m.unknown), `Unknown (${p.unknown}%)`)
      ])
    ]),

    el('section.stack-sm', {}, [
      sectionTitle('How each metre was assessed'),
      el('div.card.stack-sm', {}, [
        meter(`Verified on site — ${formatNetworkLength(m.manuallyVerified)}`, p.manuallyVerified, { suffix: '%', tone: 'accessible' }),
        meter(`Assessed from street imagery — ${formatNetworkLength(m.aiAssessed)}`, p.aiAssessed, { suffix: '%' }),
        meter(`OpenStreetMap metadata only — ${formatNetworkLength(m.osmOnly)}`, p.osmOnly, { suffix: '%', tone: 'partial' }),
        meter(`No usable evidence — ${formatNetworkLength(m.unknown)}`, p.unknown, { suffix: '%', tone: 'unknown' }),
        el('div.divider'),
        meter(`Evidence out of date — ${formatNetworkLength(m.stale)}`, p.stale, { suffix: '%', tone: 'inaccessible' })
      ]),
      el('p.xs.muted', {}, 'Measured in metres of pedestrian network. A hundred five-metre crossing stubs are not the same amount of city as a hundred long streets, so segment counts alone would mislead.')
    ]),

    el('section.stack-sm', {}, [
      sectionTitle('Classification'),
      el('div.card.stack-sm', {}, [SegmentStatus.ACCESSIBLE, SegmentStatus.PARTIAL, SegmentStatus.INACCESSIBLE, SegmentStatus.UNVERIFIED]
        .map((status) => el('div', {}, [
          el('div.row.row--between', { style: { marginBottom: '4px' } }, [
            statusPill(status),
            el('span.small', {}, `${formatNetworkLength(m.byStatus[status] || 0)} · ${formatNumber(c.byStatus[status] || 0)} segments`)
          ]),
          el('div.meter__track', {}, el('div.meter__fill', {
            style: {
              width: `${((m.byStatus[status] || 0) / Math.max(1, m.total)) * 100}%`,
              background: STATUS_COLORS[status]
            }
          }))
        ])))
    ]),

    el('section.stack-sm', {}, [
      sectionTitle('Imagery and inspection'),
      el('div.metric-grid', {}, [
        stat(formatNumber(c.withImagery || 0), 'Segments with selected imagery'),
        stat(formatNumber(c.needsInspection || 0), 'Flagged for site inspection'),
        stat(formatNumber(c.manuallyVerified || 0), 'Verified segments'),
        stat(formatNumber(c.stale || 0), 'Stale segments')
      ])
    ]),

    el('p.xs.muted', {}, `Generated ${new Date(data.generatedAt).toLocaleString()}.`)
  ]);
}
