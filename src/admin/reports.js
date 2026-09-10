/**
 * Report review queue.
 *
 * A reviewer sees the location, the category, the description, the AI's
 * structured reading of the photograph, and the photograph itself behind a
 * short-lived signed URL. Then they decide. Nothing about a report reaches
 * the public map until that decision is "verify".
 */

import { el, mount } from '../utils/dom.js';
import { t } from '../i18n/index.js';
import { renderAdminShell, activeRegionId } from './shell.js';
import { icon } from '../components/icons.js';
import { button, banner, spinner, emptyState, keyValue, statusPill } from '../components/ui.js';
import { openSheet, closeSheet } from '../components/sheet.js';
import { formatDateTime, formatDate } from '../utils/format.js';
import { listReports } from '../services/db.js';
import { reviewCitizenReport, getReportPhotoUrl, assignCitizenReport, retryReportAnalysis } from '../services/api.js';
import { describeError } from '../services/errors.js';
import { toastSuccess, toastError } from '../services/toast.js';
import { ReportStatus, REPORT_CATEGORIES } from '@shared/constants.js';

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: ReportStatus.PENDING, label: 'Awaiting review' },
  { value: ReportStatus.NEEDS_REVIEW, label: 'Under review' },
  { value: ReportStatus.VERIFIED, label: 'Confirmed' },
  { value: ReportStatus.REJECTED, label: 'Not confirmed' },
  { value: ReportStatus.DUPLICATE, label: 'Duplicates' },
  { value: ReportStatus.RESOLVED, label: 'Resolved' }
];

export async function render() {
  const content = await renderAdminShell({ nav: 'reports', title: 'Citizen reports' });
  if (!content) return {};

  const state = { status: ReportStatus.PENDING, category: '' };
  const list = el('div.stack-sm');

  const statusSelect = el('select.select', {
    'aria-label': 'Status',
    onChange: (e) => { state.status = e.target.value; load(); }
  }, STATUS_FILTERS.map((f) => el('option', { value: f.value, selected: f.value === state.status }, f.label)));

  const categorySelect = el('select.select', {
    'aria-label': 'Category',
    onChange: (e) => { state.category = e.target.value; load(); }
  }, [
    el('option', { value: '' }, 'All categories'),
    ...REPORT_CATEGORIES.map((c) => el('option', { value: c }, t(`report.category_${c}`)))
  ]);

  mount(content, el('div.stack', {}, [
    el('div.filter-bar', {}, [statusSelect, categorySelect]),
    list
  ]));

  await load();
  return { destroy: () => closeSheet({ silent: true }) };

  async function load() {
    mount(list, spinner());
    try {
      const { items } = await listReports({
        regionId: activeRegionId(),
        status: state.status || null,
        category: state.category || null
      });
      if (!items.length) {
        mount(list, emptyState('No reports match these filters.'));
        return;
      }
      mount(list, items.map(reportRow));
    } catch (error) {
      mount(list, banner(describeError(error), { tone: 'danger' }));
    }
  }

  function reportRow(report) {
    return el('button.card.card--interactive', {
      type: 'button',
      onClick: () => openReport(report)
    }, [
      el('div.row.row--between', {}, [
        el('div', {}, [
          el('div.card__title', {}, t(`report.category_${report.category}`)),
          el('div.card__meta', {}, [
            formatDateTime(report.createdAt),
            report.streetName ? ` · ${report.streetName}` : '',
            report.hasPhoto ? ' · photo' : ''
          ].join(''))
        ]),
        el('span.pill.pill--neutral', {}, t(`report.status_${report.status}`))
      ]),
      report.description
        ? el('p.small.muted', { style: { marginTop: '8px' } }, report.description)
        : null,
      report.duplicateCandidates?.length
        ? el('p.xs', { style: { marginTop: '6px', color: 'var(--partial-ink)' } },
          `${report.duplicateCandidates.length} possible duplicate(s) nearby`)
        : null
    ]);
  }

  async function openReport(report) {
    const photoSlot = el('div');
    const aiSlot = el('div');
    const notes = el('textarea.textarea', { placeholder: 'Reason / notes (required for a correction)' });
    const feedback = el('div');

    const sheet = openSheet({
      title: t(`report.category_${report.category}`),
      body: el('div.stack', {}, [
        keyValue([
          ['Submitted', formatDateTime(report.createdAt)],
          ['Status', t(`report.status_${report.status}`)],
          ['Location', `${report.location.lat.toFixed(5)}, ${report.location.lng.toFixed(5)}`],
          ['Street', report.streetName || '—'],
          ['Segment', report.segmentId || 'not matched'],
          ['Distance to segment', report.segmentDistanceMeters != null ? `${report.segmentDistanceMeters} m` : '—']
        ]),
        report.description ? el('div.card', {}, el('p.small', {}, report.description)) : null,
        photoSlot,
        aiSlot,
        duplicatesPanel(report.duplicateCandidates),
        el('div.field', {}, [el('span.field__label', {}, 'Review notes'), notes]),
        feedback
      ]),
      footer: [
        button('Confirm', {
          variant: 'primary', block: true,
          onClick: () => decide('verify')
        }),
        button('Reject', { variant: 'secondary', onClick: () => decide('reject') })
      ]
    });

    renderAi(report.aiAnalysis);

    if (report.hasPhoto) {
      mount(photoSlot, el('p.small.muted', {}, 'Loading photograph…'));
      try {
        const { url } = await getReportPhotoUrl(report.id);
        mount(photoSlot, el('div.stack-sm', {}, [
          el('img', {
            src: url, alt: 'Photograph submitted with this report',
            style: { borderRadius: 'var(--r-md)', width: '100%' }
          }),
          el('p.xs.muted', {}, 'Not public. Visible to reviewers only, via a link that expires in 15 minutes.')
        ]));
      } catch (error) {
        mount(photoSlot, banner(describeError(error), { tone: 'warning' }));
      }
    }

    /** The model's reading, and the means to disagree with it. */
    function renderAi(analysis) {
      mount(aiSlot, el('div.stack-sm', {}, [
        aiPanel(analysis),
        // Offered whenever there is a photograph, not only after a failure:
        // a confidently wrong reading needs a second pass just as much as a
        // broken one, and more quietly.
        report.hasPhoto
          ? el('div.stack-sm', {}, [
            button('Analyse again', { variant: 'ghost', size: 'sm', icon: 'refresh', onClick: rerun }),
            el('p.xs.muted', {}, 'Reads the photograph again. Advisory only - it never changes the map.')
          ])
          : null
      ]));
    }

    async function rerun() {
      mount(aiSlot, el('div.stack-sm', {}, [
        spinner(),
        el('p.xs.muted', {}, 'Reading the photograph again…')
      ]));
      try {
        const { aiAnalysis } = await retryReportAnalysis(report.id);
        report.aiAnalysis = aiAnalysis;
        renderAi(aiAnalysis);
        if (aiAnalysis?.error) toastError('The model could not read this photograph.');
        else toastSuccess('Photograph analysed again.');
      } catch (error) {
        renderAi(report.aiAnalysis);
        toastError(describeError(error));
      }
    }

    async function decide(decision) {
      mount(feedback, spinner());
      try {
        const result = await reviewCitizenReport({
          reportId: report.id,
          decision,
          notes: notes.value.trim()
        });
        toastSuccess(decision === 'verify'
          ? `Confirmed. Segment re-assessed as "${result.recomputedStatus || 'unchanged'}".`
          : 'Report rejected. Its photograph will be deleted after 30 days.');
        closeSheet();
        load();
      } catch (error) {
        mount(feedback, banner(describeError(error), { tone: 'danger' }));
      }
    }
  }
}

function aiPanel(analysis) {
  if (!analysis) return null;
  if (analysis.error) {
    return banner(`Photo analysis failed: ${analysis.error}`, { tone: 'warning' });
  }
  const observation = analysis.observation;
  if (!observation) return null;

  const rows = [];
  const add = (label, value) => {
    if (value && value !== 'unknown' && value !== 'not_visible') rows.push([label, String(value).replace(/_/g, ' ')]);
  };
  add('Image quality', observation.imageQuality);
  add('Pedestrian path', observation.pedestrianPath?.condition);
  add('Curb ramp', observation.curbRamp?.visible === 'no' ? 'not present' : observation.curbRamp?.condition);
  add('Steps', observation.stairs?.visible === 'yes' ? 'present' : null);
  add('Surface', [observation.surface?.type, observation.surface?.condition].filter((v) => v && v !== 'unknown').join(', '));
  add('Obstacle', observation.obstacle?.severity);
  add('Passage', observation.clearPassage?.classification);

  return el('div.card.stack-sm', {}, [
    el('div.row', {}, [icon('eye', 16), el('span.strong.small', {}, 'AI reading of the photograph')]),
    rows.length ? keyValue(rows) : el('p.small.muted', {}, 'The model could not determine anything from this photograph.'),
    observation.obstacle?.description ? el('p.xs.muted', {}, `“${observation.obstacle.description}”`) : null,
    el('p.xs.muted', {}, `${analysis.model || 'model'} · analysis v${analysis.analysisVersion || '?'} · advisory only; your decision is what counts.`)
  ]);
}

function duplicatesPanel(candidates) {
  if (!candidates?.length) return null;
  return el('div.card.stack-sm', {}, [
    el('span.strong.small', {}, 'Possible duplicates'),
    ...candidates.map((c) => el('div.row.row--between', {}, [
      el('span.small', {}, `${t(`report.category_${c.category}`)} · ${c.distanceMeters} m away · ${c.ageDays}d`),
      el('span.pill.pill--neutral', {}, `${Math.round(c.score * 100)}%`)
    ])),
    el('p.xs.muted', {}, 'Suggestions only. Nothing is merged automatically.')
  ]);
}
