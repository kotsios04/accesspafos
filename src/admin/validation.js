/**
 * Validation: measuring the system honestly.
 *
 * A reviewer records what is actually true for a segment; the system compares
 * that with what it predicted at the moment of labelling. Accuracy is only
 * ever shown with its sample size, and below thirty labels it is explicitly
 * marked as indicative.
 */

import { el, mount } from '../utils/dom.js';
import { t } from '../i18n/index.js';
import { renderAdminShell, activeRegionId } from './shell.js';
import { button, banner, spinner, emptyState, stat, sectionTitle, statusPill, keyValue } from '../components/ui.js';
import { openSheet, closeSheet } from '../components/sheet.js';
import { getValidation, recordValidationLabel } from '../services/api.js';
import { describeError } from '../services/errors.js';
import { toastSuccess } from '../services/toast.js';
import { SegmentStatus, Barrier } from '@shared/constants.js';

const LABELLABLE = [SegmentStatus.ACCESSIBLE, SegmentStatus.PARTIAL, SegmentStatus.INACCESSIBLE];
const BARRIERS = Object.values(Barrier);

export async function render() {
  const content = await renderAdminShell({ nav: 'validation', title: 'Validation' });
  if (!content) return {};

  mount(content, spinner());
  await load();
  return { destroy: () => closeSheet({ silent: true }) };

  async function load() {
    try {
      const { metrics, targets } = await getValidation(activeRegionId());
      mount(content, el('div.stack-lg', {}, [
        metricsSection(metrics),
        targetsSection(targets)
      ]));
    } catch (error) {
      mount(content, banner(describeError(error), { tone: 'danger' }));
    }
  }

  function metricsSection(metrics) {
    if (!metrics.sampleSize) {
      return el('div.stack-sm', {}, [
        sectionTitle('Agreement with human labels'),
        banner(metrics.message, { tone: 'neutral' }),
        el('p.small.muted', {}, 'Label some segments below and a measured agreement figure will appear here. Until then this page deliberately shows no number: an unmeasured accuracy claim would be worse than none.')
      ]);
    }

    return el('div.stack-sm', {}, [
      sectionTitle('Agreement with human labels'),
      metrics.caveat ? banner(metrics.caveat, { tone: 'warning' }) : null,
      el('div.metric-grid', {}, [
        stat(metrics.statusAgreement != null ? `${Math.round(metrics.statusAgreement * 100)}%` : '—', 'Status agreement'),
        stat(String(metrics.classifiedSampleSize), 'Labelled & classified'),
        stat(String(metrics.optimisticErrors), 'Optimistic errors'),
        stat(String(metrics.pessimisticErrors), 'Pessimistic errors')
      ]),
      el('p.xs.muted', {}, 'An "optimistic error" is the system claiming a street is better than it is. Those are the failures that can strand somebody, so they are counted separately.'),

      metrics.confusion ? confusionTable(metrics.confusion) : null,
      metrics.barrierMetrics?.length ? barrierTable(metrics.barrierMetrics) : null
    ]);
  }

  function confusionTable(confusion) {
    const columns = [...LABELLABLE, SegmentStatus.UNVERIFIED];
    return el('div.stack-sm', {}, [
      el('p.small.strong', {}, 'Predicted vs. actual'),
      el('div.table-wrap', {}, el('table.data', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, 'Actual \\ Predicted'),
          ...columns.map((c) => el('th', {}, t(`status.${c}`)))
        ])),
        el('tbody', {}, LABELLABLE.map((truth) => el('tr', {}, [
          el('td', {}, statusPill(truth)),
          ...columns.map((predicted) => el('td.num', {
            style: truth === predicted ? { fontWeight: '700', background: 'var(--accessible-soft)' } : {}
          }, String(confusion[truth]?.[predicted] ?? 0)))
        ])))
      ]))
    ]);
  }

  function barrierTable(rows) {
    return el('div.stack-sm', {}, [
      el('p.small.strong', {}, 'Per-barrier detection'),
      el('div.table-wrap', {}, el('table.data', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, 'Barrier'), el('th', {}, 'TP'), el('th', {}, 'FP'), el('th', {}, 'FN'),
          el('th', {}, 'Precision'), el('th', {}, 'Recall')
        ])),
        el('tbody', {}, rows.map((row) => el('tr', {}, [
          el('td', {}, t(`barrier.${row.barrier}`) || row.barrier),
          el('td.num', {}, String(row.tp)),
          el('td.num', {}, String(row.fp)),
          el('td.num', {}, String(row.fn)),
          el('td.num', {}, row.precision != null ? row.precision.toFixed(2) : '—'),
          el('td.num', {}, row.recall != null ? row.recall.toFixed(2) : '—')
        ])))
      ]))
    ]);
  }

  function targetsSection(targets) {
    return el('div.stack-sm', {}, [
      sectionTitle('Segments worth labelling next'),
      el('p.small.muted', {}, 'Lowest-confidence classified segments first — the sample tests the pipeline where it is weakest, not where it is obviously right.'),
      targets.length
        ? el('div.stack-sm', {}, targets.map((target) => el('button.card.card--interactive', {
          type: 'button', onClick: () => openLabeller(target)
        }, [
          el('div.row.row--between', {}, [
            el('div', {}, [
              el('div.card__title', {}, target.streetName || 'Unnamed segment'),
              el('div.card__meta', {}, target.segmentId)
            ]),
            el('div.row', { style: { gap: '6px' } }, [
              statusPill(target.status),
              el('span.pill.pill--neutral', {}, `conf ${target.evidenceConfidence}`)
            ])
          ])
        ])))
        : emptyState('Nothing left to label in this region.')
    ]);
  }

  function openLabeller(target) {
    const feedback = el('div');
    let trueStatus = null;
    const selectedBarriers = new Set();
    const notes = el('textarea.textarea', { placeholder: 'What did you observe? (optional)' });

    const statusButtons = el('div.option-list', {}, LABELLABLE.map((status) => {
      const btn = el('button.option', {
        type: 'button',
        onClick: () => {
          trueStatus = status;
          for (const node of statusButtons.children) node.style.borderColor = 'var(--border-strong)';
          btn.style.borderColor = 'var(--brand)';
        }
      }, [statusPill(status), el('span.option__desc', {}, t(`status.${status}Desc`))]);
      return btn;
    }));

    openSheet({
      title: target.streetName || 'Label segment',
      body: el('div.stack', {}, [
        keyValue([
          ['Segment', target.segmentId],
          ['System says', t(`status.${target.status}`)],
          ['System score', target.accessibilityScore ?? '—'],
          ['System confidence', target.evidenceConfidence ?? '—']
        ]),
        el('div.field', {}, [
          el('span.field__label', {}, 'What is actually true?'),
          statusButtons
        ]),
        el('div.field', {}, [
          el('span.field__label', {}, 'Barriers actually present'),
          el('div.tag-list', {}, BARRIERS.map((barrier) => {
            const button = el('button.chip', {
              type: 'button', 'aria-pressed': 'false',
              onClick: () => {
                const pressed = button.getAttribute('aria-pressed') === 'true';
                button.setAttribute('aria-pressed', String(!pressed));
                if (pressed) selectedBarriers.delete(barrier); else selectedBarriers.add(barrier);
              }
            }, t(`barrier.${barrier}`));
            return button;
          }))
        ]),
        el('div.field', {}, [el('span.field__label', {}, 'Notes'), notes]),
        feedback
      ]),
      footer: [
        button('Save label', {
          variant: 'primary', block: true,
          onClick: async () => {
            if (!trueStatus) {
              mount(feedback, banner('Choose what is actually true first.', { tone: 'warning' }));
              return;
            }
            mount(feedback, spinner());
            try {
              await recordValidationLabel({
                segmentId: target.segmentId,
                trueStatus,
                trueBarriers: [...selectedBarriers],
                notes: notes.value.trim()
              });
              toastSuccess('Ground-truth label recorded.');
              closeSheet();
              load();
            } catch (error) {
              mount(feedback, banner(describeError(error), { tone: 'danger' }));
            }
          }
        })
      ]
    });
  }
}
