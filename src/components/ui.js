/**
 * Shared presentational pieces.
 *
 * Two rules run through everything here:
 *   1. status is never communicated by colour alone - a glyph and a word
 *      always travel with the hue;
 *   2. an unknown value renders as "unknown", never as zero.
 */

import { el } from '../utils/dom.js';
import { t } from '../i18n/index.js';
import { icon } from './icons.js';
import { STATUS_COLORS, STATUS_GLYPH, SegmentStatus } from '@shared/constants.js';

export function button(label, { variant = 'secondary', size = '', icon: iconName, onClick, type = 'button', disabled = false, block = false, ...rest } = {}) {
  const classes = ['btn', `btn--${variant}`, size ? `btn--${size}` : '', block ? 'btn--block' : '']
    .filter(Boolean).join(' ');
  return el('button', { class: classes, type, onClick, disabled, ...rest }, [
    iconName && icon(iconName, size === 'sm' ? 16 : 18),
    label
  ]);
}

export function statusPill(status, { showLabel = true, size } = {}) {
  const key = status || SegmentStatus.UNVERIFIED;
  return el(`span.pill.pill--${key}`, { style: size ? { fontSize: size } : {} }, [
    el('span.pill__glyph', { 'aria-hidden': 'true' }, STATUS_GLYPH[key] || '○'),
    showLabel && t(`status.${key}`)
  ]);
}

export function freshnessPill(state) {
  const tone = state === 'recent' ? 'pill--accessible'
    : state === 'aging' ? 'pill--partial'
      : state === 'stale' ? 'pill--inaccessible' : 'pill--neutral';
  return el(`span.pill.${tone}`, {}, [icon('clock', 12), t(`freshness.${state || 'none'}`)]);
}

export function sourceChip(source) {
  return el('span.source-chip', { title: t(`source.${source}Desc`) }, [
    icon(source === 'osm' ? 'layers' : source === 'mapillary' ? 'camera' : source === 'manual' ? 'shield' : 'flag', 13),
    t(`source.${source}`)
  ]);
}

/**
 * A labelled meter. `value` may be null, which renders as "unknown" rather
 * than as an empty bar - an empty bar reads as zero, which is a lie.
 */
export function meter(label, value, { max = 100, tone = '', suffix = '' } = {}) {
  const known = typeof value === 'number' && Number.isFinite(value);
  const pct = known ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return el('div.meter', {}, [
    el('div.meter__head', {}, [
      el('span.meter__label', {}, label),
      el('span.meter__value', {}, known ? `${Math.round(value)}${suffix}` : t('status.unverified'))
    ]),
    el('div.meter__track', {
      role: 'meter',
      'aria-valuenow': known ? Math.round(value) : undefined,
      'aria-valuemin': '0',
      'aria-valuemax': String(max),
      'aria-valuetext': known ? `${Math.round(value)}${suffix}` : t('status.unverified'),
      'aria-label': label
    }, [
      el(`div.meter__fill${tone ? `.meter__fill--${tone}` : ''}`, { style: { width: `${pct}%` } })
    ])
  ]);
}

/**
 * A single coverage figure.
 *
 * The icon is decorative and marked so: the number and its label already say
 * everything, and a screen reader gains nothing from "flag, 146, barriers
 * found". It exists to make four tiles scannable at a glance rather than to
 * carry meaning.
 *
 * @param {string} value
 * @param {string} label
 * @param {{iconName?:string, tone?:'brand'|'accent'|'inaccessible'|'unknown'}} [options]
 */
export function stat(value, label, { iconName, tone = 'brand' } = {}) {
  return el('div.stat', {}, [
    el('div.stat__text', {}, [
      el('div.stat__value', {}, value),
      el('div.stat__label', {}, label)
    ]),
    iconName && el(`span.stat__icon.stat__icon--${tone}`, { 'aria-hidden': 'true' }, icon(iconName, 18))
  ]);
}

export function banner(message, { tone = 'info', iconName } = {}) {
  return el(`div.banner.banner--${tone}`, { role: tone === 'danger' ? 'alert' : undefined }, [
    el('span.banner__icon', {}, icon(iconName || (tone === 'warning' || tone === 'danger' ? 'warning' : 'info'), 17)),
    el('span', {}, message)
  ]);
}

export function emptyState(title, body, action) {
  return el('div.empty', {}, [
    el('p.empty__title', {}, title),
    body && el('p.small', {}, body),
    action && el('div', { style: { marginTop: '1rem' } }, action)
  ]);
}

export function spinner(label) {
  return el('div.spinner-center', { role: 'status', 'aria-live': 'polite' }, [
    el('div.spinner', { 'aria-hidden': 'true' }),
    el('span.sr-only', {}, label || t('app.loading'))
  ]);
}

export function skeletonList(count = 3) {
  return el('div.stack', {}, Array.from({ length: count }, () => el('div.skeleton.skeleton--card')));
}

export function field(labelText, control, { hint, error, id } = {}) {
  if (id) control.id = id;
  if (error) {
    control.setAttribute('aria-invalid', 'true');
    control.setAttribute('aria-describedby', `${id}-error`);
  } else if (hint && id) {
    control.setAttribute('aria-describedby', `${id}-hint`);
  }
  return el('div.field', {}, [
    labelText && el('label.field__label', { for: id }, labelText),
    control,
    hint && el('p.field__hint', { id: id ? `${id}-hint` : undefined }, hint),
    error && el('p.field__error', { id: id ? `${id}-error` : undefined, role: 'alert' }, error)
  ]);
}

export function toggle(labelText, checked, onChange, { hint } = {}) {
  const input = el('input', { type: 'checkbox', checked, onChange: (e) => onChange(e.target.checked) });
  return el('label.toggle', {}, [
    el('span', {}, [
      el('span.strong', {}, labelText),
      hint && el('span.field__hint', { style: { marginTop: '2px' } }, hint)
    ]),
    input,
    el('span.toggle__track', { 'aria-hidden': 'true' })
  ]);
}

/**
 * A radio presented as a full-width row.
 *
 * Order in the DOM is icon, body, mark - the mark last so it sits on the right
 * where the reference puts it. The input itself stays first and visually
 * hidden: it remains the thing that is focused, checked and announced, and the
 * `.option__mark` is only paint. Moving the mark for looks must not move the
 * control.
 *
 * @param {{name:string, value:string, checked:boolean, title:string,
 *          description?:string, iconName?:string, tone?:string,
 *          onChange:(value:string)=>void}} options
 */
export function radioOption({
  name, value, checked, title, description, iconName, tone = 'brand', onChange
}) {
  const input = el('input', {
    type: 'radio', name, value, checked,
    onChange: (e) => { if (e.target.checked) onChange(value); }
  });
  return el('label.option', {}, [
    input,
    iconName && el(`span.option__icon.option__icon--${tone}`, { 'aria-hidden': 'true' }, icon(iconName, 20)),
    el('span.option__body', {}, [
      el('span.option__title', {}, title),
      description && el('span.option__desc', {}, description)
    ]),
    el('span.option__mark', { 'aria-hidden': 'true' })
  ]);
}

export function chip(label, { pressed = false, onClick, dotColor } = {}) {
  return el('button.chip', { type: 'button', 'aria-pressed': String(pressed), onClick }, [
    dotColor && el('span.chip__dot', { style: { background: dotColor } }),
    label
  ]);
}

/** The colour/glyph/meaning table used on the home screen and in settings. */
export function statusGuide() {
  const order = [
    SegmentStatus.ACCESSIBLE, SegmentStatus.PARTIAL,
    SegmentStatus.INACCESSIBLE, SegmentStatus.UNVERIFIED
  ];
  return el('div.status-guide', {}, order.map((status) => el('div.status-guide__row', {}, [
    el('span.status-guide__bar', { style: { background: STATUS_COLORS[status] }, 'aria-hidden': 'true' }),
    el('div', {}, [
      el('div.status-guide__name', {}, [
        el('span', { 'aria-hidden': 'true' }, STATUS_GLYPH[status]),
        t(`status.${status}`)
      ]),
      el('div.status-guide__desc', {}, t(`status.${status}Desc`))
    ])
  ])));
}

/** Proportional bar showing how much of a route is in each state. */
export function compositionBar(statusMeters, total) {
  const order = [
    SegmentStatus.ACCESSIBLE, SegmentStatus.PARTIAL,
    SegmentStatus.INACCESSIBLE, SegmentStatus.UNVERIFIED
  ];
  const parts = order
    .map((status) => ({ status, meters: statusMeters?.[status] || 0 }))
    .filter((p) => p.meters > 0);

  const label = parts
    .map((p) => `${t(`status.${p.status}`)} ${Math.round((p.meters / total) * 100)}%`)
    .join(', ');

  return el('div.composition', { role: 'img', 'aria-label': `${t('route.composition')}: ${label}` },
    parts.map((p) => el('span', {
      style: {
        width: `${(p.meters / Math.max(1, total)) * 100}%`,
        background: STATUS_COLORS[p.status]
      }
    })));
}

export function keyValue(pairs) {
  return el('dl.kv', {}, pairs.flatMap(([key, value]) => [
    el('dt', {}, key),
    el('dd', {}, value ?? '—')
  ]));
}

export function sectionTitle(text) {
  return el('h2.section-title', {}, text);
}

/**
 * A circular score dial.
 *
 * `score` may be null. When it is, the ring stays grey and reads "—": an
 * unassessed segment must never be drawn as a zero, and never as a colour.
 */
export function scoreRing(score, { status, size = 'md', label } = {}) {
  const known = typeof score === 'number' && Number.isFinite(score);
  const pct = known ? Math.max(0, Math.min(100, score)) : 0;
  const color = known && status ? STATUS_COLORS[status] : 'var(--unknown)';
  const cls = size === 'lg' ? 'score-ring.score-ring--lg' : 'score-ring';
  return el(`div.${cls}`, {
    style: { '--ring': String(pct), '--ring-color': color },
    role: 'img',
    'aria-label': label || (known ? `${Math.round(pct)} / 100` : t('status.unverified'))
  }, el('span.score-ring__value', { 'aria-hidden': 'true' }, known ? String(Math.round(pct)) : '—'));
}

/** A small circular icon holder used in headers, list rows and quick actions. */
export function iconBadge(iconName, { tone = 'brand', size = '', solid = false, glyphSize } = {}) {
  const classes = ['icon-badge', `icon-badge--${tone}`, size ? `icon-badge--${size}` : '', solid ? 'icon-badge--solid' : '']
    .filter(Boolean).join(' ');
  const px = glyphSize || (size === 'sm' ? 15 : size === 'lg' ? 22 : 18);
  return el('span', { class: classes, 'aria-hidden': 'true' }, icon(iconName, px));
}

/**
 * A dashboard figure. `value` is rendered verbatim - callers pass an em dash
 * when a number is not yet available rather than a zero, and `trend` is only
 * ever passed when a real prior period exists to compare against.
 */
export function kpiCard(label, value, { iconName, tone = 'brand', foot, trend } = {}) {
  return el('div.kpi', {}, [
    iconName && iconBadge(iconName, { tone }),
    el('div.kpi__body', {}, [
      el('div.kpi__label', {}, label),
      el('div.kpi__value', {}, value),
      (foot || trend) && el('div.kpi__foot', {}, [
        trend && el(`span.kpi__trend.kpi__trend--${trend.direction}`, {}, [
          icon(trend.direction === 'up' ? 'trendUp' : 'trendDown', 13),
          trend.label
        ]),
        trend && foot && ' ',
        foot
      ])
    ])
  ]);
}

/** A tappable shortcut on the home screen. */
export function quickActionCard({ href, title, description, iconName, tone = 'brand', onClick }) {
  const children = [
    iconBadge(iconName, { tone, size: 'lg' }),
    el('span.quick-card__title', {}, title),
    description && el('span.quick-card__desc', {}, description)
  ];
  return href
    ? el('a.quick-card', { href, onClick }, children)
    : el('button.quick-card', { type: 'button', onClick }, children);
}

/** Severity wording for a barrier or a report, never colour alone. */
export function severityBadge(level, label) {
  return el(`span.severity.severity--${level}`, {}, label || t(`severity.${level}`));
}

/** A row in a list of recent findings or reports. */
export function alertRow({ href, title, meta, iconName = 'warning', tone = 'partial', onClick, trailing }) {
  const children = [
    iconBadge(iconName, { tone }),
    el('div.alert-row__body', {}, [
      el('div.alert-row__title', {}, title),
      meta && el('div.alert-row__meta', {}, meta)
    ]),
    trailing || el('span.alert-row__chev', { 'aria-hidden': 'true' }, icon('chevronRight', 17))
  ];
  return href
    ? el('a.alert-row', { href, onClick }, children)
    : el('button.alert-row', { type: 'button', onClick }, children);
}

/** A heading with an optional trailing link. */
export function sectionHead(title, { sub, action } = {}) {
  return el('div.section-head', {}, [
    el('div', {}, [
      el('h2.section-head__title', {}, title),
      sub && el('p.section-head__sub', {}, sub)
    ]),
    action || null
  ]);
}
