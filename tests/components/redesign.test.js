/**
 * Regression cover for the presentational layer added in the reference-design
 * pass, plus the two real defects that pass uncovered.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { el } from '@src/utils/dom.js';
import {
  scoreRing, iconBadge, kpiCard, quickActionCard, severityBadge, alertRow, sectionHead
} from '@src/components/ui.js';
import { icons } from '@src/components/icons.js';
import { setLocale, t } from '@src/i18n/index.js';
import { SegmentStatus, STATUS_COLORS } from '@shared/constants.js';

beforeEach(() => {
  document.body.innerHTML = '<div id="live-region"></div>';
  setLocale('en', { persist: false });
});

describe('el() style handling', () => {
  // The score dials set their sweep through a custom property. Assigning one
  // onto a CSSStyleDeclaration creates an expando that never reaches CSS, so
  // every dial silently rendered empty until this went through setProperty.
  it('sets CSS custom properties so they actually reach the cascade', () => {
    const node = el('div', { style: { '--ring': '73', '--ring-color': 'red' } });
    expect(node.style.getPropertyValue('--ring')).toBe('73');
    expect(node.style.getPropertyValue('--ring-color')).toBe('red');
  });

  it('still sets ordinary style properties', () => {
    const node = el('div', { style: { width: '40px' } });
    expect(node.style.width).toBe('40px');
  });
});

describe('scoreRing()', () => {
  it('draws the sweep and colours it by classified status', () => {
    const node = scoreRing(72, { status: SegmentStatus.PARTIAL });
    expect(node.style.getPropertyValue('--ring')).toBe('72');
    expect(node.style.getPropertyValue('--ring-color')).toBe(STATUS_COLORS[SegmentStatus.PARTIAL]);
    expect(node.textContent).toContain('72');
  });

  it('renders an unknown score as a dash on a grey ring, never as zero', () => {
    const node = scoreRing(null);
    expect(node.textContent).not.toContain('0');
    expect(node.textContent).toContain('—');
    expect(node.style.getPropertyValue('--ring-color')).toBe('var(--unknown)');
    expect(node.getAttribute('aria-label')).toBe(t('status.unverified'));
  });

  it('clamps out-of-range scores rather than overdrawing the ring', () => {
    expect(scoreRing(140).style.getPropertyValue('--ring')).toBe('100');
    expect(scoreRing(-20).style.getPropertyValue('--ring')).toBe('0');
  });
});

describe('kpiCard()', () => {
  it('renders the value verbatim so an unknown figure stays an em dash', () => {
    const node = kpiCard('Assessed', '—', { iconName: 'check' });
    expect(node.querySelector('.kpi__value').textContent).toBe('—');
  });

  it('omits the trend line entirely when no comparison exists', () => {
    const node = kpiCard('Segments', '128', { iconName: 'layers' });
    expect(node.querySelector('.kpi__trend')).toBeNull();
  });
});

describe('quickActionCard() and alertRow()', () => {
  it('renders a quick action as a real link', () => {
    const node = quickActionCard({ href: '/map', title: 'Open the map', description: 'x', iconName: 'map' });
    expect(node.tagName).toBe('A');
    expect(node.getAttribute('href')).toBe('/map');
  });

  it('gives an alert row a chevron and a link target', () => {
    const node = alertRow({ href: '/segment/abc', title: 'Leoforos Poseidonos', meta: 'Steps' });
    expect(node.getAttribute('href')).toBe('/segment/abc');
    expect(node.querySelector('.alert-row__chev')).not.toBeNull();
  });
});

describe('severityBadge()', () => {
  it('carries a word, not only a colour, for every priority band', () => {
    for (const band of ['critical', 'high', 'medium', 'low']) {
      const node = severityBadge(band);
      expect(node.classList.contains(`severity--${band}`)).toBe(true);
      expect(node.textContent.trim().length).toBeGreaterThan(0);
      expect(node.textContent).not.toContain('severity.');
    }
  });
});

describe('sectionHead() and iconBadge()', () => {
  it('renders a heading element so the page keeps a document outline', () => {
    const node = sectionHead('Barriers to fix first', { sub: 'Ranked by impact.' });
    expect(node.querySelector('h2')).not.toBeNull();
  });

  it('hides decorative badges from assistive technology', () => {
    expect(iconBadge('flag').getAttribute('aria-hidden')).toBe('true');
  });
});

describe('icons added for the reference screens', () => {
  it('exposes every glyph the new screens reference', () => {
    for (const name of ['wheelchair', 'scan', 'sparkle', 'trendUp', 'trendDown', 'bell',
      'users', 'route2', 'kerb', 'width', 'incline']) {
      expect(typeof icons[name]).toBe('function');
      expect(icons[name](20)).toContain('<svg');
    }
  });

  it('keeps every icon hidden from assistive technology', () => {
    for (const [name, render] of Object.entries(icons)) {
      expect(render(18), name).toContain('aria-hidden="true"');
    }
  });
});

describe('bottom navigation across a language switch', () => {
  // The raised centre item nests an icon span inside its FAB. A
  // `querySelector('span:last-child')` walks the subtree in document order and
  // found that icon first, so switching language wrote the label over the SVG
  // and left the visible label in the old language.
  it('translates every label and leaves the centre icon intact', async () => {
    const { renderShell, refreshShellStrings } = await import('@src/components/appShell.js');
    const container = document.createElement('div');
    document.body.append(container);
    renderShell(container);

    const centre = container.querySelector('.nav-item--center');
    expect(centre).not.toBeNull();
    const fab = centre.querySelector('.nav-fab');
    expect(fab.querySelector('svg')).not.toBeNull();

    setLocale('el', { persist: false });
    refreshShellStrings();

    // the icon survived
    expect(fab.querySelector('svg'), 'the FAB icon was overwritten').not.toBeNull();

    // and every label, centre included, is now Greek
    for (const item of container.querySelectorAll('.nav-item')) {
      const label = item.lastElementChild;
      expect(label.classList.contains('nav-fab')).toBe(false);
      expect(label.textContent).toBe(t(`nav.${item.dataset.nav}`));
      expect(label.textContent).toMatch(/[Α-Ωα-ωάέήίόύώ]/);
    }

    setLocale('en', { persist: false });
  });
});

describe('skip link', () => {
  it('is translated rather than left hardcoded in English', async () => {
    document.body.insertAdjacentHTML('afterbegin', '<a class="skip-link" href="#main">Skip to main content</a>');
    const { refreshSkipLink } = await import('@src/components/appShell.js');
    setLocale('el', { persist: false });
    refreshSkipLink();
    expect(document.querySelector('.skip-link').textContent).toMatch(/[Α-Ωα-ωάέήίόύώ]/);
    setLocale('en', { persist: false });
  });
});
