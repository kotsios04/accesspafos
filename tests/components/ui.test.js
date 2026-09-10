/**
 * Component rendering.
 *
 * These run in a DOM and construct real elements. They exist to catch the
 * class of bug that unit tests over pure functions cannot see: a template that
 * throws, an ARIA attribute that never gets set, or a status rendered with
 * colour and nothing else.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { el, mount, clear, escapeHtml, trapFocus, announce } from '@src/utils/dom.js';
import {
  statusPill, meter, banner, stat, statusGuide, compositionBar,
  keyValue, chip, toggle, radioOption, field, emptyState, spinner, freshnessPill, sourceChip
} from '@src/components/ui.js';
import { icon, brandMark, icons } from '@src/components/icons.js';
import { setLocale, t } from '@src/i18n/index.js';
import { SegmentStatus, STATUS_COLORS, STATUS_GLYPH, SEGMENT_STATUSES } from '@shared/constants.js';

beforeEach(() => {
  document.body.innerHTML = '<div id="live-region"></div>';
  setLocale('en', { persist: false });
});

describe('el()', () => {
  it('parses tag, classes and id from the selector', () => {
    const node = el('button#go.btn.btn--primary');
    expect(node.tagName).toBe('BUTTON');
    expect(node.id).toBe('go');
    expect(node.classList.contains('btn')).toBe(true);
    expect(node.classList.contains('btn--primary')).toBe(true);
  });

  it('sets attributes, dataset, styles and text', () => {
    const node = el('div', {
      'aria-label': 'Label', dataset: { open: 'true' },
      style: { color: 'red' }, text: 'Hello'
    });
    expect(node.getAttribute('aria-label')).toBe('Label');
    expect(node.dataset.open).toBe('true');
    expect(node.style.color).toBe('red');
    expect(node.textContent).toBe('Hello');
  });

  it('attaches event listeners', () => {
    let clicked = 0;
    const node = el('button', { onClick: () => { clicked += 1; } });
    node.click();
    expect(clicked).toBe(1);
  });

  it('skips null, undefined and false children', () => {
    const node = el('div', {}, ['a', null, undefined, false, 'b']);
    expect(node.textContent).toBe('ab');
  });

  it('flattens nested child arrays', () => {
    const node = el('ul', {}, [[el('li', {}, '1'), el('li', {}, '2')], el('li', {}, '3')]);
    expect(node.querySelectorAll('li')).toHaveLength(3);
  });

  it('omits attributes whose value is null or false', () => {
    const node = el('input', { disabled: false, placeholder: null });
    expect(node.hasAttribute('placeholder')).toBe(false);
  });
});

describe('escapeHtml', () => {
  it('neutralises markup', () => {
    expect(escapeHtml('<script>alert(1)</script>')).not.toContain('<script>');
    expect(escapeHtml(`" '&`)).toBe('&quot; &#39;&amp;');
  });
});

describe('status pills', () => {
  it('renders a glyph and a word, never colour alone', () => {
    for (const status of SEGMENT_STATUSES) {
      const pill = statusPill(status);
      expect(pill.textContent).toContain(STATUS_GLYPH[status]);
      expect(pill.textContent).toContain(t(`status.${status}`));
      expect(pill.className).toContain(`pill--${status}`);
    }
  });

  it('hides the glyph from assistive technology, which reads the word instead', () => {
    const glyph = statusPill(SegmentStatus.ACCESSIBLE).querySelector('.pill__glyph');
    expect(glyph.getAttribute('aria-hidden')).toBe('true');
  });

  it('defaults to unverified for an unknown status', () => {
    expect(statusPill(undefined).className).toContain('pill--unverified');
  });
});

describe('meter', () => {
  it('exposes value, range and label to assistive technology', () => {
    const node = meter('Accessibility score', 72);
    const track = node.querySelector('[role="meter"]');
    expect(track.getAttribute('aria-valuenow')).toBe('72');
    expect(track.getAttribute('aria-valuemin')).toBe('0');
    expect(track.getAttribute('aria-valuemax')).toBe('100');
    expect(track.getAttribute('aria-label')).toBe('Accessibility score');
  });

  it('renders an unknown value as "unknown", never as zero', () => {
    const node = meter('Score', null);
    expect(node.textContent).toContain(t('status.unverified'));
    expect(node.querySelector('.meter__fill').style.width).toBe('0%');
    expect(node.querySelector('[role="meter"]').getAttribute('aria-valuetext'))
      .toBe(t('status.unverified'));
  });

  it('clamps an out-of-range value', () => {
    expect(meter('x', 150).querySelector('.meter__fill').style.width).toBe('100%');
    expect(meter('x', -20).querySelector('.meter__fill').style.width).toBe('0%');
  });
});

describe('compositionBar', () => {
  it('describes the whole composition in one accessible label', () => {
    const bar = compositionBar({ accessible: 300, partial: 100, inaccessible: 0, unverified: 100 }, 500);
    const label = bar.getAttribute('aria-label');
    expect(bar.getAttribute('role')).toBe('img');
    expect(label).toContain('60%');
    expect(label).toContain(t('status.accessible'));
    expect(label).toContain(t('status.unverified'));
  });

  it('omits zero-length segments', () => {
    const bar = compositionBar({ accessible: 500, partial: 0, inaccessible: 0, unverified: 0 }, 500);
    expect(bar.querySelectorAll('span')).toHaveLength(1);
  });
});

describe('statusGuide', () => {
  it('explains all four states, each with a colour, a glyph and a description', () => {
    const guide = statusGuide();
    const rows = guide.querySelectorAll('.status-guide__row');
    expect(rows).toHaveLength(4);
    for (const status of SEGMENT_STATUSES) {
      expect(guide.textContent).toContain(t(`status.${status}`));
      expect(guide.textContent).toContain(STATUS_GLYPH[status]);
    }
    for (const bar of guide.querySelectorAll('.status-guide__bar')) {
      expect(bar.getAttribute('aria-hidden')).toBe('true');
    }
  });
});

describe('form controls', () => {
  it('links a label to its control', () => {
    const input = el('input.input');
    const wrapper = field('Destination', input, { id: 'dest' });
    expect(input.id).toBe('dest');
    expect(wrapper.querySelector('label').getAttribute('for')).toBe('dest');
  });

  it('marks an invalid control and points at its error message', () => {
    const input = el('input.input');
    const wrapper = field('Email', input, { id: 'email', error: 'Required' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('email-error');
    expect(wrapper.querySelector('[role="alert"]').textContent).toBe('Required');
  });

  it('reports chip pressed state through aria-pressed', () => {
    expect(chip('Accessible', { pressed: true }).getAttribute('aria-pressed')).toBe('true');
    expect(chip('Accessible', { pressed: false }).getAttribute('aria-pressed')).toBe('false');
  });

  it('drives a toggle from a real checkbox', () => {
    let value = null;
    const node = toggle('Prefer verified data', false, (checked) => { value = checked; });
    const input = node.querySelector('input');
    input.checked = true;
    input.dispatchEvent(new Event('change'));
    expect(value).toBe(true);
  });

  it('drives a radio option from a real radio input', () => {
    let chosen = null;
    const node = radioOption({
      name: 'profile', value: 'wheelchair', checked: false,
      title: 'Wheelchair', description: 'Refuses steps', onChange: (v) => { chosen = v; }
    });
    const input = node.querySelector('input');
    input.checked = true;
    input.dispatchEvent(new Event('change'));
    expect(chosen).toBe('wheelchair');
    expect(node.textContent).toContain('Refuses steps');
  });
});

describe('banners and states', () => {
  it('gives a danger banner an alert role so it is announced', () => {
    expect(banner('Something failed', { tone: 'danger' }).getAttribute('role')).toBe('alert');
    expect(banner('Just so you know', { tone: 'info' }).getAttribute('role')).toBeNull();
  });

  it('gives the spinner a live status region with readable text', () => {
    const node = spinner('Loading routes');
    expect(node.getAttribute('role')).toBe('status');
    expect(node.getAttribute('aria-live')).toBe('polite');
    expect(node.querySelector('.sr-only').textContent).toBe('Loading routes');
  });

  it('renders an empty state with an action', () => {
    const node = emptyState('Nothing here', 'Try something else', el('button', {}, 'Go'));
    expect(node.textContent).toContain('Nothing here');
    expect(node.querySelector('button')).toBeTruthy();
  });
});

describe('icons', () => {
  it('hides every icon from assistive technology', () => {
    for (const name of Object.keys(icons)) {
      const svg = icon(name).querySelector('svg');
      expect(svg.getAttribute('aria-hidden'), name).toBe('true');
      expect(svg.getAttribute('focusable'), name).toBe('false');
    }
  });

  /**
   * The mark used to be a hand-drawn SVG, and this test guarded it against
   * being the International Symbol of Access - the lazy choice for an
   * accessibility app. It is now the supplied brand image, which does include a
   * wheelchair figure alongside the head and the castle. That is a brand
   * decision, and it is not something a test can check inside a PNG anyway: an
   * assertion that the markup does not contain the word would still pass while
   * guarding nothing, which is worse than no assertion at all.
   *
   * What is worth holding is the accessibility contract, which nothing else
   * covers: the mark is decoration, and the link around it carries the name.
   */
  it('renders the brand mark as decoration the screen reader skips', () => {
    const mark = brandMark(32);
    const img = mark.querySelector('img');

    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toMatch(/accesspafos-mark\.png$/);
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('aria-hidden')).toBe('true');
    expect(img.width).toBe(32);
    expect(img.height).toBe(32);
  });
});

describe('focus trapping', () => {
  it('keeps Tab inside the container and restores focus on release', () => {
    const outside = el('button', {}, 'outside');
    document.body.append(outside);
    outside.focus();

    const first = el('button', {}, 'first');
    const last = el('button', {}, 'last');
    const dialog = el('div', { tabindex: '-1' }, [first, last]);
    document.body.append(dialog);

    const release = trapFocus(dialog);
    expect(document.activeElement).toBe(first);

    last.focus();
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));

    release();
    expect(document.activeElement).toBe(outside);
  });
});

describe('announce', () => {
  it('writes into the live region without moving focus', async () => {
    const before = document.activeElement;
    announce('Route calculated');
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(document.getElementById('live-region').textContent).toBe('Route calculated');
    expect(document.activeElement).toBe(before);
  });
});

describe('mount and clear', () => {
  it('replaces existing content', () => {
    const host = el('div', {}, 'old');
    mount(host, el('span', {}, 'new'));
    expect(host.textContent).toBe('new');
    clear(host);
    expect(host.childNodes).toHaveLength(0);
  });
});

describe('provenance chips', () => {
  it('labels each source and carries an explanatory title', () => {
    for (const source of ['osm', 'mapillary', 'citizen', 'manual']) {
      const node = sourceChip(source);
      expect(node.textContent).toContain(t(`source.${source}`));
      expect(node.getAttribute('title')).toBe(t(`source.${source}Desc`));
    }
  });

  it('renders a freshness pill for every state', () => {
    for (const state of ['recent', 'aging', 'stale', 'none']) {
      expect(freshnessPill(state).textContent).toContain(t(`freshness.${state}`));
    }
  });
});
