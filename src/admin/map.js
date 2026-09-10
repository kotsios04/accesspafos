/**
 * Console map.
 *
 * The same accessibility layer the public sees, with a reviewer's drawer:
 * confirm, correct with a reason, or flag for a site visit. A correction
 * outranks the pipeline and is audited with the previous value.
 */

import { el, mount } from '../utils/dom.js';
import { t } from '../i18n/index.js';
import { renderAdminShell, activeRegionId } from './shell.js';
import { icon } from '../components/icons.js';
import { button, banner, spinner, chip, statusPill, keyValue } from '../components/ui.js';
import { openSheet, closeSheet } from '../components/sheet.js';
import { renderSegmentDetail } from '../components/segmentDetail.js';
import { loadAccessibilityBundle } from '../services/bundle.js';
import { getSegmentDetail, verifySegmentAccessibility, clearSegmentOverride, startAnalysisJob } from '../services/api.js';
import { describeError } from '../services/errors.js';
import { toastSuccess, toastError } from '../services/toast.js';
import { appState } from '../app.js';
import { SegmentStatus, SEGMENT_STATUSES, STATUS_COLORS } from '@shared/constants.js';

export async function render() {
  const content = await renderAdminShell({ nav: 'map', title: 'Accessibility map' });
  if (!content) return {};

  const canvas = el('div', { style: { position: 'absolute', inset: '0' } });
  const mapBox = el('div.admin-map', {}, canvas);
  const chipsRow = el('div.chips');
  const statusSlot = el('div');

  mount(content, el('div.stack', {}, [
    el('div.filter-bar', {}, [chipsRow]),
    statusSlot,
    mapBox,
    el('p.xs.muted', {}, 'Click any segment to review its evidence and record a verification.')
  ]));

  const filters = new Set(['all']);
  let map = null;
  let layers = null;
  let mapModule = null;
  let destroyed = false;

  renderChips();
  mount(statusSlot, spinner());

  try {
    mapModule = await import('../maps/map.js');
    layers = await import('../maps/layers.js');
    if (destroyed) return { destroy: teardown };

    map = await mapModule.createMap(canvas, { ariaLabel: 'Municipal accessibility map' });
    await mapModule.whenReady(map);
    if (destroyed) return { destroy: teardown };

    const region = appState.bootstrap?.regions?.find((r) => r.id === activeRegionId());
    const bundle = region ? await loadAccessibilityBundle(region) : null;

    if (!bundle) {
      mount(statusSlot, banner('No published map bundle for this region yet. Publish one from Data ingestion.', { tone: 'warning' }));
    } else {
      layers.addAccessibilityLayer(map, bundle);
      if (region.bbox) mapModule.fitToBbox(map, region.bbox, 30);
      mount(statusSlot);
      map.on('click', layers.LAYER_HITBOX, (event) => {
        const id = event.features?.[0]?.properties?.id;
        if (id) openSegment(id);
      });
      map.on('mouseenter', layers.LAYER_HITBOX, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layers.LAYER_HITBOX, () => { map.getCanvas().style.cursor = ''; });
    }
  } catch (error) {
    mount(statusSlot, banner(describeError(error), { tone: 'danger' }));
  }

  function renderChips() {
    const options = [
      ['all', 'All'],
      [SegmentStatus.ACCESSIBLE, t('status.accessible')],
      [SegmentStatus.PARTIAL, t('status.partial')],
      [SegmentStatus.INACCESSIBLE, t('status.inaccessible')],
      [SegmentStatus.UNVERIFIED, t('status.unverified')],
      ['verified', 'Verified on site'],
      ['recent', 'Recent evidence']
    ];
    mount(chipsRow, options.map(([key, label]) => chip(label, {
      pressed: filters.has(key),
      dotColor: STATUS_COLORS[key],
      onClick: () => {
        if (key === 'all') { filters.clear(); filters.add('all'); }
        else {
          filters.delete('all');
          if (filters.has(key)) filters.delete(key); else filters.add(key);
          if (!filters.size) filters.add('all');
        }
        renderChips();
        applyFilters();
      }
    })));
  }

  function applyFilters() {
    if (!map || !layers) return;
    if (filters.has('all')) { layers.applyFilters(map, {}); return; }
    layers.applyFilters(map, {
      status: SEGMENT_STATUSES.filter((s) => filters.has(s)),
      verifiedOnly: filters.has('verified'),
      recentOnly: filters.has('recent')
    });
  }

  async function openSegment(segmentId) {
    layers?.highlightSegment(map, segmentId);
    const sheet = openSheet({
      title: 'Segment',
      body: spinner(),
      onClose: () => layers?.highlightSegment(map, null)
    });

    try {
      const detail = await getSegmentDetail(segmentId);
      sheet.setTitle(detail.segment.streetName || t('segment.unnamed'));
      sheet.setBody([
        reviewerPanel(detail, sheet),
        el('div.divider'),
        renderSegmentDetail(detail, {})
      ]);
    } catch (error) {
      sheet.setBody(banner(describeError(error), { tone: 'danger' }));
    }
  }

  function reviewerPanel(detail, sheet) {
    const feedback = el('div');
    const notes = el('textarea.textarea', {
      placeholder: 'Why? (required when correcting a classification)'
    });
    const statusSelect = el('select.select', {},
      SEGMENT_STATUSES.map((s) => el('option', {
        value: s, selected: s === detail.assessment?.status
      }, t(`status.${s}`))));

    const act = async (result) => {
      mount(feedback, spinner());
      try {
        const outcome = await verifySegmentAccessibility({
          segmentId: detail.segment.id,
          result,
          status: result === 'corrected' ? statusSelect.value : undefined,
          notes: notes.value.trim()
        });
        toastSuccess(`Recorded. Segment is now "${t(`status.${outcome.status}`)}".`);
        closeSheet();
      } catch (error) {
        mount(feedback, banner(describeError(error), { tone: 'danger' }));
      }
    };

    return el('div.card.stack-sm', {}, [
      el('div.row', {}, [icon('shield', 17), el('span.strong.small', {}, 'Municipal verification')]),
      detail.segment.manualVerification
        ? banner(
          `Already verified (${detail.segment.manualVerification.result}) on ${new Date(
            detail.segment.manualVerification.at?.seconds
              ? detail.segment.manualVerification.at.seconds * 1000
              : detail.segment.manualVerification.at
          ).toLocaleDateString()}.`,
          { tone: 'info' }
        )
        : null,
      el('div.field', {}, [el('span.field__label', {}, 'Correct classification to'), statusSelect]),
      el('div.field', {}, [el('span.field__label', {}, 'Notes'), notes]),
      feedback,
      el('div.row.row--wrap', { style: { gap: '8px' } }, [
        button('Confirm as-is', { variant: 'primary', size: 'sm', icon: 'check', onClick: () => act('confirmed') }),
        button('Correct', { variant: 'secondary', size: 'sm', onClick: () => act('corrected') }),
        button('Needs inspection', { variant: 'ghost', size: 'sm', icon: 'warning', onClick: () => act('needs_inspection') })
      ]),
      detail.segment.manualVerification
        ? button('Clear override', {
          variant: 'ghost', size: 'sm',
          onClick: async () => {
            try {
              await clearSegmentOverride({ segmentId: detail.segment.id, notes: notes.value.trim() });
              toastSuccess('Override cleared. The engine is back in charge of this segment.');
              closeSheet();
            } catch (error) { toastError(describeError(error)); }
          }
        })
        : null,
      button('Re-run AI on this segment', {
        variant: 'ghost', size: 'sm', icon: 'refresh',
        onClick: async () => {
          try {
            await startAnalysisJob({
              regionId: activeRegionId(),
              segmentIds: [detail.segment.id],
              forceReanalysis: true,
              limit: 3
            });
            toastSuccess('Re-analysis queued for this segment.');
          } catch (error) { toastError(describeError(error)); }
        }
      })
    ]);
  }

  function teardown() {
    destroyed = true;
    closeSheet({ silent: true });
    if (map) { map.remove(); map = null; }
  }

  return { destroy: teardown };
}
