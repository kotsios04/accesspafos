import { el, mount } from '../utils/dom.js';
import { t } from '../i18n/index.js';
import { setHeader, getOutlet } from '../components/appShell.js';
import { banner, button } from '../components/ui.js';
import { describeError } from '../services/errors.js';

export async function render({ error }) {
  setHeader({ title: t('error.generic') });
  mount(getOutlet(), el('div.page.stack', {}, [
    banner(describeError(error), { tone: 'danger' }),
    button(t('app.retry'), { variant: 'primary', block: true, onClick: () => window.location.reload() }),
    el('a.btn.btn--ghost.btn--block', { href: '/' }, t('app.goHome'))
  ]));
  return {};
}
