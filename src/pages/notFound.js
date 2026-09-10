import { el, mount } from '../utils/dom.js';
import { t } from '../i18n/index.js';
import { setHeader, getOutlet } from '../components/appShell.js';
import { emptyState, button } from '../components/ui.js';

export async function render() {
  setHeader({ title: t('app.notFound') });
  mount(getOutlet(), el('div.page', {}, [
    emptyState(
      t('app.notFound'),
      t('app.notFoundBody'),
      el('a.btn.btn--primary', { href: '/' }, t('app.goHome'))
    )
  ]));
  return {};
}
