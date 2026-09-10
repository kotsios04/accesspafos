/**
 * Municipal priority queue.
 *
 * The ranking is only useful if it can be argued with, so every row opens a
 * full breakdown: which factor contributed how many points, out of what
 * maximum, and on what evidence. A public works manager can disagree with the
 * weighting - and then change it in Settings.
 */

import { el, mount } from '../utils/dom.js';
import { t } from '../i18n/index.js';
import { renderAdminShell, activeRegionId } from './shell.js';
import { icon } from '../components/icons.js';
import { button, banner, spinner, emptyState, statusPill, keyValue, meter } from '../components/ui.js';
import { openSheet, closeSheet } from '../components/sheet.js';
import { formatDistance, formatDate } from '../utils/format.js';
import { listPriorityIssues } from '../services/db.js';
import { updateIssueStatus, generateExport } from '../services/api.js';
import { describeError } from '../services/errors.js';
import { toastSuccess } from '../services/toast.js';
import { IssueStatus } from '@shared/constants.js';

const WORKFLOW = [
  IssueStatus.NEW, IssueStatus.NEEDS_REVIEW, IssueStatus.VERIFIED,
  IssueStatus.ASSIGNED, IssueStatus.IN_PROGRESS, IssueStatus.RESOLVED, IssueStatus.REJECTED
];

export async function render() {
  const exportBtn = button('Export CSV', {
    variant: 'secondary', size: 'sm', icon: 'download',
    onClick: async () => {
      try {
        const result = await generateExport({ kind: 'issues', regionId: activeRegionId() });
        window.open(result.url, '_blank', 'noopener');
        toastSuccess(`${result.rows} issues exported.`);
      } catch (error) {
        toastSuccess(describeError(error));
      }
    }
  });

  const content = await renderAdminShell({
    nav: 'priorities', title: 'Priority issues', actions: [exportBtn]
  });
  if (!content) return {};

  const state = { status: '', band: '' };
  const table = el('div');

  const statusSelect = el('select.select', {
    'aria-label': 'Workflow status',
    onChange: (e) => { state.status = e.target.value; load(); }
  }, [
    el('option', { value: '' }, 'All statuses'),
    ...WORKFLOW.map((s) => el('option', { value: s }, s.replace(/_/g, ' ')))
  ]);

  const bandSelect = el('select.select', {
    'aria-label': 'Priority band',
    onChange: (e) => { state.band = e.target.value; load(); }
  }, [
    el('option', { value: '' }, 'All priorities'),
    ...['critical', 'high', 'medium', 'low'].map((b) => el('option', { value: b }, b))
  ]);

  mount(content, el('div.stack', {}, [
    el('div.filter-bar', {}, [statusSelect, bandSelect]),
    table
  ]));

  await load();
  return { destroy: () => closeSheet({ silent: true }) };

  async function load() {
    mount(table, spinner());
    try {
      const issues = await listPriorityIssues({
        regionId: activeRegionId(),
        status: state.status || null,
        band: state.band || null
      });
      if (!issues.length) {
        mount(table, emptyState(
          'No priority issues.',
          'Issues appear here once the pipeline finds an evidenced barrier. Run a recalculation from Data ingestion if you have just imported.'
        ));
        return;
      }
      mount(table, renderTable(issues));
    } catch (error) {
      mount(table, banner(describeError(error), { tone: 'danger' }));
    }
  }

  function renderTable(issues) {
    return el('div.table-wrap', {}, el('table.data', {}, [
      el('thead', {}, el('tr', {}, [
        el('th', {}, 'Priority'),
        el('th', {}, 'Location'),
        el('th', {}, 'Barriers'),
        el('th', {}, 'Impact'),
        el('th', {}, 'Confidence'),
        el('th', {}, 'Reports'),
        el('th', {}, 'Status'),
        el('th', {}, 'Assigned')
      ])),
      el('tbody', {}, issues.map((issue) => el('tr', {
        tabindex: '0',
        role: 'button',
        style: { cursor: 'pointer' },
        onClick: () => openIssue(issue),
        onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openIssue(issue); } }
      }, [
        el('td', {}, el(`span.priority-score.priority-score--${issue.priorityBand}`, {}, String(issue.priorityScore))),
        el('td', {}, [
          el('div.strong', {}, issue.streetName || 'Unnamed'),
          el('div.xs.muted', {}, issue.segmentId)
        ]),
        el('td', {}, (issue.barriers || []).slice(0, 2).map((b) =>
          el('span.pill.pill--inaccessible', { style: { marginRight: '4px' } }, t(`barrier.${b}`)))),
        el('td', {}, issue.detour?.ratio == null
          ? el('span.pill.pill--inaccessible', {}, 'No detour')
          : `${issue.detour.ratio}× detour`),
        el('td.num', {}, `${issue.evidenceConfidence ?? 0}`),
        el('td.num', {}, String(issue.verifiedReportCount || 0)),
        el('td', {}, el('span.pill.pill--neutral', {}, (issue.status || 'new').replace(/_/g, ' '))),
        el('td', {}, issue.assignedDepartment || '—')
      ])))
    ]));
  }

  async function openIssue(issue) {
    const feedback = el('div');
    const department = el('input.input', {
      placeholder: 'e.g. Public Works — Pavements',
      value: issue.assignedDepartment || ''
    });
    const boost = el('input', {
      type: 'range', min: '0', max: '1', step: '0.1',
      value: String(issue.manualBoost || 0),
      style: { width: '100%' }
    });
    const statusSel = el('select.select', {},
      WORKFLOW.map((s) => el('option', { value: s, selected: s === issue.status }, s.replace(/_/g, ' '))));

    openSheet({
      title: issue.streetName || 'Priority issue',
      body: el('div.stack', {}, [
        el('div.row', { style: { gap: '10px' } }, [
          el(`span.priority-score.priority-score--${issue.priorityBand}`, {}, String(issue.priorityScore)),
          statusPill(issue.accessibilityStatus)
        ]),

        el('div.card.stack-sm', {}, [
          el('span.strong.small', {}, 'How this score was reached'),
          ...(issue.breakdown || []).map((factor) => el('div', {}, [
            el('div.row.row--between', { style: { marginBottom: '2px' } }, [
              el('span.small', {}, t(factor.key) !== factor.key ? t(factor.key) : factor.key.replace('priority.', '').replace(/_/g, ' ')),
              el('span.small.strong', {}, `${factor.points} / ${factor.max}`)
            ]),
            el('div.meter__track', {}, el('div.meter__fill', {
              style: { width: `${(factor.points / Math.max(1, factor.max)) * 100}%` }
            }))
          ])),
          el('p.xs.muted', {}, 'Every factor is computed from data the system holds. There is no pedestrian-footfall factor: we do not have that data for Pafos.')
        ]),

        keyValue([
          ['Segment', issue.segmentId],
          ['Accessibility score', issue.accessibilityScore ?? '—'],
          ['Evidence confidence', issue.evidenceConfidence ?? '—'],
          ['Evidence freshness', t(`freshness.${issue.freshnessState || 'none'}`)],
          ['Barriers', (issue.barriers || []).map((b) => t(`barrier.${b}`)).join(', ') || '—'],
          ['Accessible detour', issue.detour?.ratio == null
            ? 'none found — this barrier has no way round'
            : `${issue.detour.ratio}× (${formatDistance(issue.detour.detourMeters)})`],
          ['Nearby services', (issue.nearbyPois || []).map((p) => `${p.class} (${p.distanceMeters} m)`).join(', ') || '—'],
          ['Confirmed reports', issue.verifiedReportCount || 0]
        ]),

        el('div.field', {}, [el('span.field__label', {}, 'Workflow status'), statusSel]),
        el('div.field', {}, [el('span.field__label', {}, 'Assign to department'), department]),
        el('div.field', {}, [
          el('span.field__label', {}, 'Municipal priority boost'),
          boost,
          el('p.field__hint', {}, 'Raises this issue above the computed ranking. Recorded in the audit log with your name.')
        ]),
        feedback
      ]),
      footer: [
        button('Save', {
          variant: 'primary', block: true,
          onClick: async () => {
            mount(feedback, spinner());
            try {
              await updateIssueStatus({
                issueId: issue.id,
                patch: {
                  status: statusSel.value,
                  assignedDepartment: department.value.trim(),
                  manualBoost: Number(boost.value)
                }
              });
              toastSuccess('Issue updated.');
              closeSheet();
              load();
            } catch (error) {
              mount(feedback, banner(describeError(error), { tone: 'danger' }));
            }
          }
        }),
        el('a.btn.btn--ghost', { href: `/segment/${issue.segmentId}`, target: '_blank', rel: 'noopener' }, 'Open segment')
      ]
    });
  }
}
