/**
 * A segment as a full page, so any street's evidence has a shareable URL.
 * The sheet on the map and this page render the same component.
 */

import { el, mount } from '../utils/dom.js';
import { t } from '../i18n/index.js';
import { setHeader, getOutlet, backButton } from '../components/appShell.js';
import { spinner, banner } from '../components/ui.js';
import { renderSegmentDetail } from '../components/segmentDetail.js';
import { getSegmentDetail } from '../services/api.js';
import { describeError } from '../services/errors.js';
import { navigate } from '../router/index.js';
import { appState } from '../app.js';

export async function render({ params }) {
  setHeader({ title: t('segment.title'), left: backButton() });
  const container = el('div.page.stack');
  mount(getOutlet(), container);
  mount(container, spinner());

  try {
    const detail = await getSegmentDetail(params.id);
    setHeader({ title: detail.segment.streetName || t('segment.unnamed'), left: backButton() });
    mount(container, [
      renderSegmentDetail(detail, {
        onReport: (segment) => {
          appState.pendingReportLocation = segment.centre
            ? { lat: segment.centre[1], lng: segment.centre[0] }
            : null;
          navigate('/report');
        }
      }),
      el('a.btn.btn--ghost.btn--block', { href: `/map?segment=${encodeURIComponent(params.id)}` },
        t('nav.map'))
    ]);
  } catch (error) {
    mount(container, banner(describeError(error), { tone: 'danger' }));
  }

  return {};
}
