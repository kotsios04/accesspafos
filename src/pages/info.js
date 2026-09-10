/**
 * The four public information pages: privacy, data sources, methodology and
 * responsible AI. One renderer, content driven, bilingual.
 *
 * These pages are linked from the home screen and from settings, and they are
 * the answer to every "how do you know that?" a reviewer will ask.
 */

import { el, mount } from '../utils/dom.js';
import { t, getLocale } from '../i18n/index.js';
import { setHeader, getOutlet, backButton } from '../components/appShell.js';
import { currentRoutePath } from '../router/index.js';
import en from '../content/pages.en.js';
import elContent from '../content/pages.el.js';

const CONTENT = { en, el: elContent };

const PATH_TO_DOC = {
  '/privacy': 'privacy',
  '/data-sources': 'dataSources',
  '/methodology': 'methodology',
  '/responsible-ai': 'responsibleAi'
};

export async function render() {
  const path = (currentRoutePath() || window.location.pathname).replace(/\/+$/, '') || '/';
  const docKey = PATH_TO_DOC[path] || 'methodology';
  const locale = getLocale();
  const doc = CONTENT[locale]?.[docKey] || CONTENT.en[docKey];

  setHeader({ title: doc.title, left: backButton() });

  mount(getOutlet(), el('div.page', {}, [
    el('article.prose.stack', {}, [
      el('h1', {}, doc.title),
      doc.updated ? el('p.xs.muted', {}, doc.updated) : null,
      ...doc.blocks.map(renderBlock)
    ]),

    el('nav.stack-sm', { style: { marginTop: '2.5rem' }, 'aria-label': doc.title }, [
      el('div.divider'),
      el('div.row.row--wrap', { style: { gap: '8px' } },
        Object.entries(PATH_TO_DOC)
          .filter(([href]) => href !== path)
          .map(([href, key]) => el('a.btn.btn--ghost.btn--sm', { href },
            (CONTENT[locale]?.[key] || CONTENT.en[key]).title)))
    ])
  ]));

  return {};
}

function renderBlock(block) {
  if (block.h2) return el('h2', {}, block.h2);
  if (block.h3) return el('h3', {}, block.h3);
  if (block.p) return el('p', {}, block.p);
  if (block.ul) return el('ul', {}, block.ul.map((item) => el('li', {}, item)));
  return null;
}
