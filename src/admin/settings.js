/**
 * Console settings.
 *
 * A small, explicitly-allowed set of thresholds a municipality can tune
 * without a redeploy. Moving MIN_CONFIDENCE_TO_CLASSIFY is a policy decision
 * about how confidently this system is allowed to speak, so every change is
 * audited with its previous value.
 */

import { el, mount } from '../utils/dom.js';
import { renderAdminShell } from './shell.js';
import { button, banner, spinner, sectionTitle, field, keyValue, stat } from '../components/ui.js';
import { getConfiguration, setConfiguration, getAiUsage } from '../services/api.js';
import { listAuditLog } from '../services/db.js';
import { describeError } from '../services/errors.js';
import { toastSuccess } from '../services/toast.js';
import { formatDateTime, formatNumber } from '../utils/format.js';
import { isMunicipalityAdmin } from '../services/auth.js';

export async function render() {
  const content = await renderAdminShell({ nav: 'settings', title: 'Settings' });
  if (!content) return {};

  if (!isMunicipalityAdmin()) {
    mount(content, banner('Only a municipality administrator can change these settings.', { tone: 'warning' }));
    return {};
  }

  mount(content, spinner());

  try {
    const [config, usage, audit] = await Promise.all([
      getConfiguration(),
      getAiUsage(14).catch(() => null),
      listAuditLog({ pageSize: 25 }).catch(() => [])
    ]);
    mount(content, renderSettings(config, usage, audit));
  } catch (error) {
    mount(content, banner(describeError(error), { tone: 'danger' }));
  }

  return {};

  function renderSettings(config, usage, audit) {
    const effective = config.effective;
    const feedback = el('div');

    const inputs = {
      ACCESSIBLE_THRESHOLD: numberInput('accessible-threshold', effective.ACCESSIBLE_THRESHOLD, 0, 100),
      PARTIAL_THRESHOLD: numberInput('partial-threshold', effective.PARTIAL_THRESHOLD, 0, 100),
      MIN_CONFIDENCE_TO_CLASSIFY: numberInput('min-confidence', effective.MIN_CONFIDENCE_TO_CLASSIFY, 0, 100),
      MAX_IMAGES_PER_SEGMENT: numberInput('max-images', effective.MAX_IMAGES_PER_SEGMENT, 1, 10),
      MAX_AI_ANALYSES_PER_JOB: numberInput('max-job', effective.MAX_AI_ANALYSES_PER_JOB, 1, 1000),
      MAX_AI_ANALYSES_PER_DAY: numberInput('max-day', effective.MAX_AI_ANALYSES_PER_DAY, 0, 5000)
    };

    return el('div.stack-lg', {}, [
      el('section.stack-sm', {}, [
        sectionTitle('Classification thresholds'),
        el('div.card.stack-sm', {}, [
          field('Accessible at or above', inputs.ACCESSIBLE_THRESHOLD, {
            id: 'accessible-threshold', hint: 'Score at which a segment is shown green.'
          }),
          field('Partial at or above', inputs.PARTIAL_THRESHOLD, {
            id: 'partial-threshold', hint: 'Must be below the accessible threshold.'
          }),
          field('Minimum confidence to classify at all', inputs.MIN_CONFIDENCE_TO_CLASSIFY, {
            id: 'min-confidence',
            hint: 'Below this, a segment stays grey whatever its score. Lowering it makes the map more colourful and less honest.'
          })
        ])
      ]),

      el('section.stack-sm', {}, [
        sectionTitle('Cost limits'),
        el('div.card.stack-sm', {}, [
          field('Maximum images analysed per segment', inputs.MAX_IMAGES_PER_SEGMENT, { id: 'max-images' }),
          field('Maximum analyses per job', inputs.MAX_AI_ANALYSES_PER_JOB, { id: 'max-job' }),
          field('Maximum analyses per day', inputs.MAX_AI_ANALYSES_PER_DAY, { id: 'max-day' })
        ])
      ]),

      feedback,
      button('Save settings', {
        variant: 'primary',
        onClick: async () => {
          mount(feedback, spinner());
          try {
            const values = {};
            for (const [key, input] of Object.entries(inputs)) values[key] = Number(input.value);
            await setConfiguration(values);
            toastSuccess('Settings saved and recorded in the audit log.');
            mount(feedback, banner('Saved. Run a recalculation for the change to take effect on existing segments.', { tone: 'info' }));
          } catch (error) {
            mount(feedback, banner(describeError(error), { tone: 'danger' }));
          }
        }
      }),

      usage ? el('section.stack-sm', {}, [
        sectionTitle('AI usage (last 14 days)'),
        el('div.metric-grid', {}, [
          stat(formatNumber(usage.today.calls), 'Calls today'),
          stat(formatNumber(usage.today.cached), 'Cached today'),
          stat(formatNumber(usage.today.remaining), 'Budget remaining'),
          stat(formatNumber(usage.history.reduce((s, d) => s + d.calls, 0)), 'Calls in 14 days')
        ]),
        el('div.table-wrap', {}, el('table.data', {}, [
          el('thead', {}, el('tr', {}, [
            el('th', {}, 'Day'), el('th', {}, 'Calls'), el('th', {}, 'Cached'), el('th', {}, 'Failed')
          ])),
          el('tbody', {}, usage.history.map((row) => el('tr', {}, [
            el('td', {}, row.day),
            el('td.num', {}, String(row.calls)),
            el('td.num', {}, String(row.cached)),
            el('td.num', {}, String(row.failed))
          ])))
        ]))
      ]) : null,

      el('section.stack-sm', {}, [
        sectionTitle('Runtime configuration in force'),
        el('div.card', {}, keyValue([
          ['Assessment version', effective.ASSESSMENT_VERSION],
          ['Analysis version', effective.ANALYSIS_VERSION],
          ['AI model', effective.AI_MODEL],
          ['Functions region', effective.APP_REGION],
          ['Demo mode', String(effective.DEMO_MODE)]
        ]))
      ]),

      audit.length ? el('section.stack-sm', {}, [
        sectionTitle('Audit log'),
        el('div.card', {}, audit.map((entry) => el('div.audit-entry', {}, [
          el('span.audit-entry__when', {}, formatDateTime(entry.createdAt)),
          el('div', {}, [
            el('div.small.strong', {}, entry.action),
            el('div.xs.muted', {}, `${entry.actorEmail || entry.actorUid} · ${entry.targetType}${entry.targetId ? ` ${entry.targetId}` : ''}`)
          ])
        ])))
      ]) : null
    ]);
  }

  function numberInput(id, value, min, max) {
    return el('input.input', { id, type: 'number', value: String(value ?? ''), min: String(min), max: String(max) });
  }
}
