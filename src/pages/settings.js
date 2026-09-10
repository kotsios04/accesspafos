/**
 * Profile and settings.
 *
 * Also the entrance to the municipality console: reviewers and administrators
 * are ordinary users of the public app who happen to hold a role claim, and
 * the link only appears for them.
 */

import { el, mount } from '../utils/dom.js';
import { t, getLocale, setLocale, getSupportedLocales } from '../i18n/index.js';
import { setHeader, getOutlet } from '../components/appShell.js';
import { icon } from '../components/icons.js';
import { button, radioOption, toggle, sectionTitle, banner } from '../components/ui.js';
import { getPrefs, setPrefs } from '../services/prefs.js';
import { isDemoActive, setDemoActive } from '../services/demo.js';
import {
  getUser, isSignedIn, isReviewer, signInWithGoogle, signOut, onAuthChange
} from '../services/auth.js';
import { toastError, toastSuccess } from '../services/toast.js';
import { describeError } from '../services/errors.js';
import { track } from '../services/analytics.js';
import { appVersion } from '../config/env.js';
import { ROUTE_PROFILES } from '@shared/constants.js';

const LOCALE_NAMES = { en: 'English', el: 'Ελληνικά' };

export async function render() {
  setHeader({ title: t('settings.title') });
  const container = el('div.page.stack-lg');
  mount(getOutlet(), container);

  const off = onAuthChange(() => paint());
  paint();

  function paint() {
    const prefs = getPrefs();
    const user = getUser();

    mount(container, [
      // --- account ---------------------------------------------------------
      el('section.stack-sm', {}, [
        sectionTitle(t('settings.account')),
        isSignedIn()
          ? el('div.card.stack-sm', {}, [
            el('p.small', {}, t('settings.signedInAs', { email: user.email || user.uid })),
            button(t('settings.signOut'), {
              variant: 'secondary', icon: 'logout', block: true,
              onClick: async () => { await signOut(); toastSuccess(t('settings.signOut')); }
            })
          ])
          : el('div.card.stack-sm', {}, [
            el('p.small.muted', {}, t('settings.anonymousNote')),
            button(t('settings.signIn'), {
              variant: 'primary', block: true,
              onClick: async () => {
                try { await signInWithGoogle(); } catch (error) { toastError(describeError(error)); }
              }
            })
          ]),
        // Saved lives here now that the bottom bar's fifth slot went to
        // reporting. It is one tap from the profile tab and from home.
        linkRow('/saved', t('nav.saved'), 'bookmark'),
        isReviewer()
          ? el('a.btn.btn--secondary.btn--block', { href: '/admin' }, [
            icon('shield', 17), t('settings.adminConsole')
          ])
          : null
      ]),

      // --- mobility profile --------------------------------------------------
      el('section.stack-sm', {}, [
        sectionTitle(t('settings.mobilityProfile')),
        el('p.small.muted', {}, t('settings.mobilityProfileHint')),
        el('div.option-list', {}, ROUTE_PROFILES.map((profileId) => radioOption({
          name: 'default-profile',
          value: profileId,
          checked: prefs.mobilityProfile === profileId,
          title: t(`profile.${profileId}`),
          description: t(`profile.${profileId}Desc`),
          onChange: (value) => { setPrefs({ mobilityProfile: value }); paint(); }
        })))
      ]),

      // --- language ----------------------------------------------------------
      el('section.stack-sm', {}, [
        sectionTitle(t('settings.language')),
        el('div.option-list', {}, getSupportedLocales().map((locale) => radioOption({
          name: 'locale',
          value: locale,
          checked: getLocale() === locale,
          title: LOCALE_NAMES[locale] || locale,
          onChange: (value) => {
            setLocale(value);
            track('language_changed', { locale: value });
          }
        })))
      ]),

      // --- routing preferences ------------------------------------------------
      el('section.stack-sm', {}, [
        sectionTitle(t('route.title')),
        el('div.card.stack-sm', {}, [
          toggle(t('settings.preferVerified'), prefs.preferVerifiedData,
            (checked) => setPrefs({ preferVerifiedData: checked }),
            { hint: t('route.preferVerifiedHint') }),
          el('div.divider'),
          toggle(t('settings.reducedMotion'), prefs.reducedMotion === true,
            (checked) => {
              setPrefs({ reducedMotion: checked });
              document.documentElement.style.setProperty('--dur', checked ? '0ms' : '220ms');
              document.documentElement.style.setProperty('--dur-slow', checked ? '0ms' : '340ms');
            },
            { hint: t('settings.reducedMotionHint') })
        ])
      ]),

      // --- demonstration ------------------------------------------------------
      el('section.stack-sm', {}, [
        sectionTitle(t('app.demoTitle')),
        el('div.card', {}, toggle(
          t('app.demoSettingLabel'),
          isDemoActive(),
          (checked) => setDemoActive(checked),
          { hint: t('app.demoSettingHint') }
        ))
      ]),

      // --- privacy ------------------------------------------------------------
      el('section.stack-sm', {}, [
        sectionTitle(t('settings.privacy')),
        el('div.card', {}, toggle(
          t('settings.analyticsLabel'),
          prefs.analyticsOptIn,
          (checked) => setPrefs({ analyticsOptIn: checked }),
          { hint: t('settings.analyticsHint') }
        ))
      ]),

      // --- about ---------------------------------------------------------------
      el('section.stack-sm', {}, [
        sectionTitle(t('settings.about')),
        el('div.stack-sm', {}, [
          linkRow('/methodology', t('settings.methodology'), 'chart'),
          linkRow('/data-sources', t('settings.dataSources'), 'layers'),
          linkRow('/responsible-ai', t('settings.responsibleAi'), 'shield'),
          linkRow('/privacy', t('settings.privacy'), 'eye')
        ]),
        el('p.xs.muted', { style: { marginTop: '12px' } }, t('settings.version', { version: appVersion })),
        el('p.xs.muted', {}, 'AI-assisted accessibility intelligence. Not an official accessibility certification, and not affiliated with or endorsed by the Municipality of Pafos.')
      ])
    ]);
  }

  function linkRow(href, label, iconName) {
    return el('a.list-item', { href }, [
      icon(iconName, 18),
      el('div.list-item__title', {}, label),
      icon('chevronRight', 16)
    ]);
  }

  return { destroy: off };
}
