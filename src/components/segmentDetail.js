/**
 * The segment detail view - the screen the whole product stands or falls on.
 *
 * It has to answer, for any stretch of pavement in the city: what do you
 * think, how sure are you, how old is that, where did it come from, and what
 * would change your mind. If a judge taps a grey street and the app cannot
 * explain itself, nothing else here matters.
 */

import { el } from '../utils/dom.js';
import { t, getLocale } from '../i18n/index.js';
import { formatDate, formatRelative, formatDistance } from '../utils/format.js';
import { icon } from './icons.js';
import {
  statusPill, freshnessPill, sourceChip, meter, banner, keyValue, sectionTitle
} from './ui.js';
import { streetPhoto } from './streetPhoto.js';
import { STATUS_COLORS, SegmentStatus, SourceType } from '@shared/constants.js';

/**
 * @param {object} detail  the payload from getSegmentDetail
 * @param {{ onReport?: Function, onSave?: Function, compact?: boolean }} [handlers]
 */
export function renderSegmentDetail(detail, handlers = {}) {
  const { segment, assessment, observations = [], verificationHistory = [], osmUrl } = detail;
  const status = assessment?.status || SegmentStatus.UNVERIFIED;
  const name = (getLocale() === 'el' ? segment.streetNameEl : segment.streetName)
    || segment.streetName || t('segment.unnamed');

  return el('div.stack', {}, [
    headline(segment, assessment, status, name),

    status === SegmentStatus.UNVERIFIED
      ? banner(t('segment.whyUnverified'), { tone: 'neutral' })
      : null,

    metrics(assessment),

    provenance(assessment, segment),

    findings(assessment),

    whyThisScore(assessment),

    imageEvidence(observations),

    osmTags(segment),

    verificationSection(verificationHistory),

    actions(segment, handlers, osmUrl)
  ]);
}

function headline(segment, assessment, status, name) {
  const score = assessment?.accessibilityScore;
  const known = typeof score === 'number';
  const color = STATUS_COLORS[status];

  return el('div.stack-sm', {}, [
    el('div.score-hero', {}, [
      el('div.score-dial', {
        style: { '--dial': String(known ? score : 0), '--dial-color': color },
        role: 'img',
        'aria-label': known
          ? `${t('segment.score')}: ${score} / 100`
          : t('status.unverified')
      }, [
        el('span.score-dial__value', {}, known ? String(score) : '—'),
        el('span.score-dial__unit', {}, known ? '/ 100' : t('segment.score'))
      ]),
      el('div', { style: { minWidth: 0, flex: '1' } }, [
        el('h3', { style: { marginBottom: '6px' } }, name),
        el('div.row.row--wrap', { style: { gap: '6px' } }, [
          statusPill(status),
          assessment?.freshnessState && freshnessPill(assessment.freshnessState)
        ]),
        el('p.small.muted', { style: { marginTop: '6px' } },
          `${segment.kind ? `${segment.kind.replace(/_/g, ' ')} · ` : ''}${formatDistance(segment.lengthMeters)}`)
      ])
    ])
  ]);
}

function metrics(assessment) {
  if (!assessment) return null;
  return el('div.card.stack', {}, [
    meter(t('segment.score'), assessment.accessibilityScore, {
      tone: assessment.status === SegmentStatus.ACCESSIBLE ? 'accessible'
        : assessment.status === SegmentStatus.PARTIAL ? 'partial'
          : assessment.status === SegmentStatus.INACCESSIBLE ? 'inaccessible' : 'unknown'
    }),
    meter(t('segment.confidence'), assessment.evidenceConfidence),
    el('div.row.row--between', {}, [
      el('span.small.muted', {}, t('segment.freshness')),
      el('span.small', {}, [
        assessment.lastEvidenceAt
          ? `${formatDate(assessment.lastEvidenceAt)} (${formatRelative(assessment.lastEvidenceAt)})`
          : t('freshness.none')
      ])
    ])
  ]);
}

function provenance(assessment, segment) {
  const sources = assessment?.sources || [];
  if (!sources.length && !segment.osmWayId) return null;

  return el('div.stack-sm', {}, [
    sectionTitle(t('segment.sources')),
    el('div.tag-list', {}, sources.map((source) => sourceChip(source))),
    segment.manualVerification?.at
      ? el('p.small.muted', {}, `${t('segment.lastVerified')}: ${formatDate(segment.manualVerification.at)}`)
      : el('p.small.muted', {}, t('segment.neverVerified'))
  ]);
}

function findings(assessment) {
  if (!assessment) return null;
  const barriers = assessment.barriers || [];
  const positives = assessment.positiveFeatures || [];

  return el('div.stack', {}, [
    el('div.stack-sm', {}, [
      sectionTitle(t('segment.barriers')),
      barriers.length
        ? el('div', {}, barriers.map((id) => evidenceRow(id, 'barrier', 'warning')))
        : el('p.small.muted', {}, t('segment.noBarriers'))
    ]),
    el('div.stack-sm', {}, [
      sectionTitle(t('segment.positives')),
      positives.length
        ? el('div', {}, positives.map((id) => evidenceRow(id, 'positive', 'check')))
        : el('p.small.muted', {}, t('segment.noPositives'))
    ])
  ]);
}

function evidenceRow(id, kind, iconName) {
  return el('div.evidence-item', {}, [
    el('span.evidence-item__icon', {
      style: { color: kind === 'barrier' ? 'var(--inaccessible-ink)' : 'var(--accessible-ink)' }
    }, icon(iconName, 17)),
    el('div', {}, [
      el('div.evidence-item__title', {}, t(`${kind}.${id}`))
    ])
  ]);
}

/**
 * "Why this score?" - the itemised arithmetic. This is the part that turns a
 * number into an argument somebody can disagree with, which is the whole
 * point of a transparent system.
 */
function whyThisScore(assessment) {
  const explanation = assessment?.explanation;
  if (!explanation?.score) return null;
  const { score, confidence, gate, thresholds } = explanation;

  return el('details.card', { style: { padding: '0' } }, [
    el('summary', {
      style: { padding: '16px', cursor: 'pointer', fontWeight: '600', listStyle: 'none' }
    }, [
      el('span.row.row--between', {}, [
        el('span.row', {}, [icon('info', 17), t('segment.whyTitle')]),
        icon('chevronDown', 16)
      ])
    ]),
    el('div', { style: { padding: '0 16px 16px' } }, [
      el('p.small.muted', {}, t('segment.whyIntro', { base: score.base })),

      el('div', { style: { marginTop: '12px' } }, [
        el('div.breakdown-row', {}, [
          el('span', {}, `${t('segment.score')} (start)`),
          el('span.breakdown-row__points', {}, String(score.base))
        ]),
        ...score.subtractions.map((item) => el('div.breakdown-row', {}, [
          el('span', {}, [
            t(item.key),
            item.sources?.length
              ? el('span.xs.muted', { style: { display: 'block' } }, item.sources.map((s) => t(`source.${s}`) || s).join(', '))
              : null
          ]),
          el('span.breakdown-row__points.breakdown-row__points--minus', {}, String(item.points))
        ])),
        ...score.additions.map((item) => el('div.breakdown-row', {}, [
          el('span', {}, [
            t(item.key),
            item.sources?.length
              ? el('span.xs.muted', { style: { display: 'block' } }, item.sources.map((s) => t(`source.${s}`) || s).join(', '))
              : null
          ]),
          el('span.breakdown-row__points.breakdown-row__points--plus', {}, `+${item.points}`)
        ])),
        score.bonusCapped
          ? el('p.xs.muted', { style: { marginTop: '6px' } },
            'Positive points are capped so they cannot outweigh a severe barrier.')
          : null,
        score.ceiling
          ? el('div.banner.banner--warning', { style: { marginTop: '10px' } },
            t('segment.whyCeiling', {
              value: score.ceiling.value,
              barrier: t(score.ceiling.key) || score.ceiling.key
            }))
          : null,
        el('div.breakdown-row.breakdown-row--total', {}, [
          el('span', {}, t('segment.score')),
          el('span.breakdown-row__points', {}, String(score.total))
        ])
      ]),

      el('div', { style: { marginTop: '18px' } }, [
        sectionTitle(t('segment.whyConfidence')),
        ...confidence.map((item) => el('div.breakdown-row', {}, [
          el('span', {}, t(item.key)),
          el('span.breakdown-row__points', {
            class: item.points < 0 ? 'breakdown-row__points--minus' : 'breakdown-row__points--plus'
          }, `${item.points > 0 ? '+' : ''}${item.points}`)
        ])),
        el('p.small.muted', { style: { marginTop: '10px' } },
          t('segment.whyGate', { min: gate.min, value: assessment.evidenceConfidence })),
        el('p.xs.muted', {}, `Thresholds: accessible ≥ ${thresholds.accessibleAt}, partial ≥ ${thresholds.partialAt}.`)
      ])
    ])
  ]);
}

function imageEvidence(observations) {
  if (!observations.length) {
    return el('div.stack-sm', {}, [
      sectionTitle(t('segment.aiFindings')),
      el('p.small.muted', {}, t('segment.noObservations'))
    ]);
  }

  return el('div.stack-sm', {}, [
    sectionTitle(t('segment.aiFindings')),
    el('p.small.muted', {}, t('segment.observationCount', { count: observations.length })),
    ...observations.map((observation) => el('div.card', { style: { padding: '12px' } }, [
      el('div.row.row--between', { style: { marginBottom: '8px' } }, [
        sourceChip(observation.sourceType),
        el('span.xs.muted', {}, observation.capturedAt ? formatDate(observation.capturedAt) : '—')
      ]),

      // The photograph the model judged, above the findings it produced. The
      // link out below is kept as a fallback for when this cannot load, but it
      // is no longer the only way to see the evidence.
      streetPhoto(observation),

      observationSummary(observation.observation),
      el('div.row.row--wrap', { style: { gap: '8px', marginTop: '8px' } }, [
        observation.distanceMeters != null
          ? el('span.xs.muted', {}, t('segment.distanceFrom', { meters: observation.distanceMeters }))
          : null,
        el('span.xs.muted', {}, `${t('segment.imageQuality')}: ${observation.observation?.imageQuality || '—'}`),
        observation.viewerUrl
          ? el('a.xs', { href: observation.viewerUrl, target: '_blank', rel: 'noopener external' },
            [t('segment.viewImagery')])
          : null
      ]),
      observation.attribution
        ? el('p.xs.muted', { style: { marginTop: '6px' } }, observation.attribution)
        : null
    ]))
  ]);
}

/** Render only the fields the model actually committed to. */
function observationSummary(observation) {
  if (!observation) return null;
  const rows = [];
  const say = (label, value) => {
    if (!value || value === 'unknown' || value === 'not_visible') return;
    rows.push([label, value.replace(/_/g, ' ')]);
  };

  say(t('positive.clear_path'), observation.pedestrianPath?.condition);
  say(t('positive.curb_ramp'), observation.curbRamp?.visible === 'yes'
    ? observation.curbRamp.condition
    : (observation.curbRamp?.visible === 'no' ? 'absent' : null));
  say(t('barrier.steps'), observation.stairs?.visible === 'yes' ? 'present' : null);
  say('Surface', [observation.surface?.type, observation.surface?.condition]
    .filter((v) => v && v !== 'unknown').join(', ') || null);
  say('Obstacle', observation.obstacle?.severity === 'none' ? null : observation.obstacle?.severity);

  if (rows.length === 0) {
    return el('p.small.muted', {}, t('segment.uncertain'));
  }

  return el('div', {}, [
    keyValue(rows),
    observation.obstacle?.description
      ? el('p.xs.muted', { style: { marginTop: '6px' } }, `“${observation.obstacle.description}”`)
      : null,
    Array.isArray(observation.uncertainFindings) && observation.uncertainFindings.length
      ? el('p.xs.muted', { style: { marginTop: '6px' } },
        `${t('segment.uncertain')}: ${observation.uncertainFindings.join('; ')}`)
      : null
  ]);
}

function osmTags(segment) {
  const tags = Object.entries(segment.osmTags || {});
  if (!tags.length) return null;
  return el('details', {}, [
    el('summary.small.muted', { style: { cursor: 'pointer', padding: '8px 0' } }, t('segment.osmTags')),
    el('div.card', { style: { padding: '12px' } }, [
      keyValue(tags.map(([k, v]) => [k, v])),
      segment.osmTimestamp
        ? el('p.xs.muted', { style: { marginTop: '8px' } }, `Last edited ${formatDate(segment.osmTimestamp)}`)
        : null
    ])
  ]);
}

function verificationSection(history) {
  if (!history?.length) return null;
  return el('div.stack-sm', {}, [
    sectionTitle(t('segment.verification')),
    ...history.map((event) => el('div.audit-entry', {}, [
      el('span.audit-entry__when', {}, formatDate(event.createdAt)),
      el('div', {}, [
        el('div.small.strong', {}, event.result.replace(/_/g, ' ')),
        event.notes ? el('div.xs.muted', {}, event.notes) : null
      ])
    ]))
  ]);
}

function actions(segment, handlers, osmUrl) {
  return el('div.stack-sm', { style: { paddingTop: '8px' } }, [
    handlers.onReport && el('button.btn.btn--secondary.btn--block', {
      type: 'button', onClick: () => handlers.onReport(segment)
    }, [icon('flag', 17), t('segment.reportBarrier')]),
    handlers.onSave && el('button.btn.btn--ghost.btn--block', {
      type: 'button', onClick: () => handlers.onSave(segment)
    }, [icon('bookmark', 17), t('segment.savePlace')]),
    osmUrl && el('a.btn.btn--ghost.btn--block', {
      href: osmUrl, target: '_blank', rel: 'noopener external'
    }, [icon('external', 16), t('segment.viewOsm')])
  ]);
}
